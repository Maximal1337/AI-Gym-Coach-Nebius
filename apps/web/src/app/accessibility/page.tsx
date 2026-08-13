import type { Metadata } from "next";
import { LegalPage } from "@/components/LegalPage";

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

export default function Accessibility() {
  return (
    <LegalPage
      kicker="נגישות"
      title="הצהרת נגישות"
      meta={`עודכן לאחרונה: ${LAST_UPDATED_HE}`}
      dir="rtl"
      homeLabel="Notch — דף הבית"
    >
      {/* ---------------- Hebrew (primary, inherits RTL) ---------------- */}
      <p>
        אנו ב-Notch רואים חשיבות רבה במתן שירות שוויוני לכלל הגולשים, ופועלים
        כדי שאתר האינטרנט שלנו יהיה נגיש לאנשים עם מוגבלות. הנגשת האתר נעשתה
        בהתאם לתקנות שוויון זכויות לאנשים עם מוגבלות (התאמות נגישות לשירות),
        התשע״ג-2013, ולתקן הישראלי 5568 המבוסס על הנחיות הנגישות לתכני אינטרנט
        WCAG 2.0 ברמת AA.
      </p>

      <h2>מה הונגש באתר</h2>
      <ul>
        <li>ניווט מלא באמצעות מקלדת, ללא צורך בעכבר.</li>
        <li>קישור ״דלגו לתוכן הראשי״ בתחילת הדף.</li>
        <li>סימון ברור (מסגרת מיקוד) של הרכיב שנמצא כעת בפוקוס.</li>
        <li>טקסט חלופי (alt) לתמונות ולצילומי המסך.</li>
        <li>מבנה כותרות היררכי ותקין ותגיות מבנה סמנטיות (header, main, nav, footer).</li>
        <li>ניגודיות צבעים מספקת בין הטקסט לרקע.</li>
        <li>תמיכה בשינוי שפה בין עברית לאנגלית, כולל כיווניות טקסט (RTL/LTR) מתאימה.</li>
        <li>כיבוד העדפת המשתמש לצמצום אנימציות (prefers-reduced-motion).</li>
      </ul>

      <h2>הסתייגויות ומגבלות ידועות</h2>
      <p>
        אנו משקיעים מאמצים מתמשכים לשמור על רמת נגישות גבוהה. יחד עם זאת, ייתכן
        שיימצאו חלקים או רכיבים שטרם הונגשו במלואם. אם נתקלתם בקושי או ברכיב
        שאינו נגיש, נשמח שתפנו אלינו ונטפל בכך בהקדם.
      </p>

      <h2>פרטי רכז הנגישות</h2>
      <p>
        אחראי הנגישות: {COORDINATOR}
        <br />
        דוא״ל: <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>
      </p>
      <p>
        נשמח לקבל פניות, הצעות לשיפור ודיווחים על בעיות נגישות. בפנייה נא לפרט
        את הדף שבו נתקלתם בבעיה, את סוג הבעיה, ואת סוג הדפדפן וטכנולוגיית המסייעת
        שבהם השתמשתם — כדי שנוכל לטפל בפנייה במהירות וביעילות.
      </p>

      <hr />

      {/* ---------------- English (translation, LTR) ---------------- */}
      <section lang="en" dir="ltr">
        <h2>Accessibility Statement (English)</h2>
        <p>
          At Notch we are committed to providing an equal, inclusive experience
          for all visitors, and we work to keep our website accessible to
          people with disabilities. The site has been made accessible in line
          with the Israeli Equal Rights for Persons with Disabilities
          Regulations (Service Accessibility Adjustments), 2013, and Israeli
          Standard 5568, which is based on the WCAG 2.0 Level AA web content
          accessibility guidelines. Last updated: {LAST_UPDATED_EN}.
        </p>

        <h3>What has been made accessible</h3>
        <ul>
          <li>Full keyboard navigation, with no mouse required.</li>
          <li>A &ldquo;Skip to main content&rdquo; link at the top of the page.</li>
          <li>A clearly visible focus indicator on the currently focused element.</li>
          <li>Alternative text (alt) for images and app screenshots.</li>
          <li>A valid, hierarchical heading structure and semantic landmarks (header, main, nav, footer).</li>
          <li>Sufficient color contrast between text and background.</li>
          <li>Language switching between Hebrew and English, including correct text direction (RTL/LTR).</li>
          <li>Respect for the user&rsquo;s reduced-motion preference (prefers-reduced-motion).</li>
        </ul>

        <h3>Known limitations</h3>
        <p>
          We make ongoing efforts to maintain a high level of accessibility.
          Even so, some parts or components may not yet be fully accessible. If
          you encounter any difficulty or a component that is not accessible,
          please contact us and we will address it as soon as possible.
        </p>

        <h3>Accessibility coordinator</h3>
        <p>
          Accessibility coordinator: {COORDINATOR}
          <br />
          Email: <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>
        </p>
        <p>
          We welcome feedback, suggestions, and reports of accessibility
          issues. When you contact us, please describe the page where you had
          trouble, the nature of the problem, and the browser and assistive
          technology you were using, so we can respond quickly and effectively.
        </p>
      </section>
    </LegalPage>
  );
}
