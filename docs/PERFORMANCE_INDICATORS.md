# Performance Indicators

The Dashboard opens in **Learner Overview**. **Performance Indicator** is a second view available to every dashboard role, including the public visitor session. The administrator manages it in **Admin Console → Performance Indicators**.

## Storage and permissions

Each tenant stores one document at `settings/performanceIndicators`:

```json
{
  "version": 1,
  "revision": 1,
  "windowYears": 5,
  "configurations": {
    "2025-2026": {
      "indicators": {
        "graduation": { "numerator": 45, "denominator": 45 }
      }
    }
  }
}
```

Entries can also contain `numeratorLabel` and `denominatorLabel` to preserve the original computational guide. These are public, school-level aggregate counts and labels. Performance years are independent of `schoolYears` and can include any historical year up to the configured current school year. A school supports up to 100 performance years, with counts between 0 and 1,000,000,000.

Firestore permits direct public reads of this one settings document. Writes still require an active **School Admin** profile. The admin editor uses a transaction and revision check to prevent overwriting changes saved by another administrator. Tenant database backups include this document through the existing settings export.

**Deploy the updated root `firestore.rules` to each existing tenant before using the visitor view.** The provisioning copy at `src/edash_provision/assets/firestore.rules` contains the same rules for new instances. No rules or data are deployed automatically by the feature implementation.

### Visitor permission errors on an existing instance

Updating the app does not publish Firestore rules. If administrators can read performance indicators but visitors receive “Missing or insufficient permissions”, publish the visitor-read permission in the affected **tenant** Firebase project, rather than the central school-registry project.

To preserve other rules edited directly in Firebase Console, open **Firestore Database → Rules** and add this match inside `match /databases/{database}/documents`, alongside the existing settings match:

```text
match /settings/performanceIndicators {
  allow get: if true;
}
```

Publish, then refresh the visitor dashboard. The existing settings rule still controls administrator writes; this match only grants direct reads of the public performance aggregate. It does not grant settings collection queries or reads of other settings documents.

If the repository is the source of truth for all of the tenant's rules, sign in and use the existing deployment helper instead:

```powershell
npx.cmd firebase-tools login
node scripts/deploy-tenant-firestore.mjs --project YOUR_TENANT_PROJECT_ID --rules
```

The dashboard discards cached chart data if Firestore subsequently rejects the server read. A fresh browser session without a staff login should be used to verify the published visitor permission.

## Calculations

All 12 indicators use the supplied workbook's formula: **numerator ÷ denominator × 100**. Default labels match its grade ranges, populations, and dates. Completion and Survival use the Kindergarten cohort six school years earlier; Retention and Transition use the previous school year.

Variance is the current rate minus the immediately preceding school year's rate, expressed in **percentage points (pp)**. Calculations use full precision and round only for display. The previous year may be outside the visible window. Gaps in history do not substitute a different comparison year.

A zero numerator produces 0%; a missing count or zero denominator produces **No data**. Rates above 100% remain visible. The default year window is 5; administrators can also choose 3, 6, or 9. The slider moves the calendar-year window, including visible gaps for years without data.

## Import and export

Supported files: XLSX, XLS, CSV, TSV, and ODS (up to 10 MB, 100 sheets, 5,000 rows per sheet, and 100 columns).

The importer recognizes the supplied workbook's two-row computational guide, school-year headings, and numerator/denominator count cells. It preserves source labels, ignores unrelated sheets, reports duplicate/conflicting entries, and recalculates rates rather than trusting cached rate cells or manually written variance. It accepts the workbook spellings **Repitition** and **Enrolment**.

For a flat table, download the CSV template or supply these columns:

| School Year | Indicator | Numerator | Denominator | Numerator Label | Denominator Label |
| --- | --- | --- | --- | --- | --- |
| 2025-2026 | Graduation Rate | 45 | 45 | Graduates School Year 2025-2026 (Grade 6) | Enrollment School Year 2025-2026 (Grade 6) |

Label columns are optional; count columns are required. Invalid rows are skipped with notices. Duplicate rows keep the first entry and report subsequent entries. Imports show a preview; by default, matching indicators already in the draft are preserved. The administrator can explicitly replace them. **Apply to draft** updates the editor; **Save changes** publishes the result. **Export draft** downloads the current source counts for review or recovery after a revision conflict.

Importing does not execute spreadsheet formulas. Spreadsheet-formula prefixes in exported labels are escaped.
