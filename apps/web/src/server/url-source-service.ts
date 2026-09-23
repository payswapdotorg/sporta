/**
 * THE URL-SOURCE SERVICE (W6 Worker B — the real-source acquisition
 * machine) — the app-layer seam that turns an operator's REAL source URL
 * into a real session WITHOUT ever fetching the video bytes through a
 * browser upload.
 *
 * WHY THIS EXISTS (the R606 lesson): the evidence chain's "Original" was a
 * synthetic MP4, not the operator's real submitted match video. The honest
 * fix is not better synthesis — it is a machine whose every input is the
 * operator's real bytes: the operator registers the CANONICAL source URL
 * (with the same rights declaration vocabulary the upload path uses), then
 * transfers the real bytes out-of-band (an authenticated cookies session
 * for the bot-walled host, or a file-host URL — the transfer journal
 * records which), and THIS machine binds {the URL registration + the
 * rights declaration + the transferred bytes + the measured integrity}
 * into the EXISTING ingestion services (the studio's upload-path sequence
 * over the W101/W102 media boundary — never a parallel vocabulary).
 *
 * THE ACQUISITION STATE MACHINE (honest, no silent fallback):
 *
 *   PENDING_TRANSFER ──begin──▶ ACQUIRING ──ingest──▶ ACQUIRED
 *          │                        │
 *          └────────── fail ────────┴──▶ FAILED(reason) ──begin──▶ ACQUIRING …
 *
 * - `ACQUIRED` is written by EXACTLY ONE method: {@link
 *   UrlSourceService.ingestTransferredSource} (THE SEAM), and only after
 *   the real session creation succeeded through the studio's own
 *   upload-path sequence. The validating store additionally refuses any
 *   `ACQUIRED` write that does not carry the measured integrity + the
 *   session join — dev seeds, fixtures and the browser upload path
 *   STRUCTURALLY cannot satisfy a URL registration (they never construct
 *   one; and no code path but the seam composes a valid ACQUIRED record).
 * - Every failure is RECORDED (the attempt log + `FAILED` + the reason)
 *   and answered typed — never a silent fallback, never an invented
 *   success.
 * - The oEmbed metadata is fetched from the host's PUBLIC endpoint only;
 *   when it is unreachable (the documented bot-wall) the registration
 *   records the honest `unavailableReason` — nothing is fabricated.
 *
 * THE CAPABILITY (machine authorization): registration mints a
 * crypto-random acquisition capability and records only its SHA-256. The
 * owner reads the capability through the owner-gated registration read and
 * hands it to the acquisition machine (`scripts/real-source/acquire.py`).
 * The transfer seam verifies the capability and answers UNIFORM 404s on
 * any mismatch — no existence oracle, no role escalation: the capability
 * authorizes THE MACHINE (the acquisition acts), never a user session.
 */
import { deriveRightsCapabilities } from "@sporta/contracts";
import { IdentityPermissionDeniedError, IdentityValidationError, authorize } from "@sporta/identity";
import { sha256OfBytes } from "@sporta/media-platform";
import type { SportaServer } from "./composition";
import {
  DERIVED_REALITY_SELECTION_KINDS,
  studioDeclarationPolicy,
} from "./create-studio-service";
import type {
  RightsDeclarationInput,
  StudioComputeDirective,
  StudioUploadSessionView,
} from "./create-studio-service";

// ---------------------------------------------------------------------------
// The registration record
// ---------------------------------------------------------------------------

/** The honest acquisition states (the machine's own vocabulary). */
export type UrlAcquisitionState = "PENDING_TRANSFER" | "ACQUIRING" | "ACQUIRED" | "FAILED";

/** How the operator's real bytes reached the host (the journal's record). */
export interface UrlTransferKind {
  kind: "cookies" | "url" | "file";
  /** The journal's own note (verbatim — e.g. the file-host URL used). */
  detail: string;
}

/** The seam-measured integrity of the transferred bytes (size + sha-256). */
export interface UrlTransferIntegrity {
  byteSize: number;
  sha256: string;
  recordedAtMs: number;
  /** The claim the machine sent alongside the bytes (cross-checked). */
  claimedBy: { byteSize?: number; sha256?: string } | null;
}

/** One acquisition attempt's honest log entry. */
export interface UrlAcquisitionAttempt {
  startedAtMs: number;
  finishedAtMs: number | null;
  kind: string;
  outcome: "in-flight" | "ingested" | "failed";
  detail: string | null;
}

/**
 * A URL-source registration: the operator's canonical source URL + the
 * rights declaration + the honest acquisition state. The URL is stored
 * VERBATIM (never normalized); the oEmbed metadata is the host's own
 * public answer or an honest absence.
 */
