/**
 * Opaque-token sessions (W902).
 *
 * A session is an OPAQUE high-entropy bearer token plus its server-side
 * record. The token is 32 bytes from the injected {@link EntropySource},
 * base64url-encoded (43 chars). The store keeps ONLY the SHA-256 hash of the
 * token — never the plaintext — so a store read/dump cannot be replayed.
 *
 * All time comes from the INJECTED clock (`nowMs`); all randomness from the
 * INJECTED entropy source (constitution: no `Date.now`, no `Math.random` in
 * library code — see ./clock.ts and the repo's default-clock pattern).
 *
 * Role switching is a SESSION field (`activeRole`), never an account change:
 * `switchRole` refuses a role the account does not hold, and the account's
 * grants are never touched here (policy.ts re-authorizes every action
 * against the GRANTS, not the active role).
 */
import type { Role } from "@sporta/capability";
import type { EntropySource } from "./clock";
import { createIdentityDefaultClock, defaultEntropySource } from "./clock";

/** Token entropy in bytes (256-bit — high-entropy by construction). */
export const SESSION_TOKEN_BYTES = 32;

/** Default session TTL: 7 days (milliseconds). */
export const DEFAULT_SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** The stored session record. `tokenHash` is SHA-256 hex of the token. */
export interface SessionRecord {
  /** SHA-256 hex digest of the opaque token (never the token itself). */
  tokenHash: string;
  /** The account the session belongs to. */
  userId: string;
  /** Issued-at (epoch ms, from the injected clock). */
  issuedAtMs: number;
  /** Expires-at (epoch ms; resolve denies at `nowMs >= expiresAtMs`). */
  expiresAtMs: number;
  /** The per-session PRESENTATION role (never grants — see module docs). */
  activeRole: Role | null;
  /** Revoked-at (epoch ms), or null while the session is live. */
  revokedAtMs: number | null;
}

/**
 * Session persistence port (async — the W911 Neon adapter's shape).
 * Implementations MUST hand out deep clones and MUST NOT store tokens.
 */
export interface SessionStore {
  /** Persists a record (the record's tokenHash is the key). */
  create(record: SessionRecord): Promise<void>;
  /** Returns the record with this token hash, or null. */
  findByTokenHash(tokenHash: string): Promise<SessionRecord | null>;
  /** Replaces a stored record (active-role change, revocation). */
  update(record: SessionRecord): Promise<void>;
}

/** Process-local `SessionStore` (deep clones in and out — no aliasing). */
export class InMemorySessionStore implements SessionStore {
  private readonly records = new Map<string, SessionRecord>();

  async create(record: SessionRecord): Promise<void> {
    if (this.records.has(record.tokenHash)) {
      throw new Error(`session store: duplicate token hash '${record.tokenHash}'`);
    }
    this.records.set(record.tokenHash, structuredClone(record));
  }

  async findByTokenHash(tokenHash: string): Promise<SessionRecord | null> {
    const stored = this.records.get(tokenHash);
    return stored === undefined ? null : structuredClone(stored);
  }

  async update(record: SessionRecord): Promise<void> {
    if (!this.records.has(record.tokenHash)) {
      throw new Error(`session store: unknown token hash '${record.tokenHash}'`);
    }
    this.records.set(record.tokenHash, structuredClone(record));
  }

  /** Test/ops helper: every stored record (already clones). */
  async all(): Promise<SessionRecord[]> {
    return [...this.records.values()].map((record) => structuredClone(record));
  }
}

// ---------------------------------------------------------------------------
// Token encoding + hashing (pure, injectable-free)
// ---------------------------------------------------------------------------

const BASE64URL_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

/** Encodes bytes as unpadded base64url (RFC 4648 §5). */
export function toBase64Url(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i]!;
    const b1 = bytes[i + 1];
    const b2 = bytes[i + 2];
    out += BASE64URL_ALPHABET[b0! >> 2]!;
    out += BASE64URL_ALPHABET[((b0! & 0x03) << 4) | ((b1 ?? 0) >> 4)]!;
    if (b1 !== undefined) {
      out += BASE64URL_ALPHABET[((b1 & 0x0f) << 2) | ((b2 ?? 0) >> 6)]!;
      if (b2 !== undefined) out += BASE64URL_ALPHABET[b2 & 0x3f]!;
    }
  }
  return out;
}

