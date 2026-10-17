import { applicationDefault, cert, getApps, initializeApp } from "firebase-admin/app";
import { FieldValue, getFirestore } from "firebase-admin/firestore";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

function option(name, fallback = "") {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? String(process.argv[index + 1] || "").trim() : fallback;
}

function hasFlag(name) {
  return process.argv.includes(`--${name}`);
}

function usage() {
  console.log(`Usage:
  npm run firestore:provision -- --project <firebase-project-id> [options]

Options:
  --school-year <YYYY-YYYY>  Seed a school year document
  --admin-uid <uid>          Seed users/{uid} as School Admin
  --admin-email <email>      Email for the seeded admin profile
  --admin-name <name>        Name for the seeded admin profile
  --migrate-v2-schema        Copy legacy collections to the year-scoped schema without deleting sources
  --migrate-sections          Move the legacy sections collection into schoolYears/{schoolYear}/grades/{grade}/sections/{section}/teachers/{uid}
  --delete-legacy-sections    Delete the legacy lowercase sections documents after migration
  --migrate-teacher-assignments  Normalize teacherAssignments + teacherAssignment to the canonical multi-section shape
  --service-account <path>   Service-account JSON path; otherwise ADC is used
  --make-current             Mark the supplied school year as current
  --deploy-rules             Deploy firestore.rules through the Firebase CLI
  --dry-run                  Print planned writes without changing Firestore
`);
}

function normalizeSchoolYear(value) {
  const match = String(value || "").trim().match(/^(\d{4})[-/]?(\d{4})$/);
  return match ? `${match[1]}-${match[2]}` : "";
}

function normalizeValue(value) {
  return String(value || "").trim().toLowerCase().replace(/\s+/g, " ");
}

function normalizeKey(value, fallback = "unassigned") {
  const key = normalizeValue(value).replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return key || fallback;
}

function normalizeGrade(value) {
  const text = String(value || "").trim();
  const key = text.toLowerCase().replace(/\s+/g, " ");
  if (["kinder", "kindergarten", "kg", "0"].includes(key)) return "Kinder";
  const match = key.match(/^grade\s*(\d+)$/) || key.match(/^(\d+)$/);
  return match ? `Grade ${match[1]}` : text;
}

function normalizeTeacherAssignmentRecord(raw, fallbackName = "") {
  if (!raw || typeof raw !== "object") return null;
  const schoolYear = normalizeSchoolYear(raw.schoolYear || raw.year || "");
  const gradeLevel = normalizeGrade(raw.gradeLevel || raw.gradeKey || raw.grade || "");
  const section = String(raw.section || raw.sectionKey || raw.sectionName || "").trim();
  const teacherName = String(raw.teacherName || raw.adviser || fallbackName || "").trim();
  if (!schoolYear || !gradeLevel || !section) return null;
  return { schoolYear, gradeLevel, section, ...(teacherName ? { teacherName } : {}) };
}

function normalizeTeacherAssignments(rawAssignments, legacyAssignment = null, fallbackName = "") {
  const combined = [];
  const list = Array.isArray(rawAssignments) ? rawAssignments : rawAssignments ? [rawAssignments] : [];
  list.forEach((entry) => combined.push(normalizeTeacherAssignmentRecord(entry, fallbackName)));
  if (legacyAssignment) combined.push(normalizeTeacherAssignmentRecord(legacyAssignment, fallbackName));
  const deduped = new Map();
  combined.filter(Boolean).forEach((assignment) => {
    const key = `${assignment.schoolYear}|${normalizeValue(assignment.gradeLevel)}|${normalizeValue(assignment.section)}`;
    if (!deduped.has(key)) deduped.set(key, assignment);
  });
  return [...deduped.values()];
}

function structuredSectionsCollection(db, schoolYear, gradeLevel) {
  return db.collection("schoolYears").doc(schoolYear).collection("grades").doc(normalizeKey(gradeLevel));
}

