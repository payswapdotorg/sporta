"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useAccount } from "@/components/account-provider";
import {
  ApiError,
  fetchRightsCenter,
  fetchRightsServingCheck,
  patchRightsPolicy,
  revokeRights,
} from "@/lib/client-api";
import type { FetchState } from "@/lib/client-api";
import type { RightsCenterLike, RightsServingCheckLike } from "@/lib/api-types";
import { RIGHTS_OPERATIONS } from "@/lib/api-types";
import { LoadingPanel, StatePanel } from "@/components/state-panels";
import { deriveReauthState } from "@/lib/surface-state";
import { ROUTES } from "@/lib/navigation";

/**
 * THE RIGHTS CENTER (W907 + J008) — the Rights Holder workspace's rights
 * surface: the rights-policy state of the sessions the account owns (or,
 * for operators, controls), every row read through the identity control
 * gate — policy record + the fail-closed derived capability decision at
 * request time — and, since the J008 UI lane, the EDIT (narrow-only) and
 * REVOKE actions over the REAL domain rights-editor seam, with the honest
 * verification that a revocation stops the serving seam immediately.
 *
 * The domain semantics, VISIBLE in the UI (never silently enforced):
 * - W902 RE-ATTESTATION: the policy is re-attested with the editor's
 *   VERIFIED account id — a caller never asserts their own `assertedBy`;
 * - W917 NARROW-ONLY: an edit can never WIDEN effective rights past the
 *   creation-time attestation — a wider edit is stored + audited honestly
 *   (as a widen) but has NO capability effect, because every serving seam
 *   re-derives the INTERSECTION of the creation record and the edit. The
 *   form explains this instead of silently blocking wider selections;
 * - REVOCATION is the contract's own time bound: the effective policy
 *   expires at the revocation moment, so playback, rendering and
 *   publication stop fail-closed — the "check the serving state" action
 *   shows the REAL denial the watch surface answers with, from this UI.
 *
 * Honest denied states (the real 403/401 paths, surfaced not hidden):
 * - anonymous: sign-in required;
 * - no rights-holder/operator grant: the server's own 403 with its
 *   explanation (roles are grants — the active role never changes them).
 */

/** The per-entry edit draft (client-side until applied). */
interface EditDraft {
  operations: string[];
  expiresAtLocal: string;
}

/** The serving-state check answer (the honest live denial). */
type ServingCheck = RightsServingCheckLike;

const CAPABILITY_ROWS: {
  key: keyof RightsCenterLike["entries"][number]["rightsCapabilities"];
  label: string;
}[] = [
  { key: "canReferenceSourceFrames", label: "Reference source frames" },
  { key: "canDeliverLive", label: "Live delivery" },
  { key: "canStoreDerivatives", label: "Store derivatives" },
  { key: "canShare", label: "Share" },
];

