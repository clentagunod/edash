const test = require("node:test");
const assert = require("node:assert/strict");
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
} = require("./eduai-provider.cjs");
const { buildEduAiApplicationAccess, buildEduAiContext, loadTrustedEduAiContext } = require("./eduai-context.cjs");

const encryptionKey = Buffer.alloc(32, 7).toString("base64");

test("reads schoolId from POST query strings as sent by the frontend", async () => {
  const { getSchoolId } = await import("../worker/index.mjs");
  const request = new Request("https://gateway.example/settings?schoolId=sample-school", {
    method: "POST",
    body: JSON.stringify({ provider: "openai" }),
  });
  assert.equal(getSchoolId(request, { provider: "openai" }), "sample-school");
  assert.equal(getSchoolId(new Request("https://gateway.example/settings"), { schoolId: "body-school" }), "body-school");
});

test("reports missing provider-key encryption configuration clearly", async () => {
  const { getCredentialEncryptionKey } = await import("../worker/index.mjs");
  assert.throws(
    () => getCredentialEncryptionKey({}),
    /secure key storage is not configured/,
  );
  assert.equal(getCredentialEncryptionKey({ EDUAI_CREDENTIAL_ENCRYPTION_KEY: "local-test-key" }), "local-test-key");
});

test("queries teacher learners without requiring a composite Firestore index", async () => {
  const {
    buildTeacherLearnerQuery,
    buildTeacherLearnerQueryPath,
    isAssignedTeacherLearner,
  } = await import("../worker/index.mjs");
  const query = buildTeacherLearnerQuery("Grade 6", "projects/school/databases/(default)/documents/schoolYears/2026-2027/learners/last");
  assert.equal(buildTeacherLearnerQueryPath("2026-2027"), "schoolYears/2026-2027:runQuery");
  assert.deepEqual(query.where.fieldFilter, {
    field: { fieldPath: "gradeLevel" },
    op: "EQUAL",
    value: { stringValue: "Grade 6" },
  });
  assert.equal(query.where.compositeFilter, undefined);
  assert.equal(query.startAt.before, false);
  assert.equal(isAssignedTeacherLearner({ gradeLevel: "Grade 6", section: "  A " }, "a"), true);
  assert.equal(isAssignedTeacherLearner({ gradeLevel: "Grade 6", section: "B" }, "a"), false);
});

test("redacts URLs and API keys from provider diagnostics", async () => {
  const { safeProviderErrorDetail } = await import("../worker/index.mjs");
  const detail = safeProviderErrorDetail(
    "Model missing: https://example.com/path?key=secret and key AIzaSyabcdefghijklmnopqrstuvwx123456",
  );
  assert.doesNotMatch(detail, /https:\/\/example\.com/);
  assert.doesNotMatch(detail, /AIzaSy/);
  assert.match(detail, /\[link\]/);
  assert.match(detail, /\[redacted key\]/);
});

test("accepts official provider endpoints and rejects non-HTTPS or cross-host URLs", () => {
  assert.equal(
    validateProviderConfiguration("openai", "gpt-4o-mini", PROVIDERS.openai.endpoint).endpoint,
    PROVIDERS.openai.endpoint,
  );
  assert.throws(
    () => validateProviderConfiguration("openai", "gpt-4o-mini", "http://api.openai.com/v1/chat/completions"),
    /official HTTPS endpoint/,
  );
  assert.throws(
    () => validateProviderConfiguration("openai", "gpt-4o-mini", "https://attacker.example/v1/chat/completions"),
    /official HTTPS endpoint/,
  );
  assert.throws(
    () => validateProviderConfiguration("openai", "gpt-4o-mini", "https://api.openai.com/v1/chat/completions?url=https://attacker.example"),
    /official HTTPS endpoint/,
  );
});

test("preserves the selected provider model instead of replacing it with a hard-coded default", () => {
  assert.equal(
    validateProviderConfiguration("gemini", "gemini-2.5-flash-lite", PROVIDERS.gemini.endpoint).model,
    "gemini-2.5-flash-lite",
  );
  assert.equal(
    validateProviderConfiguration("openai", "custom-compatible-model", PROVIDERS.openai.endpoint).model,
    "custom-compatible-model",
  );
  assert.equal(PROVIDERS.gemini.model, "gemini-3.8-flash");
});

test("encrypts credentials with authenticated encryption and rejects tampering", () => {
  const encrypted = encryptApiKey("provider-secret-key", encryptionKey);
  assert.equal(encrypted.ciphertext.includes("provider-secret-key"), false);
  assert.equal(decryptApiKey(encrypted, encryptionKey), "provider-secret-key");
  assert.throws(
    () => decryptApiKey({ ...encrypted, ciphertext: Buffer.from("tampered").toString("base64") }, encryptionKey),
    /cannot be decrypted/,
  );
});

