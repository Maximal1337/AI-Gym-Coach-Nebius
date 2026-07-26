import Link from "next/link";
import { palette, typography } from "@gymcoach/shared";

export default function Home() {
  const t = palette.light;
  return (
    <main
      style={{
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        background: t.bg,
        color: t.ink,
        fontFamily:
          '-apple-system, "Segoe UI", "Helvetica Neue", Arial, sans-serif',
        padding: 24,
      }}
    >
      <h1
        style={{
          fontWeight: Number(typography.screenTitle.weight),
          letterSpacing: typography.screenTitle.letterSpacing,
          margin: 0,
        }}
      >
        GymCoach AI
      </h1>
      <p style={{ color: t.inkSoft, maxWidth: "42ch", textAlign: "center" }}>
        The personal trainer that remembers every rep, every set, every kg —
        and pushes you a little further each workout.
      </p>
      <div style={{ display: "flex", gap: 12, marginTop: 16 }}>
        <Link
          href="/plan"
          style={{
            background: t.accent,
            color: t.onAccent,
            padding: "10px 22px",
            borderRadius: 24,
            fontWeight: 700,
            textDecoration: "none",
          }}
        >
          My plan
        </Link>
        <Link
          href="/billing"
          style={{
            color: t.accent,
            padding: "10px 22px",
            fontWeight: 600,
            textDecoration: "none",
          }}
        >
          Billing
        </Link>
      </div>
    </main>
  );
}
