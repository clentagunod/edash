import { applicationDefault, cert, initializeApp } from "firebase-admin/app";
import { FieldValue, getFirestore } from "firebase-admin/firestore";
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
  --apply                 Write missing seed documents; without this flag, only print the plan
  --help                  Show this help

Existing documents are left unchanged. No users, learners, dropouts, transfers,
grades, sections, or teachers are fabricated; Firestore collections are created
when real documents are first written to those paths.`);
}

function getSeedDocuments(schoolYear) {
  return [
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

function initializeFirestore(projectId) {
  const serviceAccountOption = option("service-account");
  const serviceKeyOption = option("service-key");
  if (serviceAccountOption && serviceKeyOption && serviceAccountOption !== serviceKeyOption) {
    throw new Error("--service-account and --service-key must refer to the same file when both are supplied.");
  }
  const serviceAccountPath = serviceAccountOption || serviceKeyOption || process.env.GOOGLE_APPLICATION_CREDENTIALS;
  const app = serviceAccountPath
    ? initializeApp({ credential: cert(resolve(serviceAccountPath)), projectId })
    : initializeApp({ credential: applicationDefault(), projectId });
  return getFirestore(app);
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
  console.log(`Target Firebase project: ${projectId}`);
  console.log("Firestore paths (existing documents will not be changed):");
  console.log(`  users/{uid}`);
  console.log(`  schoolYears/${schoolYear}/learners/{LRN}`);
  console.log(`  schoolYears/${schoolYear}/dropouts/{LRN}`);
  console.log(`  schoolYears/${schoolYear}/transferredOut/{LRN}`);
  console.log(`  schoolYears/${schoolYear}/grades/{gradeId}/sections/{sectionId}/teachers/{uid}`);
  seedDocuments.forEach(({ path }) => console.log(`  ${path}`));

  if (!hasFlag("apply")) {
    console.log("Dry run only. No Firestore connection or writes made. Add --apply to provision missing seed documents.");
    return;
  }

  const result = await provision(initializeFirestore(projectId), seedDocuments, schoolYear);
  console.log(`Created ${result.created.length} document(s):`);
  result.created.forEach((path) => console.log(`  ${path}`));
  console.log(`Left ${result.skipped.length} existing document(s) unchanged:`);
  result.skipped.forEach((path) => console.log(`  ${path}`));
}

main().catch((error) => {
  console.error(`School Firestore provisioning failed: ${error.message}`);
  process.exitCode = 1;
});
