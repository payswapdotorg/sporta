/**
 * `ZaiAsrBackend` — the functioning transcription backend (W207).
 *
 * Wraps the `z-ai-web-dev-sdk` audio ASR endpoint behind the provider-neutral
 * `AsrBackend` seam (architecture-lock §9: the SDK is an adapter behind a
 * stable interface, never a dependency of a core contract). The SDK is loaded
 * via a LAZY dynamic import INSIDE `transcribe`, so this module — and the
 * whole package, including its unit tests — loads and runs with no network
 * access; only an actual `transcribe` call touches the SDK.
 *
 * Provider-specific assumptions (recorded per the worker contract):
 *
 * - The request carries the WAV bytes base64-encoded as `file_base64`
 *   (the SDK's documented ASR input form).
 * - The response's `text` field is the transcription; its content is taken
 *   VERBATIM (no trimming, no punctuation repair — that is W208/W209
 *   territory).
 * - The backend provides NO confidence score, so `asrConfidence` is NEVER
 *   set — inventing one would violate architecture-lock §4 (explicit
 *   uncertainty rather than invented certainty). Every emitted transcription
 *   from this backend therefore carries `confidence: undefined`.
 *
 * Failure: any SDK load, configuration, network, or response-shape failure
 * throws a typed `AsrError` with `failureClass: "internal"` whose
 * `details.cause` carries a bounded message (the first 300 characters of the
 * failure's message — never the full stack, never a response body).
 */
import type { AsrBackend } from "./backend";
import { AsrError, boundedCause } from "./errors";
import type { AsrBackendResult } from "./types";

export class ZaiAsrBackend implements AsrBackend {
  readonly backendId = "zai-asr";

  async transcribe(wav: Uint8Array): Promise<AsrBackendResult> {
    try {
      const { default: ZAI } = await import("z-ai-web-dev-sdk");
      const zai = await ZAI.create();
      const res = await zai.audio.asr.create({
        file_base64: Buffer.from(wav).toString("base64"),
      });
      const text = (res as { text?: unknown } | null | undefined)?.text;
      if (typeof text !== "string") {
        throw new Error("z-ai ASR response carried no string `text` field");
      }
      // No asrConfidence: the backend provides none, and one is never invented.
      return { text };
    } catch (error) {
      throw new AsrError("internal", "z-ai ASR transcription failed (see details.cause)", {
        backendId: this.backendId,
        cause: boundedCause(error),
      });
    }
  }
}
