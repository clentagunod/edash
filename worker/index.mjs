import { importX509, jwtVerify } from "jose";
import providerHelpers from "../functions/eduai-provider.cjs";
import contextHelpers from "../functions/eduai-context.cjs";
import { buildEduAiProductGuide } from "../functions/eduai-guide.mjs";

const {
  PROVIDERS,
  buildProviderRequest,
  buildSystemInstruction,
  decryptApiKey,
  encryptApiKey,
  isQuotaExhausted,
  normalizeUsage,
  parseProviderResponse,
  validateProviderConfiguration,
} = providerHelpers;
const FIREBASE_CERT_URL = "https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com";
const ALLOWED_ROLES = new Set(["School Admin", "Registrar", "Teacher"]);
const ALLOWED_MODELS = new Set(["gemini-3.5-flash-lite"]);
const OUTPUT_OPTIONS = new Set([256, 512, 768, 1024, 1536, 2048]);
const TIMEOUT_OPTIONS = new Set([30, 45, 60, 90, 120]);
const HISTORY_OPTIONS = new Set([0, 2, 4, 6, 8]);
const NAME_OPTIONS = new Set([0, 25, 50, 100, 150]);
const DEFAULT_SETTINGS = {
  model: "gemini-3.5-flash-lite",
  maxOutputTokens: 1024,
  timeoutSeconds: 60,
  temperature: 0.2,
  historyMessages: 8,
  learnerNameLimit: 50,
};

let certificateCache;
let certificateExpiresAt = 0;

class ApiError extends Error {
  constructor(status, code, message, details = undefined) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export function getCredentialEncryptionKey(env) {
  const key = env.EDUAI_CREDENTIAL_ENCRYPTION_KEY;
  if (typeof key !== "string" || !key.trim()) {
    throw new ApiError(
      503,
      "failed-precondition",
      "Personal provider setup is temporarily unavailable because secure key storage is not configured. Ask your administrator to configure the EduAI encryption secret.",
    );
  }
  return key;
}

function jsonResponse(value, status, corsHeaders) {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

function corsHeaders(request, env) {
  const origin = request.headers.get("Origin") || "";
  const allowedOrigins = (env.ALLOWED_ORIGINS || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  if (origin && !allowedOrigins.includes(origin)) {
    throw new ApiError(403, "permission-denied", "This website is not allowed to use the EduAI gateway.");
  }
  return {
    ...(origin ? { "Access-Control-Allow-Origin": origin, Vary: "Origin" } : {}),
    "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    "Access-Control-Max-Age": "86400",
  };
}

function fromFirestoreValue(value) {
  if (!value || typeof value !== "object") return null;
  if ("nullValue" in value) return null;
  if ("stringValue" in value) return value.stringValue;
  if ("booleanValue" in value) return value.booleanValue;
  if ("integerValue" in value) return Number(value.integerValue);
  if ("doubleValue" in value) return Number(value.doubleValue);
  if ("timestampValue" in value) return value.timestampValue;
  if ("referenceValue" in value) return value.referenceValue;
  if ("bytesValue" in value) return value.bytesValue;
  if ("arrayValue" in value) return (value.arrayValue.values || []).map(fromFirestoreValue);
  if ("mapValue" in value) return fromFirestoreFields(value.mapValue.fields || {});
  return null;
}

function fromFirestoreFields(fields = {}) {
  return Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, fromFirestoreValue(value)]));
}

function firestoreDocument(document) {
  const name = String(document?.name || "");
  return {
    id: name.split("/").pop() || "",
    name,
    ...(document?.fields ? fromFirestoreFields(document.fields) : {}),
  };
}

export function getSchoolId(request, body) {
  const querySchoolId = new URL(request.url).searchParams.get("schoolId");
  return querySchoolId || (typeof body?.schoolId === "string" ? body.schoolId : "");
}

function requireProjectId(value) {
  if (typeof value !== "string" || !/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(value)) {
    throw new ApiError(400, "invalid-argument", "The active school project is invalid.");
  }
  return value;
}

