/**
 * THE J010 ANALYST ANNOTATIONS BATTERY — media-time markers/clips saved
 * where backed by REAL session timelines (or REAL render outputs), notes
 * attached, revisitable; NO fake clip bytes:
 *
 * - the ACCESS boundaries: owner / operator / analyst grant read+write;
 *   every other role the honest 403; unauthenticated the honest 401; a
 *   missing ownership record denies uniformly (no existence oracle);
 * - the HONEST BACKING checks (fail-closed, closed vocabulary): a session
 *   without a timeline refuses `no-timeline`; an unknown session refuses
 *   `session-unknown`; a render-backed marker without the render port
 *   refuses `render-lookup-unavailable`; an unknown render refuses
 *   `render-unknown`; out-of-extent times refuse `out-of-range`;
 * - the NO-BYTES pin: the persisted marker documents are TIME RANGES +
 *   backing references ONLY — no byte-shaped member can even appear;
 * - persistence: deterministic gap-free ids, save/attach order, deep-clone
 *   reads, and the `bun:sqlite` store's restart-safe counters + durability.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  AnalystAnnotationValidationError,
  createAnalystAnnotationService,
  InMemoryAnalystAnnotationStore,
  SqliteAnalystAnnotationStore,
} from "../src/index";
import type { AnalystAnnotationStore, SessionTimelineLookup } from "../src/index";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const NOW_MS = 1_751_000_000_000;
const SESSION_DURATION_MS = 90_000; // 90s of REAL timeline

/** The session-timeline fixture: one known session with a real extent. */
const sessionTimelines: SessionTimelineLookup = (sessionId: string) => {
  if (sessionId === "sess-known") return { exists: true, durationMs: SESSION_DURATION_MS };
  if (sessionId === "sess-no-timeline") return { exists: false };
  return null; // unknown session
};

/** The ownership fixture: the owner of the known sessions. */
const ownerIdOf = (sessionId: string) => {
  if (sessionId === "sess-known" || sessionId === "sess-no-timeline") return "u-owner";
  return null;
};

/** The render-output fixture: one real render on the known session. */
const renderOutputs = (sessionId: string, renderId: string) =>
  sessionId === "sess-known" && renderId === "render-1";

const OWNER = { userId: "u-owner", roles: ["creator"] as const };
const ANALYST = { userId: "u-analyst", roles: ["analyst"] as const };
const OPERATOR = { userId: "u-operator", roles: ["operator"] as const };
const OUTSIDER = { userId: "u-outsider", roles: ["viewer", "rights-holder"] as const };

function makeService(store: AnalystAnnotationStore, withRenderPort = true) {
  return createAnalystAnnotationService({
    store,
    sessionTimelines,
    ownerIdOf,
    ...(withRenderPort ? { renderOutputs } : {}),
    nowMs: () => NOW_MS,
  });
}

// ---------------------------------------------------------------------------
// Service wiring (fail-loud on malformed configuration)
// ---------------------------------------------------------------------------

describe("the service wiring (fail-loud)", () => {
  test("refuses a malformed configuration with the typed validation error", () => {
    expect(() =>
      createAnalystAnnotationService({
        store: {} as never,
        sessionTimelines,
        ownerIdOf,
        nowMs: () => NOW_MS,
      }),
    ).toThrow(AnalystAnnotationValidationError);
    expect(() =>
      createAnalystAnnotationService({
        store: new InMemoryAnalystAnnotationStore(),
        sessionTimelines: 42 as never,
        ownerIdOf,
        nowMs: () => NOW_MS,
      }),
    ).toThrow(AnalystAnnotationValidationError);
    expect(() =>
      createAnalystAnnotationService({
        store: new InMemoryAnalystAnnotationStore(),
        sessionTimelines,
        ownerIdOf: null as never,
        nowMs: () => NOW_MS,
      }),
    ).toThrow(AnalystAnnotationValidationError);
    expect(() =>
      createAnalystAnnotationService({
        store: new InMemoryAnalystAnnotationStore(),
        sessionTimelines,
        ownerIdOf,
        renderOutputs: "not-a-function" as never,
        nowMs: () => NOW_MS,
      }),
    ).toThrow(AnalystAnnotationValidationError);
  });
});

