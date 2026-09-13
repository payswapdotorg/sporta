/**
 * Unit tests for the structured logger (W007 §3.1).
 *
 * Every assertion works on PARSED log lines: the sink collects raw lines and
 * each test parses them back, so JSON-line validity is checked on the exact
 * bytes the sink would ship. The clock is injected (`TEST_EPOCH_MS`-derived)
 * per the harness determinism rules — no Date.now in tests.
 */
import { describe, expect, test } from "bun:test";
import { createLogger } from "../src/logger";
import type { LogRecord, LoggerOptions } from "../src/logger";

const FIXED_TS = 1_736_164_800_000;

/** Fixed injectable clock: returns the same constant every call. */
const fixedNow = (): number => FIXED_TS;

interface Collector {
  lines: string[];
  options: LoggerOptions;
  records: () => LogRecord[];
}

function collector(options: LoggerOptions = {}): Collector {
  const lines: string[] = [];
  return {
    lines,
    options: { sink: (line) => lines.push(line), ...options },
    records: () => lines.map((line) => JSON.parse(line) as LogRecord),
  };
}

describe("structured logger", () => {
  test("each log call emits exactly one valid JSON line", () => {
    const sink = collector({ minLevel: "debug", now: fixedNow });
    const logger = createLogger(sink.options);

    logger.debug("debug message");
    logger.info("info message", { count: 1 });
    logger.warn("warn message");
    logger.error("error message", { code: "E_STAGE", retryable: false });

    expect(sink.lines).toHaveLength(4);
    for (const line of sink.lines) {
      expect(() => JSON.parse(line)).not.toThrow();
    }
    const records = sink.records();
    expect(records.map((record) => record.level)).toEqual(["debug", "info", "warn", "error"]);
    expect(records.map((record) => record.msg)).toEqual([
      "debug message",
      "info message",
      "warn message",
      "error message",
    ]);
    expect(records.every((record) => record.ts === FIXED_TS)).toBe(true);
    expect(records[1]?.fields).toEqual({ count: 1 });
    expect(records[3]?.fields).toEqual({ code: "E_STAGE", retryable: false });
    // Lines without fields carry no `fields` key at all.
    expect("fields" in (records[0] ?? {})).toBe(false);
  });

  test("level filtering by minLevel (default: info)", () => {
    const strict = collector({ minLevel: "error", now: fixedNow });
    const logger = createLogger(strict.options);
    logger.debug("d");
    logger.info("i");
    logger.warn("w");
    logger.error("e");
    expect(strict.lines).toHaveLength(1);
    expect(strict.records()[0]?.level).toBe("error");

    const defaultLevel = collector({ now: fixedNow });
    const defaultLogger = createLogger(defaultLevel.options);
    defaultLogger.debug("suppressed");
    defaultLogger.info("emitted");
    expect(defaultLevel.lines).toHaveLength(1);
    expect(defaultLevel.records()[0]?.msg).toBe("emitted");
  });

  test("child bindings merge into every line and override the parent's", () => {
    const sink = collector({ minLevel: "debug", now: fixedNow });
    const logger = createLogger(sink.options);
    const stageLogger = logger.child({
      sessionId: "sess-logger-test",
      correlationId: "corr-logger-test",
      traceId: "trace-logger-test",
      stage: "perception",
      fields: { componentId: "comp-detector-v1" },
    });

    stageLogger.info("observed", { count: 3 });
    stageLogger.warn("slow frame", { frame: 12 });

    const records = sink.records();
    expect(records).toHaveLength(2);
    for (const record of records) {
      expect(record.sessionId).toBe("sess-logger-test");
      expect(record.correlationId).toBe("corr-logger-test");
      expect(record.traceId).toBe("trace-logger-test");
      expect(record.stage).toBe("perception");
    }
    // Per-call fields merge ON TOP of the child's bound fields.
    expect(records[0]?.fields).toEqual({ componentId: "comp-detector-v1", count: 3 });
    expect(records[1]?.fields).toEqual({ componentId: "comp-detector-v1", frame: 12 });

    // A grandchild overrides the parent binding; the root stays unbound.
    const fusionLogger = stageLogger.child({ stage: "fusion" });
    fusionLogger.info("derived");
    const fusionRecord = sink.records()[2];
    expect(fusionRecord?.stage).toBe("fusion");
    expect(fusionRecord?.sessionId).toBe("sess-logger-test");

    logger.info("unbound");
    const unbound = sink.records()[3];
    expect(unbound?.stage).toBeUndefined();
    expect(unbound?.sessionId).toBeUndefined();
    expect(unbound?.fields).toBeUndefined();
  });

  test("a circular field never throws and still yields a valid JSON line", () => {
    const sink = collector({ now: fixedNow });
    const logger = createLogger(sink.options);
    const circular: Record<string, unknown> = { name: "payload" };
    circular.self = circular;

    expect(() => logger.info("circular field", { payload: circular })).not.toThrow();
    const record = sink.records()[0];
    expect(record?.msg).toBe("circular field");
    expect(record?.fields?.payload).toEqual({ name: "payload", self: "[Circular]" });
  });

  test("non-JSON values (bigint, symbol, NaN) are coerced, not fatal", () => {
    const sink = collector({ now: fixedNow });
    const logger = createLogger(sink.options);

    expect(() =>
      logger.info("weird fields", {
        count: 10n,
        tag: Symbol("tag"),
        drift: Number.NaN,
        depth: Number.POSITIVE_INFINITY,
      }),
    ).not.toThrow();

    const record = sink.records()[0];
    expect(record?.fields?.count).toBe("10");
    expect(typeof record?.fields?.tag).toBe("string");
    expect(record?.fields?.drift).toBe("NaN");
    expect(record?.fields?.depth).toBe("Infinity");
  });

  test("sibling references to the same object are not mistaken for cycles", () => {
    const sink = collector({ now: fixedNow });
    const logger = createLogger(sink.options);
    const shared = { id: "obs-1" };

    expect(() => logger.info("shared refs", { a: shared, b: shared })).not.toThrow();
    const record = sink.records()[0];
    expect(record?.fields?.a).toEqual({ id: "obs-1" });
    expect(record?.fields?.b).toEqual({ id: "obs-1" });
  });
});
