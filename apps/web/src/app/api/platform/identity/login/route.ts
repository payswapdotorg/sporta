/**
 * POST /api/platform/identity/login — the hosted login route (W911).
 * Thin re-export of the platform transport (see
 * `src/server/platform/identity/transport.ts`).
 */
export { loginHandler as POST } from "@/server/platform/identity/transport";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
