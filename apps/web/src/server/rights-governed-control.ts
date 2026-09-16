/**
 * THE RIGHTS-GOVERNED CONTROL PLANE (W917) — the composition wiring that
 * makes a rights holder's policy EDIT or REVOCATION take effect on every
 * playback/publication read, fail-closed, without weakening any gate.
 *
 * The raw `ControlApp` (`@sporta/control-api`) stores each session's policy
 * internally at creation and derives every capability from it per read. This
 * decorator fronts the raw app for THIS composition and adds exactly one
 * behavior: when a rights holder has EDITED a session's policy (the
 * {@link EffectivePolicyStore} override), every rights-checking method
 * re-derives the capabilities from the EFFECTIVE policy instead:
 *
 * - `getSession` answers the re-derived `rightsCapabilities` — so the watch
 *   model, the catalog cards, the live-stream gate and the studio state all
 *   re-derive fail-closed from the current policy (this is the "re-derives
 *   rights fail-closed" property the W917 acceptance pins);
 * - the playback methods (`getRender`, `listRenders`, `listRenderOutputs`,
 *   `getRenderOutput`) deny with the control plane's OWN typed
 *   `ControlRightsDeniedError` (same message shape as its internal gate)
 *   when the effective policy no longer allows `canStoreDerivatives` —
 *   mirroring the raw app's exact ordering: existence (404) first, then the
 *   rights denial (403) BEFORE any render existence is revealed;
 * - the render methods (`createRender`, `createRenderAsync`) deny with the
 *   raw app's own all-denied error (expired-policy / no-capabilities) when
 *   the effective policy derives nothing — a revoked session stops
 *   rendering too;
 * - `createSession` records the accepted (identity-attested) policy into
 *   the store, so every session created through this composition has an
 *   inspectable policy record from the start.
 *
 * NARROW-ONLY (pinned by tests): the effective capabilities are the
 * INTERSECTION of the creation-time attestation's derivation and the
 * current override's derivation — a capability holds only when BOTH allow
 * it. A rights holder's edit can narrow effective rights (or revoke them
 * entirely) but can never widen access past what the control plane's
 * stored policy attested at creation; the raw app's own internal gate
 * still runs underneath every delegated call as well.
 *
 * Pass-through: `listSessions`, `listRenderers`, `terminateSession`,
 * `getComputeJob` and `observability` delegate untouched (no per-session
 * rights decision is embedded in their answers beyond what the raw app
 * already enforces).
 */
import type { ControlApp } from "@sporta/control-api";
import { ControlRightsDeniedError } from "@sporta/control-api";
import { deriveRightsCapabilities } from "@sporta/contracts";
import type { AuthorizationPolicy, RightsCapabilities } from "@sporta/contracts";
import type { EffectivePolicyStore } from "./rights-policy-store";

/** `true` when the fail-closed derivation denied every capability. */
function allDenied(caps: RightsCapabilities): boolean {
  return (
    !caps.canReferenceSourceFrames &&
    !caps.canDeliverLive &&
    !caps.canStoreDerivatives &&
    !caps.canShare
  );
}

/**
 * NARROW-ONLY: the effective capabilities — a capability holds only when
 * BOTH the creation-time attestation (the raw app's own derivation) AND the
 * current rights-holder policy allow it. A rights holder's edit can narrow
 * effective rights (or revoke them entirely) but can never widen access
 * past what the control plane's stored policy attested at creation.
 */
function intersectCaps(a: RightsCapabilities, b: RightsCapabilities): RightsCapabilities {
  return {
    canReferenceSourceFrames: a.canReferenceSourceFrames && b.canReferenceSourceFrames,
    canDeliverLive: a.canDeliverLive && b.canDeliverLive,
    canStoreDerivatives: a.canStoreDerivatives && b.canStoreDerivatives,
    canShare: a.canShare && b.canShare,
  };
}

/**
 * Wraps `raw` so the EFFECTIVE policy (creation record + any rights-holder
 * edit) governs every rights-checking read. `nowMs` is the composition's
 * clock — every derivation is at request time (a policy that expires later
 * denies later, with no new write: fail-closed re-derivation).
 */
