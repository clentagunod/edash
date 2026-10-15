import { applicationDefault, cert, initializeApp } from "firebase-admin/app";
import { FieldValue, getFirestore } from "firebase-admin/firestore";
import { unzipSync } from "fflate";
import { XMLParser } from "fast-xml-parser";
import { readFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const DEFAULT_WORKBOOK = join(SCRIPT_DIR, "Backup_SanRoqueEs.xlsx");
const BATCH_SIZE = 400;
const LEARNER_FIELDS = [
  "firstName", "lastName", "middleName", "suffix", "age", "birthDate", "learnerId", "name", "gradeLevel", "section", "gender",
  "guardian", "contact", "enrollmentStatus", "eosyStatus", "schoolYear", "dateAdded", "is4Ps", "isIP", "isSNED", "isARAL", "isMuslim",
  "bosyHeight", "bosyWeight", "bosyNutritionalStatus", "mosyHeight", "mosyWeight", "mosyNutritionalStatus", "eosyHeight", "eosyWeight", "eosyNutritionalStatus",
  "bosyCRLA", "mosyCRLA", "eosyCRLA", "bosyPhilIRI", "mosyPhilIRI", "eosyPhilIRI", "bosyRMA", "mosyRMA", "eosyRMA",
  "filipino", "english", "math", "science", "aralPan", "esp", "music", "arts", "pe", "health", "epp", "motherTongue",
  "literacyLanguageCommunication", "socioEmotionalDevelopment", "valuesDevelopment", "physicalHealthMotorDevelopment",
  "aestheticCreativeDevelopment", "cognitiveDevelopment", "gmrc", "language", "readingLiteracy", "makabansa", "eppTle",
  "tle", "valuesEducation", "mapeh", "gradesByTerm",
  "transferType", "transferIn", "transferOut", "transferSchool", "transferDate", "transferReason", "transferNotes", "extra",
];
const BOOLEAN_FIELDS = new Set(["is4Ps", "isIP", "isSNED", "isARAL", "isMuslim", "transferIn", "transferOut"]);
const JSON_FIELDS = new Set(["extra", "gradesByTerm"]);
const DATE_FIELDS = new Set(["birthDate", "dateAdded", "transferDate"]);
const FIELD_BY_HEADER = new Map(LEARNER_FIELDS.map((field) => [normalizeHeader(field), field]));
const XML_PARSER = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@",
  parseTagValue: false,
  trimValues: false,
  processEntities: false,
});

function option(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? String(process.argv[index + 1] || "").trim() : "";
}

function hasFlag(name) {
  return process.argv.includes(`--${name}`);
}

function normalizeHeader(value) {
  return String(value || "").replace(/[^a-z0-9]/gi, "").toLowerCase();
}

function normalizeSchoolYear(value) {
  const match = String(value || "").trim().match(/^(\d{4})\D?(\d{4})$/);
  if (!match || Number(match[2]) !== Number(match[1]) + 1) return "";
  return `${match[1]}-${match[2]}`;
}