export interface UrlSourceRegistration {
  registrationId: string;
  /** The operator's source URL, VERBATIM. */
  url: string;
  oEmbed: {
    fetchedAtMs: number;
    title: string | null;
    authorName: string | null;
    thumbnailUrl: string | null;
    providerName: string | null;
    /** The honest reason the public metadata is absent (never fabricated). */
    unavailableReason: string | null;
  };
  /** The attested rights declaration (the upload path's vocabulary). */
  declaration: RightsDeclarationInput;
  /** The J004 plan parameters the submission carried (replayed at ingest). */
  plan: {
    realities: readonly string[] | undefined;
    compute: StudioComputeDirective | undefined;
    styleId: string | undefined;
  };
  acquisition: {
    state: UrlAcquisitionState;
    /** The only acquisition method this machine performs. */
    method: "operator-transfer";
    failureReason: string | null;
    attempts: readonly UrlAcquisitionAttempt[];
    integrity: UrlTransferIntegrity | null;
    transferredVia: UrlTransferKind | null;
  };
  /** The SHA-256 of the minted acquisition capability (never the token). */
  capabilityHash: string;
  /** The session join — non-null ONLY after the seam ingested the bytes. */
  sessionId: string | null;
  /** The R101 source asset the seam's session creation stored. */
  assetId: string | null;
  /** The registering (verified) account. */
  ownerId: string;
  createdAtMs: number;
  updatedAtMs: number;
}

/** The owner-facing view of one registration (includes the capability). */
export interface UrlSourceRegistrationView {
  registrationId: string;
  url: string;
  oEmbed: UrlSourceRegistration["oEmbed"];
  declaration: RightsDeclarationInput;
  plan: UrlSourceRegistration["plan"];
  acquisition: UrlSourceRegistration["acquisition"];
  sessionId: string | null;
  assetId: string | null;
  /** The minted capability — shown ONCE at registration (null on later reads). */
  acquisitionCapability: string | null;
  createdAtMs: number;
  updatedAtMs: number;
}

// ---------------------------------------------------------------------------
// Errors (typed, mapped in ./http-errors.ts)
// ---------------------------------------------------------------------------

/** The URL-source seam's closed refusal vocabulary. */
export class UrlSourceError extends Error {
  readonly failureClass:
    | "url-invalid"
    | "registration-unknown"
    | "state-conflict"
    | "integrity-mismatch"
    | "rights-denied"
    | "transfer-refused";
  readonly httpStatus: number;
  readonly details: Record<string, unknown>;

  constructor(
    failureClass: UrlSourceError["failureClass"],
    message: string,
    details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "UrlSourceError";
    this.failureClass = failureClass;
    this.httpStatus =
      failureClass === "url-invalid"
        ? 400
        : failureClass === "registration-unknown"
          ? 404
          : failureClass === "state-conflict"
            ? 409
            : failureClass === "integrity-mismatch"
              ? 422
              : failureClass === "rights-denied"
                ? 403
                : 422;
    this.details = details;
  }
}

// ---------------------------------------------------------------------------
// The store port (+ the in-memory and validating implementations)
// ---------------------------------------------------------------------------

/** The registration persistence port (async — the sqlite adapter's shape). */
export interface UrlSourceStore {
  /** Persists a NEW registration (fails on an id collision). */
  insert(registration: UrlSourceRegistration): Promise<void>;
  /** Returns the registration with this exact id, or null. */
  find(registrationId: string): Promise<UrlSourceRegistration | null>;
  /** Replaces the registration (the service's own optimistic writes). */
  update(registration: UrlSourceRegistration): Promise<void>;
  /** The owner's registrations (newest first). */
  listByOwner(ownerId: string): Promise<UrlSourceRegistration[]>;
  /** The registration joined to a session id, or null (the state read). */
  findBySession(sessionId: string): Promise<UrlSourceRegistration | null>;
}

/** The in-memory store (deep-clone on read — records are never shared refs). */
export class InMemoryUrlSourceStore implements UrlSourceStore {
  readonly #byId = new Map<string, UrlSourceRegistration>();

  async insert(registration: UrlSourceRegistration): Promise<void> {
    if (this.#byId.has(registration.registrationId)) {
      throw new Error(`url-source registration '${registration.registrationId}' already exists`);
    }
    this.#byId.set(registration.registrationId, structuredClone(registration));
  }

  async find(registrationId: string): Promise<UrlSourceRegistration | null> {
    const found = this.#byId.get(registrationId);
    return found === undefined ? null : structuredClone(found);
  }

