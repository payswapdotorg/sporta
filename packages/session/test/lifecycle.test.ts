import { describe, expect, test } from "bun:test";
import {
  InvalidTransitionError,
  RightsDeniedError,
  SESSION_PIPELINE_STATUSES,
  TERMINAL_SESSION_STATUSES,
  SessionLifecycle,
  assertAuthorized,
  canTransition,
  isTerminalStatus,
  newSession,
} from "../src/index";
import type { MediaSession, SessionStatus } from "@sporta/contracts";
import {
  FAR_FUTURE_ISO,
  analysisOnlyPolicy,
  expiredPolicy,
  fixtureSource,
  fullPolicy,
  invalidSessionDoc,
} from "./fixtures/load";
import {
  InMemorySessionRepository,
  SessionDocumentValidationError,
  type NewSessionInput,
} from "../src/index";

const NOW = new Date("2025-06-01T12:00:00Z");
const NOW_ISO = NOW.toISOString();

function makeSession(overrides: Partial<NewSessionInput> = {}): MediaSession {
  return newSession({
    sessionId: "sess-test",
    authorizationPolicyId: fullPolicy.policyId,
    sources: [fixtureSource],
    createdAtIso: NOW_ISO,
    ...overrides,
  });
}

describe("newSession", () => {
  test("creates a created-status session with neutral defaults", () => {
    const session = makeSession();
    expect(session.status).toBe("created");
    expect(session.schemaVersion).toBe("1.1");
    expect(session.timeline).toEqual({
      durationMs: 0,
      videoClockOffsetMs: 0,
      audioClockOffsetMs: 0,
      driftMeasured: false,
    });
    expect(session.processingState).toEqual({ stage: "created" });
    expect(session.createdAtIso).toBe(NOW_ISO);
    expect(session.cancelledAtIso).toBeUndefined();
  });

  test("accepts partial timeline/processing-state overrides", () => {
    const session = newSession({
      sessionId: "sess-ovr",
      authorizationPolicyId: fullPolicy.policyId,
      sources: [fixtureSource],
      timeline: { videoClockOffsetMs: 1200 },
      processingState: { watermark: { watermarkMs: 40, sequence: 2 } },
      createdAtIso: NOW_ISO,
    });
    expect(session.timeline.videoClockOffsetMs).toBe(1200);
    expect(session.timeline.durationMs).toBe(0);
    expect(session.processingState.watermark).toEqual({ watermarkMs: 40, sequence: 2 });
    expect(session.processingState.stage).toBe("created");
  });

  test("rejects invalid input loudly (no sources)", () => {
    expect(() =>
      newSession({
        sessionId: "sess-bad",
        authorizationPolicyId: fullPolicy.policyId,
        sources: [],
        createdAtIso: NOW_ISO,
      }),
    ).toThrow(SessionDocumentValidationError);
  });
});

describe("SessionLifecycle happy path", () => {
  const lifecycle = new SessionLifecycle({
    resolvePolicy: () => fullPolicy,
    now: () => NOW,
  });

  test("walks created -> completed through every pipeline status", () => {
    let session = makeSession();
    for (const next of SESSION_PIPELINE_STATUSES.slice(1)) {
      session = lifecycle.transition(session, next);
      expect(session.status).toBe(next);
      expect(session.processingState.stage).toBe(next);
    }
    expect(session.status).toBe("completed");
    expect(isTerminalStatus(session.status)).toBe(true);
  });

  test("transition never mutates the input session", () => {
    const session = makeSession();
    const snapshot = structuredClone(session);
    const next = lifecycle.transition(session, "authorized");
    expect(next).not.toBe(session);
    expect(session).toEqual(snapshot);
    expect(next.status).toBe("authorized");
    expect(session.status).toBe("created");
  });

  test("transition honors meta.stage override", () => {
    const session = makeSession();
    const next = lifecycle.transition(session, "authorized", { stage: "authorized:rights-check" });
    expect(next.processingState.stage).toBe("authorized:rights-check");
  });
});