// ---------------------------------------------------------------------------
// The access boundaries (the honest 401/403 — the J010 role matrix)
// ---------------------------------------------------------------------------

describe("the access boundaries (owner / operator / analyst; honest 401/403)", () => {
  test("an unauthenticated caller is denied 401 on every seam", () => {
    const service = makeService(new InMemoryAnalystAnnotationStore());
    const denial = { kind: "denied", reason: "unauthenticated", httpStatus: 401 } as const;
    expect(
      service.saveMarker(null, { sessionId: "sess-known", kind: "moment", atMs: 1000 }),
    ).toEqual(denial);
    expect(service.attachNote(null, { markerId: "mk-sess-known-1", text: "note" })).toEqual(denial);
    expect(service.listMarkers(null, "sess-known")).toEqual(denial);
    expect(service.getMarker(null, "mk-sess-known-1")).toEqual(denial);
  });

  test("the session's owner, an operator, and the analyst grant may save; an outsider is denied 403", () => {
    const store = new InMemoryAnalystAnnotationStore();
    const service = makeService(store);
    for (const account of [OWNER, ANALYST, OPERATOR]) {
      const result = service.saveMarker(account, {
        sessionId: "sess-known",
        kind: "moment",
        atMs: 1_000,
      });
      expect(result.kind).toBe("allowed");
      if (result.kind === "allowed") {
        expect(result.value.authorUserId).toBe(account.userId);
        expect(result.value.markerId).toMatch(/^mk-sess-known-\d+$/);
      }
    }
    const outsider = service.saveMarker(OUTSIDER, {
      sessionId: "sess-known",
      kind: "moment",
      atMs: 1_000,
    });
    expect(outsider).toEqual({ kind: "denied", reason: "not-resource-owner", httpStatus: 403 });
  });

  test("reads (listMarkers/getMarker) honor the same matrix with 403 for outsiders", () => {
    const store = new InMemoryAnalystAnnotationStore();
    const service = makeService(store);
    const saved = service.saveMarker(OWNER, {
      sessionId: "sess-known",
      kind: "moment",
      atMs: 1_000,
    });
    if (saved.kind !== "allowed") throw new Error("fixture: the owner saves");
    for (const account of [OWNER, ANALYST, OPERATOR]) {
      expect(service.listMarkers(account, "sess-known").kind).toBe("allowed");
      expect(service.getMarker(account, saved.value.markerId).kind).toBe("allowed");
    }
    expect(service.listMarkers(OUTSIDER, "sess-known")).toEqual({
      kind: "denied",
      reason: "not-resource-owner",
      httpStatus: 403,
    });
    expect(service.getMarker(OUTSIDER, saved.value.markerId)).toEqual({
      kind: "denied",
      reason: "not-resource-owner",
      httpStatus: 403,
    });
  });

  test("a session with no ownership record denies uniformly (no existence oracle)", () => {
    const service = makeService(new InMemoryAnalystAnnotationStore());
    // 'sess-ghost' exists in no fixture at all — the denial is the same
    // uniform 403 (unknown-resource), NOT a distinguished "does not exist".
    expect(service.listMarkers(ANALYST, "sess-ghost")).toEqual({
      kind: "denied",
      reason: "unknown-resource",
      httpStatus: 403,
    });
    expect(
      service.saveMarker(ANALYST, { sessionId: "sess-ghost", kind: "moment", atMs: 0 }),
    ).toEqual({
      kind: "denied",
      reason: "unknown-resource",
      httpStatus: 403,
    });
  });
});

// ---------------------------------------------------------------------------
// The honest backing checks (fail-closed; the closed refusal vocabulary)
// ---------------------------------------------------------------------------