async function getFirebaseCertificates() {
  if (certificateCache && Date.now() < certificateExpiresAt) return certificateCache;
  const response = await fetch(FIREBASE_CERT_URL);
  if (!response.ok) throw new ApiError(503, "unavailable", "EduAI could not verify your sign-in token. Try again shortly.");
  const certificates = await response.json();
  const cacheControl = response.headers.get("Cache-Control") || "";
  const maxAge = Number(cacheControl.match(/max-age=(\d+)/i)?.[1] || 300);
  certificateCache = certificates;
  certificateExpiresAt = Date.now() + Math.max(60, maxAge - 30) * 1000;
  return certificates;
}

async function verifyCaller(request, projectId) {
  const authorization = request.headers.get("Authorization") || "";
  const token = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  if (!token || token.length > 8192) {
    throw new ApiError(401, "unauthenticated", "Sign in before using EduAI.");
  }
  let header;
  try {
    header = JSON.parse(atob(token.split(".")[0].replace(/-/g, "+").replace(/_/g, "/")));
  } catch {
    throw new ApiError(401, "unauthenticated", "Your sign-in token is invalid. Sign in again.");
  }
  const certificate = (await getFirebaseCertificates())[header.kid];
  if (!certificate || header.alg !== "RS256") {
    throw new ApiError(401, "unauthenticated", "Your sign-in token could not be verified.");
  }
  try {
    const key = await importX509(certificate, "RS256");
    const { payload } = await jwtVerify(token, key, {
      algorithms: ["RS256"],
      audience: projectId,
      issuer: `https://securetoken.google.com/${projectId}`,
    });
    if (typeof payload.sub !== "string" || !payload.sub
        || !Number.isFinite(payload.auth_time) || payload.auth_time > Math.floor(Date.now() / 1000)
        || payload.firebase?.sign_in_provider === "anonymous") {
      throw new Error("invalid token claims");
    }
    return { uid: payload.sub, token };
  } catch {
    throw new ApiError(401, "unauthenticated", "Your sign-in token is invalid or expired. Sign in again.");
  }
}

async function readRegistrySchool(schoolId, env) {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(schoolId || "")
      || !env.REGISTRY_PROJECT_ID || !env.REGISTRY_FIREBASE_API_KEY) {
    throw new ApiError(503, "failed-precondition", "The central school registry is not configured for EduAI.");
  }
  const path = `projects/${encodeURIComponent(env.REGISTRY_PROJECT_ID)}/databases/(default)/documents/schools/${encodeURIComponent(schoolId)}`;
  const url = `https://firestore.googleapis.com/v1/${path}?key=${encodeURIComponent(env.REGISTRY_FIREBASE_API_KEY)}`;
  const response = await fetch(url);
  if (response.status === 404) throw new ApiError(403, "permission-denied", "EduAI is not enabled for this school.");
  if (!response.ok) throw new ApiError(503, "unavailable", "EduAI could not verify this school's registry settings.");
  return firestoreDocument(await response.json());
}

async function getRequestContext(request, env) {
  let body;
  if (request.method === "GET") body = Object.fromEntries(new URL(request.url).searchParams);
  else {
    const text = await request.text();
    if (text.length > 400000) throw new ApiError(413, "invalid-argument", "The EduAI request is too large.");
    try {
      body = JSON.parse(text || "{}");
    } catch {
      throw new ApiError(400, "invalid-argument", "The EduAI request must contain valid JSON.");
    }
  }
  const schoolId = getSchoolId(request, body);
  const school = await readRegistrySchool(schoolId, env);
  if (school.enabled !== true || school.canUseEduAI !== true) {
    throw new ApiError(403, "permission-denied", "EduAI is not enabled for this school.");
  }
  const tenantConfig = school.firebaseConfig;
  const projectId = requireProjectId(tenantConfig?.projectId);
  const caller = await verifyCaller(request, projectId);
  if (!tenantConfig?.apiKey) throw new ApiError(503, "failed-precondition", "The school Firebase web configuration is incomplete.");
  return { body, schoolId, school, tenantConfig, projectId, ...caller };
}

