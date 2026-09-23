import { readFile } from "node:fs/promises";
import { getSportaServer } from "@/server/runtime";
import { errorResponse, jsonResponse, readJsonBody } from "@/server/http-errors";

export const dynamic = "force-dynamic";

/**
 * POST /api/create/url-sources/[registrationId]/transfer — THE ACQUISITION
 * SEAM (W6 Worker B): the ONLY route through which the operator's
 * transferred bytes reach the ingestion services, so the transfer lands IN
 * THE SERVER'S PROCESS (the documented F2 posture: route handlers and the
 * acquisition driver share one composed server here — no cross-process
 * state divergence).
 *
 * AUTHORIZATION: the `x-acquisition-token` header carries the acquisition
 * capability the owner was handed at registration. It authorizes THE
 * MACHINE (the acquisition acts below) — never a user session, never a
 * role escalation. A missing/wrong capability and an unknown registration
 * answer the SAME uniform 404 (no existence oracle).
 *
 * PHASES (JSON body `{ "phase": … }`):
 * - `show` — the machine's pre-flight read: the URL verbatim, the current
 *   acquisition state, the recorded integrity. (The acquire script uses
 *   this to resolve WHAT to download and WHERE the state stands.)
 * - `begin` — marks the acquisition ACQUIRING BEFORE any byte moves (the
 *   honest in-flight state; `{ kind, detail? }` describe the attempt).
 * - `fail` — records the honest failure (`{ reason, detail? }`): state
 *   FAILED + the reason; the registration stays retryable (begin again).
 * - `ingest` — THE BINDING: `{ bytesPath, via: { kind, detail },
 *   claimed?: { byteSize, sha256 } }`. The route reads the transferred
 *   bytes from the host path IN THE SERVER'S PROCESS and hands them to
 *   the seam, which MEASURES the integrity itself (size + sha-256,
 *   cross-checked against the machine's claim), RE-DERIVES the rights
 *   posture at ingestion time, and runs the studio's own upload-path
 *   session creation over the bytes (the W101/W102 boundary + the R207
 *   pipeline + the W921 write-through + the J004 replay). On success the
 *   registration reads ACQUIRED — nowhere else can it.
 *
 * Every refusal is the service's typed answer (state-conflict 409,
 * integrity-mismatch 422, the R101 boundary's own classes for bad bytes)
 * — recorded as the honest FAILED state on the registration, never a
 * silent fallback.
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ registrationId: string }> },
): Promise<Response> {
  try {
    const server = await getSportaServer();
    await server.ready;
    // LAZY import (the build-safety convention — the service's graph reaches
    // bun:sqlite; route modules evaluate in the Node worker at build time).
    const { UrlSourceError } = await import("@/server/url-source-service");
    const { registrationId } = await context.params;
    const capability = request.headers.get("x-acquisition-token") ?? "";
    if (capability === "") {
      // Uniform with the unknown-registration shape — no oracle.
      throw new UrlSourceError("registration-unknown", "no such url-source registration", {
        registrationId,
      });
    }
    const body = (await readJsonBody(request)) as Record<string, unknown> | null;
    if (body === null) {
      throw new UrlSourceError(
        "transfer-refused",
        "the transfer body is required (JSON with a 'phase' field)",
        { registrationId },
      );
    }
    const phase = body.phase;
    if (phase !== "show" && phase !== "begin" && phase !== "fail" && phase !== "ingest") {
      throw new UrlSourceError(
        "transfer-refused",
        "the 'phase' field must be one of: show, begin, fail, ingest",
        { registrationId },
      );
    }

    if (phase === "show") {
      const registration = await server.urlSources.registrationShowForMachine(
        capability,
        registrationId,
      );
      return jsonResponse(200, registration);
    }

    if (phase === "begin") {
      const kind = typeof body.kind === "string" ? body.kind : "acquisition";
      const detail = typeof body.detail === "string" ? body.detail : undefined;
      const registration = await server.urlSources.markAcquiring({
        capability,
        registrationId,
        kind,
        ...(detail !== undefined ? { detail } : {}),
      });
      return jsonResponse(200, { registration: registration.acquisition });
    }

    if (phase === "fail") {
      const reason = typeof body.reason === "string" ? body.reason : "the acquisition failed";
      const detail = typeof body.detail === "string" ? body.detail : undefined;
      const registration = await server.urlSources.markAcquisitionFailed({
        capability,
        registrationId,
        reason,
        ...(detail !== undefined ? { detail } : {}),
      });
      return jsonResponse(200, { registration: registration.acquisition });
    }

    // phase === "ingest" — THE BINDING. The bytes land on the host's
    // filesystem (the operator's transfer: the cookies-session download or
    // the file-host fetch the acquisition script performed); the seam
    // reads them HERE, in the server's own process, and measures them
    // itself before anything is created.
    const bytesPath = body.bytesPath;
    if (typeof bytesPath !== "string" || bytesPath.length === 0) {
      throw new UrlSourceError(
        "transfer-refused",
        "the ingest phase requires 'bytesPath' (the host path of the transferred file)",
        { registrationId },
      );
    }
    const via = body.via;
    if (
      typeof via !== "object" ||
      via === null ||
      typeof (via as Record<string, unknown>).kind !== "string" ||
      !["cookies", "url", "file"].includes((via as Record<string, unknown>).kind as string)
    ) {
      throw new UrlSourceError(
        "transfer-refused",
        "the ingest phase requires 'via' ({ kind: 'cookies' | 'url' | 'file', detail }) — " +
          "the transfer journal's own record of how the bytes reached the host",
        { registrationId },
      );
    }
    const viaRecord = via as { kind: "cookies" | "url" | "file"; detail?: unknown };
    const claimed =
      typeof body.claimed === "object" && body.claimed !== null
        ? (() => {
            const c = body.claimed as Record<string, unknown>;
            return {
              ...(typeof c.byteSize === "number" ? { byteSize: c.byteSize } : {}),
              ...(typeof c.sha256 === "string" ? { sha256: c.sha256 } : {}),
            };
          })()
        : undefined;
    let bytes: Uint8Array;
    try {
      const read = await readFile(bytesPath);
      bytes = new Uint8Array(read.buffer, read.byteOffset, read.byteLength);
    } catch (err) {
      throw new UrlSourceError(
        "transfer-refused",
        `the transferred bytes could not be read from '${bytesPath}' (${
          err instanceof Error ? err.message : String(err)
        }) — the file must land on the host the server runs on`,
        { registrationId, bytesPath },
      );
    }
    const outcome = await server.urlSources.ingestTransferredSource({
      capability,
      registrationId,
      bytes,
      via: {
        kind: viaRecord.kind,
        detail: typeof viaRecord.detail === "string" ? viaRecord.detail : "",
      },
      ...(claimed !== undefined && Object.keys(claimed).length > 0 ? { claimed } : {}),
    });
    return jsonResponse(200, {
      registration: {
        registrationId: outcome.registration.registrationId,
        url: outcome.registration.url,
        acquisition: outcome.registration.acquisition,
        sessionId: outcome.registration.sessionId,
        assetId: outcome.registration.assetId,
      },
      session: outcome.session,
    });
  } catch (err) {
    return errorResponse(err);
  }
}
