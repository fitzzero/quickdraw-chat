// The app's tracked database client, made once in @project/db: every write
// through it reaches the quickdraw server's flush, so subscribers see it. The
// server and the MCP server pass it to quickdraw; handlers receive it as
// `db`. `quickdraw.ts` types the whole app from it.
export { db } from "@project/db";