export function createRightsGovernedControl(
  raw: ControlApp,
  policies: EffectivePolicyStore,
  nowMs: () => number,
): ControlApp {
  const overrideOf = (sessionId: string): AuthorizationPolicy | null => policies.overrideOf(sessionId);

  const derive = (policy: AuthorizationPolicy): RightsCapabilities =>
    deriveRightsCapabilities(policy, new Date(nowMs()));

  /** The raw app's own playback gate, mirrored over the EFFECTIVE policy. */
  const assertEffectivePlaybackRights = (
    sessionId: string,
    effective: RightsCapabilities,
  ): void => {
    if (effective.canStoreDerivatives !== true) {
      throw new ControlRightsDeniedError(
        `playback access denied: rightsCapabilities.canStoreDerivatives is false for session '${sessionId}'`,
        { sessionId },
      );
    }
  };

  /** The raw app's own render gate, mirrored over the EFFECTIVE policy. */
  const assertEffectiveRenderRights = (
    sessionId: string,
    override: AuthorizationPolicy,
    effective: RightsCapabilities,
  ): void => {
    if (allDenied(effective)) {
      const expired =
        override.expiresAtIso !== undefined && Date.parse(override.expiresAtIso) <= nowMs();
      throw new ControlRightsDeniedError(
        expired
          ? `rights denied (expired-policy): no valid rights decision for session '${sessionId}'`
          : `rights denied: no rights capability can be derived for session '${sessionId}'`,
        { sessionId, reason: expired ? "expired-policy" : "no-capabilities" },
      );
    }
  };

  return {
    observability: raw.observability,

    async createSession(input, ctx) {
      const result = await raw.createSession(input, ctx);
      // Record the accepted policy — the gate has already re-attested it
      // with the VERIFIED caller's id before it reaches here.
      policies.recordAtCreation(result.session.sessionId, input.authorizationPolicy);
      return result;
    },

    async getSession(sessionId, ctx) {
      const result = await raw.getSession(sessionId, ctx);
      const override = overrideOf(sessionId);
      if (override === null) return result;
      return {
        session: result.session,
        rightsCapabilities: intersectCaps(result.rightsCapabilities, derive(override)),
      };
    },

    async listSessions(ctx) {
      return raw.listSessions(ctx);
    },

    async terminateSession(sessionId, ctx) {
      return raw.terminateSession(sessionId, ctx);
    },

    async listRenderers(ctx) {
      return raw.listRenderers(ctx);
    },

    async createRender(sessionId, input, ctx) {
      const override = overrideOf(sessionId);
      if (override !== null) {
        // Mirror the raw ordering: existence (typed 404) BEFORE the rights
        // denial — then the effective-policy render gate.
        const { rightsCapabilities: rawCaps } = await raw.getSession(sessionId, ctx);
        assertEffectiveRenderRights(
          sessionId,
          override,
          intersectCaps(rawCaps, derive(override)),
        );
      }
      return raw.createRender(sessionId, input, ctx);
    },

    async getRender(sessionId, renderId, ctx) {
      const override = overrideOf(sessionId);
      if (override !== null) {
        const { rightsCapabilities: rawCaps } = await raw.getSession(sessionId, ctx);
        assertEffectivePlaybackRights(sessionId, intersectCaps(rawCaps, derive(override)));
      }
      return raw.getRender(sessionId, renderId, ctx);
    },

    async listRenders(sessionId, ctx) {
      const override = overrideOf(sessionId);
      if (override !== null) {
        const { rightsCapabilities: rawCaps } = await raw.getSession(sessionId, ctx);
        assertEffectivePlaybackRights(sessionId, intersectCaps(rawCaps, derive(override)));
      }
      return raw.listRenders(sessionId, ctx);
    },

    async getRenderOutput(sessionId, renderId, segmentId, ctx) {
      const override = overrideOf(sessionId);
      if (override !== null) {
        const { rightsCapabilities: rawCaps } = await raw.getSession(sessionId, ctx);
        assertEffectivePlaybackRights(sessionId, intersectCaps(rawCaps, derive(override)));
      }
      return raw.getRenderOutput(sessionId, renderId, segmentId, ctx);
    },

    async listRenderOutputs(sessionId, renderId, ctx) {
      const override = overrideOf(sessionId);
      if (override !== null) {
        const { rightsCapabilities: rawCaps } = await raw.getSession(sessionId, ctx);
        assertEffectivePlaybackRights(sessionId, intersectCaps(rawCaps, derive(override)));
      }
      return raw.listRenderOutputs(sessionId, renderId, ctx);
    },

    async createRenderAsync(sessionId, input, ctx) {
      const override = overrideOf(sessionId);
      if (override !== null) {
        const { rightsCapabilities: rawCaps } = await raw.getSession(sessionId, ctx);
        assertEffectiveRenderRights(
          sessionId,
          override,
          intersectCaps(rawCaps, derive(override)),
        );
      }
      return raw.createRenderAsync(sessionId, input, ctx);
    },

    async getComputeJob(sessionId, jobId, ctx) {
      return raw.getComputeJob(sessionId, jobId, ctx);
    },
  };
}
