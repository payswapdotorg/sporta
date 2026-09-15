/**
 * Wave-2 additions to the compute-adapter contract: canonical serialization
 * + content addressing (`./canonical.ts`) and the materialized-input
 * dispatch request (`./materialized.ts`).
 *
 * Pins:
 *
 * - canonical JSON is ORDER-INDEPENDENT for object keys (the same document
 *   with differently-ordered keys serializes to the SAME bytes) and total
 *   for JSON values; non-JSON values (undefined/functions/symbols/bigints/
 *   cycles/non-finite numbers) reject loudly;
 * - `sha256OfCanonicalJson` agrees with the W504 `contentHashOf` convention
 *   (sha-256 over UTF-8, 64 lowercase hex — cross-checked against the REAL
 *   `@sporta/output-pipeline` hasher, dev-dependency);
 * - `ComputeDispatchRequest` enforces exact manifest coverage, kind
 *   matching, and kind-shaped payload envelopes;
 * - `materializedInputIssues` (the pure validator both adapters and
 *   providers reuse) reports every defect, not just the first.
 */
import { describe, expect, test } from "bun:test";
import { contentHashOf } from "@sporta/output-pipeline";
import {
  ComputeDispatchRequest,
  ComputeJobDescription,
  InMemoryComputeAdapter,
  canonicalByteLengthOf,
  canonicalJsonOf,
  materializedInputIssues,
  sha256OfCanonicalJson,
} from "../src/index";
import type { ComputeAdapterPort } from "../src/index";
import { makeJob } from "./helpers";

/** A parsed valid job description (helpers.makeJob + overrides, schema-parsed). */
function validJobDescription(overrides: Record<string, unknown> = {}): ComputeJobDescription {
  const parsed = ComputeJobDescription.safeParse(makeJob(overrides));
  if (!parsed.success) {
    throw new Error(`test fixture job is invalid: ${JSON.stringify(parsed.error.issues)}`);
  }
  return parsed.data;
}

describe("canonicalJsonOf — deterministic, order-independent, loud", () => {
  test("object key order does not matter (recursively)", () => {
    const a = { z: 1, a: { y: [1, 2, { b: 1, a: 2 }], x: "s" }, m: null, t: true };
    const b = { t: true, m: null, a: { x: "s", y: [1, 2, { a: 2, b: 1 }] }, z: 1 };
    expect(canonicalJsonOf(a)).toBe(canonicalJsonOf(b));
    expect(canonicalJsonOf(a)).toBe('{"a":{"x":"s","y":[1,2,{"a":2,"b":1}]},"m":null,"t":true,"z":1}');
  });

  test("scalars, empty containers, and escaping", () => {
    expect(canonicalJsonOf(null)).toBe("null");
    expect(canonicalJsonOf(true)).toBe("true");
    expect(canonicalJsonOf(-0.5)).toBe("-0.5");
    expect(canonicalJsonOf([])).toBe("[]");
    expect(canonicalJsonOf({})).toBe("{}");
    expect(canonicalJsonOf({ k: '"\\\n' })).toBe('{"k":"\\"\\\\\\n"}');
    // Array order is preserved (order is semantic).
    expect(canonicalJsonOf([3, 1, 2])).toBe("[3,1,2]");
  });

  test("non-JSON values reject loudly (never a silent fallback)", () => {
    const bad: unknown[] = [
      undefined,
      () => 1,
      Symbol("x"),
      10n,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      [undefined],
      { k: Number.NaN },
    ];
    for (const value of bad) {
      expect(() => canonicalJsonOf(value)).toThrow(TypeError);
    }
    const cyclic: unknown[] = [];
    cyclic.push(cyclic);
    expect(() => canonicalJsonOf(cyclic)).toThrow(TypeError);
  });

  test("canonicalByteLengthOf measures the UTF-8 bytes of the canonical form", () => {
    const encoder = new TextEncoder();
    // The canonical form of "héllo" is `"héllo"` (7 chars) — é is 2 UTF-8
    // bytes, so the byte length is 8, not the 7 char count and not the 5
    // code units of the raw string (the W504 byteLengthOf convention).
    expect(canonicalByteLengthOf("héllo")).toBe(encoder.encode('"héllo"').length);
    expect(canonicalByteLengthOf("héllo")).toBe(8);
    expect(canonicalByteLengthOf("héllo")).not.toBe(canonicalJsonOf("héllo").length);
    expect(canonicalByteLengthOf({ a: "é" })).toBe(
      encoder.encode(canonicalJsonOf({ a: "é" })).length,
    );
  });
});

