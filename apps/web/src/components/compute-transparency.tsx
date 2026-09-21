"use client";

import type {
  ComputeQuotaStateLike,
  SelectionExplanationLike,
  StudioComputeStatusLike,
} from "@/lib/api-types";
import { StateChip, StatePanel } from "@/components/state-panels";

/**
 * THE COMPUTE TRANSPARENCY PANELS (J006) — Create and Watch SHOW the six
 * facts the acceptance names: compute source, provider, selection reason,
 * measured allowance/cost, privacy posture and fallback state.
 *
 * HONESTY RULES (never violated here):
 *
 * - Absent data renders as the HONEST UNKNOWN ("not measured", "not
 *   recorded") — never an invented number, never a zero standing in for
 *   an unreadable counter (the W919 posture).
 * - Refusals are shown with their TYPED reasons verbatim (the R407
 *   explanation document) — a refused selection is a first-class state,
 *   not an error to hide.
 * - The fallback state is DECLARED, never implied: the platform's posture
 *   is "no silent fallback" (an explicit selection the broker refuses
 *   fails loudly; there is no automatic provider switch), and an actual
 *   failure/degradation is shown with its typed class.
 * - Everything rendered is a PROJECTION of the existing route contracts
 *   (compute-status / compute-preview / the J004 create-plan responses /
 *   the job views) — no new backend surface is consumed.
 */

/** The selection view both Create surfaces share (preview or plan). */
export interface TransparencySelectionView {
  providerId: string;
  mode: "user-explicit" | "sporta-auto";
  explanation: SelectionExplanationLike;
}

/** The pure derivations (unit-tested in compute-transparency.test.ts) */

/** The privacy posture verdict of one selection (or its honest absence). */
export interface PrivacyPostureView {
  /** The posture the selection ACTUALLY applied (the R407 preference). */
  appliedPosture: string;
  /** The plane's declared execution zone (when the status carries one). */
  zone: string | null;
}

/** Derives the privacy posture view from the explanation + plane facts. */
export function privacyPostureOf(
  explanation: SelectionExplanationLike | null | undefined,
  plane: StudioComputeStatusLike["plane"],
): PrivacyPostureView | null {
  if (explanation === null || explanation === undefined) {
    if (plane === null) return null;
    return { appliedPosture: "not recorded (no selection yet)", zone: plane.facts.privacyZone };
  }
  return {
    appliedPosture: explanation.appliedPreference.privacyPosture,
    zone: plane === null ? null : plane.facts.privacyZone,
  };
}

/** The honest fallback-state verdict (declared posture + actual state). */
export interface FallbackStateView {
  state: "no-silent-fallback" | "refused" | "failed" | "degraded" | "in-flight" | "not-recorded";
  detail: string;
}

/** Derives the fallback state for the CREATE side (the selection preview). */
export function createFallbackStateOf(
  selection: TransparencySelectionView | null,
  planeConfigured: boolean,
): FallbackStateView {
  if (!planeConfigured) {
    return {
      state: "no-silent-fallback",
      detail:
        "no compute plane is configured — a render dispatch answers the control plane's typed 503 (nothing falls back to an undeclared provider)",
    };
  }
  if (selection === null) {
    return {
      state: "not-recorded",
      detail: "no selection has run yet — the fallback posture applies once one does",
    };
  }
  const refusals = selection.explanation.considered.filter(
    (entry) => entry.brokerRefusal !== undefined || entry.preferenceExclusion !== undefined,
  );
  if (refusals.length === 0) {
    return {
      state: "no-silent-fallback",
      detail:
        "the platform never silently switches providers: an explicit selection the broker refuses fails the dispatch loudly with every recorded reason",
    };
  }
  const refused = refusals
    .map(
      (entry) =>
        `${entry.providerId}: ${entry.brokerRefusal?.reason ?? `excluded (${entry.preferenceExclusion?.axis})`}`,
    )
    .join(" · ");
  return {
    state: "refused",
    detail: `considered but refused/excluded — ${refused} (shown verbatim; never a silent fallback)`,
  };
}

