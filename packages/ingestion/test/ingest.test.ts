/**
 * W101 ingestSource tests: fail-closed rights gate ordering, resource bounds,
 * container allowlist, receipt/checksum correctness, checksum-keyed
 * idempotency, and the observability contract (one structured JSON log line
 * per decision path + metrics counters).
 *
 * Deterministic per docs/testing/HARNESS.md: no clock reads (nowMs is an
 * explicit constant), authorization policies come from @sporta/testing
 * builders, and expected checksums are computed in-test with Bun's
 * CryptoHasher over fixed byte buffers.
 */
import { describe, expect, test } from "bun:test";
import { MetricsRegistry, createLogger } from "@sporta/observability";
import type { Logger } from "@sporta/observability";
import { TEST_EPOCH_MS, buildAuthorizationPolicy } from "@sporta/testing";
import {
  DEFAULT_INGESTION_POLICY,
  ResourceLimitError,
  RightsDeniedError,
  SourceRegistry,
  UnsupportedMediaError,
  ingestSource,
  noopObservability,
} from "../src/index";
import type { Container, IngestionSourceInput } from "../src/index";

// --- deterministic byte fixtures (inline, no fixture files) ----------------

/** Minimal mp4: size box (0x20=32), "ftyp", "isom" brand, zero padding. */
function mp4Bytes(): Uint8Array {
  const bytes = new Uint8Array(32);
  bytes.set([0x00, 0x00, 0x00, 0x20, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d], 0);
  return bytes;
}

/** Minimal webm: EBML magic + DocType element (0x4282, len 4, "webm"). */
function webmBytes(): Uint8Array {
  const bytes = new Uint8Array(32);
  bytes.set([0x1a, 0x45, 0xdf, 0xa3, 0x84, 0x42, 0x82, 0x84, 0x77, 0x65, 0x62, 0x6d], 0);
  return bytes;
}

/** Minimal mkv: EBML magic + DocType element (len 8, "matroska"). */
function mkvBytes(): Uint8Array {
  const bytes = new Uint8Array(32);
  bytes.set(
    [
      0x1a, 0x45, 0xdf, 0xa3, 0x84, 0x42, 0x82, 0x88, 0x6d, 0x61, 0x74, 0x72, 0x6f, 0x73, 0x6b,
      0x61,
    ],
    0,
  );
  return bytes;
}

/** Minimal mpegts: 189 bytes with 0x47 sync at offsets 0 and 188. */
function mpegtsBytes(): Uint8Array {
  const bytes = new Uint8Array(189);
  bytes[0] = 0x47;
  bytes[188] = 0x47;
  bytes.fill(0x11, 1, 188);
  return bytes;
}

/** Minimal avi: RIFF header + "AVI " form type. */
function aviBytes(): Uint8Array {
  const bytes = new Uint8Array(64);
  bytes.set([0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x10, 0x00, 0x41, 0x56, 0x49, 0x20], 0);
  return bytes;
}

/** Bytes matching no known container signature. */
function garbageBytes(): Uint8Array {
  const bytes = new Uint8Array(16);
  bytes.fill(0xa5);
  return bytes;
}

/** sha-256 of `bytes` as lowercase hex (the same primitive ingestSource uses). */
function sha256Hex(bytes: Uint8Array): string {
  const hasher = new Bun.CryptoHasher("sha256");
  hasher.update(bytes);
  return hasher.digest("hex");
}

// --- helpers ---------------------------------------------------------------

/** Runs ingestSource and returns the thrown error (undefined on success). */
function captureIngestError(input: IngestionSourceInput): unknown {
  try {
    ingestSource(input);
  } catch (err) {
    return err;
  }
  return undefined;
}

/** Reads a counter series value (0 when the series does not exist yet). */
function counterValue(
  metrics: MetricsRegistry,
  name: string,
  labels: Record<string, string> = {},
): number {
  const canonical = (record: Record<string, string>): string =>
    Object.keys(record)
      .sort()
      .map((key) => `${key}=${record[key] ?? ""}`)
      .join(",");
  const want = canonical(labels);
  return (
    metrics
      .snapshot()
      .counters.filter((series) => series.name === name)
      .find((series) => canonical(series.labels) === want)?.value ?? 0
  );
}

