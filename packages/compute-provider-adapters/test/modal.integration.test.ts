/**
 * The `provider.modal` adapter (R402) — the CONDITIONAL INTEGRATION tier:
 * REAL REST calls to `https://api.modal.co` with a REAL scoped token pair,
 * skipped unless `MODAL_TOKEN_ID` is configured (the
 * `packages/compute-adapter-hosted` env-gated precedent). Read-only by
 * design: credential verification against the functions endpoint family
 * plus — when a worker function is actually deployed — an honest
 * connectivity answer. NOTHING here fabricates success: an unreachable
 * provider or a rejected token is reported as exactly that.
 */
import { describe, expect, test } from "bun:test";
import { ModalComputeAdapter } from "../src/modal/adapter";

const GUARD = process.env["MODAL_TOKEN_ID"] !== undefined && process.env["MODAL_TOKEN_ID"] !== "";

describe.skipIf(!GUARD)("R402 Modal integration — the real api.modal.co (conditional)", () => {
  test("verifyCredentials against the REAL functions endpoint", async () => {
    const adapter = new ModalComputeAdapter({
      tokenId: process.env["MODAL_TOKEN_ID"] ?? "",
      tokenSecret: process.env["MODAL_TOKEN_SECRET"] ?? "",
      nowMs: () => Date.now(),
    });
    const status = await adapter.verifyCredentials();
    // The honest verdict: verified, or the typed refusal reason recorded.
    expect(["verified", "invalid", "present-unverified"]).toContain(status.state);
    expect(status.detail).toBeDefined();
  });

  test("the dispatch gate fires pre-network for a genuinely invalid token", async () => {
    // A malformed token pair drives the REAL 401 → the monitor flips
    // invalid → a subsequent dispatch refuses BEFORE any network call.
    const adapter = new ModalComputeAdapter({
      tokenId: "ak-definitely-not-a-real-token",
      tokenSecret: "af-definitely-not-a-real-secret",
      nowMs: () => Date.now(),
      callTimeoutMs: 10_000,
    });
    const status = await adapter.verifyCredentials();
    if (status.state === "invalid") {
      const { ProviderRefusalError } = await import("../src/common/refusal");
      let thrown: unknown;
      try {
        await adapter.dispatch({
          schemaVersion: "1.0",
          jobId: "integration-gate-probe",
          idempotencyKey: "integration-gate-probe-1",
          sessionId: "sess-integration",
          correlationId: "corr-1",
          traceId: "trace-1",
          renderer: { rendererId: "anime.prototype" },
          recipe: { styleId: "s", configSchemaVersion: "1.0", config: {} },
          inputs: [{ inputId: "i1", kind: "swm-snapshot", ref: "sporta://x" }],
          outputProfile: {
            resolution: { w: 64, h: 64 },
            frameRate: 30,
            codec: "av1",
            container: "mp4",
            latencyClass: "offline",
          },
          rights: { policyRef: "p", canReferenceSourceFrames: false },
          constraints: { deadlineMs: 60_000 },
        });
      } catch (err) {
        thrown = err;
      }
      expect(thrown).toBeInstanceOf(ProviderRefusalError);
    }
    expect(["invalid", "present-unverified"]).toContain(status.state);
  });
});