function asArray(value) {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function richText(value) {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(richText).join("");
  if (!value || typeof value !== "object") return "";
  if (typeof value.t === "string") return value.t;
  if (value.r !== undefined) return richText(value.r);
  return "";
}

function resolveWorksheetPath(target) {
  const cleaned = String(target || "").replace(/^\/+/, "");
  const path = normalize(cleaned.startsWith("xl/") ? cleaned : join("xl", cleaned));
  if (path === ".." || path.startsWith(`..${sep}`)) throw new Error("Workbook contains an invalid worksheet path.");
  return path.replace(/\\/g, "/");
}

function columnIndex(cellReference) {
  const letters = String(cellReference || "").match(/^[A-Z]+/i)?.[0];
  if (!letters) throw new Error("Workbook contains a cell without a valid column reference.");
  let index = 0;
  for (const letter of letters.toUpperCase()) index = index * 26 + letter.charCodeAt(0) - 64;
  return index - 1;
}

function decodeCell(cell, sharedStrings) {
  if (cell["@t"] === "s") {
    const index = Number(cell.v);
    if (!Number.isInteger(index) || index < 0 || index >= sharedStrings.length) {
      throw new Error("Workbook contains an invalid shared-string reference.");
    }
    return sharedStrings[index];
  }
  if (cell["@t"] === "inlineStr") return richText(cell.is);
  if (cell["@t"] === "b") return cell.v === "1";
  if (cell.v === undefined || cell.v === "") return "";
  if (cell["@t"] === "e") throw new Error("Workbook contains an Excel cell error.");
  if (cell["@t"] === "str") return String(cell.v);
  const numeric = Number(cell.v);
  return Number.isFinite(numeric) ? numeric : String(cell.v);
}

function decodeExcelDate(value) {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "number") {
    const date = new Date(Date.UTC(1899, 11, 30) + value * 86400000);
    return Number.isNaN(date.getTime()) ? value : date.toISOString();
  }
  return value;
}

function decodeBirthDate(value, rowNumber, allowInvalid) {
  const decoded = decodeExcelDate(value);
  const dateOnly = typeof decoded === "string" ? decoded.match(/^(\d{4}-\d{2}-\d{2})(?:T.*)?$/)?.[1] : "";
  const parsed = dateOnly ? new Date(`${dateOnly}T00:00:00.000Z`) : null;
  if (!dateOnly || Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== dateOnly) {
    if (allowInvalid) return "";
    throw new Error(`Row ${rowNumber}: Birthdate must be a valid date.`);
  }
  return dateOnly;
}

function decodeBoolean(value, field, rowNumber) {
  if (typeof value === "boolean") return value;
  if (value === 1 || value === 0) return value === 1;
  const normalized = String(value).trim().toLowerCase();
  if (["true", "yes", "1"].includes(normalized)) return true;
  if (["false", "no", "0"].includes(normalized)) return false;
  throw new Error(`Row ${rowNumber}: "${field}" must be TRUE or FALSE.`);
}

function identifier(value, field, rowNumber) {
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new Error(`Row ${rowNumber}: "${field}" is not a safe whole-number ID.`);
    }
    return String(value);
  }
  return String(value ?? "").trim();
}

function parseDocumentData(row, targetYear, rowNumber, allowInvalidBirthDates) {
  const record = {};
  for (const [field, rawValue] of Object.entries(row.fields)) {
    if (rawValue === "" || rawValue === null || rawValue === undefined) continue;
    if (BOOLEAN_FIELDS.has(field)) {
      record[field] = decodeBoolean(rawValue, field, rowNumber);
    } else if (JSON_FIELDS.has(field)) {
      if (typeof rawValue === "object") {
        record[field] = rawValue;
      } else {
        try {
          record[field] = JSON.parse(String(rawValue));
        } catch {
          throw new Error(`Row ${rowNumber}: "${field}" must contain valid JSON.`);
        }
      }
    } else if (field === "birthDate") {
      const birthDate = decodeBirthDate(rawValue, rowNumber, allowInvalidBirthDates);
      if (birthDate) record[field] = birthDate;
    } else if (DATE_FIELDS.has(field)) {
      record[field] = decodeExcelDate(rawValue);
    } else {
      record[field] = rawValue;
    }
  }

  const learnerId = identifier(row.fields.learnerId, "LRN", rowNumber);
  const documentId = identifier(row.documentId || row.fields.learnerId, "Id", rowNumber);
  if (!learnerId) throw new Error(`Row ${rowNumber}: LRN is required.`);
  if (!documentId || documentId.includes("/")) throw new Error(`Row ${rowNumber}: Id must be a non-empty Firestore document ID without "/".`);

  const rowYear = row.fields.schoolYear ? normalizeSchoolYear(row.fields.schoolYear) : targetYear;
  if (!rowYear) throw new Error(`Row ${rowNumber}: School Year must be consecutive years.`);
  if (rowYear !== targetYear) throw new Error(`Row ${rowNumber}: School Year does not match --school-year ${targetYear}.`);

  record.learnerId = learnerId;
  record.schoolYear = targetYear;
  return {
    id: documentId,
    data: record,
    invalidBirthDate: Boolean(row.fields.birthDate && !record.birthDate),
  };
}

