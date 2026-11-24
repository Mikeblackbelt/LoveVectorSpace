import { Link } from 'react-router-dom';
import { Footer } from '../components/Shell';

/** Public privacy policy (store requirement). Plain language on purpose. */
export function PrivacyScreen() {
  return (
    <main className="screen doc-screen">
      <article className="pane doc">
        <h1 className="doc-h">Privacy policy</h1>
        <p className="dimt">LoveVectorSpace · last updated 2026-11-24</p>
        <h2>What the app does</h2>
        <p>
          LoveVectorSpace helps you reflect on a relationship using chats you import, questionnaires you fill in and notes you
          add. It shows rough, uncalibrated estimates and pattern warnings. It is not therapy, counselling, or a crisis service.
        </p>
        <h2>What we store</h2>
        <ul>
          <li>Your account: email, display name, sign-in method (password hash, Google or Apple account id).</li>
          <li>Your data: imported or captured messages, facts, hangout logs, questionnaire answers and analysis results.</li>
          <li>Security records: sign-in sessions and an audit log of account events. Logs never contain message text.</li>
        </ul>
        <h2>How it is protected</h2>
        <ul>
          <li>Each account has its own encrypted database with its own random key.</li>
          <li>Connections use HTTPS. Access tokens expire after 15 minutes.</li>
          <li>No advertising, no analytics, no tracking, no selling of data.</li>
        </ul>
        <h2>The AI assistant</h2>
        <p>
          If you turn the assistant on, the parts of your data needed to answer you are sent to the model provider (Groq) for that
          request only, with zero data retention requested. You can stop it from reading message text, or turn it off, in Settings.
        </p>
        <h2>Your choices</h2>
        <ul>
          <li>Export everything as JSON from Settings → Your data.</li>
          <li>Delete your account from Settings → Your data. This permanently deletes your database, account and tokens.</li>
          <li>Delete any single upload, fact or hangout at any time.</li>
        </ul>
        <h2>Age</h2>
        <p>The app is for people aged 17 and over.</p>
        <h2>Contact</h2>
        <p>Questions about privacy: contact the operator of this server (the address on its sign-in page or in the app store listing).</p>
        <p>
          <Link to="/people">Back to the app</Link>
        </p>
      </article>
      <Footer />
    </main>
  );
}