function firestoreApiUrl(projectId, path, apiKey, query = "") {
  return `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/databases/(default)/documents/${path}${query ? `?${query}&` : "?"}key=${encodeURIComponent(apiKey)}`;
}

async function tenantFirestoreFetch(url, token, init = {}) {
  const response = await fetch(url, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, ...(init.headers || {}) },
    redirect: "manual",
  });
  if (!response.ok) {
    const failure = await response.clone().json().catch(() => ({}));
    const firestoreCode = typeof failure?.error?.status === "string" ? failure.error.status : "";
    const firestoreMessage = typeof failure?.error?.message === "string"
      ? failure.error.message.replace(/https?:\/\/\S+/gi, "[link]").slice(0, 240)
      : "";
    console.error("EduAI tenant Firestore collection read failed:", {
      status: response.status,
      firestoreCode,
      firestoreMessage,
      method: init.method || "GET",
      resource: new URL(url).pathname.split("/documents/")[1]?.split(":")[0] || "unknown",
    });
    if (response.status === 401 || response.status === 403) {
      throw new ApiError(403, "permission-denied",
        `Firestore denied EduAI access to school records (HTTP ${response.status}${firestoreCode ? `, ${firestoreCode}` : ""}). Check the tenant Firestore rules and the signed-in account's active role.${firestoreMessage ? ` ${firestoreMessage}` : ""}`);
    }
    throw new ApiError(502, "unavailable",
      `Firestore rejected EduAI's school-record request (HTTP ${response.status}${firestoreCode ? `, ${firestoreCode}` : ""}). Check the tenant Firebase project/API key configuration and Firestore API availability.${firestoreMessage ? ` ${firestoreMessage}` : ""}`);
  }
  return response;
}

async function getTenantDocument(context, path, allowNotFound = false) {
  const url = firestoreApiUrl(context.projectId, path, context.tenantConfig.apiKey);
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${context.token}` },
    redirect: "manual",
  });
  if (allowNotFound && response.status === 404) return {};
  if (!response.ok) {
    const resource = path.startsWith("users/")
      ? "active user profile"
      : path === "settings/currentSchoolYear"
        ? "current school-year setting"
        : "school data";
    console.error("EduAI tenant Firestore document read failed:", {
      status: response.status,
      resource,
    });
    if (response.status === 401 || response.status === 403) {
      throw new ApiError(403, "permission-denied",
        `Firestore denied EduAI access to the ${resource} (HTTP ${response.status}). Check the tenant Firestore rules and the signed-in account's active role.`);
    }
    throw new ApiError(502, "unavailable",
      `EduAI could not load the ${resource} from Firestore (HTTP ${response.status}). Check the tenant Firebase project/API key configuration and Firestore API availability.`);
  }
  return firestoreDocument(await response.json());
}

async function listTenantCollection(context, path) {
  let pageToken = "";
  const documents = [];
  while (true) {
    const params = new URLSearchParams({ pageSize: "1000" });
    if (pageToken) params.set("pageToken", pageToken);
    const response = await tenantFirestoreFetch(
      firestoreApiUrl(context.projectId, path, context.tenantConfig.apiKey, params.toString()),
      context.token,
    );
    const payload = await response.json();
    documents.push(...(payload.documents || []).map(firestoreDocument));
    if (documents.length > 10000) throw new ApiError(413, "resource-exhausted", "This school's learner list is too large to summarize safely.");
    pageToken = payload.nextPageToken || "";
    if (!pageToken) return documents;
  }
}

function teacherAssignments(profile, schoolYear) {
  const source = Array.isArray(profile.teacherAssignments) && profile.teacherAssignments.length
    ? profile.teacherAssignments
    : profile.teacherAssignment ? [profile.teacherAssignment] : [];
  const unique = new Map();
  source.forEach((assignment) => {
    const year = String(assignment?.schoolYear || profile.schoolYear || "").trim().replace(/[–—]/g, "-").replace(/\s+/g, "");
    const gradeValue = String(assignment?.gradeLevel || assignment?.gradeKey || profile.gradeLevel || "").trim();
    const grade = ["kinder", "kindergarten", "kg", "0"].includes(gradeValue.toLowerCase())
      ? "Kinder"
      : (gradeValue.match(/^(?:grade\s*)?(\d+)$/i) ? `Grade ${gradeValue.match(/^(?:grade\s*)?(\d+)$/i)[1]}` : gradeValue);
    const section = String(assignment?.section || assignment?.sectionKey || profile.section || "").trim();
    if (year !== schoolYear || !grade || !section) return;
    unique.set(`${grade}|${section}`.toLowerCase(), { gradeLevel: grade, section });
  });
  return [...unique.values()];
}