async function readStructuredSections(db, schoolYear) {
  const grades = await db.collection("schoolYears").doc(schoolYear).collection("grades").get();
  const sections = [];
  for (const gradeDoc of grades.docs) {
    const sectionDocs = await gradeDoc.ref.collection("sections").get();
    for (const sectionDoc of sectionDocs.docs) {
      const teacherDocs = await sectionDoc.ref.collection("teachers").get();
      const data = sectionDoc.data() || {};
      const teacher = teacherDocs.docs[0]?.data() || {};
      sections.push({
        id: `${gradeDoc.id}/${sectionDoc.id}`,
        ...data,
        gradeLevel: data.gradeLevel || gradeDoc.data()?.gradeLevel || "",
        adviser: teacher.teacherName || teacher.name || data.adviser || "",
      });
    }
  }
  return sections;
}

function isActiveLearner(learner) {
  const enrollmentStatus = String(learner?.enrollmentStatus || "ACTIVE").toUpperCase().replace(/[ -]+/g, "_");
  const eosyStatus = String(learner?.eosyStatus || "").toLowerCase().replace(/[_-]+/g, " ");
  return enrollmentStatus !== "TRANSFERRED_OUT" && enrollmentStatus !== "DROPPED_OUT" && eosyStatus !== "dropped out" && !learner?.transferOut;
}

async function refreshPublicStats(db, schoolYear) {
  const years = (await db.collection("schoolYears").get()).docs.map((doc) => ({ schoolYear: doc.id, ...doc.data() }));
  const current = years.find((year) => year.isCurrent) || years.find((year) => year.schoolYear === schoolYear) || years[0];
  if (!current) return;
  const learnerSnapshot = await db.collection("schoolYears").doc(current.schoolYear).collection("learners").get();
  const learners = learnerSnapshot.docs.map((doc) => ({ learnerId: doc.id, ...doc.data() })).filter(isActiveLearner);
  const sections = await readStructuredSections(db, current.schoolYear);
  const rows = sections.map((section) => ({ ...section, male: 0, female: 0, total: 0 }));
  learners.forEach((learner) => {
    const row = rows.find((item) => normalizeValue(item.gradeLevel) === normalizeValue(learner.gradeLevel) && normalizeValue(item.section) === normalizeValue(learner.section));
    if (!row) return;
    row.total += 1;
    if (learner.gender === "Male") row.male += 1;
    if (learner.gender === "Female") row.female += 1;
  });
  const programFields = ["is4Ps", "isIP", "isSNED", "isARAL", "isMuslim"];
  const taggedCount = learners.filter((learner) => programFields.some((field) => learner[field])).length;
  const gradeLevels = {};
  learners.forEach((learner) => { const grade = learner.gradeLevel || "—"; gradeLevels[grade] = (gradeLevels[grade] || 0) + 1; });
  await db.collection("publicStats").doc("summary").set({
    totalLearners: learners.length,
    programsTracked: programFields.filter((field) => learners.some((learner) => learner[field])).length,
    fourPsCount: learners.filter((learner) => learner.is4Ps).length,
    ipCount: learners.filter((learner) => learner.isIP).length,
    snedCount: learners.filter((learner) => learner.isSNED).length,
    aralCount: learners.filter((learner) => learner.isARAL).length,
    muslimCount: learners.filter((learner) => learner.isMuslim).length,
    maleCount: learners.filter((learner) => learner.gender === "Male").length,
    femaleCount: learners.filter((learner) => learner.gender === "Female").length,
    notTaggedCount: learners.length - taggedCount,
    gradeLevels: Object.entries(gradeLevels).map(([label, value]) => ({ label, value })),
    recentLearners: [],
    enrollmentData: {
      schoolYear: current.schoolYear,
      rows,
      gradeTotals: [],
      grandTotal: { male: rows.reduce((sum, row) => sum + row.male, 0), female: rows.reduce((sum, row) => sum + row.female, 0), total: rows.reduce((sum, row) => sum + row.total, 0) },
    },
    schoolYear: current.schoolYear,
    syncStatus: "Live",
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });
}