  async update(registration: UrlSourceRegistration): Promise<void> {
    if (!this.#byId.has(registration.registrationId)) {
      throw new Error(`url-source registration '${registration.registrationId}' is unknown`);
    }
    this.#byId.set(registration.registrationId, structuredClone(registration));
  }

  async listByOwner(ownerId: string): Promise<UrlSourceRegistration[]> {
    return [...this.#byId.values()]
      .filter((entry) => entry.ownerId === ownerId)
      .sort((a, b) => b.createdAtMs - a.createdAtMs)
      .map((entry) => structuredClone(entry));
  }

  async findBySession(sessionId: string): Promise<UrlSourceRegistration | null> {
    for (const entry of this.#byId.values()) {
      if (entry.sessionId === sessionId) return structuredClone(entry);
    }
    return null;
  }
}

/**
 * The validating store wrapper — the STRUCTURAL honesty guard: only a
 * record that carries the seam-measured integrity AND the session/asset
 * join may ever read `ACQUIRED`, and every registration is BORN
 * `PENDING_TRANSFER`. Dev seeds, fixtures and the upload path construct no
 * registration at all; any code path that tried to forge an acquisition
 * without the real transfer is refused HERE (fail-closed at the store).
 */
export class ValidatingUrlSourceStore implements UrlSourceStore {
  readonly #base: UrlSourceStore;

  constructor(base: UrlSourceStore) {
    this.#base = base;
  }

  async insert(registration: UrlSourceRegistration): Promise<void> {
    if (registration.acquisition.state !== "PENDING_TRANSFER") {
      throw new UrlSourceError(
        "state-conflict",
        "a url-source registration is born PENDING_TRANSFER — the acquisition machine alone moves the state",
        { registrationId: registration.registrationId },
      );
    }
    if (registration.acquisition.integrity !== null || registration.sessionId !== null) {
      throw new UrlSourceError(
        "state-conflict",
        "a new registration carries no integrity record and no session join — only the transfer seam records those",
        { registrationId: registration.registrationId },
      );
    }
    await this.#base.insert(registration);
  }

  async find(registrationId: string): Promise<UrlSourceRegistration | null> {
    return await this.#base.find(registrationId);
  }

  async update(registration: UrlSourceRegistration): Promise<void> {
    if (registration.acquisition.state === "ACQUIRED") {
      const { integrity, method } = registration.acquisition;
      if (
        integrity === null ||
        registration.sessionId === null ||
        registration.assetId === null ||
        method !== "operator-transfer"
      ) {
        throw new UrlSourceError(
          "state-conflict",
          "ACQUIRED requires the seam-measured integrity + the session/asset join of a real transfer — " +
            "nothing else may mark a url source acquired",
          { registrationId: registration.registrationId },
        );
      }
    }
    await this.#base.update(registration);
  }

  async listByOwner(ownerId: string): Promise<UrlSourceRegistration[]> {
    return await this.#base.listByOwner(ownerId);
  }

