import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { before, beforeEach, describe, it } from "node:test";

// Only synthetic data in a local demo project is ever read or written here.
const projectId = "demo-edash-rules";
const host = process.env.FIRESTORE_EMULATOR_HOST || "";
const hostMatch = /^(?:127\.0\.0\.1|localhost|\[::1\]):(\d+)$/.exec(host);
assert.ok(hostMatch && Number(hostMatch[1]) > 0 && Number(hostMatch[1]) <= 65535,
  "FIRESTORE_EMULATOR_HOST must identify a running loopback emulator (for example 127.0.0.1:8080).");
const origin = `http://${host}`;
const documents = `/v1/projects/${projectId}/databases/(default)/documents`;
const year = "2026-2027";
const sourceYear = "2025-2026";
const learnerId = "123456789012";
const targetPath = `schoolYears/${year}/learners/${learnerId}`;
const sourcePath = `schoolYears/${sourceYear}/learners/${learnerId}`;
const learner = {
  learnerId, schoolYear: year, firstName: "Sample", lastName: "Learner",
  gradeLevel: "Grade 2", section: "A", enrollmentStatus: "ACTIVE", eosyStatus: "",
};
const progression = { progressionSourceSchoolYear: sourceYear, progressionType: "promotion" };

function token(uid, provider = "password") {
  const now = Math.floor(Date.now() / 1000);
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${encode({ alg: "none", typ: "JWT" })}.${encode({
    iss: `https://securetoken.google.com/${projectId}`, aud: projectId,
    sub: uid, user_id: uid, iat: now, exp: now + 3600, auth_time: now,
    firebase: { sign_in_provider: provider, identities: {} },
  })}.`;
}

function value(data) {
  if (data === null) return { nullValue: null };
  if (typeof data === "string") return { stringValue: data };
  if (typeof data === "boolean") return { booleanValue: data };
  if (typeof data === "number") return { integerValue: String(data) };
  if (Array.isArray(data)) return { arrayValue: { values: data.map(value) } };
  return { mapValue: { fields: fields(data) } };
}

function fields(data) {
  return Object.fromEntries(Object.entries(data).map(([key, entry]) => [key, value(entry)]));
}

async function request(path, { method = "GET", body, auth } = {}) {
  const response = await fetch(`${origin}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(auth ? { Authorization: `Bearer ${auth}` } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(15000),
  });
  return { status: response.status, text: await response.text() };
}

function allowed(response) {
  assert.equal(response.status, 200, response.text);
}

function denied(response) {
  assert.equal(response.status, 403, response.text);
  assert.equal(JSON.parse(response.text).error.status, "PERMISSION_DENIED");
}

async function seed(path, data) {
  // The emulator-only owner token is confined to fixture writes.
  allowed(await request(`${documents}/${path}`, {
    method: "PATCH", body: { fields: fields(data) }, auth: "owner",
  }));
}

function create(data = learner, auth = token("teacher")) {
  return request(`${documents}/${targetPath}?currentDocument.exists=false`, {
    method: "PATCH", body: { fields: fields(data) }, auth,
  });
}

async function seedSource(eosyStatus = "Promoted", gradeLevel = "Grade 1") {
  await seed(sourcePath, { ...learner, schoolYear: sourceYear, eosyStatus, gradeLevel });
}

it("keeps the provisioner rules and their integrity hash synchronized", async () => {
  const rootRules = await readFile(new URL("../firestore.rules", import.meta.url));
  const packagedRules = await readFile(new URL("../src/edash_provision/assets/firestore.rules", import.meta.url));
  const provenance = JSON.parse(await readFile(new URL("../src/edash_provision/assets/provenance.json", import.meta.url), "utf8"));
  assert.deepEqual(packagedRules, rootRules);
  assert.equal(provenance.sha256["firestore.rules"], createHash("sha256").update(packagedRules).digest("hex"));
});