describe("the honest backing checks (never fabricated)", () => {
  test("a session with NO real timeline refuses no-timeline (created-but-unprocessed)", () => {
    const service = makeService(new InMemoryAnalystAnnotationStore());
    expect(
      service.saveMarker(OWNER, { sessionId: "sess-no-timeline", kind: "moment", atMs: 100 }),
    ).toEqual({ kind: "refused", reason: "no-timeline" });
  });

  test("an unknown session refuses session-unknown (the timeline lookup's null)", () => {
    // The ghost session has no ownership record, so the access gate denies
    // first; an OWNED-but-unknown session exercises the lookup's null. Use
    // an ownership map where the owner is known but the timeline is not.
    const service = createAnalystAnnotationService({
      store: new InMemoryAnalystAnnotationStore(),
      sessionTimelines: () => null,
      ownerIdOf: () => "u-owner",
      nowMs: () => NOW_MS,
    });
    expect(
      service.saveMarker(OWNER, { sessionId: "sess-owned-unknown", kind: "moment", atMs: 100 }),
    ).toEqual({ kind: "refused", reason: "session-unknown" });
  });

  test("the session-timeline backing snapshots the REAL durationMs at save", () => {
    const store = new InMemoryAnalystAnnotationStore();
    let duration = SESSION_DURATION_MS;
    const service = createAnalystAnnotationService({
      store,
      sessionTimelines: () => ({ exists: true, durationMs: duration }),
      ownerIdOf: () => "u-owner",
      nowMs: () => NOW_MS,
    });
    const saved = service.saveMarker(OWNER, {
      sessionId: "sess-known",
      kind: "clip",
      startMs: 0,
      endMs: 5_000,
    });
    if (saved.kind !== "allowed") throw new Error("fixture: clip saves");
    expect(saved.value.backing).toEqual({
      kind: "session-timeline",
      durationMs: SESSION_DURATION_MS,
    });
    // The REAL timeline later grows — the saved snapshot stays the honest
    // extent AT SAVE (never retroactively fabricated).
    duration = SESSION_DURATION_MS * 2;
    const reRead = store.markerOf(saved.value.markerId);
    if (reRead === null) throw new Error("fixture: marker persisted");
    expect(reRead.backing).toEqual({ kind: "session-timeline", durationMs: SESSION_DURATION_MS });
  });

  test("a render-backed marker without the render port refuses render-lookup-unavailable", () => {
    const service = makeService(new InMemoryAnalystAnnotationStore(), false);
    expect(
      service.saveMarker(OWNER, {
        sessionId: "sess-known",
        kind: "moment",
        atMs: 100,
        backing: { kind: "render-output", renderId: "render-1", durationMs: 10_000 },
      }),
    ).toEqual({ kind: "refused", reason: "render-lookup-unavailable" });
  });

  test("a render-backed marker with an unknown render refuses render-unknown", () => {
    const service = makeService(new InMemoryAnalystAnnotationStore());
    expect(
      service.saveMarker(OWNER, {
        sessionId: "sess-known",
        kind: "moment",
        atMs: 100,
        backing: { kind: "render-output", renderId: "render-missing", durationMs: 10_000 },
      }),
    ).toEqual({ kind: "refused", reason: "render-unknown" });
  });

  test("a REAL render's timeline backs the marker (renderId + durationMs carried)", () => {
    const service = makeService(new InMemoryAnalystAnnotationStore());
    const saved = service.saveMarker(OWNER, {
      sessionId: "sess-known",
      kind: "clip",
      startMs: 1_000,
      endMs: 4_000,
      backing: { kind: "render-output", renderId: "render-1", durationMs: 10_000 },
    });
    if (saved.kind !== "allowed") throw new Error("fixture: render-backed clip saves");
    expect(saved.value.backing).toEqual({
      kind: "render-output",
      renderId: "render-1",
      durationMs: 10_000,
    });
  });

  test("the render port is checked against the SESSION (a render from another session is unknown)", () => {
    const service = createAnalystAnnotationService({
      store: new InMemoryAnalystAnnotationStore(),
      sessionTimelines,
      ownerIdOf: () => "u-owner",
      renderOutputs: (sessionId, renderId) =>
        sessionId === "sess-other-render" && renderId === "render-1",
      nowMs: () => NOW_MS,
    });
    expect(
      service.saveMarker(OWNER, {
        sessionId: "sess-known",
        kind: "moment",
        atMs: 100,
        backing: { kind: "render-output", renderId: "render-1", durationMs: 10_000 },
      }),
    ).toEqual({ kind: "refused", reason: "render-unknown" });
  });
});

