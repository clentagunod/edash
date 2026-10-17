import { Link } from 'react-router-dom';
import { useEffect } from 'react';
import '../styles/pages/privacy-policy.css';

const policySections = [
  {
    title: 'Who is responsible for school information?',
    content: (
      <>
        <p>For learner and school records, the participating school is generally the organization responsible for deciding why those records are used. E-Dash provides software for the school workspace, and the school’s arrangements determine the exact roles of the school and the platform operator.</p>
        <p>If you are a learner, parent, or guardian with a question about a school record, contact the school first. The school can direct you to its appropriate privacy contact.</p>
      </>
    ),
  },
  {
    title: 'What information may be handled?',
    content: (
      <>
        <ul>
          <li><strong>School registration requests:</strong> school name, DepEd school ID, contact person, email address, phone number, and schools division.</li>
          <li><strong>School-directory details:</strong> enabled school directory entries are client-readable and may contain school information, branding, school-head name or contact details, and workspace configuration.</li>
          <li><strong>Account information:</strong> account identifiers, email address, display and role information, and authentication status. Sign-in is handled through Firebase Authentication; the E-Dash interface does not display account passwords.</li>
          <li><strong>School and learner records:</strong> information that authorized school users enter or manage, which may include enrollment, learner profile, academic, attendance, and related school information.</li>
          <li><strong>Operational records:</strong> when the optional audit service is enabled, it can record a user, action, time, related record identifier, selected status fields, and an application session identifier.</li>
          <li><strong>Feedback:</strong> if the optional feedback service is enabled and used, the signed-in user’s email, ratings, and written feedback may be submitted.</li>
        </ul>
        <p>Please do not submit information that is not needed for the school task or registration request.</p>
      </>
    ),
  },
  {
    title: 'How is information used?',
    content: (
      <>
        <p>Information is used to provide the selected school workspace, authenticate and manage accounts, support school administration and learner-related workflows, process school registration requests, maintain configured operational audit records, and respond to feedback or support requests.</p>
        <p>When the registration endpoint is configured, school requests are sent to that service for review. The service stores the submitted school and contact fields in its registration records so the E-Dash team can review the request and follow up.</p>
      </>
    ),
  },
  {
    title: 'Where is information stored and who can see it?',
    content: (
      <>
        <p>Application records are stored in the Firestore project configured for the selected school. Access depends on the school’s account setup, assigned role, and database permissions. Firebase Authentication is used for sign-in.</p>
        <p>The central school directory is separate from learner records. All fields on enabled school-directory documents are readable by clients, so a directory entry may expose its school-head contact details and other configured fields. Schools should only place information in those entries that is intended to be publicly readable.</p>
        <p>Depending on the school’s deployment, separate Google Apps Script services may be configured for registration requests, audit events, or feedback. These services are separate from the school’s learner database. A school administrator may also download a database backup; downloaded files are then stored on the device or destination chosen by that administrator.</p>
        <p>E-Dash uses third-party infrastructure needed to provide these services, including Google Firebase and, where configured, Google Apps Script and Google Sheets. Their processing is also subject to the providers’ terms and privacy information.</p>
      </>
    ),
  },
  {
    title: 'Does E-Dash use browser storage?',
    content: (
      <>
        <p>Yes. The app uses browser storage for items such as the selected school, session details, and cached application data. Firestore offline persistence may keep recently accessed data in the browser so the app can work through brief connection interruptions. Sign out on shared devices, and use the browser’s site-data controls when you need to remove locally cached information.</p>
      </>
    ),
  },
  {
    title: 'How long is information kept?',
    content: (
      <>
        <p>School records are managed in the school’s configured database and are subject to that school’s retention and records-management rules. Audit, feedback, and registration records are kept in the separate services or spreadsheets configured by their operators. The application does not set one universal retention period for all schools or services.</p>
        <p>For a retention or deletion request, contact the school administrator responsible for the relevant records, or the E-Dash administrator for a school registration request.</p>
      </>
    ),
  },
  {
    title: 'What choices and rights do I have?',
    content: (
      <>
        <p>Depending on the circumstances and applicable law, you may be able to request access to, correction of, or other action regarding personal information. Direct requests about learner or account records to the responsible school, which can verify the request and explain the process that applies. Requests about a school registration submission may be directed to the E-Dash administrator through the contact channel provided by your school.</p>
        <p>Schools using E-Dash remain responsible for providing the privacy notices and handling requests required for their records.</p>
      </>
    ),
  },
  {
    title: 'How is children’s information handled?',
    content: (
      <>
        <p>E-Dash is a school platform and may process learner information, including information about children, when a school’s authorized users enter or manage it. Schools should use the platform only for authorized educational purposes, provide the notices required for their community, and follow their applicable safeguards and consent procedures.</p>
      </>
    ),
  },
  {
    title: 'How will this policy change?',
    content: (
      <>
        <p>This notice may be updated when the application or its configured data services change. The current version will be available from the school-selection page. This general notice describes application behavior and does not replace a school’s own privacy notice or approved data-protection procedures.</p>
      </>
    ),
  },
];