function readWorkbookSheets(buffer) {
  let files;
  try {
    files = unzipSync(buffer);
  } catch {
    throw new Error("Could not read the workbook as a valid XLSX file.");
  }
  const readXml = (path) => {
    const content = files[path];
    if (!content) throw new Error(`Workbook is missing ${path}.`);
    return XML_PARSER.parse(new TextDecoder().decode(content));
  };
  const workbook = readXml("xl/workbook.xml").workbook;
  const relationships = readXml("xl/_rels/workbook.xml.rels").Relationships.Relationship;
  const relationById = new Map(asArray(relationships).map((relationship) => [relationship["@Id"], relationship["@Target"]]));
  const sharedStringsPath = "xl/sharedStrings.xml";
  const sharedStrings = files[sharedStringsPath]
    ? asArray(readXml(sharedStringsPath).sst.si).map(richText)
    : [];

  return asArray(workbook.sheets.sheet).map((sheet) => {
    const name = String(sheet["@name"] || "");
    const relationshipId = sheet["@r:id"];
    const worksheetPath = resolveWorksheetPath(relationById.get(relationshipId));
    const worksheet = readXml(worksheetPath).worksheet;
    const rows = asArray(worksheet.sheetData?.row).map((row) =>
      asArray(row.c).map((cell) => ({ column: columnIndex(cell["@r"]), value: decodeCell(cell, sharedStrings) }))
    );
    return { name, rows };
  });
}

function parseWorksheet(sheet, targetYear, collectionName, allowInvalidBirthDates) {
  if (!sheet.rows.length) return { records: [], blankRows: 0, invalidBirthdates: 0 };
  const headersByColumn = new Map();
  const unknownHeaders = [];
  sheet.rows[0].forEach(({ column, value }) => {
    const header = String(value || "").trim();
    if (!header) return;
    const normalized = normalizeHeader(header);
    if (normalized === "id") {
      headersByColumn.set(column, "id");
      return;
    }
    if (normalized === "lrn") {
      headersByColumn.set(column, "learnerId");
      return;
    }
    const field = FIELD_BY_HEADER.get(normalized);
    if (!field) {
      unknownHeaders.push(header);
      return;
    }
    if ([...headersByColumn.values()].includes(field)) {
      throw new Error(`Sheet "${sheet.name}" has duplicate columns for "${field}".`);
    }
    headersByColumn.set(column, field);
  });
  if (unknownHeaders.length) {
    throw new Error(`Sheet "${sheet.name}" has unsupported columns: ${[...new Set(unknownHeaders)].join(", ")}.`);
  }
  if (![...headersByColumn.values()].includes("id") || ![...headersByColumn.values()].includes("learnerId")) {
    throw new Error(`Sheet "${sheet.name}" must include "Id" and "LRN" columns.`);
  }

  const records = [];
  const seenIds = new Set();
  let blankRows = 0;
  let invalidBirthdates = 0;
  sheet.rows.slice(1).forEach((cells, index) => {
    const values = new Map(cells.map(({ column, value }) => [column, value]));
    const hasContent = [...values.values()].some((value) => value !== "" && value !== null && value !== undefined);
    if (!hasContent) {
      blankRows += 1;
      return;
    }
    const fields = {};
    headersByColumn.forEach((field, column) => {
      const value = values.get(column);
      if (field !== "id" && field !== "lrn") fields[field] = value;
    });
    const rawId = values.get([...headersByColumn.entries()].find(([, field]) => field === "id")[0]);
    const documentId = identifier(rawId, "Id", index + 2);
    const record = parseDocumentData({ documentId, fields }, targetYear, index + 2, allowInvalidBirthDates);
    if (record.invalidBirthDate) invalidBirthdates += 1;
    const uniqueKey = `${collectionName}/${record.id}`;
    if (seenIds.has(uniqueKey)) throw new Error(`Sheet "${sheet.name}" contains duplicate IDs (row ${index + 2}).`);
    seenIds.add(uniqueKey);
    records.push({ collectionName, id: record.id, data: record.data, rowNumber: index + 2 });
  });
  return { records, blankRows, invalidBirthdates };
}