/** A policy valid at TEST_EPOCH (analysis allowed, far-future expiry). */
const validPolicy = buildAuthorizationPolicy();

/** Base happy-path input; every field is deterministic. */
function happyInput(overrides: Partial<IngestionSourceInput> = {}): IngestionSourceInput {
  return {
    sessionId: "sess-ingest",
    bytes: mp4Bytes(),
    sourceKind: "file",
    filename: "match.mp4",
    authorizationPolicy: validPolicy,
    nowMs: TEST_EPOCH_MS,
    ...overrides,
  };
}

// --- tests -----------------------------------------------------------------

describe("ingestSource — happy path", () => {
  test("returns a complete, checksum-correct receipt", () => {
    const bytes = mp4Bytes();
    const receipt = ingestSource(happyInput({ bytes }));

    const checksum = sha256Hex(bytes);
    expect(receipt.sessionId).toBe("sess-ingest");
    expect(receipt.checksum).toBe(checksum);
    expect(receipt.sourceId).toBe(`src-${checksum.slice(0, 12)}`);
    expect(receipt.container).toBe("mp4");
    expect(receipt.byteLength).toBe(bytes.byteLength);
    expect(receipt.ingestedAtMs).toBe(TEST_EPOCH_MS);
    expect(receipt.sourceKind).toBe("file");
    expect(receipt.filename).toBe("match.mp4");
  });

  test("accepts every container in the default allowlist", () => {
    const samples: ReadonlyArray<[Uint8Array, Container]> = [
      [mp4Bytes(), "mp4"],
      [webmBytes(), "webm"],
      [mkvBytes(), "mkv"],
      [mpegtsBytes(), "mpegts"],
    ];
    for (const [bytes, container] of samples) {
      const receipt = ingestSource(
        happyInput({ bytes, sessionId: `sess-${container}`, filename: undefined }),
      );
      expect(receipt.container).toBe(container);
    }
  });

  test("supports stream sources without a filename", () => {
    const receipt = ingestSource(happyInput({ sourceKind: "stream", filename: undefined }));
    expect(receipt.sourceKind).toBe("stream");
    expect(receipt.filename).toBeUndefined();
  });

  test("uses the injected nowMs as ingestedAtMs (no clock reads)", () => {
    const receipt = ingestSource(happyInput({ nowMs: 42 }));
    expect(receipt.ingestedAtMs).toBe(42);
  });
});

describe("ingestSource — rights gate (fail closed, first)", () => {
  test("denies when the policy does not allow analysis", () => {
    const noAnalysis = buildAuthorizationPolicy({ allowedOperations: ["transformation"] });
    const err = captureIngestError(happyInput({ authorizationPolicy: noAnalysis }));
    expect(err).toBeInstanceOf(RightsDeniedError);
    const rights = err as RightsDeniedError;
    expect(rights.terminalFailureClass).toBe("rights-denied");
    expect(rights.failureClass).toBe("rights-denied");
    expect(rights.details.reason).toBe("missing-operation");
    expect(rights.details.requiredOperation).toBe("analysis");
    expect(rights.details.policyId).toBe(noAnalysis.policyId);
  });

  test("denies when the policy is expired at nowMs", () => {
    const expired = buildAuthorizationPolicy({ expiresAtIso: "2024-06-01T00:00:00.000Z" });
    const err = captureIngestError(happyInput({ authorizationPolicy: expired }));
    expect(err).toBeInstanceOf(RightsDeniedError);
    expect((err as RightsDeniedError).details.reason).toBe("expired-policy");
  });

  test("denies at the exact expiry boundary (expiry <= now denies)", () => {
    const expiresAtNow = buildAuthorizationPolicy({
      expiresAtIso: new Date(TEST_EPOCH_MS).toISOString(),
    });
    const err = captureIngestError(happyInput({ authorizationPolicy: expiresAtNow }));
    expect(err).toBeInstanceOf(RightsDeniedError);
    expect((err as RightsDeniedError).details.reason).toBe("expired-policy");
  });

  test("denies when no policy decision exists (undefined/null)", () => {
    for (const authorizationPolicy of [undefined, null]) {
      const err = captureIngestError(happyInput({ authorizationPolicy }));
      expect(err).toBeInstanceOf(RightsDeniedError);
      expect((err as RightsDeniedError).details.reason).toBe("missing-policy");
      expect((err as RightsDeniedError).details.requiredOperation).toBe("analysis");
    }
  });

  test("fires BEFORE the size and container checks (no info leak)", () => {
    const noAnalysis = buildAuthorizationPolicy({ allowedOperations: ["transformation"] });
    // Bytes that would ALSO fail the size check (32 bytes > maxBytes 1) and a
    // rights-denied must still win: the gate runs first.
    const err = captureIngestError(
      happyInput({
        authorizationPolicy: noAnalysis,
        policy: { allowedContainers: ["mp4"], maxBytes: 1 },
      }),
    );
    expect(err).toBeInstanceOf(RightsDeniedError);
    expect(err).not.toBeInstanceOf(ResourceLimitError);
  });
});