async function migrateLegacySections(db, deleteLegacy) {
  const legacySnapshot = await db.collection("sections").get();
  const records = new Map();
  legacySnapshot.docs.forEach((doc) => {
    const data = doc.data() || {};
    const schoolYear = normalizeSchoolYear(data.schoolYear);
    const gradeLevel = normalizeGrade(data.gradeLevel);
    const section = String(data.section || "").trim();
    const adviser = String(data.adviser || data.teacher || "").trim();
    if (!schoolYear || !gradeLevel || !section || !adviser) return;
    records.set(`${schoolYear}|${normalizeValue(gradeLevel)}|${normalizeValue(section)}|${normalizeValue(adviser)}`, { schoolYear, gradeLevel, section, adviser });
  });
  const operations = [];
  const users = await db.collection("users").get();
  const teacherUidByName = new Map(users.docs
    .filter((doc) => doc.data()?.role === "Teacher")
    .map((doc) => [normalizeValue(doc.data()?.name), doc.id]));
  records.forEach((record) => {
    const gradeRef = structuredSectionsCollection(db, record.schoolYear, record.gradeLevel);
    const sectionRef = gradeRef.collection("sections").doc(normalizeKey(record.section));
    const teacherUid = teacherUidByName.get(normalizeValue(record.adviser));
    operations.push((batch) => batch.set(db.collection("schoolYears").doc(record.schoolYear), {
      schoolYear: record.schoolYear,
      structureVersion: 3,
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true }));
    operations.push((batch) => batch.set(gradeRef, {
      gradeLevel: record.gradeLevel,
      schoolYear: record.schoolYear,
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true }));
    operations.push((batch) => batch.set(sectionRef, {
      section: record.section,
      adviser: record.adviser,
      gradeLevel: record.gradeLevel,
      schoolYear: record.schoolYear,
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true }));
    if (teacherUid) {
      const teacherRef = sectionRef.collection("teachers").doc(teacherUid);
      operations.push((batch) => batch.set(teacherRef, {
        teacherUid,
        teacherName: record.adviser,
        section: record.section,
        gradeLevel: record.gradeLevel,
        schoolYear: record.schoolYear,
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true }));
    }
  });
  await commitOperations(db, operations);
  if (deleteLegacy) {
    const deleteOperations = legacySnapshot.docs.map((doc) => (batch) => batch.delete(doc.ref));
    await commitOperations(db, deleteOperations);
  }
  return { legacy: legacySnapshot.size, migrated: records.size, deleted: deleteLegacy ? legacySnapshot.size : 0 };
}