export function buildTeacherLearnerQuery(gradeLevel, cursor = "") {
  return {
    from: [{ collectionId: "learners" }],
    where: {
      fieldFilter: {
        field: { fieldPath: "gradeLevel" },
        op: "EQUAL",
        value: { stringValue: gradeLevel },
      },
    },
    orderBy: [{ field: { fieldPath: "__name__" }, direction: "ASCENDING" }],
    limit: 1000,
    ...(cursor ? { startAt: { values: [{ referenceValue: cursor }], before: false } } : {}),
  };
}

export function buildTeacherLearnerQueryPath(schoolYear) {
  return `schoolYears/${encodeURIComponent(schoolYear)}:runQuery`;
}

export function isAssignedTeacherLearner(learner, section) {
  return String(learner?.section || "").trim().toLowerCase() === section.trim().toLowerCase();
}

async function listTeacherLearners(context, schoolYear, assignments) {
  const uniqueDocuments = new Map();
  for (const assignment of assignments) {
    let cursor;
    for (let page = 0; page < 20; page += 1) {
      const structuredQuery = buildTeacherLearnerQuery(assignment.gradeLevel, cursor);
      const url = firestoreApiUrl(
        context.projectId,
        buildTeacherLearnerQueryPath(schoolYear),
        context.tenantConfig.apiKey,
      );
      const response = await tenantFirestoreFetch(url, context.token, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ structuredQuery }),
      });
      const results = (await response.json()).map((item) => item.document).filter(Boolean);
      if (!results.length) break;
      results.forEach((document) => {
        const learner = firestoreDocument(document);
        if (isAssignedTeacherLearner(learner, assignment.section)) {
          uniqueDocuments.set(document.name, learner);
        }
      });
      if (results.length < 1000 || uniqueDocuments.size > 10000) break;
      cursor = results[results.length - 1].name;
    }
    if (uniqueDocuments.size > 10000) {
      throw new ApiError(413, "resource-exhausted", "This teacher's assigned learner list is too large to summarize safely.");
    }
  }
  return [...uniqueDocuments.values()];
}

function currentSchoolYear(value) {
  const text = String(value || "").trim().replace(/[–—]/g, "-").replace(/\s+/g, "");
  const match = text.match(/^(\d{4})[-/]?(\d{4})$/);
  return match ? `${match[1]}-${match[2]}` : "";
}

export async function buildTrustedContext(context) {
  const profile = await getTenantDocument(context, `users/${encodeURIComponent(context.uid)}`);
  if (profile.status !== "Active" || !ALLOWED_ROLES.has(profile.role)) {
    throw new ApiError(403, "permission-denied", "EduAI is available only to active teachers, registrars, and school administrators.");
  }
  let toggles;
  try { toggles = await getTenantDocument(context, 'settings/toggles', true); }
  catch { /* Missing access/configuration must not be described as a verified setting. */ }
  const yearSetting = await getTenantDocument(context, "settings/currentSchoolYear", true);
  let schoolYear = currentSchoolYear(yearSetting.value);
  if (!schoolYear) {
    const years = await listTenantCollection(context, "schoolYears");
    const validYears = years.map((year) => ({
      schoolYear: currentSchoolYear(year.schoolYear || year.id),
      isCurrent: year.isCurrent === true,
    })).filter(({ schoolYear: value }) => value)
      .sort((left, right) => Number(right.schoolYear.replace("-", "")) - Number(left.schoolYear.replace("-", "")));
    schoolYear = validYears.find((year) => year.isCurrent)?.schoolYear || validYears[0]?.schoolYear || "";
  }
  const withAccess = records => ({
    ...loadTrustedEduAiContextContext(profile.role, schoolYear, records),
    applicationAccess: contextHelpers.buildEduAiApplicationAccess(profile.role, profile, schoolYear, toggles),
  });
  if (!schoolYear) return { profile, context: withAccess([]) };

  const learners = profile.role === "Teacher"
    ? await listTeacherLearners(context, schoolYear, teacherAssignments(profile, schoolYear))
    : await listTenantCollection(context, `schoolYears/${encodeURIComponent(schoolYear)}/learners`);
  return {
    profile,
    context: withAccess(learners),
  };
}