describe("ingestSource — resource bounds", () => {
  test("rejects oversize sources with resource-limit", () => {
    const err = captureIngestError(
      happyInput({
        policy: { allowedContainers: DEFAULT_INGESTION_POLICY.allowedContainers, maxBytes: 8 },
      }),
    );
    expect(err).toBeInstanceOf(ResourceLimitError);
    const limit = err as ResourceLimitError;
    expect(limit.terminalFailureClass).toBe("resource-limit");
    expect(limit.failureClass).toBe("resource-limit");
    expect(limit.details.byteLength).toBe(32);
    expect(limit.details.maxBytes).toBe(8);
    expect(limit.message).toContain("size limit");
  });

  test("accepts input exactly at maxBytes (boundary is inclusive)", () => {
    const receipt = ingestSource(
      happyInput({ policy: { allowedContainers: ["mp4"], maxBytes: 32 } }),
    );
    expect(receipt.byteLength).toBe(32);
  });
});

describe("ingestSource — container allowlist", () => {
  test("rejects avi bytes under an mp4-only policy with structured details", () => {
    const err = captureIngestError(
      happyInput({
        bytes: aviBytes(),
        policy: { allowedContainers: ["mp4"], maxBytes: 1_000_000 },
      }),
    );
    expect(err).toBeInstanceOf(UnsupportedMediaError);
    const media = err as UnsupportedMediaError;
    expect(media.terminalFailureClass).toBe("media-invalid");
    expect(media.failureClass).toBe("media-invalid");
    expect(media.details.detectedContainer).toBe("avi");
    expect(media.details.detectedMimeType).toBe("video/x-msvideo");
    expect(media.details.allowedContainers).toEqual(["mp4"]);
    expect(media.details.byteLength).toBe(64);
  });

  test("rejects avi under the DEFAULT policy (not on the streaming allowlist)", () => {
    const err = captureIngestError(happyInput({ bytes: aviBytes() }));
    expect(err).toBeInstanceOf(UnsupportedMediaError);
    expect((err as UnsupportedMediaError).details.detectedContainer).toBe("avi");
  });

  test("rejects unknown-container bytes clearly", () => {
    const err = captureIngestError(happyInput({ bytes: garbageBytes() }));
    expect(err).toBeInstanceOf(UnsupportedMediaError);
    expect((err as UnsupportedMediaError).details.detectedContainer).toBe("unknown");
    expect((err as UnsupportedMediaError).message).toContain("unknown");
  });

  test("rejects an empty buffer as media-invalid", () => {
    const err = captureIngestError(happyInput({ bytes: new Uint8Array(0) }));
    expect(err).toBeInstanceOf(UnsupportedMediaError);
    expect((err as UnsupportedMediaError).details.detectedContainer).toBe("unknown");
  });
});