export function parseLearnerWorkbook(buffer, schoolYear, includeArchives = false, { allowInvalidBirthDates = false } = {}) {
  const targetYear = normalizeSchoolYear(schoolYear);
  if (!targetYear) throw new Error("--school-year must be consecutive years, for example 2026-2027.");
  const worksheets = readWorkbookSheets(buffer);
  const suffix = targetYear.replace("-", "_");
  const expectedSheets = [
    { name: `Backup_Learners_${suffix}`, collectionName: "learners" },
    ...(includeArchives ? [
      { name: `Backup_Dropouts_${suffix}`, collectionName: "dropouts" },
      { name: `Backup_TransferredOut_${suffix}`, collectionName: "transferredOut" },
    ] : []),
  ];
  const selectedSheets = expectedSheets.map((expected) => {
    const sheet = worksheets.find(({ name }) => name === expected.name);
    if (!sheet && expected.collectionName === "learners") {
      throw new Error(`Workbook does not contain "${expected.name}".`);
    }
    return sheet ? { sheet, collectionName: expected.collectionName } : null;
  }).filter(Boolean);

  const parsed = selectedSheets.map(({ sheet, collectionName }) => ({
    sheetName: sheet.name,
    collectionName,
    ...parseWorksheet(sheet, targetYear, collectionName, allowInvalidBirthDates),
  }));
  const allRecords = parsed.flatMap(({ records }) => records);
  return {
    schoolYear: targetYear,
    sheets: parsed.map(({ sheetName, collectionName, records, blankRows, invalidBirthdates }) => ({
      sheetName,
      collectionName,
      recordCount: records.length,
      blankRows,
      invalidBirthdates,
    })),
    records: allRecords,
    invalidBirthdates: parsed.reduce((total, sheet) => total + sheet.invalidBirthdates, 0),
  };
}

function usage() {
  console.log(`Import learner records from the San Roque Excel backup into the new Firestore schema.

Usage:
  npm run firestore:import-learners -- --project <tenant-project-id> --confirm-project <same-id> --school-year YYYY-YYYY [options]

Options:
  --file <path>          XLSX backup path (default: scripts/Backup_SanRoqueEs.xlsx)
  --project <id>         School tenant Firebase project ID (required)
  --confirm-project <id> Must exactly match --project (required safety check)
  --school-year <year>   Year to import; workbook sheet and row years must match (required)
  --service-account <path> Admin service-account JSON; otherwise Application Default Credentials
  --include-archives     Also import matching Backup_Dropouts/Backup_TransferredOut sheets
  --birthdates-only      Update only valid birthDate values on existing learners
  --overwrite            Replace existing documents (default is to skip them)
  --apply                Write records; without this flag, perform a read-only preview
  --help                 Show this help

The import targets schoolYears/{year}/learners/{LRN}; archives use the matching
schoolYears/{year}/dropouts or transferredOut collections. Users, settings, and
publicStats are not imported. Existing documents are preserved unless --overwrite is set.
With --birthdates-only, only date-only birthDate values are considered and
no other learner fields are changed; malformed source birthdates are skipped
and missing learner documents prevent writes.
`);
}