// ---------------------------------------------------------------------------
// The extent checks (within the REAL backing's extent — nothing beyond)
// ---------------------------------------------------------------------------

describe("the extent checks (the real timeline's bounds)", () => {
  test("a moment at 0 and at the exact extent saves; beyond refuses out-of-range", () => {
    const service = makeService(new InMemoryAnalystAnnotationStore());
    expect(
      service.saveMarker(OWNER, { sessionId: "sess-known", kind: "moment", atMs: 0 }).kind,
    ).toBe("allowed");
    expect(
      service.saveMarker(OWNER, {
        sessionId: "sess-known",
        kind: "moment",
        atMs: SESSION_DURATION_MS,
      }).kind,
    ).toBe("allowed");
    expect(
      service.saveMarker(OWNER, { sessionId: "sess-known", kind: "moment", atMs: -1 }),
    ).toEqual({ kind: "refused", reason: "out-of-range" });
    expect(
      service.saveMarker(OWNER, {
        sessionId: "sess-known",
        kind: "moment",
        atMs: SESSION_DURATION_MS + 1,
      }),
    ).toEqual({ kind: "refused", reason: "out-of-range" });
  });

  test("a clip within the extent saves; endMs beyond the extent refuses out-of-range", () => {
    const service = makeService(new InMemoryAnalystAnnotationStore());
    const saved = service.saveMarker(OWNER, {
      sessionId: "sess-known",
      kind: "clip",
      startMs: 1_000,
      endMs: SESSION_DURATION_MS,
    });
    expect(saved.kind).toBe("allowed");
    expect(
      service.saveMarker(OWNER, {
        sessionId: "sess-known",
        kind: "clip",
        startMs: 1_000,
        endMs: SESSION_DURATION_MS + 1,
      }),
    ).toEqual({ kind: "refused", reason: "out-of-range" });
  });

  test("the extent is the BACKING's, not the session's (render-backed markers bound to the render)", () => {
    const service = makeService(new InMemoryAnalystAnnotationStore());
    // A moment at 12_000 is fine on the 90_000ms session timeline but BEYOND
    // the 10_000ms render timeline — the render backing's extent decides.
    expect(
      service.saveMarker(OWNER, {
        sessionId: "sess-known",
        kind: "moment",
        atMs: 12_000,
        backing: { kind: "render-output", renderId: "render-1", durationMs: 10_000 },
      }),
    ).toEqual({ kind: "refused", reason: "out-of-range" });
  });

  test("malformed marker inputs throw the typed validation error (fail-loud, not a refusal)", () => {
    const service = makeService(new InMemoryAnalystAnnotationStore());
    expect(() => service.saveMarker(OWNER, { sessionId: "sess-known", kind: "moment" })).toThrow(
      AnalystAnnotationValidationError,
    );
    expect(() =>
      service.saveMarker(OWNER, {
        sessionId: "sess-known",
        kind: "moment",
        atMs: Number.NaN,
      }),
    ).toThrow(AnalystAnnotationValidationError);
    expect(() =>
      service.saveMarker(OWNER, { sessionId: "sess-known", kind: "clip", startMs: 500 }),
    ).toThrow(AnalystAnnotationValidationError);
    expect(() =>
      service.saveMarker(OWNER, {
        sessionId: "sess-known",
        kind: "clip",
        startMs: 5_000,
        endMs: 4_000,
      }),
    ).toThrow(AnalystAnnotationValidationError);
    expect(() => service.saveMarker(OWNER, { sessionId: "", kind: "moment", atMs: 0 })).toThrow(
      AnalystAnnotationValidationError,
    );
  });
});

// ---------------------------------------------------------------------------
// THE NO-BYTES PIN (never fake clip media)
// ---------------------------------------------------------------------------