describe("illegal edges are rejected (table-driven, full matrix)", () => {
  const lifecycle = new SessionLifecycle({
    resolvePolicy: () => fullPolicy,
    now: () => NOW,
  });

  const allStatuses: SessionStatus[] = [...SESSION_PIPELINE_STATUSES, "failed", "cancelled"];

  test("every (from, to) pair matches canTransition", () => {
    for (const from of allStatuses) {
      for (const to of allStatuses) {
        const session = { ...makeSession(), status: from };
        const legal = canTransition(from, to);
        if (legal) {
          const next = lifecycle.transition(session, to);
          expect(next.status).toBe(to);
        } else {
          expect(() => lifecycle.transition(session, to)).toThrow(InvalidTransitionError);
        }
      }
    }
  });

  test("self-transitions are illegal for every status", () => {
    for (const status of allStatuses) {
      expect(canTransition(status, status)).toBe(false);
    }
  });

  test("terminal statuses have no outgoing edges", () => {
    for (const terminal of TERMINAL_SESSION_STATUSES) {
      expect(isTerminalStatus(terminal)).toBe(true);
      for (const to of allStatuses) {
        expect(canTransition(terminal, to)).toBe(false);
      }
    }
  });

  test("skipping a pipeline stage is illegal", () => {
    expect(canTransition("created", "ingesting")).toBe(false);
    expect(canTransition("authorized", "processing")).toBe(false);
    expect(canTransition("processing", "delivering")).toBe(false);
    expect(canTransition("created", "completed")).toBe(false);
  });

  test("backwards transitions are illegal", () => {
    expect(canTransition("processing", "authorized")).toBe(false);
    expect(canTransition("completed", "delivering")).toBe(false);
  });

  test("InvalidTransitionError carries from/to", () => {
    const session = makeSession();
    try {
      lifecycle.transition(session, "completed");
      throw new Error("expected InvalidTransitionError");
    } catch (err) {
      expect(err).toBeInstanceOf(InvalidTransitionError);
      const e = err as InvalidTransitionError;
      expect(e.from).toBe("created");
      expect(e.to).toBe("completed");
      expect(e.message).toContain("created");
      expect(e.message).toContain("completed");
    }
  });
});

describe("cancel is idempotent", () => {
  const lifecycle = new SessionLifecycle({ now: () => NOW });

  test("cancels an active session and stamps cancelledAtIso", () => {
    const session = makeSession();
    const cancelled = lifecycle.cancel(session);
    expect(cancelled.status).toBe("cancelled");
    expect(cancelled.cancelledAtIso).toBe(NOW_ISO);
    expect(session.cancelledAtIso).toBeUndefined();
  });

  test("second cancel is a no-op returning current state", () => {
    const cancelled = lifecycle.cancel(makeSession());
    const again = lifecycle.cancel(cancelled);
    expect(again.status).toBe("cancelled");
    expect(again.cancelledAtIso).toBe(cancelled.cancelledAtIso);
    expect(again).toEqual(cancelled);
  });

  test("cancel works from every active status", () => {
    for (const status of SESSION_PIPELINE_STATUSES.slice(0, -1)) {
      const session = { ...makeSession(), status };
      expect(lifecycle.cancel(session).status).toBe("cancelled");
    }
  });

  test("cancel on completed/failed is a no-op", () => {
    const completed: MediaSession = { ...makeSession(), status: "completed" };
    expect(lifecycle.cancel(completed).status).toBe("completed");

    const failed: MediaSession = {
      ...makeSession(),
      status: "failed",
      processingState: { stage: "processing", terminalFailureClass: "internal" },
    };
    const result = lifecycle.cancel(failed);
    expect(result.status).toBe("failed");
    expect(result.processingState.terminalFailureClass).toBe("internal");
  });

  test("raw transition to cancelled also stamps cancelledAtIso (meta wins)", () => {
    const session = makeSession();
    const cancelled = lifecycle.transition(session, "cancelled", {
      atIso: "2025-06-02T08:30:00Z",
    });
    expect(cancelled.cancelledAtIso).toBe("2025-06-02T08:30:00Z");
  });
});

describe("fail records the terminal failure class", () => {
  const lifecycle = new SessionLifecycle({ now: () => NOW });

  test("fails an active session with class and detail", () => {
    const session: MediaSession = {
      ...makeSession(),
      status: "processing",
      processingState: { stage: "processing" },
    };
    const failed = lifecycle.fail(session, "media-invalid", "container not demuxable");
    expect(failed.status).toBe("failed");
    expect(failed.processingState.terminalFailureClass).toBe("media-invalid");
    expect(failed.processingState.lastError).toBe("container not demuxable");
    expect(failed.processingState.stage).toBe("processing"); // stage where it failed
    expect(session.status).toBe("processing"); // input untouched
  });

  test("fail without detail leaves lastError untouched", () => {
    const session: MediaSession = {
      ...makeSession(),
      status: "ingesting",
      processingState: { stage: "ingesting", lastError: "earlier soft error" },
    };
    const failed = lifecycle.fail(session, "internal");
    expect(failed.processingState.lastError).toBe("earlier soft error");
  });

  test("re-failing a failed session is a no-op (first classification wins)", () => {
    const session: MediaSession = { ...makeSession(), status: "processing" };
    const failed = lifecycle.fail(session, "internal", "boom");
    const again = lifecycle.fail(failed, "rights-denied", "late denial");
    expect(again.status).toBe("failed");
    expect(again.processingState.terminalFailureClass).toBe("internal");
    expect(again.processingState.lastError).toBe("boom");
  });

  test("failing a cancelled session is a no-op", () => {
    const cancelled = lifecycle.cancel(makeSession());
    const result = lifecycle.fail(cancelled, "internal");
    expect(result.status).toBe("cancelled");
    expect(result.processingState.terminalFailureClass).toBeUndefined();
  });
});

