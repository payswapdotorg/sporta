/**
 * The connection-center CREDENTIAL vocabulary (R406): what a user may
 * PRESENT to connect a provider, the master-password refusal that makes
 * "no provider master passwords" true by construction, and the sha-256
 * fingerprint that lets the product DISPLAY which credential is connected
 * WITHOUT EVER STORING, LOGGING, OR REPORTING ITS VALUE.
 *
 * ## The accept criterion, restated as a vocabulary
 *
 * R406: "no provider master passwords; connected account can be verified
 * and disconnected." The honest enforcement boundary:
 *
 * - the ACCEPTED presentation kinds are exactly the scoped credential
 *   shapes the R402-R405 adapters document (`MODAL_TOKEN_ID` +
 *   `MODAL_TOKEN_SECRET` — a scoped token pair; `LIGHTNING_API_KEY` /
 *   `RUNPOD_API_KEY` — scoped account API keys; an OAuth access token for
 *   future OAuth flows) — the closed {@link ACCEPTED_CREDENTIAL_KINDS};
 * - the PASSWORD-CLASS kinds ({@link MASTER_PASSWORD_KINDS}) are REFUSED
 *   fail-closed with the typed {@link MasterPasswordRefusalError} BEFORE
 *   anything is stored, verified, or dispatched — the closed refusal
 *   message vocabulary below, never a bespoke string;
 * - any OTHER kind is a validation error (fail-loud) — the vocabulary is
 *   closed, so an unknown kind can never be smuggled through as data;
 * - a semantic check ("is this string ACTUALLY a master password?") is
 *   HONESTLY OUT OF SCOPE: the product cannot read a credential's server-
 *   side scope. What the product CAN promise — and pins in tests — is that
 *   (1) it never ACCEPTS a password-class presentation, (2) it never
 *   stores/logs/reports any credential VALUE anywhere, and (3) the
 *   provider's own verification call (adapter `verifyCredentials()`) is
 *   the only authority on whether a presented scoped credential works.
 *
 * ## The fingerprint (display-safe by construction)
 *
 * `credentialFingerprint(presentation)` hashes the canonical NUL-joined
 * field values with sha-256 and keeps a 16-hex-char PREFIX — enough for a
 * "connected with key f3a2…9c01" UX, useless for reconstructing the
 * credential. Fingerprint collisions between two DIFFERENT credentials of
 * the same kind are a display-only ambiguity the store treats as a
 * fail-loud conflict (the W004 never-silently-replace posture).
 */
import { createHash } from "node:crypto";
import { z } from "zod";
import type { ComputeFailureClass } from "@sporta/compute-adapter";

// ---------------------------------------------------------------------------
// The closed presentation vocabularies
// ---------------------------------------------------------------------------

/**
 * The credential kinds the connection center ACCEPTS — exactly the scoped
 * shapes the provider adapters support (closed vocabulary; provider NAMES
 * never appear in members — they are data elsewhere).
 */
export const ACCEPTED_CREDENTIAL_KINDS = [
  "scoped-api-key",
  "scoped-token-pair",
  "oauth-access-token",
] as const;
export type AcceptedCredentialKind = (typeof ACCEPTED_CREDENTIAL_KINDS)[number];

/**
 * The password-class kinds the connection center REFUSES fail-closed
 * (closed vocabulary): an account/console/master password grants the whole
 * account, not a scoped compute surface, so the product never accepts,
 * stores, or forwards one. Presenting any of these is the typed
 * {@link MasterPasswordRefusalError}.
 */
export const MASTER_PASSWORD_KINDS = [
  "account-password",
  "console-password",
  "master-password",
] as const;
export type MasterPasswordKind = (typeof MASTER_PASSWORD_KINDS)[number];

/** The full closed presentation vocabulary (accepted + refused members). */
export const CREDENTIAL_PRESENTATION_KINDS = [
  ...ACCEPTED_CREDENTIAL_KINDS,
  ...MASTER_PASSWORD_KINDS,
] as const;
export type CredentialPresentationKind = (typeof CREDENTIAL_PRESENTATION_KINDS)[number];

// ---------------------------------------------------------------------------
// The presentation document (zod-validated, strict)
// ---------------------------------------------------------------------------

/** Bounded, NUL-free credential string (the shared shape guard). */
const credentialString = z
  .string()
  .min(1)
  .max(4096)
  .refine((value) => !value.includes("\u0000"), {
    message: "a credential value is never NUL-containing (unambiguous key space)",
  });

/** The accepted presentation shapes (strict — no extra fields ride along). */
export const AcceptedCredentialPresentation = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("scoped-api-key"),
      /** The scoped API key value (consumed transiently; never stored). */
      apiKey: credentialString,
    })
    .strict(),
  z
    .object({
      kind: z.literal("scoped-token-pair"),
      /** The scoped token id (e.g. a Modal-Token-Id — data, not vocabulary). */
      tokenId: credentialString,
      /** The scoped token secret (e.g. a Modal-Token-Secret). */
      tokenSecret: credentialString,
    })
    .strict(),
  z
    .object({
      kind: z.literal("oauth-access-token"),
      /** The OAuth access token value (short-lived, scoped). */
      accessToken: credentialString,
    })
    .strict(),
]);
export type AcceptedCredentialPresentation = z.infer<typeof AcceptedCredentialPresentation>;

