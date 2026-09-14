/**
 * The renderer-selection plan (W703): the PURE decision layer that derives
 * renderer choices + affordances from CAPABILITY data.
 *
 * W703 accept criterion: "renderer selection is capability-driven, not
 * hard-coded into frontend pages." The inputs are exactly the two documents
 * the real surfaces already provide:
 *
 * - the renderer `RendererCapability` documents the control plane lists from
 *   the REAL registry (`GET /v1/renderers`, W701 — the listing seam was
 *   already capability-shaped; W703 consumes it and derives from it);
 * - the session's fail-closed derived `RightsCapabilities` (W701
 *   `getSession`/`createSession` results, verbatim).
 *
 * The derivation NEVER matches renderer ids, classes, or any renderer-specific
 * key: every decision reads declared capability fields
 * (`requiresSourceFrames`, `supportedOutputProfiles`, identity) and the
 * session's rights. A test pins the plan layer for renderer-id literals so a
 * hard-coded list cannot regress into it.
 *
 * Affordances (one per listed capability, registry order preserved):
 *
 * - **selectable** — the renderer-only selection payload
 *   ({@link selectionRequestOf}: exact `rendererId` + `rendererVersion`) may
 *   be sent to `createRender`;
 * - **blocked: `rights-required`** — the capability declares
 *   `requiresSourceFrames: true` while the session's
 *   `canReferenceSourceFrames` is false. This is not a viewer invention: it
 *   mirrors the REAL plugin gate (renderer contract R2 — the plugin rejects
 *   such a request with `rights-denied` in both `validateRequest` and
 *   `render`); the plan surfaces the gate BEFORE the user selects it;
 * - **blocked: `no-output-profiles`** — the capability declares no supported
 *   output profiles; the control plane would fail the request while building
 *   it (`media-invalid` — W701 `firstSupportedProfile`). Mirrors the real
 *   server behavior;
 * - **blocked: `unsupported-output`** — every declared output profile's
 *   kind (`codec`/`container`) is outside THIS viewer's presentable output
 *   kinds ({@link VIEWER_PRESENTABLE_OUTPUT_KINDS}). This is the viewer's OWN
 *   playback capability surface — the animated-SVG kinds the shell can
 *   actually present (W502 frame sequences + W504 stored SMIL segments) —
 *   not a renderer list. Rendering such a renderer through the control API
 *   is still ALLOWED (rendering is compute); the grey-out is the viewer's
 *   honest statement that it cannot present the result (the W702
 *   `unsupported-output` failure-class vocabulary);
 * - **blocked: `no-session`** — no session is open, so there is no rights
 *   context to evaluate capability requirements against. Fail-closed: the
 *   plan never ASSUMES rights (W701 posture — absent policy decisions deny).
 *
 * Reason precedence when several apply: `no-session` > `rights-required` >
 * `no-output-profiles` > `unsupported-output` (the server-side gates first:
 * a rights denial precedes any request-build failure, which precedes the
 * viewer-side presentation judgment).
 *
 * KNOWN LIMITATIONS (honest, documented):
 *
 * - the affordance is derived at `beginRender` time (a snapshot of the
 *   session's rights as the view holds them). The control plane re-derives
 *   rights on EVERY call and stays AUTHORITATIVE — a stale plan never
 *   overrides a real server gate (e.g. a policy expiring between the listing
 *   and `createRender` fails at the server with its real typed error, which
 *   the viewer surfaces verbatim);
 * - `minSnapshotVersion` gating stays SERVER-side: the W701 surface exposes
 *   no session snapshot-version field, so the viewer cannot evaluate it. A
 *   violating selection simply surfaces the server's real `media-invalid`
 *   error at `createRender` (R3) — fail-closed, never pre-checked here;
 * - presentability is derived from the DECLARED profile (codec/container)
 *   — a profile-level inference, not a byte-level guarantee. The playback
 *   path still validates everything it serves (the provider re-hashes the
 *   served bytes; the players fail loud on malformed documents) — defense in
 *   depth, never trust by inference;
 * - latency classes are NOT gated: `latencyClass` describes delivery
 *   posture, not presentability; stored segments are presented as batch
 *   playback regardless (live delivery is W704's concern, honestly noted
 *   elsewhere in the shell).
 *
 * STYLE/PROFILE EXTENSION POINT (W703 boundary, deliberate): NO renderer
 * declares style variants today — the capability model
 * (`RendererCapability`) has no style/variant surface, and this plan NEVER
 * invents one. The selection seam carries a style choice HONESTLY when a
 * caller provides one: `createRender`'s `styleConfig { styleId, config }`
 * flows VERBATIM through the viewer core → control client → W701
 * `createRender` → the plugin (`styleId` lands in the W502 manifest's
 * renderer block unchanged; plugin-specific config keys stay behind the
 * plugin — the viewer holds no renderer-specific style knowledge). When a
 * future capability surface declares styles or multiple selectable output
 * profiles, this plan extends with per-option style/profile choices — the
 * seam (`createRender`'s `outputProfile` + `styleConfig`) already carries
 * both.
 */
import type { RendererCapability, RightsCapabilities } from "@sporta/contracts";

/**
 * The output kinds THIS viewer can present — the viewer's OWN playback
 * capability surface, not a renderer list. Today's surface is the
 * animated-SVG family: the W502 frame-sequence documents and the W504 stored
 * SMIL segment documents (both SVG; see `./player.ts`,
 * `./segment-player.ts`, `./playback-provider.ts`). Extend this constant —
 * never a renderer id — when the playback surface grows (e.g. real video
 * codecs with W305/W704).
 */
