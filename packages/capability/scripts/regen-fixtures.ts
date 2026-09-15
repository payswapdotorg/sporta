/**
 * Regenerates the W901 deny/degraded capability fixtures (deterministic).
 *
 * `bun run regen-fixtures` re-runs `buildCapabilityResponse` over the eight
 * canonical scenarios and writes the serialized responses under
 * `fixtures/v1/`. The scenarios are the brief's deny/degraded coverage list:
 * anonymous, authenticated-no-roles, rights-denied renderer, quota-exhausted,
 * provider-down, provider-degraded, live-unavailable (Simulation F), and
 * partial availability.
 *
 * Renderer ids mirror the real registry (`sporta.testcard`, `anime.prototype`,
 * `avatar-field.prototype` — all pure SWM projections, requiresSourceFrames
 * false). The rights-gated scenario uses `broadcast-enhanced.prototype`, the
 * architecture-lock §5 "original/enhanced broadcast presentation" renderer
 * class, which by definition references source frames.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { buildCapabilityResponse } from "../src/service";
import { serializeCapabilityResponse } from "../src/serialize";
import type { RightsCapabilities } from "@sporta/contracts";

const OUT_DIR = join(import.meta.dir, "..", "fixtures", "v1");

/** Full public-content rights (what an authorized catalog allows). */
const FULL_RIGHTS: RightsCapabilities = {
  canReferenceSourceFrames: true,
  canDeliverLive: true,
  canStoreDerivatives: true,
  canShare: true,
};

/** Analysis-only derivation: transformation denied (rights-denied path). */
const NO_TRANSFORMATION_RIGHTS: RightsCapabilities = {
  canReferenceSourceFrames: false,
  canDeliverLive: false,
  canStoreDerivatives: true,
  canShare: false,
};

/** The healthy baseline providers (all feeds ok). */
const HEALTHY_PROVIDERS = [
  { kind: "control-plane", health: "ok" },
  { kind: "storage", health: "ok" },
  { kind: "queue-cache", health: "ok" },
  { kind: "compute", health: "ok" },
] as const;

/** The registry snapshot mirroring the real renderer registry. */
const REGISTERED_RENDERERS = [
  {
    rendererId: "sporta.testcard",
    rendererVersion: "0.1.0",
    rendererClass: "tactical",
    requiresSourceFrames: false,
    registryStatus: "registered",
    dependsOnProviders: ["compute"],
  },
  {
    rendererId: "anime.prototype",
    rendererVersion: "0.1.0",
    rendererClass: "procedural-3d",
    requiresSourceFrames: false,
    registryStatus: "registered",
    dependsOnProviders: ["compute"],
  },
  {
    rendererId: "avatar-field.prototype",
    rendererVersion: "0.2.0",
    rendererClass: "procedural-3d",
    requiresSourceFrames: false,
    registryStatus: "registered",
    dependsOnProviders: ["compute"],
  },
] as const;

/** The architecture-lock §5 broadcast renderer: references source frames. */
const BROADCAST_RENDERER = {
  rendererId: "broadcast-enhanced.prototype",
  rendererVersion: "0.1.0",
  rendererClass: "stylized-video",
  requiresSourceFrames: true,
  registryStatus: "registered",
  dependsOnProviders: ["compute"],
} as const;

