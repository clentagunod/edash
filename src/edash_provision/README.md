# Edash Provision

A standalone Tkinter desktop app for the central E-Dash school registry and each school's tenant Firestore database. Python source, default JSON, rules, indexes, tests, and dependency manifests all live in this folder. The root `main.py` is the entry point. No React, Vite, website scripts, `.env.local`, or website npm dependencies are used at runtime.

## Run in your existing environment

From the folder containing `main.py`:

```powershell
conda activate provisionenv
python main.py
```

Python 3.12 with Tcl/Tk was validated. Python 3.10+ is supported. This project does not create an environment. For a new installation in your existing environment:

```powershell
python -m pip install -r src/edash_provision/requirements.lock.txt
```

The GUI itself uses only the standard library. Database operations use `google-auth` and its Requests transport rather than the larger Firebase Admin/gRPC stack. To opt into compatible dependency updates, use `requirements.txt`; `requirements.lock.txt` records the versions tested in `provisionenv`.

Optional rules/index deployment requires Node.js 20+ and Firebase CLI. A pinned CLI and lockfile are supplied separately:

```powershell
npm ci --prefix src/edash_provision/tools --ignore-scripts --no-audit --no-fund
python main.py doctor
```

The app prefers this local CLI, then an installed Firebase CLI. It executes Node/CLI directly with argument lists, avoiding shell interpolation and Windows `.cmd` quoting. No npm package download happens during provisioning. Database-only operations and offline dry runs do not need Node.js.

## Registration

1. Select **Registration** and enter the **central** Firebase project ID.
2. Choose its service-account JSON. Leave blank only when Google Application Default Credentials are already configured. An explicitly selected key must belong to the target project. `GOOGLE_APPLICATION_CREDENTIALS`, when set, is also supported.
3. Use **Export example** or **Edit JSON** to prepare a separate public school-registration JSON, based on the bundled `assets/school-registration.example.json`. Replace the public Firebase placeholders. `firebaseConfig.projectId` identifies the separate school tenant project.
4. Optionally select **Deploy registry rules**.
5. Keep **Dry run** selected and run validation. The activity log shows the target `schools/{id}` document and deployment targets.
6. Clear **Dry run**, review the command/target summary, and choose **Review & provision** to apply.

Registration is a field-level upsert. The same school ID updates that document; it does not delete/recreate it. Supplied leaf values replace their existing values; supplied arrays replace previous arrays. Omitted nested/top-level fields are retained. Empty maps are ignored during the recursive merge. The app forces `enabled: true` and generates `updatedAt` and supplied `schoolHead.updatedAt` as Firestore server timestamps. All registration fields are public under the bundled registry rules; service keys/passwords are rejected in this data.

## Tenant provision

Learner documents use the application’s canonical field list in `src/lib/app-config.ts`. This includes `anecdotalRecords`, a plain-text string with an empty-string default, saved in `schoolYears/{schoolYear}/learners/{LRN}` and retained in archived records. The structure template's `recordSchemas` describes these learner fields for future tenants; it is reference metadata and does not seed sample learners or modify existing learner documents. Good Moral certificates read the saved value, with per-print corrections available in the studio.

Learners also store `teacherComments` (strings in term order, default `["", "", ""]`, with an optional fourth string for four-term school years) and `attendance` (month-to-count maps under `classDays`, `daysPresent`, and `daysAbsent`, defaulting to empty maps). Attendance uses the months, row order, and labels from `settings/cardPrintingPreferences`; counts are non-negative decimal numbers stored as strings, with empty strings for unrecorded cells. Add/edit editors calculate read-only `daysAbsent` as `classDays - daysPresent` using exact decimal arithmetic; incomplete pairs leave absence blank, and present days cannot exceed class days. Layout changes preserve saved months that are no longer displayed. Learner cards prefill these records and still allow temporary printing corrections. Promotion/retention copies these fields into a separate succeeding-year record and allows reviewing or clearing the values before saving; the source-year record remains unchanged. Existing tenants need no backfill or rule deployment for these optional fields.

The shared add/edit form groups subject grades, Teacher Comments, and attendance under Learner Card. The term selector shows one term's grades and comment while retaining other terms' draft values; Final Grade has no separate comment. The parent portal follows the same term selection and conceals grades, comments, and monthly attendance (including totals) under its existing Show/Hide details control. The portal reads Card Preferences through its separate anonymous Firebase session using the existing signed-in settings read rule.