test("builds provider-specific auth and message payloads", () => {
  const configuration = validateProviderConfiguration("claude", "claude-3-5-haiku-latest", PROVIDERS.claude.endpoint);
  const request = buildProviderRequest(configuration, "test-key", "system prompt", [], "question", {
    temperature: 0.2,
    maxOutputTokens: 512,
  });
  assert.equal(request.headers["x-api-key"], "test-key");
  assert.equal(request.body.system, "system prompt");
  assert.deepEqual(request.body.messages, [{ role: "user", content: "question" }]);
  assert.equal(request.body.max_tokens, 512);
});

test("parses provider replies and per-user token usage", () => {
  assert.deepEqual(parseProviderResponse("openai", {
    choices: [{ message: { content: "  Hello  " } }],
    usage: { prompt_tokens: 13, completion_tokens: 7 },
  }), { reply: "Hello", inputTokens: 13, outputTokens: 7 });
  assert.deepEqual(normalizeUsage({ requests: 2, inputTokens: 13, outputTokens: 7 }),
    { requests: 2, inputTokens: 13, outputTokens: 7 });
  assert.deepEqual(normalizeUsage({ requests: -1 }), { requests: 0, inputTokens: 0, outputTokens: 0 });
});

test("flags quota and billing exhaustion but not ordinary throttling", () => {
  assert.equal(isQuotaExhausted(429, { error: { message: "Free tier quota exhausted" } }), true);
  assert.equal(isQuotaExhausted(402, { error: { message: "Insufficient account balance" } }), true);
  assert.equal(isQuotaExhausted(429, { error: { message: "Too many requests; retry later" } }), false);
  assert.equal(isQuotaExhausted(503, { error: { message: "quota exceeded" } }), false);
});

test("rebuilds teacher context from server-owned assignments and active tenant records", async () => {
  const records = [
    { firstName: "Assigned", lastName: "Learner", gradeLevel: "Grade 6", section: "A", gender: "Female" },
    { firstName: "Other", lastName: "Section", gradeLevel: "Grade 6", section: "B", gender: "Male" },
    { firstName: "Former", lastName: "Learner", gradeLevel: "Grade 6", section: "A", enrollmentStatus: "TRANSFERRED_OUT" },
  ];
  const documents = records.map((record, index) => ({
    id: `learner-${index}`,
    data: () => record,
  }));
  const db = {
    collection(collectionName) {
      if (collectionName === "settings") {
        return { doc: () => ({ get: async () => ({ data: () => ({ value: "2026-2027" }) }) }) };
      }
      return {
        doc: () => ({
          collection: () => {
            const filters = [];
            const query = {
              where(field, operator, value) {
                assert.equal(operator, "==");
                filters.push([field, value]);
                return query;
              },
              get: async () => ({
                docs: documents.filter(({ data }) => filters.every(([field, value]) => data()[field] === value)),
              }),
            };
            return query;
          },
        }),
      };
    },
  };
  const context = await loadTrustedEduAiContext(db, "Teacher", {
    teacherAssignments: [{ schoolYear: "2026-2027", gradeLevel: "Grade 6", section: "A" }],
  });
  assert.equal(context.summary.totalLearners, 1);
  assert.deepEqual(context.learnerNames, ["Assigned Learner"]);
  assert.deepEqual(context.graphs[0].points, [{ label: "Grade 6", count: 1 }]);
});

test("keeps admin-console product guidance out of teacher answers", async () => {
  const { buildEduAiProductGuide } = await import('./eduai-guide.mjs');
  const teacherGuide = buildEduAiProductGuide("How do I manage users in the admin console?", "Teacher");
  assert.doesNotMatch(teacherGuide, /Manage Users handles account administration/);
  assert.match(buildEduAiProductGuide("How do I manage users in the admin console?", "School Admin"), /Manage Users/);
});

test('builds explicit per-role capabilities and does not assume unverified teacher permissions', () => {
  const teacher = buildEduAiApplicationAccess('Teacher', {
    email: 'PRIVATE-EMAIL', password: 'PRIVATE-PASSWORD',
    teacherAssignments: [{ schoolYear: '2026-2027', gradeLevel: '6', section: 'A', teacherUid: 'PRIVATE-UID' }],
  }, '2026-2027');
  assert.equal(teacher.capabilities.progression, null);
  assert.equal(teacher.capabilities.tenantBackupRestore, false);
  assert.equal(teacher.schoolSettings.status, 'unavailable');
  assert.deepEqual(teacher.assignedClasses, [{ gradeLevel: 'Grade 6', section: 'A' }]);
  assert.doesNotMatch(JSON.stringify(teacher), /PRIVATE-/);
  assert.equal(buildEduAiApplicationAccess('Registrar', {}, '2026-2027', {}).capabilities.trash, false);
  assert.equal(buildEduAiApplicationAccess('School Admin', {}, '2026-2027', {}).capabilities.studentImport, true);
  assert.throws(() => buildEduAiApplicationAccess('Visitor', {}, '2026-2027', {}), /not allowed/);
});