describe("ingestSource — idempotency (duplicates tolerated)", () => {
  test("identical bytes return the SAME receipt (first ingestion wins)", () => {
    const registry = new SourceRegistry();
    const first = ingestSource(happyInput({ registry }));
    const second = ingestSource(happyInput({ registry, nowMs: TEST_EPOCH_MS + 5_000 }));
    expect(second).toEqual(first);
    expect(second.ingestedAtMs).toBe(first.ingestedAtMs); // NOT the later nowMs
    expect(second.sourceId).toBe(first.sourceId);
    expect(registry.size).toBe(1);
  });

  test("different bytes produce distinct sources in the registry", () => {
    const registry = new SourceRegistry();
    const a = ingestSource(happyInput({ registry, bytes: mp4Bytes() }));
    const b = ingestSource(happyInput({ registry, bytes: webmBytes() }));
    expect(b.sourceId).not.toBe(a.sourceId);
    expect(b.checksum).not.toBe(a.checksum);
    expect(registry.size).toBe(2);
  });

  test("without a shared registry, receipts are fresh but sourceIds stay deterministic", () => {
    const a = ingestSource(happyInput({ nowMs: 1_000 }));
    const b = ingestSource(happyInput({ nowMs: 2_000 }));
    expect(b.sourceId).toBe(a.sourceId); // same bytes -> same checksum prefix
    expect(b.ingestedAtMs).toBe(2_000); // no shared registry -> new receipt
    expect(a.ingestedAtMs).toBe(1_000);
  });

  test("receipts are frozen (callers cannot mutate registered state)", () => {
    const receipt = ingestSource(happyInput());
    expect(() => {
      (receipt as { container: string }).container = "avi";
    }).toThrow(TypeError);
  });
});

