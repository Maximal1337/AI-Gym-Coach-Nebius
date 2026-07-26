import { palette } from "@gymcoach/shared";

/** GYM-36: placeholder until Phase 2 (Apple IAP via RevenueCat). */
export default function Billing() {
  const t = palette.light;
  return (
    <main
      style={{
        minHeight: "100vh", display: "flex", flexDirection: "column",
        alignItems: "center", justifyContent: "center",
        background: t.bg, color: t.ink, padding: 24,
        fontFamily: '-apple-system, "Segoe UI", Arial, sans-serif',
      }}
    >
      <h1 style={{ fontWeight: 800, letterSpacing: "-0.02em" }}>Billing</h1>
      <p style={{ color: t.inkSoft, maxWidth: "44ch", textAlign: "center" }}>
        GymCoach AI is currently free while in early access. Subscriptions
        will be handled through the App Store when they launch.
      </p>
    </main>
  );
}
