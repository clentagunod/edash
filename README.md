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

The app reads enabled school registrations from `schools/{schoolId}` in the central project's Firestore. For the complete new-school procedure—including automatic Firestore bootstrap, the shared tenant rules, school registration JSON, Apps Script endpoints for audit logs/feedback/backups, and deployment—see [SETUP_README.md](./SETUP_README.md).

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

## Firebase layout

- **Central registry project:** stores public school directory documents at `schools/{schoolId}`, including the `schoolHead` map provided during registration. Its rules are in `school-registry.rules`, selected by `firebase.registry.json`; all fields on enabled school documents are client-readable.
- **Tenant project (one per school):** stores that school's Auth users and operational Firestore data. Tenant rules are in `firestore.rules`.
- Tenant projects use the same Firestore ruleset. Deploy the rules to each tenant project when setting it up or when the shared rules change.
- Tenant data uses `schoolYears/{year}` as the parent for `learners`, `dropouts`, `transferredOut`, and `grades/{grade}/sections/{section}/teachers/{uid}`. Tenant-wide settings and `publicStats/summary` remain at the root.
- Service-account JSON files are privileged secrets. Keep them outside the repository and never place them in `.env.local`, a school-registration JSON, frontend source, or a public deployment variable.

## Student performance card

The **Print Card** action on Grades Profile opens a separate workspace. It follows the supplied SF9 learner performance-report layout on a compact custom-size sheet, split into matching front (left) and back (right) panels with the center divider. Learners can be searched and filtered by grade, program, and gender; the active school year is selectable. The learning-area rows use only the subjects assigned to that learner's grade for the selected school year, and row spacing adjusts to fit that grade's subject count. If the grade has no assigned subjects, the report says so instead of showing an unrelated static subject list. The Grade value prints as its number (for example, `6`, not `Grade 6`). The card uses the fixed DepEd seal at `public/assets/edash/deped-seal.png`, the selected school's logo, and saved term grades. School name, head, and year are prefilled; school-head and letterhead details are read from `schools/{schoolId}.schoolHead` and `schools/{schoolId}.schoolInfo`. Adviser is prefilled from the selected year's section/adviser record. Future school-registration JSON must include both `schoolInfo` and `schoolHead`.

The SF9 template is currently available only for Numerical Grade levels. For a learner whose grade is configured for Letter Grade in the selected school year, the workspace explains that the template is unavailable and disables printing and export. For supported levels, Export downloads a PDF or PNG, or a Word `.docx` containing the card layout as an image to preserve its appearance.

Card identity fields can be corrected for that print session. Region, division, district, SHS track, attendance, comments, parent/guardian signature details, and transfer-certificate fields can be manually entered. These card-only corrections are not saved to Firestore; update learner/school records through their normal management workflows if changes should persist.

## Data handling

Learner information is stored in the school's Firestore project. Apps Script Web Apps are optional integrations: the audit-log and feedback endpoints store their respective spreadsheet records, and the backup endpoint exports Firestore data to a Google Sheet. Protect access to those spreadsheets as student data.
