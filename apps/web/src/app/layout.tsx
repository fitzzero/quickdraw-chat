import type { Metadata } from "next";
import { Providers } from "../providers";
import "./globals.css";

export const metadata: Metadata = {
  title: "Chat App",
  description: "Real-time chat application built with quickdraw patterns",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>): React.ReactElement {
  return (
    <html lang="en">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
