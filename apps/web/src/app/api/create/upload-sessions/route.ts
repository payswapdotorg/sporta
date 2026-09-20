import { getSportaServer } from "@/server/runtime";
import { tokenFromRequest } from "@/server/auth-service";
import { errorResponse, jsonResponse } from "@/server/http-errors";

export const dynamic = "force-dynamic";

/**
 * POST /api/create/upload-sessions — THE STUDIO'S REAL UPLOAD FLOW (R501):
 * one authorized MP4 upload becomes one media session whose world model is
 * derived from the UPLOADED clip.
 *
 * multipart/form-data:
 * - `file` — the MP4 (constraints enforced SERVER-SIDE through the REAL
 *   R101 boundary: max 200 MB, magic-byte-sniffed mp4 container,
 *   ffprobe-measured duration ≤ 120 s, ≥ 1 video stream — every rejection
 *   typed, nothing stored);
 * - `operations` — the rights declaration's allowed operations (a JSON
 *   array or a single repeated field; re-attested to the verified identity,
 *   fail-closed — the same preview the studio's rights step already showed);
 * - `expiresAtIso?`, `storageDurationDays?`, `sharingScope?` — the rest of
 *   the declaration;
 * - `label?` — the session's display label;
 * - `realities?` (J004, additive + backward-compatible) — the DERIVED
 *   reality kinds requested in this ONE submission: a JSON array of strings
 *   or repeated form fields, values `tactical` | `three-d-game` |
 *   `anime-npr`. "original" is NOT a selection — the admitted media job's
 *   normalization ALWAYS produces the original-reality artifact. Absence
 *   of the field preserves today's behavior (upload + original only).
 *   After the media job reaches its stored-original state, the studio
 *   service dispatches ONE async render per selected derived reality
 *   under ONE compute directive; the 201 answer carries the plan (per-reality
 *   renderId/jobId/state + each refusal's typed failure class).
 * - `compute?` (J004, additive) — the ONE compute selection directive that
 *   covers the whole plan (`{"mode":"sporta-auto"}` or
 *   `{"mode":"user-explicit","providerId":"…"}` — the same R407
 *   vocabulary the renders route carries); absent = no directive rides the
 *   plan's dispatches (the honest no-selection state).
 * - `styleId?` (J004, additive) — the style label the plan's dispatches
 *   carry with their render provenance.
 *
 * Server sequence (every seam REAL): the W902 identity gate → the R101
 * constraint pre-check → the R207 real-to-SWM pipeline over the uploaded
 * bytes (the session's fused engine) → the control-plane session creation →
 * the R101 upload boundary (durable hash-verified SourceAsset + the
 * admitted media job: normalization → the `original`-reality artifact) →
 * the W921 durable write-through (`upload:<assetId>` source key) → (J004,
 * only when `realities` was present) the ONE-submission render plan.
 *
 * Answers 201 with the session + the durable source state + the honest
 * perception summary (+ the render plan when the submission selected
 * realities). The media job's honest states are polled through
 * GET /api/media/jobs/[jobId]; the plan's per-reality states ride the
 * EXISTING job/render surfaces (Jobs, session state, Watch availability).
 */
