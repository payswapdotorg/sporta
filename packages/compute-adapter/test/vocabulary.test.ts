/**
 * Vocabulary-alignment tests (W914 Wave 1): every closed vocabulary the
 * compute-adapter contract claims to mirror from an existing package is
 * pinned here against the REAL package, so drift fails the suite.
 *
 * Two pin mechanisms, both honest about what they catch:
 *
 * 1. **Runtime values** where the source package exports one (zod schemas,
 *    metric-name records): imported and compared directly.
 * 2. **Source scans** where the source vocabulary is a TYPE-ONLY union or
 *    interface (the W303 protocol types, the W007 correlation triple, the
 *    W504 artifact metadata, the anime renderer identity): the union
 *    members / field names are extracted from the package's own source, so
 *    an addition, removal, OR rename on either side fails the pin (the
 *    viewer-shell boundary-test precedent for scanning source from tests).
 *
 * These are DEV-ONLY imports and scans (test/, never src/) — the contract
 * layer itself stays `zod`-only (pinned by test/boundary.test.ts).
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { OutputProfile, TerminalFailureClass } from "@sporta/contracts";
import { GPU_METRIC_NAMES } from "@sporta/gpu-worker";
import { METRIC_NAMES } from "@sporta/observability";
import { COMPUTE_FAILURE_CLASSES } from "../src/errors";
import { COMPUTE_JOB_STATES, COMPUTE_TERMINAL_DISPOSITIONS } from "../src/states";
import {
  COMPUTE_SCHEMA_VERSION,
  ComputeJobEventType,
  ComputeJobState,
  ComputeJobTiming,
  ComputeOutputProfile,
  ComputeTerminalClass,
  ComputeTerminalDisposition,
} from "../src/schemas";

/** Packages root: `import.meta.dir` is `<pkg>/test`, so two dirname ups. */
const PACKAGES_ROOT = dirname(dirname(import.meta.dir));

/** Reads one package source file (the scan source of truth). */
function readSource(...segments: string[]): string {
  return readFileSync(join(PACKAGES_ROOT, ...segments), "utf8");
}

/**
 * Extracts the quoted members of `export type <name> = "a" | "b" | ...;`
 * from a package's source. Multi-line unions included (the W303 style).
 */
function unionMembersOf(source: string, typeName: string): string[] {
  const match = source.match(new RegExp(`export type ${typeName} =\\s*([\\s\\S]*?);`));
  if (match === null) {
    throw new Error(`union '${typeName}' not found in the scanned source (drift?)`);
  }
  const members = [...match[1]!.matchAll(/"([^"]+)"/g)].map((m) => m[1]!);
  if (members.length < 1) {
    throw new Error(`union '${typeName}' scanned to zero members (parser drift?)`);
  }
  return members;
}

/** Extracts the field names of `export interface <name> { ... }` from source. */
function interfaceFieldsOf(source: string, interfaceName: string): string[] {
  const match = source.match(new RegExp(`export interface ${interfaceName} \\{([\\s\\S]*?)\\n\\}`));
  if (match === null) {
    throw new Error(`interface '${interfaceName}' not found in the scanned source (drift?)`);
  }
  const fields = [...match[1]!.matchAll(/^\s{2}(\w+)[?]?:/gm)].map((m) => m[1]!);
  if (fields.length < 1) {
    throw new Error(`interface '${interfaceName}' scanned to zero fields (parser drift?)`);
  }
  return fields;
}

// --- the scanned sources (read once; missing files fail loudly) -------------
const GPU_TYPES = readSource("gpu-worker", "src", "types.ts");
const OBSERVABILITY_CORRELATION = readSource("observability", "src", "correlation.ts");
const OUTPUT_TYPES = readSource("output-pipeline", "src", "types.ts");
const ANIME_IDENTITY = readSource("renderer-anime", "src", "identity.ts");

