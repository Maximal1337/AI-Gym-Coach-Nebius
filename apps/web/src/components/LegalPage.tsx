import type { ReactNode } from "react";
import { rubik, plexMono } from "@/lib/fonts";
import styles from "@/app/legal.module.css";

interface LegalPageProps {
  /** Small uppercase eyebrow above the title, e.g. "Legal" / "נגישות". */
  kicker: string;
  title: string;
  /** Effective / updated date line. */
  meta?: string;
  /** Direction of the title + body content (chrome stays LTR). */
  dir?: "ltr" | "rtl";
  /** Accessible label for the top brand link (localizable). */
  homeLabel?: string;
  backLabel?: string;
  children: ReactNode;
}

/**
 * Shared chrome + typography for the legal pages so Privacy, Terms, and the
 * Accessibility statement look like one designed set, matching the landing.
 */
export function LegalPage({
  kicker,
  title,
  meta,
  dir = "ltr",
  homeLabel = "Notch — home",
  backLabel = "← Back to Notch",
  children,
}: LegalPageProps) {
  return (
    <div className={`${styles.page} ${rubik.variable} ${plexMono.variable}`} dir={dir}>
      <header className={styles.header} dir="ltr">
        <a href="/" className={styles.brand} aria-label={homeLabel}>
          <img src="/notch-mark.svg" alt="" width={34} height={34} className={styles.brandMark} />
          <span className={styles.brandName}>Notch</span>
        </a>
        <a href="/" className={styles.backLink}>
          {backLabel}
        </a>
      </header>

      <main className={styles.body} dir={dir}>
        <p className={styles.kicker}>{kicker}</p>
        <h1 className={styles.title}>{title}</h1>
        {meta ? <p className={styles.meta}>{meta}</p> : null}
        <div className={styles.prose}>{children}</div>
      </main>

      <footer className={styles.footer}>
        <div className={styles.footerInner} dir="ltr">
          <span className={styles.footerCopy}>© 2026 Dor Haim Bobrutsky</span>
          <nav className={styles.footerLinks} aria-label="Legal">
            <a href="/privacy" className={styles.footerLink}>
              Privacy
            </a>
            <a href="/terms" className={styles.footerLink}>
              Terms
            </a>
            <a href="/accessibility" className={styles.footerLink}>
              Accessibility
            </a>
          </nav>
        </div>
      </footer>
    </div>
  );
}
