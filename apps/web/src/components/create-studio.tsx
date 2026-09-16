"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import type {
  RenderOutputLike,
  RightsPreviewLike,
  StudioDispatchLike,
  StudioJobLike,
  StudioOptionsLike,
  StudioSessionLike,
  StudioSessionStateLike,
  WatchModelLike,
} from "@/lib/api-types";
import {
  createStudioSession,
  dispatchStudioRender,
  fetchCreateOptions,
  fetchRenderOutput,
  fetchStudioJob,
  fetchStudioSession,
  fetchWatchModel,
  previewRights,
  setStudioPublication,
} from "@/lib/client-api";
import {
  CREATE_STEPS,
  capabilityLineOf,
  emptyDraft,
  jobProgressOf,
  meteredFractionOf,
  rendererDispatchabilityOf,
  stepSatisfied,
  submissionVerdictOf,
} from "@/lib/create-flow";
import type { CreateDraft, CreateStep } from "@/lib/create-flow";
import { LoadingPanel, StateChip, StatePanel } from "@/components/state-panels";
import { prepareFrameForDisplay } from "@/lib/frame-svg";
import { ROUTES } from "@/lib/navigation";

/**
 * THE CREATE STUDIO (W906) — the guided creation flow:
 * authorized source → rights declaration → renderer → recipe → review →
 * render (real progress) → preview → publish/private.
 *
 * Every state shown is a REAL server answer: the options come from the
 * registry + the fixture library, the rights preview is the contracts'
 * fail-closed derivation, the progress is the compute ledger's own state
 * with its metered fractions (never an invented number), the preview is the
 * stored output through the playback gate, and publish/private is the real
 * visibility flag. No fake upload: this wave's authorized sources are the
 * checked-in fixtures, and the UI says so.
 */

const STEP_LABELS: Record<CreateStep, string> = {
  source: "Source",
  rights: "Rights",
  renderer: "Renderer",
  recipe: "Recipe",
  review: "Review",
  render: "Render",
};

/** The studio's in-flight submission (session + dispatch + poll). */
interface SubmissionState {
  session: StudioSessionLike;
  dispatch: StudioDispatchLike;
}