async function migrateV2Schema(db) {
  const years = await db.collection("schoolYears").get();
  const users = await db.collection("users").get();
  const teacherUidByName = new Map(users.docs
    .filter((doc) => doc.data()?.role === "Teacher")
    .map((doc) => [normalizeValue(doc.data()?.name), doc.id]));
  const operations = [];
  const teacherWrites = new Map();
  const counts = { learners: 0, dropouts: 0, transferredOut: 0, grades: 0, sections: 0, teachers: 0 };
  function queueTeacherWrite(ref, data) {
    const queued = teacherWrites.get(ref.path);
    teacherWrites.set(ref.path, { ref, data: { ...(queued?.data || {}), ...data } });
  }

  async function copyMissing(sourceRef, targetRef, counter) {
    const [source, target] = await Promise.all([sourceRef.get(), targetRef.get()]);
    if (!source.exists || target.exists) return;
    const data = source.data() || {};
    operations.push((batch) => batch.create(targetRef, data));
    if (counter) counts[counter] += 1;
  }

  for (const yearDoc of years.docs) {
    const year = yearDoc.id;
    const yearRef = db.collection("schoolYears").doc(year);
    for (const collectionName of ["learners", "dropouts", "transferredOut"]) {
      const legacyCollection = collectionName === "learners" ? "Learners"
        : collectionName === "dropouts" ? "Dropouts" : "TransferredOut";
      const records = await db.collection(legacyCollection).doc(year).collection("records").get();
      for (const record of records.docs) {
        await copyMissing(
          record.ref,
          yearRef.collection(collectionName).doc(record.id),
          collectionName,
        );
      }
    }

    const legacyYearRef = db.collection("Sections").doc(year);
    const [legacyGrades, directory] = await Promise.all([
      legacyYearRef.collection("grades").get(),
      legacyYearRef.collection("directory").get(),
    ]);
    const advisersBySection = new Map();
    directory.docs.forEach((directoryDoc) => {
      const data = directoryDoc.data() || {};
      const key = `${normalizeKey(data.gradeLevel)}|${normalizeKey(data.section)}`;
      if (!advisersBySection.has(key)) advisersBySection.set(key, {
        adviser: String(data.adviser || data.teacherName || data.teacher || "").trim(),
        gradeLevel: String(data.gradeLevel || "").trim(),
        section: String(data.section || "").trim(),
      });
    });
    const migratedSectionKeys = new Set();

    for (const gradeDoc of legacyGrades.docs) {
      const gradeRef = yearRef.collection("grades").doc(gradeDoc.id);
      await copyMissing(gradeDoc.ref, gradeRef, "grades");
      const sections = await gradeDoc.ref.collection("sections").get();
      for (const sectionDoc of sections.docs) {
        const sectionData = sectionDoc.data() || {};
        const sectionRef = gradeRef.collection("sections").doc(sectionDoc.id);
        const sectionKey = `${normalizeKey(gradeDoc.data()?.gradeLevel || gradeDoc.id)}|${normalizeKey(sectionData.section || sectionDoc.id)}`;
        migratedSectionKeys.add(sectionKey);
        const directoryRecord = advisersBySection.get(
          `${normalizeKey(sectionData.gradeLevel || gradeDoc.data()?.gradeLevel)}|${normalizeKey(sectionData.section || sectionDoc.id)}`,
        );
        const adviser = String(sectionData.adviser || directoryRecord?.adviser || "").trim();
        const [source, target] = await Promise.all([sectionDoc.get(), sectionRef.get()]);
        if (source.exists && !target.exists) {
          operations.push((batch) => batch.create(sectionRef, { ...source.data(), ...(adviser ? { adviser } : {}) }));
          counts.sections += 1;
        } else if (adviser && !(target.data()?.adviser || "")) {
          operations.push((batch) => batch.set(sectionRef, { adviser }, { merge: true }));
        }

      }
    }

    for (const [key, directoryRecord] of advisersBySection) {
      const adviser = directoryRecord.adviser;
      if (!adviser) continue;
      const [gradeKey, sectionKey] = key.split("|");
      const gradeRef = yearRef.collection("grades").doc(gradeKey);
      const sectionRef = gradeRef.collection("sections").doc(sectionKey);
      if (migratedSectionKeys.has(key)) {
        const teacherUid = teacherUidByName.get(normalizeValue(adviser));
        if (teacherUid) {
          queueTeacherWrite(sectionRef.collection("teachers").doc(teacherUid), {
            teacherUid,
            teacherName: adviser,
            schoolYear: year,
            gradeLevel: directoryRecord.gradeLevel || gradeKey,
            section: directoryRecord.section || sectionKey,
          });
        }
        continue;
      }
      const sectionSnapshot = await sectionRef.get();
      if (!sectionSnapshot.exists) {
        const gradeLevel = directoryRecord.gradeLevel
          || legacyGrades.docs.find((grade) => normalizeKey(grade.data()?.gradeLevel) === gradeKey)?.data()?.gradeLevel
          || gradeKey;
        operations.push((batch) => batch.set(gradeRef, { schoolYear: year, gradeLevel }, { merge: true }));
        operations.push((batch) => batch.create(sectionRef, {
          schoolYear: year,
          gradeLevel,
          section: directoryRecord.section || sectionKey,
          adviser,
        }));
        counts.grades += 1;
        counts.sections += 1;
        migratedSectionKeys.add(key);
      } else if (!(sectionSnapshot.data()?.adviser || "")) {
        operations.push((batch) => batch.set(sectionRef, { adviser }, { merge: true }));
      }
      const teacherUid = teacherUidByName.get(normalizeValue(adviser));
      if (teacherUid) {
        const teacherRef = sectionRef.collection("teachers").doc(teacherUid);
        operations.push((batch) => batch.set(teacherRef, {
          teacherUid,
          teacherName: adviser,
          schoolYear: year,
          gradeLevel: directoryRecord.gradeLevel
            || legacyGrades.docs.find((grade) => normalizeKey(grade.data()?.gradeLevel) === gradeKey)?.data()?.gradeLevel
            || gradeKey,
          section: directoryRecord.section || sectionSnapshot.data()?.section || sectionKey,
        }, { merge: true }));
        counts.teachers += 1;
      }
    }
  }

  for (const userDoc of users.docs) {
    const profile = userDoc.data() || {};
    if (profile.role !== "Teacher") continue;
    const assignments = normalizeTeacherAssignments(profile.teacherAssignments, profile.teacherAssignment, profile.name || "");
    for (const assignment of assignments) {
      const year = assignment.schoolYear;
      const gradeKey = normalizeKey(assignment.gradeLevel);
      const sectionKey = normalizeKey(assignment.section);
      const yearRef = db.collection("schoolYears").doc(year);
      const gradeRef = yearRef.collection("grades").doc(gradeKey);
      const sectionRef = gradeRef.collection("sections").doc(sectionKey);
      operations.push((batch) => batch.set(gradeRef, {
        schoolYear: year,
        gradeLevel: assignment.gradeLevel,
      }, { merge: true }));
      operations.push((batch) => batch.set(sectionRef, {
        schoolYear: year,
        gradeLevel: assignment.gradeLevel,
        section: assignment.section,
      }, { merge: true }));
      const teacherRef = sectionRef.collection("teachers").doc(userDoc.id);
      queueTeacherWrite(teacherRef, {
        teacherUid: userDoc.id,
        teacherName: assignment.teacherName || profile.name || "Teacher",
        schoolYear: year,
        gradeLevel: assignment.gradeLevel,
        section: assignment.section,
        status: profile.status || "Active",
      });
    }
  }

  teacherWrites.forEach(({ ref, data }) => {
    operations.push((batch) => batch.set(ref, data, { merge: true }));
  });
  counts.teachers = teacherWrites.size;
  await commitOperations(db, operations);
  return { ...counts, years: years.size, writes: operations.length };
}