export default function PrivacyPolicyPage() {
  useEffect(() => {
    const previousTitle = document.title;
    document.title = 'E-Dash — Privacy Policy';
    return () => {
      document.title = previousTitle;
    };
  }, []);

  return (
    <main className="privacy-policy-page">
      <header className="privacy-policy-header">
        <Link className="privacy-policy-brand" to="/select-school" aria-label="E-Dash school selection">
          <img src="/assets/edash/edash.png" alt="" width="42" height="42" />
          <span>E-Dash</span>
        </Link>
        <Link className="privacy-policy-back" to="/select-school">Back to school selection</Link>
      </header>
      <article className="privacy-policy-content">
        <section className="privacy-policy-intro" aria-labelledby="privacyPolicyTitle">
          <span className="privacy-policy-eyebrow">Privacy &amp; data protection</span>
          <h1 id="privacyPolicyTitle">Your information deserves thoughtful care.</h1>
          <p>This notice explains what information E-Dash may handle, how the school workspace uses it, and where to direct a privacy question. It is written to reflect the application’s current data flows.</p>
          <div className="privacy-policy-notice">
            <strong>For learners and families</strong>
            <span>Your school manages its learner records. For a question or request about a learner’s information, please contact the school administrator first.</span>
          </div>
        </section>
        <section className="privacy-policy-principles" aria-label="Privacy at a glance">
          <div><strong>School-managed</strong><span>Each school uses its configured workspace and access rules.</span></div>
          <div><strong>Purposeful use</strong><span>Information supports school operations and the services described here.</span></div>
          <div><strong>Clear requests</strong><span>Start with the school responsible for the relevant records.</span></div>
        </section>
        <nav className="privacy-policy-toc" aria-label="Privacy policy sections">
          <span>In this notice</span>
          <a href="#privacy-responsibility">Responsibility</a>
          <a href="#privacy-information">Information</a>
          <a href="#privacy-storage">Use and storage</a>
          <a href="#privacy-retention">Retention</a>
          <a href="#privacy-rights">Your rights</a>
        </nav>
        <div className="privacy-policy-sections">
          {policySections.map((section, index) => (
            <section
              className="privacy-policy-section"
              id={`privacy-${['responsibility', 'information', 'use', 'storage', 'browser', 'retention', 'rights', 'children', 'changes'][index]}`}
              key={section.title}
            >
              <span className="privacy-policy-section-number" aria-hidden="true">{String(index + 1).padStart(2, '0')}</span>
              <div>
                <h2>{section.title}</h2>
                {section.content}
              </div>
            </section>
          ))}
        </div>
        <aside className="privacy-policy-contact">
          <h2>Need help with a privacy question?</h2>
          <p>For learner, parent, or school-account information, contact your school administrator. For a school registration request, contact the E-Dash administrator using the channel provided by your school.</p>
          <Link to="/select-school">Return to E-Dash</Link>
        </aside>
      </article>
      <footer className="privacy-policy-footer">
        <span>© 2026 E-Dash · Courtesy of ClentIndustries</span>
        <span>Privacy and data protection</span>
      </footer>
    </main>
  );
}
