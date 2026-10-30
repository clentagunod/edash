declare const firebase: any;

export interface FirebaseWebConfig {
  [field: string]: unknown;
  apiKey: string;
  authDomain: string;
  projectId: string;
  storageBucket: string;
  messagingSenderId: string;
  appId: string;
}

export interface SchoolInfo {
  [field: string]: unknown;
  /** Official school ID, distinct from the registry document ID used in URLs. */
  id?: string | number;
  region: string;
  divisionOffice: string;
  district: string;
  schoolAddr?: string;
  address?: string;
  contactNumber?: string;
  email?: string;
  fbPage?: string;
  motto?: string;
  divisionLogoUrl?: string;
  districtLogoUrl?: string;
}

export interface RegisteredSchool {
  [field: string]: unknown;
  id: string;
  enabled: true;
  name: string;
  nickname: string;
  projectName?: string;
  tagline?: string;
  colorGradientTag?: string;
  logoUrl: string;
  videoUrl: string;
  canUseEduAI?: boolean;
  schoolInfo?: SchoolInfo;
  schoolHead?: {
    [field: string]: unknown;
    name?: string;
    position?: string;
    email?: string;
    phoneNumber?: string;
    updatedAt?: unknown;
  };
  firebaseConfig: FirebaseWebConfig;
  auditLogApiUrl?: string;
  feedbackApiUrl?: string;
}

const env = import.meta.env as Record<string, string | undefined>;
const ACTIVE_SCHOOL_KEY = "edash.activeSchool";
const PARENT_PORTAL_SCHOOL_KEY = "edash.parentPortalSchool";
const registryFirebaseConfig = readFirebaseConfig("VITE_REGISTRY_FIREBASE");

function readFirebaseConfig(prefix: string): FirebaseWebConfig {
  return {
    apiKey: env[`${prefix}_API_KEY`] || "",
    authDomain: env[`${prefix}_AUTH_DOMAIN`] || "",
    projectId: env[`${prefix}_PROJECT_ID`] || "",
    storageBucket: env[`${prefix}_STORAGE_BUCKET`] || "",
    messagingSenderId: env[`${prefix}_MESSAGING_SENDER_ID`] || "",
    appId: env[`${prefix}_APP_ID`] || "",
  };
}

function configIsUsable(config: Partial<FirebaseWebConfig> | undefined): config is FirebaseWebConfig {
  return Boolean(
    config &&
      typeof config.apiKey === "string" &&
      config.apiKey &&
      typeof config.authDomain === "string" &&
      config.authDomain &&
      typeof config.projectId === "string" &&
      config.projectId &&
      typeof config.appId === "string" &&
      config.appId,
  );
}

function isSafeAssetReference(value: string): boolean {
  try {
    const url = new URL(value, window.location.origin);
    return url.protocol === "https:" || (url.origin === window.location.origin && url.protocol === window.location.protocol);
  } catch {
    return false;
  }
}

