import { palette } from "@gymcoach/shared";

const EFFECTIVE_DATE = "August 7, 2026";
const CONTACT_EMAIL = "dorhaimbob@gmail.com";

export default function Terms() {
  const t = palette.light;
  return (
    <main
      style={{
        minHeight: "100vh",
        display: "flex",
        justifyContent: "center",
        background: t.bg,
        color: t.ink,
        padding: "48px 24px",
        fontFamily: '-apple-system, "Segoe UI", Arial, sans-serif',
      }}
    >
      <div style={{ maxWidth: 640, width: "100%" }}>
        <h1 style={{ fontWeight: 800, letterSpacing: "-0.02em" }}>
          Terms of Use
        </h1>
        <p style={{ color: t.inkSoft }}>Effective {EFFECTIVE_DATE}</p>

        <p>
          These Terms of Use ("Terms") govern your use of the Notch Fitness
          app and related services ("Notch", "we", "us"). By creating an
          account or using Notch, you agree to these Terms. If you don't
          agree, don't use the app.
        </p>

        <h2>Eligibility</h2>
        <p>
          You must be at least 16 years old to use Notch. By using the app,
          you confirm you meet this requirement.
        </p>

        <h2>Health &amp; fitness disclaimer</h2>
        <p>
          Notch provides general workout suggestions based on the
          information you provide. This is not medical advice. Consult a
          doctor before starting any training program, especially if you
          have a pre-existing medical condition. You assume all risk of
          injury resulting from exercises the app suggests. Notch and its
          creators are not responsible for any injury, loss, or damage
          arising from use of the app. You confirmed this disclaimer
          separately when you accepted it in the app.
        </p>

        <h2>Your account</h2>
        <p>
          You're responsible for keeping your account credentials secure and
          for all activity under your account. Tell us right away at{" "}
          <a href={`mailto:${CONTACT_EMAIL}`} style={{ color: t.accent }}>
            {CONTACT_EMAIL}
          </a>{" "}
          if you suspect unauthorized use.
        </p>

        <h2>Your content</h2>
        <p>
          You keep ownership of the training plans, chat messages, and
          workout data you provide. By using Notch, you let us process that
          content — including sending it to our AI provider — to generate
          coaching replies and track your progress, as described in our{" "}
          <a href="/privacy" style={{ color: t.accent }}>
            Privacy Policy
          </a>
          . Don't submit content that's illegal, infringes someone else's
          rights, or is abusive toward our systems or other people.
        </p>

        <h2>Acceptable use</h2>
        <p>
          Use Notch only as intended: as a personal training tool for
          yourself. Don't try to disrupt the service, reverse-engineer it,
          access other users' data, or use it to build a competing product.
          We may suspend or terminate accounts that violate this.
        </p>

        <h2>Subscriptions</h2>
        <p>
          Your first month of Notch is free — no payment method required.
          After that, continued access to AI-coached workouts requires a
          paid subscription (billed monthly or annually), purchased and
          managed through the App Store. Payment is charged to your Apple
          ID, and subscriptions renew automatically unless canceled at
          least 24 hours before the end of the current period. You can
          manage or cancel anytime in your device Settings. Your logged
          workout history and manually-tracked sets always remain
          accessible, whether or not you're subscribed.
        </p>

        <h2>Third-party services</h2>
        <p>
          Notch relies on third-party services to operate — including
          Supabase, Google Gemini, PostHog, Sentry, and Apple/Expo's push
          notification services, as described in our{" "}
          <a href="/privacy" style={{ color: t.accent }}>
            Privacy Policy
          </a>
          . We aren't responsible for outages or issues caused by these
          third parties.
        </p>

        <h2>Termination</h2>
        <p>
          You can stop using Notch and delete your account at any time from
          Settings in the app, which permanently removes your data. We may
          suspend or terminate your access if you violate these Terms.
        </p>

        <h2>Disclaimer of warranties</h2>
        <p>
          Notch is provided "as is," without warranties of any kind. We
          don't guarantee the app will be uninterrupted, error-free, or
          that any AI-generated suggestion will be accurate or suitable for
          your specific circumstances.
        </p>

        <h2>Limitation of liability</h2>
        <p>
          To the fullest extent permitted by law, Notch and its creators
          aren't liable for any indirect, incidental, or consequential
          damages arising from your use of the app, including — but not
          limited to — injury arising from a suggested workout, as described
          in the health &amp; fitness disclaimer above.
        </p>

        <h2>Changes to these Terms</h2>
        <p>
          We may update these Terms from time to time. If we make a
          material change, we'll ask you to accept the new version before
          you continue using the app.
        </p>

        <h2>Contact</h2>
        <p>
          Questions about these Terms:{" "}
          <a href={`mailto:${CONTACT_EMAIL}`} style={{ color: t.accent }}>
            {CONTACT_EMAIL}
          </a>
        </p>
      </div>
    </main>
  );
}