export function CreateStudio() {
  const [options, setOptions] = useState<
    | { phase: "loading" }
    | { phase: "ready"; data: StudioOptionsLike | null }
    | { phase: "failed"; error: string }
  >({ phase: "loading" });
  const [step, setStep] = useState<CreateStep>("source");
  const [draft, setDraft] = useState<CreateDraft>(emptyDraft);
  const [preview, setPreview] = useState<
    | { phase: "idle" }
    | { phase: "loading" }
    | { phase: "ready"; data: RightsPreviewLike }
    | { phase: "failed"; error: string }
  >({ phase: "idle" });
  const [submission, setSubmission] = useState<SubmissionState | null>(null);
  const [job, setJob] = useState<StudioJobLike | null>(null);
  const [jobError, setJobError] = useState<string | null>(null);
  const [sessionState, setSessionState] = useState<StudioSessionStateLike | null>(null);
  const [output, setOutput] = useState<
    | { phase: "idle" }
    | { phase: "loading" }
    | { phase: "ready"; data: RenderOutputLike }
    | { phase: "denied"; reason: string }
    | { phase: "failed"; error: string }
  >({ phase: "idle" });
  const [watch, setWatch] = useState<WatchModelLike | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [flowError, setFlowError] = useState<string | null>(null);

  // -------------------------------------------------------------------
  // Options (auth-gated: null = the sign-in state)
  // -------------------------------------------------------------------
  useEffect(() => {
    let cancelled = false;
    void fetchCreateOptions().then(
      (data) => {
        if (!cancelled) setOptions({ phase: "ready", data });
      },
      (error) => {
        if (!cancelled) setOptions({ phase: "failed", error: String(error) });
      },
    );
    return () => {
      cancelled = true;
    };
  }, []);

  // -------------------------------------------------------------------
  // Rights preview (re-derived by the SERVER on every declaration change)
  // -------------------------------------------------------------------
  const declarationKey = `${draft.operations.slice().sort().join(",")}|${draft.expiresAtIso ?? ""}|${draft.sharingScope}`;
  useEffect(() => {
    let cancelled = false;
    if (draft.operations.length === 0) {
      setPreview({ phase: "idle" });
      return;
    }
    setPreview({ phase: "loading" });
    void previewRights({
      operations: draft.operations,
      ...(draft.expiresAtIso !== null ? { expiresAtIso: draft.expiresAtIso } : {}),
      sharingScope: draft.sharingScope,
    }).then(
      (data) => {
        if (!cancelled) setPreview({ phase: "ready", data });
      },
      (error) => {
        if (!cancelled) setPreview({ phase: "failed", error: String(error) });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [declarationKey]);

  // -------------------------------------------------------------------
  // Job polling (the REAL compute ledger's states — never silent)
  // -------------------------------------------------------------------
  const pollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stopPolling = useCallback(() => {
    if (pollTimer.current !== null) {
      clearTimeout(pollTimer.current);
      pollTimer.current = null;
    }
  }, []);
  useEffect(() => {
    if (submission === null) return;
    let cancelled = false;
    const poll = () => {
      void fetchStudioJob(submission.session.sessionId, submission.dispatch.jobId).then(
        (next) => {
          if (cancelled) return;
          setJob(next);
          const progress = jobProgressOf(next.state);
          if (!progress.terminal) {
            pollTimer.current = setTimeout(poll, 700);
          }
        },
        (error) => {
          if (!cancelled) setJobError(String(error));
        },
      );
    };
    poll();
    return () => {
      cancelled = true;
      stopPolling();
    };
  }, [submission, stopPolling]);

  // -------------------------------------------------------------------
  // Preview (the real watch surface data, through the playback gate)
  // -------------------------------------------------------------------
  useEffect(() => {
    if (job === null || jobProgressOf(job.state).phase !== "ready" || job.renderId === undefined) {
      return;
    }
    let cancelled = false;
    const sessionId = job.sessionId;
    void (async () => {
      try {
        const [state, model] = await Promise.all([
          fetchStudioSession(sessionId),
          fetchWatchModel(sessionId),
        ]);
        if (cancelled) return;
        setSessionState(state);
        setWatch(model);
        const render =
          model.renders?.find((entry) => entry.renderId === job.renderId) ??
          model.renders?.find((entry) => entry.outputs.length > 0) ??
          null;
        if (render !== null && render.outputs.length > 0) {
          setOutput({ phase: "loading" });
          try {
            const document = await fetchRenderOutput(
              sessionId,
              render.renderId,
              render.outputs[0]!.segmentId,
            );
            if (!cancelled) setOutput({ phase: "ready", data: document });
          } catch (err) {
            if (!cancelled) {
              setOutput(
                String(err).includes("403")
                  ? { phase: "denied", reason: "the session's policy denies stored playback" }
                  : { phase: "failed", error: String(err) },
              );
            }
          }
        } else {
          setOutput({ phase: "denied", reason: "no stored output for this render yet" });
        }
      } catch (err) {
        if (!cancelled) setOutput({ phase: "failed", error: String(err) });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [job]);

  // -------------------------------------------------------------------
  // Flow actions
  // -------------------------------------------------------------------
  const source =
    options.phase === "ready"
      ? (options.data?.sources.find((entry) => entry.key === draft.sourceKey) ?? null)
      : null;
  const renderer =
    options.phase === "ready"
      ? (options.data?.renderers.find((entry) => entry.rendererId === draft.rendererId) ?? null)
      : null;
  const previewReady = preview.phase === "ready" ? preview.data : null;
  const verdict = previewReady !== null ? submissionVerdictOf(previewReady) : null;

  const canAdvance =
    stepSatisfied(step, draft) && (step !== "rights" || verdict?.state === "ready");

  const submit = useCallback(async () => {
    if (source === null || renderer === null || previewReady === null) return;
    setSubmitting(true);
    setFlowError(null);
    try {
      const session = await createStudioSession({
        sourceKey: source.key,
        operations: draft.operations,
        ...(draft.expiresAtIso !== null ? { expiresAtIso: draft.expiresAtIso } : {}),
        sharingScope: draft.sharingScope,
      });
      const dispatch = await dispatchStudioRender(session.sessionId, {
        rendererId: renderer.rendererId,
        styleId: draft.styleId ?? undefined,
        ...(renderer.supportedOutputProfiles[draft.outputProfileIndex] !== undefined
          ? { outputProfile: renderer.supportedOutputProfiles[draft.outputProfileIndex] }
          : {}),
      });
      setSubmission({ session, dispatch });
      setStep("render");
    } catch (err) {
      setFlowError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }, [source, renderer, previewReady, draft]);

  const changeVisibility = useCallback(
    async (visibility: "public" | "private") => {
      if (submission === null) return;
      setPublishing(true);
      try {
        await setStudioPublication(submission.session.sessionId, visibility);
        const state = await fetchStudioSession(submission.session.sessionId);
        setSessionState(state);
      } catch (err) {
        setFlowError(err instanceof Error ? err.message : String(err));
      } finally {
        setPublishing(false);
      }
    },
    [submission],
  );

  // -------------------------------------------------------------------
  // Render guards
  // -------------------------------------------------------------------
  if (options.phase === "loading") {
    return <LoadingPanel label="Create Studio" />;
  }
  if (options.phase === "failed") {
    return (
      <StatePanel
        state="failed"
        title="The studio options could not be read"
        reason="The options request failed — a real failure, not simulated."
      />
    );
  }
  if (options.data === null) {
    return (
      <div className="surface-stack">
        <StatePanel
          state="denied"
          title="Creating requires a signed-in account"
          reason="The studio's session-authorized flows (rights declarations, renders, publication) need a verified identity."
        />
        <p className="library-signin-hint">
          <Link className="button-primary" href={ROUTES.signin}>
            Sign in
          </Link>
        </p>
      </div>
    );
  }

  return (
    <div className="surface-stack">
      <ol className="studio-stepper" aria-label="Create Studio steps">
        {CREATE_STEPS.map((entry, index) => (
          <li
            key={entry}
            className={
              entry === step ? "current" : index < CREATE_STEPS.indexOf(step) ? "done" : ""
            }
            aria-current={entry === step ? "step" : undefined}
          >
            <span className="studio-step-index">{CREATE_STEPS.indexOf(entry) + 1}</span>
            <span className="studio-step-label">{STEP_LABELS[entry]}</span>
          </li>
        ))}
      </ol>

      {step === "source" && (
        <SourceStep
          options={options.data}
          draft={draft}
          onPick={(key) => setDraft((prev) => ({ ...prev, sourceKey: key }))}
        />
      )}

      {step === "rights" && (
        <RightsStep
          options={options.data}
          draft={draft}
          preview={preview}
          onOperations={(operations) => setDraft((prev) => ({ ...prev, operations }))}
          onExpiry={(iso) => setDraft((prev) => ({ ...prev, expiresAtIso: iso }))}
          onScope={(scope) => setDraft((prev) => ({ ...prev, sharingScope: scope }))}
        />
      )}

      {step === "renderer" && (
        <RendererStep
          options={options.data}
          draft={draft}
          onPick={(rendererId) => setDraft((prev) => ({ ...prev, rendererId }))}
        />
      )}

      {step === "recipe" && (
        <RecipeStep
          options={options.data}
          draft={draft}
          source={source}
          onStyle={(styleId) => setDraft((prev) => ({ ...prev, styleId }))}
          onProfile={(index) => setDraft((prev) => ({ ...prev, outputProfileIndex: index }))}
        />
      )}

      {step === "review" && (
        <ReviewStep
          draft={draft}
          source={source}
          renderer={renderer}
          preview={previewReady}
          verdict={verdict}
          submitting={submitting}
          flowError={flowError}
          onSubmit={() => void submit()}
        />
      )}

      {step === "render" && submission !== null && (
        <RenderStep
          submission={submission}
          job={job}
          jobError={jobError}
          sessionState={sessionState}
          watch={watch}
          output={output}
          publishing={publishing}
          onVisibility={(visibility) => void changeVisibility(visibility)}
        />
      )}

      <div className="studio-nav">
        {step !== "source" && step !== "render" && (
          <button
            type="button"
            className="button-ghost"
            onClick={() => setStep(CREATE_STEPS[CREATE_STEPS.indexOf(step) - 1]!)}
          >
            Back
          </button>
        )}
        {step !== "render" && (
          <button
            type="button"
            className="button-primary"
            disabled={!canAdvance}
            onClick={() => setStep(CREATE_STEPS[CREATE_STEPS.indexOf(step) + 1]!)}
          >
            Continue
          </button>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step 1 — the authorized source (fixture library; honest upload state)
// ---------------------------------------------------------------------------

function SourceStep({
  options,
  draft,
  onPick,
}: {
  options: StudioOptionsLike;
  draft: CreateDraft;
  onPick: (key: string) => void;
}) {
  return (
    <section className="studio-step" aria-labelledby="studio-source-heading">
      <h2 id="studio-source-heading" className="studio-step-title">
        Choose an authorized source
      </h2>
      <p className="section-lede">
        This wave&apos;s authorized sources are the checked-in fixture library the engine runs (real
        vision lanes + a real commentary transcript). Every downstream number — positions, events,
        confidences — is computed by the real chain.
      </p>
      <p className="form-notice" role="note">
        Upload: {options.upload.reason}.
      </p>
      <ul className="card-grid studio-source-grid">
        {options.sources.map((entry) => (
          <li key={entry.key}>
            <label
              className={`session-card studio-source${draft.sourceKey === entry.key ? " current" : ""}`}
            >
              <input
                type="radio"
                name="studio-source"
                checked={draft.sourceKey === entry.key}
                onChange={() => onPick(entry.key)}
              />
              <span className="session-card-title">{entry.label}</span>
              <span className="studio-source-description">{entry.description}</span>
              <dl className="session-card-facts">
                <div className="fact">
                  <dt>Camera</dt>
                  <dd>
                    pan {entry.camera.pan} · zoom {entry.camera.zoom} · jitter {entry.camera.jitter}
                  </dd>
                </div>
                <div className="fact">
                  <dt>Commentary</dt>
                  <dd>{entry.commentary.length} windows</dd>
                </div>
                <div className="fact">
                  <dt>Known entities</dt>
                  <dd>{[...entry.lexicon.players, ...entry.lexicon.teams].join(", ") || "none"}</dd>
                </div>
              </dl>
              <span className="commentary-list">
                {entry.commentary.map((window) => (
                  <span className="commentary-line" key={`${entry.key}-${window.startMs}`}>
                    “{window.text}”
                  </span>
                ))}
              </span>
            </label>
          </li>
        ))}
      </ul>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Step 2 — the rights declaration + the REAL derived preview
// ---------------------------------------------------------------------------

function RightsStep({
  options,
  draft,
  preview,
  onOperations,
  onExpiry,
  onScope,
}: {
  options: StudioOptionsLike;
  draft: CreateDraft;
  preview:
    | { phase: "idle" }
    | { phase: "loading" }
    | { phase: "ready"; data: RightsPreviewLike }
    | { phase: "failed"; error: string };
  onOperations: (operations: string[]) => void;
  onExpiry: (iso: string | null) => void;
  onScope: (scope: "private" | "operator-authorized") => void;
}) {
  return (
    <section className="studio-step" aria-labelledby="studio-rights-heading">
      <h2 id="studio-rights-heading" className="studio-step-title">
        Declare your rights
      </h2>
      <p className="section-lede">
        Your declaration is re-attested to your verified identity and the control plane derives what
        it permits — fail-closed. Nothing below is a product promise; it is the policy the control
        plane will enforce.
      </p>
      <fieldset className="form-field">
        <legend>Allowed operations</legend>
        <ul className="studio-operation-list">
          {options.rights.operations.map((operation) => (
            <li key={operation.id}>
              <label>
                <input
                  type="checkbox"
                  checked={draft.operations.includes(operation.id)}
                  onChange={(event) =>
                    onOperations(
                      event.target.checked
                        ? [...draft.operations, operation.id]
                        : draft.operations.filter((id) => id !== operation.id),
                    )
                  }
                />
                <span className="studio-operation-label">{operation.label}</span>
                <span className="studio-operation-description">{operation.description}</span>
              </label>
            </li>
          ))}
        </ul>
      </fieldset>
      <div className="form-field">
        <label htmlFor="studio-expiry">Expires at (optional)</label>
        <input
          id="studio-expiry"
          type="datetime-local"
          onChange={(event) =>
            onExpiry(event.target.value === "" ? null : new Date(event.target.value).toISOString())
          }
        />
        <p className="field-hint">An expired policy denies everything downstream (fail-closed).</p>
      </div>
      <fieldset className="form-field">
        <legend>Sharing scope</legend>
        {options.rights.sharingScopes.map((scope) => (
          <label key={scope.id} className="studio-scope-option">
            <input
              type="radio"
              name="studio-scope"
              checked={draft.sharingScope === scope.id}
              onChange={() => onScope(scope.id)}
            />
            {scope.label}
          </label>
        ))}
      </fieldset>
      <RightsPreviewPanel preview={preview} />
    </section>
  );
}

/** The derived-capability panel (shared by the rights + review steps). */
function RightsPreviewPanel({
  preview,
}: {
  preview:
    | { phase: "idle" }
    | { phase: "loading" }
    | { phase: "ready"; data: RightsPreviewLike }
    | { phase: "failed"; error: string };
}) {
  if (preview.phase === "idle") {
    return (
      <StatePanel
        state="denied"
        title="Nothing is declared"
        reason="A rights declaration needs at least one allowed operation — an empty policy allows nothing (fail-closed)."
      />
    );
  }
  if (preview.phase === "loading") {
    return <LoadingPanel label="Deriving what this policy permits" />;
  }
  if (preview.phase === "failed") {
    return <StatePanel state="failed" title="The derivation failed" reason={preview.error} />;
  }
  const data = preview.data;
  const lines = capabilityLineOf(data.capabilities);
  const verdict = submissionVerdictOf(data);
  return (
    <section className="studio-rights-preview" aria-live="polite">
      <h3 className="studio-subheading">What this policy permits (derived)</h3>
      <ul className="studio-permit-list">
        {lines.map((line) => (
          <li key={line.key} className={line.allowed ? "state-authorized" : "state-denied"}>
            <StateChip state={line.allowed ? "ready" : "denied"}>
              {line.allowed ? "allowed" : "denied"}
            </StateChip>
            <span className="studio-permit-label">{line.label}</span>
          </li>
        ))}
      </ul>
      {verdict.state === "denied" ? (
        <StatePanel
          state="denied"
          title="Session creation would be denied"
          reason={verdict.warning ?? data.sessionCreation.reason}
        />
      ) : verdict.warning !== null ? (
        <p className="form-notice" role="status">
          {verdict.warning}
        </p>
      ) : (
        <p className="field-hint">{data.sessionCreation.reason}</p>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Step 3 — the renderer (the real registry, honestly annotated)
// ---------------------------------------------------------------------------

function RendererStep({
  options,
  draft,
  onPick,
}: {
  options: StudioOptionsLike;
  draft: CreateDraft;
  onPick: (rendererId: string) => void;
}) {
  return (
    <section className="studio-step" aria-labelledby="studio-renderer-heading">
      <h2 id="studio-renderer-heading" className="studio-step-title">
        Choose the reality
      </h2>
      <p className="section-lede">
        Only renderers actually registered on the control plane are offered — the product never
        invents one. Camera, commentary and tactical renderers are not registered this wave, so they
        are not offered.
      </p>
      <ul className="card-grid studio-source-grid">
        {options.renderers.map((entry) => {
          const dispatchability = rendererDispatchabilityOf(entry);
          return (
            <li key={entry.rendererId}>
              <label
                className={`session-card studio-source${draft.rendererId === entry.rendererId ? " current" : ""}`}
              >
                <input
                  type="radio"
                  name="studio-renderer"
                  disabled={dispatchability.state !== "ready"}
                  checked={draft.rendererId === entry.rendererId}
                  onChange={() => onPick(entry.rendererId)}
                />
                <span className="session-card-title">{entry.rendererId}</span>
                <dl className="session-card-facts">
                  <div className="fact">
                    <dt>Version</dt>
                    <dd>{entry.rendererVersion}</dd>
                  </div>
                  <div className="fact">
                    <dt>Class</dt>
                    <dd>{entry.rendererClass}</dd>
                  </div>
                  <div className="fact">
                    <dt>Profiles</dt>
                    <dd>{entry.supportedOutputProfiles.length}</dd>
                  </div>
                </dl>
                {dispatchability.state === "ready" ? (
                  <StateChip state="ready">dispatchable</StateChip>
                ) : (
                  <span>
                    <StateChip state="unavailable">no artifact handoff</StateChip>
                    <span className="studio-source-description">{dispatchability.reason}</span>
                  </span>
                )}
              </label>
            </li>
          );
        })}
      </ul>
      <p className="form-notice" role="note">
        {options.compute === null
          ? "No compute plane is configured — render dispatch is unavailable (the control plane answers its typed 503)."
          : `Renders dispatch through the ${options.compute.provider} compute plane (adapter ${options.compute.adapterId}) — a real job with metered progress.`}
      </p>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Step 4 — the recipe (style + a real output profile)
// ---------------------------------------------------------------------------

function RecipeStep({
  options,
  draft,
  source,
  onStyle,
  onProfile,
}: {
  options: StudioOptionsLike;
  draft: CreateDraft;
  source: StudioOptionsLike["sources"][number] | null;
  onStyle: (styleId: string) => void;
  onProfile: (index: number) => void;
}) {
  const profiles =
    options.renderers.find((entry) => entry.rendererId === draft.rendererId)
      ?.supportedOutputProfiles ?? [];
  return (
    <section className="studio-step" aria-labelledby="studio-recipe-heading">
      <h2 id="studio-recipe-heading" className="studio-step-title">
        Set the recipe
      </h2>
      <p className="section-lede">
        The recipe carries your style label and one of the renderer&apos;s real output profiles.
        Commentary, camera behavior and tactics come from the source fixture itself (the real engine
        inputs below) — there is no separate commentary/camera/tactical renderer to configure this
        wave.
      </p>
      <div className="form-field">
        <label htmlFor="studio-style">Style label</label>
        <input
          id="studio-style"
          type="text"
          value={draft.styleId ?? ""}
          placeholder="e.g. derby-night"
          onChange={(event) => onStyle(event.target.value)}
        />
        <p className="field-hint">
          The style id travels with the render&apos;s provenance (the renderer validates it).
        </p>
      </div>
      <fieldset className="form-field">
        <legend>Output profile</legend>
        <ul className="studio-operation-list">
          {profiles.map((profile, index) => (
            <li key={`${profile.resolution.w}x${profile.resolution.h}-${profile.frameRate}`}>
              <label>
                <input
                  type="radio"
                  name="studio-profile"
                  checked={draft.outputProfileIndex === index}
                  onChange={() => onProfile(index)}
                />
                <span className="studio-operation-label">
                  {profile.resolution.w}×{profile.resolution.h} @ {profile.frameRate}fps ·{" "}
                  {profile.latencyClass}
                </span>
                <span className="studio-operation-description">
                  {profile.codec} in {profile.container}
                </span>
              </label>
            </li>
          ))}
        </ul>
      </fieldset>
      {source !== null && (
        <section className="studio-source-facts">
          <h3 className="studio-subheading">What the engine will run (real source inputs)</h3>
          <dl className="session-card-facts">
            <div className="fact">
              <dt>Source camera</dt>
              <dd>
                pan {source.camera.pan} · zoom {source.camera.zoom} · jitter {source.camera.jitter}
              </dd>
            </div>
            <div className="fact">
              <dt>Commentary windows</dt>
              <dd>{source.commentary.length}</dd>
            </div>
          </dl>
        </section>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Step 5 — review + submit
// ---------------------------------------------------------------------------

function ReviewStep({
  draft,
  source,
  renderer,
  preview,
  verdict,
  submitting,
  flowError,
  onSubmit,
}: {
  draft: CreateDraft;
  source: StudioOptionsLike["sources"][number] | null;
  renderer: StudioOptionsLike["renderers"][number] | null;
  preview: RightsPreviewLike | null;
  verdict: { state: "ready" | "denied"; warning: string | null } | null;
  submitting: boolean;
  flowError: string | null;
  onSubmit: () => void;
}) {
  return (
    <section className="studio-step" aria-labelledby="studio-review-heading">
      <h2 id="studio-review-heading" className="studio-step-title">
        Review and render
      </h2>
      <dl className="session-card-facts">
        <div className="fact">
          <dt>Source</dt>
          <dd>{source?.label ?? "—"}</dd>
        </div>
        <div className="fact">
          <dt>Renderer</dt>
          <dd>{renderer?.rendererId ?? "—"}</dd>
        </div>
        <div className="fact">
          <dt>Style</dt>
          <dd>{draft.styleId ?? "—"}</dd>
        </div>
        <div className="fact">
          <dt>Operations declared</dt>
          <dd>{draft.operations.join(", ")}</dd>
        </div>
        <div className="fact">
          <dt>Sharing scope</dt>
          <dd>{draft.sharingScope}</dd>
        </div>
        <div className="fact">
          <dt>Expires</dt>
          <dd>{draft.expiresAtIso ?? "never"}</dd>
        </div>
      </dl>
      {preview !== null && <RightsPreviewPanel preview={{ phase: "ready", data: preview }} />}
      {flowError !== null && (
        <p className="form-error" role="alert">
          {flowError}
        </p>
      )}
      <div className="studio-nav">
        <button
          type="button"
          className="button-primary"
          disabled={submitting || verdict?.state !== "ready"}
          onClick={onSubmit}
        >
          {submitting ? "Creating…" : "Create session and render"}
        </button>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Step 6 — progress + preview + publish/private
// ---------------------------------------------------------------------------

function RenderStep({
  submission,
  job,
  jobError,
  sessionState,
  watch,
  output,
  publishing,
  onVisibility,
}: {
  submission: SubmissionState;
  job: StudioJobLike | null;
  jobError: string | null;
  sessionState: StudioSessionStateLike | null;
  watch: WatchModelLike | null;
  output:
    | { phase: "idle" }
    | { phase: "loading" }
    | { phase: "ready"; data: RenderOutputLike }
    | { phase: "denied"; reason: string }
    | { phase: "failed"; error: string };
  publishing: boolean;
  onVisibility: (visibility: "public" | "private") => void;
}) {
  const progress = job !== null ? jobProgressOf(job.state) : null;
  const fraction = job !== null ? meteredFractionOf(job) : null;
  const completion = job?.completion ?? null;
  const previewSvg = useMemo(() => {
    if (output.phase !== "ready") return null;
    const frameCount = output.data.manifest.frameCount;
    if (frameCount <= 0) return null;
    // The middle frame — a static, real frame of the stored artifact (the
    // pure, fail-closed display transform; see frame-svg.ts).
    const frameIndex = Math.floor(frameCount / 2);
    try {
      return { svg: prepareFrameForDisplay(output.data.content, frameIndex), frameIndex };
    } catch {
      return null;
    }
  }, [output]);
  const visibility = sessionState?.visibility ?? "private";

  return (
    <section className="studio-step" aria-labelledby="studio-render-heading">
      <h2 id="studio-render-heading" className="studio-step-title">
        Your render
      </h2>
      <dl className="session-card-facts">
        <div className="fact">
          <dt>Session</dt>
          <dd>
            <code>{submission.session.sessionId}</code>
          </dd>
        </div>
        <div className="fact">
          <dt>Job</dt>
          <dd>
            <code>{submission.dispatch.jobId}</code> ({submission.dispatch.disposition})
          </dd>
        </div>
        <div className="fact">
          <dt>Compute adapter</dt>
          <dd>{submission.dispatch.adapterId}</dd>
        </div>
      </dl>

      {jobError !== null && (
        <StatePanel state="failed" title="The job state could not be read" reason={jobError} />
      )}

      {progress === null && <LoadingPanel label="Reading the compute ledger" />}

      {progress !== null && job !== null && (
        <section className="studio-progress" aria-live="polite">
          <div className="studio-progress-head">
            <StateChip state={progress.phase === "ready" ? "ready" : progress.phase}>
              {progress.label}
            </StateChip>
            {fraction !== null && (
              <span className="studio-progress-fraction">
                {Math.round(fraction * 100)}% metered
              </span>
            )}
            {fraction === null && !progress.terminal && (
              <span className="field-hint">
                no metered fraction yet — the ledger&apos;s events are the truth
              </span>
            )}
          </div>
          <ol className="studio-event-trail">
            {job.events.map((event, index) => (
              <li key={`${event.atMs}-${event.type}-${index}`}>
                <span className="marker-time">+{event.atMs}ms</span>{" "}
                <span className="studio-event-type">{event.type}</span>
                {event.stage !== undefined && <span className="subtle"> ({event.stage})</span>}
                {event.fraction !== undefined && (
                  <span className="subtle"> {Math.round(event.fraction * 100)}%</span>
                )}
              </li>
            ))}
          </ol>
          {completion !== null && (
            <section className="studio-completion">
              <h3 className="studio-subheading">Completion (never-silent accounting)</h3>
              <dl className="session-card-facts">
                <div className="fact">
                  <dt>Consumed inputs</dt>
                  <dd>{completion.accounting.consumedInputIds.join(", ") || "none"}</dd>
                </div>
                <div className="fact">
                  <dt>Unconsumed inputs</dt>
                  <dd>
                    {completion.accounting.unconsumedInputs.length === 0
                      ? "none"
                      : completion.accounting.unconsumedInputs
                          .map((input) => `${input.inputId} (${input.reason})`)
                          .join(", ")}
                  </dd>
                </div>
                <div className="fact">
                  <dt>Execution</dt>
                  <dd>
                    {completion.timing.executionMs}ms (queue {completion.timing.queueWaitMs ?? 0}ms)
                  </dd>
                </div>
                <div className="fact">
                  <dt>Usage</dt>
                  <dd>
                    {completion.usage.map((unit) => `${unit.quantity} ${unit.unitId}`).join(", ")}
                  </dd>
                </div>
                <div className="fact">
                  <dt>Outputs</dt>
                  <dd>
                    {completion.outputs.length === 0
                      ? "none"
                      : completion.outputs
                          .map(
                            (artifact) =>
                              `${artifact.contentType} · ${artifact.byteLength}B${
                                artifact.frameCount !== undefined
                                  ? ` · ${artifact.frameCount} frames`
                                  : ""
                              }`,
                          )
                          .join("; ")}
                  </dd>
                </div>
              </dl>
              {completion.failure !== undefined && (
                <p className="form-error" role="alert">
                  {completion.failure.errorClass}: {completion.failure.message} (
                  {completion.failure.terminal})
                </p>
              )}
            </section>
          )}
        </section>
      )}

      {progress !== null && progress.phase === "ready" && (
        <section className="studio-preview">
          <h3 className="studio-subheading">Preview</h3>
          {job?.renderId !== undefined && (
            <p className="field-hint">
              Stored render <code>{job.renderId}</code> — ingest {job.ingest.status}.
            </p>
          )}
          {watch !== null && watch.playback.state === "denied" && (
            <StatePanel
              state="denied"
              title="Playback denied by the rights policy"
              reason="This session's policy does not allow storing derivatives — the control plane denies playback before any byte. The render itself executed (it is compute)."
            />
          )}
          {output.phase === "loading" && <LoadingPanel label="Fetching the stored output" />}
          {output.phase === "denied" && (
            <StatePanel
              state="denied"
              title="The stored output is not readable"
              reason={output.reason}
            />
          )}
          {output.phase === "failed" && (
            <StatePanel state="failed" title="The output could not be read" reason={output.error} />
          )}
          {output.phase === "ready" && previewSvg !== null && (
            <div
              className="player-artifact studio-preview-svg"
              role="img"
              aria-label={`A real frame of the rendered output (frame ${previewSvg.frameIndex})`}
              dangerouslySetInnerHTML={{ __html: previewSvg.svg }}
            />
          )}
          {output.phase === "ready" && (
            <p className="field-hint">
              {output.data.manifest.frameCount} frames · {output.data.manifest.totalDurationMs}ms ·{" "}
              {output.data.byteLength}B stored
            </p>
          )}
          <p>
            <Link
              className="button-ghost"
              href={`${ROUTES.watch}?session=${encodeURIComponent(submission.session.sessionId)}`}
            >
              Open in Watch
            </Link>
          </p>
        </section>
      )}

      {sessionState !== null && (
        <section className="studio-publication">
          <h3 className="studio-subheading">Publication</h3>
          <p className="section-lede">
            {visibility === "public"
              ? "This session is published: it appears in the public catalog and anyone can watch it."
              : "This session is private: it is not in the public catalog and only you (or an operator) can watch it."}
          </p>
          <div className="studio-nav">
            <button
              type="button"
              className={visibility === "private" ? "button-primary" : "button-ghost"}
              disabled={publishing || visibility === "private"}
              onClick={() => onVisibility("private")}
            >
              Keep private
            </button>
            <button
              type="button"
              className={visibility === "public" ? "button-primary" : "button-ghost"}
              disabled={publishing || visibility === "public"}
              onClick={() => onVisibility("public")}
            >
              Publish
            </button>
          </div>
          <p className="field-hint">
            The visibility flag is stored with this deployment&apos;s control-plane state (in-memory
            this wave — a restart resets it to the public default for seeded content; studio
            sessions start private).
          </p>
        </section>
      )}
    </section>
  );
}