describe("sha256OfCanonicalJson — the W504 content-addressing convention", () => {
  test("equals the W504 contentHashOf over the same canonical bytes", async () => {
    const value = {
      watermark: { watermarkMs: 0, sequence: 0 },
      entities: [{ entityId: "p-1", kind: "participant" }],
      generatedAtMs: 123,
      note: "héllo wörld",
    };
    const canonical = canonicalJsonOf(value);
    expect(await sha256OfCanonicalJson(value)).toBe(contentHashOf(canonical));
    expect(await sha256OfCanonicalJson(value)).toMatch(/^[0-9a-f]{64}$/);
  });

  test("key order does not change the hash (content addressing, not string hashing)", async () => {
    const a = await sha256OfCanonicalJson({ x: 1, y: 2 });
    const b = await sha256OfCanonicalJson({ y: 2, x: 1 });
    expect(a).toBe(b);
    const c = await sha256OfCanonicalJson({ x: 2, y: 1 });
    expect(c).not.toBe(a);
  });
});

describe("ComputeDispatchRequest — exact manifest coverage with kind-shaped payloads", () => {
  const snapshotPayload = { snapshotVersion: 1, snapshot: { sessionId: "s-1" } };
  const eventsPayload = { fromSequence: 0, entries: [] };

  function dispatch(inputs: unknown): unknown {
    const job: ComputeJobDescription = validJobDescription({
      inputs: [
        { inputId: "swm-snapshot", kind: "swm-snapshot", ref: "swm-snapshot:s-1:v1:seq0" },
        { inputId: "swm-events", kind: "swm-event-window", ref: "swm-events:s-1:since-0" },
      ],
    });
    return { job, inputs };
  }

  test("accepts exact coverage with matching kinds and shaped payloads", () => {
    const parsed = ComputeDispatchRequest.safeParse(
      dispatch([
        { inputId: "swm-snapshot", kind: "swm-snapshot", payload: snapshotPayload },
        { inputId: "swm-events", kind: "swm-event-window", payload: eventsPayload },
      ]),
    );
    expect(parsed.success).toBe(true);
  });

  test("rejects a missing manifest entry's payload (never half-materialized)", () => {
    const parsed = ComputeDispatchRequest.safeParse(
      dispatch([{ inputId: "swm-snapshot", kind: "swm-snapshot", payload: snapshotPayload }]),
    );
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.issues.some((issue) => issue.message.includes("swm-events"))).toBe(true);
    }
  });

  test("rejects a payload for an unknown inputId", () => {
    const parsed = ComputeDispatchRequest.safeParse(
      dispatch([
        { inputId: "swm-snapshot", kind: "swm-snapshot", payload: snapshotPayload },
        { inputId: "swm-events", kind: "swm-event-window", payload: eventsPayload },
        { inputId: "ghost", kind: "swm-snapshot", payload: snapshotPayload },
      ]),
    );
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(
        parsed.error.issues.some((issue) => issue.message.includes("'ghost' is not in the job's manifest")),
      ).toBe(true);
    }
  });

  test("rejects a kind mismatch between manifest entry and payload", () => {
    const parsed = ComputeDispatchRequest.safeParse(
      dispatch([
        { inputId: "swm-snapshot", kind: "swm-snapshot", payload: snapshotPayload },
        { inputId: "swm-events", kind: "swm-snapshot", payload: eventsPayload },
      ]),
    );
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(
        parsed.error.issues.some((issue) =>
          issue.message.includes("kind 'swm-snapshot' but the manifest declares 'swm-event-window'"),
        ),
      ).toBe(true);
    }
  });

  test("rejects malformed payload envelopes (snapshotVersion/fromSequence are required)", () => {
    const parsed = ComputeDispatchRequest.safeParse(
      dispatch([
        { inputId: "swm-snapshot", kind: "swm-snapshot", payload: { snapshot: {} } },
        { inputId: "swm-events", kind: "swm-event-window", payload: { fromSequence: 0 } },
      ]),
    );
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(
        parsed.error.issues.some((issue) => issue.message.includes("swm-snapshot payload")),
      ).toBe(true);
      expect(
        parsed.error.issues.some((issue) => issue.message.includes("swm-event-window payload")),
      ).toBe(true);
    }
  });

  test("rejects an empty inputs array and source-media materialization this wave", () => {
    expect(ComputeDispatchRequest.safeParse(dispatch([])).success).toBe(false);
    const job: ComputeJobDescription = validJobDescription({
      inputs: [
        { inputId: "src", kind: "source-media", ref: "media:clip-1" },
      ],
    });
    const parsed = ComputeDispatchRequest.safeParse({
      job,
      inputs: [{ inputId: "src", kind: "source-media", payload: { uri: "x" } }],
    });
    expect(parsed.success).toBe(false);
  });
});