/** The eight canonical scenarios (inputs, in the brief's order). */
const SCENARIOS: Record<string, unknown> = {
  // 1. Anonymous visitor (Simulation A): public catalog, no session, no
  //    account, in-process transport (live honestly NOT live-network).
  anonymous: {
    requestContext: { requestId: "req-anon-001" },
    session: { authenticated: false, valid: false },
    rights: FULL_RIGHTS,
    renderers: REGISTERED_RENDERERS,
    liveTransport: { kind: "in-process" },
    providers: HEALTHY_PROVIDERS,
    quotas: [],
  },
  // 2. Authenticated account holding no role grants (edge: all grants
  //    revoked): only public surfaces visible.
  "authenticated-no-roles": {
    requestContext: { requestId: "req-noroles-002" },
    session: { authenticated: true, valid: true, userId: "u-42", activeRole: null },
    account: { userId: "u-42", roles: [] },
    rights: FULL_RIGHTS,
    renderers: REGISTERED_RENDERERS,
    liveTransport: { kind: "in-process" },
    providers: HEALTHY_PROVIDERS,
    quotas: [{ quotaId: "user.daily-renders", scope: "user", used: 0, limit: 10 }],
  },
  // 3. Rights-denied renderer: the source-frame broadcast renderer with a
  //    policy that does not allow transformation.
  "rights-denied-renderer": {
    requestContext: { requestId: "req-rights-003" },
    session: { authenticated: true, valid: true, userId: "u-7", activeRole: "creator" },
    account: { userId: "u-7", roles: ["viewer", "creator"] },
    rights: NO_TRANSFORMATION_RIGHTS,
    renderers: [...REGISTERED_RENDERERS, BROADCAST_RENDERER],
    liveTransport: { kind: "in-process" },
    providers: HEALTHY_PROVIDERS,
    quotas: [{ quotaId: "user.daily-renders", scope: "user", used: 2, limit: 10 }],
  },
  // 4. Quota-exhausted (Simulation E): counters at/over the limits.
  "quota-exhausted": {
    requestContext: { requestId: "req-quota-004" },
    session: { authenticated: true, valid: true, userId: "u-9", activeRole: "creator" },
    account: { userId: "u-9", roles: ["viewer", "creator"] },
    rights: FULL_RIGHTS,
    renderers: REGISTERED_RENDERERS,
    liveTransport: { kind: "in-process" },
    providers: HEALTHY_PROVIDERS,
    quotas: [
      { quotaId: "user.daily-renders", scope: "user", used: 10, limit: 10 },
      { quotaId: "job.concurrent-renders", scope: "job", used: 3, limit: 2 },
    ],
  },
  // 5. Provider-down: compute provider is down → dependent renderers and
  //    batch mode unavailable; overall degraded with provider-down.
  "provider-down": {
    requestContext: { requestId: "req-pdown-005" },
    session: { authenticated: true, valid: true, userId: "u-11", activeRole: "operator" },
    account: { userId: "u-11", roles: ["viewer", "operator"] },
    rights: FULL_RIGHTS,
    renderers: REGISTERED_RENDERERS,
    liveTransport: { kind: "in-process" },
    providers: [
      { kind: "control-plane", health: "ok" },
      { kind: "storage", health: "ok" },
      { kind: "queue-cache", health: "ok" },
      {
        kind: "compute",
        health: "down",
        detail: "compute adapter reports provider unreachable",
      },
    ],
    quotas: [{ quotaId: "user.daily-renders", scope: "user", used: 1, limit: 10 }],
  },
  // 6. Provider-degraded: storage degraded with an operator-supplied meaning
  //    of the degradation (what it means for the user).
  "provider-degraded": {
    requestContext: { requestId: "req-pdeg-006" },
    session: { authenticated: true, valid: true, userId: "u-12", activeRole: "operator" },
    account: { userId: "u-12", roles: ["viewer", "operator"] },
    rights: FULL_RIGHTS,
    renderers: REGISTERED_RENDERERS,
    liveTransport: { kind: "in-process" },
    providers: [
      { kind: "control-plane", health: "ok" },
      {
        kind: "storage",
        health: "degraded",
        detail: "R2 free-tier guardrail at 85% of monthly Class A operations",
        degradedMeaning:
          "New batch rendering is admitted more slowly; existing playback is unaffected.",
      },
      { kind: "queue-cache", health: "ok" },
      { kind: "compute", health: "ok" },
    ],
    quotas: [{ quotaId: "user.daily-renders", scope: "user", used: 4, limit: 10 }],
  },
  // 7. Live-unavailable (Simulation F): the in-process transport must NEVER
  //    be reported as live-network — the honest response is an unavailable
  //    live mode with in-process-transport-not-live.
  "live-unavailable": {
    requestContext: { requestId: "req-live-007" },
    session: { authenticated: true, valid: true, userId: "u-13", activeRole: "viewer" },
    account: { userId: "u-13", roles: ["viewer"] },
    rights: FULL_RIGHTS,
    renderers: REGISTERED_RENDERERS,
    liveTransport: { kind: "in-process" },
    providers: HEALTHY_PROVIDERS,
    quotas: [],
  },
  // 8. Partial availability: one renderer available, one unregistered, one
  //    registry-degraded → overall degraded, entries carry their own states.
  "partial-availability": {
    requestContext: { requestId: "req-partial-008" },
    session: { authenticated: true, valid: true, userId: "u-14", activeRole: "analyst" },
    account: { userId: "u-14", roles: ["viewer", "analyst"] },
    rights: FULL_RIGHTS,
    renderers: [
      REGISTERED_RENDERERS[0],
      {
        rendererId: "broadcast-enhanced.prototype",
        rendererVersion: "0.1.0",
        rendererClass: "stylized-video",
        requiresSourceFrames: true,
        registryStatus: "unregistered",
        dependsOnProviders: [],
      },
      {
        rendererId: "avatar-field.prototype",
        rendererVersion: "0.2.0",
        rendererClass: "procedural-3d",
        requiresSourceFrames: false,
        registryStatus: "degraded",
        dependsOnProviders: [],
      },
    ],
    liveTransport: { kind: "none" },
    providers: HEALTHY_PROVIDERS,
    quotas: [{ quotaId: "user.daily-renders", scope: "user", used: 3, limit: 10 }],
  },
};

mkdirSync(OUT_DIR, { recursive: true });
for (const [name, input] of Object.entries(SCENARIOS)) {
  const response = buildCapabilityResponse(input);
  const bytes = `${serializeCapabilityResponse(response)}\n`;
  writeFileSync(join(OUT_DIR, `${name}.json`), bytes);
  console.log(
    `${name}.json: overall=${response.overall.state} renderers=${response.renderers.map((r) => `${r.rendererId}:${r.availability}`).join(", ")}`,
  );
}
console.log(`wrote ${Object.keys(SCENARIOS).length} fixtures to ${OUT_DIR}`);
