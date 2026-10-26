# EduAI context and product knowledge

EduAI answers product questions from maintained documentation and interprets a server-built school summary. It does not operate the website or receive complete student profiles.

## Context sources

| Source | Purpose |
| --- | --- |
| `eduai-knowledge.json` | Workflow catalogue covering all registered pages, exact controls, prerequisites, scope, and limitations. |
| `eduai-role-policies.json` | Always-supplied School Admin, Registrar, and Teacher guidance and baseline capabilities. |
| `eduai-guide.mjs` | One role-filtered retrieval implementation used by the Worker and frontend verification wrapper. |
| `eduai-context.cjs` | Aggregate chart data and an allowlisted snapshot of capabilities, teacher classes, and school toggles. |
| `eduai-provider.cjs` | Provider-independent system instructions, explicit data limits, and role/configuration precedence. |
| `worker/index.mjs` | Verifies the signed-in tenant profile and entitlement, reads permitted Firestore data, and assembles each request. |

## Role behavior

| Role | Product guidance and data scope |
| --- | --- |
| School Admin | School-wide permitted aggregates and all administrator workflows, including configuration, account management, staged tenant restore, student import, and audit UI. This does not provide live private account/audit data. |
| Registrar | Learner administration, enrollment, profiles/grades, movement, progression, reports, and permitted exports. No administrator execution instructions or Trash access. |
| Teacher | Assigned classes for the configured current year, learner/profile/card/report/export help, assigned-record Trash, and conditional progression. No administrator execution instructions or other classes' private data. |
| Visitor / Parent / unknown | Not eligible for EduAI. Staff can receive documentation explaining public visitor/parent workflows without receiving individual parent-lookup results. |

The backend takes the role and assignments from the active Firestore profile. Messages and browser-supplied history cannot change authorization. Product documentation explains possible functionality; the verified `applicationAccess` snapshot describes role/configuration limits. Teacher progression is `true` or `false` only when the toggle can be verified, and `null` when unverified. Missing toggle documents use application defaults; inaccessible or invalid settings remain unknown rather than silently granting access.

The snapshot includes only bounded class labels, capability booleans, allowed toggle values, and its capture timestamp. It excludes raw profiles, emails, user IDs, provider keys, passwords, and custom settings fields. Existing aggregate/name restrictions still apply: current configured year, teacher-scoped learner queries, bounded name-only lists, and no individual grades, assessment/health values, contacts, guardians, or IDs in the model payload. EduAI cannot see other pages' currently selected filters or years.

## Updating the catalogue

Each entry has a stable `id`, a `title`, `keywords`, and complete `guidance`. Add `roles` for restricted procedures, `routes` for page coverage, and `overview: true` for broad navigation entries. Common workflow entries must not contain administrator-only execution steps. Keep instructions grounded in the actual UI, `firestore-api.ts`, and role checks. When adding a route, add its documentation metadata; the route-coverage test detects omissions.

Retrieval scores distinct title/keyword terms ahead of body text, normalizes common learner/import synonyms, and limits broad overview results. The current question takes precedence. Only short referential follow-ups use recent user questions; prior assistant text is not a retrieval authority. Selection is capped at eight whole entries and 14,000 characters; an entry is never cut halfway through an instruction. The role policy is supplied separately even when no guide entry matches. Unmatched questions should be acknowledged instead of answered with invented UI steps.

Update documentation when changing navigation, controls, role restrictions, imports, backups, grading, or school-year behavior. For example, card administration belongs in Admin Console → Card Preferences; personal Preferences only controls themes and Learner Inspection. Student import and tenant restore are distinct workflows with separate review and final-confirmation steps.

## Verification and deployment

From the repository root:

```powershell
npm test -- src/lib/eduai-knowledge.test.ts src/lib/eduai.test.ts src/lib/eduai-graphs.test.ts
node --test functions/eduai-provider.node.cjs
npm run build
```

With the Worker's dependencies installed, `wrangler deploy --dry-run` from `worker` verifies bundling without publishing. Deploy gateway changes with `npm run deploy --prefix worker`; frontend changes use the existing frontend deployment. Editing local knowledge files alone does not update the deployed Worker. Tests use synthetic data and mocked Firestore/provider behavior; they do not upload learner data or make paid model calls.