function loadTrustedEduAiContextContext(role, schoolYear, records) {
  const activeLearners = records.filter((learner) => {
    const enrollmentStatus = String(learner.enrollmentStatus || "ACTIVE").toUpperCase().replace(/[ -]+/g, "_");
    const eosyStatus = String(learner.eosyStatus || "").toLowerCase().replace(/[_-]+/g, " ");
    return enrollmentStatus !== "TRANSFERRED_OUT" && enrollmentStatus !== "DROPPED_OUT"
      && eosyStatus !== "dropped out" && !learner.transferOut;
  });
  const context = contextHelpers.buildEduAiContext(role, schoolYear, activeLearners);
  return context;
}

function normalizeSettings(value) {
  const settings = value && typeof value === "object" ? value : {};
  const temperature = Number(settings.temperature);
  return {
    model: ALLOWED_MODELS.has(settings.model) ? settings.model : DEFAULT_SETTINGS.model,
    maxOutputTokens: OUTPUT_OPTIONS.has(Number(settings.maxOutputTokens)) ? Number(settings.maxOutputTokens) : DEFAULT_SETTINGS.maxOutputTokens,
    timeoutSeconds: TIMEOUT_OPTIONS.has(Number(settings.timeoutSeconds)) ? Number(settings.timeoutSeconds) : DEFAULT_SETTINGS.timeoutSeconds,
    temperature: Number.isFinite(temperature) && temperature >= 0 && temperature <= 0.6 ? temperature : DEFAULT_SETTINGS.temperature,
    historyMessages: HISTORY_OPTIONS.has(Number(settings.historyMessages)) ? Number(settings.historyMessages) : DEFAULT_SETTINGS.historyMessages,
    learnerNameLimit: NAME_OPTIONS.has(Number(settings.learnerNameLimit)) ? Number(settings.learnerNameLimit) : DEFAULT_SETTINGS.learnerNameLimit,
  };
}

function monthId() {
  return new Date().toISOString().slice(0, 7);
}

function providerRowKey(schoolId, uid) {
  return { schoolId, uid };
}

async function readProviderSettings(db, schoolId, uid) {
  return db.prepare(`SELECT selected_provider, personal_provider, model, endpoint, encrypted_iv,
    encrypted_ciphertext, encrypted_tag FROM eduai_provider_settings WHERE school_id = ?1 AND uid = ?2`)
    .bind(schoolId, uid).first();
}

async function readUsage(db, schoolId, uid, provider) {
  const row = await db.prepare(`SELECT requests, input_tokens, output_tokens FROM eduai_usage
    WHERE school_id = ?1 AND uid = ?2 AND provider = ?3 AND month = ?4`)
    .bind(schoolId, uid, provider, monthId()).first();
  return normalizeUsage({
    requests: Number(row?.requests || 0),
    inputTokens: Number(row?.input_tokens || 0),
    outputTokens: Number(row?.output_tokens || 0),
  });
}

function requireText(value, message, maxLength) {
  if (typeof value !== "string" || !value.trim() || value.length > maxLength) {
    throw new ApiError(400, "invalid-argument", message);
  }
  return value.trim();
}

export function safeProviderErrorDetail(value) {
  if (typeof value !== "string") return "";
  return value
    .replace(/https?:\/\/\S+/gi, "[link]")
    .replace(/AIza[0-9A-Za-z_-]{20,}/g, "[redacted key]")
    .replace(/Bearer\s+\S+/gi, "Bearer [redacted]")
    .trim()
    .slice(0, 240);
}

