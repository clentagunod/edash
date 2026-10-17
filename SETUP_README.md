# E-Dash Setup and New-School Registration

This guide covers a complete deployment: central school directory, public school registration requests, a new school's Firebase project and Firestore schema, shared rules, optional Apps Script endpoints for audit logs and feedback, and the web app configuration.

## 1. Understand the project layout

Use one Firebase project per school and one separate Firebase project for the central directory:

| Resource | Purpose | Config/rules |
| --- | --- | --- |
| Central registry Firebase project | School selection directory: `schools/{schoolId}` | `firebase.registry.json`, `school-registry.rules` |
| School/tenant Firebase project | School's Firebase Authentication and Firestore records | `firebase.json`, `firestore.rules` |
| Vite/Vercel app | Shared web app; registry and registration request settings are build-time `VITE_*` values | `.env.local` locally; Vercel environment variables in deployment |
| Apps Script Web Apps | Central school registration requests and optional audit and feedback integrations | Files in `apps-script/` |

The Firebase Web App config is public and is delivered to browsers. A Firebase Admin service-account key is a private credential. Never put a service-account JSON or private key into the web app, the school-registration JSON, source control, or any `VITE_*` variable.

## 2. Prepare the central registry

1. Create or select the central Firebase project. Enable Firestore and create the default database in production mode.
2. Register a Firebase Web App in that project and copy its Web App config.
3. In the project root, copy the environment template and enter the **central registry** Web App values:

   ```powershell
   Copy-Item .env.example .env.local
   ```

   Set `VITE_REGISTRY_FIREBASE_API_KEY`, `VITE_REGISTRY_FIREBASE_AUTH_DOMAIN`, `VITE_REGISTRY_FIREBASE_PROJECT_ID`, `VITE_REGISTRY_FIREBASE_STORAGE_BUCKET`, `VITE_REGISTRY_FIREBASE_MESSAGING_SENDER_ID`, and `VITE_REGISTRY_FIREBASE_APP_ID`. Do not use a tenant's config for these variables.

4. Deploy the central directory rules:

   ```powershell
   npx --yes firebase-tools login
   npx --yes firebase-tools deploy --only firestore:rules --project CENTRAL_REGISTRY_PROJECT_ID --config firebase.registry.json
   ```

   The Firebase CLI account must be allowed to deploy rules to the central project. This CLI login is separate from Admin SDK credentials used by the registration script.

The registry rules allow the app to read enabled directory entries; only trusted administrators using the Firebase Admin SDK should write registrations.

## 3. Create a school Firebase project

For each school:

1. Create a Firebase project. Record its **project ID** (not its project number or sender ID).
2. Enable **Authentication** and configure the sign-in method used by the deployment (the app uses Firebase Auth; configure email/password if that is the school's chosen login method). Add the deployed site's domain under Authentication's authorized domains.
3. Create the default Firestore database in production mode.
4. Register a Firebase Web App in the school project. Save the Web App config; it will go in the public school-registration JSON.
5. Create an initial school administrator in Firebase Authentication. Copy that user's Auth **UID** and email; the Firestore profile must use that exact UID as its document ID.

Do not use a service-account key as the browser Firebase config. Keep privileged keys outside the project folder, for example `C:\secure\firebase-admin\school-admin.json`.

## 4. Generate the tenant Firestore structure

The project constructs the required Firestore documents directly with Firebase Admin; Firestore does not have empty collections to create independently. The bootstrap command creates the structure documents and school-year metadata. It does not import a JSON schema file.

Install project dependencies if needed, then bootstrap an empty school's database. In PowerShell, quote the service-account path:

```powershell
npm ci
npm run firestore:bootstrap -- --project SCHOOL_FIREBASE_PROJECT_ID --school-year 2026-2027 --structure-only --service-account "C:\secure\firebase-admin\school-admin.json"
```

Alternatively, configure Application Default Credentials with `gcloud auth application-default login` and omit `--service-account`. The credential identity needs permission to read/write tenant Firestore documents (for example, **Cloud Datastore User**). Use a trusted operator account/key and keep it secure.

To also create the initial Firestore administrator profile, first create the Auth account in step 3 and use its UID:

```powershell
npm run firestore:bootstrap -- --project SCHOOL_FIREBASE_PROJECT_ID --school-year 2026-2027 --admin-uid FIREBASE_AUTH_UID --admin-email admin@example.edu --admin-name "School Administrator" --service-account "C:\secure\firebase-admin\school-admin.json"
```

Bootstrap writes/merges these initial documents (it does not create fake records just to materialize collections):

```text
users/{uid}                                         # when --admin-uid is supplied
schoolYears/{schoolYear}
settings/currentSchoolYear
settings/gradeTerms                              # legacy fallback
settings/curriculumSubjectPool
settings/toggles                                # optional access flags
settings/cardPrintingPreferences             # card template, per-grade assignments, attendance months/rows
settings/gradeTerms/years/{schoolYear}
publicStats/summary
```

The app creates record documents when needed. The primary data paths are:

```text
users/{uid}
users/{uid}/assignmentHistory/{schoolYear}
schoolYears/{schoolYear}
settings/{settingId}
settings/currentSchoolYear
settings/toggles                                # { canParentAccess: true | false, canPromoteStudents: true | false, roundType: "nearest_integer" | "none" }
settings/gradeTerms/years/{schoolYear}
schoolYears/{schoolYear}/learners/{learnerId}
schoolYears/{schoolYear}/dropouts/{learnerId}
schoolYears/{schoolYear}/transferredOut/{learnerId}
schoolYears/{schoolYear}/grades/{gradeKey}              # curriculum subject assignments
schoolYears/{schoolYear}/grades/{gradeKey}/sections/{sectionKey}
schoolYears/{schoolYear}/grades/{gradeKey}/sections/{sectionKey}/teachers/{uid}
publicStats/summary
```

`settings/toggles` controls Parent Portal access, teacher promotion/retention, and card grade rounding. `canParentAccess` defaults to `true`; `canPromoteStudents` defaults to `false`; `roundType` defaults to `"nearest_integer"` (nearest whole number, with .5 rounded up) and may be set to `"none"` to preserve decimals. Grade rounding is configured in Admin Console, School Structure, Grade Configuration and applies to Final Grades and General Average in Card Printing. Toggle updates merge their field so other settings are preserved. The Admin Console → Access Management switches create/update these fields while preserving the other toggle values. Bootstrap scripts intentionally do not create `settings/toggles`; it can also be created manually. Publish the current `firestore.rules` to enforce Parent Portal access on anonymous learner reads and teacher progression writes.

Firestore indexes are declared in `firebase.index.json`, which is configured in `firebase.json`. The composite `learners` index on `gradeLevel` and `section` supports teacher-scoped live learner listeners and other assignment-scoped queries. Deploy it from the Firebase CLI with `firebase deploy --only firestore:indexes`; index creation can take several minutes to finish.

The **Promotion** section lists learners whose source-year EOSY status is `Promoted`. It retains that source record and creates a separate learner record in a configured succeeding year. The target grade and section must exist in that year’s school structure. School Admins and Registrars may promote; teachers can promote only while `settings/toggles.canPromoteStudents` is `true`. Promotion copies learner details to the new record, lets staff update those details, resets enrollment/movement status, and rejects an existing learner ID in the target year rather than overwriting it.

The **Retention** section lists learners whose source-year EOSY status is `Retained`. It likewise keeps the source-year record and creates a separate succeeding-year record, but fixes the learner's grade to their current grade; only the configured section may be selected for placement. Other learner details may be updated. The same `canPromoteStudents` teacher-access toggle controls both sections, and the Firestore rules require retained learners to remain in the source grade.

`settings/cardPrintingPreferences` stores the active card template (`activeTemplate`), grade-level template assignments (`gradeTemplates`), and editable attendance month and row structures (`attendanceMonths`, `attendanceRows`). The available template is **Original numerical template (SF9)**, with front and back previews shown together in the Admin Console. New tenant provisioning initializes these fields with this template and the default June through April attendance layout. The Admin Console Card Preferences section edits this document.

The year-specific `settings/gradeTerms/years/{schoolYear}` document stores `{ schoolYear, termCount, passingThreshold, gradeLevels, updatedAt, updatedBy }`. `termCount` defaults to 3 and supports 1–4; **Final Grade** is always available. `passingThreshold` defaults to 75 and is adjustable from 0 to 100 in **Admin Console → Grade configuration**. The Student Card shows a subject's Passed/Failed remark only when the final grade is numeric and all configured term grades for that subject are present; it compares the final grade against this threshold (equal to or above passes). The overall General Average remark also remains blank until all subjects have complete configured terms and final grades. `gradeLevels` is an optional map keyed by normalized grade level, for example `gradeLevels.grade3: { gradeLevel: "Grade 3", gradingType: "numerical", finalGradeMode: "automatic", letterScale: [...] }`. `finalGradeMode` is `"automatic"` by default for Numerical Grade levels, or `"manual"` to let teachers enter Final Grade. Automatic mode writes the mean of available configured-term numeric grades into the learner's `gradesByTerm.final` and legacy subject fields; terms with blank grades are excluded from the mean. Letter Grade levels do not use this setting. Unconfigured grade levels default to Numerical Grade with automatic final computation. Letter Grade defaults to ABCDF ranges A=90–100, B=80–89, C=70–79, D=60–69, F=0–59; these equivalencies are editable and support additional rows. Teachers enter letter grades directly; ranges are reference equivalencies. Creating a school year copies saved grade-level grading settings and the passing threshold from the source year, so later edits remain scoped to their own year. The Admin Console reads and edits the configuration for its selected inspection year. Existing deployments can still use the legacy `settings/gradeTerms` document as a fallback for the current year's term count until its year-specific setting is saved or provisioned; historical years without a saved setting use the default. When the term count is reduced, hidden-term values remain in learner `gradesByTerm`; they are not deleted.

New school Firestore projects should bootstrap this settings schema (also declared in `APP_CONFIG.firestore.schoolDefaults.gradeTerms` and `schoolYearDefaults.gradeTerms`):

```js
{
  termCount: 3,
  passingThreshold: 75,
  gradeLevels: {},
  schoolYear: "2026-2027", // year-specific document
  updatedAt: serverTimestamp(),
  updatedBy: "provisioning"
}
```

The root `settings/gradeTerms` legacy document omits `schoolYear` and retains the default threshold for compatibility. Each registered school stores these settings in its own tenant Firestore project; the central `schools/{schoolId}` directory document does not contain grade settings.

Each school's operational data is in that school's tenant Firestore project. Year-specific learner, archive, and grade/section data live under `schoolYears/{schoolYear}`; the curriculum subject pool itself is shared at `settings/curriculumSubjectPool`. `schoolYears/{schoolYear}` stores metadata and `isCurrent`; `settings/currentSchoolYear` is the app-wide current-year pointer. Changing the Admin Console's year selector only changes the year being inspected/edited there. The explicit **Make current** action can select any configured year and changes the app-wide year. New years must be consecutive and later than the latest configured year; creating one copies sections (without advisers), configured curriculum grade assignments, teacher grade/section assignments that still match a copied section, grade-term settings, and grade-level grading types/equivalencies from the source year as editable starting templates.

Teacher assignment history is retained at `users/{uid}/assignmentHistory/{schoolYear}` as `{ schoolYear, assignments: [{ gradeLevel, section, teacherName? }], updatedAt, updatedBy }`. The profile's `teacherAssignments` remains a de-duplicated array across years for compatibility; editing a teacher replaces only the selected year's assignments. Active assignments are also represented by `teachers/{uid}` documents beneath the matching section. Making a future year current never clears prior assignments and records a history snapshot for every teacher; it updates `activeSchoolYear` on teacher profiles. Dashboard views across roles follow a changed current year live, while the Admin Console's year selector remains an inspection-only control. Copied teacher assignments give the new year a starting setup which admins can edit. Learner records are not copied. Publish `firestore.rules` to each school Firebase project for these permissions to apply. For a first-time empty setup, prefer `firestore:bootstrap`; `firestore:provision` is the follow-up tool for provisioning public stats/admin metadata, school-year changes, and migrations. Run `npm run firestore:provision -- --help` before using its maintenance or migration flags. Review and back up real tenant data before any migration or deletion flag.

Before deploying this schema to a tenant that still has the legacy uppercase collections, copy its records into the new paths without deleting the old source data:

```powershell
npm run firestore:provision -- --project SCHOOL_FIREBASE_PROJECT_ID --migrate-v2-schema --dry-run
npm run firestore:provision -- --project SCHOOL_FIREBASE_PROJECT_ID --migrate-v2-schema --service-account "C:\secure\firebase-admin\school-admin.json"
```

The migration copies learner, dropout, transfer, grade, section, and teacher data; it skips existing destination records, retains the source collections, and does not roll back automatically. Back up the tenant first and verify the migrated data before deploying the new app/rules. Do not use `--delete-legacy-sections` as a substitute: that flag is only for the older lowercase `sections` collection.

## 4A. Provision the schema for a newly registered school

The app and the standalone `scripts/provision-test.mjs` use the same year-scoped tenant schema. Create the school's tenant Firebase project and default Firestore database first. The provisioner creates initial year/settings/statistics documents in that tenant project; it does not register the school in the central directory or deploy security rules.

Install dependencies if needed and authenticate with an operator account that can write Firestore in the test project:

```powershell
npm ci
gcloud auth application-default login
```

Preview the plan first. `--project` and `--confirm-project` must be identical; omit `--apply` for a no-write preview:

```powershell
npm run firestore:provision-test -- --project SCHOOL_FIREBASE_PROJECT_ID --confirm-project SCHOOL_FIREBASE_PROJECT_ID --school-year 2026-2027
```

When the displayed target is confirmed, apply the provision:

```powershell
npm run firestore:provision-test -- --project SCHOOL_FIREBASE_PROJECT_ID --confirm-project SCHOOL_FIREBASE_PROJECT_ID --school-year 2026-2027 --apply
```

Alternatively, pass a service-account file kept outside the repository:

```powershell
npm run firestore:provision-test -- --project SCHOOL_FIREBASE_PROJECT_ID --confirm-project SCHOOL_FIREBASE_PROJECT_ID --school-year 2026-2027 --service-account "C:\secure\firebase-admin\school-admin.json" --apply
```

The equivalent `--service-key` option is also accepted.

The provisioner creates only missing documents and leaves any existing documents unchanged:

```text
schoolYears/{year}
settings/currentSchoolYear
settings/curriculumSubjectPool
settings/gradeTerms/years/{year}
publicStats/summary
```

The schema's `users/{uid}`, `schoolYears/{year}/learners/{LRN}`, `schoolYears/{year}/dropouts/{LRN}`, `schoolYears/{year}/transferredOut/{LRN}`, and `schoolYears/{year}/grades/{gradeId}/sections/{sectionId}/teachers/{uid}` are logical collection paths. Firestore does not support empty collections, so no fake user, learner, dropout, transfer, grade, section, or teacher documents are inserted. Those collections appear as real records are added. Register the tenant's public Web App config in the central registry after provisioning, then deploy `firestore.rules` to the tenant before users access it.

## Import learners from the San Roque workbook

After the tenant project has been provisioned with the target school year, use the importer to upload the learner sheet from `scripts/Backup_SanRoqueEs.xlsx`. The default run is a read-only preview: it validates and counts the rows, verifies `schoolYears/{year}` exists, and checks which learner document IDs are already present. It does not print learner details or write data.

Authenticate with Application Default Credentials or provide an Admin service-account file stored outside the repository. The credential needs permission to read and write the tenant's Firestore database. First preview the selected tenant and year:

```powershell
npm run firestore:import-learners -- --project SCHOOL_FIREBASE_PROJECT_ID --confirm-project SCHOOL_FIREBASE_PROJECT_ID --school-year 2026-2027
```

After reviewing the preview, run the same command with `--apply` to write new records:

```powershell
npm run firestore:import-learners -- --project SCHOOL_FIREBASE_PROJECT_ID --confirm-project SCHOOL_FIREBASE_PROJECT_ID --school-year 2026-2027 --service-account "C:\secure\firebase-admin\school-admin.json" --apply
```

The importer reads the matching `Backup_Learners_YYYY_YYYY` sheet and writes documents to `schoolYears/{year}/learners/{LRN}`. Blank school-year cells use the selected year; populated school-year cells must match it. Existing records are skipped by default. Use `--overwrite` only when replacing existing learner data is intended. Add `--include-archives` to also import matching `Backup_Dropouts_YYYY_YYYY` and `Backup_TransferredOut_YYYY_YYYY` sheets when present. The importer does not import users, settings, or public statistics. Keep the workbook and credentials restricted as student data.

For a date-format correction on already imported learners, first preview with `--birthdates-only`. This mode compares the workbook against existing learner IDs and only updates `birthDate` to `YYYY-MM-DD`; it never replaces other learner fields and refuses to apply if any source learner document is missing. Add `--apply` only after confirming the reported counts.

## 5. Deploy the shared tenant Firestore rules

Deploy the same rules file to **each school's tenant project**:

```powershell
npx --yes firebase-tools deploy --only firestore:rules --project SCHOOL_FIREBASE_PROJECT_ID --config firebase.json
```

Use a Firebase CLI account with permission to deploy Firestore rules. Alternatively, the provisioning command can deploy the tenant rules using `--deploy-rules`:

```powershell
npm run firestore:provision -- --project SCHOOL_FIREBASE_PROJECT_ID --school-year 2026-2027 --make-current --deploy-rules
```

That command uses Firebase CLI authentication for rules and Admin SDK credentials for Firestore writes. Do not deploy `school-registry.rules` to a tenant project or `firestore.rules` to the central registry project. Do not replace the production rules with permissive test rules.

To enable automatic Trash cleanup for a tenant, deploy its scheduled function after provisioning:

```powershell
npx --yes firebase-tools deploy --only functions:purgeExpiredTrash --project SCHOOL_FIREBASE_PROJECT_ID --config firebase.json
```

Trash retention is configured in Admin Console → Access management and defaults to 30 days. The scheduled function reads `settings/toggles.trashConfg` and permanently removes expired records from `schoolYears/{schoolYear}/trash` once daily. Choose **Never** to disable automatic cleanup; users can still permanently delete items manually.

### Firebase Authentication account deletion (Spark plan)

Account deletion uses the tenant's AuditLog Apps Script Web App; Firebase Cloud Functions and a Blaze plan are not required. Complete the **Audit log** setup in Section 8 for each school, then set that school's `auditLogApiUrl` to the deployed Web App `/exec` URL. Redeploy the web app after changing its code or Script Properties.

Create a dedicated service account in the tenant Firebase project and grant it:

- **Firebase Authentication Admin** (`roles/firebaseauth.admin`) to delete Authentication users.
- **Cloud Datastore Viewer** (`roles/datastore.viewer`) so the Apps Script can verify the caller's Firestore profile.

Store the complete service-account JSON only in the Apps Script project's `FIREBASE_SERVICE_ACCOUNT_JSON` Script Property. Never put its private key in the app, school registration JSON, or repository. Restrict Apps Script editor access to trusted administrators. The endpoint verifies the caller's Firebase ID token and requires an active School Admin; it blocks self-deletion and accepts up to 100 accounts per request. The Firestore profiles are only removed after Authentication confirms deletion.

## 6. Build the school-registration JSON

Copy [`school-registration.example.json`](./school-registration.example.json) to a separate file, for example `school-registration.sample-es.json`, and replace every placeholder. This file contains public metadata/configuration only. Do not put the Admin SDK service-account JSON inside it.

```json
{
  "id": "sample-elementary",
  "name": "Sample Elementary School",
  "nickname": "Sample ES",
  "tagline": "A welcoming learning community",
  "colorGradientTag": "#50A61E",
  "logoUrl": "/assets/edash/edash.png",
  "videoUrl": "",
  "schoolInfo": {
    "region": "IX",
    "divisionOffice": "Schools Division Office of Davao de Oro",
    "district": "New Bataan"
  },
  "schoolHead": {
    "name": "",
    "position": "",
    "email": "",
    "phoneNumber": ""
  },
  "firebaseConfig": {
    "apiKey": "TENANT_WEB_API_KEY",
    "authDomain": "TENANT_PROJECT_ID.firebaseapp.com",
    "projectId": "TENANT_PROJECT_ID",
    "storageBucket": "TENANT_PROJECT_ID.firebasestorage.app",
    "messagingSenderId": "TENANT_MESSAGING_SENDER_ID",
    "appId": "TENANT_WEB_APP_ID"
  },
  "auditLogApiUrl": "",
  "feedbackApiUrl": ""
}
```

Requirements:

- `id` is a stable lowercase slug, 2–63 characters, using letters, numbers, and hyphens; it becomes the Firestore document ID `schools/{id}`. Avoid changing it after publishing links to a school.
- `name` is required (up to 120 characters); `nickname` is required (up to 64).
- `colorGradientTag` is optional; when supplied, it must be a six-digit hexadecimal color (for example, `#50A61E`). It is copied to `schools/{id}.colorGradientTag` and used as the school's login-page accent.
- `logoUrl` must be a same-site asset path or an HTTPS URL. `videoUrl` is empty or a same-site/HTTPS direct asset URL.
- `schoolInfo` is optional and, when supplied, contains the printable school location map: `region`, `divisionOffice`, and `district` (each a string up to 160 characters). These are written on `schools/{id}.schoolInfo` and prefill the Student Card letterhead.
- All six `firebaseConfig` values must be copied from that school's Firebase Web App settings.
- `schoolHead`, `auditLogApiUrl`, and `feedbackApiUrl` are optional. When provided, school-head fields must be strings and each service URL must be empty or HTTPS.
- The registration script sets `enabled: true`, initializes the `schoolHead` map from this file, and adds server-generated `updatedAt` timestamps to the school document and `schoolHead`. Keep the fields present even when their values are empty; do not add credentials or other sensitive/private data to the public directory document.

Central registry paths and schema:

```text
schools/{schoolId}                              # Public school directory and Firebase Web App config
```

When present, the school document's `schoolInfo` map contains `{ region, divisionOffice, district }` and supplies the Student Card's school letterhead defaults. Its optional `schoolHead` map contains `{ name, position, email, phoneNumber, updatedAt }`; the first four fields come from the registration JSON and `updatedAt` is generated by Firestore. The optional `colorGradientTag` is copied from the registration JSON to the same-named school document field and styles the selected school's login-page accents. Because the central registry rules allow clients to read enabled school documents, these fields are readable by clients. Do not put private information there.

## 7. Register the school in the central directory

The single registration command creates or updates `schools/{id}` in the **central registry project**, not the tenant project. The JSON `id` is the stable document ID: registering the same ID updates that document in place and never deletes/recreates it. Supplied fields overwrite their existing values, omitted fields are retained, nested objects update recursively, and supplied arrays replace their previous arrays. The script forces `enabled: true` and generates `updatedAt` and (when `schoolHead` is supplied) `schoolHead.updatedAt` on the server. Use a central-registry service account with Firestore write permission, or ADC authorized to write there.

First validate the JSON without making changes:

```powershell
npm run registry:register-school -- --registry-project CENTRAL_REGISTRY_PROJECT_ID --registration-file ".\school-registration.sample-es.json" --dry-run
```

Then register it. If Firebase CLI is already logged into an account authorized to deploy the central rules, `--deploy-rules` deploys `school-registry.rules` via `firebase.registry.json` before writing the registration:

```powershell
npm run registry:register-school -- --registry-project CENTRAL_REGISTRY_PROJECT_ID --registration-file ".\school-registration.sample-es.json" --service-account "C:\secure\firebase-admin\registry-admin.json" --deploy-rules
```

Omit `--service-account` to use `GOOGLE_APPLICATION_CREDENTIALS` or Application Default Credentials. Admin SDK credentials are for the Firestore write; Firebase CLI login is for the optional rules deployment. The central service-account key must have access to the **central** project, not merely the school tenant.

## 8. Configure Apps Script services

Each script below is an independent Apps Script Web App. Create/deploy a separate Web App endpoint for each service, execute it as the trusted owner/account that can access its spreadsheet, authorize requested Google scopes, and test its `/exec` URL. The app-level school registration endpoint is configured with `VITE_SCHOOL_REGISTRATION_API_URL`; tenant endpoints are configured in each school's registration JSON.

### School registration requests

1. Create a separate Google spreadsheet for central E-Dash school registration requests.
2. Open **Extensions → Apps Script**, paste `apps-script/SchoolRegistration.gs`, and run `setupSchoolRegistrationSheet()` once to create and format the `Registration Requests` tab.
3. Deploy the script as a Web App that executes as the spreadsheet owner. Set access to **Anyone** so schools can submit without an E-Dash account. Limit spreadsheet and script editor access to the administrators who review requests.
4. Set `VITE_SCHOOL_REGISTRATION_API_URL` to the deployed HTTPS `/exec` URL in local `.env.local` and the central Vercel project's environment settings. Restart Vite locally or redeploy Vercel after changing this build-time variable.

The school-selection form collects school name, DepEd school ID, contact person, email, phone, and schools division. Requests are recorded with `Pending` status and do not automatically create or enable a Firestore school. While a request is pending, repeat requests are detected by school ID, email, or a normalized/similarity comparison of the school name, and the requester is told that a request is already pending. Review and verify each request before adding it to the central directory. Keep the request spreadsheet private.

### Audit log

1. Create a private Google spreadsheet for the school's audit log.
2. Create a standalone Apps Script project, paste the contents of `apps-script/AuditLog.gs`, and set Script Properties under **Project Settings → Script Properties**:
   - `AUDIT_SPREADSHEET_ID` — ID of the audit spreadsheet.
   - `FIRESTORE_PROJECT_ID` — tenant Firebase project ID.
   - `FIREBASE_WEB_API_KEY` — tenant Firebase Web App `apiKey` (public Web App config, not a private key).
   - `FIREBASE_SERVICE_ACCOUNT_JSON` — the complete privileged service-account JSON as a Script Property. Restrict editor access to this Apps Script project; never put this value in the repo or school registration JSON.
3. Grant the service account **Firebase Authentication Admin** (`roles/firebaseauth.admin`) for Auth account deletion and **Cloud Datastore Viewer** (`roles/datastore.viewer`) to read the caller's Firestore profile. These roles do not require a Blaze plan.
4. Deploy as a Web App that executes as the script owner, allow access to **Anyone**, and copy its `/exec` URL to `auditLogApiUrl`. The endpoint validates the caller's Firebase ID token and admin role itself; do not restrict the Web App to a Google account sign-in, which would prevent browser calls.

The app sends Firebase ID tokens to this endpoint. Whenever `AuditLog.gs` is changed, deploy a new Web App version; saving the script alone does not update the live endpoint. If the endpoint reports Firebase authentication failure, check its response code: make sure `FIREBASE_WEB_API_KEY` is the `apiKey` from this school's Firebase Web App and that it matches the project in `FIRESTORE_PROJECT_ID`; if the error is `API_KEY_SERVICE_BLOCKED`, allow Identity Toolkit API requests for that key. A rejected `INVALID_ID_TOKEN` may be resolved by signing out and back in. Audit rows contain controlled event metadata/allowlisted status fields, not learner profiles. Protect the spreadsheet and Apps Script editor access.

The read-only Parent Portal uses a separate Firebase app instance with **Anonymous** Authentication to request a single learner document by its 12-digit LRN. Enable **Authentication → Sign-in method → Anonymous** for the tenant project and deploy the latest `firestore.rules`. The rule permits anonymous `get` requests only for learner documents not marked dropped or transferred; optional status fields omitted from older/imported documents are treated as unset. It does not permit anonymous collection queries, archive reads, or writes.

### Feedback

1. Create a private spreadsheet for feedback, open its **Extensions → Apps Script** editor, and use the resulting spreadsheet-bound project.
2. Paste `apps-script/Feedback.gs`. Set its `FIREBASE_WEB_API_KEY` constant to the tenant's Firebase Web App `apiKey`; this is a public Firebase Web API key, never a service-account private key.
3. Run `setupFeedbackSheet()` once in the script editor and authorize it. This creates/formats the `Feedback` tab.
4. Deploy as a Web App and copy its `/exec` URL to `feedbackApiUrl`.

Feedback submissions require an authenticated user and valid ratings. Restrict spreadsheet and script editor access; review the deployed Web App's execution/access settings for your intended user audience.

### Tenant database JSON backup and restore

School administrators can use **Admin Console → Database backup** to export a structured JSON file or restore from one. Export and import run in the signed-in browser against the selected tenant project and do not require gcloud, a billing account, Google Sheets, Apps Script, or a service account.

The backup includes the app-managed documents in `users` and their `assignmentHistory` subcollections; `schoolYears` and their learner, dropout, transferred-out, grade, section, and teacher documents; all root `settings` documents and `settings/gradeTerms/years`; and `publicStats/summary`. Firestore timestamps, dates, and geographic points use tagged JSON values so they can be restored to their Firestore types. Backups are tenant-bound and schema-versioned; import rejects another school's file, incompatible versions, unsupported paths, duplicates, invalid data, and files that omit the currently signed-in active School Admin account.

Before importing, select a mode:

- **Replace** overwrites imported documents and deletes existing E-Dash-managed documents absent from the file.
- **Merge** applies the imported fields to each matching document, preserving existing fields not supplied in the file; new document paths are created, and existing documents absent from the backup remain unchanged.
- **Extend** creates only document paths that do not already exist; existing matching documents are skipped unchanged.

All three modes are limited to the supported E-Dash-managed paths. They cannot clear or modify arbitrary/custom Firestore collections or Firebase Authentication users, passwords, and credentials. Before changing data, the browser downloads a separate safety JSON backup of the current app-managed data. Restore writes are chunked and are not atomic; an interrupted restore may leave a partial result, so use that safety file to restore the prior state.

## 9. Run locally and deploy the web app

The app uses central registry values as Vite build-time environment variables:

```powershell
npm ci
npm run dev
npm test
npm run build
```

For Vercel, configure the same six `VITE_REGISTRY_FIREBASE_*` values in the deployment's environment settings, then redeploy. `VITE_MAINTENANCE_MODE` and `VITE_TEST_MODE` are optional flags; do not put secrets in any `VITE_*` variable because Vite embeds them in the browser bundle. The provided `vercel.json` rewrites app paths to `index.html`; Firebase Hosting settings are in `firebase.json`.

After deployment, visit the site, select the new school, sign in with the administrator Auth account, and verify Firestore reads/writes. Verify audit log and feedback separately if configured. Confirm that the school appears only when its central registry document has `enabled: true`.

## 10. Enable account profile-photo uploads

This feature uses Cloudinary for image storage/delivery and the tenant's Firestore user document for the image URL:

- The user selects a photo on **Settings → Upload** and positions it in a circular crop preview.
- The browser creates a 512 × 512 JPEG crop, then sends it directly to Cloudinary using an unsigned upload preset.
- After Cloudinary responds successfully, the app saves its HTTPS delivery URL as `photoURL` on `users/{uid}`.
- The shared topbar and account card render the photo on every app page. Signing in to the same account from another browser/device loads the same URL from that tenant's Firestore profile.
- Firestore stores only the URL, not image bytes. Cloudinary serves resized/optimized avatar versions.

The Cloudinary **cloud name** and **unsigned preset name** are public browser configuration. Do not use an API secret, Admin SDK key, or other private credential in the frontend.

### Part A: Create and secure a Cloudinary upload preset

1. Sign up or sign in at [Cloudinary](https://cloudinary.com/). Create/select the Cloudinary **product environment** that will own the profile images.
2. Open **Console → Settings → Upload** and find **Upload presets**. Choose **Add upload preset**.
3. Create a preset with a clear name, such as `edash_profile_photos`. Enter the preset name exactly as shown; it is case-sensitive for the app configuration.
4. Set **Signing Mode** to **Unsigned**. The app uploads from a browser and cannot safely hold a Cloudinary API secret.
5. Restrict the preset:
   - Allow only image formats: `jpg`, `jpeg`, `png`, and `webp`.
   - Set **Maximum file size** to `5 MB`.
   - Set a fixed folder/asset folder such as `edash/profile-photos`, using the folder option exposed by your Cloudinary account. Do not accept a user-provided folder or upload path.
   - Leave overwrite disabled. The app does not specify a public ID, so Cloudinary generates a unique asset ID for each upload.
   - Do not allow `raw` files or video uploads in this preset.
6. Save the preset. In the Cloudinary Console, note:
   - **Cloud name** — shown in the product environment details.
   - **Upload preset name** — the exact name you just saved.
7. Keep this preset dedicated to profile pictures. Unsigned presets are intentionally callable by anyone who knows the cloud name and preset name; the preset restrictions and Cloudinary usage monitoring are important safeguards.

The app accepts JPG, PNG, and WebP files up to 10 MB before editing. It converts the selected crop to a 512 × 512 JPEG before upload, which should be below the preset's 5 MB limit. If you change the preset limit substantially, test the upload with real photos.

### Part B: Configure local development

1. From the repository root, open the existing `.env.local` (create it from `.env.example` if it does not exist). Add or update these entries:

   ```dotenv
   VITE_CLOUDINARY_CLOUD_NAME=your_cloud_name
   VITE_CLOUDINARY_UPLOAD_PRESET=edash_profile_photos
   ```

   Replace the example values with the Cloudinary values from Part A. Do not include angle brackets or quote marks. Do not add `VITE_CLOUDINARY_API_SECRET`.

2. Confirm `.env.local` is ignored by Git. Never commit real environment files.
3. Restart the Vite dev server after editing `.env.local`; Vite embeds `VITE_*` values into the frontend at build/start time. Open **Settings** after signing in. If configuration is missing, the upload button reports that the administrator must configure Cloudinary.

### Part C: Configure each deployed E-Dash build

For every Vercel project that builds this app:

1. Open the Vercel project → **Settings → Environment Variables**.
2. Add:
   - `VITE_CLOUDINARY_CLOUD_NAME` = the Cloudinary cloud name.
   - `VITE_CLOUDINARY_UPLOAD_PRESET` = the unsigned preset name.
3. Select the environments that should have photo uploads (typically **Production**, **Preview**, and **Development** if used). Save the variables.
4. Redeploy so the new values are included in the generated frontend bundle. Repeat this configuration for every separately deployed E-Dash app that should use the preset.

The Firebase tenant is selected at runtime, but these Cloudinary values are build-time frontend settings. With the current multi-school design, schools using the same deployed app share its configured Cloudinary environment and preset; each school's profile URL remains in that school's own Firebase project's Firestore. This does not make a profile shared between separate school accounts/projects.

### Part D: Deploy the Firestore permission change

The app writes `photoURL` to the signed-in user's existing `users/{uid}` document. Firestore rules must allow that user to change only their own permitted profile fields and accept only a bounded HTTPS Cloudinary URL.

1. Review the changed `users` rule in [firestore.rules](./firestore.rules).
2. Deploy the rules to **each tenant Firebase project** used by an app build. In PowerShell, replace the project ID with the tenant's actual Firebase project ID:

   ```powershell
   npx --yes firebase-tools login
   npx --yes firebase-tools deploy --only firestore:rules --project SCHOOL_FIREBASE_PROJECT_ID --config firebase.json
   ```

   Repeat the deploy command for every separate school/tenant project. The Firebase CLI identity must have permission to deploy Firestore rules to each project. Deploying to the central school-registry project does not update tenant rules.

### Part E: End-to-end test

1. Run locally with the configured `.env.local`, or open the newly redeployed site.
2. Sign in with a normal, active school account and open **Settings**.
3. Choose **Upload**. Test with a JPG, PNG, or WebP image no larger than 10 MB.
4. In the photo editor, drag the image to reposition it and adjust the zoom slider. Choose **Upload photo**.
5. Confirm the success message and verify the new photo appears in both the Settings account card and the topbar.
6. Reload the page, navigate to another authenticated page, and confirm the topbar photo remains.
7. Sign into the same school account on another browser/device and verify that its photo loads there too.
8. Try replacing the image and then **Remove photo**. Removing clears the Firestore URL and restores the initials avatar.
9. Verify an account cannot change another user's Firestore document or update unrelated fields on its own profile. The Cloudinary URL is public; do not upload images that should remain private.

For a browser-level diagnostic, open Developer Tools → **Network** while uploading. The Cloudinary request should go to `api.cloudinary.com` and return a successful response with a `secure_url`; a later Firestore write should update `users/{signed-in-uid}` with `photoURL`. Do not share network captures that contain Firebase ID tokens.

### Security, costs, and operations

- Client-side file checks improve the user experience; they are not a security boundary. The Cloudinary upload preset must enforce formats, maximum size, allowed resource type, and fixed storage location.
- Monitor Cloudinary storage, transformations, and delivery usage in its Console. The feature uploads a new unique image for each change; repeated changes may leave old assets in Cloudinary.
- **Remove photo** clears the Firestore URL and stops displaying the image, but does not delete the Cloudinary asset. Clean up abandoned assets manually in Cloudinary, or build a trusted server-side cleanup process if automatic deletion and retention are requirements.
- Cloudinary profile delivery URLs are public. Only upload profile images that are appropriate for public delivery.
- For tighter abuse prevention, per-user quotas, or private media, replace unsigned browser uploads with a trusted backend that verifies Firebase ID tokens and creates short-lived signed upload parameters. Keep the Cloudinary API secret on that backend only; never sign uploads in the browser.
- Profile photos are shared across pages, browsers, and devices only when the user signs in to the same account in the same tenant Firebase project. Separate school Firebase projects have separate user profiles.

Cloudinary's current references: [managing upload presets](https://cloudinary.com/documentation/upload_presets), [uploading images](https://cloudinary.com/documentation/upload_images), and [image transformations](https://cloudinary.com/documentation/image_transformations).

### Troubleshooting

| Symptom | What to check |
| --- | --- |
| Upload button says Cloudinary is not configured | Both `VITE_CLOUDINARY_*` values are present in `.env.local` or the deployed build's environment variables. Restart Vite or redeploy after setting them. |
| Cloudinary returns `401`/`400` or says preset is missing | Cloud name is correct; the preset exists in that Cloudinary product environment; preset name matches exactly; preset signing mode is **Unsigned**. |
| Cloudinary rejects the file | Confirm JPG/PNG/WebP, original size no greater than 10 MB, and a preset size limit that accepts the generated 512 × 512 JPEG. Check preset allowed formats and resource type. |
| Cloudinary request is blocked by the browser | Confirm the network can reach `https://api.cloudinary.com` and check browser extensions, firewall, or organization network restrictions. |
| Image upload succeeds but Firestore shows `permission-denied` | Deploy the updated `firestore.rules` to the exact tenant project selected by the app. Confirm the user is signed in, the profile document ID is their Auth UID, and the saved URL is an HTTPS Cloudinary `image/upload` URL. |
| Firestore saves the URL but image is broken | Inspect `photoURL` in `users/{uid}` and test its `secure_url` in a browser. Confirm the Cloudinary asset is not deleted and its delivery URL is accessible. |
| Photo appears locally but not after reload/on another device | Confirm Firestore save succeeded, the second session is the same account and tenant project, then sign out/in or reload to fetch the latest profile. The image is not shared across separate school Firebase projects. |
| Removing the photo does not reduce Cloudinary storage | Expected: removal clears only the Firestore URL. Delete the old asset from Cloudinary or implement trusted server-side cleanup. |

## 11. Updating an existing school

- To change public branding or an Apps Script endpoint, edit the school's registration JSON and rerun `registry:register-school` with the same `id`. This updates the existing document; omitted fields remain unchanged. To update school-head fields, include them in the JSON; omitted school-head fields are retained.
- To change a tenant's Firestore structure or migrate legacy data, inspect `scripts/provision-firestore.mjs`, use `--dry-run` where supported, make a current backup, and read `npm run firestore:provision -- --help` before running migration flags.
- When shared tenant authorization changes, deploy `firestore.rules` to every tenant project. Deploy central registry changes separately using `firebase.registry.json`.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| App reports missing central registry config | All six central `VITE_REGISTRY_FIREBASE_*` settings are present in `.env.local`/Vercel; restart Vite or redeploy after edits. |
| No schools appear | Central project ID is correct; `schools/{id}` exists and has `enabled: true`; central rules are deployed; browser Web App config points to that project. |
| Bootstrap or registration says default credentials are missing | Use `--service-account "C:\secure\...\key.json"` or configure ADC. A Firebase CLI login alone does not authenticate Admin SDK Firestore writes. |
| Rule deployment is denied | Run Firebase CLI login with an account allowed to deploy rules to that exact project; choose the correct project ID and config file. |
| Tenant reads/writes are denied | Confirm tenant rules deployed from `firestore.rules`, Auth UID matches `users/{uid}`, and its profile is active with the intended role. |
| Apps Script returns permission errors | Check Script Properties, spreadsheet sharing, script owner/execution settings, service-account IAM role, and that the project ID is the tenant project. |
| Feedback/audit endpoint does not respond | Use the deployed HTTPS `/exec` URL for the matching service; confirm Web App deployment version/access; update the registry document and wait for the app's short school-directory cache to expire or reload. |

## Security checklist

- Keep service-account key files outside the repository. `.gitignore` excludes common downloaded Admin SDK key names, but ignore rules do not remove a key that was already committed. If a private key was ever committed, uploaded, or shared, revoke it and create a replacement.
- Use separate service accounts for tenant provisioning, central registry writes, and audit integration where practical. Grant only required project-level roles.
- Treat learner data, downloaded JSON backups, feedback, audit logs, and Apps Script project settings as restricted school data.
- Keep Firestore rules restrictive. The app's UI role checks are not a security boundary; Firestore rules and trusted backends must enforce access.
- Use public Firebase Web App settings only in browser-facing config. Never use service-account credentials as Firebase client settings.