test('uses only allowlisted school settings, with defaults only when the document was read', () => {
  const empty = buildEduAiApplicationAccess('Teacher', {}, '2026-2027', {});
  assert.equal(empty.capabilities.progression, false);
  assert.equal(empty.schoolSettings.parentPortalEnabled, true);
  const configured = buildEduAiApplicationAccess('Teacher', {}, '2026-2027', {
    canPromoteStudents: true, canParentAccess: false, trashConfg: 'never', roundType: 'none', providerKey: 'PRIVATE-KEY',
  });
  assert.equal(configured.capabilities.progression, true);
  assert.equal(configured.schoolSettings.parentPortalEnabled, false);
  assert.equal(configured.schoolSettings.trashRetention, 'never');
  assert.equal(configured.schoolSettings.finalGradeRounding, 'none');
  assert.doesNotMatch(JSON.stringify(configured), /PRIVATE-KEY/);
  assert.equal(buildEduAiApplicationAccess('Teacher', {}, '', { canPromoteStudents: 'true' }).capabilities.progression, null);
});

test('system prompts always include the verified role policy and keep names and private payloads bounded', () => {
  const context = buildEduAiContext('Teacher', '2026-2027', [{ name: 'Allowed learner', gradeLevel: 'Grade 6', section: 'A' }]);
  context.applicationAccess = buildEduAiApplicationAccess('Teacher', {}, '2026-2027', { canPromoteStudents: false });
  context.credentials = 'PRIVATE-CREDENTIAL';
  context.rawLearners = [{ guardian: 'PRIVATE-GUARDIAN' }];
  const instruction = buildSystemInstruction(context, 'Masterlist: documented help.', 0);
  assert.match(instruction, /active Teacher/);
  assert.match(instruction, /applicationAccess capabilities take precedence/);
  assert.match(instruction, /false is disabled and null is unknown/);
  assert.match(instruction, /"learnerNamesIncluded":0/);
  assert.match(instruction, /"learnerNamesTruncated":true/);
  assert.doesNotMatch(instruction, /Allowed learner|PRIVATE-/);
  assert.match(buildSystemInstruction({ ...context, role: 'Registrar' }, '', 0), /active Registrar/);
  assert.match(buildSystemInstruction({ ...context, role: 'School Admin' }, '', 0), /active School Admin/);
  assert.throws(() => buildSystemInstruction({ ...context, role: 'Parent' }, '', 0), /not allowed/);
});

test('worker rebuilds teacher capabilities and data scope using signed-in Firestore reads', async () => {
  const { buildTrustedContext } = await import('../worker/index.mjs');
  const originalFetch = global.fetch;
  const wireValue = value => typeof value === 'boolean' ? { booleanValue: value }
    : Array.isArray(value) ? { arrayValue: { values: value.map(wireValue) } }
      : value && typeof value === 'object' ? { mapValue: { fields: Object.fromEntries(Object.entries(value).map(([key, item]) => [key, wireValue(item)])) } }
        : { stringValue: String(value) };
  const document = (path, data) => ({ name: `projects/test-school/databases/(default)/documents/${path}`, fields: Object.fromEntries(Object.entries(data).map(([key, value]) => [key, wireValue(value)])) });
  const reads = [];
  global.fetch = async (url, options) => {
    assert.equal(options.headers.Authorization, 'Bearer trusted-token');
    const path = new URL(url).pathname.split('/documents/')[1];
    reads.push(path);
    let payload;
    if (path === 'users/teacher-1') payload = document(path, { status: 'Active', role: 'Teacher', teacherAssignments: [{ schoolYear: '2026-2027', gradeLevel: 'Grade 6', section: 'A' }] });
    else if (path === 'settings/currentSchoolYear') payload = document(path, { value: '2026-2027' });
    else if (path === 'settings/toggles') payload = document(path, { canPromoteStudents: false, canParentAccess: true });
    else if (path === 'schoolYears/2026-2027:runQuery') payload = [
      { document: document('schoolYears/2026-2027/learners/one', { name: 'Assigned learner', gradeLevel: 'Grade 6', section: 'A' }) },
      { document: document('schoolYears/2026-2027/learners/two', { name: 'Other class learner', gradeLevel: 'Grade 6', section: 'B' }) },
    ];
    else throw new Error(`Unexpected read ${path}`);
    return new Response(JSON.stringify(payload), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  try {
    const { context } = await buildTrustedContext({ uid: 'teacher-1', token: 'trusted-token', projectId: 'test-school', tenantConfig: { apiKey: 'public-test-key' } });
    assert.equal(context.role, 'Teacher');
    assert.equal(context.summary.totalLearners, 1);
    assert.deepEqual(context.learnerNames, ['Assigned learner']);
    assert.equal(context.applicationAccess.capabilities.progression, false);
    assert.equal(context.applicationAccess.capabilities.adminConsole, false);
    assert.deepEqual(context.applicationAccess.assignedClasses, [{ gradeLevel: 'Grade 6', section: 'A' }]);
    assert.ok(reads.includes('settings/toggles'));
  } finally { global.fetch = originalFetch; }
});