describe("ingestSource — observability contract", () => {
  function collectorLogger(lines: string[]): Logger {
    return createLogger({
      sink: (line) => {
        lines.push(line);
      },
      now: () => TEST_EPOCH_MS,
    });
  }

  test("accept: exactly one info line (valid JSON, sessionId + stage) + counters", () => {
    const lines: string[] = [];
    const metrics = new MetricsRegistry();
    ingestSource(
      happyInput({
        sessionId: "sess-obs",
        observability: {
          logger: collectorLogger(lines),
          metrics,
          correlation: { sessionId: "sess-obs", correlationId: "corr-42", traceId: "trace-42" },
        },
      }),
    );

    expect(lines).toHaveLength(1);
    const record = JSON.parse(lines[0]!) as Record<string, unknown>;
    expect(record).toMatchObject({
      level: "info",
      msg: "ingest accepted",
      sessionId: "sess-obs",
      stage: "ingestion",
      correlationId: "corr-42",
      traceId: "trace-42",
      ts: TEST_EPOCH_MS,
    });
    const fields = record.fields as Record<string, unknown>;
    expect(fields.sourceId).toMatch(/^src-[0-9a-f]{12}$/);
    expect(fields.checksum).toMatch(/^[0-9a-f]{64}$/);
    expect(fields.container).toBe("mp4");
    expect(fields.byteLength).toBe(32);
    expect(fields.sourceKind).toBe("file");
    expect(fields.duplicate).toBeUndefined();

    expect(counterValue(metrics, "ingest_accepted")).toBe(1);
    expect(counterValue(metrics, "ingest_rejected_total")).toBe(0);
  });

  test("duplicate accept: one info line flagged duplicate, accepted counter bumps", () => {
    const lines: string[] = [];
    const metrics = new MetricsRegistry();
    const registry = new SourceRegistry();
    const observability = { logger: collectorLogger(lines), metrics };
    ingestSource(happyInput({ observability, registry }));
    ingestSource(happyInput({ observability, registry, nowMs: TEST_EPOCH_MS + 1 }));

    expect(lines).toHaveLength(2);
    const duplicate = JSON.parse(lines[1]!) as Record<string, unknown>;
    expect(duplicate.level).toBe("info");
    expect((duplicate.fields as Record<string, unknown>).duplicate).toBe(true);
    expect(counterValue(metrics, "ingest_accepted")).toBe(2);
  });

  test("rights rejection: one warn line + total and per-class counters", () => {
    const lines: string[] = [];
    const metrics = new MetricsRegistry();
    const noAnalysis = buildAuthorizationPolicy({ allowedOperations: ["transformation"] });
    expect(() =>
      ingestSource(
        happyInput({
          sessionId: "sess-obs",
          authorizationPolicy: noAnalysis,
          observability: { logger: collectorLogger(lines), metrics },
        }),
      ),
    ).toThrow(RightsDeniedError);

    expect(lines).toHaveLength(1);
    const record = JSON.parse(lines[0]!) as Record<string, unknown>;
    expect(record).toMatchObject({
      level: "warn",
      msg: "ingest rejected",
      sessionId: "sess-obs",
      stage: "ingestion",
    });
    const fields = record.fields as Record<string, unknown>;
    expect(fields.failureClass).toBe("rights-denied");
    expect(fields.reason).toBe("missing-operation");

    expect(counterValue(metrics, "ingest_accepted")).toBe(0);
    expect(counterValue(metrics, "ingest_rejected_total")).toBe(1);
    expect(counterValue(metrics, "ingest_rejected_total", { failure_class: "rights-denied" })).toBe(
      1,
    );
  });

  test("media rejection bumps the media-invalid per-class counter", () => {
    const metrics = new MetricsRegistry();
    expect(() =>
      ingestSource(
        happyInput({
          bytes: aviBytes(),
          policy: { allowedContainers: ["mp4"], maxBytes: 1_000_000 },
          observability: { metrics },
        }),
      ),
    ).toThrow(UnsupportedMediaError);
    expect(counterValue(metrics, "ingest_rejected_total")).toBe(1);
    expect(counterValue(metrics, "ingest_rejected_total", { failure_class: "media-invalid" })).toBe(
      1,
    );
    expect(counterValue(metrics, "ingest_rejected_total", { failure_class: "rights-denied" })).toBe(
      0,
    );
  });

  test("mixed batch: every emitted line is valid JSON with sessionId + stage", () => {
    const lines: string[] = [];
    const metrics = new MetricsRegistry();
    const observability = { logger: collectorLogger(lines), metrics };
    const registry = new SourceRegistry();
    const noAnalysis = buildAuthorizationPolicy({ allowedOperations: ["transformation"] });
    const base = {
      sessionId: "sess-batch",
      bytes: mp4Bytes(),
      sourceKind: "file" as const,
      observability,
      registry,
      nowMs: TEST_EPOCH_MS,
    };

    ingestSource({ ...base, authorizationPolicy: validPolicy }); // info accept
    ingestSource({ ...base, authorizationPolicy: validPolicy }); // info duplicate
    expect(() => ingestSource({ ...base, authorizationPolicy: noAnalysis })).toThrow(
      RightsDeniedError,
    ); // warn rights
    expect(() =>
      ingestSource({
        ...base,
        authorizationPolicy: validPolicy,
        policy: { allowedContainers: ["mp4"], maxBytes: 8 },
      }),
    ).toThrow(ResourceLimitError); // warn size
    expect(() =>
      ingestSource({
        ...base,
        bytes: aviBytes(),
        authorizationPolicy: validPolicy,
        policy: { allowedContainers: ["mp4"], maxBytes: 1_000_000 },
      }),
    ).toThrow(UnsupportedMediaError); // warn container

    expect(lines).toHaveLength(5);
    const records = lines.map((line) => JSON.parse(line) as Record<string, unknown>);
    for (const record of records) {
      // Every line parses (asserted by map) and carries the session + stage.
      expect(record.sessionId).toBe("sess-batch");
      expect(record.stage).toBe("ingestion");
    }
    expect(records.map((record) => record.level)).toEqual(["info", "info", "warn", "warn", "warn"]);

    expect(counterValue(metrics, "ingest_accepted")).toBe(2);
    expect(counterValue(metrics, "ingest_rejected_total")).toBe(3);
    expect(counterValue(metrics, "ingest_rejected_total", { failure_class: "rights-denied" })).toBe(
      1,
    );
    expect(
      counterValue(metrics, "ingest_rejected_total", { failure_class: "resource-limit" }),
    ).toBe(1);
    expect(counterValue(metrics, "ingest_rejected_total", { failure_class: "media-invalid" })).toBe(
      1,
    );
  });

  test("works silently when no observability is provided (no-op defaults)", () => {
    expect(() => ingestSource(happyInput())).not.toThrow();
    expect(() => ingestSource(happyInput({ observability: undefined }))).not.toThrow();
  });
});

describe("noopObservability", () => {
  test("returns silent, usable logger and metrics defaults", () => {
    const noop = noopObservability();
    expect(() => noop.logger.info("silent")).not.toThrow();
    expect(() => noop.logger.warn("silent")).not.toThrow();
    expect(() => noop.metrics.counter("ingest_accepted").inc()).not.toThrow();
    expect(counterValue(noop.metrics, "ingest_accepted")).toBe(1);
  });

  test("provides fresh state per call (no leakage between ingestions)", () => {
    const a = noopObservability();
    const b = noopObservability();
    a.metrics.counter("ingest_accepted").inc();
    expect(counterValue(b.metrics, "ingest_accepted")).toBe(0);
  });
});
