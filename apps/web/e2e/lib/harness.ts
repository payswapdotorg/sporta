/**
 * The W909 harness recorder + flow context — REAL assertions, recorded
 * honestly: every check names what it proved and carries the evidence
 * string that decided it. A failed hard assertion aborts its flow (the
 * remaining steps would be meaningless); a failed soft check is recorded
 * and the flow continues.
 */
import type { BrowserDriver } from "./browser-driver";

/** One recorded assertion (the E2E test result). */
export interface AssertionRecord {
  name: string;
  pass: boolean;
  /** The observed value / evidence line that decided the assertion. */
  evidence: string;
}

/** Thrown by {@link FlowRecorder.assert} — aborts the flow. */
export class E2EAssertionError extends Error {
  constructor(public readonly record: AssertionRecord) {
    super(`${record.name} — ${record.evidence}`);
    this.name = "E2EAssertionError";
  }
}

/** A flow's recorded outcome. */
export interface FlowOutcome {
  id: string;
  title: string;
  status: "passed" | "failed";
  assertions: AssertionRecord[];
  notes: string[];
  screenshots: string[];
}

export class FlowRecorder {
  readonly assertions: AssertionRecord[] = [];
  readonly notes: string[] = [];
  readonly screenshots: string[] = [];
  /** Set when the flow ABORTED mid-run — its outcome is FAILED, always. */
  private aborted = false;

  constructor(
    readonly id: string,
    readonly title: string,
  ) {}

  /**
   * Records a hard assertion; throws when it fails (flow aborts).
   *
   * Arrow-function fields on purpose: the flows destructure
   * (`const { assert } = recorder`) — plain methods would lose `this`.
   */
  assert = (name: string, condition: boolean, evidence: string): void => {
    this.assertions.push({ name, pass: condition, evidence });
    if (!condition) throw new E2EAssertionError(this.assertions[this.assertions.length - 1]!);
  };

  /** Records a soft check (failure recorded, flow continues). */
  check = (name: string, condition: boolean, evidence: string): boolean => {
    this.assertions.push({ name, pass: condition, evidence });
    return condition;
  };

  /** A recorded observation (never fails; context for the report). */
  note(text: string): void {
    this.notes.push(text);
  }

  /**
   * Marks the flow as ABORTED (browser error, crash mid-run): the
   * remaining steps never ran, so the outcome is FAILED no matter how
   * many assertions passed before the abort. The reason rides along as
   * the FLOW ABORTED note the report shows.
   */
  abort(reason: string): void {
    this.aborted = true;
    this.note(`FLOW ABORTED: ${reason}`);
  }

  outcome(): FlowOutcome {
    return {
      id: this.id,
      title: this.title,
      // A flow that did not run to its verdict must never count as
      // passed: an aborted flow (browser error, crash — at ANY point,
      // including after already-passing assertions) is failed, and a
      // flow that recorded NOTHING did not run at all — an empty array
      // `every()`s to true, which is exactly the vacuous-pass shape.
      status:
        !this.aborted && this.assertions.length > 0 && this.assertions.every((a) => a.pass)
          ? "passed"
          : "failed",
      assertions: this.assertions,
      notes: this.notes,
      screenshots: this.screenshots,
    };
  }
}

/** Everything a flow may use (the single browser, the server, evidence IO). */
export interface FlowContext {
  /** The running app's base URL (e.g. http://127.0.0.1:3909). */
  baseUrl: string;
  /** The seeded content discovery (server-side reads over the real APIs). */
  discovery: Discovery;
  /** The real headless browser. */
  browser: BrowserDriver;
  /** This flow's recorder. */
  recorder: FlowRecorder;
  /** Directory for this run's evidence artifacts. */
  evidenceDir: string;
  /** Unique-per-run suffix (usernames, markers, files). */
  runId: string;
  /** The demo account's password (set by the runner via env). */
  demoPassword: string;
  /** Server-side fetch against the running app (no browser cookies). */
  api(path: string, init?: RequestInit): Promise<Response>;
}

/** The seeded content the flows need (discovered over the real APIs). */
export interface Discovery {
  /** The seeded session with the most realities (the derby: testcard+anime). */
  primarySession: {
    sessionId: string;
    label: string;
    storyKey: string;
    /** renderId per rendererId (only renders with stored outputs). */
    storedRenders: { renderId: string; rendererId: string; segmentIds: string[] }[];
  };
  /** All seeded session ids (for honesty counts). */
  allSessionIds: string[];
}

/** Aggregates flow outcomes into the run summary line. */
export function summarizeRun(outcomes: readonly FlowOutcome[]): {
  passed: number;
  failed: number;
  assertions: { pass: number; fail: number };
  exitCode: number;
} {
  let pass = 0;
  let fail = 0;
  for (const outcome of outcomes) {
    if (outcome.status === "passed") pass += 1;
    else fail += 1;
  }
  const assertionPass = outcomes.reduce(
    (sum, o) => sum + o.assertions.filter((a) => a.pass).length,
    0,
  );
  const assertionFail = outcomes.reduce(
    (sum, o) => sum + o.assertions.filter((a) => !a.pass).length,
    0,
  );
  return {
    passed: pass,
    failed: fail,
    assertions: { pass: assertionPass, fail: assertionFail },
    exitCode: fail > 0 || assertionFail > 0 ? 1 : 0,
  };
}