describe("W303 gpu-worker vocabulary (source-scanned, both directions)", () => {
  test("terminal dispositions are VERBATIM GpuTerminalDisposition", () => {
    const gpu = unionMembersOf(GPU_TYPES, "GpuTerminalDisposition");
    expect([...COMPUTE_TERMINAL_DISPOSITIONS] as string[]).toEqual(gpu);
    expect(ComputeTerminalDisposition.options as string[]).toEqual(gpu);
  });

  test("live states are the live members of GpuJobState; additions are exactly admitted+dispatched", () => {
    const gpu = unionMembersOf(GPU_TYPES, "GpuJobState");
    const gpuLive = gpu.filter((state) => !COMPUTE_TERMINAL_DISPOSITIONS.includes(state as never));
    expect(gpuLive).toEqual(["queued", "in-flight"]);
    const computeLive = COMPUTE_JOB_STATES.filter(
      (state) => !COMPUTE_TERMINAL_DISPOSITIONS.includes(state as never),
    );
    // The compute live states are the W303 live states PLUS the two
    // documented adapter-level additions — nothing else.
    expect(computeLive.filter((s) => !gpuLive.includes(s))).toEqual(["admitted", "dispatched"]);
    expect(computeLive).toEqual(["admitted", "dispatched", "queued", "in-flight"]);
  });

  test("the full state vocabulary parses as the zod enum (closed, no extras)", () => {
    for (const state of COMPUTE_JOB_STATES) {
      expect(ComputeJobState.safeParse(state).success).toBe(true);
    }
    expect(ComputeJobState.options).toEqual([...COMPUTE_JOB_STATES]);
  });

  test("event kinds are GpuJobEventType VERBATIM plus dispatched+progress", () => {
    const gpu = unionMembersOf(GPU_TYPES, "GpuJobEventType");
    const compute = ComputeJobEventType.options;
    expect(compute.filter((kind) => !gpu.includes(kind)) as string[]).toEqual([
      "dispatched",
      "progress",
    ]);
    // every W303 event kind survives verbatim (no renames on the shared core)
    for (const kind of gpu) {
      expect(compute as string[]).toContain(kind);
    }
  });

  test("terminal failure classes are VERBATIM GpuTerminalClass", () => {
    const gpu = unionMembersOf(GPU_TYPES, "GpuTerminalClass");
    expect(ComputeTerminalClass.options as string[]).toEqual(gpu);
  });

  test("result-timing field names are VERBATIM GpuJobResultTiming", () => {
    const gpu = interfaceFieldsOf(GPU_TYPES, "GpuJobResultTiming");
    // The compute timing mirror must use exactly the W303 field names.
    expect(Object.keys(ComputeJobTiming.shape).sort()).toEqual([...gpu].sort());
  });
});

describe("contracts-package vocabulary (runtime zod schemas)", () => {
  test("failure classes mirror the contracts TerminalFailureClass enum", () => {
    expect([...COMPUTE_FAILURE_CLASSES]).toEqual([...TerminalFailureClass.options]);
  });

  test("the output profile mirrors the contracts OutputProfile shape", () => {
    const contractsKeys = Object.keys(OutputProfile.shape).sort();
    const computeKeys = Object.keys(ComputeOutputProfile.shape).sort();
    expect(computeKeys).toEqual(contractsKeys);
    // The nested resolution keys too.
    expect(Object.keys(ComputeOutputProfile.shape.resolution.shape)).toEqual(["w", "h"]);
  });
});

describe("observability vocabulary (runtime + scan)", () => {
  test("METRIC_NAMES is the W007 six-series recommended vocabulary", () => {
    expect(Object.values(METRIC_NAMES)).toEqual([
      "frames_dropped",
      "queue_depth",
      "stage_latency_ms",
      "model_latency_ms",
      "renderer_latency_ms",
      "e2e_latency_ms",
    ]);
  });

  test("GPU_METRIC_NAMES is the W303 series set (21 entries)", () => {
    expect(Object.keys(GPU_METRIC_NAMES)).toHaveLength(21);
    expect(GPU_METRIC_NAMES.jobLatencyMs).toBe("gpu_job_latency_ms");
    expect(GPU_METRIC_NAMES.queueWaitMs).toBe("gpu_job_queue_wait_ms");
  });

  test("the W007 CorrelationContext triple is exactly what the job description carries", () => {
    const fields = interfaceFieldsOf(OBSERVABILITY_CORRELATION, "CorrelationContext");
    expect(fields).toEqual(["sessionId", "correlationId", "traceId"]);
  });
});

describe("W504 output-pipeline vocabulary (source-scanned)", () => {
  test("artifact metadata field names are VERBATIM AnimeArtifactMetadata", () => {
    const fields = interfaceFieldsOf(OUTPUT_TYPES, "AnimeArtifactMetadata");
    expect(fields).toEqual([
      "sessionId",
      "renderId",
      "segmentId",
      "snapshotVersion",
      "frameCount",
      "totalDurationMs",
    ]);
  });

  test("the renderer fixture id is the REAL anime prototype id", () => {
    const match = ANIME_IDENTITY.match(/export const ANIME_RENDERER_ID = "([^"]+)"/);
    expect(match).not.toBeNull();
    // makeDescriptor()/makeJob() in test/helpers.ts use this exact id.
    expect(match![1]).toBe("anime.prototype");
  });
});

describe("the schema-version literal", () => {
  test("COMPUTE_SCHEMA_VERSION is the MAJOR.MINOR the schemas pin", () => {
    expect(COMPUTE_SCHEMA_VERSION).toBe("1.0");
  });
});