/** SHA-256 hex digest of an ASCII string (WebCrypto — Bun + browsers). */
export async function sha256Hex(text: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(text),
  );
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

// ---------------------------------------------------------------------------
// The session service
// ---------------------------------------------------------------------------

/** Everything session issuance/resolution needs, injected. */
export interface SessionServiceOptions {
  store: SessionStore;
  /** Default: the deterministic identity epoch clock (production injects real time). */
  entropy?: EntropySource;
  /** Default: the deterministic identity epoch clock (production MUST inject real time). */
  nowMs?: () => number;
  ttlMs?: number;
}

/** The issued session: the one-time-visible token + its stored record. */
export interface IssuedSession {
  /** The opaque bearer token — shown ONCE at issuance, never stored. */
  token: string;
  record: SessionRecord;
}

/** Issue/resolve/revoke/switch sessions against the injected seams. */
export class SessionService {
  readonly store: SessionStore;
  private readonly entropy: EntropySource;
  private readonly nowMs: () => number;
  private readonly ttlMs: number;

  constructor(options: SessionServiceOptions) {
    this.store = options.store;
    this.entropy = options.entropy ?? defaultEntropySource;
    this.nowMs = options.nowMs ?? createIdentityDefaultClock();
    this.ttlMs = options.ttlMs ?? DEFAULT_SESSION_TTL_MS;
  }

  /**
   * Issues a session: draws the token from the entropy source, stores ONLY
   * `sha256(token)` + userId + issued/expires + `activeRole` (presentation
   * only), and returns the token once.
   */
  async issue(input: {
    userId: string;
    activeRole?: Role | null;
  }): Promise<IssuedSession> {
    const token = toBase64Url(this.entropy.randomBytes(SESSION_TOKEN_BYTES));
    const issuedAtMs = this.nowMs();
    const record: SessionRecord = {
      tokenHash: await sha256Hex(token),
      userId: input.userId,
      issuedAtMs,
      expiresAtMs: issuedAtMs + this.ttlMs,
      activeRole: input.activeRole ?? null,
      revokedAtMs: null,
    };
    await this.store.create(record);
    return { token, record: structuredClone(record) };
  }

  /**
   * Resolves a presented token to its live record, or null. Fail-closed:
   * unknown hash, revoked, and expired (at the injected now) all → null —
   * callers MUST answer identically for all three (no token enumeration).
   */
  async resolve(token: string): Promise<SessionRecord | null> {
    if (token.length === 0) return null;
    const record = await this.store.findByTokenHash(await sha256Hex(token));
    if (record === null) return null;
    if (record.revokedAtMs !== null) return null;
    if (this.nowMs() >= record.expiresAtMs) return null;
    return record;
  }

  /** Revokes a session (idempotent: an already-revoked/unknown token is fine). */
  async revoke(token: string): Promise<void> {
    const record = await this.store.findByTokenHash(await sha256Hex(token));
    if (record === null || record.revokedAtMs !== null) return;
    await this.store.update({ ...record, revokedAtMs: this.nowMs() });
  }

  /**
   * Switches the session's ACTIVE ROLE (presentation only). Refuses a role
   * the account does not hold — the caller supplies the account's grants;
   * the session's own field is never authoritative.
   */
  async switchRole(
    token: string,
    role: Role,
    accountRoles: readonly Role[],
  ): Promise<SessionRecord> {
    if (!accountRoles.includes(role)) {
      throw new Error(
        `switchRole: role '${role}' is not granted to this account (refused — role switching never grants authority)`,
      );
    }
    const record = await this.store.findByTokenHash(await sha256Hex(token));
    if (record === null) throw new Error("switchRole: no such session");
    if (record.revokedAtMs !== null) throw new Error("switchRole: session is revoked");
    if (this.nowMs() >= record.expiresAtMs) throw new Error("switchRole: session is expired");
    const updated: SessionRecord = { ...record, activeRole: role };
    await this.store.update(updated);
    return structuredClone(updated);
  }
}
