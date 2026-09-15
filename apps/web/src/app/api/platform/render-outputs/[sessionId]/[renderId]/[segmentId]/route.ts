/**
 * GET /api/platform/render-outputs/[sessionId]/[renderId]/[segmentId] — the
 * ONLY authorized delivery path for private render-output objects (W912).
 *
 * Flow (every step fail-closed, in order):
 * 1. the R2 binding must exist (503 otherwise — honest unconfigured state);
 * 2. the caller must present a VALID identity session (401);
 * 3. the caller must present an authorization policy (`x-sporta-rights-policy`
 *    header — the W701/W504 trust-boundary posture) from which
 *    `canStoreDerivatives` derives at now (403 BEFORE any existence check);
 * 4. when the media session has a recorded OWNER, the caller must be that
 *    owner or hold the `operator` grant (uniform 403 — existence-free);
 * 5. the segment must exist (404);
 * 6. ONLY THEN is a SHORT-LIVED (5-minute) presigned R2 URL issued. Public
 *    object URLs are never generated anywhere in the platform.
 *
 * The store's own retrieval gate re-derives the rights from the same policy
 * (defense in depth — `R2RenderOutputStore.getSegment` denies again before
 * reading bytes).
 */
import { AuthorizationPolicy } from "@sporta/contracts";
import { neonDatabaseUrl } from "@/server/platform/env";
import { getHostedIdentity, identityReady } from "@/server/platform/identity/hosted";
import { getHostedRenderOutputStore } from "@/server/platform/r2/hosted";
import {
  PlaybackRightsDeniedError,
  PlatformStoreError,
} from "@/server/platform/r2/r2-store";
import { apiError, bearerToken, cookieToken, jsonRespond, newRequestId, toIsoUtc } from "@/server/platform/api-utils";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** The presign lifetime for playback delivery (short-lived by policy). */
const PLAYBACK_PRESIGN_SECONDS = 300;

export async function GET(
  request: Request,
  context: { params: Promise<{ sessionId: string; renderId: string; segmentId: string }> },
): Promise<Response> {
  const requestId = newRequestId();
  const { sessionId, renderId, segmentId } = await context.params;
  const store = getHostedRenderOutputStore();
  if (store === null) {
    return apiError(
      "provider-unavailable",
      "artifact storage is not configured on this deployment",
      requestId,
    );
  }
  const token = bearerToken(request) ?? cookieToken(request);
  if (token === null) {
    return apiError("unauthenticated", "a session is required for render-output delivery", requestId);
  }
  try {
    await identityReady();
    const identity = getHostedIdentity();
    const record = await identity.sessions.resolve(token);
    if (record === null) {
      return apiError("unauthenticated", "invalid session", requestId);
    }
    const account = await identity.accounts.findByUserId(record.userId);
    if (account === null) {
      return apiError("unauthenticated", "invalid session", requestId);
    }
    const policyHeader = request.headers.get("x-sporta-rights-policy");
    let policy: unknown;
    try {
      policy = policyHeader === null ? undefined : JSON.parse(policyHeader);
    } catch {
      policy = undefined;
    }
    const parsedPolicy = AuthorizationPolicy.safeParse(policy);
    if (!parsedPolicy.success) {
      return apiError(
        "permission-denied",
        "a valid authorization policy is required for render-output delivery",
        requestId,
      );
    }
    // Ownership: when the media session is mediated, only the owner or an
    // operator may retrieve (uniform denial — existence is not revealed).
    if (neonDatabaseUrl() !== undefined) {
      const ownerId = await identity.ownership.ownerIdOf(sessionId);
      if (ownerId !== null && ownerId !== account.userId && !account.roles.includes("operator")) {
        return apiError(
          "permission-denied",
          "not permitted to retrieve this render output",
          requestId,
        );
      }
    }
    // Existence + summary through the rights-gated store (defense in depth).
    const stored = await store.getSegment({
      sessionId,
      renderId,
      segmentId,
      policy: parsedPolicy.data,
      nowMs: Date.now(),
    });
    if (stored === null) {
      // Authorization succeeded; an absent key is an honest 404 (no bytes were
      // revealed either way).
      return apiError("not-found", "render output segment not found", requestId);
    }
    const url = store.presignedGetUrl(sessionId, renderId, segmentId, PLAYBACK_PRESIGN_SECONDS);
    return jsonRespond(
      200,
      {
        sessionId,
        renderId,
        segmentId,
        delivery: {
          kind: "r2-presigned-get",
          url,
          expiresInSeconds: PLAYBACK_PRESIGN_SECONDS,
          expiresAtIso: toIsoUtc(Date.now() + PLAYBACK_PRESIGN_SECONDS * 1000),
        },
        segment: {
          segmentId: stored.segmentId,
          contentType: stored.contentType,
          byteLength: stored.byteLength,
          contentHash: stored.contentHash,
        },
      },
      requestId,
    );
  } catch (err) {
    if (err instanceof PlaybackRightsDeniedError) {
      return apiError("permission-denied", err.message, requestId);
    }
    if (err instanceof PlatformStoreError && err.failureClass === "internal") {
      return apiError("internal", "render-output lookup failed", requestId);
    }
    return apiError("internal", "render-output delivery failed", requestId);
  }
}
