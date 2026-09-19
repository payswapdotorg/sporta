/**
 * THE RECORDED-FIXTURE TIER (R406 over the REAL Modal adapter): consumes
 * the pins committed under `packages/compute-provider-adapters/fixtures/`
 * (never re-recording them) to prove the connection center's `connect` →
 * `verify` flow against the REAL `ModalComputeAdapter` REST mapping:
 *
 * - `verify-credentials-ok` → the adapter's monitor flips `verified` →
 *   the connection record transitions `connected-verified`;
 * - `verify-credentials-401` → the provider rejected the credentials →
 *   `connected-invalid` (an observed 401 is a REJECTION, never a lie);
 * - `verify-credentials-network-error` → verification could not
 *   complete → `connected-unverified` (an unreachable provider proves
 *   nothing — the honest unknown);
 * - the credential VALUE never appears in the store, the status report,
 *   or the audit trail (the fingerprint reference only);
 * - the pre-network gate: a master-password presentation is refused with
 *   ZERO transport calls (fail-closed BEFORE the network).
 */
import { describe, expect, test } from "bun:test";
import { ModalComputeAdapter, MODAL_ADAPTER_ID } from "@sporta/compute-provider-adapters";
import { ConnectionCenter } from "../src/connections";
import type { ConnectionPlaneProvider } from "../src/connections";
import { ReplayTransport, loadProviderFixture, manualClock } from "./helpers";
import type { PinnedFixture } from "./helpers";

/** The scoped token pair this tier connects with (a fixture-local secret). */
const TOKEN_PAIR = {
  kind: "scoped-token-pair" as const,
  tokenId: "ak-fixture-token-id",
  tokenSecret: "af-fixture-token-secret",
};

/** The Modal provider entry (DATA + a factory that injects the transport). */
function modalProvider(fixtures: PinnedFixture[]): {
  provider: ConnectionPlaneProvider;
  transport: ReplayTransport;
} {
  const transport = new ReplayTransport(fixtures);
  const provider: ConnectionPlaneProvider = {
    providerId: MODAL_ADAPTER_ID,
    supportedCredentialKinds: ["scoped-token-pair"],
    requiresCredential: true,
    createAdapter: (presentation) =>
      new ModalComputeAdapter({
        tokenId: presentation?.kind === "scoped-token-pair" ? presentation.tokenId : "",
        tokenSecret: presentation?.kind === "scoped-token-pair" ? presentation.tokenSecret : "",
        nowMs: manualClock(),
        fetchFn: transport.fetch,
        callTimeoutMs: 1_000,
      }),
  };
  return { provider, transport };
}

/** A center over the fixture-backed Modal plane. */
function centerOver(fixtures: PinnedFixture[]) {
  const clock = manualClock();
  const { provider, transport } = modalProvider(fixtures);
  const center = new ConnectionCenter({ providers: [provider], nowMs: clock });
  return { center, transport };
}

describe("R406 — the recorded-fixture tier over the REAL Modal adapter", () => {
  test("verify-credentials-ok: a REAL authenticated GET flips the record to verified", async () => {
    const { center, transport } = centerOver([
      loadProviderFixture("modal", "verify-credentials-ok"),
    ]);
    const record = await center.connect("account-1", MODAL_ADAPTER_ID, TOKEN_PAIR);
    expect(record.state).toBe("connected-unverified");
    const verified = await center.verify("account-1", MODAL_ADAPTER_ID);
    expect(verified.state).toBe("connected-verified");
    expect(verified.lastVerifiedState).toBe("verified");
    expect(verified.history.at(-1)!.type).toBe("verified");
    expect(verified.history.at(-1)!.detail).toContain("HTTP 200");
    // The pinned request: ONE authenticated GET against /v1/functions.
    expect(transport.callCount).toBe(1);
    // The credential VALUE never rode the audit or the store.
    const audit = JSON.stringify(await center.backingStore.listAudit("account-1"));
    expect(audit).not.toContain("af-fixture-token-secret");
    expect(audit).not.toContain("ak-fixture-token-id");
  });

  test("verify-credentials-401: an observed rejection is connected-invalid (never a lie)", async () => {
    const { center } = centerOver([loadProviderFixture("modal", "verify-credentials-401")]);
    await center.connect("account-1", MODAL_ADAPTER_ID, TOKEN_PAIR);
    const invalid = await center.verify("account-1", MODAL_ADAPTER_ID);
    expect(invalid.state).toBe("connected-invalid");
    expect(invalid.lastVerifiedState).toBe("invalid");
    expect(invalid.history.at(-1)!.type).toBe("credential-invalid");
  });

  test("verify-credentials-network-error: the honest unknown stays unverified", async () => {
    const { center } = centerOver([
      loadProviderFixture("modal", "verify-credentials-network-error"),
    ]);
    await center.connect("account-1", MODAL_ADAPTER_ID, TOKEN_PAIR);
    const unverified = await center.verify("account-1", MODAL_ADAPTER_ID);
    expect(unverified.state).toBe("connected-unverified");
    expect(unverified.history.at(-1)!.type).toBe("verify-failed");
    // The status report is honest: still connected, not verified.
    const status = await center.status("account-1");
    expect(status[0]!.posture).toBe("connected-unverified");
  });

  test("a master-password presentation is refused with ZERO transport calls", async () => {
    const { center, transport } = centerOver([
      loadProviderFixture("modal", "verify-credentials-ok"),
    ]);
    await expect(
      center.connect("account-1", MODAL_ADAPTER_ID, {
        kind: "master-password",
        password: "modal-account-password",
      }),
    ).rejects.toThrow(/master\/console passwords are never accepted/);
    // Fail-closed BEFORE the network: the fixture was never consumed.
    expect(transport.callCount).toBe(0);
    expect(await center.backingStore.findRecord("account-1", MODAL_ADAPTER_ID)).toBeNull();
  });

  test("the status descriptor is the adapter's REAL descriptor (managed-actor, offline)", async () => {
    const { center } = centerOver([]);
    const status = await center.status("account-1");
    expect(status[0]!.providerId).toBe(MODAL_ADAPTER_ID);
    expect(status[0]!.descriptor.providerKind).toBe("managed-actor");
    expect(status[0]!.descriptor.supportedLatencyClasses).toEqual(["offline"]);
    expect(status[0]!.supportedCredentialKinds).toEqual(["scoped-token-pair"]);
  });
});
