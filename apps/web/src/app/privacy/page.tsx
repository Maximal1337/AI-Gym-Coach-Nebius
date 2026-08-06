import { palette } from "@gymcoach/shared";

const EFFECTIVE_DATE = "August 6, 2026";
const CONTACT_EMAIL = "dorhaimbob@gmail.com";

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
        padding: "48px 24px",
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
          app. This page explains what data we collect and how we use it.
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
          Your workout history and messages are sent to our AI provider
          (Google Gemini) to generate coaching replies and track your
          progress. We don't sell your data or use it for advertising.
        </p>

        <h2>Third parties</h2>
        <p>
          We use Supabase to store your account and workout data, Google
          Gemini to power the AI coach, PostHog for basic product-usage
          analytics, Sentry for crash and error reporting, and Apple/Expo's
          push notification services to deliver coach notifications. Each
          processes data only as needed to run the app.
        </p>

        <h2>Data deletion</h2>
        <p>
          You can permanently delete your account and all associated data at
          any time from Settings in the app.
        </p>

        <h2>Contact</h2>
        <p>
          Questions about this policy or your data:{" "}
          <a href={`mailto:${CONTACT_EMAIL}`} style={{ color: t.accent }}>
            {CONTACT_EMAIL}
          </a>
        </p>
      </div>
    </main>
  );
}
