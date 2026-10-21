import { getAuth } from "firebase-admin/auth";
import { applicationDefault, cert, initializeApp } from "firebase-admin/app";
import { FieldValue, getFirestore } from "firebase-admin/firestore";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function option(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? String(process.argv[index + 1] || "").trim() : "";
}

function hasFlag(name) {
  return process.argv.includes(`--${name}`);
}

function normalizeSchoolYear(value) {
  const match = String(value || "").trim().match(/^(\d{4})[-/]?(\d{4})$/);
  if (!match || Number(match[2]) !== Number(match[1]) + 1) {
    throw new Error("--school-year must be consecutive years, for example 2026-2027.");
  }
  return `${match[1]}-${match[2]}`;
}

function usage() {
  console.log(`Provision the year-scoped schema in a school's tenant Firestore project.

Usage:
  npm run firestore:provision-test -- --project <tenant-project-id> --confirm-project <same-id> --school-year YYYY-YYYY [options]

Options:
  --project <id>          School tenant Firebase project ID (required)
  --confirm-project <id>  Must exactly match --project (required safety check)
  --school-year <year>    Initial school year, for example 2026-2027 (required)
  --service-account <path>
  --service-key <path>    Service-account JSON path (both option names are accepted);
                          otherwise Application Default Credentials are used
  --create-admin          Create a Firebase Auth login and School Admin profile;
                          private account details are read from standard input during --apply
  --apply                 Write missing seed documents; without this flag, only print the plan
  --help                  Show this help

Existing documents are left unchanged. No users, learners, dropouts, transfers,
grades, sections, or teachers are fabricated; Firestore collections are created
when real documents are first written to those paths. The optional initial
admin account is created only when --apply is specified.`);
}

function getSeedDocuments(schoolYear) {
  return [
    {
      path: "settings/eduai",
      data: {
        ...JSON.parse(readFileSync(new URL("../src/lib/eduai-tenant-defaults.json", import.meta.url), "utf8")),
        updatedAt: FieldValue.serverTimestamp(),
      },
    },
    {
      path: `schoolYears/${schoolYear}`,
      data: {
        schoolYear,
        createdAt: FieldValue.serverTimestamp(),
      },
    },
    {
      path: "settings/currentSchoolYear",
      data: {
        value: schoolYear,
        updatedAt: FieldValue.serverTimestamp(),
      },
    },
    {
      path: "settings/curriculumSubjectPool",
      data: {
        subjects: [],
        updatedAt: FieldValue.serverTimestamp(),
      },
    },
    {
      path: `settings/gradeTerms/years/${schoolYear}`,
      data: {
        schoolYear,
        termCount: 3,
        passingThreshold: 75,
        gradeLevels: {},
        updatedAt: FieldValue.serverTimestamp(),
        updatedBy: "test-provisioning",
      },
    },
    {
      path: "publicStats/summary",
      data: {
        schoolYear,
        totalLearners: 0,
        gradeLevels: [],
        enrollmentData: {
          schoolYear,
          rows: [],
          gradeTotals: [],
          grandTotal: { male: 0, female: 0, total: 0 },
        },
        updatedAt: FieldValue.serverTimestamp(),
      },
    },
  ];
}

function initializeFirebase(projectId) {
  const serviceAccountOption = option("service-account");
  const serviceKeyOption = option("service-key");
  if (serviceAccountOption && serviceKeyOption && serviceAccountOption !== serviceKeyOption) {
    throw new Error("--service-account and --service-key must refer to the same file when both are supplied.");
  }
  const serviceAccountPath = serviceAccountOption || serviceKeyOption || process.env.GOOGLE_APPLICATION_CREDENTIALS;
  const app = serviceAccountPath
    ? initializeApp({ credential: cert(resolve(serviceAccountPath)), projectId })
    : initializeApp({ credential: applicationDefault(), projectId });
  return { db: getFirestore(app), auth: getAuth(app) };
}

