/**
 * The session phase machine (W305): `negotiating -> established ->
 * (degraded <-> established) -> closed`, every legal transition counted in
 * `stateTransitions` and metered; every ILLEGAL transition a typed protocol
 * error (fail-closed state — the machine never ends up undefined through
 * caller misuse).
 */
import { describe, expect, test } from "bun:test";
import { MetricsRegistry, createLogger } from "@sporta/observability";
import { LiveOutputProtocolError } from "../src/errors";
import { LIVE_SESSION_PHASES, LiveSessionPhaseMachine } from "../src/state";
import { emptyLiveStats, type LiveOutputStats } from "../src/types";

/** A machine over a real stats document + captured observability. */
function machine(): {
  m: LiveSessionPhaseMachine;
  stats: LiveOutputStats;
  metrics: MetricsRegistry;
  lines: string[];
} {
  const stats = emptyLiveStats();
  const lines: string[] = [];
  const logger = createLogger({ sink: (line) => lines.push(line), now: () => 0 });
  const metrics = new MetricsRegistry();
  return { m: new LiveSessionPhaseMachine(stats, logger, metrics, "live-s"), stats, metrics, lines };
}

describe("the phase vocabulary", () => {
  test("the four phases, in order", () => {
    expect(LIVE_SESSION_PHASES).toEqual(["negotiating", "established", "degraded", "closed"]);
  });
});

describe("legal transitions", () => {
  test("negotiating -> established is counted, logged, and metered", () => {
    const { m, stats, metrics, lines } = machine();
    expect(m.current()).toBe("negotiating");
    m.transition("established", { viewerId: "viewer-1" });
    expect(m.current()).toBe("established");
    expect(stats.stateTransitions).toEqual({ "negotiating->established": 1 });
    expect(lines.some((line) => line.includes("phase transition"))).toBe(true);
    const snapshot = metrics.snapshot();
    const transition = snapshot.counters.find((c) => c.name === "live_output_state_transitions_total");
    expect(transition?.value).toBe(1);
  });

  test("established -> degraded -> established -> closed traverses", () => {
    const { m, stats } = machine();
    m.transition("established", {});
    m.transition("degraded", { reason: "skip-stale" });
    m.transition("established", { recovery: true });
    m.transition("closed", {});
    expect(m.current()).toBe("closed");
    expect(m.isClosed).toBe(true);
    expect(stats.stateTransitions).toEqual({
      "negotiating->established": 1,
      "established->degraded": 1,
      "degraded->established": 1,
      "established->closed": 1,
    });
  });

  test("negotiating -> closed is legal (a failed negotiation)", () => {
    const { m } = machine();
    m.closeTerminal("negotiation-failed");
    expect(m.current()).toBe("closed");
  });

  test("degraded -> closed is legal (degraded sessions still close)", () => {
    const { m } = machine();
    m.transition("established", {});
    m.transition("degraded", { reason: "link-eviction" });
    m.closeTerminal();
    expect(m.current()).toBe("closed");
  });
});

describe("illegal transitions (fail-closed)", () => {
  test("negotiating -> degraded is refused", () => {
    const { m } = machine();
    expect(() => m.transition("degraded", {})).toThrow(LiveOutputProtocolError);
    expect(m.current()).toBe("negotiating");
  });

  test("established -> negotiating is refused", () => {
    const { m } = machine();
    m.transition("established", {});
    expect(() => m.transition("negotiating", {})).toThrow(LiveOutputProtocolError);
    expect(m.current()).toBe("established");
  });

  test("degraded -> degraded is refused (no self-loops)", () => {
    const { m } = machine();
    m.transition("established", {});
    m.transition("degraded", { reason: "skip-stale" });
    expect(() => m.transition("degraded", { reason: "again" })).toThrow(LiveOutputProtocolError);
    expect(m.current()).toBe("degraded");
  });

  test("closed admits NOTHING (the terminal phase)", () => {
    const { m } = machine();
    m.transition("established", {});
    m.transition("closed", {});
    expect(() => m.transition("established", {})).toThrow(LiveOutputProtocolError);
    expect(() => m.transition("degraded", {})).toThrow(LiveOutputProtocolError);
    expect(() => m.transition("closed", {})).toThrow(LiveOutputProtocolError);
    expect(m.current()).toBe("closed");
  });

  test("the illegal-transition error carries the from/to evidence", () => {
    const { m } = machine();
    try {
      m.transition("degraded", {});
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(LiveOutputProtocolError);
      const details = (error as LiveOutputProtocolError).details;
      expect(details.from).toBe("negotiating");
      expect(details.to).toBe("degraded");
      expect(details.failureClass).toBe("protocol-violation");
    }
  });
});

describe("closeTerminal (idempotent terminal transition)", () => {
  test("a second closeTerminal is a no-op (first-wins)", () => {
    const { m, stats } = machine();
    m.transition("established", {});
    m.closeTerminal("integrity-violation");
    m.closeTerminal("rights-lapsed");
    expect(m.current()).toBe("closed");
    expect(Object.keys(stats.stateTransitions)).toEqual([
      "negotiating->established",
      "established->closed",
    ]);
  });

  test("the failure class rides along in the transition context", () => {
    const { m, lines } = machine();
    m.closeTerminal("transport-failed");
    const closed = lines.find((line) => line.includes("established->closed") === false && line.includes("negotiating->closed"));
    expect(closed).toBeDefined();
    expect(closed).toContain("transport-failed");
  });
});