describe("rights gate fails closed", () => {
  test("missing policy denies created -> authorized", () => {
    const lifecycle = new SessionLifecycle({ now: () => NOW });
    const session = makeSession({ authorizationPolicyId: "pol-missing" });
    try {
      lifecycle.transition(session, "authorized");
      throw new Error("expected RightsDeniedError");
    } catch (err) {
      expect(err).toBeInstanceOf(RightsDeniedError);
      const e = err as RightsDeniedError;
      expect(e.reason).toBe("missing-policy");
      expect(e.requiredOperation).toBe("analysis");
      expect(e.terminalFailureClass).toBe("rights-denied");
    }
    expect(session.status).toBe("created"); // never advanced
  });

  test("expired policy denies created -> authorized", () => {
    const lifecycle = new SessionLifecycle({
      resolvePolicy: () => expiredPolicy,
      now: () => NOW,
    });
    const session = makeSession({ authorizationPolicyId: expiredPolicy.policyId });
    expect(() => lifecycle.transition(session, "authorized")).toThrow(RightsDeniedError);
    try {
      lifecycle.transition(session, "authorized");
    } catch (err) {
      expect((err as RightsDeniedError).reason).toBe("expired-policy");
      expect((err as RightsDeniedError).policyId).toBe(expiredPolicy.policyId);
    }
  });

  test("policy without analysis denies created -> authorized", () => {
    const noAnalysis = {
      ...fullPolicy,
      policyId: "pol-no-analysis",
      allowedOperations: ["transformation", "storage"] as typeof fullPolicy.allowedOperations,
    };
    const lifecycle = new SessionLifecycle({ resolvePolicy: () => noAnalysis, now: () => NOW });
    const session = makeSession({ authorizationPolicyId: noAnalysis.policyId });
    try {
      lifecycle.transition(session, "authorized");
      throw new Error("expected RightsDeniedError");
    } catch (err) {
      expect((err as RightsDeniedError).reason).toBe("missing-operation");
      expect((err as RightsDeniedError).requiredOperation).toBe("analysis");
    }
  });

  test("policy without transformation denies entering rendering", () => {
    const lifecycle = new SessionLifecycle({
      resolvePolicy: () => analysisOnlyPolicy,
      now: () => NOW,
    });
    let session = makeSession({ authorizationPolicyId: analysisOnlyPolicy.policyId });
    session = lifecycle.transition(session, "authorized"); // analysis ok
    session = { ...session, status: "processing" };
    try {
      lifecycle.transition(session, "rendering");
      throw new Error("expected RightsDeniedError");
    } catch (err) {
      const e = err as RightsDeniedError;
      expect(e.reason).toBe("missing-operation");
      expect(e.requiredOperation).toBe("transformation");
      expect(e.terminalFailureClass).toBe("rights-denied");
    }
    expect(session.status).toBe("processing"); // never advanced
  });

  test("a policy that expires between authorization and rendering denies late (fail closed)", () => {
    let clock = new Date("2025-06-01T12:00:00Z");
    const expiring = {
      ...fullPolicy,
      policyId: "pol-expiring",
      expiresAtIso: "2025-06-01T13:00:00Z",
    };
    const lifecycle = new SessionLifecycle({
      resolvePolicy: () => expiring,
      now: () => clock,
    });
    let session = makeSession({ authorizationPolicyId: expiring.policyId });
    session = lifecycle.transition(session, "authorized"); // valid at 12:00
    clock = new Date("2025-06-01T14:00:00Z"); // policy expired by render time
    session = { ...session, status: "processing" };
    try {
      lifecycle.transition(session, "rendering");
      throw new Error("expected RightsDeniedError");
    } catch (err) {
      expect((err as RightsDeniedError).reason).toBe("expired-policy");
    }
  });

  test("a policy presented via meta.policy passes the gate", () => {
    const lifecycle = new SessionLifecycle({ now: () => NOW }); // no resolver
    const session = makeSession();
    const authorized = lifecycle.transition(session, "authorized", { policy: fullPolicy });
    expect(authorized.status).toBe("authorized");
  });

  test("a presented policy that mismatches the session's policy id is denied", () => {
    const lifecycle = new SessionLifecycle({ now: () => NOW });
    const session = makeSession({ authorizationPolicyId: "pol-session" });
    try {
      lifecycle.transition(session, "authorized", { policy: fullPolicy });
      throw new Error("expected RightsDeniedError");
    } catch (err) {
      expect((err as RightsDeniedError).reason).toBe("policy-mismatch");
    }
  });

  test("denials can be persisted as classified terminal failures", () => {
    const lifecycle = new SessionLifecycle({ now: () => NOW }); // no policy anywhere
    const session = makeSession();
    let failed: MediaSession;
    try {
      lifecycle.transition(session, "authorized");
      throw new Error("expected RightsDeniedError");
    } catch (err) {
      expect(err).toBeInstanceOf(RightsDeniedError);
      failed = lifecycle.fail(
        session,
        (err as RightsDeniedError).terminalFailureClass,
        (err as RightsDeniedError).message,
      );
    }
    expect(failed.status).toBe("failed");
    expect(failed.processingState.terminalFailureClass).toBe("rights-denied");
    expect(failed.processingState.lastError).toContain("missing-policy");
  });
});