describe("tenant learner creation rules", { timeout: 30000 }, () => {
  before(async () => {
    const content = await readFile(new URL("../firestore.rules", import.meta.url), "utf8");
    allowed(await request(`/emulator/v1/projects/${projectId}:securityRules`, {
      method: "PUT", body: { rules: { files: [{ content }] } },
    }));
  });

  beforeEach(async () => {
    allowed(await request(`/emulator/v1/projects/${projectId}/databases/(default)/documents`, { method: "DELETE" }));
    const profiles = {
      teacher: { role: "Teacher", status: "Active", teacherAssignmentSecurityKeys: [`${year}::Grade 2::A`] },
      otherTeacher: { role: "Teacher", status: "Active", teacherAssignmentSecurityKeys: [`${year}::Grade 3::B`] },
      inactiveTeacher: { role: "Teacher", status: "Inactive" },
      visitor: { role: "Visitor", status: "Active" },
      admin: { role: "School Admin", status: "Active" },
      registrar: { role: "Registrar", status: "Active" },
    };
    await Promise.all(Object.entries(profiles).map(([uid, profile]) => seed(`users/${uid}`, profile)));
  });

  for (const toggle of [undefined, false, true]) {
    for (const metadata of [{}, { progressionSourceSchoolYear: "", progressionType: "" }]) {
      it(`allows Teacher to add a learner with ${Object.keys(metadata).length ? "blank" : "absent"} progression fields and promotion toggle ${toggle ?? "missing"}`, async () => {
        if (toggle !== undefined) await seed("settings/toggles", { canPromoteStudents: toggle });
        allowed(await create({ ...learner, ...metadata }));
      });
    }
  }

  const invalidMetadata = [
    ["type without a source", { progressionType: "promotion" }],
    ["type with a blank source", { progressionSourceSchoolYear: "", progressionType: "promotion" }],
    ["source without a type", { progressionSourceSchoolYear: sourceYear }],
    ["source with a blank type", { progressionSourceSchoolYear: sourceYear, progressionType: "" }],
    ["invalid type", { ...progression, progressionType: "other" }],
    ["invalid year format", { ...progression, progressionSourceSchoolYear: "2025/2026" }],
    ["numeric source", { ...progression, progressionSourceSchoolYear: 2025 }],
    ["null source", { progressionSourceSchoolYear: null, progressionType: "" }],
    ["map source", { progressionSourceSchoolYear: {}, progressionType: "" }],
    ["null type", { progressionSourceSchoolYear: "", progressionType: null }],
    ["whitespace source", { progressionSourceSchoolYear: " ", progressionType: "" }],
  ];
  for (const [label, metadata] of invalidMetadata) {
    it(`denies Teacher progression metadata containing ${label}`, async () => {
      await seed("settings/toggles", { canPromoteStudents: true });
      await seedSource();
      denied(await create({ ...learner, ...metadata }));
    });
  }

  for (const toggle of [undefined, false]) {
    it(`denies Teacher promotion when the toggle is ${toggle ?? "missing"}`, async () => {
      if (toggle !== undefined) await seed("settings/toggles", { canPromoteStudents: toggle });
      await seedSource();
      denied(await create({ ...learner, ...progression }));
    });
  }

  it("allows Teacher promotion from a promoted source when enabled", async () => {
    await seed("settings/toggles", { canPromoteStudents: true });
    await seedSource();
    allowed(await create({ ...learner, ...progression }));
  });

  it("denies Teacher promotion from a nonexistent learner", async () => {
    await seed("settings/toggles", { canPromoteStudents: true });
    denied(await create({ ...learner, ...progression }));
  });

  for (const status of ["", "Retained"]) {
    it(`denies Teacher promotion from source status '${status}'`, async () => {
      await seed("settings/toggles", { canPromoteStudents: true });
      await seedSource(status);
      denied(await create({ ...learner, ...progression }));
    });
  }

  it("allows Teacher retention in the source grade when enabled", async () => {
    await seed("settings/toggles", { canPromoteStudents: true });
    await seedSource("Retained", learner.gradeLevel);
    allowed(await create({ ...learner, ...progression, progressionType: "retention" }));
  });

  it("denies Teacher retention into a different grade", async () => {
    await seed("settings/toggles", { canPromoteStudents: true });
    await seedSource("Retained", "Grade 1");
    denied(await create({ ...learner, ...progression, progressionType: "retention" }));
  });

  it("denies Teacher retention from a promoted source", async () => {
    await seed("settings/toggles", { canPromoteStudents: true });
    await seedSource("Promoted", learner.gradeLevel);
    denied(await create({ ...learner, ...progression, progressionType: "retention" }));
  });

  for (const uid of ["inactiveTeacher", "missingProfile", "visitor"]) {
    it(`denies ordinary creation by ${uid}`, async () => {
      denied(await create(learner, token(uid)));
    });
  }

  it("denies ordinary creation by an anonymous parent session", async () => {
    denied(await create(learner, token("parent", "anonymous")));
  });

  it("denies ordinary creation without authentication", async () => {
    denied(await create(learner, null));
  });

  for (const uid of ["admin", "registrar"]) {
    it(`preserves ${uid} learner creation even when Teacher promotion is disabled`, async () => {
      await seed("settings/toggles", { canPromoteStudents: false });
      allowed(await create({ ...learner, ...progression }, token(uid)));
    });
  }

  async function restore({ uid = "teacher", change = {}, includeTrash = true } = {}) {
    const trashId = "fixture-trash";
    const original = { ...learner, ...progression };
    await seed("settings/toggles", { canPromoteStudents: false });
    if (includeTrash) await seed(`schoolYears/${year}/trash/${trashId}`, {
      learnerId, sourceCollection: "learners", learner: original,
      teacherAssignmentSecurityKey: `${year}::${learner.gradeLevel}::${learner.section}`,
    });
    // Match the application's atomic learner-create + Trash-delete restore.
    return request(`${documents}:commit`, {
      method: "POST", auth: token(uid), body: { writes: [
        { update: {
          name: `projects/${projectId}/databases/(default)/documents/${targetPath}`,
          fields: fields({ ...original, __trashRestoreId: trashId, ...change }),
        }, currentDocument: { exists: false } },
        { delete: `projects/${projectId}/databases/(default)/documents/schoolYears/${year}/trash/${trashId}` },
      ] },
    });
  }

  it("preserves assigned Teacher restore of an existing progression record while promotion is disabled", async () => {
    allowed(await restore());
  });

  it("denies progression-record restore outside the Teacher assignment", async () => {
    denied(await restore({ uid: "otherTeacher" }));
  });

  it("denies progression-record restore with altered learner data", async () => {
    denied(await restore({ change: { firstName: "Changed" } }));
  });

  it("denies a fabricated restore marker without a matching Trash item", async () => {
    denied(await restore({ includeTrash: false }));
  });
});
