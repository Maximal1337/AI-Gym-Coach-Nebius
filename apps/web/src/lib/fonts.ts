import { Rubik, IBM_Plex_Mono } from "next/font/google";

// Shared brand faces for the legal pages, so Privacy / Terms / Accessibility
// all match the landing page instead of falling back to system fonts.
export const rubik = Rubik({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  variable: "--legal-font",
  display: "swap",
});

export const plexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--legal-mono",
  display: "swap",
});
