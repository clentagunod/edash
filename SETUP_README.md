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

For a desktop alternative, run `conda activate provisionenv` and `python main.py` from the root to open **Edash Provision**. Its Tenant provision mode includes the documented defaults, custom JSON structure support, optional service-key authentication, rule/index checkboxes, offline dry run, command preview, and logs. Registration mode handles central school entries separately. The app is self-contained in `main.py` plus `src/edash_provision/`; see the [desktop guide](./src/edash_provision/README.md) for dependencies and how to copy it into another project. Its optional initial administrator profile requires an existing Firebase Authentication UID.

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
schoolYears/{schoolYear}/learners/{learnerId}             # includes anecdotalRecords: string (default "")
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

## EduAI no-Blaze plan setup

**You do not need Firebase Blaze or Firebase Cloud Functions for EduAI.** The app keeps sign-in, tenant school data, and chat history in the existing Firebase projects. A separate Cloudflare Worker handles provider calls, and a Cloudflare D1 database stores encrypted provider keys and usage totals. You need a Cloudflare account (the free Workers plan is sufficient to start), a Gemini API key only if you want shared Default usage, and provider API keys only for users who choose BYO.

| Service | Purpose | Billing note |
| --- | --- | --- |
| Existing Firebase Auth and Firestore (Spark) | Staff sign-in, tenant school records, preferences, chat history, central school entitlement | No Firebase Cloud Functions are used. Keep within Firebase Spark quotas. |
| Cloudflare Workers | Authenticated API gateway for EduAI | Free plan includes 100,000 requests/day and 10 ms CPU/request at the time of writing. |
| Cloudflare D1 | Encrypted provider credentials and per-user/per-provider usage totals | Free plan includes 5 million rows read/day, 100,000 rows written/day, and 5 GB total storage at the time of writing. |
| AI providers | Model inference | Free-tier availability/quotas vary. BYO users are responsible for their provider account and charges. |

Cloudflare free quotas are not a guarantee of unlimited capacity. Exceeding a daily limit can temporarily stop the Worker or D1 requests until reset. Review [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/) and [D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/) before enabling real school data. Vercel Hobby also has a separate non-commercial-use restriction; the Worker does not change the terms of the Vercel frontend host.

### One-time deployment

1. Confirm the central registry school document has `enabled: true` and boolean `canUseEduAI: true`. The gateway checks this on every call; disabling the flag blocks requests without rebuilding the app.
2. In Cloudflare, create or sign in to an account and install the Worker package from the repository root:

   ```powershell
   npm ci --prefix worker
   npx wrangler login --cwd worker
   ```

3. Create the D1 database and copy the returned `database_id` into `worker/wrangler.toml`, replacing `replace-after-running-wrangler-d1-create`:

   ```powershell
   npm run db:create --prefix worker
   ```

4. Edit `[vars]` in `worker/wrangler.toml`:
   - `REGISTRY_PROJECT_ID`: the Firebase project ID for the central school directory.
   - `REGISTRY_FIREBASE_API_KEY`: the public web API key in the existing root `.env.local` under `VITE_REGISTRY_FIREBASE_API_KEY`. This is a public Firebase web config value, not a service-account key.
   - `ALLOWED_ORIGINS`: comma-separated exact origins that host the app. Include the production origin (for example, `https://dashboard.example.edu`) and `http://localhost:5173` for local testing. Do not put URL paths or trailing slashes here.
5. Apply the D1 schema:

   ```powershell
   npm run db:migrate:remote --prefix worker
   ```