export const VIEWER_PRESENTABLE_OUTPUT_KINDS: ReadonlyArray<{
  /** Declared profile codec the player surface understands (e.g. `"svg"`). */
  codec: string;
  /** Declared profile container the player surface understands (e.g. `"svg"`). */
  container: string;
}> = [{ codec: "svg", container: "svg" }];

/**
 * Why a listed renderer is NOT selectable. Machine-readable codes (the notes
 * for humans live in {@link RendererOptionView.blockedNote}); each mirrors a
 * REAL gate (plugin R2/R3, the W701 request build, or this viewer's playback
 * surface — see the module docs).
 */
export type RendererBlockedReason =
  /** No session open: no fail-closed rights context to evaluate against. */
  | "no-session"
  /** The renderer requires source frames the session's rights do not grant. */
  | "rights-required"
  /** The renderer declares no supported output profiles. */
  | "no-output-profiles"
  /** The renderer's declared output kinds are not presentable in this viewer. */
  | "unsupported-output";

/** One derived renderer choice: the capability VERBATIM plus its affordance. */
export interface RendererOptionView {
  /** The listed capability document, verbatim (identity, class, profiles, rights needs). */
  capability: RendererCapability;
  /** Whether the selection payload may be sent to `createRender`. */
  selectable: boolean;
  /** The machine-readable block reason, or `null` iff `selectable`. */
  blockedReason: RendererBlockedReason | null;
  /**
   * The deterministic human note explaining the block (empty string iff
   * selectable) — display text derived from the capability data, never from
   * renderer identity.
   */
  blockedNote: string;
}

/** The `createRender` payload shape the selection plan derives (renderer-only). */
export interface SelectionRequest {
  /** The exact capability identity selected (ids are stable, versions immutable). */
  rendererId: string;
  /** The listed version — pinning the document the user actually saw. */
  rendererVersion: string;
}

/**
 * The selection request for one option: the renderer-only payload (exact
 * identity pair, nothing invented). `outputProfile` is deliberately omitted —
 * the control plane defaults to the plugin's FIRST supported profile (W701
 * `firstSupportedProfile`), which is the profile the plan presents; when a
 * renderer declares multiple profiles and a choice UI is added, the
 * `createRender` seam already carries `outputProfile` verbatim (the extension
 * point, see the module docs). `styleConfig` is likewise omitted — no
 * capability declares style variants today; the seam carries one verbatim
 * when a caller provides it.
 */
export function selectionRequestOf(option: RendererOptionView): SelectionRequest {
  return {
    rendererId: option.capability.rendererId,
    rendererVersion: option.capability.rendererVersion,
  };
}

/**
 * `true` when the capability declares at least one output profile whose kind
 * (`codec`/`container`) this viewer can present.
 */
function isPresentable(capability: RendererCapability): boolean {
  return capability.supportedOutputProfiles.some((profile) =>
    VIEWER_PRESENTABLE_OUTPUT_KINDS.some(
      (kind) => kind.codec === profile.codec && kind.container === profile.container,
    ),
  );
}

/**
 * The declared output kinds of a capability, deterministic summary text
 * (`"codec/container"` joined by `", "`, registry-declaration order, empty
 * string when none declared). Used inside block notes so the reason names
 * the DATA (what the renderer declared), never the renderer identity.
 */
export function declaredOutputKindsOf(capability: RendererCapability): string {
  return capability.supportedOutputProfiles
    .map((profile) => `${profile.codec}/${profile.container}`)
    .join(", ");
}

/** Deterministic block notes (one per reason; capability data interpolated). */
function blockedNoteOf(reason: RendererBlockedReason, capability: RendererCapability): string {
  switch (reason) {
    case "no-session":
      return "Renderer selection requires an open session: the session's fail-closed derived rights are the capability context.";
    case "rights-required":
      return "This renderer requires source frames, but the session's rights do not grant source-frame references (requiresSourceFrames with canReferenceSourceFrames false) — the renderer's fail-closed gate (R2) rejects the request, so the control plane refuses the render.";
    case "no-output-profiles":
      return "This renderer declares no supported output profiles — the control plane would reject the render (media-invalid).";
    case "unsupported-output":
      return `This viewer cannot present this renderer's declared output kinds (${declaredOutputKindsOf(capability) || "none"}) — it presents animated-SVG outputs only. Rendering stays possible through the control API; the playback is the viewer's limit.`;
  }
}

/**
 * Derives the renderer options from the listed capabilities and the
 * session's rights. Pure and deterministic: same inputs → deep-equal output
 * (registry order preserved; capabilities passed through verbatim; ids never
 * matched, branched, or rewritten). See the module docs for the affordance
 * semantics and the reason precedence.
 */
export function deriveRendererOptions(
  renderers: readonly RendererCapability[],
  rights: RightsCapabilities | null,
): RendererOptionView[] {
  return renderers.map((capability) => {
    let reason: RendererBlockedReason | null = null;
    if (rights === null) {
      reason = "no-session";
    } else if (capability.requiresSourceFrames && !rights.canReferenceSourceFrames) {
      reason = "rights-required";
    } else if (capability.supportedOutputProfiles.length === 0) {
      reason = "no-output-profiles";
    } else if (!isPresentable(capability)) {
      reason = "unsupported-output";
    }
    return {
      capability,
      selectable: reason === null,
      blockedReason: reason,
      blockedNote: reason === null ? "" : blockedNoteOf(reason, capability),
    };
  });
}