function providerError(provider, status, detail = "") {
  const label = PROVIDERS[provider]?.label || "AI provider";
  const diagnostic = detail ? ` Provider detail: ${detail}` : "";
  if (status === 401 || status === 403) return `${label} rejected the API key or its permissions. Check the key and account access in AI settings.${diagnostic}`;
  if (status === 404) return `${label} could not find this model or endpoint (HTTP 404). Check the model ID and provider API access.${diagnostic}`;
  if (status === 429) return `${label} is rate-limiting requests. Wait a moment and retry.${diagnostic}`;
  if (status === 503 || status === 502) return `${label} is temporarily unavailable. Please retry shortly.${diagnostic}`;
  return `${label} returned an error (HTTP ${status}). Check the provider settings and try again.${diagnostic}`;
}

async function chatWithProvider(configuration, apiKey, systemInstruction, history, question, settings, signal) {
  const upstream = buildProviderRequest(configuration, apiKey, systemInstruction, history, question, settings);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), settings.timeoutSeconds * 1000);
  const abortRequest = () => controller.abort();
  signal.addEventListener("abort", abortRequest, { once: true });
  try {
    let response;
    for (let attempt = 0; ; attempt += 1) {
      response = await fetch(upstream.url, {
        method: "POST",
        headers: upstream.headers,
        body: JSON.stringify(upstream.body),
        signal: controller.signal,
        redirect: "manual",
      });
      if (configuration.provider !== "gemini" || response.status !== 503 || attempt >= 2) break;
      await new Promise((resolve) => setTimeout(resolve, [500, 1200][attempt]));
    }
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const providerCode = typeof payload?.error?.status === "string"
        ? payload.error.status
        : typeof payload?.error?.code === "string" ? payload.error.code : "";
      const detail = safeProviderErrorDetail(payload?.error?.message || payload?.message);
      console.error("EduAI provider request failed:", {
        provider: configuration.provider,
        model: configuration.model,
        status: response.status,
        providerCode,
        detail,
      });
      if (isQuotaExhausted(response.status, payload)) {
        throw new ApiError(429, "resource-exhausted",
          `${PROVIDERS[configuration.provider].label} reports that its free usage or billing quota is exhausted. Add provider credits or wait for the provider's quota to reset.`,
          { freeUsageExhausted: true, provider: configuration.provider });
      }
      throw new ApiError(502, "unavailable", providerError(configuration.provider, response.status, detail));
    }
    const result = parseProviderResponse(configuration.provider, payload);
    if (!result.reply) throw new ApiError(502, "internal", "The AI provider returned an empty response. Please try again.");
    return result;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (signal.aborted) throw new ApiError(499, "cancelled", "The EduAI response was stopped.");
    if (controller.signal.aborted) throw new ApiError(504, "deadline-exceeded", `${PROVIDERS[configuration.provider].label} took too long to respond. Please try again.`);
    throw new ApiError(502, "unavailable", `${PROVIDERS[configuration.provider].label} could not be reached. Check your connection and try again.`);
  } finally {
    clearTimeout(timeout);
    signal.removeEventListener("abort", abortRequest);
  }
}

async function getSettings(context, env) {
  const row = await readProviderSettings(env.EDUAI_DB, context.schoolId, context.uid);
  const selectedProvider = row?.selected_provider || "default";
  return {
    provider: selectedProvider,
    personalProvider: row?.personal_provider || "",
    model: row?.model || "",
    endpoint: row?.endpoint || "",
    credentialConfigured: Boolean(row?.encrypted_ciphertext),
    sharedConfigured: Boolean(env.GEMINI_API_KEY),
    usage: await readUsage(env.EDUAI_DB, context.schoolId, context.uid, selectedProvider),
    usagePeriod: monthId(),
  };
}

