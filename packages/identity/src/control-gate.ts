/**
 * The W701 bridge (W902): the identity layer becomes the REAL SOURCE of the
 * control plane's caller-supplied authorization policy.
 *
 * W701's `createControlApp` trusts the caller-supplied
 * `AuthorizationPolicy` (its documented trust boundary: "no user
 * authentication yet"). This module fronts a control app with VERIFIED
 * IDENTITY: every mediated call (1) resolves an opaque session token to an
 * account, (2) runs the pure `authorize` policy (grants + ownership — NEVER
 * the session's active role), and only then (3) delegates to the control
 * app. Denials throw BEFORE the control app is consulted — no existence
 * oracle and no bytes (Simulation D):
 *
 * - a non-owner's denial is byte-identical whether or not the media session
 *   exists (the control app is never queried on the deny path);
 * - session creation re-attests the caller's rights declaration with
 *   `assertedBy: <verified userId>` — the policy the control app receives is
 *   now identity-attested, not anonymous-caller-asserted;
 * - render-output reads gate on the SESSION owner before any segment bytes
 *   are fetched (the playback gate then re-derives rights fail-closed).
 *
 * DEPENDENCY DIRECTION (the W504 playback-port precedent): the control app
 * here is a STRUCTURAL interface — satisfied by `@sporta/control-api`'s
 * `createControlApp()` result with NO package dependency in either
 * direction. `@sporta/control-api` is a devDependency (tests wire the real
 * app in; see test/control-gate.test.ts).
 */
import type { AuthorizationPolicy } from "@sporta/contracts";
import type { Account, AccountStore } from "./accounts";
import { IdentityPermissionDeniedError, IdentityUnauthenticatedError } from "./errors";
import type { IdentityAction } from "./policy";
import { authorize } from "./policy";
import type { SessionService } from "./sessions";

/**
 * The structural control-app port (satisfied by `createControlApp()`'s
 * result). Only the mediated routes are declared; anything else stays
 * unmediated. The create result only needs the session id back.
 */
export interface GatedControlApp {
  createSession(
    input: { authorizationPolicy: AuthorizationPolicy; sourceLabel?: string },
    ctx?: { requestId?: string },
  ): Promise<{ session: { sessionId: string } }>;
  getSession(sessionId: string, ctx?: { requestId?: string }): Promise<unknown>;
  terminateSession(sessionId: string, ctx?: { requestId?: string }): Promise<unknown>;
  listRenderOutputs(
    sessionId: string,
    renderId: string,
    ctx?: { requestId?: string },
  ): Promise<unknown>;
  getRenderOutput(
    sessionId: string,
    renderId: string,
    segmentId: string,
    ctx?: { requestId?: string },
  ): Promise<unknown>;
}

/**
 * Media-session ownership (which verified account created which media
 * session through the gate). The port is async — the W911 Neon adapter's
 * shape. The in-memory impl is this wave's deployment.
 */
export interface MediaOwnershipStore {
  /** Records that `ownerId` created `sessionId`. */
  record(sessionId: string, ownerId: string): Promise<void>;
  /** The owning account id, or null when no mediated session has this id. */
  ownerIdOf(sessionId: string): Promise<string | null>;
}

/**
 * The internal sentinel for "no mediated session has this id". A non-owner
 * sees exactly the same denial as for someone else's session (uniform,
 * existence-free); an operator delegates (existence is legitimately visible
 * to the operational role — the matrix's "operational view").
 */
const NOT_OWNED = "\u0000not-a-user";

/** Process-local `MediaOwnershipStore`. */
export class InMemoryMediaOwnershipStore implements MediaOwnershipStore {
  private readonly owners = new Map<string, string>();

  async record(sessionId: string, ownerId: string): Promise<void> {
    this.owners.set(sessionId, ownerId);
  }

  async ownerIdOf(sessionId: string): Promise<string | null> {
    return this.owners.get(sessionId) ?? null;
  }
}

/** The caller's rights declaration at upload (validated, then re-attested). */
export interface MediaRightsDeclaration {
  /** The authorization policy the account declares for this media. */
  authorizationPolicy: AuthorizationPolicy;
  /** Optional label handed through to the control plane. */
  sourceLabel?: string;
}

/** Options for {@link createIdentityControlGate}. */
export interface IdentityControlGateOptions {
  accounts: AccountStore;
  sessions: SessionService;
  control: GatedControlApp;
  ownership?: MediaOwnershipStore;
}

