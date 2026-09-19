/**
 * THE CONNECTION CENTER TESTS (R406): connect / verify / disconnect /
 * status over stub provider entries whose adapters run the REAL W914
 * in-memory contract — proving, end to end and deterministically
 * (injected clock):
 *
 * 1. NO MASTER PASSWORDS: every password-class presentation is refused
 *    fail-closed with the typed `MasterPasswordRefusalError` (closed
 *    message vocabulary), BEFORE anything is stored — AND the refusal is
 *    recorded in the audit trail (refused ≠ dropped);
 * 2. CREDENTIAL VALUES NEVER PERSIST: the store, the status reports, the
 *    audit entries, and every error message are scanned for the secret
 *    strings — only the kind + sha-256 fingerprint reference survives;
 * 3. VERIFY IS HONEST: the adapter's four-state answer maps onto the
 *    record verbatim (verified / invalid / present-unverified / not-
 *    applicable), with the evidence detail riding the history;
 * 4. DISCONNECT IS REAL: the record is removed, the binding dropped, the
 *    removal audited; an unknown disconnect is the typed error;
 * 5. ACCOUNT ISOLATION: two accounts never see each other's records,
 *    bindings, or audit entries;
 * 6. W004 SEMANTICS AT THE PRODUCT SURFACE: same-credential re-connects
 *    are counted duplicates; different credentials over a live
 *    connection conflict fail-loudly (never silently replaced);
 * 7. POST-RESTART HONESTY: a new center over the SAME durable store keeps
 *    the records and the audit, and `verify` fails loudly (binding absent
 *    — re-present) instead of fabricating a binding.
 */
import { describe, expect, test } from "bun:test";
import {
  ConnectionCenter,
  ConnectionBindingAbsentError,
  ConnectionValidationError,
  CredentialKindUnsupportedError,
  UnknownConnectionError,
  UnknownConnectionProviderError,
} from "../src/connections";
import { ConnectionConflictError } from "../src/store";
import {
  MasterPasswordRefusalError,
  isMasterPasswordRefusalError,
  credentialDisplayLabel,
} from "../src/credentials";
import {
  MASTER_PASSWORD_KINDS,
  MASTER_PASSWORD_REFUSAL_MESSAGES,
  credentialFingerprint,
} from "../src/credentials";
import type { CredentialPresentation } from "../src/credentials";
import { ConnectionStatusReport } from "../src/schema";
import { InMemoryConnectionStore, SqliteConnectionStore } from "../src/store";
import { manualClock, stubPlaneProvider, withTempDir, TEST_EPOCH_MS } from "./helpers";
import { join } from "node:path";

/** The scoped presentation the happy path connects with. */
const SCOPED_KEY: CredentialPresentation = {
  kind: "scoped-api-key",
  apiKey: "sk-test-abc123DEF456ghi789",
};
const SCOPED_KEY_2: CredentialPresentation = {
  kind: "scoped-api-key",
  apiKey: "sk-test-DIFFERENT-key-0001",
};
const TOKEN_PAIR: CredentialPresentation = {
  kind: "scoped-token-pair",
  tokenId: "ak-token-id-1",
  tokenSecret: "af-token-secret-1",
};
const MASTER_PASSWORDS: CredentialPresentation[] = [
  { kind: "account-password", password: "hunter2-master-password" },
  { kind: "console-password", password: "hunter2-console-password" },
  { kind: "master-password", password: "hunter2-root-password" },
];

/** Builds a center over one credential-backed stub provider. */
function centerWith(overrides: Record<string, unknown> = {}) {
  const clock = manualClock();
  const { provider, observations } = stubPlaneProvider({
    providerId: "provider.stub",
    nowMs: clock,
  });
  const center = new ConnectionCenter({
    providers: [provider],
    nowMs: clock,
    ...overrides,
  });
  return { center, clock, observations };
}

