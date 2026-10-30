import { useEffect, useRef, useState, type FormEvent } from 'react';
import { schoolRegistrationApi, type RegistrationReply } from '../lib/school-registration-api';
import '../styles/pages/school-registration.css';

interface FieldProps {
  name: string;
  label: string;
  required?: boolean;
  type?: string;
  maxLength?: number;
  autoComplete?: string;
  defaultValue?: string;
  hint?: string;
  pattern?: string;
}

function Field({ name, label, required = false, type = 'text', maxLength = 160, hint, ...props }: FieldProps) {
  return <div className="enrollment-field">
    <label htmlFor={name}>{label}{required && <span aria-hidden="true"> *</span>}</label>
    <input id={name} name={name} type={type} maxLength={maxLength} required={required}
      onInput={(event) => event.currentTarget.setCustomValidity('')}
      aria-describedby={hint ? `${name}-hint` : undefined} {...props} />
    {hint && <small id={`${name}-hint`}>{hint}</small>}
  </div>;
}

function readToken(): string {
  const token = new URLSearchParams(window.location.hash.slice(1)).get('token') || '';
  return /^[a-f0-9]{64}$/.test(token) ? token : '';
}

const privacy = <p className="enrollment-privacy">By continuing, you acknowledge E-Dash’s{' '}
  <a href="https://www.edash.online/privacy-policy" target="_blank" rel="noopener noreferrer"><strong>Privacy Policy</strong></a>.</p>;

