/**
 * Session service tests (W902): opaque-token issuance, hashed-at-rest storage,
 * injected-clock expiry, revocation, and the presentation-only active role.
 */
import { describe, expect, test } from "bun:test";
import {
  InMemorySessionStore,
  SESSION_TOKEN_BYTES,
  SessionService,
  createSequentialEntropySource,
  defaultEntropySource,
  sha256Hex,
  toBase64Url,
} from "../src/index";

function sequentialClock(): { nowMs: () => number; advance: (ms: number) => void } {
  let t = 1_000_000;
  return { nowMs: () => t, advance: (ms) => (t += ms) };
}

describe("token encoding + hashing", () => {
  test("base64url encodes RFC 4648 test vectors (unpadded)", () => {
    expect(toBase64Url(new Uint8Array([]))).toBe("");
    expect(toBase64Url(new Uint8Array([0xff, 0xef, 0xff]))).toBe("_-__"); // 3 bytes → 4 chars
    expect(toBase64Url(new Uint8Array([0xfb, 0xff]))).toBe("-_8"); // 2 bytes → 3 chars
    expect(toBase64Url(new Uint8Array([0x42]))).toBe("Qg"); // 1 byte → 2 chars
    expect(toBase64Url(new TextEncoder().encode("Man"))).toBe("TWFu");
  });

  test("sha256Hex matches the known digest of the empty string and 'abc'", async () => {
    expect(await sha256Hex("")).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
    expect(await sha256Hex("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });

  test("base64url output never contains +, /, or =", () => {
    for (let i = 0; i < 50; i += 1) {
      const bytes = defaultEntropySource.randomBytes(32);
      const encoded = toBase64Url(bytes);
      expect(encoded).toMatch(/^[A-Za-z0-9_-]+$/);
    }
  });
});

describe("session issuance", () => {
  test("a 32-byte-entropy token is 43 base64url characters", async () => {
    const store = new InMemorySessionStore();
    const service = new SessionService({
      store,
      entropy: defaultEntropySource,
      nowMs: () => 0,
    });
    const issued = await service.issue({ userId: "u-1" });
    expect(issued.token).toHaveLength(Math.ceil((SESSION_TOKEN_BYTES * 8) / 6)); // 256/6 → 43
    expect(issued.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  test("the store contains ONLY the hash — never the plaintext token", async () => {
    const store = new InMemorySessionStore();
    const service = new SessionService({ store, entropy: defaultEntropySource, nowMs: () => 0 });
    const issued = await service.issue({ userId: "u-1" });
    const records = await store.all();
    expect(records).toHaveLength(1);
    expect(records[0]!.tokenHash).toBe(await sha256Hex(issued.token));
    expect(JSON.stringify(records)).not.toContain(issued.token);
  });

  test("the record carries userId, issued/expires (now + TTL), null active role, no revocation", async () => {
    const store = new InMemorySessionStore();
    const service = new SessionService({ store, entropy: defaultEntropySource, nowMs: () => 1000 });
    const issued = await service.issue({ userId: "u-7" });
    expect(issued.record.userId).toBe("u-7");
    expect(issued.record.issuedAtMs).toBe(1000);
    expect(issued.record.expiresAtMs).toBe(1000 + 7 * 24 * 60 * 60 * 1000);
    expect(issued.record.activeRole).toBeNull();
    expect(issued.record.revokedAtMs).toBeNull();
  });

  test("ENTROPY DETERMINISM: the same injected source yields identical tokens; the real source never repeats", async () => {
    const a = new SessionService({
      store: new InMemorySessionStore(),
      entropy: createSequentialEntropySource(),
      nowMs: () => 0,
    });
    const b = new SessionService({
      store: new InMemorySessionStore(),
      entropy: createSequentialEntropySource(),
      nowMs: () => 0,
    });
    const first = await a.issue({ userId: "u-1" });
    const second = await b.issue({ userId: "u-1" });
    expect(second.token).toBe(first.token); // determinism: same injected entropy

    const real = new SessionService({
      store: new InMemorySessionStore(),
      entropy: defaultEntropySource,
      nowMs: () => 0,
    });
    const t1 = (await real.issue({ userId: "u-1" })).token;
    const t2 = (await real.issue({ userId: "u-1" })).token;
    expect(t1).not.toBe(t2); // the default source is REAL entropy
  });

  test("two sessions for the same user are independent records", async () => {
    const store = new InMemorySessionStore();
    const service = new SessionService({ store, entropy: defaultEntropySource, nowMs: () => 0 });
    const s1 = await service.issue({ userId: "u-1" });
    const s2 = await service.issue({ userId: "u-1" });
    expect((await store.all())).toHaveLength(2);
    expect(s1.token).not.toBe(s2.token);
  });
});

describe("session resolution (fail-closed)", () => {
  test("a live session resolves", async () => {
    const service = new SessionService({
      store: new InMemorySessionStore(),
      entropy: defaultEntropySource,
      nowMs: () => 0,
    });
    const issued = await service.issue({ userId: "u-1" });
    const record = await service.resolve(issued.token);
    expect(record?.userId).toBe("u-1");
  });

  test("an EXPIRED session resolves to null (injected clock advance)", async () => {
    const clock = sequentialClock();
    const service = new SessionService({
      store: new InMemorySessionStore(),
      entropy: defaultEntropySource,
      nowMs: clock.nowMs,
      ttlMs: 60_000,
    });
    const issued = await service.issue({ userId: "u-1" });
    expect(await service.resolve(issued.token)).not.toBeNull();
    clock.advance(59_999);
    expect(await service.resolve(issued.token)).not.toBeNull(); // still live at ttl-ε
    clock.advance(1);
    expect(await service.resolve(issued.token)).toBeNull(); // expiry is >=
  });

  test("a REVOKED session resolves to null; revocation is idempotent", async () => {
    const service = new SessionService({
      store: new InMemorySessionStore(),
      entropy: defaultEntropySource,
      nowMs: () => 0,
    });
    const issued = await service.issue({ userId: "u-1" });
    await service.revoke(issued.token);
    expect(await service.resolve(issued.token)).toBeNull();
    await service.revoke(issued.token); // idempotent
    await service.revoke("never-existed-token"); // unknown token: no throw
    expect(await service.resolve(issued.token)).toBeNull();
  });

  test("an unknown or empty token resolves to null (identical outcome)", async () => {
    const service = new SessionService({
      store: new InMemorySessionStore(),
      entropy: defaultEntropySource,
      nowMs: () => 0,
    });
    expect(await service.resolve("")).toBeNull();
    expect(await service.resolve("totally-unknown")).toBeNull();
  });

  test("revoked and expired and unknown are indistinguishable to the caller", async () => {
    const clock = sequentialClock();
    const service = new SessionService({
      store: new InMemorySessionStore(),
      entropy: defaultEntropySource,
      nowMs: clock.nowMs,
      ttlMs: 1000,
    });
    const revoked = await service.issue({ userId: "u-1" });
    await service.revoke(revoked.token);
    const expired = await service.issue({ userId: "u-2" });
    clock.advance(2000);
    const outcomes = await Promise.all([
      service.resolve(revoked.token),
      service.resolve(expired.token),
      service.resolve("unknown"),
    ]);
    expect(outcomes).toEqual([null, null, null]);
  });
});

describe("role switching is PRESENTATION ONLY (never a grant)", () => {
  test("switching a held role updates the session's activeRole only", async () => {
    const service = new SessionService({
      store: new InMemorySessionStore(),
      entropy: defaultEntropySource,
      nowMs: () => 0,
    });
    const issued = await service.issue({ userId: "u-1" });
    const updated = await service.switchRole(issued.token, "creator", ["viewer", "creator"]);
    expect(updated.activeRole).toBe("creator");
    const resolved = await service.resolve(issued.token);
    expect(resolved?.activeRole).toBe("creator");
  });

  test("switching a role the account does NOT hold is REFUSED", async () => {
    const service = new SessionService({
      store: new InMemorySessionStore(),
      entropy: defaultEntropySource,
      nowMs: () => 0,
    });
    const issued = await service.issue({ userId: "u-1" });
    await expect(
      service.switchRole(issued.token, "operator", ["viewer", "creator"]),
    ).rejects.toThrow(/never grants authority/);
    const resolved = await service.resolve(issued.token);
    expect(resolved?.activeRole).toBeNull(); // unchanged
  });

  test("switching on an expired or unknown session refuses", async () => {
    const clock = sequentialClock();
    const service = new SessionService({
      store: new InMemorySessionStore(),
      entropy: defaultEntropySource,
      nowMs: clock.nowMs,
      ttlMs: 1000,
    });
    const issued = await service.issue({ userId: "u-1" });
    clock.advance(2000);
    await expect(service.switchRole(issued.token, "viewer", ["viewer"])).rejects.toThrow(/expired/);
    await expect(service.switchRole("unknown-token", "viewer", ["viewer"])).rejects.toThrow(
      /no such session/,
    );
  });
});

describe("InMemorySessionStore port semantics", () => {
  test("duplicate creation refuses; unknown update refuses; clones in and out", async () => {
    const store = new InMemorySessionStore();
    const record = {
      tokenHash: "abc",
      userId: "u-1",
      issuedAtMs: 0,
      expiresAtMs: 1000,
      activeRole: null,
      revokedAtMs: null,
    };
    await store.create(record);
    await expect(store.create(record)).rejects.toThrow(/duplicate/);
    const read = await store.findByTokenHash("abc");
    read!.userId = "mutated";
    expect((await store.findByTokenHash("abc"))?.userId).toBe("u-1");
    await store.update({ ...record, activeRole: "viewer" });
    expect((await store.findByTokenHash("abc"))?.activeRole).toBe("viewer");
    await expect(
      store.update({ ...record, tokenHash: "nope" }),
    ).rejects.toThrow(/unknown token hash/);
  });
});