/**
 * The minimal job view the Watch panel consumes (the studio session's job
 * summary rows and the full job views both satisfy it structurally).
 */
export interface WatchJobView {
  jobId: string;
  state: string;
  selection?: TransparencySelectionView;
  ingest?: { status: string; error?: string };
  completion?: {
    status: "succeeded" | "failed" | "cancelled";
    failure?: { errorClass: string; message: string; terminal: string };
    usage: { unitId: string; quantity: number }[];
  };
}

/** Derives the fallback state for the WATCH side (one render's job view). */
export function watchFallbackStateOf(job: WatchJobView | null): FallbackStateView {
  if (job === null) {
    return {
      state: "not-recorded",
      detail: "the dispatch record is not visible to this viewer (the owner sees the full record)",
    };
  }
  const completion = job.completion;
  if (completion === undefined) {
    return { state: "in-flight", detail: `the render job is ${job.state} — no fallback engaged` };
  }
  if (completion.status === "failed") {
    return {
      state: "failed",
      detail: `the render failed with the typed class ${completion.failure?.errorClass ?? "unknown"} (${completion.failure?.terminal ?? "terminal"}) — the failure is shown, never retried onto an undeclared provider`,
    };
  }
  if (completion.status === "cancelled") {
    return { state: "failed", detail: "the render was cancelled — no fallback engaged" };
  }
  if (job.ingest?.status === "failed") {
    return {
      state: "degraded",
      detail: `the artifact ingest failed (${job.ingest.error ?? "no detail recorded"}) — shown honestly, never smoothed over`,
    };
  }
  return {
    state: "no-silent-fallback",
    detail: "the render completed on the selected provider — no fallback was engaged",
  };
}

/** The honest measured-cost text (absent stays absent, never a zero). */
export function measuredCostText(usage: { unitId: string; quantity: number }[] | null): string {
  if (usage === null) return "not measured";
  if (usage.length === 0) return "none metered";
  return usage.map((unit) => `${unit.quantity} ${unit.unitId}`).join(" · ");
}

/** One allowance row's honest text (fail-closed entries stay explicit). */
export function allowanceText(quota: ComputeQuotaStateLike): string {
  if (quota.used === null || quota.limit === null) {
    return "not measured (unreadable counter — fail-closed)";
  }
  return `${quota.used} of ${quota.limit} used today · ${
    quota.exhausted ? "exhausted" : `${quota.remaining} remaining`
  }`;
}

// ---------------------------------------------------------------------------
// The CREATE-side panel (the compute step's transparency block)
// ---------------------------------------------------------------------------

/** The Create-side transparency panel's props. */
export interface CreateComputeTransparencyProps {
  /** The compute/cost status fetch state (GET /api/create/compute-status). */
  status:
    | { phase: "idle" }
    | { phase: "loading" }
    | { phase: "ready"; data: StudioComputeStatusLike }
    | { phase: "failed"; error: string };
  /** The selection, when one has run (the preview or the plan's verified one). */
  selection: TransparencySelectionView | null;
}

