import { palette } from "@gymcoach/shared";

/** GYM-36: placeholder pointing at the real flow — subscriptions are managed on-device via Apple IAP/RevenueCat (see apps/mobile/app/subscribe.tsx), not on the web. */
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
        Notch's first month is free. Subscriptions are managed entirely
        through the App Store — open the app and go to Settings &gt;
        Subscription to view or change your plan.
      </p>
    </main>
  );
}
