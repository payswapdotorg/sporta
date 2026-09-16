/**
 * POST /api/platform/identity/logout — the hosted logout route (W911).
 * Thin re-export of the platform transport (see
 * `src/server/platform/identity/transport.ts`).
 */
export { logoutHandler as POST } from "@/server/platform/identity/transport";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
