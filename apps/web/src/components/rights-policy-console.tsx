"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import type {
  PolicyAuditEntryLike,
  RightsCenterListLike,
  RightsOperationLike,
  RightsPolicyEntryLike,
} from "@/lib/api-types";
import { RIGHTS_OPERATIONS } from "@/lib/api-types";
import {
  ApiError,
  fetchRightsAudit,
  fetchRightsPolicies,
  patchRightsPolicy,
  patchRightsVisibility,
  revokeRights,
} from "@/lib/client-api";
import { LoadingPanel, StatePanel } from "@/components/state-panels";
import { ROUTES } from "@/lib/navigation";

/**
 * THE RIGHTS POLICY CONSOLE (W917) — the API-driven editing surface: the
 * caller's scoped policy list, the per-session policy/visibility edit forms,
 * the revoke action and the append-only audit trail — all driven by the
 * W917 /api/rights routes over the REAL contracts' semantics, with honest
 * states for every failure (nothing is simulated).
 */

/** The per-entry edit state (local, client-side until applied). */
interface EditDraft {
  operations: RightsOperationLike[];
  expiresAtLocal: string;
}

const CAPABILITY_LABELS: {
  key: keyof RightsPolicyEntryLike["rightsCapabilities"];
  label: string;
}[] = [
  { key: "canReferenceSourceFrames", label: "reference source frames" },
  { key: "canDeliverLive", label: "live delivery" },
  { key: "canStoreDerivatives", label: "store derivatives (playback)" },
  { key: "canShare", label: "share" },
];

