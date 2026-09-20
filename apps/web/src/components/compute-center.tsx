"use client";

import { useCallback, useEffect, useState } from "react";
import type { ComputeCenterProviderLike, ComputeCenterStatusLike } from "@/lib/api-types";
import type { FetchState } from "@/lib/client-api";
import {
  ApiError,
  connectComputeProvider,
  disconnectComputeProvider,
  fetchComputeCenterStatus,
  verifyComputeProvider,
} from "@/lib/client-api";
import { LoadingPanel, StatePanel } from "@/components/state-panels";

/**
 * THE COMPUTE CONNECTION CENTER SURFACE (J005) — the first-class, persistent
 * destination for the account's compute:
 *
 * - the SPORTA-COMPUTE vs BYOC distinction, in goal-oriented language (no
 *   infrastructure jargon required to choose);
 * - the connect/verify/disconnect lifecycle per provider, with TYPED
 *   failure/quota states (the adapters' own honest vocabularies — never
 *   invented) and honest unavailable/degraded states;
 * - the master-password refusal posture, shown as the product's policy and
 *   enforced by the server (a password-class presentation is refused
 *   fail-closed with the typed error BEFORE anything is stored).
 */
export function ComputeCenterSurface() {
  const [status, setStatus] = useState<FetchState<ComputeCenterStatusLike>>({
    phase: "loading",
  });
  const [actionError, setActionError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const reload = useCallback(() => {
    void fetchComputeCenterStatus().then(
      (data) => setStatus({ phase: "ready", data }),
      (error) =>
        setStatus({
          phase: "failed",
          error: error instanceof ApiError ? `${error.message} (${error.status})` : String(error),
        }),
    );
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  if (status.phase === "loading") {
    return <LoadingPanel label="Your compute connections" />;
  }
  if (status.phase === "failed") {
    return (
      <StatePanel
        state="failed"
        title="The Compute Center could not be read"
        reason={`${status.error} — sign in if you are not; the account surface requires an authenticated caller.`}
      />
    );
  }

  const data = status.data;

  async function onConnect(provider: ComputeCenterProviderLike, credential: unknown) {
    setActionError(null);
    setNotice(null);
    try {
      const answer = await connectComputeProvider({
        providerId: provider.providerId,
        credential: credential as Record<string, unknown> | null,
      });
      if (answer.outcome === "refused-master-password") {
        setActionError(answer.message ?? "refused: master passwords are never accepted");
      } else if (answer.outcome === "duplicate") {
        setNotice(
          `${provider.providerId}: the same credential was re-presented — counted as a duplicate, the connection is unchanged.`,
        );
      } else {
        setNotice(
          `${provider.providerId} connected. Verify it to confirm the credential works with the provider.`,
        );
      }
      reload();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "the connect action failed");
      reload();
    }
  }

  async function onVerify(provider: ComputeCenterProviderLike) {
    setActionError(null);
    setNotice(null);
    try {
      const answer = await verifyComputeProvider(provider.providerId);
      const state = answer.record?.state ?? "unknown";
      setNotice(
        `${provider.providerId} verification answered honestly: ${state}.` +
          (state === "connected-unverified"
            ? " The provider was unreachable — an unreachable provider proves nothing about your credential."
            : ""),
      );
      reload();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "the verify action failed");
      reload();
    }
  }

  async function onDisconnect(provider: ComputeCenterProviderLike) {
    setActionError(null);
    setNotice(null);
    try {
      await disconnectComputeProvider(provider.providerId);
      setNotice(
        `${provider.providerId} disconnected — the connection record was removed and the removal audited.`,
      );
      reload();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "the disconnect action failed");
      reload();
    }
  }

  return (
    <div className="surface-stack">
      {/* The Sporta-compute vs BYOC distinction, in goal-oriented language */}
      <section aria-labelledby="compute-goals-heading" className="compute-section">
        <h2 id="compute-goals-heading" className="compute-section-title">
          What do you want from your compute?
        </h2>
        <p className="section-lede">
          You never have to know a provider name to choose. Pick the goal; the platform maps it onto
          the real compute selection — every decision the selection director makes is shown to you
          verbatim in the Create Studio.
        </p>
        <ul className="compute-goal-grid">
          {data.goals.map((goal) => (
            <li key={goal.id} className="compute-goal-card">
              <h3>{goal.title}</h3>
              <p>{goal.description}</p>
              <p className="compute-goal-where">{goal.where}</p>
            </li>
          ))}
        </ul>
        <div className={`compute-plane-card ${data.sportaPlane.configured ? "" : "unavailable"}`}>
          <h3>Sporta compute — the managed option</h3>
          <p>{data.sportaPlane.framing}</p>
          <p className="compute-plane-state">
            {data.sportaPlane.configured
              ? `Active on this deployment (provider: ${data.sportaPlane.provider}).`
              : "Not configured on this deployment — renders cannot dispatch until a compute plane is configured (the honest unavailable state)."}
          </p>
        </div>
      </section>

      {/* The provider lifecycle */}
      <section aria-labelledby="compute-providers-heading" className="compute-section">
        <h2 id="compute-providers-heading" className="compute-section-title">
          Your connected compute (BYOC)
        </h2>
        <p className="section-lede">
          Connect your own provider account once; your renders can then run on the compute you
          already pay for, under your provider&apos;s own limits. Only scoped credentials are
          accepted — never a master password.
        </p>
        {notice !== null && (
          <p className="compute-notice" role="status">
            {notice}
          </p>
        )}
        {actionError !== null && (
          <p className="compute-action-error" role="alert">
            {actionError}
          </p>
        )}
        <ul className="compute-provider-list">
          {data.providers.map((provider) => (
            <li key={provider.providerId}>
              <ProviderCard
                provider={provider}
                onConnect={onConnect}
                onVerify={onVerify}
                onDisconnect={onDisconnect}
              />
            </li>
          ))}
        </ul>
        <p className="compute-policy-note">{data.credentialPolicy.refusalNote}</p>
      </section>

      {/* Quota/cost context — the same seams the Create Studio reads */}
      <section aria-labelledby="compute-quotas-heading" className="compute-section">
        <h2 id="compute-quotas-heading" className="compute-section-title">
          Your allowance &amp; usage
        </h2>
        <p className="section-lede">
          The same real counters the Create Studio&apos;s compute step reads — one consistent view,
          never a second truth. Unknown values stay unknown; nothing here is invented.
        </p>
        <ul className="compute-quota-list">
          {data.quotas.map((quota) => (
            <li key={quota.quotaId}>
              <span className="compute-quota-id">{quota.quotaId}</span>
              <span className={`compute-quota-state ${quota.exhausted ? "limited" : ""}`}>
                {quota.exhausted
                  ? `exhausted (${quota.reasonCode})`
                  : quota.remaining === null
                    ? "within allowance"
                    : `${quota.remaining} remaining`}
              </span>
            </li>
          ))}
        </ul>
        {data.usage === null ? (
          <p className="compute-usage-note">
            Usage: not measured on this plane (shown as unknown, never as zero).
          </p>
        ) : (
          <ul className="compute-quota-list">
            {data.usage.map((unit) => (
              <li key={unit.unitId}>
                <span className="compute-quota-id">{unit.unitId}</span>
                <span className="compute-quota-state">{unit.quantity}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

/** One provider's card: posture, framing, the lifecycle actions. */
function ProviderCard({
  provider,
  onConnect,
  onVerify,
  onDisconnect,
}: {
  provider: ComputeCenterProviderLike;
  onConnect: (provider: ComputeCenterProviderLike, credential: unknown) => Promise<void>;
  onVerify: (provider: ComputeCenterProviderLike) => Promise<void>;
  onDisconnect: (provider: ComputeCenterProviderLike) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [credentialKind, setCredentialKind] = useState<string>(
    provider.supportedCredentialKinds[0] ?? "scoped-api-key",
  );
  const [fieldA, setFieldA] = useState("");
  const [fieldB, setFieldB] = useState("");
  const [busy, setBusy] = useState(false);

  const connected =
    provider.posture === "connected-verified" ||
    provider.posture === "connected-unverified" ||
    provider.posture === "connected-invalid";

  const postureLabel: Record<ComputeCenterProviderLike["posture"], string> = {
    "connected-verified": "Connected — verified",
    "connected-unverified": "Connected — not verified yet",
    "connected-invalid": "Connected — credential rejected by the provider",
    disconnected: "Disconnected",
    "never-connected": "Not connected",
  };

  async function submitConnect() {
    setBusy(true);
    try {
      const credential =
        credentialKind === "scoped-token-pair"
          ? { kind: credentialKind, tokenId: fieldA, tokenSecret: fieldB }
          : { kind: credentialKind, apiKey: fieldA };
      await onConnect(provider, credential);
      setOpen(false);
      setFieldA("");
      setFieldB("");
    } finally {
      setBusy(false);
    }
  }

  return (
    <article className={`compute-provider-card posture-${provider.posture}`}>
      <div className="compute-provider-head">
        <h3 className="compute-provider-name">{provider.providerId}</h3>
        <span className={`compute-posture posture-${provider.posture}`}>
          {postureLabel[provider.posture]}
        </span>
      </div>
      <p className="compute-provider-framing">{provider.goalFraming}</p>
      <p className="compute-provider-facts">
        Execution zone: {provider.executionZone} · {provider.descriptor.providerKind} · up to{" "}
        {provider.descriptor.maxConcurrentJobs} concurrent jobs
        {provider.descriptor.supportedLatencyClasses.length > 0
          ? ` · ${provider.descriptor.supportedLatencyClasses.join(", ")} workloads`
          : ""}
      </p>
      {provider.connection !== null && (
        <p className="compute-provider-credential">
          {provider.connection.credential === null
            ? "No credential needed (self-hosted)."
            : `Credential: ${provider.connection.credential.kind} (fingerprint ${provider.connection.credential.fingerprint.slice(0, 8)}…)`}
          {provider.connection.lastVerifiedState !== undefined &&
            ` · last verification: ${provider.connection.lastVerifiedState}`}
        </p>
      )}
      <div className="compute-provider-actions">
        {!connected && (
          <button
            type="button"
            className="button-primary"
            onClick={() => setOpen((value) => !value)}
          >
            {open ? "Cancel" : "Connect"}
          </button>
        )}
        {connected && (
          <>
            <button
              type="button"
              className="button-secondary"
              disabled={busy}
              onClick={() => void onVerify(provider)}
            >
              Verify
            </button>
            <button
              type="button"
              className="button-danger"
              disabled={busy}
              onClick={() => void onDisconnect(provider)}
            >
              Disconnect
            </button>
          </>
        )}
      </div>
      {open && (
        <form
          className="compute-connect-form"
          onSubmit={(event) => {
            event.preventDefault();
            void submitConnect();
          }}
        >
          {provider.supportedCredentialKinds.length > 1 && (
            <label>
              Credential kind
              <select
                value={credentialKind}
                onChange={(event) => setCredentialKind(event.target.value)}
              >
                {provider.supportedCredentialKinds.map((kind) => (
                  <option key={kind} value={kind}>
                    {kind}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label>
            {credentialKind === "scoped-token-pair" ? "Token id" : "Scoped API key"}
            <input
              value={fieldA}
              onChange={(event) => setFieldA(event.target.value)}
              autoComplete="off"
              required
            />
          </label>
          {credentialKind === "scoped-token-pair" && (
            <label>
              Token secret
              <input
                type="password"
                value={fieldB}
                onChange={(event) => setFieldB(event.target.value)}
                autoComplete="off"
                required
              />
            </label>
          )}
          <p className="compute-policy-note">
            The key is used to verify with the provider and never stored — only a fingerprint is
            kept. Master passwords are refused outright.
          </p>
          <button type="submit" className="button-primary" disabled={busy}>
            {busy ? "Connecting…" : "Connect provider"}
          </button>
        </form>
      )}
    </article>
  );
}
