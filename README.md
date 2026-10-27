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

**Edash Provision** is a standalone Tkinter app with **Registration** and **Tenant provision** modes. Launch it from the root using `conda activate provisionenv`, then `python main.py`. It includes editable/exportable JSON templates, the documented tenant defaults, service-key selection, optional registry/tenant rule and tenant index deployment, an offline dry run, command preview, cancellation, and an activity log. Tenant runs create missing documents while preserving existing records; registration merges supplied fields into `schools/{id}`. An optional School Admin profile uses an existing Firebase Auth UID; the app does not create an Auth account or password.

Its source, dependency lockfiles, and independent rules/index/JSON snapshots are in [src/edash_provision](./src/edash_provision/README.md). Database access uses lightweight Google authentication plus Firestore REST; optional deployment uses the separately pinned Firebase CLI. Copy `main.py` and `src/edash_provision/` to move the app into another project without the website source. The app accepts custom tenant structure manifests; the original Node provisioning scripts still define their schemas in code. See the [desktop app guide](./src/edash_provision/README.md) for installation, formats, authentication, CLI examples, and verification.

## Firebase layout

- **Central registry project:** stores public school directory documents at `schools/{schoolId}`, including the `schoolHead` map provided during registration. Its rules are in `school-registry.rules`, selected by `firebase.registry.json`; all fields on enabled school documents are client-readable.
- **Tenant project (one per school):** stores that school's Auth users and operational Firestore data. Tenant rules are in `firestore.rules`.
- Tenant projects use the same Firestore ruleset. Deploy the rules to each tenant project when setting it up or when the shared rules change.
- Tenant data uses `schoolYears/{year}` as the parent for `learners`, `dropouts`, `transferredOut`, and `grades/{grade}/sections/{section}/teachers/{uid}`. Tenant-wide settings and `publicStats/summary` remain at the root.
- Service-account JSON files are privileged secrets. Keep them outside the repository and never place them in `.env.local`, a school-registration JSON, frontend source, or a public deployment variable.

## EduAI provider setup

EduAI is enabled per school by setting `canUseEduAI: true` on the central registry document `schools/{schoolId}`. Missing or `false` flags show the school-unavailable screen. Chat history is stored in the selected school's Firestore at `users/{uid}/eduaiConversations/{conversationId}` with messages in its `messages` subcollection. The active user's settings are stored at `users/{uid}/eduaiSettings/preferences`; tenant role defaults live at `settings/eduai`.

Chat requests use a Cloudflare Worker and D1 database, so EduAI does not require Firebase Cloud Functions or a Firebase Blaze plan. The gateway verifies Firebase ID tokens, checks the central school entitlement, reads tenant school data through the signed-in user's Firestore permissions, and keeps provider keys encrypted in D1. The [EduAI setup guide](./SETUP_README.md#eduai-no-blaze-plan-setup) explains the one-time Cloudflare setup, secrets, and deployment.

Each role has tenant-level defaults; account preferences override only that user's role defaults. The E-Dash product guide in `functions/eduai-knowledge.json` covers all registered pages, including grading, cards, movement, account settings, tenant backup/restore, and student import. Shared retrieval selects relevant role-allowed workflows; `functions/eduai-role-policies.json` supplies an explicit School Admin, Registrar, or Teacher policy on every request. The backend rebuilds aggregate chart data, teacher assignments, and allowlisted capability/toggle settings from Firestore instead of trusting browser-supplied context. EduAI explains workflows but cannot perform website actions. See [EduAI context maintenance](./functions/EDUAI_CONTEXT.md) for coverage, scope, tests, and gateway deployment. Individual assessment and health records are not sent, but aggregate profile categories are sensitive and should only be used with school approval. Review the privacy and retention terms for the selected provider; test with synthetic data. The client does not send learner IDs, individual marks, contacts, heights, weights, or guardian details.

EduAI's **AI settings** panel switches between shared Gemini and a user's own Groq, OpenAI, Gemini, Claude, DeepSeek, Mistral, or OpenRouter account, and adjusts model, reply length, creativity, timeout, conversation history, and learner-name limits. Successful per-user requests and provider-reported token usage are summarized monthly; provider-side free-tier limits remain controlled by the provider.

## Student performance card

The **Print Card** action on Grades Profile opens a separate workspace. It follows the supplied SF9 learner performance-report layout on a compact custom-size sheet, split into matching front (left) and back (right) panels with the center divider. Learners can be searched and filtered by grade, program, and gender; the active school year is selectable. The learning-area rows use only the subjects assigned to that learner's grade for the selected school year, and row spacing adjusts to fit that grade's subject count. If the grade has no assigned subjects, the report says so instead of showing an unrelated static subject list. The Grade value prints as its number (for example, `6`, not `Grade 6`). The card uses the fixed DepEd seal at `public/assets/edash/deped-seal.png`, the selected school's logo, and saved term grades. School name, head, and year are prefilled; when present, school-head and letterhead details are read from `schools/{schoolId}.schoolHead` and `schools/{schoolId}.schoolInfo`. Adviser is prefilled from the selected year's section/adviser record.

The SF9 template is currently available only for Numerical Grade levels. For a learner whose grade is configured for Letter Grade in the selected school year, the workspace explains that the template is unavailable and disables printing and export. For supported levels, Export downloads a PDF or PNG, or a Word `.docx` containing the card layout as an image to preserve its appearance.

Card identity fields can be corrected for that print session. Region, division, district, SHS track, attendance, comments, parent/guardian signature details, and transfer-certificate fields can be manually entered. These card-only corrections are not saved to Firestore; update learner/school records through their normal management workflows if changes should persist.

## Data handling

Learner information is stored in the school's Firestore project. Apps Script Web Apps are optional integrations for audit logs and feedback. Admin Console database backup and restore use downloadable JSON files in the signed-in browser; no Google Sheets backup service is used.