export async function POST(request: Request): Promise<Response> {
  try {
    const server = await getSportaServer();
    await server.ready;
    const token = tokenFromRequest(request);
    if (token === "") {
      const { IdentityUnauthenticatedError } = await import("@sporta/identity");
      throw new IdentityUnauthenticatedError();
    }

    const contentType = request.headers.get("content-type") ?? "";
    if (!contentType.includes("multipart/form-data")) {
      const { IdentityValidationError } = await import("@sporta/identity");
      throw new IdentityValidationError("the upload must be multipart/form-data");
    }
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      const { IdentityValidationError } = await import("@sporta/identity");
      throw new IdentityValidationError("the 'file' field is required");
    }
    // The declaration's operations: a JSON array or a plain single value.
    let operations: string[] | null = null;
    const operationsEntry = form.get("operations");
    if (typeof operationsEntry === "string") {
      const trimmed = operationsEntry.trim();
      if (trimmed.startsWith("[")) {
        try {
          const parsed = JSON.parse(trimmed) as unknown;
          if (Array.isArray(parsed) && parsed.every((entry) => typeof entry === "string")) {
            operations = parsed as string[];
          }
        } catch {
          operations = null;
        }
      }
      if (operations === null) {
        operations = [operationsEntry];
      }
    } else {
      const all = form.getAll("operations");
      if (all.length > 0 && all.every((entry) => typeof entry === "string")) {
        operations = all as string[];
      }
    }
    if (operations === null || operations.length === 0) {
      const { IdentityValidationError } = await import("@sporta/identity");
      throw new IdentityValidationError(
        "the 'operations' field is required (a JSON array of allowed-operation ids)",
      );
    }
    const expiresAtIso = form.get("expiresAtIso");
    const storageDurationDays = form.get("storageDurationDays");
    const sharingScope = form.get("sharingScope");
    const label = form.get("label");
    const storageDays =
      typeof storageDurationDays === "string" && storageDurationDays.length > 0
        ? Number(storageDurationDays)
        : undefined;

    const bytes = new Uint8Array(await file.arrayBuffer());

    // J004 (additive): the DERIVED reality kinds selected in this ONE
    // submission — a JSON array of strings or repeated form fields. Absence
    // preserves today's behavior exactly (no plan member, no dispatches).
    let realities: string[] | undefined;
    const realityEntries = form.getAll("realities").filter((entry) => typeof entry === "string");
    if (realityEntries.length > 0) {
      const first = realityEntries[0] as string;
      if (realityEntries.length === 1 && first.trim().startsWith("[")) {
        try {
          const parsed = JSON.parse(first) as unknown;
          if (!Array.isArray(parsed) || !parsed.every((entry) => typeof entry === "string")) {
            throw new Error("not an array of strings");
          }
          realities = parsed as string[];
        } catch {
          const { IdentityValidationError } = await import("@sporta/identity");
          throw new IdentityValidationError(
            "the 'realities' field must be a JSON array of derived reality kinds " +
              "(tactical | three-d-game | anime-npr) or repeated form fields",
          );
        }
      } else {
        realities = realityEntries as string[];
      }
    }

    // J004 (additive): the ONE compute selection directive covering the
    // whole plan — the same R407 vocabulary the renders route carries. The
    // DIRECTOR validates the semantics; this only checks the wire shape so
    // malformed payloads answer the typed 400 instead of reaching it as
    // garbage.
    let compute:
      | {
          mode: "user-explicit" | "sporta-auto";
          providerId?: string;
          preference?: {
            privacyPosture: "privacy-local-only" | "privacy-any";
            maxEstimatedCostUsd?: number;
            maxEstimatedQueueSeconds?: number;
            vramFloorMb?: number;
            capabilityClass?: string;
          };
        }
      | undefined;
    const computeEntry = form.get("compute");
    if (typeof computeEntry === "string" && computeEntry.trim().length > 0) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(computeEntry);
      } catch {
        const { IdentityValidationError } = await import("@sporta/identity");
        throw new IdentityValidationError(
          "the 'compute' field must be a JSON compute-selection directive object",
        );
      }
      if (!isComputeDirectiveShape(parsed)) {
        const { IdentityValidationError } = await import("@sporta/identity");
        throw new IdentityValidationError(
          "the 'compute' field must be a compute-selection directive " +
            "({ mode: 'user-explicit' | 'sporta-auto', providerId?, preference? })",
        );
      }
      compute = parsed;
    }

    const styleEntry = form.get("styleId");
    const session = await server.studio.createUploadSession({
      token,
      bytes,
      ...(typeof file.name === "string" && file.name.length > 0 ? { filename: file.name } : {}),
      declaration: {
        operations,
        ...(typeof expiresAtIso === "string" && expiresAtIso.length > 0 ? { expiresAtIso } : {}),
        ...(storageDays !== undefined && Number.isFinite(storageDays)
          ? { storageDurationDays: storageDays }
          : {}),
        ...(typeof sharingScope === "string" && sharingScope.length > 0 ? { sharingScope } : {}),
      },
      ...(typeof label === "string" && label.length > 0 ? { label } : {}),
      ...(realities !== undefined ? { realities } : {}),
      ...(compute !== undefined ? { compute } : {}),
      ...(typeof styleEntry === "string" && styleEntry.length > 0 ? { styleId: styleEntry } : {}),
    });
    return jsonResponse(201, session);
  } catch (err) {
    return errorResponse(err);
  }
}

/**
 * Structural check for the J004 compute directive (the R407 vocabulary) —
 * the same wire shape the renders route accepts; the SelectionDirector
 * validates the semantics (mode/provider pairing, preference axes).
 */
function isComputeDirectiveShape(value: unknown): value is {
  mode: "user-explicit" | "sporta-auto";
  providerId?: string;
  preference?: {
    privacyPosture: "privacy-local-only" | "privacy-any";
    maxEstimatedCostUsd?: number;
    maxEstimatedQueueSeconds?: number;
    vramFloorMb?: number;
    capabilityClass?: string;
  };
} {
  if (typeof value !== "object" || value === null) return false;
  const directive = value as Record<string, unknown>;
  if (directive.mode !== "user-explicit" && directive.mode !== "sporta-auto") {
    return false;
  }
  if (
    directive.providerId !== undefined &&
    (typeof directive.providerId !== "string" || directive.providerId.length === 0)
  ) {
    return false;
  }
  const preference = directive.preference;
  if (preference !== undefined) {
    if (typeof preference !== "object" || preference === null) return false;
    const pref = preference as Record<string, unknown>;
    if (pref.privacyPosture !== "privacy-local-only" && pref.privacyPosture !== "privacy-any") {
      return false;
    }
  }
  return true;
}