describe("assertAuthorized (exported for reuse)", () => {
  test("allows an operation covered by a valid policy", () => {
    expect(() => assertAuthorized(fullPolicy, "analysis", NOW)).not.toThrow();
    expect(() => assertAuthorized(fullPolicy, "transformation", NOW)).not.toThrow();
  });

  test("denies a missing policy", () => {
    expect(() => assertAuthorized(undefined, "analysis", NOW)).toThrow(RightsDeniedError);
    expect(() => assertAuthorized(null, "transformation", NOW)).toThrow(RightsDeniedError);
  });

  test("denies an expired policy (expiry at now counts as expired)", () => {
    const boundary = new Date("2020-01-01T00:00:00Z");
    expect(() => assertAuthorized(expiredPolicy, "analysis", boundary)).toThrow(RightsDeniedError);
    const future = new Date("2019-01-01T00:00:00Z");
    expect(() => assertAuthorized(expiredPolicy, "analysis", future)).not.toThrow();
  });

  test("denies an operation the policy does not list", () => {
    expect(() => assertAuthorized(analysisOnlyPolicy, "transformation", NOW)).toThrow(
      RightsDeniedError,
    );
  });

  test("a policy expiring in the future remains valid", () => {
    const futurePolicy = { ...fullPolicy, expiresAtIso: FAR_FUTURE_ISO };
    expect(() => assertAuthorized(futurePolicy, "analysis", NOW)).not.toThrow();
  });
});

describe("lifecycle can be persisted and queried (W004 acceptance)", () => {
  test("full walk persists at every step and queries by status, without vendor fields", () => {
    const repo = new InMemorySessionRepository();
    const lifecycle = new SessionLifecycle({
      resolvePolicy: () => fullPolicy,
      now: () => NOW,
    });

    const tainted: MediaSession & { vendorHint?: string } = {
      ...makeSession({ sessionId: "sess-persist" }),
      vendorHint: "some-vendor-specific-field",
    };
    let session = repo.create(tainted);
    expect((session as Record<string, unknown>).vendorHint).toBeUndefined(); // stripped

    for (const next of SESSION_PIPELINE_STATUSES.slice(1)) {
      session = lifecycle.transition(session, next);
      repo.update(session);
    }

    const stored = repo.get("sess-persist");
    expect(stored?.status).toBe("completed");
    expect(stored?.processingState.stage).toBe("completed");
    expect(Object.keys(stored ?? {}).sort()).toEqual(
      [
        "authorizationPolicyId",
        "createdAtIso",
        "processingState",
        "schemaVersion",
        "sessionId",
        "sources",
        "status",
        "timeline",
      ].sort(),
    );
    expect(repo.listByStatus("completed").map((s) => s.sessionId)).toEqual(["sess-persist"]);
    expect(repo.listByStatus("created")).toEqual([]);
  });

  test("invalid documents are rejected on write (schema validation)", () => {
    const repo = new InMemorySessionRepository();
    expect(() => repo.create(invalidSessionDoc as MediaSession)).toThrow(
      SessionDocumentValidationError,
    );
  });
});
