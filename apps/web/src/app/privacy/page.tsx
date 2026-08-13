import { palette } from "@gymcoach/shared";

const EFFECTIVE_DATE = "August 13, 2026";
const CONTACT_EMAIL = "dorhaimbob@gmail.com";

// Accessible link color: the brand green fails AA contrast on white, so
// legal pages use a darker green + underline (see /accessibility).
const LINK: React.CSSProperties = { color: "#2F5D00", textDecoration: "underline" };

export default function Privacy() {
  const t = palette.light;
  return (
    <main
      style={{
        minHeight: "100vh",
        display: "flex",
        justifyContent: "center",
        background: t.bg,
        color: t.ink,
        padding: "48px 24px 80px",
        fontFamily: '-apple-system, "Segoe UI", Arial, sans-serif',
      }}
    >
      <div style={{ maxWidth: 640, width: "100%" }}>
        <h1 style={{ fontWeight: 800, letterSpacing: "-0.02em" }}>
          Privacy Policy
        </h1>
        <p style={{ color: t.inkSoft }}>Effective {EFFECTIVE_DATE}</p>

        <p>
          Notch Fitness ("Notch", "we", "us") is a personal AI workout coach
          app. This page explains what data we collect, how we use it, how we
          protect it, and the rights you have over it.
        </p>

        <h2>Data we collect</h2>
        <ul>
          <li>
            Account info: your email address, used for sign-in — or, if you
            sign in with Apple, the identifier Apple provides for your
            account instead.
          </li>
          <li>
            Coaching data: your training plans, chat messages with the
            coach, logged workout sets (exercise, weight, reps), and any
            notes you or the coach add about a set or exercise — this is
            what lets the coach track your progress over time.
          </li>
          <li>
            Coach persona settings: the name, tone, and preferences you
            configure for your coach.
          </li>
          <li>
            Fitness profile (optional): if you use the "AI-generated plan"
            feature, the goal, experience level, and days-per-week you
            select, plus gender, age, weight, height, and injury or
            limitation notes if you choose to share them — used only to
            personalize the generated plan. All of these fields are
            optional and skippable.
          </li>
          <li>
            Subscription status: whether you're on a free trial or a paid
            subscription and when it renews or expires. This is synced from
            Apple through RevenueCat so the app knows your access level. We
            never receive or store your payment card details — Apple
            processes all payments.
          </li>
          <li>
            Push notifications (optional): if you allow notifications, we
            store a device push token so the coach can reach you while the
            app is in the background. You can turn this off anytime in your
            device settings.
          </li>
          <li>
            App usage &amp; diagnostics: aggregate product-usage events
            (e.g. that a workout was started or completed) so we can see
            how the app is used, and crash/error reports so we can fix
            bugs. Both are configured to exclude your personal content and
            device-level identifying details where the tools allow it.
          </li>
          <li>
            Consent record: the date and version of our Terms you accepted,
            so we can show which version you agreed to.
          </li>
        </ul>

        <h2>How we use it</h2>
        <p>
          Your workout history and messages are sent to our AI provider to
          generate coaching replies and track your progress. We use this
          data only to operate the app: to sign you in, store your training
          data, generate personalized coaching, and maintain your
          preferences. We don't sell your data, and we don't use it for
          advertising.
        </p>

        <h2>Third parties who process your data</h2>
        <p>
          We rely on a small number of service providers, each of which
          processes your data only as needed to run the app:
        </p>
        <ul>
          <li>
            <strong>Supabase</strong> — stores your account, workout, and
            coaching data, and manages sign-in. Passwords are never stored in
            readable form, and every request is scoped so you can only reach
            your own data.
          </li>
          <li>
            <strong>OpenRouter</strong> and <strong>Google Gemini</strong> —
            your workout context and coach messages are sent over an
            encrypted connection to OpenRouter, which routes them to Google's
            Gemini model to generate coaching replies. We exclude direct
            identifiers such as your email from what is sent.
          </li>
          <li>
            <strong>RevenueCat</strong> — manages your subscription and, with
            Apple, tells the app whether your trial or subscription is active.
            It receives your account identifier and subscription status, not
            your payment details.
          </li>
          <li>
            <strong>PostHog</strong> — basic product-usage analytics, linked
            to an internal account identifier rather than your name or email.
          </li>
          <li>
            <strong>Sentry</strong> — crash and error reporting, configured
            to exclude personal content and personally-identifying details.
          </li>
          <li>
            <strong>Apple</strong> and <strong>Expo</strong> — deliver the
            push notifications you opt into.
          </li>
        </ul>

        <h2>Where your data is stored</h2>
        <p>
          Your account and workout data are stored on Supabase infrastructure
          currently hosted in the Asia-Pacific region. Some providers listed
          above (for example our AI and analytics providers) may process data
          on servers located in other countries. Wherever your data is
          processed, the protections described in this policy continue to
          apply.
        </p>

        <h2>Security</h2>
        <p>
          We take reasonable technical measures to protect your data. Traffic
          between the app, our servers, and our providers is encrypted in
          transit (HTTPS/TLS). Access to your data is enforced by row-level
          security so each account can reach only its own records, and the
          keys our services use are scoped to the minimum they need. No system
          is perfectly secure, but we work to keep these protections current.
        </p>

        <h2>Data retention &amp; account deletion</h2>
        <p>
          We keep your data for as long as your account exists so the coach
          can remember your history. You can permanently delete your account
          and all associated data at any time from Settings in the app. When
          you delete your account we remove your data from our database and
          ask our service providers to delete their copies; some providers
          process erasure asynchronously and may take up to 90 days to purge
          backups. Aggregate, non-identifying usage statistics that can no
          longer be linked to you may be retained.
        </p>

        <h2>Your rights</h2>
        <p>
          You can access and update most of your data directly in the app, and
          delete all of it from Settings at any time. Depending on where you
          live, you may also have rights under applicable privacy law —
          including, for users in Israel, the right to inspect and request
          correction of your personal information under the Protection of
          Privacy Law, 5741-1981. To exercise any of these rights, contact us
          at{" "}
          <a href={`mailto:${CONTACT_EMAIL}`} style={LINK}>
            {CONTACT_EMAIL}
          </a>
          .
        </p>

        <h2>Children's privacy</h2>
        <p>
          Notch is not directed at children. You must be at least 16 years old
          to use the app (see our{" "}
          <a href="/terms" style={LINK}>
            Terms of Use
          </a>
          ), and we do not knowingly collect data from anyone under that age.
          If you believe a child has provided us data, contact us and we will
          delete it.
        </p>

        <h2>Changes to this policy</h2>
        <p>
          We may update this policy from time to time. When we do, we'll
          revise the "Effective" date at the top of this page, and for
          material changes we'll make the update clear in the app. Continuing
          to use Notch after an update means you accept the revised policy.
        </p>

        <h2>Contact</h2>
        <p>
          Questions about this policy or your data:{" "}
          <a href={`mailto:${CONTACT_EMAIL}`} style={LINK}>
            {CONTACT_EMAIL}
          </a>
        </p>
      </div>
    </main>
  );
}
