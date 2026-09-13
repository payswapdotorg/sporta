/**
 * Unit tests for correlation contexts (W007 §3.2).
 *
 * The default id factory is a deterministic counter — its absolute values
 * depend on process-global call order, so exact-value assertions use an
 * INJECTED factory while the default is asserted by pattern and by the
 * consecutive-draw relationship (trace number = correlation number + 1).
 * StageMessage extraction is exercised through the @sporta/testing builder,
 * per the harness rule that fixtures come from seeded builders.
 */
import { describe, expect, test } from "bun:test";
import { buildStageMessage } from "@sporta/testing";
import { bindLogger, createCorrelationContext, fromStageMessage } from "../src/correlation";
import { createLogger } from "../src/logger";
import type { CorrelationContext } from "../src/correlation";

const SEED = 42;
const FIXED_TS = 1_736_164_800_000;

function idNumber(id: string, prefix: string): number {
  expect(id.startsWith(`${prefix}-`)).toBe(true);
  return Number.parseInt(id.slice(prefix.length + 1), 10);
}

describe("correlation context", () => {
  test("default id factory produces deterministic counter-based ids", () => {
    const first = createCorrelationContext("sess-corr-a");
    const second = createCorrelationContext("sess-corr-b");

    expect(first.sessionId).toBe("sess-corr-a");
    expect(first.correlationId).toMatch(/^corr-\d+$/);
    expect(first.traceId).toMatch(/^trace-\d+$/);
    expect(first.correlationId).not.toBe(first.traceId);

    // Two consecutive draws from the shared counter: trace = corr + 1.
    expect(idNumber(first.traceId, "trace")).toBe(idNumber(first.correlationId, "corr") + 1);
    // The counter is monotonic: a later context never reuses an id.
    expect(idNumber(second.correlationId, "corr")).toBeGreaterThan(
      idNumber(first.correlationId, "corr"),
    );
  });

  test("an injected id factory controls the ids exactly", () => {
    let n = 0;
    const factory = () => {
      n += 1;
      return `uuid-${n}`;
    };
    const ctx: CorrelationContext = createCorrelationContext("sess-injected", factory);
    expect(ctx).toEqual({
      sessionId: "sess-injected",
      correlationId: "corr-uuid-1",
      traceId: "trace-uuid-2",
    });
  });

  test("fromStageMessage extracts the context carried by a stage message", () => {
    const message = buildStageMessage(
      {
        sessionId: "sess-stage-boundary",
        correlationId: "corr-across-stages",
        traceId: "trace-across-stages",
      },
      SEED,
    );
    expect(fromStageMessage(message)).toEqual({
      sessionId: "sess-stage-boundary",
      correlationId: "corr-across-stages",
      traceId: "trace-across-stages",
    });
  });

  test("bindLogger returns a logger carrying the context and stage", () => {
    const lines: string[] = [];
    const logger = createLogger({
      minLevel: "debug",
      now: () => FIXED_TS,
      sink: (line) => lines.push(line),
    });
    const ctx = createCorrelationContext("sess-bind", () => "fixed");

    const bound = bindLogger(logger, ctx, "world-model");
    bound.info("state updated", { entities: 2 });
    const withStage = JSON.parse(lines[0] ?? "{}") as Record<string, unknown>;
    expect(withStage["sessionId"]).toBe("sess-bind");
    expect(withStage["correlationId"]).toBe("corr-fixed");
    expect(withStage["traceId"]).toBe("trace-fixed");
    expect(withStage["stage"]).toBe("world-model");

    const unbound = bindLogger(logger, ctx);
    unbound.info("no stage");
    const withoutStage = JSON.parse(lines[1] ?? "{}") as Record<string, unknown>;
    expect(withoutStage["stage"]).toBeUndefined();
    expect(withoutStage["sessionId"]).toBe("sess-bind");
  });

  test("empty session ids are rejected (fail-loud)", () => {
    expect(() => createCorrelationContext("")).toThrow(RangeError);
  });
});