Enrollment editors offer `ACTIVE` and `INACTIVE`; transfer flags and EOSY status continue to route movement records into the appropriate archives. Learner Assessment uses vertical reading/math cards. Transfer Information and EOSY Status share the last form section. `documentStatus` stores one of `Successfully`, `Transmitted`, `Preparing Documents`, `Received Documents`, or `Custom`; `documentStatusCustom` stores the custom label and `documentStatusDates` stores independent date-only strings by category (default `{}`). Legacy `transferNotes` are preserved and presented as Custom when no newer status exists. Archived editors use the same status controls. Migration editors start a new Document Status for the succeeding year, leaving source-year document history intact. No Firestore rule change is required.

1. Create the school's Firebase project and **(default), Firestore Native mode database** in Firebase Console first.
2. Select **Tenant provision**, enter the school's project ID, and choose that project's service key (or use ADC).
3. Select the initial school year. The built-in structure is selected by default; **Browse** accepts a compatible custom structure JSON. **Export structure** and **Edit JSON** help prepare one.
4. Optionally select **Deploy tenant rules** and/or **Deploy indexes** independently.
5. Optionally add the first School Admin's existing Firebase Auth UID, email, and name. This writes only its Firestore profile; create the actual Authentication account and enable Email/Password sign-in separately in Firebase Console. The app does not create passwords or Auth accounts.
6. Run dry run, then clear that checkbox and review/apply when ready.

The default nine document candidates are:

```text
schoolYears/{schoolYear}
settings/currentSchoolYear
settings/curriculumSubjectPool
settings/gradeTerms
settings/gradeTerms/years/{schoolYear}
settings/toggles
settings/cardPrintingPreferences
settings/eduai
publicStats/summary
```

Tenant provisioning reads the candidate paths in batches, creates **only missing** documents, and preserves all existing documents. New writes use `exists: false` preconditions and one atomic document commit (maximum 400 candidates). A concurrent creation rejects the commit rather than overwriting that record; review and rerun. An existing current school year is retained; a newly created year is marked current only if it matches that setting. A missing statistics summary is initialized for the configured current year. Existing statistics and settings are never reset.

The template snapshots the website's schema v3 defaults, including 3 grading terms, passing threshold 75, SF9 card preferences/attendance rows, Parent Portal enabled, teacher progression disabled, 30-day Trash retention (`trashConfg` spelling is intentional), nearest-integer rounding, and EduAI role defaults. It supplies defaults for missing documents only; it does not repair incomplete existing documents. Configure actual classes, curriculum, staff assignments, and subsequent year changes in the website. Logical collections for learners, archives, teachers, Trash, and assignment history appear when real records are saved; no fabricated learners or classes are created.

## Custom tenant structure format

Custom structures use a portable manifest rather than a Firestore export, JSON Schema file, or website tenant backup:

```json
{
  "format": "edash-tenant-provision",
  "version": 1,
  "documents": [
    {
      "path": "schoolYears/${schoolYear}",
      "data": {
        "schoolYear": "${schoolYear}",
        "createdAt": { "$serverTimestamp": true }
      }
    },
    {
      "path": "settings/customFeature",
      "data": { "enabled": false, "labels": ["Example"] }
    }
  ],
  "collectionPaths": ["schoolYears/{schoolYear}/learners/{LRN}"]
}
```

`documents` contains 1–400 unique entries with exactly `path` and `data`. Paths must contain collection/document pairs. `${schoolYear}` is the only substituted variable, in path and string values. `collectionPaths` is informational and creates nothing. JSON scalar/array/map values are supported; date strings remain strings. The exact marker `{ "$serverTimestamp": true }` in a document/map field becomes a server timestamp; it cannot occur inside arrays. Deletes, executable directives, duplicate keys/paths, direct nested arrays, reserved field names, non-finite/out-of-range numbers, and credential fields are rejected. JSON files are limited to 2 MB; individual planned writes are limited to 900 KB and the commit to 8 MB. A reviewed file's SHA-256 is checked by the subprocess to prevent applying an edited file without another review.

## Authentication and deployment

The selected service key is used for both Firestore and optional Firebase CLI deployment. Its contents are never put in commands, logs, exported templates, or app settings. CLI authentication receives only its path through the child's `GOOGLE_APPLICATION_CREDENTIALS` environment variable; an isolated CLI config prevents a cached login from taking precedence. Raw Google error bodies and credential-related CLI output are hidden. Command preview includes local paths, so review those before sharing screenshots.

