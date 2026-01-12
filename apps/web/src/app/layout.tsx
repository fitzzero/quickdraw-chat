import type { Metadata } from "next";
import { Providers } from "../providers";
import { ErrorBoundary } from "../components/common/ErrorBoundary";
import "./globals.css";

export const metadata: Metadata = {
  title: "Quickdraw Chat",
  description: "Real-time chat application built with the Quickdraw framework",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>): React.ReactElement {
  return (
    <html lang="en">
      <body>
        <ErrorBoundary>
          <Providers>{children}</Providers>
        </ErrorBoundary>
      </body>
    </html>
  );
}
