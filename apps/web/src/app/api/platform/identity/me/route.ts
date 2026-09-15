/**
 * GET /api/platform/identity/me — the hosted session route (W911).
 * Thin re-export of the platform transport (see
 * `src/server/platform/identity/transport.ts`).
 */
export { meHandler as GET } from "@/server/platform/identity/transport";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
