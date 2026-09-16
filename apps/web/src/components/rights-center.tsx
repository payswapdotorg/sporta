"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useAccount } from "@/components/account-provider";
import { ApiError, fetchRightsCenter } from "@/lib/client-api";
import type { FetchState } from "@/lib/client-api";
import type { RightsCenterLike } from "@/lib/api-types";
import { LoadingPanel, StatePanel } from "@/components/state-panels";
import { ROUTES } from "@/lib/navigation";

/**
 * THE RIGHTS CENTER (W907) — the Rights Holder workspace's inspection
 * surface: the rights-policy state of the sessions the account owns (or,
 * for operators, controls). Every row is a REAL policy record read through
 * the identity control gate — policy id + the fail-closed derived capability
 * decision at request time.
 *
 * Honest denied states (the real 403/401 paths, surfaced not hidden):
 * - anonymous: sign-in required;
 * - no rights-holder/operator grant: the server's own 403 with its
 *   explanation (roles are grants — the active role never changes them).
 */
export function RightsCenter() {
  const { phase: accountPhase, account } = useAccount();
  const [state, setState] = useState<FetchState<RightsCenterLike>>({ phase: "loading" });

  useEffect(() => {
    if (accountPhase !== "ready") return;
    if (account === null) {
      setState({ phase: "loading" });
      return;
    }
    setState({ phase: "loading" });
    void fetchRightsCenter().then(
      (data) => setState({ phase: "ready", data }),
      (error) =>
        setState({
          phase: "failed",
          error: error instanceof ApiError ? error.message : String(error),
          status: error instanceof ApiError ? error.status : undefined,
        }),
    );
  }, [accountPhase, account]);

  if (accountPhase === "loading") {
    return <LoadingPanel label="Checking session" />;
  }
  if (account === null) {
    return (
      <StatePanel
        state="denied"
        title="Sign in to inspect rights"
        reason="The Rights Center lists the rights policies of the sessions a signed-in account owns or controls."
      />
    );
  }
  if (state.phase === "loading") {
    return <LoadingPanel label="Reading the rights records" />;
  }
  if (state.phase === "failed") {
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
          {entries.length} record{entries.length === 1 ? "" : "s"} — each read through the
          identity control gate (owner/operator rule, deny-before-existence).
        </p>
      </section>

      {entries.length === 0 ? (
        <StatePanel
          state="unavailable"
          title="No sessions in your rights scope yet"
          reason="Sessions you create through the Create Studio (or that an operator assigns) will list here with their real policy records."
        />
      ) : (
        entries.map((entry) => (
          <section
            key={entry.sessionId}
            className="studio-section"
            data-surface="rights-entry"
          >
            <h2 className="section-title">{entry.label}</h2>
            <p className="field-note">
              session <code>{entry.sessionId}</code> · status {entry.status} ·{" "}
              {entry.access === "owned" ? "owned by you" : "operator control"} ·{" "}
              {entry.visibility}
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
                  <th scope="row">Reference source frames</th>
                  <td>{entry.rightsCapabilities.canReferenceSourceFrames ? "allowed" : "denied"}</td>
                </tr>
                <tr>
                  <th scope="row">Live delivery</th>
                  <td>{entry.rightsCapabilities.canDeliverLive ? "allowed" : "denied"}</td>
                </tr>
                <tr>
                  <th scope="row">Store derivatives</th>
                  <td>{entry.rightsCapabilities.canStoreDerivatives ? "allowed" : "denied"}</td>
                </tr>
                <tr>
                  <th scope="row">Share</th>
                  <td>{entry.rightsCapabilities.canShare ? "allowed" : "denied"}</td>
                </tr>
              </tbody>
            </table>
            <p className="field-note">
              <Link href={`${ROUTES.watch}?session=${encodeURIComponent(entry.sessionId)}`}>
                Open in Watch →
              </Link>
            </p>
          </section>
        ))
      )}
    </div>
  );
}