  async findBySession(sessionId: string): Promise<UrlSourceRegistration | null> {
    return await this.#base.findBySession(sessionId);
  }
}

// ---------------------------------------------------------------------------
// The oEmbed seam (public metadata only — honest absence otherwise)
// ---------------------------------------------------------------------------

/** One honest oEmbed lookup's answer. */
export type UrlOEmbedResult =
  | {
      ok: true;
      metadata: UrlOEmbedMetadata;
    }
  | { ok: false; reason: string };

/** The public oEmbed metadata (only what the endpoint really answered). */
export interface UrlOEmbedMetadata {
  title: string;
  authorName: string | null;
  thumbnailUrl: string | null;
  providerName: string | null;
}

/** The oEmbed fetcher port (tests inject a hermetic fake). */
export type UrlOEmbedFetcher = (url: string) => Promise<UrlOEmbedResult>;

/** The hosts with a KNOWN public oEmbed endpoint (never invented elsewhere). */
const OEMBED_HOSTS: readonly string[] = Object.freeze([
  "youtube.com",
  "www.youtube.com",
  "m.youtube.com",
  "music.youtube.com",
  "youtu.be",
]);

/** Whether a parsed URL's host exposes a public oEmbed endpoint. */
function oEmbedHostOf(hostname: string): string | null {
  return OEMBED_HOSTS.includes(hostname.toLowerCase()) ? "https://www.youtube.com/oembed" : null;
}

/**
 * The REAL oEmbed fetcher: the host's own public endpoint, a bounded 5 s
 * timeout, and honest failures (network errors, non-200 answers, malformed
 * payloads all answer `ok: false` with the real reason — never a
 * fabricated title). Hosts without a known endpoint answer the honest
 * absence up front.
 */
export async function fetchPublicOEmbed(url: string): Promise<UrlOEmbedResult> {
  const parsed = parseSourceUrl(url);
  if (parsed === null) {
    return { ok: false, reason: "the url did not parse as an https source location" };
  }
  const endpoint = oEmbedHostOf(parsed.hostname);
  if (endpoint === null) {
    return {
      ok: false,
      reason: `no public oEmbed endpoint is known for '${parsed.hostname}' — the metadata stays honestly absent (never fabricated)`,
    };
  }
  const lookup = `${endpoint}?url=${encodeURIComponent(url)}&format=json`;
  try {
    const response = await fetch(lookup, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) {
      return {
        ok: false,
        reason: `the public oEmbed endpoint answered HTTP ${response.status} — the metadata stays honestly absent`,
      };
    }
    const payload = (await response.json()) as Record<string, unknown>;
    const title = typeof payload.title === "string" ? payload.title : null;
    if (title === null) {
      return {
        ok: false,
        reason: "the public oEmbed answer carried no title — the metadata stays honestly absent",
      };
    }
    return {
      ok: true,
      metadata: {
        title,
        authorName: typeof payload.author_name === "string" ? payload.author_name : null,
        thumbnailUrl: typeof payload.thumbnail_url === "string" ? payload.thumbnail_url : null,
        providerName: typeof payload.provider_name === "string" ? payload.provider_name : null,
      },
    };
  } catch (err) {
    return {
      ok: false,
      reason: `the public oEmbed lookup failed (${
        err instanceof Error ? err.message : String(err)
      }) — the metadata stays honestly absent`,
    };
  }
}

// ---------------------------------------------------------------------------
// URL validation (fail-closed — the registration's ONLY url rule)
// ---------------------------------------------------------------------------

/**
 * Parses the source URL fail-closed: an absolute `https:` location, a
 * non-empty host, no embedded credentials, no whitespace, at most 2048
 * characters. Returns the parsed shape or null (the caller phrases the
 * typed refusal). The registration stores the ORIGINAL string verbatim.
 */
export function parseSourceUrl(raw: string): URL | null {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > 2048) return null;
  if (/\s/.test(raw)) return null;
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:") return null;
  if (parsed.hostname.length === 0) return null;
  if (parsed.username.length > 0 || parsed.password.length > 0) return null;
  return parsed;
}

// ---------------------------------------------------------------------------
// The service
// ---------------------------------------------------------------------------

/** Options for {@link UrlSourceService}. */
export interface UrlSourceServiceOptions {
  /** The composed server (resolved lazily — the service outlives the literal). */
  getServer: () => SportaServer;
  /** The registration store (the validating wrapper is the composition's default). */
  store: UrlSourceStore;
  /** Wall clock. */
  nowMs: () => number;
  /** The oEmbed fetcher (default: the real public endpoint with timeout). */
  fetchOEmbed?: UrlOEmbedFetcher;
}

/** What the transfer seam needs from the machine (all REAL facts). */
export interface UrlTransferInput {
  /** The machine's acquisition capability (the owner handed it over). */
  capability: string;
  registrationId: string;
  /** The transferred bytes (the seam MEASURES — never trusts a claim). */
  bytes: Uint8Array;
  /** How the bytes reached the host (the transfer journal's own record). */
  via: UrlTransferKind;
  /** The machine's claimed integrity (cross-checked; optional). */
  claimed?: { byteSize?: number; sha256?: string };
}

/**
 * THE URL-SOURCE SERVICE. The product seam (registration + honest state
 * reads) and THE ACQUISITION SEAM (the machine's begin/fail/ingest acts)
 * — the only writer of `ACQUIRED`.
 */
export class UrlSourceService {
  private readonly getServer: () => SportaServer;
  private readonly store: UrlSourceStore;
  private readonly nowMs: () => number;
  private readonly fetchOEmbed: UrlOEmbedFetcher;

  constructor(options: UrlSourceServiceOptions) {
    this.getServer = options.getServer;
    this.store = options.store;
    this.nowMs = options.nowMs;
    this.fetchOEmbed = options.fetchOEmbed ?? fetchPublicOEmbed;
  }

  // -----------------------------------------------------------------------
  // Registration (the product surface — the creator's acts)
  // -----------------------------------------------------------------------