async function commitOperations(db, operations) {
  const chunkSize = 450;
  for (let index = 0; index < operations.length; index += chunkSize) {
    const batch = db.batch();
    operations.slice(index, index + chunkSize).forEach((operation) => operation(batch));
    await batch.commit();
  }
}

async function migrateTeacherAssignmentsRecords(db, dryRun = false) {
  const snapshot = await db.collection("users").get();
  const updates = [];
  snapshot.docs.forEach((doc) => {
    const data = doc.data() || {};
    if (data.role !== "Teacher") return;
    const normalized = normalizeTeacherAssignments(data.teacherAssignments, data.teacherAssignment, data.name || "");
    const next = {
      teacherAssignments: normalized,
      teacherAssignment: normalized[0] || null,
    };
    if (JSON.stringify(data.teacherAssignments || []) === JSON.stringify(normalized) && JSON.stringify(data.teacherAssignment || null) === JSON.stringify(next.teacherAssignment)) return;
    updates.push({ ref: doc.ref, data: next });
  });
  if (dryRun) return { updated: updates.length, preview: updates.slice(0, 5) };
  for (let index = 0; index < updates.length; index += 450) {
    const batch = db.batch();
    updates.slice(index, index + 450).forEach((entry) => batch.set(entry.ref, entry.data, { merge: true }));
    await batch.commit();
  }
  return { updated: updates.length };
}

function initializeAdmin(projectId) {
  if (getApps().length) return getFirestore();
  const serviceAccountPath = option("service-account", process.env.GOOGLE_APPLICATION_CREDENTIALS);
  const app = serviceAccountPath
    ? initializeApp({ credential: cert(resolve(serviceAccountPath)), projectId })
    : initializeApp({ credential: applicationDefault(), projectId });
  return getFirestore(app);
}

