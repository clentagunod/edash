import { applicationDefault, cert, getApps, initializeApp } from "firebase-admin/app";
import { FieldValue, getFirestore } from "firebase-admin/firestore";
import { resolve } from "node:path";

function option(name, fallback = "") {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? String(process.argv[index + 1] || "").trim() : fallback;
}

function hasFlag(name) {
  return process.argv.includes(`--${name}`);
}

function normalizeSchoolYear(value) {
  const text = String(value || "").trim();
  const match = text.match(/^(\d{4})[-/ ]?(\d{4})$/);
  return match ? `${match[1]}-${match[2]}` : text || "2026-2027";
}

function normalizeGrade(value) {
  const text = String(value || "").trim();
  const key = text.toLowerCase().replace(/\s+/g, " ");
  if (["kinder", "kindergarten", "kg", "0"].includes(key)) return "Kinder";
  const match = key.match(/^grade\s*(\d+)$/) || key.match(/^(\d+)$/);
  return match ? `Grade ${match[1]}` : text || "Grade 1";
}

function normalizeSection(value) {
  const text = String(value || "").trim();
  return text || "A";
}

function normalizeKey(value, fallback = "unassigned") {
  const key = String(value || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return key || fallback;
}

function parseAssignments(raw, fallbackSchoolYear) {
  if (!raw) return [];
  return raw
    .split(/[;,]/)
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const [gradeLevel, section] = entry.split(":").map((part) => part.trim());
      if (!gradeLevel || !section) {
        throw new Error(`Invalid teacher assignment '${entry}'. Use format 'Grade 1:A;Grade 5:B'.`);
      }
      return {
        schoolYear: fallbackSchoolYear,
        gradeLevel: normalizeGrade(gradeLevel),
        section: normalizeSection(section),
      };
    });
}

function initializeAdmin(projectId) {
  if (getApps().length) return getFirestore();
  const serviceAccountPath = option("service-account", process.env.GOOGLE_APPLICATION_CREDENTIALS);
  const app = serviceAccountPath
    ? initializeApp({ credential: cert(resolve(serviceAccountPath)), projectId })
    : initializeApp({ credential: applicationDefault(), projectId });
  return getFirestore(app);
}

async function ensureDoc(ref, data) {
  await ref.set(data, { merge: true });
}

async function seedSchoolStructure(db, schoolYear) {
  await ensureDoc(db.collection("schoolYears").doc(schoolYear), {
    schoolYear,
    isCurrent: true,
    createdAt: FieldValue.serverTimestamp(),
  });

  await ensureDoc(db.collection("settings").doc("currentSchoolYear"), {
    value: schoolYear,
    updatedAt: FieldValue.serverTimestamp(),
  });
  await ensureDoc(db.collection("settings").doc("curriculumSubjectPool"), {
    subjects: [],
    updatedAt: FieldValue.serverTimestamp(),
  });

  const gradeTermsRef = db.collection("settings").doc("gradeTerms");
  const gradeTermsSnapshot = await gradeTermsRef.get();
  if (!gradeTermsSnapshot.exists) {
    await ensureDoc(gradeTermsRef, {
      termCount: 3,
      passingThreshold: 75,
      updatedAt: FieldValue.serverTimestamp(),
      updatedBy: "provisioning",
    });
  }
  const yearGradeTermsRef = gradeTermsRef.collection("years").doc(schoolYear);
  const yearGradeTermsSnapshot = await yearGradeTermsRef.get();
  if (!yearGradeTermsSnapshot.exists) {
    await ensureDoc(yearGradeTermsRef, {
      schoolYear,
      termCount: gradeTermsSnapshot.exists ? gradeTermsSnapshot.data()?.termCount ?? 3 : 3,
      passingThreshold: gradeTermsSnapshot.exists ? gradeTermsSnapshot.data()?.passingThreshold ?? 75 : 75,
      gradeLevels: {},
      updatedAt: FieldValue.serverTimestamp(),
      updatedBy: "provisioning",
    });
  }

  await ensureDoc(db.collection("publicStats").doc("summary"), {
    schoolYear,
    syncStatus: "Ready",
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
    enrollmentData: {
      schoolYear,
      rows: [],
      gradeTotals: [],
      grandTotal: { male: 0, female: 0, total: 0 },
    },
    updatedAt: FieldValue.serverTimestamp(),
  });

}