export default function SchoolRegistrationPage() {
  const [token] = useState(readToken);
  const [invitation, setInvitation] = useState<RegistrationReply | null>(null);
  const [loading, setLoading] = useState(Boolean(token));
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [receipt, setReceipt] = useState('');
  const busy = useRef(false);
  const statusRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    document.title = 'E-Dash — Complete school registration';
    document.querySelector('meta[name="description"]')?.setAttribute('content', 'Complete your school’s E-Dash registration by invitation.');
    const robots = document.createElement('meta');
    robots.name = 'robots'; robots.content = 'noindex, nofollow';
    document.head.append(robots);
    return () => robots.remove();
  }, []);

  useEffect(() => {
    if (!token) return;
    const controller = new AbortController();
    setLoading(true); setError('');
    schoolRegistrationApi('getSchoolInvitation', { token }, controller.signal)
      .then((data) => {
        if (controller.signal.aborted) return;
        if (data.registrationId) setReceipt(data.registrationId);
        else setInvitation(data);
      })
      .catch((failure) => {
        if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : 'We could not check your invitation.');
      })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [token, retry]);

  useEffect(() => { if (receipt || error) statusRef.current?.focus(); }, [receipt, error]);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy.current) return;
    const form = event.currentTarget;
    const drive = form.elements.namedItem('driveLink') as HTMLInputElement;
    drive.setCustomValidity('');
    try {
      const url = new URL(drive.value);
      if (url.protocol !== 'https:' || url.hostname !== 'drive.google.com' || url.username || url.password || url.port ||
          !/^\/(?:drive\/(?:u\/\d+\/)?folders|file\/d)\/[A-Za-z0-9_-]+\/?/.test(url.pathname)) {
        drive.setCustomValidity('Enter a Google Drive folder or file sharing link (https://drive.google.com/…).');
      }
    } catch { drive.setCustomValidity('Enter a valid Google Drive sharing link.'); }
    if (!form.reportValidity()) return;
    busy.current = true; setSubmitting(true); setError('');
    const fields = Object.fromEntries(new FormData(form).entries());
    try {
      const data = await schoolRegistrationApi('submitCompleteSchoolRegistration', {
        token, fields, privacyAcknowledged: true, driveSharingConfirmed: true,
      });
      if (!data.registrationId) throw new Error('We could not confirm your submission. Please try again.');
      setReceipt(data.registrationId);
    } catch (failure) {
      setError(failure instanceof Error && failure.name === 'AbortError'
        ? 'We could not confirm your submission in time. Please retry; saved submissions will not be duplicated.'
        : failure instanceof Error ? failure.message : 'Registration could not be saved. Please try again.');
    } finally { busy.current = false; setSubmitting(false); }
  };

  return <div className="enrollment-page">
    <header className="enrollment-header">
      <a className="enrollment-brand" href="https://www.edash.online/select-school">
        <img src="/assets/edash/edash.png" alt="E-Dash logo" width="48" height="48" />
        <span><strong>E-Dash</strong><small>School registration</small></span>
      </a>
      <a href="https://www.edash.online/select-school">Back to E-Dash <span aria-hidden="true">↗</span></a>
    </header>
    <main className="enrollment-layout">
      <aside className="enrollment-intro">
        <p className="enrollment-eyebrow">A workspace for your school</p>
        <h1>Your school’s<br />next chapter.</h1>
        <p>Help us get to know your school so we can prepare your E-Dash workspace.</p>
        <ol className="enrollment-steps" aria-label="School onboarding steps">
          <li><span>01</span><div><strong>Request registration</strong><p>Send your initial details from the school selection page.</p></div></li>
          <li aria-current="step"><span>02</span><div><strong>Complete your school profile</strong><p>Use the invitation emailed by the E-Dash team.</p></div></li>
          <li><span>03</span><div><strong>We prepare your workspace</strong><p>Our developer manually sets up your database. This can take several days.</p></div></li>
        </ol>
        <p className="enrollment-aside-note">We’ll email your contact person when your school is ready to use E-Dash.</p>
      </aside>
      <section className="enrollment-card" aria-labelledby="enrollment-title" aria-busy={loading}>
        {loading ? <div role="status" className="enrollment-message"><h2 id="enrollment-title">Checking your invitation…</h2><p>Please wait while we verify your registration link.</p></div>
          : receipt ? <div ref={statusRef} tabIndex={-1} role="status" className="enrollment-message">
            <span className="enrollment-badge">Registration received</span><h2 id="enrollment-title">Thank you for registering.</h2>
            <p>Your school information has been saved. The E-Dash team will review it and manually prepare your database and workspace over the next several days.</p>
            <p>We’ll email your contact person when setup is complete. Submitting this form does not activate school access.</p>
            <p className="enrollment-reference">Reference: <strong>{receipt}</strong></p>
            <a className="enrollment-button" href="https://www.edash.online/select-school">Return to E-Dash</a>
          </div>
          : !invitation ? <div ref={statusRef} tabIndex={-1} role={error ? 'alert' : undefined} className="enrollment-message">
            <span className="enrollment-badge">By invitation</span><h2 id="enrollment-title">{token ? 'Check your registration link' : 'Have an invitation?'}</h2>
            <p>{error || 'Open the complete registration link emailed by the E-Dash team. If you have not requested registration yet, start on the school selection page.'}</p>
            {token && <button type="button" className="enrollment-button" onClick={() => setRetry((value) => value + 1)}>Check invitation again</button>}
            <a href="https://www.edash.online/select-school">Go to school selection</a>{privacy}
          </div>
          : <form onSubmit={submit}>
            <div className="enrollment-form-heading"><span className="enrollment-badge">Step 02 / School profile</span>
              <h2 id="enrollment-title">Complete school registration</h2>
              <p>Invited school: <strong>{invitation.schoolName}</strong> · {invitation.schoolId}</p>
              <p>Fields marked <span aria-hidden="true">*</span> are required. Use official school details.</p>
            </div>
            <fieldset disabled={submitting}><legend>01 — School identity</legend><div className="enrollment-grid">
              <Field name="name" label="Official school name" required maxLength={120} autoComplete="organization" defaultValue={invitation.schoolName} />
              <Field name="officialSchoolId" label="DepEd school ID" required maxLength={30} defaultValue={invitation.schoolId} hint="Your official school ID; your E-Dash workspace ID is assigned by our team." />
              <Field name="nickname" label="School short name" required maxLength={64} hint="For example, San Roque ES." />
              <Field name="projectName" label="Workspace / project name" maxLength={120} hint="Optional name beside your school logo." />
              <Field name="tagline" label="School tagline" maxLength={240} />
              <Field name="motto" label="School motto" maxLength={240} />
              <Field name="colorGradientTag" label="School brand color" type="color" defaultValue="#176b5b" />
            </div></fieldset>
            <fieldset disabled={submitting}><legend>02 — Location & school contacts</legend><div className="enrollment-grid">
              <Field name="region" label="Region" required />
              <Field name="divisionOffice" label="Schools division office" required defaultValue={invitation.division} />
              <Field name="district" label="District" required />
              <Field name="schoolAddr" label="Complete school address" required maxLength={300} autoComplete="street-address" />
              <Field name="schoolEmail" label="Official school email" required type="email" maxLength={254} />
              <Field name="contactNumber" label="School contact number" required type="tel" maxLength={40} />
              <Field name="fbPage" label="School Facebook page" type="url" maxLength={500} hint="Optional. Include https://." />
            </div></fieldset>
            <fieldset disabled={submitting}><legend>03 — School head</legend><div className="enrollment-grid">
              <Field name="headName" label="School head’s full name" required />
              <Field name="headPosition" label="Position / designation" required />
              <Field name="headEmail" label="School head’s email" required type="email" maxLength={160} />
              <Field name="headPhoneNumber" label="School head’s phone number" required type="tel" maxLength={40} />
            </div></fieldset>
            <fieldset disabled={submitting}><legend>04 — Registration contact person</legend>
              <p>We’ll use these details for questions and your workspace readiness email.</p><div className="enrollment-grid">
              <Field name="contactName" label="Full name" required autoComplete="name" defaultValue={invitation.contactName} />
              <Field name="contactRole" label="School role / designation" required />
              <Field name="contactEmail" label="Email address" required type="email" maxLength={254} autoComplete="email" defaultValue={invitation.email} />
              <Field name="contactPhone" label="Phone number" required type="tel" maxLength={40} autoComplete="tel" defaultValue={invitation.phone} />
            </div></fieldset>
            <fieldset disabled={submitting}><legend>05 — School logo & video</legend>
              <Field name="driveLink" label="Google Drive link" required type="url" maxLength={1000}
                hint={'It should contain the school’s logo and video. Share the folder as “Anyone with the link” with Viewer access, then paste the link here. You may also include division and district logos in the folder.'} />
              <p className="enrollment-callout">Share school branding files only. Open the link in a private / incognito window to check that the files are accessible without signing in.</p>
              <label className="enrollment-check"><input type="checkbox" required name="driveSharingConfirmed" />
                <span>I confirm that the folder contains our school’s logo and video and is shared with “Anyone with the link” as a Viewer.</span></label>
            </fieldset>
            <div className="enrollment-trap" aria-hidden="true"><label htmlFor="website">Leave this field empty</label><input id="website" name="website" tabIndex={-1} autoComplete="off" /></div>
            {error && <div ref={statusRef} tabIndex={-1} className="enrollment-error" role="alert">{error}</div>}
            {privacy}
            <div className="enrollment-form-footer"><p>After submission, allow several days for manual database setup.</p>
              <button className="enrollment-button" type="submit" disabled={submitting}>{submitting ? 'Submitting…' : 'Submit school registration'}</button></div>
          </form>}
      </section>
    </main>
    <footer className="enrollment-footer">© {new Date().getFullYear()} E-Dash · Courtesy of <a href="https://clentindustries.vercel.app/" target="_blank" rel="noopener noreferrer">ClentIndustries</a></footer>
  </div>;
}