/** The refused password-class shapes (strict). */
export const MasterPasswordPresentation = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("account-password"), password: credentialString }).strict(),
  z.object({ kind: z.literal("console-password"), password: credentialString }).strict(),
  z.object({ kind: z.literal("master-password"), password: credentialString }).strict(),
]);
export type MasterPasswordPresentation = z.infer<typeof MasterPasswordPresentation>;

/** Anything a user may present at the connect boundary (closed union). */
export const CredentialPresentation = z.discriminatedUnion("kind", [
  ...AcceptedCredentialPresentation.options,
  ...MasterPasswordPresentation.options,
]);
export type CredentialPresentation = z.infer<typeof CredentialPresentation>;

// ---------------------------------------------------------------------------
// The master-password refusal (typed, fail-closed, closed messages)
// ---------------------------------------------------------------------------

/**
 * The CLOSED refusal message vocabulary — exactly one message per surface,
 * never a bespoke string, never carrying the presented value.
 */
export const MASTER_PASSWORD_REFUSAL_MESSAGES = {
  connect:
    "refused: provider master/console passwords are never accepted — connect a scoped API key, a scoped token pair, or an OAuth access token instead",
  unknownPresentation:
    "refused: the presented credential kind is outside the closed connection vocabulary",
} as const;
export type MasterPasswordRefusalSurface = keyof typeof MASTER_PASSWORD_REFUSAL_MESSAGES;

/** The typed refusal (fail-closed; recorded by the center, never dropped). */
export class MasterPasswordRefusalError extends Error {
  readonly failureClass: ComputeFailureClass;
  readonly terminalFailureClass: ComputeFailureClass;
  /** Which surface refused (closed vocabulary). */
  readonly surface: MasterPasswordRefusalSurface;
  /** The presented password-class kind (data). */
  readonly presentedKind: CredentialPresentationKind | "unknown";
  /** The provider the presentation targeted (data, never a vocabulary member). */
  readonly providerId: string;
  /** The account that presented it (data). */
  readonly accountId: string;

  constructor(options: {
    surface: MasterPasswordRefusalSurface;
    presentedKind: CredentialPresentationKind | "unknown";
    providerId: string;
    accountId: string;
  }) {
    super(MASTER_PASSWORD_REFUSAL_MESSAGES[options.surface]);
    this.name = "MasterPasswordRefusalError";
    // A password-class presentation is refused on the product's security
    // boundary: the rights-denied class (the W914 vocabulary member that
    // says "the credential class is not acceptable here"), never internal
    // (this is not a bug) and never media-invalid (the input is a
    // credential, not media).
    this.failureClass = "rights-denied";
    this.terminalFailureClass = this.failureClass;
    this.surface = options.surface;
    this.presentedKind = options.presentedKind;
    this.providerId = options.providerId;
    this.accountId = options.accountId;
  }
}

/** Whether an unknown value is a {@link MasterPasswordRefusalError}. */
export function isMasterPasswordRefusalError(value: unknown): value is MasterPasswordRefusalError {
  return value instanceof MasterPasswordRefusalError;
}

// ---------------------------------------------------------------------------
// The fingerprint (display-safe credential reference)
// ---------------------------------------------------------------------------

/** How many hex characters of the sha-256 digest the reference keeps. */
export const CREDENTIAL_FINGERPRINT_HEX_LENGTH = 16;

/** The canonical field values of one accepted presentation (order pinned). */
export function credentialFieldValues(presentation: AcceptedCredentialPresentation): string[] {
  switch (presentation.kind) {
    case "scoped-api-key":
      return [presentation.apiKey];
    case "scoped-token-pair":
      return [presentation.tokenId, presentation.tokenSecret];
    case "oauth-access-token":
      return [presentation.accessToken];
  }
}

/**
 * The display-safe credential reference: sha-256 over the NUL-joined
 * canonical field values, truncated to
 * {@link CREDENTIAL_FINGERPRINT_HEX_LENGTH} hex characters. The VALUE never
 * reaches the digest's output; the digest never reconstructs the value.
 */
export function credentialFingerprint(presentation: AcceptedCredentialPresentation): string {
  const canonical = credentialFieldValues(presentation).join("\u0000");
  const digest = createHash("sha256").update(canonical, "utf8").digest("hex");
  return digest.slice(0, CREDENTIAL_FINGERPRINT_HEX_LENGTH);
}

/**
 * The honest display label for a connection's credential (kind + the
 * fingerprint prefix — NEVER the value, never a length hint beyond the
 * kind's field count).
 */
export function credentialDisplayLabel(reference: CredentialReference): string {
  return `${reference.kind} ${reference.fingerprint.slice(0, 4)}…${reference.fingerprint.slice(-4)}`;
}

// ---------------------------------------------------------------------------
// The stored credential REFERENCE (what the store may hold)
// ---------------------------------------------------------------------------

/** What a connection record may hold about a credential — a reference ONLY. */
export const CredentialReference = z
  .object({
    /** The accepted presentation kind (closed vocabulary). */
    kind: z.enum(ACCEPTED_CREDENTIAL_KINDS),
    /** The sha-256 prefix fingerprint (never the value). */
    fingerprint: z
      .string()
      .length(CREDENTIAL_FINGERPRINT_HEX_LENGTH)
      .regex(/^[0-9a-f]+$/, "a fingerprint is lowercase hex"),
    /** When the credential was presented (the injected clock domain). */
    presentedAtMs: z.number().finite().min(0),
  })
  .strict();
export type CredentialReference = z.infer<typeof CredentialReference>;