async function main() {
  if (hasFlag("help")) return usage();
  const projectId = option("project", process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT);
  const schoolYearInput = option("school-year");
  const schoolYear = normalizeSchoolYear(schoolYearInput);
  const adminUid = option("admin-uid");
  const adminEmail = option("admin-email");
  const adminName = option("admin-name", "Administrator");
  const makeCurrent = hasFlag("make-current");
  const shouldMigrateV2Schema = hasFlag("migrate-v2-schema");
  if (hasFlag("sync-advisory") || hasFlag("rebuild-advisory")) {
    throw new Error("Advisory index provisioning has been removed. Learners and teacher assignments use their canonical collections.");
  }
  const migrateSections = hasFlag("migrate-sections");
  const deleteLegacySections = hasFlag("delete-legacy-sections");
  const shouldMigrateTeacherAssignments = hasFlag("migrate-teacher-assignments");
  const deployRules = hasFlag("deploy-rules");

  if (!projectId) throw new Error("Missing --project. Example: --project YOUR_TENANT_PROJECT_ID");
  if (schoolYearInput && !schoolYear) throw new Error("--school-year must use YYYY-YYYY.");
  if (makeCurrent && !schoolYear) throw new Error("--make-current requires --school-year.");
  if (adminEmail && !adminUid) throw new Error("--admin-email requires --admin-uid.");
  if (adminUid && !adminEmail) throw new Error("--admin-uid requires --admin-email.");
  if (deleteLegacySections && !migrateSections) throw new Error("--delete-legacy-sections requires --migrate-sections.");

  console.log(`Project: ${projectId}`);
  console.log("Provisioning: publicStats/summary");
  console.log("Provisioning: year-specific grade-term settings (default only if missing)");
  if (schoolYear) console.log(`Provisioning: schoolYears/${schoolYear}, settings/currentSchoolYear`);
  if (adminUid) console.log(`Provisioning: users/${adminUid}`);
  if (shouldMigrateV2Schema) console.log("Migration: copy legacy learner/archive/section data into the year-scoped schema (sources retained)");
  if (migrateSections) console.log(`Migrating: sections -> schoolYears/{year}/grades${deleteLegacySections ? " (delete legacy)" : ""}`);
  if (shouldMigrateTeacherAssignments) console.log("Normalizing: teacherAssignments + teacherAssignment for Teacher profiles");
  if (hasFlag("dry-run")) return console.log("Dry run complete; no writes made.");

  const db = initializeAdmin(projectId);
  const batch = db.batch();
  const curriculumSubjectPoolRef = db.collection("settings").doc("curriculumSubjectPool");
  const existingCurriculumSubjectPool = await curriculumSubjectPoolRef.get();
  if (!existingCurriculumSubjectPool.exists) {
    batch.set(curriculumSubjectPoolRef, {
      subjects: [],
      updatedAt: FieldValue.serverTimestamp(),
      updatedBy: "provisioning",
    }, { merge: true });
  }
  const gradeTermsRef = db.collection("settings").doc("gradeTerms");
  const existingGradeTerms = await gradeTermsRef.get();
  if (!existingGradeTerms.exists) {
    batch.set(gradeTermsRef, {
      termCount: 3,
      passingThreshold: 75,
      updatedAt: FieldValue.serverTimestamp(),
      updatedBy: "provisioning",
    }, { merge: true });
  }
  const togglesRef = db.collection("settings").doc("toggles");
  const existingToggles = await togglesRef.get();
  const toggleDefaults = {};
  if (!existingToggles.exists || typeof existingToggles.data()?.trashConfg !== "string") toggleDefaults.trashConfg = "30";
  if (!existingToggles.exists || typeof existingToggles.data()?.roundType !== "string") toggleDefaults.roundType = "nearest_integer";
  if (Object.keys(toggleDefaults).length) batch.set(togglesRef, toggleDefaults, { merge: true });
  const cardPreferencesRef = db.collection("settings").doc("cardPrintingPreferences");
  const existingCardPreferences = await cardPreferencesRef.get();
  if (!existingCardPreferences.exists) {
    batch.set(cardPreferencesRef, {
      activeTemplate: "sf9",
      gradeTemplates: { kinder: "sf9", grade1: "sf9", grade2: "sf9", grade3: "sf9", grade4: "sf9", grade5: "sf9", grade6: "sf9" },
      attendanceMonths: ["Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec", "Jan", "Feb", "Mar", "Apr"],
      attendanceRows: [
        { id: "classDays", label: "Class days" },
        { id: "daysPresent", label: "Present" },
        { id: "daysAbsent", label: "Absent" },
      ],
      updatedAt: FieldValue.serverTimestamp(),
      updatedBy: "provisioning",
    }, { merge: true });
  }
  if (schoolYear) {
    const yearGradeTermsRef = gradeTermsRef.collection("years").doc(schoolYear);
    const existingYearGradeTerms = await yearGradeTermsRef.get();
    if (!existingYearGradeTerms.exists) {
      batch.set(yearGradeTermsRef, {
        schoolYear,
        termCount: existingGradeTerms.exists ? existingGradeTerms.data()?.termCount ?? 3 : 3,
        passingThreshold: existingGradeTerms.exists ? existingGradeTerms.data()?.passingThreshold ?? 75 : 75,
        gradeLevels: {},
        updatedAt: FieldValue.serverTimestamp(),
        updatedBy: "provisioning",
      }, { merge: true });
    }
  }
  batch.set(db.collection("publicStats").doc("summary"), {
    totalLearners: 0,
    programsTracked: 0,
    fourPsCount: 0,
    ipCount: 0,
    snedCount: 0,
    aralCount: 0,
    muslimCount: 0,
    maleCount: 0,
    femaleCount: 0,
    notTaggedCount: 0,
    gradeLevels: [],
    recentLearners: [],
    enrollmentData: { schoolYear: schoolYear || "", rows: [], gradeTotals: [], grandTotal: { male: 0, female: 0, total: 0 } },
    schoolYear: schoolYear || "",
    syncStatus: "Unavailable",
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });

  if (schoolYear) {
    if (makeCurrent) {
      const years = await db.collection("schoolYears").get();
      years.docs.forEach((doc) => batch.set(doc.ref, { isCurrent: doc.id === schoolYear }, { merge: true }));
    }
    batch.set(db.collection("schoolYears").doc(schoolYear), { schoolYear, isCurrent: makeCurrent }, { merge: true });
    batch.set(db.collection("schoolYears").doc(schoolYear).collection("trash").doc("_schema"), { schemaVersion: 1 }, { merge: true });
    batch.set(db.collection("settings").doc("currentSchoolYear"), { value: schoolYear }, { merge: true });
  }

  if (adminUid) {
    const adminRef = db.collection("users").doc(adminUid);
    const existingAdmin = await adminRef.get();
    batch.set(db.collection("users").doc(adminUid), {
      name: adminName,
      email: adminEmail,
      role: "School Admin",
      status: "Active",
      ...(!existingAdmin.exists || !existingAdmin.data()?.teacherPrefs
        ? { teacherPrefs: { theme: "Light", inspectLearner: true } }
        : {}),
      createdAt: FieldValue.serverTimestamp(),
    }, { merge: true });
  }

  await batch.commit();
  if (shouldMigrateV2Schema) {
    const result = await migrateV2Schema(db);
    console.log(`Legacy schema copied: ${JSON.stringify(result)}. Source documents were retained.`);
  }
  if (migrateSections) {
    const result = await migrateLegacySections(db, deleteLegacySections);
    console.log(`Sections migration: ${result.migrated} normalized records from ${result.legacy} legacy documents; ${result.deleted} deleted.`);
  }
  if (shouldMigrateTeacherAssignments) {
    const result = await migrateTeacherAssignmentsRecords(db, false);
    console.log(`Teacher assignments normalized: ${result.updated} Teacher profiles updated.`);
  }
  await refreshPublicStats(db, schoolYear);
  if (deployRules) {
    if (process.platform === "win32") {
      const commandShell = process.env.ComSpec || "cmd.exe";
      const command = `npx.cmd --yes firebase-tools deploy --only firestore:rules --project ${projectId}`;
      execFileSync(commandShell, ["/d", "/s", "/c", command], { stdio: "inherit" });
    } else {
      execFileSync("npx", ["--yes", "firebase-tools", "deploy", "--only", "firestore:rules", "--project", projectId], { stdio: "inherit" });
    }
  }
  console.log("Firestore provisioning complete.");
  console.log("Learner, dropout, and transferred-out records use their canonical year-specific collections.");
}

main().catch((error) => {
  console.error(`Provisioning failed: ${error.message}`);
  process.exitCode = 1;
});