async function writeTeacherSections(db, teacherUid, teacherName, assignments) {
  const batch = db.batch();
  assignments.forEach((assignment) => {
    const gradeKey = normalizeKey(assignment.gradeLevel, "grade");
    const sectionKey = normalizeKey(assignment.section, "section");
    const schoolYear = assignment.schoolYear;
    const yearRef = db.collection("schoolYears").doc(schoolYear);
    const gradeRef = yearRef.collection("grades").doc(gradeKey);
    const sectionRef = gradeRef.collection("sections").doc(sectionKey);
    batch.set(gradeRef, {
      schoolYear,
      gradeLevel: assignment.gradeLevel,
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    batch.set(sectionRef, {
      schoolYear,
      gradeLevel: assignment.gradeLevel,
      section: assignment.section,
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    batch.set(
      sectionRef.collection("teachers").doc(teacherUid),
      {
        teacherUid,
        teacherName,
        schoolYear,
        gradeLevel: assignment.gradeLevel,
        section: assignment.section,
        status: "Active",
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

  });

  await batch.commit();
}

async function seedAdminUser(db, userUid, email, name) {
  const userRef = db.collection("users").doc(userUid);
  const existingUser = await userRef.get();
  await ensureDoc(userRef, {
    uid: userUid,
    name,
    email,
    role: "School Admin",
    status: "Active",
    createdAt: FieldValue.serverTimestamp(),
    teacherAssignments: [],
    teacherAssignment: null,
    ...(!existingUser.exists || !existingUser.data()?.teacherPrefs
      ? { teacherPrefs: { theme: "Light", inspectLearner: true } }
      : {}),
  });
}

async function seedTeacherUser(db, userUid, email, name, assignments) {
  const normalizedAssignments = assignments.map((assignment) => ({
    schoolYear: assignment.schoolYear,
    gradeLevel: normalizeGrade(assignment.gradeLevel),
    section: normalizeSection(assignment.section),
  }));

  const userRef = db.collection("users").doc(userUid);
  const existingUser = await userRef.get();
  await ensureDoc(userRef, {
    uid: userUid,
    name,
    email,
    role: "Teacher",
    status: "Active",
    createdAt: FieldValue.serverTimestamp(),
    teacherAssignments: normalizedAssignments,
    teacherAssignment: normalizedAssignments[0] || null,
    ...(!existingUser.exists || !existingUser.data()?.teacherPrefs
      ? { teacherPrefs: { theme: "Light", inspectLearner: true } }
      : {}),
  });

  await writeTeacherSections(db, userUid, name, normalizedAssignments);
}

async function main() {
  const projectId = option("project", process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT);
  if (!projectId) {
    throw new Error("Missing --project. Example: --project my-firebase-project");
  }

  const structureOnly = hasFlag("structure-only");
  const schoolYear = normalizeSchoolYear(option("school-year", "2026-2027"));
  const adminUid = option("admin-uid", "");
  const adminEmail = option("admin-email", "");
  const adminName = option("admin-name", "School Admin");
  const teacherUid = option("teacher-uid", "");
  const teacherEmail = option("teacher-email", "");
  const teacherName = option("teacher-name", "");
  const teacherAssignmentsRaw = option("teacher-assignments", "");

  const db = initializeAdmin(projectId);

  console.log(`Bootstrapping Firestore for project: ${projectId}`);
  console.log(`School year: ${schoolYear}`);
  console.log(structureOnly ? "Structure-only mode enabled; no seed records will be added." : "Seed mode enabled for app bootstrap.");

  await seedSchoolStructure(db, schoolYear);

  if (adminUid && adminEmail) {
    await seedAdminUser(db, adminUid, adminEmail, adminName);
    console.log(`Admin user created: ${adminName} (${adminUid})`);
  }

  if (!structureOnly && teacherUid && teacherEmail && teacherName && teacherAssignmentsRaw) {
    const assignments = parseAssignments(teacherAssignmentsRaw, schoolYear);
    await seedTeacherUser(db, teacherUid, teacherEmail, teacherName, assignments);
    console.log(`Teacher seeded: ${teacherName} (${teacherUid})`);
    console.log(`Section records created for ${assignments.length} grade-section assignments.`);
  }

  console.log("Firestore structure created successfully.");
  console.log("Structure paths:");
  console.log("- users/{uid}");
  console.log("- schoolYears/{schoolYear}");
  console.log("- schoolYears/{schoolYear}/learners/{learnerId}");
  console.log("- schoolYears/{schoolYear}/dropouts/{learnerId}");
  console.log("- schoolYears/{schoolYear}/transferredOut/{learnerId}");
  console.log("- schoolYears/{schoolYear}/grades/{gradeId}/sections/{sectionId}/teachers/{teacherUid}");
  console.log("- settings/currentSchoolYear");
  console.log("- settings/curriculumSubjectPool");
  console.log("- settings/gradeTerms/years/{schoolYear}");
  console.log("- publicStats/summary");
  console.log("Teacher assignment history: users/{uid}/assignmentHistory/{schoolYear}");
  console.log("Teacher profile assignments remain available across school years: users/{uid}.teacherAssignments");
}

main().catch((error) => {
  console.error("Firestore bootstrap failed:", error.message);
  process.exitCode = 1;
});
