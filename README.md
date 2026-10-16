# E-Dash Multi-School Dashboard

E-Dash is a React/Vite dashboard for school enrollment, learner profiles, school-year statistics, user roles, and reports. Each school uses its own Firebase project for Authentication and Firestore. A separate central Firebase project provides the directory that lets users choose a school.

## Quick start

Requirements: Node.js/npm and access to the central E-Dash Firebase project.

```powershell
npm ci
Copy-Item .env.example .env.local
```

Fill the `VITE_REGISTRY_FIREBASE_*` variables in `.env.local` with the **central registry project's Firebase Web App config**. These are public browser settings, not service-account credentials.

```powershell
npm run dev
npm run build
npm test
```

The app reads enabled school registrations from `schools/{schoolId}` in the central project's Firestore. For the complete new-school procedure—including automatic Firestore bootstrap, the shared tenant rules, school registration JSON, Apps Script endpoints for audit logs and feedback, JSON database backup/restore, and deployment—see [SETUP_README.md](./SETUP_README.md).

## Project scripts

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start the local Vite development server. |
| `npm run build` | Run the TypeScript project build and create the production bundle in `dist/`. |
| `npm run preview` | Serve the production bundle locally. |
| `npm test` | Run the Vitest suite. |
| `npm run firestore:bootstrap -- ...` | Create the initial tenant Firestore structure; follow [SETUP_README.md](./SETUP_README.md) before running. |
| `npm run firestore:provision -- --help` | Show tenant maintenance, migration, and rules-deployment options, including the legacy-schema copy migration. |
| `npm run firestore:provision-test -- --help` | Preview or provision a new school's year-scoped tenant schema. |
| `npm run firestore:import-learners -- --help` | Preview or import learner records from the San Roque workbook into a tenant project. |
| `npm run registry:register-school -- --help` | Show central directory registration options. |

## Local provisioning utility

Run `python main.py` from the repository root to open the optional Tkinter utility. It supports **Tenant Structure Schema** (preview or create missing tenant documents) and **School Register Schema** (validate and register a school JSON in the central directory). It calls the existing Node provisioning scripts directly; it requires Node.js and the repository's `firebase-admin` dependency. Python dependencies are standard-library only; install Python with Tcl/Tk support.

The tenant provisioning script defines its schema in code and does not accept an external schema JSON. School registration is an upsert keyed by the JSON `id`: a new ID creates a document, and the same ID updates that existing document in place. Uploaded fields update while omitted fields (including custom top-level and nested fields) remain intact; arrays supplied in the JSON replace their previous values. Required identity and Firebase config fields are validated; `schoolInfo`, `schoolHead`, branding metadata, and service URLs are optional. Firestore-generated timestamps are managed on the server, and `enabled` is always set to `true`. The example is in [school-registration.example.json](./school-registration.example.json). Dry-run is available before writes, and live operations require typing the target project or school ID. A service-account file is optional when Application Default Credentials are configured. Keep service-account JSON outside the repository; the utility redacts its path from the activity log.

## Firebase layout

- **Central registry project:** stores public school directory documents at `schools/{schoolId}`, including the `schoolHead` map provided during registration. Its rules are in `school-registry.rules`, selected by `firebase.registry.json`; all fields on enabled school documents are client-readable.
- **Tenant project (one per school):** stores that school's Auth users and operational Firestore data. Tenant rules are in `firestore.rules`.
- Tenant projects use the same Firestore ruleset. Deploy the rules to each tenant project when setting it up or when the shared rules change.
- Tenant data uses `schoolYears/{year}` as the parent for `learners`, `dropouts`, `transferredOut`, and `grades/{grade}/sections/{section}/teachers/{uid}`. Tenant-wide settings and `publicStats/summary` remain at the root.
- Service-account JSON files are privileged secrets. Keep them outside the repository and never place them in `.env.local`, a school-registration JSON, frontend source, or a public deployment variable.

## Student performance card

The **Print Card** action on Grades Profile opens a separate workspace. It follows the supplied SF9 learner performance-report layout on a compact custom-size sheet, split into matching front (left) and back (right) panels with the center divider. Learners can be searched and filtered by grade, program, and gender; the active school year is selectable. The learning-area rows use only the subjects assigned to that learner's grade for the selected school year, and row spacing adjusts to fit that grade's subject count. If the grade has no assigned subjects, the report says so instead of showing an unrelated static subject list. The Grade value prints as its number (for example, `6`, not `Grade 6`). The card uses the fixed DepEd seal at `public/assets/edash/deped-seal.png`, the selected school's logo, and saved term grades. School name, head, and year are prefilled; when present, school-head and letterhead details are read from `schools/{schoolId}.schoolHead` and `schools/{schoolId}.schoolInfo`. Adviser is prefilled from the selected year's section/adviser record.

The SF9 template is currently available only for Numerical Grade levels. For a learner whose grade is configured for Letter Grade in the selected school year, the workspace explains that the template is unavailable and disables printing and export. For supported levels, Export downloads a PDF or PNG, or a Word `.docx` containing the card layout as an image to preserve its appearance.

Card identity fields can be corrected for that print session. Region, division, district, SHS track, attendance, comments, parent/guardian signature details, and transfer-certificate fields can be manually entered. These card-only corrections are not saved to Firestore; update learner/school records through their normal management workflows if changes should persist.

## Data handling

Learner information is stored in the school's Firestore project. Apps Script Web Apps are optional integrations for audit logs and feedback. Admin Console database backup and restore use downloadable JSON files in the signed-in browser; no Google Sheets backup service is used.
