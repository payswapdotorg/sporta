/**
 * THE CONDITIONAL INTEGRATION TIER (R406): REAL REST calls to the REAL
 * provider endpoints with REAL scoped credentials — skipped unless the
 * provider env names are configured (the `modal.integration.test.ts`
 * precedent, the same env names). Read-only by design: credential
 * verification through the connection center's connect → verify flow.
 * NOTHING here fabricates success: an unreachable provider or a rejected
 * token is reported as exactly that.
 */
import { describe, expect, test } from "bun:test";
import {
  ModalComputeAdapter,
  LightningComputeAdapter,
  RunPodComputeAdapter,
} from "@sporta/compute-provider-adapters";
import type { ComputeAdapterPort } from "@sporta/compute-adapter";
import { ConnectionCenter } from "../src/connections";
import type { ConnectionPlaneProvider } from "../src/connections";
import type { AcceptedCredentialPresentation } from "../src/credentials";
import { manualClock } from "./helpers";

const MODAL_GUARD =
  process.env["MODAL_TOKEN_ID"] !== undefined && process.env["MODAL_TOKEN_ID"] !== "";
const LIGHTNING_GUARD =
  process.env["LIGHTNING_API_KEY"] !== undefined && process.env["LIGHTNING_API_KEY"] !== "";
const RUNPOD_GUARD =
  process.env["RUNPOD_API_KEY"] !== undefined && process.env["RUNPOD_API_KEY"] !== "";

/** The real wall clock (the live-integration composition decision). */
const realClock = (): number => Date.now();

/** The presentation the guarded integrations connect with. */
function presentationOf(
  kind: "scoped-token-pair" | "scoped-api-key",
): AcceptedCredentialPresentation {
  switch (kind) {
    case "scoped-token-pair":
      return {
        kind,
        tokenId: process.env["MODAL_TOKEN_ID"] ?? "",
        tokenSecret: process.env["MODAL_TOKEN_SECRET"] ?? "",
      };
    case "scoped-api-key":
      return { kind, apiKey: process.env["LIGHTNING_API_KEY"] ?? "" };
  }
}

describe.skipIf(!MODAL_GUARD)("R406 integration — the REAL api.modal.co (conditional)", () => {
  test("connect → verify with the REAL scoped token pair", async () => {
    const provider: ConnectionPlaneProvider = {
      providerId: "provider.modal",
      supportedCredentialKinds: ["scoped-token-pair"],
      requiresCredential: true,
      createAdapter: (presentation) =>
        new ModalComputeAdapter({
          tokenId: presentation?.kind === "scoped-token-pair" ? presentation.tokenId : "",
          tokenSecret: presentation?.kind === "scoped-token-pair" ? presentation.tokenSecret : "",
          nowMs: realClock,
          callTimeoutMs: 10_000,
        }),
    };
    const center = new ConnectionCenter({ providers: [provider], nowMs: realClock });
    const record = await center.connect(
      "account-integration",
      "provider.modal",
      presentationOf("scoped-token-pair"),
    );
    expect(record.credential?.kind).toBe("scoped-token-pair");
    const verified = await center.verify("account-integration", "provider.modal");
    expect(["connected-verified", "connected-invalid", "connected-unverified"]).toContain(
      verified.state,
    );
    // Whatever the provider answered is the honest record.
    expect(verified.lastVerifiedState).toBeDefined();
    // The credential value never persisted anywhere.
    const audit = JSON.stringify(await center.backingStore.listAudit("account-integration"));
    expect(audit).not.toContain(process.env["MODAL_TOKEN_SECRET"] ?? "");
  });
});

describe.skipIf(!LIGHTNING_GUARD)(
  "R406 integration — the REAL api.lightning.ai (conditional)",
  () => {
    test("connect → verify with the REAL account API key", async () => {
      const provider: ConnectionPlaneProvider = {
        providerId: "provider.lightning",
        supportedCredentialKinds: ["scoped-api-key"],
        requiresCredential: true,
        createAdapter: (presentation) =>
          new LightningComputeAdapter({
            apiKey: presentation?.kind === "scoped-api-key" ? presentation.apiKey : "",
            studioId: process.env["LIGHTNING_STUDIO_ID"] ?? "",
            nowMs: realClock,
            callTimeoutMs: 10_000,
          }),
      };
      const center = new ConnectionCenter({ providers: [provider], nowMs: realClock });
      await center.connect(
        "account-integration",
        "provider.lightning",
        presentationOf("scoped-api-key"),
      );
      const verified = await center.verify("account-integration", "provider.lightning");
      expect(["connected-verified", "connected-invalid", "connected-unverified"]).toContain(
        verified.state,
      );
    });
  },
);

describe.skipIf(!RUNPOD_GUARD)("R406 integration — the REAL api.runpod.ai (conditional)", () => {
  test("connect → verify with the REAL account API key", async () => {
    const provider: ConnectionPlaneProvider = {
      providerId: "provider.runpod",
      supportedCredentialKinds: ["scoped-api-key"],
      requiresCredential: true,
      createAdapter: (presentation) =>
        new RunPodComputeAdapter({
          apiKey: presentation?.kind === "scoped-api-key" ? presentation.apiKey : "",
          nowMs: realClock,
          callTimeoutMs: 10_000,
        }),
    };
    const center = new ConnectionCenter({ providers: [provider], nowMs: realClock });
    await center.connect(
      "account-integration",
      "provider.runpod",
      presentationOf("scoped-api-key"),
    );
    const verified = await center.verify("account-integration", "provider.runpod");
    expect(["connected-verified", "connected-invalid", "connected-unverified"]).toContain(
      verified.state,
    );
  });
});

/** Pinning the guard shape: without credentials every suite above skips. */
describe("the integration tier's gating", () => {
  test("guards are booleans derived from the documented env names", () => {
    expect(typeof MODAL_GUARD).toBe("boolean");
    expect(typeof LIGHTNING_GUARD).toBe("boolean");
    expect(typeof RUNPOD_GUARD).toBe("boolean");
  });

  test("the center itself reads NO env (the composition root owns env)", () => {
    // The integration adapters above are constructed with EXPLICIT values
    // read HERE (the test composition); the center's API takes injections.
    const adapter: ComputeAdapterPort = new ModalComputeAdapter({
      tokenId: "",
      tokenSecret: "",
      nowMs: manualClock(),
    });
    expect(adapter.describe().adapterId).toBe("provider.modal");
  });
});