/** The six J006 facts on the Create surface (honest unknowns included). */
export function CreateComputeTransparency({ status, selection }: CreateComputeTransparencyProps) {
  if (status.phase === "idle") return null;
  if (status.phase === "loading") {
    return <LoadingTransparency label="Reading the compute plane and your allowances" />;
  }
  if (status.phase === "failed") {
    return (
      <StatePanel
        state="failed"
        title="The compute transparency could not be read"
        reason={status.error}
      />
    );
  }
  const data = status.data;
  const plane = data.plane;
  const posture = privacyPostureOf(selection?.explanation ?? null, plane);
  const fallback = createFallbackStateOf(selection, plane !== null);
  const selectedQuote = selection?.explanation.considered.find(
    (entry) => entry.providerId === selection.providerId,
  )?.quote;
  return (
    <section className="studio-rights-preview" aria-label="Compute transparency">
      <h3 className="studio-subheading">Compute transparency</h3>
      <dl className="session-card-facts">
        <div className="fact">
          <dt>Compute source</dt>
          <dd>
            {plane === null ? (
              "no compute plane is configured"
            ) : (
              <>
                <StateChip
                  state={plane.executionOwnership === "sporta-managed" ? "ready" : "degraded"}
                >
                  {plane.executionOwnership}
                </StateChip>{" "}
                <span className="field-hint">
                  this deployment&apos;s configured plane · adapter <code>{plane.adapterId}</code>
                </span>
              </>
            )}
          </dd>
        </div>
        <div className="fact">
          <dt>Provider</dt>
          <dd>
            {plane === null ? (
              "—"
            ) : (
              <>
                <code>{plane.providerId}</code>
                {selection !== null ? (
                  <span className="field-hint">
                    {" "}
                    · the director currently selects <code>{selection.providerId}</code>
                  </span>
                ) : null}
              </>
            )}
          </dd>
        </div>
        <div className="fact">
          <dt>Selection reason</dt>
          <dd>
            {selection === null ? (
              "no selection has run yet"
            ) : (
              <>
                <StateChip state={selection.mode === "user-explicit" ? "ready" : "degraded"}>
                  {selection.mode}
                </StateChip>{" "}
                <span className="field-hint">{selection.explanation.selectionReason}</span>
              </>
            )}
          </dd>
        </div>
        <div className="fact">
          <dt>Measured allowance / cost</dt>
          <dd>
            {measuredCostText(data.usage)}
            {selectedQuote !== undefined ? (
              <span className="field-hint">
                {" "}
                · selected provider&apos;s quote:{" "}
                {selectedQuote.estimatedCostUsd === null
                  ? "cost not measured"
                  : `$${selectedQuote.estimatedCostUsd}`}{" "}
                /{" "}
                {selectedQuote.estimatedQueueSeconds === null
                  ? "queue not measured"
                  : `${selectedQuote.estimatedQueueSeconds}s queue`}
              </span>
            ) : null}
          </dd>
        </div>
        <div className="fact">
          <dt>Privacy posture</dt>
          <dd>
            {posture === null ? (
              "not recorded"
            ) : (
              <>
                <code>{posture.appliedPosture}</code>
                {posture.zone !== null ? (
                  <span className="field-hint"> · plane zone {posture.zone}</span>
                ) : null}
              </>
            )}
          </dd>
        </div>
        <div className="fact">
          <dt>Fallback state</dt>
          <dd>
            <StateChip
              state={
                fallback.state === "no-silent-fallback"
                  ? "ready"
                  : fallback.state === "refused" || fallback.state === "failed"
                    ? "failed"
                    : fallback.state === "degraded"
                      ? "degraded"
                      : "unavailable"
              }
            >
              {fallback.state}
            </StateChip>{" "}
            <span className="field-hint">{fallback.detail}</span>
          </dd>
        </div>
      </dl>
      {data.quotas.length > 0 ? (
        <dl className="session-card-facts">
          {data.quotas.map((quota) => (
            <div className="fact" key={quota.quotaId}>
              <dt>{quota.quotaId}</dt>
              <dd>{allowanceText(quota)}</dd>
            </div>
          ))}
        </dl>
      ) : null}
      <p className="field-hint">
        Every unknown is shown as unknown — never as 0. The allowance states are the platform&apos;s
        own daily quotas (the W919 ledger); the usage totals are the plane&apos;s metered quantities
        where measured.
      </p>
    </section>
  );
}

// ---------------------------------------------------------------------------
// The WATCH-side panel (one reality's compute provenance, extended for J006)
// ---------------------------------------------------------------------------

/** The Watch-side transparency panel's props. */
export interface WatchComputeTransparencyProps {
  /** The reality kind this artifact belongs to (labeling only). */
  realityLabel: string;
  /** The producing renderer id (the catalog's own data). */
  producerId: string | null;
  /** The producing render's job view, when the owner can see it. */
  job: WatchJobView | null;
}