describe("the no-bytes pin (a marker is time + backing — never media)", () => {
  test("persisted marker documents carry NO byte-shaped member at all", () => {
    const store = new InMemoryAnalystAnnotationStore();
    const service = makeService(store);
    service.saveMarker(OWNER, {
      sessionId: "sess-known",
      kind: "moment",
      atMs: 1_000,
      label: "chance",
    });
    service.saveMarker(OWNER, {
      sessionId: "sess-known",
      kind: "clip",
      startMs: 1_000,
      endMs: 4_000,
      backing: { kind: "render-output", renderId: "render-1", durationMs: 10_000 },
    });
    for (const marker of store.markersOf("sess-known")) {
      // The closed persisted shape PER KIND — there is NO field where bytes
      // could hide, and adding one is a contract change, not an edit here.
      const keys = Object.keys(marker).sort();
      if (marker.kind === "moment") {
        expect(keys).toEqual(
          [
            "atMs",
            "authorUserId",
            "backing",
            "createdAtIso",
            "kind",
            "label",
            "markerId",
            "sessionId",
          ].sort(),
        );
      } else {
        expect(keys).toEqual(
          [
            "authorUserId",
            "backing",
            "createdAtIso",
            "endMs",
            "kind",
            "markerId",
            "sessionId",
            "startMs",
          ].sort(),
        );
      }
      expect(JSON.stringify(marker)).not.toMatch(
        /"(data|bytes|content|dataUrl|base64|url|src|media)"/,
      );
    }
  });
});

// ---------------------------------------------------------------------------
// Notes (attached, persisted, revisitable)
// ---------------------------------------------------------------------------

describe("attached notes (first-class, persisted)", () => {
  test("a note attaches to a saved marker and round-trips (author + timestamp + text)", () => {
    const service = makeService(new InMemoryAnalystAnnotationStore());
    const marker = service.saveMarker(OWNER, {
      sessionId: "sess-known",
      kind: "moment",
      atMs: 1_000,
    });
    if (marker.kind !== "allowed") throw new Error("fixture");
    const note = service.attachNote(ANALYST, { markerId: marker.value.markerId, text: "cut here" });
    if (note.kind !== "allowed") throw new Error("fixture: note attaches");
    expect(note.value.markerId).toBe(marker.value.markerId);
    expect(note.value.sessionId).toBe("sess-known");
    expect(note.value.text).toBe("cut here");
    expect(note.value.authorUserId).toBe("u-analyst");
    expect(note.value.createdAtIso).toBe(new Date(NOW_MS).toISOString());
    expect(note.value.noteId).toBe(`nt-${marker.value.markerId}-1`);
  });

  test("an unknown marker refuses marker-unknown; the access gate still runs first", () => {
    const service = makeService(new InMemoryAnalystAnnotationStore());
    expect(service.attachNote(OWNER, { markerId: "mk-sess-known-999", text: "x" })).toEqual({
      kind: "refused",
      reason: "marker-unknown",
    });
    // An unauthenticated caller to an unknown marker gets the 401 (the
    // auth boundary), while an authenticated outsider who names a REAL
    // marker gets the 403 (no marker existence is leaked to outsiders).
    expect(service.attachNote(null, { markerId: "mk-sess-known-999", text: "x" })).toEqual({
      kind: "denied",
      reason: "unauthenticated",
      httpStatus: 401,
    });
  });

  test("empty/whitespace text throws; over-length text refuses invalid-input", () => {
    const service = makeService(new InMemoryAnalystAnnotationStore());
    const marker = service.saveMarker(OWNER, { sessionId: "sess-known", kind: "moment", atMs: 0 });
    if (marker.kind !== "allowed") throw new Error("fixture");
    expect(() =>
      service.attachNote(OWNER, { markerId: marker.value.markerId, text: "   " }),
    ).toThrow(AnalystAnnotationValidationError);
    expect(() => service.attachNote(OWNER, { markerId: marker.value.markerId, text: "" })).toThrow(
      AnalystAnnotationValidationError,
    );
    const over = service.attachNote(OWNER, {
      markerId: marker.value.markerId,
      text: "x".repeat(4_001),
    });
    expect(over).toEqual({ kind: "refused", reason: "invalid-input" });
    const atLimit = service.attachNote(OWNER, {
      markerId: marker.value.markerId,
      text: "x".repeat(4_000),
    });
    expect(atLimit.kind).toBe("allowed");
  });
});