function initializeFirestore(projectId) {
  const serviceAccountPath = option("service-account") || process.env.GOOGLE_APPLICATION_CREDENTIALS;
  const appName = "edash-learner-import";
  const app = initializeApp(
    serviceAccountPath
      ? { credential: cert(resolve(serviceAccountPath)), projectId }
      : { credential: applicationDefault(), projectId },
    appName,
  );
  return getFirestore(app);
}

async function previewExistingDocuments(db, records, overwrite) {
  const counts = { new: 0, existing: 0 };
  for (let start = 0; start < records.length; start += BATCH_SIZE) {
    const chunk = records.slice(start, start + BATCH_SIZE);
    const snapshots = await db.getAll(...chunk.map(({ collectionName, id, data }) =>
      db.collection("schoolYears").doc(data.schoolYear).collection(collectionName).doc(id)
    ));
    snapshots.forEach((snapshot) => {
      counts[snapshot.exists ? "existing" : "new"] += 1;
    });
  }
  return { ...counts, willWrite: overwrite ? counts.new + counts.existing : counts.new };
}

async function applyRecords(db, records, overwrite) {
  const totals = { imported: 0, skippedExisting: 0 };
  for (let start = 0; start < records.length; start += BATCH_SIZE) {
    const chunk = records.slice(start, start + BATCH_SIZE);
    await db.runTransaction(async (transaction) => {
      const references = chunk.map(({ collectionName, id, data }) => ({
        ref: db.collection("schoolYears").doc(data.schoolYear).collection(collectionName).doc(id),
        data,
      }));
      const snapshots = await transaction.getAll(...references.map(({ ref }) => ref));
      references.forEach(({ ref, data }, index) => {
        if (snapshots[index].exists && !overwrite) {
          totals.skippedExisting += 1;
        } else if (snapshots[index].exists) {
          transaction.set(ref, data);
          totals.imported += 1;
        } else {
          transaction.create(ref, data);
          totals.imported += 1;
        }
      });
    });
  }
  return totals;
}

async function previewBirthdateUpdates(db, records) {
  const counts = { changed: 0, unchanged: 0, missing: 0 };
  for (let start = 0; start < records.length; start += BATCH_SIZE) {
    const chunk = records.slice(start, start + BATCH_SIZE);
    const references = chunk.map(({ id }) =>
      db.collection("schoolYears").doc(chunk[0].data.schoolYear).collection("learners").doc(id)
    );
    const snapshots = await db.getAll(...references);
    snapshots.forEach((snapshot, index) => {
      if (!snapshot.exists) {
        counts.missing += 1;
      } else if (snapshot.data().birthDate === chunk[index].data.birthDate) {
        counts.unchanged += 1;
      } else {
        counts.changed += 1;
      }
    });
  }
  return counts;
}

async function applyBirthdateUpdates(db, records) {
  let updated = 0;
  for (let start = 0; start < records.length; start += BATCH_SIZE) {
    const chunk = records.slice(start, start + BATCH_SIZE);
    const references = chunk.map(({ id }) =>
      db.collection("schoolYears").doc(chunk[0].data.schoolYear).collection("learners").doc(id)
    );
    const snapshots = await db.getAll(...references);
    if (snapshots.some((snapshot) => !snapshot.exists)) {
      throw new Error("A learner document is missing; no updates were written for this batch.");
    }
    const batch = db.batch();
    let batchUpdates = 0;
    snapshots.forEach((snapshot, index) => {
      if (snapshot.data().birthDate !== chunk[index].data.birthDate) {
        batch.update(references[index], { birthDate: chunk[index].data.birthDate });
        updated += 1;
        batchUpdates += 1;
      }
    });
    if (batchUpdates) await batch.commit();
  }
  return updated;
}

