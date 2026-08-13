import type { Metadata } from "next";

// Israeli accessibility statement (הצהרת נגישות) required under the Equal
// Rights for Persons with Disabilities Regulations (Service Accessibility
// Adjustments), 2013, and Israeli Standard 5568 (based on WCAG 2.0 AA).
// Hebrew is the legally required form; an English translation follows.
const LAST_UPDATED_HE = "13 באוגוסט 2026";
const LAST_UPDATED_EN = "August 13, 2026";
const COORDINATOR = "Dor Haim Bobrutsky";
const CONTACT_EMAIL = "dorhaimbob@gmail.com";

export const metadata: Metadata = {
  title: "הצהרת נגישות · Accessibility Statement — Notch",
  description:
    "הצהרת הנגישות של אתר Notch לפי תקן ישראלי 5568 ותקנות שוויון זכויות לאנשים עם מוגבלות.",
};

// Deliberately not the shared dark palette: a legal/consent page reads
// better as a plain high-contrast document, and this matches /privacy and
// /terms. Colors here are checked to clear WCAG AA 4.5:1 on white.
const INK = "#0F1419";
const INK_SOFT = "#3F4B54";
const LINK = "#2F5D00"; // dark green — 4.5:1+ on white, unlike the brand accent
const RULE = "#E5E7E8";

const link: React.CSSProperties = {
  color: LINK,
  textDecoration: "underline",
  textUnderlineOffset: "2px",
};

const h2: React.CSSProperties = {
  fontSize: 20,
  fontWeight: 700,
  marginTop: 36,
  marginBottom: 8,
};

const p: React.CSSProperties = { lineHeight: 1.65, margin: "0 0 12px" };