async function readInitialAdmin() {
  let admin;
  try {
    admin = JSON.parse(readFileSync(0, "utf8"));
  } catch (error) {
    throw new Error(
      `Could not read initial admin details from standard input: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  if (!admin || typeof admin !== "object" || Array.isArray(admin)) {
    throw new Error("Initial admin details must be a JSON object.");
  }
  const { name, email, password } = admin;
  if (typeof name !== "string" || !name.trim() || name.trim().length > 120) {
    throw new Error("Initial admin name must be 1–120 characters.");
  }
  if (
    typeof email !== "string" ||
    !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())
  ) {
    throw new Error("Initial admin email must be valid.");
  }
  if (typeof password !== "string" || password.length < 6) {
    throw new Error("Initial admin password must be at least 6 characters.");
  }
  return { name: name.trim(), email: email.trim(), password };
}

async function createInitialAdmin(db, auth, admin) {
  let user;
  try {
    user = await auth.createUser({
      email: admin.email,
      password: admin.password,
      displayName: admin.name,
    });
    await db.collection("users").doc(user.uid).create({
      uid: user.uid,
      name: admin.name,
      email: admin.email,
      role: "School Admin",
      status: "Active",
      createdAt: FieldValue.serverTimestamp(),
      teacherAssignments: [],
      teacherAssignment: null,
      teacherPrefs: { theme: "Light", inspectLearner: true },
    });
  } catch (error) {
    if (user) {
      try {
        await auth.deleteUser(user.uid);
      } catch (cleanupError) {
        throw new Error(
          `The Admin SDK user ${user.uid} was created, but its Firestore profile failed and automatic Auth cleanup also failed: ${
            cleanupError instanceof Error ? cleanupError.message : String(cleanupError)
          }. Remove the incomplete Auth user manually. Original profile error: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }
    throw error;
  }
  return user;
}

async function provision(db, seedDocuments, schoolYear) {
  return db.runTransaction(async (transaction) => {
    const documents = await Promise.all(
      seedDocuments.map(async ({ path, data }) => {
        const ref = db.doc(path);
        return { path, data, ref, snapshot: await transaction.get(ref) };
      })
    );
    const currentYear = documents.find(({ path }) => path === "settings/currentSchoolYear");
    const configuredCurrentYear = currentYear?.snapshot.exists
      ? currentYear.snapshot.data()?.value
      : seedDocuments.find(({ path }) => path === "settings/currentSchoolYear")?.data.value;
    const created = [];
    const skipped = [];

    documents.forEach(({ path, data, ref, snapshot }) => {
      if (snapshot.exists) {
        skipped.push(path);
        return;
      }
      transaction.create(
        ref,
        path === `schoolYears/${schoolYear}`
          ? { ...data, isCurrent: configuredCurrentYear === schoolYear }
          : data
      );
      created.push(path);
    });

    return { created, skipped };
  });
}

async function main() {
  if (hasFlag("help")) return usage();

  const projectId = option("project");
  const confirmedProjectId = option("confirm-project");
  const schoolYearInput = option("school-year");
  if (!projectId || !confirmedProjectId || !schoolYearInput) {
    usage();
    throw new Error("--project, --confirm-project, and --school-year are required.");
  }
  if (projectId !== confirmedProjectId) {
    throw new Error("--confirm-project must exactly match --project.");
  }
  if (!/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(projectId)) {
    throw new Error("--project must be a valid Firebase project ID.");
  }

  const schoolYear = normalizeSchoolYear(schoolYearInput);
  const seedDocuments = getSeedDocuments(schoolYear);
  const createAdmin = hasFlag("create-admin");
  console.log(`Target Firebase project: ${projectId}`);
  console.log("Firestore paths (existing documents will not be changed):");
  console.log(`  users/{uid}`);
  console.log(`  schoolYears/${schoolYear}/learners/{LRN}`);
  console.log(`  schoolYears/${schoolYear}/dropouts/{LRN}`);
  console.log(`  schoolYears/${schoolYear}/transferredOut/{LRN}`);
  console.log(`  schoolYears/${schoolYear}/grades/{gradeId}/sections/{sectionId}/teachers/{uid}`);
  seedDocuments.forEach(({ path }) => console.log(`  ${path}`));
  if (createAdmin) {
    console.log("Initial School Admin: a Firebase Auth login and users/{uid} profile will be created during apply.");
  }

  if (!hasFlag("apply")) {
    console.log("Dry run only. No Firestore connection or writes made. Add --apply to provision missing seed documents.");
    return;
  }

  const admin = createAdmin ? await readInitialAdmin() : null;
  const { db, auth } = initializeFirebase(projectId);
  const result = await provision(db, seedDocuments, schoolYear);
  console.log(`Created ${result.created.length} document(s):`);
  result.created.forEach((path) => console.log(`  ${path}`));
  console.log(`Left ${result.skipped.length} existing document(s) unchanged:`);
  result.skipped.forEach((path) => console.log(`  ${path}`));
  if (admin) {
    const user = await createInitialAdmin(db, auth, admin);
    console.log(`Initial School Admin created: ${admin.name} (${admin.email}, UID ${user.uid}).`);
  }
}

main().catch((error) => {
  console.error(`School Firestore provisioning failed: ${error.message}`);
  process.exitCode = 1;
});
