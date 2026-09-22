import type { Metadata } from "next";
import { PageHeader } from "@/components/page-header";
import { AuditSurface } from "@/components/audit-surface";

export const metadata: Metadata = {
  title: "Audit",
};

/**
 * Audit (J009) — the workspace-reachable rights audit trail, REAL since the
 * wave-4 UI lane: the append-only record of every rights decision (policy
 * edits and revocations with the J008 classification), served through the
 * role-gated domain audit query — rights holders see their own sessions'
 * trails, operators see every trail, every other role gets the honest
 * denial (no fabricated trail, no guessed URLs). `?session=<id>` focuses on
 * one session's trail.
 */
export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const sessionParam = params.session;
  const sessionId =
    typeof sessionParam === "string" && sessionParam.length > 0 ? sessionParam : null;

  return (
    <>
      <PageHeader
        kicker="Accountability"
        title="Audit"
        description="The rights audit trail for your scope — every policy edit and revocation, who made it, when, and what it did. Append-only, read through the role-gated audit query."
      />
      <AuditSurface sessionId={sessionId} />
    </>
  );
}