async function main() {
  if (hasFlag("help")) return usage();
  const projectId = option("project");
  const confirmedProjectId = option("confirm-project");
  const schoolYear = option("school-year");
  if (!projectId || !confirmedProjectId || !schoolYear) {
    usage();
    throw new Error("--project, --confirm-project, and --school-year are required.");
  }
  if (projectId !== confirmedProjectId) throw new Error("--confirm-project must exactly match --project.");
  if (!/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(projectId)) throw new Error("--project must be a valid Firebase project ID.");
  const normalizedYear = normalizeSchoolYear(schoolYear);
  if (!normalizedYear) throw new Error("--school-year must be consecutive years, for example 2026-2027.");

  const workbookPathOption = option("file");
  const workbookPath = workbookPathOption
    ? (isAbsolute(workbookPathOption) ? workbookPathOption : resolve(workbookPathOption))
    : DEFAULT_WORKBOOK;
  const fileInfo = await readFile(workbookPath);
  if (fileInfo.length > 50 * 1024 * 1024) throw new Error("Workbook exceeds the 50 MB import limit.");
  const birthdatesOnly = hasFlag("birthdates-only");
  const parsed = parseLearnerWorkbook(fileInfo, normalizedYear, hasFlag("include-archives"), {
    allowInvalidBirthDates: birthdatesOnly,
  });
  if (!parsed.records.length) throw new Error("No learner records were found for the requested school year.");

  console.log(`Target Firebase project: ${projectId}`);
  console.log(`Workbook: ${basename(workbookPath)}`);
  console.log(`School year: ${normalizedYear}`);
  parsed.sheets.forEach(({ sheetName, collectionName, recordCount, blankRows, invalidBirthdates }) =>
    console.log(`  ${sheetName} -> ${collectionName}: ${recordCount} records${blankRows ? `, ${blankRows} blank rows ignored` : ""}${birthdatesOnly && invalidBirthdates ? `, ${invalidBirthdates} invalid birthdate(s) skipped` : ""}`));
  console.log(`Records to inspect: ${parsed.records.length}`);

  const db = initializeFirestore(projectId);
  try {
    const yearSnapshot = await db.collection("schoolYears").doc(normalizedYear).get();
    if (!yearSnapshot.exists) {
      throw new Error(`schoolYears/${normalizedYear} does not exist. Provision this school year before importing.`);
    }
    if (birthdatesOnly) {
      const validBirthdateRecords = parsed.records.filter(({ data }) => data.birthDate);
      const dateUpdates = await previewBirthdateUpdates(db, validBirthdateRecords);
      console.log(`Birthdates to normalize: ${dateUpdates.changed}`);
      console.log(`Already date-only and correct: ${dateUpdates.unchanged}`);
      console.log(`Invalid source birthdates skipped: ${parsed.invalidBirthdates}`);
      console.log(`Learner documents missing: ${dateUpdates.missing}`);
      if (dateUpdates.missing) {
        throw new Error("One or more source learners are missing from Firestore; birthdate updates were not applied.");
      }
      if (!hasFlag("apply")) {
        console.log("Read-only birthdate preview complete. Add --apply to update only birthDate fields.");
        return;
      }
      const updated = await applyBirthdateUpdates(db, validBirthdateRecords);
      console.log(`Normalized ${updated} learner birthdate(s); skipped ${parsed.invalidBirthdates} invalid source birthdate(s); no other learner fields were changed.`);
      return;
    }
    const existing = await previewExistingDocuments(db, parsed.records, hasFlag("overwrite"));
    console.log(`Already present: ${existing.existing}`);
    console.log(`New documents: ${existing.new}`);
    console.log(`Will write: ${existing.willWrite}${hasFlag("overwrite") ? " (overwrite enabled)" : " (existing documents will be skipped)"}`);
    if (!hasFlag("apply")) {
      console.log("Read-only preview complete. Add --apply to write the records.");
      return;
    }
    const result = await applyRecords(db, parsed.records, hasFlag("overwrite"));
    console.log(`Imported ${result.imported} document(s); skipped ${result.skippedExisting} existing document(s).`);
  } finally {
    await db.terminate();
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`Learner import failed: ${error.message}`);
    process.exitCode = 1;
  });
}