/** The six J006 facts on the Watch surface (per-reality provenance). */
export function WatchComputeTransparency({
  realityLabel,
  producerId,
  job,
}: WatchComputeTransparencyProps) {
  const selection = job?.selection ?? null;
  const posture = privacyPostureOf(selection?.explanation ?? null, null);
  const fallback = watchFallbackStateOf(job);
  const usage = job?.completion?.usage ?? null;
  return (
    <section className="stats-section" aria-label="Compute transparency">
      <h2 className="section-title">Compute</h2>
      <dl className="session-card-facts">
        <div className="fact">
          <dt>Whose compute</dt>
          <dd>
            {producerId === null ? (
              `no artifact exists for the ${realityLabel} reality yet`
            ) : selection !== null ? (
              <>
                <StateChip state={selection.mode === "user-explicit" ? "ready" : "degraded"}>
                  {selection.mode === "user-explicit"
                    ? `your choice · ${selection.providerId}`
                    : `sporta chose · ${selection.providerId}`}
                </StateChip>{" "}
                <span className="marker-meta">
                  {selection.mode === "user-explicit"
                    ? "you explicitly selected this provider"
                    : "the selection director chose automatically"}
                </span>
              </>
            ) : job !== null ? (
              <StateChip state="unavailable">not recorded</StateChip>
            ) : (
              <StateChip state="unavailable">not visible</StateChip>
            )}
          </dd>
        </div>
        <div className="fact">
          <dt>Provider</dt>
          <dd>
            {producerId === null ? (
              "—"
            ) : (
              <>
                <code>{selection?.providerId ?? producerId}</code>
                {job !== null ? (
                  <>
                    {" "}
                    · job <code>{job.jobId}</code> ({job.state})
                  </>
                ) : null}
              </>
            )}
          </dd>
        </div>
        <div className="fact">
          <dt>Selection reason</dt>
          <dd>
            {selection === null ? (
              job !== null ? (
                "this render's dispatch carried no compute directive — nothing is invented to fill it"
              ) : (
                "the dispatch record is visible to the session's owner only"
              )
            ) : (
              <span className="field-hint">{selection.explanation.selectionReason}</span>
            )}
          </dd>
        </div>
        <div className="fact">
          <dt>Measured cost (this render)</dt>
          <dd>
            {usage === null
              ? job === null
                ? "not visible"
                : job.completion === undefined
                  ? "in flight — metered on completion"
                  : "not recorded (no metered usage on the completion)"
              : measuredCostText(usage)}
          </dd>
        </div>
        <div className="fact">
          <dt>Privacy posture</dt>
          <dd>{posture === null ? "not recorded" : <code>{posture.appliedPosture}</code>}</dd>
        </div>
        <div className="fact">
          <dt>Fallback state</dt>
          <dd>
            <StateChip
              state={
                fallback.state === "no-silent-fallback"
                  ? "ready"
                  : fallback.state === "refused" || fallback.state === "failed"
                    ? "failed"
                    : fallback.state === "degraded"
                      ? "degraded"
                      : "unavailable"
              }
            >
              {fallback.state}
            </StateChip>{" "}
            <span className="field-hint">{fallback.detail}</span>
          </dd>
        </div>
      </dl>
      {selection !== null ? (
        <div>
          <p className="section-lede">The auditable selection (carried verbatim):</p>
          <ul className="marker-list">
            {selection.explanation.considered.map((considered) => (
              <li key={considered.providerId}>
                <span className="marker-phrase">
                  <code>{considered.providerId}</code>
                  {considered.providerId === selection.providerId ? " · selected" : ""}
                </span>
                <span className="marker-meta">
                  {considered.quote !== undefined
                    ? `estimated cost ${
                        considered.quote.estimatedCostUsd === null ||
                        considered.quote.estimatedCostUsd === undefined
                          ? "not measured"
                          : `$${considered.quote.estimatedCostUsd}`
                      }`
                    : (considered.brokerRefusal?.message ??
                      considered.preferenceExclusion?.message ??
                      "considered")}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}

/** The loading state (shared). */
function LoadingTransparency({ label }: { label: string }) {
  return (
    <section className="studio-rights-preview" aria-busy="true" aria-live="polite">
      <h3 className="studio-subheading">Compute transparency</h3>
      <p className="field-hint">{label}…</p>
    </section>
  );
}
