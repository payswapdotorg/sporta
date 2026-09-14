/**
 * The HTTP render-output provider (W702): a {@link RenderOutputPort} over
 * the viewer server's stand-in output route (`GET /output/:sessionId/:renderId`).
 *
 * Browser-safe by construction (part of the served ES-module graph):
 * type-only imports + platform `fetch`. Non-2xx answers map onto typed
 * viewer errors: a well-formed error envelope carrying a RECOGNIZED failure
 * class is honored VERBATIM (the server's actual classification — never
 * reclassified, never guessed; `unsupported-output` for the W504 gap on this
 * seam's stand-in route, `rights-denied`/`unknown-render`/… once W705 wires
 * this port to the real control-plane playback routes); an UNRECOGNIZED
 * class is surfaced as `internal` carrying the raw class; an envelope-less
 * body (non-JSON, or JSON without an `error` object) maps to the honest
 * `unsupported-output` default. Connection failures are the `network`
 * class. Never partial data: the body must be the W502-shaped
 * `{ frames, manifest }` document.
 */
import { ViewerControlError, isViewerFailureClass } from "./errors.ts";
import type { BatchRenderOutput, RenderOutputPort } from "./ports.ts";
import type { FetchLike } from "./http-client.ts";

/** Options for {@link createHttpRenderOutputProvider}. */
export interface HttpRenderOutputProviderOptions {
  /** Base URL of the viewer server (same-origin relative URLs work). */
  baseUrl: string;
  /** Fetch seam (defaults to the platform `fetch`; injectable for tests). */
  fetch?: FetchLike;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Creates the HTTP render-output provider (see the module docs). */
export function createHttpRenderOutputProvider(
  options: HttpRenderOutputProviderOptions,
): RenderOutputPort {
  const baseUrl = options.baseUrl.replace(/\/+$/, "");
  const doFetch = options.fetch ?? fetch;
  const encode = (value: string): string => encodeURIComponent(value);

  async function loadOutput(sessionId: string, renderId: string): Promise<BatchRenderOutput> {
    let response: Response;
    try {
      response = await doFetch(`${baseUrl}/output/${encode(sessionId)}/${encode(renderId)}`, {
        method: "GET",
        headers: { accept: "application/json" },
      });
    } catch (err) {
      throw new ViewerControlError(
        "network",
        `viewer server could not be reached (${err instanceof Error ? err.message : "fetch failed"})`,
      );
    }
    if (!response.ok) {
      // This route's ONLY job is the output seam: a non-2xx answer means the
      // output is not available. A well-formed error envelope is mapped
      // VERBATIM when its class is recognized (the same fail-closed posture
      // as the control client — the server's actual error code is honored,
      // never guessed); an unrecognized class is surfaced as `internal`
      // carrying the raw class; anything else — including a non-JSON or
      // envelope-less body — maps to the honest `unsupported-output`
      // default, never a guessed document.
      let parsed: unknown;
      try {
        parsed = await response.json();
      } catch {
        parsed = undefined;
      }
      if (isRecord(parsed) && isRecord(parsed.error)) {
        const wire = parsed.error;
        const message = typeof wire.message === "string" ? wire.message : "output unavailable";
        const failureClass = wire.failureClass;
        const details = isRecord(wire.details) ? wire.details : {};
        if (typeof failureClass === "string" && isViewerFailureClass(failureClass)) {
          // The verbatim passthrough is the W705 wiring contract: the real
          // playback routes answer the CONTROL failure classes (a rights
          // denial is 403 `rights-denied`, NOT a retryable "server error").
          throw new ViewerControlError(failureClass, message, {
            ...details,
            httpStatus: response.status,
          });
        }
        throw new ViewerControlError("internal", message, {
          ...details,
          httpStatus: response.status,
          ...(typeof failureClass === "string" ? { wireFailureClass: failureClass } : {}),
        });
      }
      throw new ViewerControlError(
        "unsupported-output",
        "render output is not available through this viewer server",
        { httpStatus: response.status },
      );
    }
    let parsed: unknown;
    try {
      parsed = await response.json();
    } catch {
      throw new ViewerControlError(
        "internal",
        `render output response was not JSON (status ${String(response.status)})`,
        { httpStatus: response.status },
      );
    }
    if (!isRecord(parsed) || !Array.isArray(parsed.frames) || !isRecord(parsed.manifest)) {
      throw new ViewerControlError(
        "internal",
        "render output response was not the expected { frames, manifest } document",
        { httpStatus: response.status },
      );
    }
    return parsed as unknown as BatchRenderOutput;
  }

  return { loadOutput };
}