// ---------------------------------------------------------------------------
// The revisit seams (listMarkers / getMarker) + id determinism
// ---------------------------------------------------------------------------

describe("the revisit seams (deterministic ids, order, isolation, deep clones)", () => {
  test("markers list in save order with gap-free per-session ids; sessions stay isolated", () => {
    const service = makeService(new InMemoryAnalystAnnotationStore());
    const first = service.saveMarker(OWNER, { sessionId: "sess-known", kind: "moment", atMs: 1 });
    const second = service.saveMarker(ANALYST, {
      sessionId: "sess-known",
      kind: "clip",
      startMs: 0,
      endMs: 10,
    });
    if (first.kind !== "allowed" || second.kind !== "allowed") throw new Error("fixture");
    expect(first.value.markerId).toBe("mk-sess-known-1");
    expect(second.value.markerId).toBe("mk-sess-known-2");
    const listed = service.listMarkers(OWNER, "sess-known");
    if (listed.kind !== "allowed") throw new Error("fixture");
    expect(listed.value.map((marker) => marker.markerId)).toEqual([
      "mk-sess-known-1",
      "mk-sess-known-2",
    ]);
    // Mutating the returned documents does not leak into the store.
    listed.value[0]!.label = "tampered";
    const reListed = service.listMarkers(OWNER, "sess-known");
    if (reListed.kind !== "allowed") throw new Error("fixture");
    expect(reListed.value[0]!.label).toBeUndefined();
  });

  test("getMarker returns the marker WITH its notes in attach order", () => {
    const service = makeService(new InMemoryAnalystAnnotationStore());
    const marker = service.saveMarker(OWNER, { sessionId: "sess-known", kind: "moment", atMs: 5 });
    if (marker.kind !== "allowed") throw new Error("fixture");
    service.attachNote(OWNER, { markerId: marker.value.markerId, text: "first" });
    service.attachNote(ANALYST, { markerId: marker.value.markerId, text: "second" });
    const result = service.getMarker(OWNER, marker.value.markerId);
    if (result.kind !== "allowed") throw new Error("fixture");
    expect(result.value.notes.map((note) => note.text)).toEqual(["first", "second"]);
    expect(result.value.notes.map((note) => note.noteId)).toEqual([
      `nt-${marker.value.markerId}-1`,
      `nt-${marker.value.markerId}-2`,
    ]);
    // A note from ANOTHER marker never appears.
    const other = service.saveMarker(OWNER, { sessionId: "sess-known", kind: "moment", atMs: 6 });
    if (other.kind !== "allowed") throw new Error("fixture");
    service.attachNote(OWNER, { markerId: other.value.markerId, text: "elsewhere" });
    const revisited = service.getMarker(OWNER, marker.value.markerId);
    if (revisited.kind !== "allowed") throw new Error("fixture");
    expect(revisited.value.notes.map((note) => note.text)).toEqual(["first", "second"]);
  });
});

// ---------------------------------------------------------------------------
// The sqlite store (durability + restart-safe counters + validate-on-read)
// ---------------------------------------------------------------------------