async function saveSettings(context, env, input) {
  const provider = input.provider;
  const now = new Date().toISOString();
  if (provider === "default") {
    await env.EDUAI_DB.prepare(`INSERT INTO eduai_provider_settings
      (school_id, uid, selected_provider, updated_at) VALUES (?1, ?2, 'default', ?3)
      ON CONFLICT(school_id, uid) DO UPDATE SET selected_provider = 'default', updated_at = excluded.updated_at`)
      .bind(context.schoolId, context.uid, now).run();
    return { provider: "default" };
  }
  let configuration;
  try {
    configuration = validateProviderConfiguration(provider, input.model, input.endpoint);
  } catch (error) {
    throw new ApiError(400, "invalid-argument", error.message);
  }
  const existing = await readProviderSettings(env.EDUAI_DB, context.schoolId, context.uid);
  const apiKey = typeof input.apiKey === "string" ? input.apiKey.trim() : "";
  const canKeepKey = existing?.personal_provider === provider && Boolean(existing.encrypted_ciphertext);
  if (!apiKey && !canKeepKey) throw new ApiError(400, "invalid-argument", "Enter an API key to finish setting up your provider.");
  if (apiKey && (apiKey.length < 8 || apiKey.length > 2048)) {
    throw new ApiError(400, "invalid-argument", "The API key must contain between 8 and 2,048 characters.");
  }
  let encrypted = null;
  if (apiKey) {
    try {
      encrypted = encryptApiKey(apiKey, getCredentialEncryptionKey(env));
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(
        503,
        "failed-precondition",
        "Personal provider setup is temporarily unavailable because secure key storage is misconfigured. Ask your administrator to reconfigure the EduAI encryption secret.",
      );
    }
  }
  await env.EDUAI_DB.prepare(`INSERT INTO eduai_provider_settings
    (school_id, uid, selected_provider, personal_provider, model, endpoint, encrypted_iv, encrypted_ciphertext, encrypted_tag, updated_at)
    VALUES (?1, ?2, ?3, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
    ON CONFLICT(school_id, uid) DO UPDATE SET
      selected_provider = excluded.selected_provider,
      personal_provider = excluded.personal_provider,
      model = excluded.model,
      endpoint = excluded.endpoint,
      encrypted_iv = COALESCE(excluded.encrypted_iv, eduai_provider_settings.encrypted_iv),
      encrypted_ciphertext = COALESCE(excluded.encrypted_ciphertext, eduai_provider_settings.encrypted_ciphertext),
      encrypted_tag = COALESCE(excluded.encrypted_tag, eduai_provider_settings.encrypted_tag),
      updated_at = excluded.updated_at`)
    .bind(context.schoolId, context.uid, provider, configuration.model, configuration.endpoint,
      encrypted?.iv || existing?.encrypted_iv || "", encrypted?.ciphertext || existing?.encrypted_ciphertext || "",
      encrypted?.tag || existing?.encrypted_tag || "", now)
    .run();
  return { provider, model: configuration.model, endpoint: configuration.endpoint, credentialConfigured: true };
}

async function removeCredentials(context, env) {
  await env.EDUAI_DB.prepare("DELETE FROM eduai_provider_settings WHERE school_id = ?1 AND uid = ?2")
    .bind(context.schoolId, context.uid).run();
  return { provider: "default", credentialConfigured: false };
}