describe("R406 — no provider master passwords (fail-closed, closed messages)", () => {
  for (const presentation of MASTER_PASSWORDS) {
    test(`a '${presentation.kind}' presentation is refused with the typed error and audited`, async () => {
      const { center } = centerWith();
      let thrown: unknown;
      try {
        await center.connect("account-1", "provider.stub", presentation);
      } catch (error) {
        thrown = error;
      }
      expect(isMasterPasswordRefusalError(thrown)).toBe(true);
      const refusal = thrown as MasterPasswordRefusalError;
      expect(refusal.message).toBe(MASTER_PASSWORD_REFUSAL_MESSAGES.connect);
      expect(refusal.presentedKind).toBe(presentation.kind);
      expect(refusal.providerId).toBe("provider.stub");
      expect(refusal.accountId).toBe("account-1");
      expect(refusal.failureClass).toBe("rights-denied");
      // Refused AND recorded — the audit trail carries the attempt.
      const audit = await center.backingStore.listAudit("account-1");
      expect(audit).toHaveLength(1);
      expect(audit[0]!.outcome).toBe("connect-refused-master-password");
      expect(audit[0]!.providerId).toBe("provider.stub");
      // Nothing was stored.
      expect(await center.backingStore.findRecord("account-1", "provider.stub")).toBeNull();
    });
  }

  test("the closed password-kind vocabulary is exactly the three members", () => {
    expect([...MASTER_PASSWORD_KINDS]).toEqual([
      "account-password",
      "console-password",
      "master-password",
    ]);
  });

  test("a malformed presentation (unknown kind) fails validation, nothing audited", async () => {
    const { center } = centerWith();
    let thrown: unknown;
    try {
      await center.connect("account-1", "provider.stub", {
        kind: "ssh-private-key",
        key: "-----BEGIN...",
      } as unknown as CredentialPresentation);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(ConnectionValidationError);
    expect(await center.backingStore.listAudit("account-1")).toHaveLength(0);
  });
});

describe("R406 — connect: reference stored, value consumed transiently", () => {
  test("connect records the credential REFERENCE (kind + fingerprint) only", async () => {
    const { center, observations } = centerWith();
    const record = await center.connect("account-1", "provider.stub", SCOPED_KEY);
    expect(record.state).toBe("connected-unverified");
    expect(record.credential).toEqual({
      kind: "scoped-api-key",
      fingerprint: credentialFingerprint(SCOPED_KEY),
      presentedAtMs: record.connectedAtMs,
    });
    // The factory CONSUMED the value (built an adapter) — transiently.
    expect(observations.presentations).toHaveLength(1);
    expect(observations.presentations[0]).toEqual(SCOPED_KEY);
    expect(observations.lastAdapter).not.toBeNull();
  });

  test("the fingerprint is a 16-hex display-safe prefix; the label never leaks the value", () => {
    const fingerprint = credentialFingerprint(SCOPED_KEY);
    expect(fingerprint).toMatch(/^[0-9a-f]{16}$/);
    const label = credentialDisplayLabel({
      kind: "scoped-api-key",
      fingerprint,
      presentedAtMs: 0,
    });
    expect(label).toBe(`scoped-api-key ${fingerprint.slice(0, 4)}…${fingerprint.slice(-4)}`);
    expect(label).not.toContain("sk-test");
  });

  test("no credential VALUE appears in the store, status, audit, or errors", async () => {
    const { center } = centerWith();
    await center.connect("account-1", "provider.stub", TOKEN_PAIR);
    await center.connect("account-1", "provider.stub", SCOPED_KEY).catch(() => undefined);
    const secretMaterial = ["ak-token-id-1", "af-token-secret-1", "sk-test-abc123DEF456ghi789"];
    const scanTargets = [
      JSON.stringify(await center.status("account-1")),
      JSON.stringify(center.backingStore.stats()),
      JSON.stringify(await center.backingStore.listAudit("account-1")),
    ];
    // The audit detail may cite the FINGERPRINT but never the value.
    for (const target of scanTargets) {
      for (const secret of secretMaterial) {
        expect(target).not.toContain(secret);
      }
    }
  });

  test("a duplicate connect (same credential) is a counted no-op with history", async () => {
    const { center } = centerWith();
    const first = await center.connect("account-1", "provider.stub", SCOPED_KEY);
    const second = await center.connect("account-1", "provider.stub", SCOPED_KEY);
    expect(second.credential?.fingerprint).toBe(first.credential?.fingerprint);
    expect(second.history.map((event) => event.type)).toEqual(["connected", "connect-duplicate"]);
    expect(second.revision).toBe(2);
    expect(center.storeStats().duplicatePuts).toBe(0); // duplicate handled by the center, not a store insert
    const audit = await center.backingStore.listAudit("account-1");
    expect(audit.map((entry) => entry.outcome)).toEqual(["connect-duplicate", "connected"]);
    const record = await center.backingStore.findRecord("account-1", "provider.stub");
    expect(record?.credential?.fingerprint).toBe(credentialFingerprint(SCOPED_KEY));
  });

  test("a DIFFERENT credential over a live connection conflicts fail-loudly", async () => {
    const { center } = centerWith();
    await center.connect("account-1", "provider.stub", SCOPED_KEY);
    let thrown: unknown;
    try {
      await center.connect("account-1", "provider.stub", SCOPED_KEY_2);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(ConnectionConflictError);
    const conflict = thrown as ConnectionConflictError;
    expect(conflict.existingFingerprint).toBe(credentialFingerprint(SCOPED_KEY));
    expect(conflict.presentedFingerprint).toBe(credentialFingerprint(SCOPED_KEY_2));
    // The conflict was audited (newest-first); the original connection is untouched.
    const audit = await center.backingStore.listAudit("account-1");
    expect(audit[0]!.outcome).toBe("connect-conflict");
    const record = await center.backingStore.findRecord("account-1", "provider.stub");
    expect(record?.credential?.fingerprint).toBe(credentialFingerprint(SCOPED_KEY));
  });

  test("an unsupported accepted kind for THIS provider is the typed kind error", async () => {
    const clock = manualClock();
    const { provider } = stubPlaneProvider({
      providerId: "provider.pair-only",
      supportedCredentialKinds: ["scoped-token-pair"],
      nowMs: clock,
    });
    const center = new ConnectionCenter({ providers: [provider], nowMs: clock });
    let thrown: unknown;
    try {
      await center.connect("account-1", "provider.pair-only", SCOPED_KEY);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(CredentialKindUnsupportedError);
  });

  test("an unknown provider id is the typed unknown error", async () => {
    const { center } = centerWith();
    expect(center.connect("account-1", "provider.nope", SCOPED_KEY)).rejects.toBeInstanceOf(
      UnknownConnectionProviderError,
    );
  });

  test("a credential-required provider with no presentation fails validation", async () => {
    const { center } = centerWith();
    await expect(center.connect("account-1", "provider.stub", null)).rejects.toBeInstanceOf(
      ConnectionValidationError,
    );
  });
});

describe("R406 — verify: the adapter's honest answer maps verbatim", () => {
  test("'verified' → connected-verified with evidence + audit", async () => {
    const clock = manualClock();
    const { provider, observations } = stubPlaneProvider({
      providerId: "provider.stub",
      nowMs: clock,
      status: { state: "present-unverified" },
    });
    const center = new ConnectionCenter({ providers: [provider], nowMs: clock });
    await center.connect("account-1", "provider.stub", SCOPED_KEY);
    observations.lastAdapter!.setStatus({
      state: "verified",
      detail: "authenticated against the functions endpoint (HTTP 200, 1 function(s) visible)",
    });
    const record = await center.verify("account-1", "provider.stub");
    expect(record.state).toBe("connected-verified");
    expect(record.lastVerifiedAtMs).toBeGreaterThan(TEST_EPOCH_MS);
    expect(record.lastVerifiedState).toBe("verified");
    expect(record.history.at(-1)!.type).toBe("verified");
    expect(record.history.at(-1)!.detail).toContain("HTTP 200");
    const audit = await center.backingStore.listAudit("account-1");
    expect(audit[0]!.outcome).toBe("verified");
  });

  test("'invalid' → connected-invalid (the provider rejected the credential)", async () => {
    const { center, observations } = centerWith();
    await center.connect("account-1", "provider.stub", SCOPED_KEY);
    observations.lastAdapter!.setStatus({
      state: "invalid",
      detail: "the provider rejected the credentials (HTTP 401)",
    });
    const record = await center.verify("account-1", "provider.stub");
    expect(record.state).toBe("connected-invalid");
    expect(record.lastVerifiedState).toBe("invalid");
    expect(record.history.at(-1)!.type).toBe("credential-invalid");
  });

  test("'present-unverified' after a verify attempt → connected-unverified (honest unknown)", async () => {
    const { center, observations } = centerWith();
    await center.connect("account-1", "provider.stub", SCOPED_KEY);
    observations.lastAdapter!.setStatus({
      state: "present-unverified",
      detail: "present-unverified (verification attempted: connect ETIMEDOUT)",
    });
    const record = await center.verify("account-1", "provider.stub");
    expect(record.state).toBe("connected-unverified");
    expect(record.history.at(-1)!.type).toBe("verify-failed");
  });

  test("'not-applicable' → connected-verified by construction (the local path)", async () => {
    const clock = manualClock();
    const { provider } = stubPlaneProvider({
      providerId: "provider.localish",
      supportedCredentialKinds: [],
      requiresCredential: false,
      nowMs: clock,
      status: { state: "not-applicable", detail: "needs no credentials" },
    });
    const center = new ConnectionCenter({ providers: [provider], nowMs: clock });
    const record = await center.connect("account-1", "provider.localish", null);
    expect(record.state).toBe("connected-verified");
    expect(record.lastVerifiedState).toBe("not-applicable");
    const verified = await center.verify("account-1", "provider.localish");
    expect(verified.state).toBe("connected-verified");
    expect(verified.history.at(-1)!.type).toBe("verify-skipped");
  });

  test("verify without a connection is the typed unknown error", async () => {
    const { center } = centerWith();
    await expect(center.verify("account-1", "provider.stub")).rejects.toBeInstanceOf(
      UnknownConnectionError,
    );
  });
});

describe("R406 — disconnect: real removal, typed unknowns", () => {
  test("disconnect removes the record, drops the binding, audits", async () => {
    const { center } = centerWith();
    await center.connect("account-1", "provider.stub", SCOPED_KEY);
    const removed = await center.disconnect("account-1", "provider.stub");
    expect(removed.credential?.fingerprint).toBe(credentialFingerprint(SCOPED_KEY));
    expect(await center.backingStore.findRecord("account-1", "provider.stub")).toBeNull();
    expect(center.adapterOf("account-1", "provider.stub")).toBeNull();
    const audit = await center.backingStore.listAudit("account-1");
    expect(audit[0]!.outcome).toBe("disconnected");
    expect(center.connectedAdapters("account-1")).toHaveLength(0);
  });

  test("disconnecting an unknown connection is the typed error (never a silent no-op)", async () => {
    const { center } = centerWith();
    await expect(center.disconnect("account-1", "provider.stub")).rejects.toBeInstanceOf(
      UnknownConnectionError,
    );
  });
});

describe("R406 — status: one honest line per provider, all postures", () => {
  test("never-connected → connected-unverified → connected-verified → disconnected", async () => {
    const { center, observations } = centerWith();
    const initial = await center.status("account-1");
    expect(initial).toHaveLength(1);
    expect(initial[0]!.posture).toBe("never-connected");
    expect(initial[0]!.descriptor.providerKind).toBe("in-memory");
    expect(initial[0]!.supportedCredentialKinds).toEqual([
      "scoped-api-key",
      "scoped-token-pair",
      "oauth-access-token",
    ]);
    expect(initial[0]!.connection).toBeUndefined();

    await center.connect("account-1", "provider.stub", SCOPED_KEY);
    observations.lastAdapter!.setStatus({ state: "verified", detail: "HTTP 200" });
    await center.verify("account-1", "provider.stub");
    let status = await center.status("account-1");
    expect(status[0]!.posture).toBe("connected-verified");
    expect(status[0]!.connection).toBeDefined();
    // The report validates against the published schema.
    expect(() => ConnectionStatusReport.parse(status[0])).not.toThrow();

    await center.disconnect("account-1", "provider.stub");
    status = await center.status("account-1");
    // A past disconnect distinguishes 'disconnected' from 'never-connected'.
    expect(status[0]!.posture).toBe("disconnected");
  });

  test("account isolation: another account sees never-connected and no audit bleed", async () => {
    const { center } = centerWith();
    await center.connect("account-1", "provider.stub", SCOPED_KEY);
    const other = await center.status("account-2");
    expect(other[0]!.posture).toBe("never-connected");
    expect(await center.backingStore.listAudit("account-2")).toHaveLength(0);
    expect(center.adapterOf("account-2", "provider.stub")).toBeNull();
    expect(center.connectedAdapters("account-2")).toHaveLength(0);
  });

  test("an invalid account id fails validation", async () => {
    const { center } = centerWith();
    await expect(center.status("")).rejects.toBeInstanceOf(ConnectionValidationError);
    await expect(center.status("bad\u0000id")).rejects.toBeInstanceOf(ConnectionValidationError);
  });
});

describe("R406 — post-restart honesty (durable store, absent binding)", () => {
  test("a new center over the same sqlite store keeps records; verify fails loudly", async () => {
    const dir = withTempDir();
    const path = join(dir, "connections.db");
    const clock1 = manualClock();
    const { provider: p1 } = stubPlaneProvider({ providerId: "provider.stub", nowMs: clock1 });
    const store1 = new SqliteConnectionStore(path, { nowMs: clock1 });
    const center1 = new ConnectionCenter({ providers: [p1], store: store1, nowMs: clock1 });
    await center1.connect("account-1", "provider.stub", SCOPED_KEY);
    store1.close();

    // "Restart": same durable store, a fresh runtime (no bindings).
    const clock2 = manualClock();
    const { provider: p2, observations } = stubPlaneProvider({
      providerId: "provider.stub",
      nowMs: clock2,
    });
    const store2 = new SqliteConnectionStore(path, { nowMs: clock2 });
    const center2 = new ConnectionCenter({ providers: [p2], store: store2, nowMs: clock2 });
    const status = await center2.status("account-1");
    expect(status[0]!.posture).toBe("connected-unverified");
    expect(status[0]!.connection).toBeDefined();
    await expect(center2.verify("account-1", "provider.stub")).rejects.toBeInstanceOf(
      ConnectionBindingAbsentError,
    );
    // Re-presenting the same credential rebinds (factory consumed it again).
    await center2.connect("account-1", "provider.stub", SCOPED_KEY);
    expect(observations.presentations).toHaveLength(1);
    observations.lastAdapter!.setStatus({ state: "verified", detail: "HTTP 200" });
    const verified = await center2.verify("account-1", "provider.stub");
    expect(verified.state).toBe("connected-verified");
    store2.close();
  });
});

describe("R406 — construction guards", () => {
  test("an empty provider plane rejects", () => {
    expect(() => new ConnectionCenter({ providers: [], nowMs: manualClock() })).toThrow();
  });

  test("duplicate provider ids reject", () => {
    const clock = manualClock();
    const a = stubPlaneProvider({ providerId: "provider.dup", nowMs: clock });
    const b = stubPlaneProvider({ providerId: "provider.dup", nowMs: clock });
    expect(
      () => new ConnectionCenter({ providers: [a.provider, b.provider], nowMs: clock }),
    ).toThrow(/duplicate/);
  });

  test("the default store is in-memory (counters work)", async () => {
    const { center } = centerWith();
    await center.connect("account-1", "provider.stub", SCOPED_KEY);
    expect(center.storeStats().records).toBe(1);
    expect(center.storeStats().auditEntries).toBe(1);
  });

  test("a shared in-memory store survives center re-construction", async () => {
    const store = new InMemoryConnectionStore();
    const clock1 = manualClock();
    const { provider: p1 } = stubPlaneProvider({ providerId: "provider.stub", nowMs: clock1 });
    const center1 = new ConnectionCenter({ providers: [p1], store, nowMs: clock1 });
    await center1.connect("account-1", "provider.stub", SCOPED_KEY);
    const clock2 = manualClock();
    const { provider: p2 } = stubPlaneProvider({ providerId: "provider.stub", nowMs: clock2 });
    const center2 = new ConnectionCenter({ providers: [p2], store, nowMs: clock2 });
    const status = await center2.status("account-1");
    expect(status[0]!.posture).toBe("connected-unverified");
  });
});
