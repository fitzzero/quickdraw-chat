import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";
import { SITE_TAGLINE } from "../lib/site";

// Social share card (1200x630), rendered by Next's built-in ImageResponse —
// no design tooling needed, the card is code like everything else here.
export const alt = "Quickdraw — Realtime Fullstack Starter";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function OpengraphImage(): Promise<ImageResponse> {
  const logo = await readFile(join(process.cwd(), "public", "logo.png"));
  const logoSrc = `data:image/png;base64,${logo.toString("base64")}`;

  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 64,
        backgroundColor: "#16161e",
        backgroundImage:
          "radial-gradient(circle at 20% 30%, rgba(124,77,255,0.18), transparent 55%)," +
          "radial-gradient(circle at 80% 75%, rgba(125,207,255,0.10), transparent 50%)",
      }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- ImageResponse requires raw img */}
      <img src={logoSrc} width={280} height={280} alt="" />
      <div style={{ display: "flex", flexDirection: "column", maxWidth: 640 }}>
        <div style={{ fontSize: 96, fontWeight: 700, color: "#c0caf5", letterSpacing: -2 }}>
          Quickdraw
        </div>
        <div style={{ fontSize: 34, color: "#9aa5ce", lineHeight: 1.4, marginTop: 12 }}>
          {SITE_TAGLINE}
        </div>
      </div>
    </div>,
    size,
  );
}