describe("materializedInputIssues — the pure validator reports every defect", () => {
  test("multiple defects are all reported, in order", () => {
    const job: ComputeJobDescription = validJobDescription({
      inputs: [
        { inputId: "swm-snapshot", kind: "swm-snapshot", ref: "swm-snapshot:s-1:v1:seq0" },
        { inputId: "swm-events", kind: "swm-event-window", ref: "swm-events:s-1:since-0" },
      ],
    });
    const issues = materializedInputIssues(job, [
      { inputId: "ghost", kind: "swm-snapshot", payload: {} },
      { inputId: "swm-snapshot", kind: "swm-snapshot", payload: {} },
      { inputId: "swm-snapshot", kind: "swm-snapshot", payload: {} },
    ]);
    expect(issues.some((issue) => issue.includes("'ghost' is not in the job's manifest"))).toBe(
      true,
    );
    expect(issues.some((issue) => issue.includes("duplicate materialized inputId"))).toBe(true);
    expect(issues.some((issue) => issue.includes("'swm-events' has no materialized payload"))).toBe(
      true,
    );
    expect(issues.some((issue) => issue.includes("swm-snapshot payload"))).toBe(true);
  });

  test("clean inputs produce zero issues", () => {
    const job: ComputeJobDescription = validJobDescription({
      inputs: [
        { inputId: "swm-snapshot", kind: "swm-snapshot", ref: "swm-snapshot:s-1:v1:seq0" },
      ],
    });
    expect(
      materializedInputIssues(job, [
        { inputId: "swm-snapshot", kind: "swm-snapshot", payload: { snapshotVersion: 3, snapshot: {} } },
      ]),
    ).toEqual([]);
  });
});

describe("the dispatch port extension stays Wave-1 compatible", () => {
  test("the in-memory reference (1-param dispatch) still satisfies the port type", async () => {
    // Type-level pin: assigning the Wave-1 in-memory adapter to the extended
    // port compiles (implementations may ignore the materialized inputs).
    const adapter: ComputeAdapterPort = new InMemoryComputeAdapter({
      descriptor: {
        schemaVersion: "1.0",
        adapterId: "adapter-compat",
        adapterVersion: "1.0",
        providerKind: "in-memory",
        supportedRenderers: [{ rendererId: "anime.prototype" }],
        supportedLatencyClasses: ["offline"],
        maxConcurrentJobs: 1,
        dispatchTimeoutMs: 1000,
        maxJobDeadlineMs: 60000,
        costUnits: [{ unitId: "cpu-ms", unitKind: "time-ms" }],
      },
    });
    // A dispatch with materialized inputs does not break the reference
    // (it ignores them — in-process ref resolution).
    const job = validJobDescription();
    const outcome = await adapter.dispatch(job, [
      { inputId: job.inputs[0]!.inputId, kind: job.inputs[0]!.kind, payload: { snapshotVersion: 1, snapshot: {} } },
    ]);
    expect(outcome.disposition).toBe("admitted");
    const again = await adapter.dispatch(job);
    expect(again.disposition).toBe("duplicate");
  });
});