async function chat(context, env, input, request) {
  const question = requireText(input.question, "Enter a message of up to 2,000 characters.", 2000);
  if (question.length > 2000) throw new ApiError(400, "invalid-argument", "Enter a message of up to 2,000 characters.");
  const settings = normalizeSettings(input.settings);
  const historyInput = Array.isArray(input.history) ? input.history : [];
  const history = (settings.historyMessages ? historyInput.slice(-settings.historyMessages) : []).map((message) => {
    if (!["user", "assistant"].includes(message?.role) || typeof message.content !== "string"
        || !message.content.trim() || message.content.length > 2000) {
      throw new ApiError(400, "invalid-argument", "The conversation history is invalid. Start a new chat and try again.");
    }
    return { role: message.role, content: message.content.trim() };
  });
  const { profile, context: schoolContext } = await buildTrustedContext(context);
  const productGuide = buildEduAiProductGuide(
    question,
    profile.role,
    history,
  );
  const systemInstruction = buildSystemInstruction(schoolContext, productGuide, settings.learnerNameLimit);
  const saved = await readProviderSettings(env.EDUAI_DB, context.schoolId, context.uid);
  let configuration;
  let apiKey;
  if (saved?.selected_provider && saved.selected_provider !== "default") {
    if (!saved.encrypted_ciphertext) throw new ApiError(412, "failed-precondition", "Your personal provider is not completely set up. Open AI settings to finish configuration.");
    try {
      configuration = validateProviderConfiguration(saved.personal_provider, saved.model, saved.endpoint);
      apiKey = decryptApiKey({
        iv: saved.encrypted_iv,
        ciphertext: saved.encrypted_ciphertext,
        tag: saved.encrypted_tag,
      }, getCredentialEncryptionKey(env));
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(412, "failed-precondition", error.message);
    }
  } else {
    apiKey = env.GEMINI_API_KEY;
    if (!apiKey) throw new ApiError(412, "failed-precondition", "EduAI's shared Gemini provider is not configured.");
    configuration = validateProviderConfiguration("gemini", settings.model, PROVIDERS.gemini.endpoint);
  }
  const result = await chatWithProvider(configuration, apiKey, systemInstruction, history, question, settings, request.signal);
  const provider = saved?.selected_provider || "default";
  await env.EDUAI_DB.prepare(`INSERT INTO eduai_usage
    (school_id, uid, provider, month, requests, input_tokens, output_tokens)
    VALUES (?1, ?2, ?3, ?4, 1, ?5, ?6)
    ON CONFLICT(school_id, uid, provider, month) DO UPDATE SET
      requests = requests + 1,
      input_tokens = input_tokens + excluded.input_tokens,
      output_tokens = output_tokens + excluded.output_tokens`)
    .bind(context.schoolId, context.uid, provider, monthId(), result.inputTokens, result.outputTokens)
    .run();
  return { reply: result.reply, modelUsed: configuration.model };
}

async function handleRequest(request, env) {
  let cors;
  let path = "unknown";
  try {
    cors = corsHeaders(request, env);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    path = new URL(request.url).pathname.replace(/\/+$/, "");
    if (!["/settings", "/chat"].includes(path)) {
      throw new ApiError(404, "not-found", "EduAI endpoint not found.");
    }
    const context = await getRequestContext(request, env);
    if (path === "/settings" && request.method === "GET") {
      return jsonResponse(await getSettings(context, env), 200, cors);
    }
    if (path === "/settings" && request.method === "POST") {
      return jsonResponse(await saveSettings(context, env, context.body), 200, cors);
    }
    if (path === "/settings" && request.method === "DELETE") {
      return jsonResponse(await removeCredentials(context, env), 200, cors);
    }
    if (path === "/chat" && request.method === "POST") {
      return jsonResponse(await chat(context, env, context.body, request), 200, cors);
    }
    throw new ApiError(405, "method-not-allowed", "This method is not supported for the EduAI endpoint.");
  } catch (error) {
    const safeError = error instanceof ApiError
      ? error
      : new ApiError(500, "internal", "EduAI encountered an unexpected server error. Please try again.");
    if (!(error instanceof ApiError)) {
      const stackFrames = error instanceof Error
        ? (error.stack || "").split("\n").slice(1, 7).map((frame) => frame.trim())
        : [];
      const errorMessage = error instanceof Error
        ? error.message.replace(/https?:\/\/\S+/gi, "[url]").slice(0, 180)
        : "";
      console.error("EduAI gateway error:", {
        path,
        errorType: error instanceof Error ? error.name : "UnknownError",
        errorMessage,
        stackFrames,
      });
    }
    try {
      cors ||= corsHeaders(request, env);
    } catch {
      cors = {};
    }
    return jsonResponse({
      error: safeError.message,
      code: safeError.code,
      ...(safeError.details ? { details: safeError.details } : {}),
    }, safeError.status, cors);
  }
}

export default {
  async fetch(request, env) {
    return handleRequest(request, env);
  },
};