export default function Accessibility() {
  return (
    <main
      style={{
        minHeight: "100vh",
        display: "flex",
        justifyContent: "center",
        background: "#FFFFFF",
        color: INK,
        padding: "48px 24px 80px",
        fontFamily:
          '"Rubik", -apple-system, "Segoe UI", "Helvetica Neue", Arial, sans-serif',
      }}
    >
      <div style={{ maxWidth: 680, width: "100%" }}>
        {/* ---------------- Hebrew (primary, RTL) ---------------- */}
        <section lang="he" dir="rtl">
          <h1 style={{ fontWeight: 800, letterSpacing: "-0.02em", fontSize: 32, margin: "0 0 4px" }}>
            הצהרת נגישות
          </h1>
          <p style={{ color: INK_SOFT, margin: "0 0 24px" }}>
            עודכן לאחרונה: {LAST_UPDATED_HE}
          </p>

          <p style={p}>
            אנו ב-Notch רואים חשיבות רבה במתן שירות שוויוני לכלל הגולשים,
            ופועלים כדי שאתר האינטרנט שלנו יהיה נגיש לאנשים עם מוגבלות. הנגשת
            האתר נעשתה בהתאם לתקנות שוויון זכויות לאנשים עם מוגבלות (התאמות
            נגישות לשירות), התשע״ג-2013, ולתקן הישראלי 5568 המבוסס על הנחיות
            הנגישות לתכני אינטרנט WCAG 2.0 ברמת AA.
          </p>

          <h2 style={h2}>מה הונגש באתר</h2>
          <ul style={{ lineHeight: 1.65, paddingInlineStart: 22 }}>
            <li>ניווט מלא באמצעות מקלדת, ללא צורך בעכבר.</li>
            <li>קישור ״דלגו לתוכן הראשי״ בתחילת הדף.</li>
            <li>סימון ברור (מסגרת מיקוד) של הרכיב שנמצא כעת בפוקוס.</li>
            <li>טקסט חלופי (alt) לתמונות ולצילומי המסך.</li>
            <li>מבנה כותרות היררכי ותקין ותגיות מבנה סמנטיות (header, main, nav, footer).</li>
            <li>ניגודיות צבעים מספקת בין הטקסט לרקע.</li>
            <li>תמיכה בשינוי שפה בין עברית לאנגלית, כולל כיווניות טקסט (RTL/LTR) מתאימה.</li>
            <li>כיבוד העדפת המשתמש לצמצום אנימציות (prefers-reduced-motion).</li>
          </ul>

          <h2 style={h2}>הסתייגויות ומגבלות ידועות</h2>
          <p style={p}>
            אנו משקיעים מאמצים מתמשכים לשמור על רמת נגישות גבוהה. יחד עם זאת,
            ייתכן שיימצאו חלקים או רכיבים שטרם הונגשו במלואם. אם נתקלתם בקושי
            או ברכיב שאינו נגיש, נשמח שתפנו אלינו ונטפל בכך בהקדם.
          </p>

          <h2 style={h2}>פרטי רכז הנגישות</h2>
          <p style={p}>
            אחראי הנגישות: {COORDINATOR}
            <br />
            דוא״ל:{" "}
            <a href={`mailto:${CONTACT_EMAIL}`} style={link}>
              {CONTACT_EMAIL}
            </a>
          </p>
          <p style={p}>
            נשמח לקבל פניות, הצעות לשיפור ודיווחים על בעיות נגישות. בפנייה נא
            לפרט את הדף שבו נתקלתם בבעיה, את סוג הבעיה, ואת סוג הדפדפן וטכנולוגיית
            המסייעת שבהם השתמשתם — כדי שנוכל לטפל בפנייה במהירות וביעילות.
          </p>
        </section>

        <hr style={{ border: "none", borderTop: `1px solid ${RULE}`, margin: "48px 0" }} />

        {/* ---------------- English (translation, LTR) ---------------- */}
        <section lang="en" dir="ltr">
          <h2 style={{ fontWeight: 800, letterSpacing: "-0.02em", fontSize: 26, margin: "0 0 4px" }}>
            Accessibility Statement
          </h2>
          <p style={{ color: INK_SOFT, margin: "0 0 24px" }}>
            Last updated: {LAST_UPDATED_EN}
          </p>

          <p style={p}>
            At Notch we are committed to providing an equal, inclusive
            experience for all visitors, and we work to keep our website
            accessible to people with disabilities. The site has been made
            accessible in line with the Israeli Equal Rights for Persons with
            Disabilities Regulations (Service Accessibility Adjustments), 2013,
            and Israeli Standard 5568, which is based on the WCAG 2.0 Level AA
            web content accessibility guidelines.
          </p>

          <h2 style={h2}>What has been made accessible</h2>
          <ul style={{ lineHeight: 1.65, paddingInlineStart: 22 }}>
            <li>Full keyboard navigation, with no mouse required.</li>
            <li>A &ldquo;Skip to main content&rdquo; link at the top of the page.</li>
            <li>A clearly visible focus indicator on the currently focused element.</li>
            <li>Alternative text (alt) for images and app screenshots.</li>
            <li>A valid, hierarchical heading structure and semantic landmarks (header, main, nav, footer).</li>
            <li>Sufficient color contrast between text and background.</li>
            <li>Language switching between Hebrew and English, including correct text direction (RTL/LTR).</li>
            <li>Respect for the user&rsquo;s reduced-motion preference (prefers-reduced-motion).</li>
          </ul>

          <h2 style={h2}>Known limitations</h2>
          <p style={p}>
            We make ongoing efforts to maintain a high level of accessibility.
            Even so, some parts or components may not yet be fully accessible.
            If you encounter any difficulty or a component that is not
            accessible, please contact us and we will address it as soon as
            possible.
          </p>

          <h2 style={h2}>Accessibility coordinator</h2>
          <p style={p}>
            Accessibility coordinator: {COORDINATOR}
            <br />
            Email:{" "}
            <a href={`mailto:${CONTACT_EMAIL}`} style={link}>
              {CONTACT_EMAIL}
            </a>
          </p>
          <p style={p}>
            We welcome feedback, suggestions, and reports of accessibility
            issues. When you contact us, please describe the page where you had
            trouble, the nature of the problem, and the browser and assistive
            technology you were using, so we can respond quickly and
            effectively.
          </p>

          <p style={{ ...p, marginTop: 32 }}>
            <a href="/" style={link}>
              ← Back to Notch
            </a>
          </p>
        </section>
      </div>
    </main>
  );
}
