/**
 * The account model + persistence port (W902).
 *
 * An account is a stable identity with a credential (password hashed with
 * argon2id via `Bun.password.hash`) and ROLE GRANTS (the
 * role-experience-matrix vocabulary, consumed from `@sporta/capability`).
 * Grants are data on the account; they are NOT the active role (a
 * per-session presentation field — see ./sessions.ts) and NOT authority
 * (server-side policy re-authorizes every action — see ./policy.ts).
 *
 * Storage is behind an ASYNC `AccountStore` port so the Neon adapter (W911)
 * can slot in without touching this package's semantics. The in-memory
 * implementation is this wave's deployment: process-local, no durability.
 * The STORE owns id assignment (`u-<n>` here; a real database generates
 * its own stable ids).
 */
import type { Role } from "@sporta/capability";

/** The stored account document. Password hashes are argon2id strings. */
export interface Account {
  /** Stable account id (assigned by the store, never recycled within it). */
  userId: string;
  /** Unique, case-normalized (lowercase) username. */
  username: string;
  /** Optional contact address (NEVER verified in this wave — documented limitation). */
  email: string | undefined;
  /** argon2id password hash (Bun.password.hash). Never the plaintext. */
  passwordHash: string;
  /** Role GRANTS held by the account. */
  roles: Role[];
  /** Creation time (ISO-8601 UTC, from the injected clock). */
  createdAtIso: string;
}

/** What the caller supplies to create an account (the store assigns the id). */
export type NewAccountInput = Omit<Account, "userId">;

/** A projection of an account that is safe to hand to a client. */
export interface AccountSummary {
  userId: string;
  username: string;
  email: string | undefined;
  roles: Role[];
  createdAtIso: string;
}

/** The account persistence port (async — the W911 Neon adapter's shape). */
export interface AccountStore {
  /** Persists a new account (the store assigns the id). Throws a typed conflict error on a taken username. */
  create(input: NewAccountInput): Promise<Account>;
  /** Returns the account with this exact (already-normalized) username, or null. */
  findByUsername(username: string): Promise<Account | null>;
  /** Returns the account with this id, or null. */
  findByUserId(userId: string): Promise<Account | null>;
  /**
   * Replaces the stored account (grants may change). Throws a typed
   * not-found error when the account does not exist.
   */
  update(account: Account): Promise<void>;
}

/** Thrown when creating an account whose username is already taken. */
export class AccountConflictError extends Error {
  readonly username: string;

  constructor(username: string) {
    super(`username '${username}' is already registered`);
    this.name = "AccountConflictError";
    this.username = username;
  }
}

/** Thrown when updating an account that does not exist. */
export class AccountNotFoundError extends Error {
  readonly userId: string;

  constructor(userId: string) {
    super(`account '${userId}' was not found`);
    this.name = "AccountNotFoundError";
    this.userId = userId;
  }
}

/** Client-safe projection of an account (never the hash). */
export function toAccountSummary(account: Account): AccountSummary {
  return {
    userId: account.userId,
    username: account.username,
    email: account.email,
    roles: [...account.roles],
    createdAtIso: account.createdAtIso,
  };
}

/**
 * Process-local `AccountStore`. Assigns deterministic user ids (`u-<n>` —
 * no entropy, test-friendly); hands out deep clones so callers can never
 * mutate stored state through handed-out references.
 */
export class InMemoryAccountStore implements AccountStore {
  private readonly accounts = new Map<string, Account>();
  private readonly byUsername = new Map<string, Account>();
  private seq = 0;

  async create(input: NewAccountInput): Promise<Account> {
    if (this.byUsername.has(input.username)) {
      throw new AccountConflictError(input.username);
    }
    this.seq += 1;
    const stored: Account = {
      ...structuredClone({ ...input, roles: [...input.roles] }),
      userId: `u-${this.seq}`,
    };
    this.accounts.set(stored.userId, stored);
    this.byUsername.set(stored.username, stored);
    return structuredClone(stored);
  }

  async findByUsername(username: string): Promise<Account | null> {
    const stored = this.byUsername.get(username);
    return stored === undefined ? null : structuredClone(stored);
  }

  async findByUserId(userId: string): Promise<Account | null> {
    const stored = this.accounts.get(userId);
    return stored === undefined ? null : structuredClone(stored);
  }

  async update(account: Account): Promise<void> {
    const existing = this.accounts.get(account.userId);
    if (existing === undefined) {
      throw new AccountNotFoundError(account.userId);
    }
    if (account.username !== existing.username && this.byUsername.has(account.username)) {
      throw new AccountConflictError(account.username);
    }
    const stored: Account = { ...account, roles: [...account.roles] };
    this.accounts.set(account.userId, stored);
    this.byUsername.delete(existing.username);
    this.byUsername.set(stored.username, stored);
  }
}
