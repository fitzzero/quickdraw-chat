/**
 * External links and shared copy for the template. Fork owners: point the
 * links at your own repo/site (init-fork.sh reminds you in its printed next
 * steps).
 */
export const GITHUB_URL = "https://github.com/fitzzero/quickdraw-chat";
export const CORE_NPM_URL = "https://www.npmjs.com/package/@fitzzero/quickdraw-core";

/**
 * One-line pitch, shared by the site metadata, the OG image and the manifest.
 *
 * Built from parts because the strip markers only DELETE: the game clause sits
 * between them, so `init-fork.sh --without-game` removes exactly that clause
 * and leaves a sentence that still reads (see scripts/strip-game.mjs).
 */
export const SITE_TAGLINE = [
  "Realtime fullstack starter — typed Socket.IO services, ACL, auth",
  // ── quickdraw-game:start ──
  ", and a multiplayer game foundation",
  // ── quickdraw-game:end ──
  ".",
].join("");

/** The tagline plus its call to action (site metadata). */
export const SITE_TAGLINE_LONG = `${SITE_TAGLINE} Fork it and build.`;