6. Add the encryption secret. Generate a random 32-byte value, copy it somewhere secure, and paste it into the prompt:

   ```powershell
   node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"
   npx wrangler secret put EDUAI_CREDENTIAL_ENCRYPTION_KEY --cwd worker
   ```

   Do not regenerate this value after users save keys: existing ciphertext cannot be decrypted with a replacement. To enable the shared Default Gemini option, create a key in [Google AI Studio](https://aistudio.google.com/app/apikey) and set it too:

   ```powershell
   npx wrangler secret put GEMINI_API_KEY --cwd worker
   ```

   Shared Gemini is optional. Personal-provider mode only needs the encryption secret; each user supplies their own provider key in AI settings.
7. Deploy the Worker and copy the URL printed by Wrangler (typically `https://edash-eduai-gateway.<account>.workers.dev`):

   ```powershell
   npm run deploy --prefix worker
   ```

8. Set `VITE_EDUAI_API_URL` to that Worker URL in the root `.env.local` for local development. Add the same variable to the Vercel project's Environment Variables for Production (and Preview if you use it), then redeploy the frontend. This URL is public, not a secret. `.env.example` lists the frontend variables.
9. Start local development and confirm EduAI settings load:

   ```powershell
   npm run dev
   ```

   Local API requests can go directly to the deployed Worker; `ALLOWED_ORIGINS` must include `http://localhost:5173`. To run the gateway locally instead, copy `worker/.dev.vars.example` to `worker/.dev.vars`, set a random local encryption key there (and `GEMINI_API_KEY` only if testing shared Gemini), then run `npm run db:migrate:local --prefix worker` followed by `npm run dev --prefix worker` in a second terminal. Point local `VITE_EDUAI_API_URL` to `http://localhost:8787`. No provider API key belongs in `.env.local` or any `VITE_*` variable.
10. Test the Default option if the shared Gemini secret was set. Then configure a personal provider with a test user, send a synthetic-data question, confirm that usage is per user/provider, switch back to Default, remove the saved key, and test a provider quota error. Do not use real learner data until the school approves the provider's data processing.

The Worker runs independently from the Firebase projects. You do **not** deploy Firebase Functions, upgrade to Blaze, add a service-account JSON file, grant cross-project IAM roles, or store user API keys in tenant Firestore. The tenant's existing Firestore rules still control its user profile and learner-record reads; the server checks the active role and rebuilds model context from the tenant data instead of trusting context sent by the browser. Chat history remains in the tenant Firestore under the signed-in user's existing conversation path. Provider credentials and usage totals live in the central D1 database, keyed by both the central `schoolId` and Firebase `uid`, with provider keys encrypted using AES-256-GCM.

### Role and student-data scope

- Open **AI settings** to select **Default** (shared school Gemini) or **I have my own provider options** (Groq, OpenAI, Gemini, Claude, DeepSeek, Mistral, or OpenRouter). The personal-provider model ID is editable; endpoint entry is pre-filled and server-validated against that provider's official HTTPS host/path to prevent arbitrary URL requests and SSRF. Keys are write-only in the UI, encrypted using the Worker encryption secret, and only decrypted for the request. Users can replace or remove their saved key. The UI also displays successful request/token usage for the current UTC month; provider free allowances are not universal and remain controlled by each vendor.
- Settings include a maximum reply length (256–2,048 output tokens), creativity (0.0–0.6), request timeout (30–120 seconds), previous messages (0–8), and learner-name inclusion (0–150). Preferences are private to the signed-in account at `users/{uid}/eduaiSettings/preferences`; role defaults live in `settings/eduai`. Defaults set teachers to share no learner names unless they deliberately change the setting. **Reset role defaults** only removes the personal response preferences, not provider credentials.
- The shared model choices are an allowlist and may not be enabled for every Google AI Studio key. See [Gemini model availability](https://ai.google.dev/gemini-api/docs/models) and [current pricing/free-tier eligibility](https://ai.google.dev/gemini-api/docs/pricing). EduAI never silently switches a provider or model. A provider quota/billing exhaustion response displays an actionable notice; ordinary rate limiting and temporary outages are shown separately.
- EduAI reloads the signed-in user's Firestore profile and requires an active `School Admin`, `Registrar`, or `Teacher` role before reading data.
- Teachers use the existing teacher-scoped learner reader; the assistant receives only the scoped aggregates and names, not a school-wide total. Registrars and school administrators receive school-wide aggregates and names.
- The model context includes aggregate counts, role-scoped chart data, and at most 150 learner names. Graph context covers Dashboard/Reports enrollment and program charts, Reading (CRLA and Phil-IRI), Math (RMA), and Nutritional Status charts. For profile graphs, only counts and percentages by grade/category/assessment period are sent; nutritional charts include aggregate category counts and percentages. No individual assessment or health records, learner IDs, age, marks/grades, attendance, contact details, guardian details, heights, or weights are sent. This includes sensitive aggregate profile categories, so use only with school approval. Recommendations must be general and non-diagnostic; EduAI must not identify or infer an individual outcome from a chart.
- The available context is not an audit of all website activity. It includes only current-school-year learner records in the active user's server-verified role scope. Use **Refresh data** to refresh the client workspace; each model call also rebuilds the context from Firestore. Admin-console records, audit logs, feedback, and other users' profiles are not loaded for the model.
- Each chat is saved per user in that tenant's Firestore and can be reopened or deleted in EduAI. The UI loads up to 25 recent conversations and the last 40 messages in the selected conversation; **Previous messages included** controls how many recent messages are sent to the selected provider.
- E-Dash usage help is curated in `functions/eduai-knowledge.json`, with all registered pages covered. The shared `functions/eduai-guide.mjs` selects relevant, complete, role-allowed workflows (up to eight entries / 14,000 characters); `src/lib/eduai-knowledge.ts` re-exports that same retrieval implementation for verification. `functions/eduai-role-policies.json` supplies role guidance separately on every request. The gateway verifies the active profile, scopes Teachers to current-year assignments, and reads allowlisted school toggles for conditional features such as teacher progression. Unreadable settings remain unverified. This is product guidance and a bounded snapshot, not access to private account/audit records, files, or the user's browser. Update it when routes, roles, or workflows change; route-coverage tests flag undocumented pages. See [EduAI context maintenance](./functions/EDUAI_CONTEXT.md). Redeploy the Worker after changing knowledge, policies, prompts, or server context; local edits/frontend deployment alone do not update the gateway.
- When EduAI loads the current school year, it builds bounded chart summaries from the same tenant Firestore learner records available to the signed-in role. Teacher summaries therefore use only their assigned sections. Chart context includes current-year aggregates, not page-specific UI filters, historical years, or live graph screenshots; use **Refresh data** after updates. Graph labels and values are normalized and sent as structured data so the assistant can compare series and explain trends rather than guessing from pixels.
- The current implementation deliberately permits names only as the individual-level student data, per the requested scope. A learner name is still personally identifiable information. Review the selected provider's current data-use, retention, and pricing terms and applicable school/student privacy rules before sending real learner names. Use synthetic data for tests; obtain school approval before processing real learner data.

### Backend security and limits

- The Cloudflare Worker verifies Firebase ID tokens, checks the enabled central registry record, and uses the caller's token to read the caller's tenant profile, assignments, and school records through Firestore Security Rules. It rebuilds active school-year context server-side: teachers are limited to their assigned active sections; registrars and school administrators receive the school-wide aggregate. The browser does not submit model context or product-guide text and cannot access provider credentials or usage totals stored in D1. Provider endpoint hosts and exact API paths are allowlisted, redirects are rejected, upstream errors are sanitized, and API keys are never logged or returned. Prompt, role limitations, history count, context size, output settings, and learner-name limit are validated server-side. Tenant Firestore rules remain the data-access boundary for conversations and preferences.
- Per-user and per-provider usage totals count successful calls and provider-reported tokens only; some APIs do not report usage. EduAI does not impose or estimate a universal free quota. A provider-reported quota/billing error triggers the free-usage notice; users should consult their provider dashboard.

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

In Trash, School Admins can view all records for the selected school year. Teachers can view and manage only records for their assigned grade/section; other roles do not have Trash access. Deploy the latest `firestore.rules` for this restriction to be enforced. An Admin's first Trash load also fills in assignment keys on existing teacher profiles and legacy Trash records.

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

Each script below is an independent Apps Script Web App. Create/deploy a separate Web App endpoint for each service, execute it as the trusted owner/account that can access its spreadsheet, authorize requested Google scopes, and test its `/exec` URL. School registration uses the server-only Vercel relay variables described below; tenant audit and feedback endpoints are configured in each school's registration JSON.

### School registration requests

1. Create a separate Google spreadsheet for central E-Dash school registration requests.
2. Open **Extensions → Apps Script**, paste [gscripts/SchoolRegistration.gs](./gscripts/SchoolRegistration.gs), and set `SPREADSHEET_ID`, `REGISTRATION_SHARED_SECRET` (at least 32 characters), and `REGISTRATION_BASE_URL` (`https://register.edash.online/`) in Script Properties. Run `initializeRegistrationSheets()` to create the **Requests** and **Registrations** tabs. An authenticated first submission can also initialize missing/empty tabs safely.
3. Deploy the script as a Web App that executes as the spreadsheet owner. Set access to **Anyone** so schools can submit without an E-Dash account. Limit spreadsheet and script editor access to the administrators who review requests.
4. In Vercel, set server-only `SCHOOL_REGISTRATION_SCRIPT_URL` to the deployed `/exec` URL and `SCHOOL_REGISTRATION_SHARED_SECRET` to the same Script Property secret. Redeploy Vercel after changing environment variables. The browser calls `/api/school-registration`; the old `VITE_SCHOOL_REGISTRATION_API_URL` is no longer used. Never place the shared secret in a `VITE_*` variable.

The school-selection form collects school name, DepEd school ID, contact person, email, phone, and schools division. Requests are recorded in **Requests** with `Pending` status and do not automatically create or enable a Firestore school. Repeat submissions with the same school ID and email return the existing request instead of inserting another row. Staff review a request and manually send an invitation; the completed profile is saved in **Registrations**. See [School registration setup](./SCHOOL_REGISTRATION_SETUP.md) for the complete two-stage workflow and diagnostics. Keep the spreadsheet private.

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

The Admin Console Audit Log loads 10 newest entries per request, with previous/next pagination. Search is limited to the currently loaded page so the browser and Apps Script do not read the entire spreadsheet. Deploy the latest `AuditLog.gs` Web App version to enable paginated responses.

The read-only Parent Portal uses a separate Firebase app instance with **Anonymous** Authentication to request a single learner document by its 12-digit LRN. Enable **Authentication → Sign-in method → Anonymous** for the tenant project and deploy the latest `firestore.rules`. The rule permits anonymous `get` requests only for learner documents not marked dropped or transferred; optional status fields omitted from older/imported documents are treated as unset. It does not permit anonymous collection queries, archive reads, or writes.

School-specific QR destinations use `https://<your-edash-domain>/parent/<school-registry-id>`. Copy the full link from **Admin Console → Access management → Flags & configurations → Parent Portal access → School-specific parent portal link**, then use that URL when creating the school's QR code. The ID in the URL is the document ID in the central registry's `schools` collection (for example, `/parent/sample-elementary`). New enabled school registrations work with the same route without code or routing changes. Links resolve a single registration and keep the portal's school selection within the current tab. Missing, disabled, or invalid registrations never fall back to another school's records. Parent Portal access controls and anonymous-authentication requirements still apply.

For SRES COE printing, set the official school ID in the central registry at `schools/<school-registry-id>.schoolInfo.id`. Strings preserve leading zeros; numeric IDs are also accepted. This printed ID is separate from the registry document ID used in parent portal URLs.

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

**Tenant database backup** and **Import students** are separate collapsible sections, initially closed. Collapsing either section preserves its selected options and prepared review. After choosing **Restore JSON**, validation prepares a summary showing the filename, school, export date, restore mode, document/student/user totals, school years, and a brief breakdown of other records. No writes occur during this review. Choose **Review and restore**, then accept the final confirmation to start the restore. **Cancel restore** discards the prepared file. Changing restore mode also clears the prepared review and requires selecting the file again, so the summary always matches the operation being confirmed.

All three modes are limited to the supported E-Dash-managed paths. They cannot clear or modify arbitrary/custom Firestore collections or Firebase Authentication users, passwords, and credentials. Before changing data, the browser downloads a separate safety JSON backup of the current app-managed data. Restore writes are chunked and are not atomic; an interrupted restore may leave a partial result, so use that safety file to restore the prior state.

### Import students from datasets

Below Tenant database backup, **Import students** adds student records to the selected school's existing school year. This is separate from restoring an E-Dash tenant backup. Use an active School Admin account, and configure the target year's grades and sections first.

1. Optionally choose **Export template** to download example student JSON for manual entry or data preparation. Replace the example LRN and personal details. Templates include the selected school ID and year; generated JSON from another school is rejected.
2. Choose the target school year, grade level, and section. Grade and section choices come only from that year's configured school structure; the section list follows the selected grade. Every imported student is assigned to this placement, and grade/section columns in the file are ignored. Changing the placement requires another scan. Choose month/day/year for SF1 dates, or day/month/year for datasets using that convention. ISO dates remain `YYYY-MM-DD` regardless of this setting.
3. Click **Import students** and select a file. Content detection supports JSON object arrays, JSON Lines, labelled JSON matrices, CSV/TSV and other delimited text, legacy/modern Excel, ODS, Spreadsheet XML, and HTML tables, even with a different extension. Encrypted files, images, PDF, and arbitrary proprietary datasets are not supported. Limits are 10 MB, 20,000 worksheet rows, 256 columns, and 30 worksheets; import one worksheet at a time.
4. Choose the worksheet, then **Scan and validate**. The reader finds LRN/Learner ID and name labels instead of assuming the first row is a header. It combines merged parent/child headers into logical column labels without filling merged student values across rows. Header depth can be adjusted for unusual multi-row tables. SF1 totals and its remarks/signature footer are excluded.
5. Review matched/ignored columns, source-row errors, warnings, and the first ten normalized students. Unknown columns and empty optional values are omitted, except missing guardian names and contact numbers, which automatically become `N/A` in the preview, normalized JSON, and saved records. This also applies when these columns are absent. Common unavailable markers such as `n/a`, `none`, and `not available` normalize to `N/A`. Complete these details later by editing the student in the Masterlist. In update mode, placeholders fill missing saved details and preserve already-recorded guardian names/contact numbers. Required values are a 12-digit LRN, first/last name (or a comma-separated `Last, First, Middle` name), and a grade/section configured for the selected year. Birthdates are validated and normalized to `YYYY-MM-DD`; age is recalculated to match the learner form. Ambiguous names, duplicate labels/LRNs, invalid dates/values, spreadsheet errors in matched cells, and conflicting school years block upload. No partial valid-row import is offered when the file has errors.
6. Existing LRNs default to **Skip existing students**. **Update matched fields** updates nonempty recognized fields and assigns the selected grade/section, preserving other saved values. Updating existing students can therefore change their placement; the final confirmation names the target grade and section. Archived/transferred LRNs must be resolved through the normal learner workflow before import. This tool imports active student records and scalar fields, not accounts, arbitrary collections, nested grades-by-term maps, or archive history.
7. **Review and upload** asks for final confirmation. Nothing is written before this step. Writes use small transactions with duplicate/archive checks repeated at upload time. Multi-transaction uploads are not atomic; an interruption reports saved progress. Scan again before retrying; skip mode preserves already-saved records. After **Done**, optionally download the normalized student JSON. That JSON is also available after a successful validation review.

Name suffixes are detected in a **Suffix**, **Name extension**, **Name Ext.**, or equivalent column, and at the end of first/middle/last name components. Supported embedded forms include `Jr.`, `JR`, `Junior`, `Sr.`, `Senior`, and Roman numerals such as `II`, `III`, `IV`, and `XII`; punctuation and casing are normalized. Comma-separated names accept both `Last, First, Middle, Suffix` and `Last, First, Suffix, Middle`. Recognized suffix components are extracted before assigning the middle name, regardless of comma spacing. For example, both `DELA CRUZ, JUAN JR., SANTOS` and `DELA CRUZ,JUAN,JR., SANTOS` become first name `Juan`, middle name `Santos`, last name `Dela Cruz`, suffix `Jr.`. A suffix-only third component, such as `Cruz, Juan, III`, does not become a middle name. Matching repeated suffixes are deduplicated; conflicting suffixes or extra unrecognized comma components block the row for correction. Single-letter initials are preserved; supply a single-letter Roman suffix (`I`, `V`, `X`) or custom suffix in a dedicated suffix column or fourth comma-separated component. The JSON template includes a separate `suffix` example.

File parsing and label/value scans run in a background worker on the device. The original file is not uploaded to a third-party conversion service; validated records are sent directly to the tenant Firestore only after confirmation. Macros/formulas are never executed; formulas require saved values. The importer uses SheetJS 0.20.3 from its [official distribution](https://docs.sheetjs.com/docs/getting-started/installation/frameworks/) for spreadsheet parsing. Treat downloaded templates filled with real data and normalized JSON as restricted school records.

## 9. Run locally and deploy the web app

The app uses central registry values as Vite build-time environment variables:

```powershell
npm ci
npm run dev
npm test
npm run build
```

For Vercel, configure the same six `VITE_REGISTRY_FIREBASE_*` values in the deployment's environment settings, then redeploy. The app reads maintenance and test mode live from the central registry Firestore document `settings/modes` (`isMaintenanceMode` and `isTestMode` boolean fields); changing these values does not require a deployment. The central registry's Firestore rules must allow public reads of this document, as in `school-registry.rules`. Do not put secrets in any `VITE_*` variable because Vite embeds them in the browser bundle. The provided `vercel.json` rewrites app paths to `index.html`; Firebase Hosting settings are in `firebase.json`.

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
| Database backup Export JSON reports insufficient permissions | Use an account whose tenant `users/{uid}` profile has `role: "School Admin"` and `status: "Active"`. Publish the latest `firestore.rules` to the selected school's tenant project; updating local files or the central registry rules does not update tenant rules. The export error identifies the denied path and target project. From the repository root, deploy with `node scripts/deploy-tenant-firestore.mjs --project YOUR_TENANT_PROJECT_ID --rules`. |
| Apps Script returns permission errors | Check Script Properties, spreadsheet sharing, script owner/execution settings, service-account IAM role, and that the project ID is the tenant project. |
| Feedback/audit endpoint does not respond | Use the deployed HTTPS `/exec` URL for the matching service; confirm Web App deployment version/access; update the registry document and wait for the app's short school-directory cache to expire or reload. |

## Security checklist

- Keep service-account key files outside the repository. `.gitignore` excludes common downloaded Admin SDK key names, but ignore rules do not remove a key that was already committed. If a private key was ever committed, uploaded, or shared, revoke it and create a replacement.
- Use separate service accounts for tenant provisioning, central registry writes, and audit integration where practical. Grant only required project-level roles.
- Treat learner data, downloaded JSON backups, feedback, audit logs, and Apps Script project settings as restricted school data.
- Keep Firestore rules restrictive. The app's UI role checks are not a security boundary; Firestore rules and trusted backends must enforce access.
- Use public Firebase Web App settings only in browser-facing config. Never use service-account credentials as Firebase client settings.


## Personal workspace preferences

Personal settings are stored in `users/{uid}.teacherPrefs` for every staff role. `shared/user-preferences.json` defines the defaults used by the website, new account creation, and the Node provisioning scripts. Existing profiles with only `theme` and `inspectLearner` continue to load; the app fills missing defaults and writes the expanded map when the user saves.

```json
{
  "theme": "Light",
  "inspectLearner": true,
  "rememberFilters": true,
  "landingPage": "dashboard.html",
  "tableDensity": "comfortable",
  "tablePageSize": 8,
  "hiddenLearnerColumns": [],
  "textSize": "standard",
  "privacyMode": false,
  "reduceMotion": false,
  "photoCacheEnabled": true
}
```

- Landing pages are allowlisted internal routes, with a dashboard fallback for unsupported account roles.
- Table page sizes are 8, 10, 25, or 50 in learner and assessment lists. Audit history remains 10 per page. Density applies across data tables. Optional learner columns are `birthDate`, `age`, `gender`, `guardian`, `programs`, and `dateAdded`; identity and action columns stay visible.
- Remembered filters and sort order are kept in session storage, scoped to the school, account, page, and school year. They are not written to Firestore with each keystroke.
- Privacy mode is a screen mask for table contents and learner inspection details. It is not access control; exported files may still contain original data.
- The photo cache is bounded to 80 images / approximately 16 MB in the current tab. Its usage and clear action are available in Preferences. Clearing it never deletes an uploaded photo.
- Reset Preferences requires confirmation, restores the defaults above, and clears the current account's remembered views and tab photo cache. It does not change profile photos, assignments, passwords, or school records.

Deploy the updated root `firestore.rules` to each tenant before publishing this frontend. The rules allow validated personal preference updates without granting users permission to change their roles or assignments. The standalone Python provisioner includes the same rules and a mirrored `assets/user-preferences.json` snapshot; its asset integrity hashes are updated together.


### Records printables

`schools/{schoolId}.schoolInfo.zipCode` supplies the sender postal code for outgoing envelopes. Store it as a string to preserve leading zeros; older numeric ZIP codes are also accepted when reading school metadata. The registration examples include this optional field.

SF10 and envelope preferences use independent maps under `settings/toggles.printables`: `sf10-request` defaults to A4 portrait, and `outgoing-envelope` defaults to 241 ? 105 mm landscape. Each config includes `version`, `template`, `defaultPaperSize`, `defaultOrientation`, `defaultMargin`, `defaultScale`, `defaultTextSize`, and `allowSchoolDetailsOverride`. Save with a merge mask for the individual document map. The original Word envelope dimensions (241.3 ? 104.775 mm) are available as `envelope-source`. The packaged tenant structure includes these defaults. Existing tenants receive the same defaults when no config has been saved.

Teachers can open Learner Card (SF9) only; Registrars and School Admins can open all Printables. Settings writes remain limited to School Admins by the existing Firestore rules. No new rules or document collections are required.

### Printable signatures and SF10 Gmail sending

Admin Console -> Printables -> E-Signatures manages a maximum of three signature slots. `settings/printableSignatures` contains `{ version: 1, slots, assignments }`. Slots `signature-1`, `signature-2`, and `signature-3` contain only `{ label, revision, width, height }`; `assignments` maps each printable kind to its permitted slot IDs. New transparent PNGs are uploaded to Cloudinary using the existing `VITE_CLOUDINARY_CLOUD_NAME` and `VITE_CLOUDINARY_UPLOAD_PRESET` environment variables. Optional `VITE_CLOUDINARY_SIGNATURE_UPLOAD_PRESET` selects a separate unsigned signature preset without affecting profile-photo uploads; otherwise the existing preset is reused. No API secret is used or stored in the browser.

`settings/printable-signature-1`, `settings/printable-signature-2`, and `settings/printable-signature-3` now store `{ storage: "cloudinary", url, publicId, cloudName, format: "png", label, revision, width, height, updatedBy }`. No new image bytes are stored in Firestore. Assets are downloaded only when needed and embedded in memory for consistent printing, canvas exports, and email attachments, with caching by tenant and revision. The prepared PNG is limited to 1 MB and 1208 x 608 pixels. Upload verification rejects presets that change the image format, dimensions, or transparent background. Configure the unsigned preset to allow PNG, preserve the original image, and avoid incoming JPEG conversion, background flattening, or profile-photo cropping. For separate storage, give the optional signature preset a fixed asset folder; uploads are tagged `edash-school-signature`.

Existing inline signature documents remain readable. The **Move to Cloudinary** action uploads one existing signature, replaces its inline bytes with a Cloudinary reference, refreshes its revision, and preserves every printable assignment. A concurrent edit prevents replacement. New uploads never perform Cloudinary requests inside retryable Firestore transactions. If upload or verification fails, no signature record is created. If the subsequent Firestore commit fails, the Cloudinary upload can remain unlinked; review tagged assets in Cloudinary for cleanup.

Removing a signature atomically removes its Firestore reference, metadata, and all printable assignments. As with profile-photo removal, it does not destroy the original Cloudinary asset: permanent Cloudinary deletion requires the Cloudinary Console or a trusted backend with server-side credentials. The configured unsigned preset delivers public Cloudinary URLs; Firestore restricts access to the signature library and its stored references, not access to an already-known delivery URL. The tenant provisioning snapshot includes the empty library and documents the Cloudinary reference and legacy schemas without creating sample signatures.

Staff optionally select an approved signature and place it in each studio. Drag, arrow keys (Shift for larger steps), or Left/Top/Width controls adjust its position. Placement applies to the current batch and remains temporary; it is not written into a learner record. SF9 stores independent front/back placements in the current session. Preview, print, PDF, Word, PNG, and SF10 email attachments use the same placed image. Upload accepts raster PNG/JPEG/WebP up to 5 MB, removes white scan backgrounds when enabled, crops empty space, and re-encodes a transparent PNG. Remove an occupied slot before replacing its signature.

The SF10 studio’s **Send with Gmail** dialog creates an attachment from the current documents and sends it only when the user presses **Send email with attachment**. PDF and Word include the selected batch; PNG includes the current preview. The composer supports To, CC, BCC, Reply-to, Subject, and Message. No SMTP password, service account, or refresh token is stored. Google access tokens are held only in the open dialog’s memory and cleared when it closes. The actual sending account is selected and verified through Google, separately from Firebase sign-in.

Before enabling Gmail in a deployment:

1. Enable the Gmail API in a Google Cloud project, configure its OAuth consent screen, and create a **Web application** OAuth client. Add the site’s exact HTTPS origin and the development origin, if needed, to Authorized JavaScript origins.
2. Set `VITE_GMAIL_CLIENT_ID=YOUR_CLIENT_ID.apps.googleusercontent.com` in the deployment/build environment, rebuild, and deploy. The client ID is public; do not place a client secret in frontend configuration.
3. Configure the consent screen audience/test users or publish the consent app as appropriate. Request only `https://www.googleapis.com/auth/gmail.send` and `https://www.googleapis.com/auth/userinfo.email`. Google may require verification for a public app; Workspace administrator restrictions also apply.
4. Connect the sending account from the studio and review the recipients and attachment before sending. A missing client ID leaves sending unavailable with setup guidance. Sending is never automatically retried after a network interruption; check the account’s Sent folder before trying again.

Deploy the updated `firestore.rules` to each tenant before using signatures: the new library and asset documents require an active School Admin, Registrar, or Teacher profile to read. Upload, deletion, and assignment writes remain admin-only. Anonymous Parent Portal sessions and inactive/non-staff accounts cannot retrieve the signature library or asset references from Firestore. The packaged provisioner mirrors this rule change.

References: [Google’s browser token model](https://developers.google.com/identity/oauth2/web/guides/use-token-model) and [Gmail MIME attachments and sending](https://developers.google.com/workspace/gmail/api/guides/sending).

Cloudinary signature references: [unsigned upload parameters](https://cloudinary.com/documentation/image_upload_api_reference#unsigned_upload_parameters) and [upload preset behavior](https://cloudinary.com/documentation/upload_presets).


### Transfer school details and E-Signatures

Transfer In and Transfer Out records require four learner-level text fields: `transferSchoolId`, `transferSchool` (school name), `transferSchoolAddress`, and `transferSchoolZipCode`. The same shape is used in active and archived learner records and documented in the packaged tenant schema. A Transfer In record identifies the previous school; a Transfer Out record identifies the receiving school. School IDs and ZIP codes retain leading zeros. Existing incomplete transfer records must be completed when edited. Movement cancellation and progression into a new school year clear these school fields together with the transfer flags. Spreadsheet data exports and imports include the fields.

SF10 requests list only current-year Transfer In learners. Outgoing-records envelopes list only Transfer Out learners, including the transferredOut collection and legacy outgoing records still in the active collection. Recipient information fills from the four persisted transfer-school fields. Normal learners are excluded from both lists; other certificate lists retain their existing behavior.

E-Signatures are in the Information panel at the bottom of every print studio. Each placed signature supports dragging, a live resize handle, horizontal/vertical orientation, and rotation from -180 to 180 degrees. The rotated bounding box stays inside the document. Print and export sources contain the same transform without editor handles. SF9 front and back placements remain independent. Admin Console Printables uses grouped navigation for document templates and shared E-Signatures; the signature label is presented as Position while retaining the existing `label` storage key.

### SF10 email document tracking

The shared Document Status dropdown includes **Emailed**. After Gmail confirms an SF10 send with a message ID, the studio updates the original learners in `schoolYears/{schoolYear}/learners/{LRN}` to `documentStatus: "Emailed"` and sets `documentStatusDates.Emailed` to the confirmed send date in Philippine time. PDF and Word track the selected batch, or the active learner when no batch is selected. PNG tracks only the current preview. Manually entered documents do not update a learner record. The Transfer Info Notes column displays the shared Document Status, including custom and legacy note values.

The attachment captures the original learner IDs, school year, and signed-in staff UID before sending. Updates require the same School Admin or Registrar account, use bounded transactions, preserve other fields and status dates, and never recreate removed learners. Failed or unconfirmed Gmail sends do not update statuses. If email succeeds but a status write fails, the dialog shows **Retry status update**, which retries only the Firestore update using the original send receipt. This pending retry survives closing/reopening the dialog while the same studio stays mounted; retry it before leaving or refreshing the studio. Successful persistence emits an `SF10_REQUEST_EMAILED` audit event when the audit service is configured. No Firestore rule changes are required.

The latest confirmed SF10 email is stored learner-wise in `sf10Email: { messageId, sentAt, to, cc, bcc }`. `sentAt` is an ISO UTC timestamp; the learner editor, learner details, and Transfer Info Notes display the actual recipients and date/time in Philippine time (PHT). Each successful send replaces the latest receipt; failed sends preserve the previous receipt. Ordinary edits and movement archives preserve it, while a new enrollment through promotion/retention starts without it. CSV/Excel exports and learner imports support the structured receipt. Earlier emails without a saved receipt retain their existing status/date; recipient addresses and exact times are not inferred.