describe("the sqlite analyst-annotation store (durable persistence)", () => {
  let dir: string;
  let path: string;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "sporta-analyst-"));
    path = join(dir, "annotations.sqlite");
  });

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  test("round-trips markers and notes and survives close-and-reopen with continuing ids", () => {
    const store = new SqliteAnalystAnnotationStore(path);
    const service = makeService(store);
    const markerA = service.saveMarker(OWNER, {
      sessionId: "sess-known",
      kind: "moment",
      atMs: 1_000,
    });
    const markerB = service.saveMarker(ANALYST, {
      sessionId: "sess-known",
      kind: "clip",
      startMs: 2_000,
      endMs: 3_000,
      label: "the cut",
    });
    if (markerA.kind !== "allowed" || markerB.kind !== "allowed") throw new Error("fixture");
    service.attachNote(OWNER, { markerId: markerA.value.markerId, text: "note one" });
    service.attachNote(OPERATOR, { markerId: markerA.value.markerId, text: "note two" });
    store.close();

    // Reopen: everything is there, and the counters CONTINUE (restart-safe
    // gap-free — the next marker is #3, not a collision at #1).
    const reopened = new SqliteAnalystAnnotationStore(path);
    const service2 = makeService(reopened);
    const listed = service2.listMarkers(OWNER, "sess-known");
    if (listed.kind !== "allowed") throw new Error("fixture");
    expect(listed.value.map((marker) => marker.markerId)).toEqual([
      "mk-sess-known-1",
      "mk-sess-known-2",
    ]);
    const fetched = service2.getMarker(OWNER, markerA.value.markerId);
    if (fetched.kind !== "allowed") throw new Error("fixture");
    expect(fetched.value.notes.map((note) => note.text)).toEqual(["note one", "note two"]);
    const markerC = service2.saveMarker(OWNER, {
      sessionId: "sess-known",
      kind: "moment",
      atMs: 5_000,
    });
    if (markerC.kind !== "allowed") throw new Error("fixture");
    expect(markerC.value.markerId).toBe("mk-sess-known-3");
    const noteC = service2.attachNote(OWNER, {
      markerId: markerA.value.markerId,
      text: "after restart",
    });
    if (noteC.kind !== "allowed") throw new Error("fixture");
    expect(noteC.value.noteId).toBe(`nt-${markerA.value.markerId}-3`);
    reopened.close();
  });

  test("validates on read — a corrupted row fails loudly, never partial data", async () => {
    const dir2 = await mkdtemp(join(tmpdir(), "sporta-analyst-corrupt-"));
    const path2 = join(dir2, "annotations.sqlite");
    const store = new SqliteAnalystAnnotationStore(path2);
    const service = makeService(store);
    const marker = service.saveMarker(OWNER, { sessionId: "sess-known", kind: "moment", atMs: 1 });
    if (marker.kind !== "allowed") throw new Error("fixture");
    store.close();

    // Corrupt the row directly (the durability seam's own drift detector).
    const { Database } = await import("bun:sqlite");
    const raw = new Database(path2);
    raw
      .query(`UPDATE sporta_analyst_markers SET document_json = ? WHERE marker_id = ?`)
      .run(
        JSON.stringify({ markerId: "mk-sess-known-1", kind: "moment", atMs: 1 }),
        "mk-sess-known-1",
      );
    raw.close();

    const reopened = new SqliteAnalystAnnotationStore(path2);
    expect(() => reopened.markerOf(marker.value.markerId)).toThrow(
      AnalystAnnotationValidationError,
    );
    expect(() => reopened.markersOf("sess-known")).toThrow(AnalystAnnotationValidationError);
    reopened.close();
    await rm(dir2, { recursive: true, force: true });
  });
});

// ---------------------------------------------------------------------------
// The clock (the composition's injected time, not Date.now)
// ---------------------------------------------------------------------------

describe("the injected clock (timestamps are the composition's)", () => {
  test("createdAtIso comes from nowMs, advancing with the injected sequence", () => {
    let t = 1_000;
    const service = createAnalystAnnotationService({
      store: new InMemoryAnalystAnnotationStore(),
      sessionTimelines: () => ({ exists: true, durationMs: SESSION_DURATION_MS }),
      ownerIdOf: () => "u-owner",
      nowMs: () => t,
    });
    const a = service.saveMarker(OWNER, { sessionId: "s", kind: "moment", atMs: 0 });
    t = 2_000;
    const b = service.saveMarker(OWNER, { sessionId: "s", kind: "moment", atMs: 0 });
    if (a.kind !== "allowed" || b.kind !== "allowed") throw new Error("fixture");
    expect(a.value.createdAtIso).toBe(new Date(1_000).toISOString());
    expect(b.value.createdAtIso).toBe(new Date(2_000).toISOString());
  });
});
