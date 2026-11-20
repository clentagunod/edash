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
      developer: { role: "Developer", status: "Active" },
      inactiveDeveloper: { role: "Developer", status: "Inactive" },
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

  const imported = { ...learner, __studentImportId: "fixture-import" };
  for (const toggle of [undefined, false, "true"]) {
    it(`denies tagged Teacher imports with canTeacherImport ${toggle ?? "missing"}`, async () => {
      if (toggle !== undefined) await seed("settings/toggles", { canTeacherImport: toggle });
      denied(await create(imported));
    });
  }

  it("allows tagged Teacher import only into an assigned section when enabled", async () => {
    await seed("settings/toggles", { canTeacherImport: true });
    allowed(await create(imported));
    denied(await create({ ...imported, learnerId: "123456789013" }, token("otherTeacher")));
  });

  it("denies tagged imports by Registrar, inactive Teacher, Visitor and anonymous sessions", async () => {
    await seed("settings/toggles", { canTeacherImport: true });
    for (const uid of ["registrar", "inactiveTeacher", "visitor"]) denied(await create(imported, token(uid)));
    denied(await create(imported, token("parent", "anonymous")));
  });

  it("keeps administrator imports available with the Teacher toggle disabled", async () => {
    await seed("settings/toggles", { canTeacherImport: false });
    allowed(await create(imported, token("admin")));
  });

  for (const collection of ["dropouts", "transferredOut"]) {
    it(`denies Teacher import over an LRN archived in ${collection}`, async () => {
      await seed("settings/toggles", { canTeacherImport: true });
      await seed(`schoolYears/${year}/${collection}/${learnerId}`, learner);
      denied(await create(imported));
    });
  }

  for (const metadata of [{ __trashRestoreId: "fabricated" }, progression, { transferOut: true }, { schoolYear: sourceYear }, { __studentImportId: null }]) {
    it(`denies invalid tagged Teacher import metadata ${JSON.stringify(metadata)}`, async () => {
      await seed("settings/toggles", { canTeacherImport: true, canPromoteStudents: true });
      await seedSource();
      denied(await create({ ...imported, ...metadata }));
    });
  }

  const updateImport = (data, uid = "teacher") => request(`${documents}/${targetPath}?currentDocument.exists=true`, {
    method: "PATCH", auth: token(uid), body: { fields: fields(data) },
  });

  for (const toggle of [undefined, false, 'true']) {
    it(`denies SF2 Teacher imports when attendance access is ${toggle ?? 'missing'}`, async () => {
      await seed(targetPath, learner);
      if (toggle !== undefined) await seed('settings/toggles', { canTeacherImportAttendance: toggle });
      denied(await updateImport({ ...learner, attendance: { daysPresent: { Oct: '20' }, daysAbsent: { Oct: '2' }, classDays: { Oct: '22' } }, __attendanceImportId: 'sf2-import' }));
    });
  }

  it('allows enabled SF2 imports only into the assigned section and only for attendance fields', async () => {
    await seed(targetPath, learner);
    await seed('settings/toggles', { canTeacherImportAttendance: true, canTeacherEditProfiles: false });
    const imported = { ...learner, attendance: { daysPresent: { Oct: '20' }, daysAbsent: { Oct: '2' }, classDays: { Oct: '22' } }, __attendanceImportId: 'sf2-import' };
    denied(await updateImport(imported, 'otherTeacher'));
    denied(await updateImport({ ...imported, firstName: 'Changed' }));
    allowed(await updateImport(imported));
    await seed('settings/toggles', { canTeacherImportAttendance: false });
    denied(await updateImport({ ...imported, __attendanceImportId: 'next-sf2-import' }));
    allowed(await updateImport({ ...imported, firstName: 'Manual edit' }));
  });

  for (const uid of ['admin', 'registrar', 'developer']) {
    it(`allows ${uid} SF2 attendance imports independently of the teacher toggle`, async () => {
      await seed(targetPath, learner);
      await seed('settings/toggles', { canTeacherImportAttendance: false });
      allowed(await updateImport({ ...learner, attendance: { daysPresent: { Oct: '20' }, daysAbsent: { Oct: '2' }, classDays: { Oct: '22' } }, __attendanceImportId: 'sf2-import' }, uid));
    });
  }

  for (const toggle of [undefined, true]) {
    it(`allows assigned teacher profile updates with setting ${toggle ?? "missing (on by default)"}`, async () => {
      await seed(targetPath, learner);
      if (toggle !== undefined) await seed("settings/toggles", { canTeacherEditProfiles: toggle });
      allowed(await updateImport({ ...learner, bosyCRLA: "Developing", gradesByTerm: { term1: { math: 85 } } }));
    });
  }

  for (const profilePatch of [
    { bosyCRLA: "Developing" }, { mosyPhilIRI: "Instructional" }, { eosyRMA: "Developing" },
    { gradesByTerm: { term1: { math: 85 } } }, { math: 85 }, { subjectRobotics: 90 },
    { extra: { subjectRobotics: 90 } },
  ]) {
    it(`denies teacher updates to ${Object.keys(profilePatch)[0]} while profile editing is off`, async () => {
      await seed(targetPath, learner);
      await seed("settings/toggles", { canTeacherEditProfiles: false });
      denied(await updateImport({ ...learner, ...profilePatch }));
    });
  }

  it("denies profile updates and mixed placement changes outside teacher assignments", async () => {
    await seed(targetPath, learner);
    await seed("settings/toggles", { canTeacherEditProfiles: true });
    denied(await updateImport({ ...learner, bosyRMA: "Developing" }, "otherTeacher"));
    denied(await updateImport({ ...learner, section: "B", bosyRMA: "Developing" }));
  });

  it("preserves demographic editing while teacher profile editing is off", async () => {
    await seed(targetPath, learner);
    await seed("settings/toggles", { canTeacherEditProfiles: false });
    allowed(await updateImport({ ...learner, firstName: "Changed" }));
  });

  for (const uid of ["admin", "developer", "registrar"]) {
    it(`preserves ${uid} profile editing when the teacher switch is off`, async () => {
      await seed(targetPath, learner);
      await seed("settings/toggles", { canTeacherEditProfiles: false });
      allowed(await updateImport({ ...learner, bosyRMA: "Developing" }, uid));
    });
  }

  it("only permits administrators to change teacher profile editing access", async () => {
    await seed("settings/toggles", { canTeacherEditProfiles: true });
    const save = (uid) => request(`${documents}/settings/toggles`, {
      method: "PATCH", auth: token(uid), body: { fields: fields({ canTeacherEditProfiles: false }) },
    });
    denied(await save("teacher"));
    denied(await save("registrar"));
    allowed(await save("admin"));
  });

  it("rechecks enabled Teacher imports on update and denies removal of the import marker", async () => {
    await seed(targetPath, imported);
    await seed("settings/toggles", { canTeacherImport: false });
    denied(await updateImport({ ...imported, __studentImportId: "another-import", firstName: "Changed" }));
    denied(await updateImport(learner));
    // Existing manual edit permissions remain intact when the marker is unchanged.
    allowed(await updateImport({ ...imported, firstName: "Manual edit" }));
    await seed("settings/toggles", { canTeacherImport: true });
    allowed(await updateImport({ ...imported, __studentImportId: "another-import", firstName: "Imported edit" }));
  });

  it("denies importing an existing learner from an unassigned section into an assigned section", async () => {
    await seed(targetPath, { ...learner, gradeLevel: "Grade 3", section: "B" });
    await seed("settings/toggles", { canTeacherImport: true });
    denied(await updateImport(imported));
  });

  it("preserves existing progression metadata during import but cannot add or change it", async () => {
    await seed(targetPath, { ...learner, ...progression });
    await seed("settings/toggles", { canTeacherImport: true });
    allowed(await updateImport({ ...imported, ...progression }));
    denied(await updateImport({ ...imported, ...progression, progressionType: "retention", __studentImportId: "changed" }));
  });

  it("fits a five-record Teacher import within the transaction security-rule lookup budget", async () => {
    await seed("settings/toggles", { canTeacherImport: true });
    const writes = Array.from({ length: 5 }, (_, index) => {
      const id = String(Number(learnerId) + index);
      return { update: {
        name: `projects/${projectId}/databases/(default)/documents/schoolYears/${year}/learners/${id}`,
        fields: fields({ ...imported, learnerId: id }),
      }, currentDocument: { exists: false } };
    });
    allowed(await request(`${documents}:commit`, { method: "POST", auth: token("teacher"), body: { writes } }));
  });

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

  for (const uid of ["admin", "registrar", "developer"]) {
    it(`preserves ${uid} learner creation even when Teacher promotion is disabled`, async () => {
      await seed("settings/toggles", { canPromoteStudents: false });
      allowed(await create({ ...learner, ...progression }, token(uid)));
    });
  }

  it("grants active Developer administrator access but denies inactive Developer", async () => {
    allowed(await request(`${documents}/schoolYears/${year}`, {
      method: "PATCH", auth: token("developer"), body: { fields: fields({ schoolYear: year, isCurrent: true }) },
    }));
    denied(await create(learner, token("inactiveDeveloper")));
    allowed(await request(`${documents}/users/new-teacher`, {
      method: "PATCH", auth: token("developer"), body: { fields: fields({ role: "Teacher", status: "Active" }) },
    }));
  });

  for (const caller of ["admin", "developer", "teacher"]) {
    it(`blocks ${caller} from assigning, demoting, or deleting Developer profiles`, async () => {
      for (const uid of ["new-developer", "teacher"]) {
        denied(await request(`${documents}/users/${uid}`, {
          method: "PATCH", auth: token(caller), body: { fields: fields({ role: "Developer", status: "Active" }) },
        }));
      }
      denied(await request(`${documents}/users/developer`, {
        method: "PATCH", auth: token(caller), body: { fields: fields({ role: "School Admin", status: "Active" }) },
      }));
      denied(await request(`${documents}/users/developer`, { method: "DELETE", auth: token(caller) }));
    });
  }

  it("allows Developer to update their own name while preserving the manual role", async () => {
    allowed(await request(`${documents}/users/developer`, {
      method: "PATCH", auth: token("developer"),
      body: { fields: fields({ role: "Developer", status: "Active", name: "Updated name" }) },
    }));
  });

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

  it("preserves a verified Trash restore of an imported learner when Teacher imports are disabled", async () => {
    const trashId = "imported-trash";
    const original = { ...learner, __studentImportId: "old-import" };
    await seed("settings/toggles", { canTeacherImport: false });
    await seed(`schoolYears/${year}/trash/${trashId}`, {
      learnerId, sourceCollection: "learners", learner: original,
      teacherAssignmentSecurityKey: `${year}::${learner.gradeLevel}::${learner.section}`,
    });
    allowed(await create({ ...original, __trashRestoreId: trashId }));
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
