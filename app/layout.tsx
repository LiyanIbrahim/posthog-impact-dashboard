import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "PostHog Engineering Impact Dashboard",
  description: "Who are the most impactful engineers at PostHog, and why?",
};

/**
 * Runs synchronously before React paints anything, preventing a flash of the
 * wrong theme. Reads localStorage first; falls back to system preference.
 * Must stay a raw string — no template literals with external vars.
 */
const ANTI_FOUC = `
(function() {
  try {
    var saved = localStorage.getItem('theme');
    if (saved === 'dark' || (!saved && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  } catch(e) {}
})();
`;

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <body className="min-h-full flex flex-col bg-background text-foreground">
        {/* Runs synchronously before React hydrates — prevents flash of wrong theme.
            Placed as the first child of body so it executes before any paint. */}
        <script dangerouslySetInnerHTML={{ __html: ANTI_FOUC }} />
        {children}
      </body>
    </html>
  );
}
