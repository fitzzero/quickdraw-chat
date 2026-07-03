import * as React from "react";
import Image from "next/image";

interface LogoProps {
  /** Rendered width/height in px (the source asset is 256x256). */
  size?: number;
}

/** The app mark (apps/web/public/logo.png), used in the sidebar and app bar. */
export function Logo({ size = 32 }: LogoProps): React.ReactElement {
  // unoptimized: the source is a small pre-sized PNG; skipping the optimizer
  // keeps it dependency-free on self-hosted deploys
  return <Image src="/logo.png" alt="" width={size} height={size} priority unoptimized />;
}
