# School registration: Google Sheets, Vercel, and GoDaddy

This checkout implements the two-stage onboarding flow. It uses your existing React/Vite app and a Vercel Node.js Function, with a separate spreadsheet-bound Google Apps Script project. GoDaddy provides the domain's DNS; Vercel serves the registration page and API. No additional domain purchase is needed for `register.edash.online`.

## What happens

1. A school admin opens `https://www.edash.online/select-school` and selects **Register your school**.
2. Their initial request is saved to the private spreadsheet's **Requests** tab.
3. An E-Dash team member reviews the request, generates an invitation using the spreadsheet menu, and manually emails the link to the school contact.
4. The school opens `https://register.edash.online/#token=…`, completes its school profile, and submits it.
5. All completed information goes into **Registrations**, with status **Awaiting setup** and a registration reference. The invitation cannot create another completed registration.
6. The developer manually sets up the tenant Firebase project, database, users, assets, and central school directory entry. This may take several days. The team emails the school when its workspace is ready.

Submitting either form does not create a Firebase project, provision Firestore, create users, enable a school, or send emails automatically.

## 1. Prepare a private Google spreadsheet

1. Sign into the Google account that will own the onboarding spreadsheet and script. Use an account the E-Dash team can maintain long term.
2. Create a **new** Google spreadsheet, for example **E-Dash school registrations**.
3. Copy its spreadsheet ID: in `https://docs.google.com/spreadsheets/d/SPREADSHEET_ID/edit`, copy only the part between `/d/` and `/edit`.
4. Keep this spreadsheet **Restricted**. Share it only with E-Dash staff who need to review registrations. The spreadsheet itself must not be shared with applicants.
5. Open **Extensions → Apps Script**. Use a separate script project for onboarding; do not combine it with `Auditlog.gs` or another service that defines `doPost` or `onOpen`.
6. Replace the default `Code.gs` contents with [gscripts/SchoolRegistration.gs](./gscripts/SchoolRegistration.gs). Save.

## 2. Configure the Apps Script project

Generate one random server secret in a terminal:

```powershell
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

Copy the generated value to a password manager. Do not commit it or put it in a `VITE_*` variable. The same secret must be used in Apps Script and Vercel.

In Apps Script, open **Project Settings → Script properties → Add script property** and enter:

| Property | Value |
| --- | --- |
| `SPREADSHEET_ID` | The ID copied in step 1 |
| `REGISTRATION_SHARED_SECRET` | Your generated secret |
| `REGISTRATION_BASE_URL` | `https://register.edash.online/` |

In the editor, select and run **initializeRegistrationSheets** once. Authorize the required spreadsheet access for your own script. This creates **Requests** and **Registrations**, including their headers. Reload the spreadsheet to see the **E-Dash registration** menu.

Do not rename/reorder the generated tabs or columns. Do not overwrite ID, token hash, expiry, or reference cells manually. You can widen columns and use filter views. The backend checks headers to avoid putting data in the wrong columns.

## 3. Deploy the Google Apps Script web app

1. Choose **Deploy → New deployment**.
2. Select deployment type **Web app**.
3. Set **Execute as: Me** (the script owner).
4. Set **Who has access: Anyone**. This must allow anonymous requests from the Vercel server.
5. Deploy and copy the deployed URL ending with **`/exec`**. Do not use the `/dev` test URL, script editor URL, or redirect target from `script.googleusercontent.com`.