/** The identity-gated control facade. */
export interface IdentityControlGate {
  /** Resolves a token to a live account (generic failure — no enumeration). */
  requireAccount(token: string): Promise<Account>;
  /**
   * Creates a media session AS a verified identity: requires the
   * `media-session.create` grant, re-attests the declaration
   * (`assertedBy: userId`), delegates, and records ownership.
   */
  createMediaSession(token: string, declaration: MediaRightsDeclaration): Promise<unknown>;
  /** Reads a media session (owner or operator; denied before existence). */
  getMediaSession(token: string, sessionId: string): Promise<unknown>;
  /** Terminates a media session (owner or operator; denied before existence). */
  terminateMediaSession(token: string, sessionId: string): Promise<unknown>;
  /** Lists stored outputs (owner or operator; denied before any metadata). */
  listRenderOutputs(token: string, sessionId: string, renderId: string): Promise<unknown>;
  /** Reads output bytes (owner or operator; denied BEFORE bytes are exposed). */
  getRenderOutput(
    token: string,
    sessionId: string,
    renderId: string,
    segmentId: string,
  ): Promise<unknown>;
}

/**
 * Builds the identity-gated control facade. Every method resolves the token
 * FIRST (401, generic), authorizes SECOND (403, generic — the control app is
 * never consulted on a deny), and delegates LAST (the control plane's own
 * typed errors — e.g. unknown-session → 404 — propagate untouched).
 */
export function createIdentityControlGate(
  options: IdentityControlGateOptions,
): IdentityControlGate {
  const { accounts, sessions, control } = options;
  const ownership: MediaOwnershipStore = options.ownership ?? new InMemoryMediaOwnershipStore();

  async function requireAccount(token: string): Promise<Account> {
    const record = await sessions.resolve(token);
    if (record === null) {
      throw new IdentityUnauthenticatedError();
    }
    const account = await accounts.findByUserId(record.userId);
    if (account === null) {
      // Fail-closed: a session for a deleted account is not half-trusted.
      throw new IdentityUnauthenticatedError();
    }
    return account;
  }

  /**
   * Authorizes a resource action uniformly for exists/not-exists: the
   * ownership lookup feeds a sentinel when no mediated session has the id,
   * so a non-owner's denial is byte-identical in both cases.
   */
  async function authorizeResource(
    account: Account,
    sessionId: string,
    action: IdentityAction,
  ): Promise<void> {
    const ownerId = (await ownership.ownerIdOf(sessionId)) ?? NOT_OWNED;
    const decision = authorize(account, action, { ownerId });
    if (decision.allowed) return;
    throw new IdentityPermissionDeniedError("media access is not authorized for this account", {
      action,
    });
  }

  return {
    requireAccount,

    async createMediaSession(token, declaration) {
      const account = await requireAccount(token);
      const decision = authorize(account, "media-session.create");
      if (!decision.allowed) {
        throw new IdentityPermissionDeniedError(
          "media session creation requires a creator, rights-holder, or operator grant",
          { action: "media-session.create" },
        );
      }
      // THE W701 BRIDGE: the policy handed to the control plane is
      // identity-attested — `assertedBy` is the VERIFIED account id, never
      // the raw caller's claim.
      const attested: AuthorizationPolicy = {
        ...declaration.authorizationPolicy,
        assertedBy: account.userId,
      };
      const result = await control.createSession({
        authorizationPolicy: attested,
        ...(declaration.sourceLabel !== undefined ? { sourceLabel: declaration.sourceLabel } : {}),
      });
      await ownership.record(result.session.sessionId, account.userId);
      return result;
    },

    async getMediaSession(token, sessionId) {
      const account = await requireAccount(token);
      await authorizeResource(account, sessionId, "media-session.read");
      return control.getSession(sessionId);
    },

    async terminateMediaSession(token, sessionId) {
      const account = await requireAccount(token);
      await authorizeResource(account, sessionId, "media-session.terminate");
      return control.terminateSession(sessionId);
    },

    async listRenderOutputs(token, sessionId, renderId) {
      const account = await requireAccount(token);
      await authorizeResource(account, sessionId, "render-output.read");
      return control.listRenderOutputs(sessionId, renderId);
    },

    async getRenderOutput(token, sessionId, renderId, segmentId) {
      const account = await requireAccount(token);
      await authorizeResource(account, sessionId, "render-output.read");
      return control.getRenderOutput(sessionId, renderId, segmentId);
    },
  };
}