export function RightsPolicyConsole() {
  const [list, setList] = useState<
    | { phase: "loading" }
    | { phase: "ready"; data: RightsCenterListLike }
    | { phase: "failed"; error: string; status?: number }
  >({ phase: "loading" });
  const [audit, setAudit] = useState<PolicyAuditEntryLike[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, EditDraft>>({});
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [confirming, setConfirming] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const data = await fetchRightsPolicies();
      setList({ phase: "ready", data });
      setDrafts(
        Object.fromEntries(
          data.entries.map((entry) => [
            entry.sessionId,
            {
              operations: entry.policy ? [...entry.policy.allowedOperations] : [],
              expiresAtLocal: "",
            },
          ]),
        ),
      );
    } catch (err) {
      const apiErr = err instanceof ApiError ? err : null;
      setList({
        phase: "failed",
        error: err instanceof Error ? err.message : String(err),
        status: apiErr?.status,
      });
    }
  }, []);

  useEffect(() => {
    void reload();
    void fetchRightsAudit().then(
      (data) => setAudit(data.entries),
      () => setAudit(null), // the trail is additive, never blocking the console
    );
  }, [reload]);

  const run = useCallback(
    async (sessionId: string, action: () => Promise<unknown>, success: string) => {
      setBusy(sessionId);
      setFlash(null);
      try {
        await action();
        await reload();
        void fetchRightsAudit().then(
          (data) => setAudit(data.entries),
          () => undefined,
        );
        setFlash(success);
      } catch (err) {
        setFlash(
          err instanceof ApiError
            ? `${err.status}: ${err.message}`
            : err instanceof Error
              ? err.message
              : String(err),
        );
      } finally {
        setBusy(null);
        setConfirming(null);
      }
    },
    [reload],
  );

  if (list.phase === "loading") {
    return <LoadingPanel label="Rights policies" />;
  }
  if (list.phase === "failed") {
    if (list.status === 401) {
      return (
        <StatePanel
          state="denied"
          title="Sign in to inspect your rights policies"
          reason="The Rights Center requires an authenticated session — anonymous callers never see any policy."
        />
      );
    }
    return (
      <StatePanel
        state="failed"
        title="Your rights policies could not be read"
        reason={list.error}
      />
    );
  }

  const { entries, viewer, note } = list.data;
  const draftOf = (sessionId: string): EditDraft | undefined => drafts[sessionId];

  return (
    <div className="surface-stack">
      <p className="section-lede">
        {entries.length} session{entries.length === 1 ? "" : "s"} in your rights scope (grants:{" "}
        {viewer.grants.join(", ") || "none"}). {note}
      </p>

      {flash !== null && (
        <p className="studio-flash" role="status">
          {flash}
        </p>
      )}

      {entries.length === 0 && (
        <StatePanel
          state="ready"
          title="No rights policies in your scope yet"
          reason="You do not own or attest any session's rights. Create a session in the Create Studio (or have your rights-holder grant recorded over licensed content) to manage policies here."
        />
      )}

      <ul className="rights-entry-list">
        {entries.map((entry) => {
          const draft = draftOf(entry.sessionId);
          return (
            <li key={entry.sessionId} className="rights-entry">
              <header className="rights-entry-head">
                <div>
                  <h3>{entry.label}</h3>
                  <p className="rights-entry-meta">
                    {entry.sessionId} · status {entry.status} · access: {entry.access}
                    {entry.policy !== null && ` · policy ${entry.policy.policyId}`}
                    {entry.policy !== null && ` · source: ${entry.effectiveSource}`}
                  </p>
                </div>
                <div className="rights-badges">
                  {entry.revoked && <span className="badge badge-denied">revoked</span>}
                  {entry.visibility !== null && (
                    <span className="badge">{entry.visibility.kind}</span>
                  )}
                  {entry.visibility?.kind === "role-scoped" &&
                    entry.visibility.roles.length > 0 && (
                      <span className="badge">{entry.visibility.roles.join("+")}</span>
                    )}
                </div>
              </header>

              <div className="rights-capabilities">
                {CAPABILITY_LABELS.map(({ key, label }) => (
                  <span
                    key={key}
                    className={entry.rightsCapabilities[key] ? "cap cap-yes" : "cap cap-no"}
                  >
                    {entry.rightsCapabilities[key] ? "✓" : "✗"} {label}
                  </span>
                ))}
              </div>

              {entry.policy === null ? (
                <p className="rights-note">
                  No policy record is available for this session (it was created outside this
                  composition&apos;s recording paths) — its derived capabilities above are still the
                  real control-plane decision.
                </p>
              ) : (
                <p className="rights-note">
                  Attested by {entry.policy.assertedBy}
                  {entry.policy.expiresAtIso !== undefined &&
                    ` · expires ${entry.policy.expiresAtIso}`}
                  {entry.policy.sharingScope !== undefined &&
                    ` · sharing: ${entry.policy.sharingScope}`}
                  {entry.lastChange !== null &&
                    ` · last change ${entry.lastChange.changeKind} by ${entry.lastChange.actorUserId} at ${entry.lastChange.atIso}`}
                </p>
              )}

              <details className="rights-edit">
                <summary>Edit policy &amp; visibility</summary>
                <div className="rights-edit-body">
                  <fieldset>
                    <legend>Allowed operations (the contracts&apos; vocabulary)</legend>
                    {RIGHTS_OPERATIONS.map((operation) => (
                      <label key={operation} className="rights-op">
                        <input
                          type="checkbox"
                          checked={draft?.operations.includes(operation) ?? false}
                          onChange={(event) => {
                            const current = draft?.operations ?? [];
                            const next = event.target.checked
                              ? [...current, operation]
                              : current.filter((candidate) => candidate !== operation);
                            setDrafts((prior) => ({
                              ...prior,
                              [entry.sessionId]: {
                                operations: next,
                                expiresAtLocal: draft?.expiresAtLocal ?? "",
                              },
                            }));
                          }}
                        />
                        {operation}
                      </label>
                    ))}
                  </fieldset>
                  <label className="rights-expiry">
                    Expires (optional, local time — empty = no expiry)
                    <input
                      type="datetime-local"
                      value={draft?.expiresAtLocal ?? ""}
                      onChange={(event) =>
                        setDrafts((prior) => ({
                          ...prior,
                          [entry.sessionId]: {
                            operations: draft?.operations ?? [],
                            expiresAtLocal: event.target.value,
                          },
                        }))
                      }
                    />
                  </label>
                  <div className="rights-actions">
                    <button
                      type="button"
                      className="button-secondary"
                      disabled={busy === entry.sessionId || (draft?.operations.length ?? 0) === 0}
                      onClick={() =>
                        void run(
                          entry.sessionId,
                          () =>
                            patchRightsPolicy(entry.sessionId, {
                              policyId: entry.policy?.policyId ?? `policy-${entry.sessionId}`,
                              allowedOperations: draft?.operations ?? [],
                              assertedBy: viewer.userId, // the server re-attests with the VERIFIED id
                              ...(draft?.expiresAtLocal
                                ? {
                                    expiresAtIso: new Date(draft.expiresAtLocal).toISOString(),
                                  }
                                : {}),
                            }),
                          `Policy updated on ${entry.sessionId}`,
                        )
                      }
                    >
                      Apply policy
                    </button>
                    {(["public", "private", "unlisted"] as const).map((kind) => (
                      <button
                        key={kind}
                        type="button"
                        className="button-secondary"
                        disabled={busy === entry.sessionId || entry.visibility?.kind === kind}
                        onClick={() =>
                          void run(
                            entry.sessionId,
                            () => patchRightsVisibility(entry.sessionId, kind),
                            `Visibility set to ${kind} on ${entry.sessionId}`,
                          )
                        }
                      >
                        Make {kind}
                      </button>
                    ))}
                    <button
                      type="button"
                      className="button-secondary"
                      disabled={busy === entry.sessionId}
                      onClick={() =>
                        void run(
                          entry.sessionId,
                          () =>
                            patchRightsVisibility(entry.sessionId, {
                              kind: "role-scoped",
                              roles: ["rights-holder"],
                            }),
                          `Visibility set to role-scoped (rights-holder) on ${entry.sessionId}`,
                        )
                      }
                    >
                      Make role-scoped (rights-holder)
                    </button>
                  </div>
                </div>
              </details>

              <div className="rights-revoke">
                {confirming === entry.sessionId ? (
                  <div className="rights-revoke-confirm">
                    <label>
                      Reason (audited)
                      <input
                        type="text"
                        maxLength={500}
                        value={reasons[entry.sessionId] ?? ""}
                        onChange={(event) =>
                          setReasons((prior) => ({
                            ...prior,
                            [entry.sessionId]: event.target.value,
                          }))
                        }
                      />
                    </label>
                    <button
                      type="button"
                      className="button-primary"
                      disabled={busy === entry.sessionId}
                      onClick={() =>
                        void run(
                          entry.sessionId,
                          () =>
                            revokeRights(
                              entry.sessionId,
                              reasons[entry.sessionId]?.trim() || undefined,
                            ),
                          `Revoked ${entry.sessionId} — playback and publication stopped`,
                        )
                      }
                    >
                      Confirm revocation
                    </button>
                    <button
                      type="button"
                      className="button-secondary"
                      onClick={() => setConfirming(null)}
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    className="button-secondary"
                    disabled={busy === entry.sessionId || entry.revoked}
                    onClick={() => setConfirming(entry.sessionId)}
                  >
                    Revoke rights…
                  </button>
                )}
                {entry.revoked && (
                  <p className="rights-note">
                    This session&apos;s policy is out of force: playback, rendering and publication
                    are stopped (fail-closed), and only an explicit policy edit + re-publish can
                    restore them.
                  </p>
                )}
              </div>
            </li>
          );
        })}
      </ul>

      <section className="rights-audit">
        <h3>Policy-change audit trail</h3>
        {audit === null ? (
          <p className="rights-note">The audit trail is unavailable right now.</p>
        ) : audit.length === 0 ? (
          <p className="rights-note">No policy changes recorded yet.</p>
        ) : (
          <ul>
            {audit.map((record, index) => (
              <li key={`${record.sessionId}-${record.atIso}-${index}`}>
                <span className="audit-kind">{record.changeKind}</span> on {record.sessionId} by{" "}
                {record.actorUserId} at {record.atIso} — {record.summary}
              </li>
            ))}
          </ul>
        )}
        <p className="rights-note">
          Every record is append-only: who changed what, and when.{" "}
          <Link href={ROUTES.home}>Back to home</Link>
        </p>
      </section>
    </div>
  );
}