For database writes, the operator needs suitable Firestore IAM permissions, commonly Cloud Datastore User. Rules deployment needs Firebase Rules permissions, commonly Firebase Rules Admin; index deployment needs index-management permissions, commonly Cloud Datastore Index Admin. Other project-discovery/API-use permissions may also be needed by Firebase CLI; follow its permission error instead of broadening Firestore browser rules. ADC is configured separately, for example using `gcloud auth application-default login`. A Firebase CLI browser login alone does not authorize Python database writes.

Deployment uses a temporary Firestore-only `firebase.json` containing the bundled rules/index snapshot. There are no website Hosting, Functions, or deployment hooks. Selected rules replace the current project's rules. Index deployment is non-interactive without `--force`; destructive changes requiring confirmation can be refused by CLI. Index building can continue after the command finishes.

Offline dry run performs no authentication or network calls. It validates local JSON, selected key shape/project, bundled assets, and planned writes. It does **not** verify IAM access, key validity with Google, existing-document counts, rules compilation, or remote project/database existence. Live operations preflight the target database and required local CLI before document writes.

Database commit and optional deployment are separate operations. A deployment failure does not roll back saved documents; the log reports which step completed. Cancellation is cooperative: the UI stays responsive while an in-flight request completes, and then skips subsequent steps. It cannot undo remote changes already accepted. Google requests have bounded timeouts and CLI deployment has a 15-minute limit. A lost commit response can mean the write completed; verify the project or rerun the create-only tenant operation. Logs are bounded to 2,000 displayed lines and saved only when you choose **Save log**.

## CLI and command preview

The GUI launches this same CLI with its active Python interpreter, so it uses `provisionenv` when launched there. The command panel updates as inputs change; after review it includes the source hash. `--gui-control` enables the cancellation pipe.

```powershell
# Offline preview (also the default when --apply is omitted)
python main.py tenant --project school-project --school-year 2026-2027 --dry-run
python main.py register --project central-project --registration C:\data\school.json --dry-run

# Apply after review
python main.py tenant --project school-project --school-year 2026-2027 --service-account C:\secure\tenant-key.json --deploy-rules --deploy-indexes --apply --confirm-project school-project
python main.py register --project central-project --registration C:\data\school.json --service-account C:\secure\registry-key.json --deploy-rules --apply --confirm-project central-project
```

`--confirm-project` must exactly match `--project` for any live CLI run. Quote paths containing spaces.

## Move into another project

Copy only these items, maintaining their layout:

```text
Edash Provision/
  main.py
  src/
    edash_provision/       # this complete folder, including assets/tools manifests
```

Exclude `__pycache__`, tools `node_modules`, and any credentials. Install the Python lockfile into your chosen existing environment and optionally run `npm ci` in the bundled tools folder. The rules, index, and JSON files in `assets` are independent snapshots, so the copied app has no dependency on the original website. Update those snapshots deliberately when website requirements change; see `assets/provenance.json`. The website's `.vercelignore` excludes this desktop app from frontend deployment.

## Verification

```powershell
conda activate provisionenv
python -m unittest discover -s src/edash_provision/tests -v
python -m pip check
python main.py doctor
```

Tests use synthetic inputs and mocked Google/CLI operations, plus actual offline GUI subprocesses and an isolated copy test. No live provisioning/deployment is performed. Tk GUI tests skip when no graphical desktop is available.

API references: [Firestore REST writes and preconditions](https://firebase.google.com/docs/firestore/reference/rest/v1/Write), [atomic document commit](https://firebase.google.com/docs/firestore/reference/rest/v1/projects.databases.documents/commit), [Google service-account credentials](https://google-auth.readthedocs.io/en/latest/reference/google.oauth2.service_account.html), [Firebase CLI](https://firebase.google.com/docs/cli), [CLI service-account authentication](https://github.com/firebase/firebase-tools#authentication).


## Workspace preference defaults

The optional initial administrator profile includes the complete `teacherPrefs` map from `assets/user-preferences.json`: theme, inspection, remembered views, landing page, table spacing and page size, optional learner columns, text size, privacy, reduced motion, and photo caching. This standalone snapshot matches the website's `shared/user-preferences.json`. Update both defaults files, the bundled tenant rules, and `assets/provenance.json` when the schema changes. Existing user documents remain protected by create-only provisioning; the website supplies missing preference defaults when reading older profiles.