  /**
   * Registers a URL source: the SAME identity gate and rights vocabulary
   * the upload path uses (a creator/rights-holder/operator grant + a
   * declaration whose derivation permits transformation — fail-closed),
   * the public oEmbed metadata fetched honestly (absence recorded, never
   * fabricated), and a freshly minted acquisition capability. The
   * registration is born `PENDING_TRANSFER` — nothing about the video
   * bytes is claimed yet.
   */
  async registerUrlSource(input: {
    token: string;
    url: string;
    declaration: RightsDeclarationInput;
    label?: string;
    /** The J004 plan parameters (replayed verbatim at ingestion). */
    realities?: readonly string[];
    compute?: StudioComputeDirective;
    styleId?: string;
  }): Promise<UrlSourceRegistrationView> {
    const server = this.getServer();
    const account = await server.gate.requireAccount(input.token);
    const decision = authorize(account, "media-session.create");
    if (!decision.allowed) {
      throw new IdentityPermissionDeniedError(
        "url-source registration requires a creator, rights-holder, or operator grant",
        { action: "media-session.create" },
      );
    }

    // The URL rule (fail-closed parse; stored verbatim).
    if (parseSourceUrl(input.url) === null) {
      throw new UrlSourceError(
        "url-invalid",
        "the source url must be an absolute https location (no credentials, no whitespace, at most 2048 characters)",
        { url: input.url.slice(0, 128) },
      );
    }

    // The SAME rights vocabulary + transformation fail-closure the upload
    // path enforces (the R207 pipeline references source frames — a
    // declaration that cannot transform refuses registration itself).
    const policy = studioDeclarationPolicy(input.declaration, "policy-url-source-preview");
    const capabilities = deriveRightsCapabilities(policy, new Date(this.nowMs()));
    if (!capabilities.canReferenceSourceFrames) {
      throw new UrlSourceError(
        "rights-denied",
        "a url-source registration requires a declaration that allows transformation " +
          "(the media pipeline references source frames — fail-closed)",
        { policyId: policy.policyId },
      );
    }

    // The J004 plan parameters (validated now so the registration record
    // is honest; the studio re-validates at ingestion).
    if (input.realities !== undefined) {
      for (const raw of input.realities) {
        if (
          raw === "original" ||
          !(DERIVED_REALITY_SELECTION_KINDS as readonly string[]).includes(raw)
        ) {
          throw new IdentityValidationError(
            `unknown derived reality '${String(raw)}' (the plan selects from: ${DERIVED_REALITY_SELECTION_KINDS.join(", ")})`,
          );
        }
      }
    }

    // The honest oEmbed lookup (public metadata only).
    const now = this.nowMs();
    const lookedUp = await this.fetchOEmbed(input.url);
    const oEmbed: UrlSourceRegistration["oEmbed"] = {
      fetchedAtMs: now,
      title: lookedUp.ok ? lookedUp.metadata.title : null,
      authorName: lookedUp.ok ? lookedUp.metadata.authorName : null,
      thumbnailUrl: lookedUp.ok ? lookedUp.metadata.thumbnailUrl : null,
      providerName: lookedUp.ok ? lookedUp.metadata.providerName : null,
      unavailableReason: lookedUp.ok ? null : lookedUp.reason,
    };

    // The minted capability: crypto-random, only its hash is stored.
    const capabilityBytes = new Uint8Array(32);
    crypto.getRandomValues(capabilityBytes);
    const capability = Array.from(capabilityBytes, (b) => b.toString(16).padStart(2, "0")).join("");
    const capabilityHash = sha256OfBytes(new TextEncoder().encode(capability));

    const registrationId = `urlreg-${this.#randomHex(32)}`;
    const registration: UrlSourceRegistration = {
      registrationId,
      url: input.url,
      oEmbed,
      declaration: structuredClone(input.declaration),
      plan: {
        realities: input.realities === undefined ? undefined : [...input.realities],
        compute: input.compute === undefined ? undefined : structuredClone(input.compute),
        styleId: input.styleId === undefined ? undefined : input.styleId,
      },
      acquisition: {
        state: "PENDING_TRANSFER",
        method: "operator-transfer",
        failureReason: null,
        attempts: [],
        integrity: null,
        transferredVia: null,
      },
      capabilityHash,
      sessionId: null,
      assetId: null,
      ownerId: account.userId,
      createdAtMs: now,
      updatedAtMs: now,
    };
    await this.store.insert(registration);
    return this.#viewOf(registration, capability);
  }

  /**
   * The public oEmbed preview (the UI's pre-registration lookup): the
   * host's own public metadata or the honest reason it is absent. An
   * unparsable url answers the typed 400.
   */
  async previewOEmbed(input: {
    url: string;
  }): Promise<{ available: true; metadata: UrlOEmbedMetadata } | { available: false; reason: string }> {
    if (parseSourceUrl(input.url) === null) {
      throw new UrlSourceError(
        "url-invalid",
        "the source url must be an absolute https location (no credentials, no whitespace, at most 2048 characters)",
        { url: input.url.slice(0, 128) },
      );
    }
    const lookedUp = await this.fetchOEmbed(input.url);
    return lookedUp.ok
      ? { available: true, metadata: lookedUp.metadata }
      : { available: false, reason: lookedUp.reason };
  }