The web app runs as its owner and can write to the owner's private sheet. Its POST handler verifies the server secret before accessing onboarding data. A direct GET deliberately returns an error response. If your Workspace policy prevents anonymous web apps, the Workspace administrator must allow this deployment or you must choose another backend; a sign-in-only deployment cannot work with this relay. See Google's [web app deployment documentation](https://developers.google.com/apps-script/guides/web).

After editing the script later, use **Deploy → Manage deployments → Edit → New version → Deploy**. Updating the existing deployment retains its `/exec` URL. Google Content Service redirects responses; the server relay follows redirects, as required by the [Content Service documentation](https://developers.google.com/apps-script/guides/content).

## 4. Configure and deploy the existing Vercel project

This implementation targets Vercel because the repository already has `vercel.json`. Add the registration subdomain to the **same Vercel project** that serves E-Dash. Do not create a second project or use GoDaddy forwarding.

In that project's **Settings → Environment Variables**, set these **server-only** values for **Production**:

| Name | Value |
| --- | --- |
| `SCHOOL_REGISTRATION_SCRIPT_URL` | Your Apps Script `/exec` URL |
| `SCHOOL_REGISTRATION_SHARED_SECRET` | Exactly the same secret as Apps Script |
| `SCHOOL_REGISTRATION_ALLOWED_ORIGINS` | `https://www.edash.online,https://edash.online,https://register.edash.online` |

Mark the secret as sensitive when the dashboard offers that option. The default origin allowlist already contains those three production origins; setting it explicitly makes the configuration clear. Add your exact preview/local origin only when testing there. Do not use `*`.

The old `VITE_SCHOOL_REGISTRATION_API_URL` is no longer used. Remove it after migrating. The browser calls the same-origin `/api/school-registration`; the relay adds the secret and contacts Apps Script server to server. Firebase settings remain in your existing configuration and are not requested from applicants.

Deploy this checkout using your normal Git/Vercel workflow. Keep the project root at the repository root, use `npm run build`, and keep the output directory **dist**. Include the root **api** directory and the updated **vercel.json** so Vercel deploys the server function as well as the Vite output. Keep your existing central registry environment variables for the main app.

Environment changes require a new deployment to take effect. See [Vercel environment variables](https://vercel.com/docs/environment-variables).

For public deployment, add a Vercel Firewall rate-limit rule scoped to **POST `/api/school-registration`**, per source IP, using a threshold appropriate for your school traffic (for example, start with 20 requests/minute/IP and monitor shared school networks). Availability/configuration depends on your plan; see [Vercel WAF rate limiting](https://vercel.com/docs/vercel-firewall/vercel-waf/rate-limiting). The script's honeypot and best-effort per-email cache throttle reduce basic spam, but they do not provide a durable global quota or stop distributed bots. Origin checking prevents unapproved browser origins; it is not proof of human identity.

### If E-Dash actually runs on Firebase Hosting

The repository also includes Firebase Hosting configuration. A deployment of **dist only** to Firebase will serve the page but will **not** run the Vercel `/api` function. Use the Vercel deployment described above for this workflow, or first port the relay to a supported backend and configure Firebase Hosting's `/api/school-registration` rewrite. DNS alone cannot provide the backend. Do not point `register` at a static-only deployment and expect submission to work.

## 5. Attach register.edash.online in Vercel

1. Open your existing E-Dash Vercel project.
2. Go to **Settings → Domains → Add Domain**.
3. Enter **register.edash.online**.
4. Assign it to **Production** and keep it as its own domain rather than redirecting it to `www.edash.online`.
5. Copy the **CNAME target that Vercel shows for this project**. Use that exact value; do not assume an old generic Vercel target or enter a URL/path.
6. If Vercel requests a TXT verification record, copy its exact name and value as well.

The application checks the hostname and shows the complete registration page at the subdomain root. It also supports `/register` on the main host for fallback/testing. Registration does not depend on selecting a school, Firebase initialization, or the main app's maintenance settings. See [Vercel custom domain setup](https://vercel.com/docs/domains/working-with-domains/add-a-domain).

## 6. Create the GoDaddy DNS record

1. Sign into GoDaddy and open **Domain Portfolio → edash.online → DNS**.
2. Confirm where authoritative DNS is managed. If the nameservers point to another provider such as Cloudflare, add the record at that provider instead of GoDaddy.
3. Under DNS records, choose **Add New Record**:

| Field | Enter |
| --- | --- |
| Type | `CNAME` |
| Name / Host | `register` |
| Value / Points to | The exact CNAME target displayed by Vercel |
| TTL | Default |

4. Save. If a conflicting record already exists for **register**, resolve that record only; leave `@`, `www`, mail, and other school services alone. A CNAME cannot coexist with other record types at the same name.
5. Add any TXT verification record Vercel requested, using its exact values.
6. Return to Vercel's Domains screen and wait for valid configuration and HTTPS certificate issuance. DNS propagation can take time; GoDaddy says changes usually take effect within an hour but may take up to 48 hours globally.
7. Open **https://register.edash.online/**. Without an invitation it should show the invitation instructions. This is expected; applicants need their full emailed link to see the form.

Do not put `https://`, `/register`, `#token`, an Apps Script URL, or a Google Sheets URL in the DNS CNAME value. A DNS record connects a hostname to hosting, not a path. See [GoDaddy's CNAME instructions](https://www.godaddy.com/help/add-a-cname-record-19236).

## 7. Handle an actual school request

1. The school submits the initial request from **Register your school** on the main selection page.
2. Review its new **Requests** row and verify the contact through your normal process. Initial status: **Pending**.
3. Click a cell on that request's data row, then **E-Dash registration → Create / renew link for selected request**.
4. The script changes the request to **Invited** and shows a private link in a copyable text box. Links expire after **14 days**. Generating a replacement immediately invalidates the earlier link. The sheet stores a hash, not the raw link, so copy it before closing the dialog. If you lose it, generate a replacement.
5. Manually email the link to the displayed school contact. No email is sent by the script. Use a message such as:

   > Hello [contact name],
   >
   > Please complete your school's E-Dash registration using this private link:
   > [paste the complete invitation link]
   >
   > Prepare your official school details, school head and contact information, and a Google Drive folder containing your school logo and video. Share the folder with “Anyone with the link” as a Viewer.
   >
   > Your registration link expires in 14 days. After submission, allow several days for our developer to prepare your database and workspace. We will email you when setup is complete.
   >
   > E-Dash team

6. The school opens the **entire link, including `#token=…`**. It sees prefilled request details and the full registration form. The official school ID must match the invitation; correct the request's school ID before issuing a replacement invitation if the original ID was wrong.
7. The school submits. **Registrations** receives one completed row, a **REG-…** reference, all profile fields, the Drive link, acknowledgment timestamps, and `schoolProfileJson`. Status: **Awaiting setup**. The matching request is updated too.
8. Review the files and complete manual setup. You may change the completed registration's `status` to **In setup** or **Ready** for internal tracking. These sheet statuses do not activate Firebase access.
9. After provisioning, testing sign-in, and enabling the registry entry, manually email the school its workspace access instructions. Do not email service-account keys or database credentials.

To reject/revoke a request before completion, set its Requests `status` to exactly **Rejected**. Do not delete completed rows to reuse a token; use the team’s manual correction process for changes after submission. Keep **Registrations** as the durable submission record. If a write is interrupted between the registration and request-row updates, a retry detects the existing registration by `requestId` and returns its reference without creating a second profile; staff can reconcile the Requests status using that reference.

## 8. Google Drive instructions for the school

1. Create a Drive folder and add the school's logo and introduction video. Division and district logos may be included if applicable.
2. Right-click the folder → **Share**.
3. Under **General access**, select **Anyone with the link**.
4. Select **Viewer**, save, and **Copy link**.
5. Open the copied link in an incognito/private window and confirm both files open without signing in.
6. Paste it into **Google Drive link** on the registration form and confirm the sharing checkbox.

The form validates that the link is an HTTPS Google Drive folder/file link and records the school's confirmation. It does not inspect the folder, fetch files, verify the sharing ACL, or guarantee that a logo/video is present. The E-Dash team checks these manually. A shared folder is recommended because both assets are needed. See Google's [Drive sharing guide](https://support.google.com/drive/answer/7166529?hl=en).

## 9. Map the completed profile into manual provisioning

The `schoolProfileJson` cell is a normal school profile draft, deliberately missing deployment settings. Copy/review it and merge it into your school registration JSON or the Edash Provision tool using the existing [setup guide](./SETUP_README.md).

| Registration input | Registry destination |
| --- | --- |
| Official name, short name, project name, tagline, brand color | `name`, `nickname`, `projectName`, `tagline`, `colorGradientTag` |
| Official DepEd ID | `schoolInfo.id` (preserved as text, including leading zeroes) |
| Region, division, district | `schoolInfo.region`, `schoolInfo.divisionOffice`, `schoolInfo.district` |
| Address, email, phone, Facebook, motto | `schoolInfo.schoolAddr`, `schoolInfo.email`, `schoolInfo.contactNumber`, `schoolInfo.fbPage`, `schoolInfo.motto` |
| School head details | `schoolHead.name`, `schoolHead.position`, `schoolHead.email`, `schoolHead.phoneNumber` |
| Google Drive folder | Private onboarding record; developer reviews and hosts the media |
| Registration contact person | Private onboarding record for the team’s correspondence |

The developer assigns the slug `id` for `schools/{schoolId}`, hosts the approved assets and sets `logoUrl`, `videoUrl`, and optionally `schoolInfo.divisionLogoUrl` / `districtLogoUrl`, adds the tenant `firebaseConfig`, sets audit/feedback endpoints and entitlements, and enables the school when ready. Drive sharing URLs are not direct video playback URLs; do not copy a folder link into `videoUrl`.

The public school registry makes enabled school documents readable to clients. Review which school head/contact information you publish; keep the onboarding contact, invitation metadata, and Drive folder link in the private spreadsheet. No registration contact details are automatically published by this workflow.

## 10. Verify before inviting schools

- Deploy with the three server environment values configured and the Apps Script web app publicly callable.
- Open the subdomain without a token: it shows invitation instructions, not the school login.
- Send one initial request using synthetic details. Confirm one **Requests** row.
- Submit the same school ID + contact email again: no second request row is created. A pending duplicate returns a generic acknowledgment without exposing other applicants' records.
- Generate a link and open it in a signed-out browser. Check prefilled fields, mobile layout, privacy policy, and all required inputs.
- Complete the form with a test Drive link. Confirm one **Registrations** row, its profile JSON, and **Awaiting setup**.
- Refresh/reopen the link: the saved reference is shown. Retrying cannot overwrite or duplicate the completed record.
- Renew an unsubmitted invitation: the old link must stop working. Test an expired invitation and a rejected request too.
- Confirm the existing main school selection and sign-in still work.
- Keep the spreadsheet Restricted. Share only the school branding folder with anyone who has the link.

Local UI preview: run `npm run dev` and visit `http://localhost:5173/register`. Vite alone does not run root `api` functions, so an invitation check/submission needs a deployed Vercel preview or **Vercel CLI `vercel dev`** with the server variables configured. For preview testing add the exact preview origin to the allowlist and set `REGISTRATION_BASE_URL` to your preview's `/register` URL before generating a test invitation. Restore the production base URL afterward. For localhost use an already-created production/preview invitation token at `/register#token=…`, a local relay runtime, and explicitly allow `http://localhost:5173` (or the port printed by Vercel dev); link generation only accepts HTTPS base URLs.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| Subdomain shows the main school picker | Confirm the deployment includes the updated `src/main.tsx`; verify the browser hostname is exactly `register.edash.online` and Vercel has not redirected it. |
| API response is HTML / an SPA page | Ensure the root `api/school-registration.mjs` function was deployed and the updated rewrite excludes `/api/`. A static Firebase-only deployment will not run it. |
| “School registration is not available yet” | Check the server variables, a valid `/exec` endpoint, a secret of at least 32 characters, and redeploy Vercel. |
| “This registration origin is not allowed” | Add the exact browser origin (scheme, hostname, port if any; no trailing slash/path) to the comma-separated allowlist and redeploy. |
| “Registration access denied” | The Vercel and Script Property secrets must match exactly. |
| “We could not confirm your submission” | Check web-app anonymous access, `/exec`, Workspace restrictions, and Apps Script Executions. Retry safely; a successfully saved profile will not be duplicated. |
| Generic script error | Confirm spreadsheet ID, script-owner access, initialized tabs and unchanged headers. Verify server settings privately without logging applicant data or credentials. |
| Invalid / expired invitation | Use the latest complete emailed link. Staff can renew an unsubmitted link from its Requests row. |
| Missing sheet menu | Reload the bound spreadsheet; verify `onOpen` is in its bound Apps Script project. |
| Drive link looks valid but files are inaccessible | The team must verify folder permissions/content manually. Ask the school to test without signing in. |
| A school is still missing from the directory | Sheet status does not provision or enable Firebase. Complete manual setup and the central registry entry. |

The script uses a shared lock for writes, checks input on the server, escapes spreadsheet formulas, hashes invitation tokens, and avoids publishing request lists. Apps Script and Google Sheets have service quotas; this implementation is intended for school onboarding volume, not high-volume public form ingestion. Keep normal spreadsheet backups and delete or retain old onboarding records according to your team's policy.
