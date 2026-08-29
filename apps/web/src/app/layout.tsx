import type { Metadata, Viewport } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import { Providers } from "../providers";
import { ErrorBoundary } from "../components/common/ErrorBoundary";
import { SITE_TAGLINE_LONG } from "../lib/site";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });
const jetbrainsMono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-mono" });

const TAGLINE = SITE_TAGLINE_LONG;

export const metadata: Metadata = {
  metadataBase: new URL("https://quickdraw.techtree.gg"),
  title: "Quickdraw — Realtime Fullstack Starter",
  description: TAGLINE,
  applicationName: "Quickdraw",
  manifest: "/site.webmanifest",
  appleWebApp: {
    capable: true,
    // Opaque status bar ("black", never "black-translucent"): translucent
    // shifts iOS fixed-position origins by the top inset and breaks dvh in
    // standalone mode.
    statusBarStyle: "black",
    title: "Quickdraw",
  },
  icons: {
    icon: [
      { url: "/favicon.svg", type: "image/svg+xml" },
      { url: "/favicon-96x96.png", sizes: "96x96", type: "image/png" },
    ],
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180" }],
    shortcut: "/favicon.ico",
  },
  openGraph: {
    title: "Quickdraw",
    description: TAGLINE,
    siteName: "Quickdraw",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Quickdraw",
    description: TAGLINE,
  },
};

export const viewport: Viewport = {
  themeColor: "#16161e",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>): React.ReactElement {
  return (
    <html lang="en" className={`${inter.variable} ${jetbrainsMono.variable}`}>
      <body>
        <ErrorBoundary>
          <Providers>{children}</Providers>
        </ErrorBoundary>
      </body>
    </html>
  );
}