export function RightsCenter() {
  const { phase: accountPhase, account } = useAccount();
  const [state, setState] = useState<FetchState<RightsCenterLike>>({ phase: "loading" });

  const [drafts, setDrafts] = useState<Record<string, EditDraft>>({});
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [confirming, setConfirming] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [servingChecks, setServingChecks] = useState<Record<string, ServingCheck | "failed">>({});

  const reload = useCallback(async () => {
    try {
      const data = await fetchRightsCenter();
      setState({ phase: "ready", data });
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
      setState({
        phase: "failed",
        error: err instanceof Error ? err.message : String(err),
        status: apiErr?.status,
      });
    }
  }, []);

  useEffect(() => {
    if (accountPhase !== "ready") return;
    if (account === null) {
      setState({ phase: "loading" });
      return;
    }
    setState({ phase: "loading" });
    void reload();
  }, [accountPhase, account, reload]);

  /** Runs one edit/revoke action with the honest flash + reload. */
  const run = useCallback(
    async (sessionId: string, action: () => Promise<unknown>, success: string) => {
      setBusy(sessionId);
      setFlash(null);
      try {
        await action();
        await reload();
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

  /** The J008 verification: the REAL serving answer, read live from the UI. */
  const checkServing = useCallback(async (sessionId: string) => {
    setBusy(sessionId);
    try {
      const check = await fetchRightsServingCheck(sessionId);
      setServingChecks((prior) => ({
        ...prior,
        [sessionId]: check,
      }));
    } catch (err) {
      // The honest failed read: shown, never guessed.
      setServingChecks((prior) => ({
        ...prior,
        [sessionId]: "failed",
      }));
      setFlash(
        err instanceof ApiError
          ? `${err.status}: ${err.message}`
          : err instanceof Error
            ? err.message
            : String(err),
      );
    } finally {
      setBusy(null);
    }
  }, []);

  if (accountPhase === "loading") {
    return <LoadingPanel label="Checking session" />;
  }
  if (account === null) {
    return (
      <StatePanel
        state="denied"
        title="Sign in to manage rights"
        reason="The Rights Center lists — and lets you edit or revoke — the rights policies of the sessions a signed-in account owns or controls."
      />
    );
  }
  if (state.phase === "loading") {
    return <LoadingPanel label="Reading the rights records" />;
  }
  if (state.phase === "failed") {
    // A 401 after the session was established = the session expired or was
    // revoked mid-session (W908): denied + re-auth, never a broken page.
    if (state.status === 401) {
      const verdict = deriveReauthState(state.error);
      return (
        <div className="surface-stack">
          <StatePanel state={verdict.state} title="Your session ended" reason={verdict.reason} />
          <p className="library-signin-hint">
            <Link className="button-primary" href={ROUTES.signin}>
              Sign in again
            </Link>
          </p>
        </div>
      );
    }
    if (state.status === 403) {
      return (
        <StatePanel
          state="denied"
          title="The rights-holder grant is required"
          reason={`${state.error} Rights-holder and operator grants are assigned by operators — they cannot be self-selected at registration, and switching the active role never grants one.`}
        />
      );
    }
    return (
      <StatePanel
        state="failed"
        title="The rights records could not be read"
        reason={state.error}
      />
    );
  }

  const { entries, scope, note } = state.data;
  return (
    <div className="surface-stack">
      <section className="studio-section" data-surface="rights-summary">
        <h2 className="section-title">
          {scope === "operator" ? "All sessions (operator control)" : "Sessions you own"}
        </h2>
        <p className="field-note">{note}</p>
        <p className="field-note">
          {entries.length} record{entries.length === 1 ? "" : "s"} — each read through the identity
          control gate (owner/operator rule, deny-before-existence).{" "}
          <Link href={ROUTES.audit}>The rights audit trail lives in Audit →</Link>
        </p>
      </section>

      {flash !== null && (
        <p className="studio-flash" role="status">
          {flash}
        </p>
      )}

      {entries.length === 0 ? (
        <StatePanel
          state="unavailable"
          title="No sessions in your rights scope yet"
          reason="Sessions you create through the Create Studio (or that an operator assigns) will list here with their real policy records — editable and revocable from this surface."
        />
      ) : (
        entries.map((entry) => {
          const draft = drafts[entry.sessionId];
          const serving = servingChecks[entry.sessionId];
          return (
            <section key={entry.sessionId} className="studio-section" data-surface="rights-entry">
              <h2 className="section-title">{entry.label}</h2>
              <p className="field-note">
                session <code>{entry.sessionId}</code> · status {entry.status} ·{" "}
                {entry.access === "owned" ? "owned by you" : "operator control"} ·{" "}
                {entry.visibility}
                {entry.policy !== null && ` · policy ${entry.policy.policyId}`}
                {entry.policy !== null && ` · source: ${entry.effectiveSource}`}
                {entry.revoked && " · REVOKED"}
              </p>
              <table className="data-table">
                <tbody>
                  <tr>
                    <th scope="row">Policy record</th>
                    <td>
                      <code>{entry.policyId}</code>
                    </td>
                  </tr>
                  <tr>
                    <th scope="row">Attested by</th>
                    <td>
                      {entry.policy !== null ? (
                        <code>{entry.policy.assertedBy}</code>
                      ) : (
                        "unrecorded"
                      )}
                    </td>
                  </tr>
                  {CAPABILITY_ROWS.map(({ key, label }) => (
                    <tr key={key}>
                      <th scope="row">{label}</th>
                      <td>{entry.rightsCapabilities[key] ? "allowed" : "denied"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {entry.lastChange !== null && (
                <p className="field-note">
                  Last rights change:{" "}
                  <strong>{entry.lastChange.editKind ?? entry.lastChange.changeKind}</strong> by{" "}
                  <code>{entry.lastChange.actorUserId}</code> at {entry.lastChange.atIso} —{" "}
                  {entry.lastChange.changeKind === "revocation"
                    ? "the policy was taken out of force"
                    : "the policy was edited"}
                  .
                </p>
              )}

              {entry.policy === null ? (
                <p className="field-note">
                  No policy record is available for this session (it was created outside this
                  composition&apos;s recording paths) — its derived capabilities above are still the
                  real control-plane decision, and there is nothing to edit or revoke here.
                </p>
              ) : (
                <>
                  {/* -- The J008 EDIT action (narrow-only, explained) ------------ */}
                  <details className="rights-edit">
                    <summary>Edit rights (narrow-only)</summary>
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
                      <p className="field-note">
                        Edits <strong>narrow only</strong>: a capability holds only when BOTH the
                        creation-time attestation and your edited policy allow it. Selecting more
                        operations than the creation record attested is recorded honestly (audited
                        as a widen) but has <strong>no effect</strong> — every serving seam
                        re-derives the intersection, fail-closed.
                      </p>
                      <p className="field-note">
                        Re-attestation (W902): the policy is stored with{" "}
                        <strong>your verified account id</strong> as <code>assertedBy</code> — a
                        caller never asserts their own attestation, and the same verified id is
                        recorded on the audit entry.
                      </p>
                      <div className="rights-actions">
                        <button
                          type="button"
                          className="button-secondary"
                          disabled={
                            busy === entry.sessionId || (draft?.operations.length ?? 0) === 0
                          }
                          onClick={() =>
                            void run(
                              entry.sessionId,
                              () =>
                                patchRightsPolicy(entry.sessionId, {
                                  policyId: entry.policy?.policyId ?? `policy-${entry.sessionId}`,
                                  allowedOperations: draft?.operations ?? [],
                                  assertedBy: account.userId, // the domain editor re-attests with the VERIFIED id
                                  ...(draft?.expiresAtLocal
                                    ? {
                                        expiresAtIso: new Date(draft.expiresAtLocal).toISOString(),
                                      }
                                    : {}),
                                }),
                              `Policy updated on ${entry.sessionId} — the serving seams re-derive from it now`,
                            )
                          }
                        >
                          Apply policy edit
                        </button>
                      </div>
                    </div>
                  </details>

                  {/* -- The J008 REVOKE action (honest, verified) ---------------- */}
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
                              `Revoked ${entry.sessionId} — playback and publication stopped (fail-closed)`,
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
                  </div>
                </>
              )}

              {entry.revoked && (
                <div className="rights-revoked-state">
                  <p className="field-note">
                    This session&apos;s policy is out of force: playback, rendering and publication
                    are stopped (fail-closed), and the catalog/search no longer serve it.
                  </p>
                  <button
                    type="button"
                    className="button-secondary"
                    disabled={busy === entry.sessionId}
                    onClick={() => void checkServing(entry.sessionId)}
                  >
                    Check the serving state now
                  </button>
                  {serving !== undefined && (
                    <div role="status" className="field-note">
                      {serving === "failed" ? (
                        <p>
                          The serving check refused the read (the honest uniform denial — nothing
                          about this session is served anymore).
                        </p>
                      ) : (
                        <>
                          <p>
                            The watch surface answers: playback{" "}
                            <strong>
                              {serving.playback.state === "denied"
                                ? "DENIED"
                                : serving.playback.state}
                            </strong>{" "}
                            ({serving.playback.reasonCode})
                            {serving.playback.state === "denied"
                              ? " — the re-derived rights deny it."
                              : ""}
                          </p>
                          <p>
                            {serving.seam.denied
                              ? `The serving seam answered with ${serving.seam.errorClass}: ${serving.seam.message}`
                              : `The serving seam allowed the read under the creation-time policy: ${serving.seam.message ?? ""}`}
                          </p>
                        </>
                      )}
                    </div>
                  )}
                </div>
              )}

              <p className="field-note">
                <Link href={`${ROUTES.watch}?session=${encodeURIComponent(entry.sessionId)}`}>
                  Open in Watch →
                </Link>
                {entry.revoked ? " (it will honestly deny)" : ""}
              </p>
            </section>
          );
        })
      )}
    </div>
  );
}