  /** The owner's registration read (uniform 404 for anyone else). */
  async registration(token: string, registrationId: string): Promise<UrlSourceRegistrationView> {
    const server = this.getServer();
    const account = await server.gate.requireAccount(token);
    const found = await this.store.find(registrationId);
    if (found === null || found.ownerId !== account.userId) {
      throw new UrlSourceError("registration-unknown", "no such url-source registration", {
        registrationId,
      });
    }
    // The raw capability is shown ONCE (at registration); later reads carry
    // null — the owner saved it, and the machine holds the token it was
    // handed. The stored record carries only the hash.
    return this.#viewOf(found, null);
  }

  /** The owner's registrations (newest first). */
  async listRegistrations(token: string): Promise<UrlSourceRegistrationView[]> {
    const server = this.getServer();
    const account = await server.gate.requireAccount(token);
    const rows = await this.store.listByOwner(account.userId);
    return rows.map((row) => this.#viewOf(row, null));
  }

  /**
   * The session-state read's join: the registration bound to a session
   * (the studio's `urlSourceOf` consumes this — combined truth, no second
   * source of state).
   */
  async registrationOfSession(sessionId: string): Promise<UrlSourceRegistration | null> {
    return await this.store.findBySession(sessionId);
  }

  // -----------------------------------------------------------------------
  // THE ACQUISITION SEAM (the machine's acts — capability-gated)
  // -----------------------------------------------------------------------

  /** Verifies the capability against the registration (uniform 404s). */
  async #requireCapability(
    registrationId: string,
    capability: string,
  ): Promise<UrlSourceRegistration> {
    const found = await this.store.find(registrationId);
    const presented = sha256OfBytes(new TextEncoder().encode(capability));
    if (found === null || found.capabilityHash !== presented) {
      // UNIFORM: an unknown registration and a wrong capability answer the
      // same shape — no existence oracle for anything the machine asks.
      throw new UrlSourceError("registration-unknown", "no such url-source registration", {
        registrationId,
      });
    }
    return found;
  }

  /**
   * The machine's pre-flight read (`show`): the capability-gated view of
   * the registration the acquisition script needs — the URL verbatim (what
   * to download), the current acquisition state (where the machine stands),
   * and the recorded integrity. Uniform 404 on any capability mismatch.
   */
  async registrationShowForMachine(
    capability: string,
    registrationId: string,
  ): Promise<{
    registrationId: string;
    url: string;
    oEmbed: UrlSourceRegistration["oEmbed"];
    acquisition: UrlSourceRegistration["acquisition"];
    sessionId: string | null;
  }> {
    const registration = await this.#requireCapability(registrationId, capability);
    return {
      registrationId: registration.registrationId,
      url: registration.url,
      oEmbed: structuredClone(registration.oEmbed),
      acquisition: structuredClone(registration.acquisition),
      sessionId: registration.sessionId,
    };
  }

  /**
   * `begin` — the machine marks the acquisition ACQUIRING BEFORE any byte
   * moves (the honest in-flight state; a crash here leaves the attempt
   * log's in-flight entry as the honest trace).
   */
  async markAcquiring(input: {
    capability: string;
    registrationId: string;
    kind: string;
    detail?: string;
  }): Promise<UrlSourceRegistration> {
    const registration = await this.#requireCapability(input.registrationId, input.capability);
    if (registration.acquisition.state === "ACQUIRED") {
      throw new UrlSourceError(
        "state-conflict",
        "this url source is already ACQUIRED — the session join exists; nothing further can be transferred",
        { registrationId: registration.registrationId, sessionId: registration.sessionId },
      );
    }
    const now = this.nowMs();
    const attempts = [...registration.acquisition.attempts];
    // Complete any stale in-flight attempt honestly (a crashed machine's
    // trace is closed as unknown-outcome, never deleted).
    for (const attempt of attempts) {
      if (attempt.finishedAtMs === null) {
        attempts[attempts.indexOf(attempt)] = {
          ...attempt,
          finishedAtMs: now,
          outcome: "failed",
          detail: attempt.detail ?? "closed by a later begin (the prior attempt never finished)",
        };
      }
    }
    attempts.push({
      startedAtMs: now,
      finishedAtMs: null,
      kind: input.kind,
      outcome: "in-flight",
      detail: input.detail ?? null,
    });
    const updated: UrlSourceRegistration = {
      ...registration,
      acquisition: {
        ...registration.acquisition,
        state: "ACQUIRING",
        failureReason: null,
        attempts,
      },
      updatedAtMs: now,
    };
    await this.store.update(updated);
    return updated;
  }