function isHttpsOrEmpty(value: string): boolean {
  if (!value) return true;
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

const registryBootstrapSchool: RegisteredSchool = Object.freeze({
  id: "edash-registry",
  enabled: true,
  name: "E-Dash",
  nickname: "E-Dash",
  logoUrl: "/assets/edash/edash.png",
  videoUrl: "",
  firebaseConfig: registryFirebaseConfig,
  auditLogApiUrl: "",
  feedbackApiUrl: "",
});

const REGISTRY_CACHE_TTL_MS = 30_000;
let cachedSchools: RegisteredSchool[] | null = null;
let cacheExpiresAt = 0;
let pendingRegistryRead: Promise<RegisteredSchool[]> | null = null;
const schoolReads = new Map<string, Promise<RegisteredSchool | null>>();
const schoolCache = new Map<string, { school: RegisteredSchool | null; expiresAt: number }>();

export function isSchoolRegistryId(value: string): boolean {
  return /^[a-z0-9][a-z0-9-]{1,62}$/.test(value);
}

export function isRegisteredSchool(value: unknown): value is RegisteredSchool {
  if (!value || typeof value !== "object") return false;
  const school = value as Partial<RegisteredSchool>;
  return (
    typeof school.id === "string" &&
    isSchoolRegistryId(school.id) &&
    school.enabled === true &&
    typeof school.name === "string" &&
    school.name.trim().length > 0 &&
    school.name.length <= 120 &&
    typeof school.nickname === "string" &&
    school.nickname.length <= 64 &&
    (school.projectName === undefined || (typeof school.projectName === "string" && school.projectName.length <= 120)) &&
    (school.tagline === undefined || (typeof school.tagline === "string" && school.tagline.length <= 240)) &&
    (school.colorGradientTag === undefined ||
      (typeof school.colorGradientTag === "string" && /^#[0-9a-fA-F]{6}$/.test(school.colorGradientTag))) &&
    typeof school.logoUrl === "string" &&
    isSafeAssetReference(school.logoUrl) &&
    typeof school.videoUrl === "string" &&
    (!school.videoUrl || isSafeAssetReference(school.videoUrl)) &&
    (school.canUseEduAI === undefined || typeof school.canUseEduAI === "boolean") &&
    configIsUsable(school.firebaseConfig) &&
    (school.auditLogApiUrl === undefined ||
      (typeof school.auditLogApiUrl === "string" && isHttpsOrEmpty(school.auditLogApiUrl))) &&
    (school.feedbackApiUrl === undefined ||
      (typeof school.feedbackApiUrl === "string" && isHttpsOrEmpty(school.feedbackApiUrl))) &&
    (school.schoolInfo === undefined ||
      (!!school.schoolInfo &&
        typeof school.schoolInfo === "object" &&
        !Array.isArray(school.schoolInfo) &&
        (school.schoolInfo.id === undefined ||
          typeof school.schoolInfo.id === "string" ||
          (typeof school.schoolInfo.id === "number" && Number.isSafeInteger(school.schoolInfo.id) && school.schoolInfo.id >= 0)) &&
        ["region", "divisionOffice", "district", "schoolAddr", "address", "contactNumber", "email", "fbPage", "motto", "divisionLogoUrl", "districtLogoUrl"].every((field) =>
          school.schoolInfo?.[field] === undefined || typeof school.schoolInfo[field] === "string",
        ))) &&
    (school.schoolHead === undefined ||
      (!!school.schoolHead &&
        typeof school.schoolHead === "object" &&
        !Array.isArray(school.schoolHead) &&
        ["name", "position", "email", "phoneNumber"].every((field) =>
          school.schoolHead?.[field] === undefined || typeof school.schoolHead[field] === "string",
        )))
  );
}

export function sameSchoolRegistration(left: RegisteredSchool, right: RegisteredSchool): boolean {
  return (
    left.id === right.id &&
    left.enabled === right.enabled &&
    left.name === right.name &&
    left.nickname === right.nickname &&
    left.tagline === right.tagline &&
    left.logoUrl === right.logoUrl &&
    left.videoUrl === right.videoUrl &&
    sameJsonValue(left.firebaseConfig, right.firebaseConfig) &&
    left.auditLogApiUrl === right.auditLogApiUrl &&
    left.feedbackApiUrl === right.feedbackApiUrl
  );
}

function sameJsonValue(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (!left || !right || typeof left !== "object" || typeof right !== "object") return false;
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left) && Array.isArray(right) &&
      left.length === right.length &&
      left.every((value, index) => sameJsonValue(value, right[index]));
  }
  const leftRecord = left as Record<string, unknown>;
  const rightRecord = right as Record<string, unknown>;
  const leftKeys = Object.keys(leftRecord);
  const rightKeys = Object.keys(rightRecord);
  return leftKeys.length === rightKeys.length &&
    leftKeys.every((key) =>
      Object.prototype.hasOwnProperty.call(rightRecord, key) &&
      sameJsonValue(leftRecord[key], rightRecord[key]),
    );
}

export function getActiveSchool(): RegisteredSchool {
  if (!configIsUsable(registryFirebaseConfig)) {
    throw new Error("Central E-Dash registry Firebase configuration is missing. Configure VITE_REGISTRY_FIREBASE_* before starting the app.");
  }
  const parentSchool = getParentPortalSchool();
  if (parentSchool) return parentSchool;
  try {
    const saved = JSON.parse(localStorage.getItem(ACTIVE_SCHOOL_KEY) || "null");
    if (isRegisteredSchool(saved)) return saved;
    if (saved !== null) localStorage.removeItem(ACTIVE_SCHOOL_KEY);
  } catch {
    localStorage.removeItem(ACTIVE_SCHOOL_KEY);
  }
  return registryBootstrapSchool;
}

export function getStoredSchool(): RegisteredSchool | null {
  const parentSchool = getParentPortalSchool();
  if (parentSchool) return parentSchool;
  try {
    const saved = JSON.parse(localStorage.getItem(ACTIVE_SCHOOL_KEY) || "null");
    if (isRegisteredSchool(saved)) return saved;
    if (saved !== null) localStorage.removeItem(ACTIVE_SCHOOL_KEY);
    return null;
  } catch {
    localStorage.removeItem(ACTIVE_SCHOOL_KEY);
    return null;
  }
}

/** A QR link pins its tenant to this tab without changing other school tabs. */
function getParentPortalSchool(): RegisteredSchool | null {
  const match = /^\/parent\/([^/]+)\/?$/.exec(window.location.pathname);
  if (!match) return null;
  try {
    const saved = JSON.parse(sessionStorage.getItem(PARENT_PORTAL_SCHOOL_KEY) || 'null');
    return isRegisteredSchool(saved) && saved.id === decodeURIComponent(match[1]) ? saved : null;
  } catch { return null; }
}

export function storeParentPortalSchool(school: RegisteredSchool): void {
  if (!isRegisteredSchool(school)) throw new Error('The school link has invalid registration settings.');
  sessionStorage.setItem(PARENT_PORTAL_SCHOOL_KEY, JSON.stringify(school));
}

export function storeActiveSchool(school: RegisteredSchool): void {
  if (!isRegisteredSchool(school)) throw new Error("The selected school has invalid registration settings.");
  localStorage.setItem(ACTIVE_SCHOOL_KEY, JSON.stringify(school));
}

export function clearStoredSchool(): void {
  localStorage.removeItem(ACTIVE_SCHOOL_KEY);
}

export function getCentralRegistryFirestore(): any {
  if (!configIsUsable(registryFirebaseConfig)) {
    throw new Error("Central E-Dash registry Firebase configuration is missing. Configure VITE_REGISTRY_FIREBASE_* before starting the app.");
  }
  const registryApp =
    firebase.apps.find((app: any) => app.name === "edash-school-registry") ||
    firebase.initializeApp(registryFirebaseConfig, "edash-school-registry");
  return registryApp.firestore();
}

export async function getRegisteredSchools(): Promise<RegisteredSchool[]> {
  if (cachedSchools && cacheExpiresAt > Date.now()) return cachedSchools;
  if (pendingRegistryRead) return pendingRegistryRead;

  pendingRegistryRead = (async () => {
    const snapshot = await getCentralRegistryFirestore()
      .collection("schools")
      .where("enabled", "==", true)
      .get();

    const schools = snapshot.docs.map((doc: any) => ({ ...doc.data(), id: doc.id }));
    if (schools.some((school: unknown) => !isRegisteredSchool(school))) {
      throw new Error("The central school directory contains an incomplete or invalid school registration.");
    }
    cachedSchools = schools as RegisteredSchool[];
    cacheExpiresAt = Date.now() + REGISTRY_CACHE_TTL_MS;
    return cachedSchools;
  })();
  try {
    return await pendingRegistryRead;
  } finally {
    pendingRegistryRead = null;
  }
}

/** Direct links read one registration, regardless of the number of schools. */
export async function getRegisteredSchool(schoolId: string): Promise<RegisteredSchool | null> {
  if (!isSchoolRegistryId(schoolId)) throw new Error('Invalid school link.');
  const cached = schoolCache.get(schoolId);
  if (cached && cached.expiresAt > Date.now()) return cached.school;
  const pending = schoolReads.get(schoolId);
  if (pending) return pending;
  const read = (async () => {
    const snapshot = await getCentralRegistryFirestore().collection('schools').doc(schoolId).get();
    const school = snapshot.exists ? { ...snapshot.data(), id: snapshot.id } : null;
    if (school && !isRegisteredSchool(school)) throw new Error('This school registration is unavailable or incomplete.');
    schoolCache.set(schoolId, { school, expiresAt: Date.now() + REGISTRY_CACHE_TTL_MS });
    return school as RegisteredSchool | null;
  })();
  schoolReads.set(schoolId, read);
  try { return await read; } finally { schoolReads.delete(schoolId); }
}
