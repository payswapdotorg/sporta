/**
 * The account model + persistence port tests (W902), plus the REAL argon2
 * password path (`Bun.password.hash`/`verify`).
 */
import { describe, expect, test } from "bun:test";
import type { Role } from "@sporta/capability";
import {
  AccountConflictError,
  AccountNotFoundError,
  InMemoryAccountStore,
  argon2PasswordHasher,
  createDeterministicTestHasher,
  toAccountSummary,
} from "../src/index";

const NEW = {
  username: "alice",
  email: undefined,
  passwordHash: "hash-placeholder",
  roles: ["viewer", "creator"] as Role[],
  createdAtIso: "2025-01-06T12:00:00.001Z",
};

describe("InMemoryAccountStore", () => {
  test("create assigns stable sequential ids and persists exactly what was given", async () => {
    const store = new InMemoryAccountStore();
    const a = await store.create(NEW);
    const b = await store.create({ ...NEW, username: "bob" });
    expect(a.userId).toBe("u-1");
    expect(b.userId).toBe("u-2");
    expect(a.username).toBe("alice");
    expect(a.roles).toEqual(["viewer", "creator"]);
  });

  test("a taken username conflicts", async () => {
    const store = new InMemoryAccountStore();
    await store.create(NEW);
    await expect(store.create(NEW)).rejects.toBeInstanceOf(AccountConflictError);
  });

  test("findByUsername and findByUserId resolve (case-exact) and miss with null", async () => {
    const store = new InMemoryAccountStore();
    const created = await store.create(NEW);
    expect((await store.findByUsername("alice"))?.userId).toBe(created.userId);
    expect(await store.findByUsername("Alice")).toBeNull(); // normalized keys are exact
    expect(await store.findByUsername("nobody")).toBeNull();
    expect((await store.findByUserId(created.userId))?.username).toBe("alice");
    expect(await store.findByUserId("u-999")).toBeNull();
  });

  test("handed-out records are deep clones (mutating them cannot corrupt the store)", async () => {
    const store = new InMemoryAccountStore();
    const created = await store.create(NEW);
    created.roles.push("operator");
    const reRead = await store.findByUserId(created.userId);
    expect(reRead?.roles).toEqual(["viewer", "creator"]);
  });

  test("update replaces grants and username atomically", async () => {
    const store = new InMemoryAccountStore();
    const created = await store.create(NEW);
    await store.update({ ...created, roles: ["viewer", "operator"] });
    expect((await store.findByUserId(created.userId))?.roles).toEqual(["viewer", "operator"]);
  });

  test("update of an unknown account throws; username conflict maps too", async () => {
    const store = new InMemoryAccountStore();
    await store.create(NEW);
    const bob = await store.create({ ...NEW, username: "bob" });
    await expect(store.update({ ...bob, userId: "u-404" })).rejects.toBeInstanceOf(
      AccountNotFoundError,
    );
    await expect(store.update({ ...bob, username: "alice" })).rejects.toBeInstanceOf(
      AccountConflictError,
    );
  });

  test("toAccountSummary never exposes the password hash", async () => {
    const store = new InMemoryAccountStore();
    const created = await store.create(NEW);
    const summary = toAccountSummary(created);
    expect(Object.keys(summary).sort()).toEqual([
      "createdAtIso",
      "email",
      "roles",
      "userId",
      "username",
    ]);
    expect(JSON.stringify(summary)).not.toContain("passwordHash");
  });
});

describe("the REAL argon2 password path (Bun.password)", () => {
  test("hash produces an argon2id string; verify accepts the right password", async () => {
    const hash = await argon2PasswordHasher.hash("correct horse battery staple");
    expect(hash.startsWith("$argon2")).toBe(true);
    await expect(argon2PasswordHasher.verify("correct horse battery staple", hash)).resolves.toBe(
      true,
    );
  });

  test("verify REJECTS a wrong password", async () => {
    const hash = await argon2PasswordHasher.hash("correct horse battery staple");
    await expect(argon2PasswordHasher.verify("wrong horse battery staple", hash)).resolves.toBe(
      false,
    );
  });

  test("hashes are salted (two hashes of one password differ) and not the plaintext", async () => {
    const password = "hunter-two-hunter-two";
    const hash1 = await argon2PasswordHasher.hash(password);
    const hash2 = await argon2PasswordHasher.hash(password);
    expect(hash1).not.toBe(hash2);
    expect(hash1).not.toContain(password);
  });
});

describe("the deterministic test hasher (test-only seam)", () => {
  test("hash/verify round-trip; wrong password denies; never contains the plaintext", async () => {
    const hasher = createDeterministicTestHasher();
    const hash = await hasher.hash("a-password-1234");
    await expect(hasher.verify("a-password-1234", hash)).resolves.toBe(true);
    await expect(hasher.verify("a-password-1235", hash)).resolves.toBe(false);
    expect(hash).not.toContain("a-password-1234");
    expect(hash.startsWith("test$")).toBe(true);
  });

  test("deterministic: the same password always hashes identically", async () => {
    const hasher = createDeterministicTestHasher();
    expect(await hasher.hash("same-password")).toBe(await hasher.hash("same-password"));
  });
});