  /** `fail` — records the honest failure (state FAILED + the reason). */
  async markAcquisitionFailed(input: {
    capability: string;
    registrationId: string;
    reason: string;
    detail?: string;
  }): Promise<UrlSourceRegistration> {
    const registration = await this.#requireCapability(input.registrationId, input.capability);
    if (registration.acquisition.state === "ACQUIRED") {
      throw new UrlSourceError(
        "state-conflict",
        "this url source is already ACQUIRED — a failure cannot be recorded over a real transfer",
        { registrationId: registration.registrationId, sessionId: registration.sessionId },
      );
    }
    const now = this.nowMs();
    const attempts = registration.acquisition.attempts.map((attempt) =>
      attempt.finishedAtMs === null
        ? { ...attempt, finishedAtMs: now, outcome: "failed" as const, detail: input.reason }
        : attempt,
    );
    const updated: UrlSourceRegistration = {
      ...registration,
      acquisition: {
        ...registration.acquisition,
        state: "FAILED",
        failureReason: input.reason,
        attempts,
      },
      updatedAtMs: now,
    };
    await this.store.update(updated);
    return updated;
  }

  /**
   * THE SEAM — `ingest`: binds {the registration + the re-derived rights +
   * the transferred bytes + the seam-measured integrity} into the EXISTING
   * session-creation sequence (the studio's upload-path vocabulary: the
   * W902 gate → the R101 boundary → the R207 pipeline → the W921
   * write-through → the J004 replay). The session's world model is derived
   * from the TRANSFERRED bytes — the operator's real source.
   *
   * ACQUIRED is written HERE and ONLY here: after the real session
   * creation succeeded, with the measured integrity and the session/asset
   * join recorded. Every refusal along the way is typed, recorded as the
   * honest FAILED state, and rethrown — never a silent fallback.
   */
  async ingestTransferredSource(input: UrlTransferInput): Promise<{
    registration: UrlSourceRegistration;
    session: StudioUploadSessionView;
  }> {
    const registration = await this.#requireCapability(input.registrationId, input.capability);
    if (registration.acquisition.state === "PENDING_TRANSFER") {
      throw new UrlSourceError(
        "state-conflict",
        "the acquisition must be marked ACQUIRING before bytes are ingested " +
          "(the machine's begin phase — the in-flight state is the honest trace)",
        { registrationId: registration.registrationId },
      );
    }
    if (registration.acquisition.state === "ACQUIRED") {
      throw new UrlSourceError(
        "state-conflict",
        "this url source is already ACQUIRED — the session join exists",
        { registrationId: registration.registrationId, sessionId: registration.sessionId },
      );
    }
    if (registration.acquisition.state === "FAILED") {
      throw new UrlSourceError(
        "state-conflict",
        "the last acquisition attempt FAILED — the machine must begin a new attempt before ingesting bytes",
        { registrationId: registration.registrationId, reason: registration.acquisition.failureReason },
      );
    }

    // 1. The seam-measured integrity (never a trusted claim): the bytes
    //    are measured HERE, and the machine's claim is cross-checked.
    const byteSize = input.bytes.byteLength;
    const sha256 = sha256OfBytes(input.bytes);
    if (input.claimed !== undefined) {
      const claimedSize = input.claimed.byteSize;
      const claimedHash = input.claimed.sha256;
      if (claimedSize !== undefined && claimedSize !== byteSize) {
        await this.#recordFailure(
          registration,
          `integrity-mismatch: the machine claimed ${claimedSize} bytes but the transferred bytes measure ${byteSize}`,
          input.via,
        );
        throw new UrlSourceError(
          "integrity-mismatch",
          `the claimed byte size (${claimedSize}) does not match the transferred bytes (${byteSize})`,
          { registrationId: registration.registrationId, claimed: claimedSize, measured: byteSize },
        );
      }
      if (claimedHash !== undefined && claimedHash !== sha256) {
        await this.#recordFailure(
          registration,
          "integrity-mismatch: the machine's claimed sha-256 does not match the transferred bytes",
          input.via,
        );
        throw new UrlSourceError(
          "integrity-mismatch",
          "the claimed sha-256 does not match the transferred bytes",
          { registrationId: registration.registrationId },
        );
      }
    }

    // 2. The rights posture RE-DERIVED at ingestion time (never weakened:
    //    an expired or narrowed policy refuses HERE, fail-closed).
    const server = this.getServer();
    const policy = studioDeclarationPolicy(
      registration.declaration,
      `policy-url-source-ingest-${registration.registrationId}`,
    );
    const capabilities = deriveRightsCapabilities(policy, new Date(this.nowMs()));
    if (!capabilities.canReferenceSourceFrames) {
      const reason =
        "the registration's rights declaration no longer allows transformation (re-derived at ingestion — fail-closed)";
      await this.#recordFailure(registration, reason, input.via);
      throw new UrlSourceError("rights-denied", reason, {
        registrationId: registration.registrationId,
      });
    }

    // 3. THE REAL SESSION CREATION — the studio's upload-path sequence
    //    over the transferred bytes, with the URL provenance riding the
    //    clip. A refusal (container, size, media probe, pipeline) is
    //    recorded as the honest FAILED state and rethrown typed.
    let session: StudioUploadSessionView;
    try {
      session = await server.studio.createUrlSourceSession({
        principal: { userId: registration.ownerId },
        registration: {
          registrationId: registration.registrationId,
          url: registration.url,
          declaration: registration.declaration,
        },
        bytes: input.bytes,
        ...(registration.plan.realities !== undefined
          ? { realities: registration.plan.realities }
          : {}),
        ...(registration.plan.compute !== undefined ? { compute: registration.plan.compute } : {}),
        ...(registration.plan.styleId !== undefined ? { styleId: registration.plan.styleId } : {}),
      });
    } catch (err) {
      const reason =
        err instanceof Error ? err.message : `the ingestion refused: ${String(err)}`;
      await this.#recordFailure(registration, reason, input.via);
      throw err;
    }

    // 4. ACQUIRED — with the measured integrity + the session/asset join.
    //    (The validating store refuses any ACQUIRED record without these.)
    const now = this.nowMs();
    const attempts = registration.acquisition.attempts.map((attempt) =>
      attempt.finishedAtMs === null
        ? {
            ...attempt,
            finishedAtMs: now,
            outcome: "ingested" as const,
            detail: input.via.detail,
          }
        : attempt,
    );
    const updated: UrlSourceRegistration = {
      ...registration,
      acquisition: {
        ...registration.acquisition,
        state: "ACQUIRED",
        failureReason: null,
        attempts,
        integrity: {
          byteSize,
          sha256,
          recordedAtMs: now,
          claimedBy: input.claimed === undefined ? null : { ...input.claimed },
        },
        transferredVia: { ...input.via },
      },
      sessionId: session.sessionId,
      assetId: session.source.asset.assetId,
      updatedAtMs: now,
    };
    await this.store.update(updated);
    return { registration: updated, session };
  }

  /** Records the honest FAILED state (the attempt log's trace). */
  async #recordFailure(
    registration: UrlSourceRegistration,
    reason: string,
    via: UrlTransferKind,
  ): Promise<void> {
    const now = this.nowMs();
    const attempts = registration.acquisition.attempts.map((attempt) =>
      attempt.finishedAtMs === null ? { ...attempt, finishedAtMs: now, outcome: "failed" as const, detail: reason } : attempt,
    );
    await this.store.update({
      ...registration,
      acquisition: {
        ...registration.acquisition,
        state: "FAILED",
        failureReason: reason,
        attempts,
        transferredVia: { ...via },
      },
      updatedAtMs: now,
    });
  }

  // -----------------------------------------------------------------------
  // Views
  // -----------------------------------------------------------------------

  #viewOf(
    registration: UrlSourceRegistration,
    capability: string | null,
  ): UrlSourceRegistrationView {
    return {
      registrationId: registration.registrationId,
      url: registration.url,
      oEmbed: structuredClone(registration.oEmbed),
      declaration: structuredClone(registration.declaration),
      plan: structuredClone(registration.plan),
      acquisition: structuredClone(registration.acquisition),
      sessionId: registration.sessionId,
      assetId: registration.assetId,
      acquisitionCapability: capability,
      createdAtMs: registration.createdAtMs,
      updatedAtMs: registration.updatedAtMs,
    };
  }

  #randomHex(bytes: number): string {
    const buf = new Uint8Array(bytes);
    crypto.getRandomValues(buf);
    return Array.from(buf, (b) => b.toString(16).padStart(2, "0")).join("");
  }
}

// ---------------------------------------------------------------------------
// The durable source-key prefix (mirrors STUDIO_UPLOAD_SOURCE_PREFIX)
// ---------------------------------------------------------------------------

/**
 * The durable source-key prefix of a URL-source studio session:
 * `"urlsrc:" + <the registration id>`. The registration id is the honest
 * join — the durable layer reconstructs the session's engine by resolving
 * the registration (its ACQUIRED state + its asset) and re-running the
 * real-to-SWM pipeline over the STORED source bytes.
 */
export const STUDIO_URL_SOURCE_PREFIX = "urlsrc:";
