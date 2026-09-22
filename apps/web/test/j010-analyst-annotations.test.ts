import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createDeterministicTestHasher } from "@sporta/identity";
import { generateTestMp4 } from "@sporta/media-platform";
import { createSportaServer, installSportaServerForTests } from "../src/server/composition";
import type { SportaServer } from "../src/server/composition";
import { SPORTA_SESSION_COOKIE } from "../src/server/auth-service";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LocalFilesystemStorage } from "@sporta/media-platform";
import {
  GET as markersListRoute,
  POST as markersPostRoute,
} from "../src/app/api/annotations/markers/route";
import { GET as markerRoute } from "../src/app/api/annotations/markers/[markerId]/route";
import { POST as notesPostRoute } from "../src/app/api/annotations/notes/route";
import { POST as uploadSessionRoute } from "../src/app/api/create/upload-sessions/route";

/**
 * J010 TESTS — the Analyst CLIPS/NOTES surface over the REAL
 * analyst-annotations domain seam (wave 4, Worker B):
 *
 * - markers save ONLY where a REAL session timeline backs them: a real MP4
 *   uploaded through the studio's R101 boundary (real ffmpeg) carries the
 *   durable SourceAsset duration that backs the marker; a story-only
 *   session (no media) refuses honestly with `no-timeline`;
 * - the closed refusal vocabulary answers typed with useful next actions:
 *   session-unknown, no-timeline, out-of-range, marker-unknown (404),
 *   invalid-input;
 * - the NO-BYTES invariant is pinned at the API boundary: the documents
 *   carry time ranges + backing references ONLY — no byte-shaped member
 *   ever appears (no `bytes`, no `dataUrl`, no `content`);
 * - access follows the domain's own identity rule: the session's owner, an
 *   operator, or the analyst grant; anonymous → 401; a plain viewer → the
 *   uniform 403;
 * - notes attach to saved markers (first-class: verified author +
 *   timestamp) and the revisit seams list them back;
 * - persistence: the durable sqlite annotation store reloads the markers
 *   under a SECOND composition over the same database file.
 */

const NOW_MS = 1_809_999_999_000;

let server: SportaServer;
let scratch = "";
let annotationsDb = "";
let uploadedSessionId = "";
let timelineDurationMs = 0;
let creatorToken = "";
let analystToken = "";
let viewerToken = "";
/** A dev-seeded story session (no real media — the no-timeline case). */
let storySessionId = "";

function withCookie(path: string, token: string | null, init: RequestInit = {}): Request {
  return new Request(`http://sporta.test${path}`, {
    ...init,
    headers: {
      ...((init.headers as Record<string, string> | undefined) ?? {}),
      ...(token === null ? {} : { cookie: `${SPORTA_SESSION_COOKIE}=${token}` }),
    },
  });
}

function jsonPost(payload: unknown): RequestInit {
  return {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  };
}

async function bodyOf(response: Response): Promise<Record<string, unknown>> {
  return (await response.json()) as Record<string, unknown>;
}

function uploadRequest(token: string | null, bytes: Uint8Array): Request {
  const form = new FormData();
  form.append(
    "file",
    new File([bytes.slice().buffer as ArrayBuffer], "clip.mp4", { type: "video/mp4" }),
  );
  form.append(
    "operations",
    JSON.stringify(["analysis", "transformation", "derivativeGeneration", "storage"]),
  );
  return withCookie("/api/create/upload-sessions", token, { method: "POST", body: form });
}

async function createAccount(
  username: string,
  roles: string[],
): Promise<{ userId: string; token: string }> {
  const account = await server.accounts.create({
    username,
    email: undefined,
    passwordHash: "not-a-login-path",
    roles: roles as never,
    createdAtIso: new Date(NOW_MS).toISOString(),
  });
  const session = await server.auth.issueSession({ userId: account.userId });
  return { userId: account.userId, token: session.token };
}

beforeAll(async () => {
  scratch = await mkdtemp(join(tmpdir(), "sporta-j010-"));
  annotationsDb = join(scratch, "annotations.db");
  server = createSportaServer({
    nowMs: () => NOW_MS,
    passwordHasher: createDeterministicTestHasher(),
    seed: true,
    media: {
      db: ":memory:",
      storage: new LocalFilesystemStorage(join(scratch, "media-storage")),
    },
    annotations: { db: annotationsDb },
  });
  installSportaServerForTests(server);
  await server.ready;

  const creator = await createAccount("j010-creator", ["creator", "viewer"]);
  creatorToken = creator.token;
  const analyst = await createAccount("j010-analyst", ["analyst", "viewer"]);
  analystToken = analyst.token;
  const viewer = await createAccount("j010-viewer", ["viewer"]);
  viewerToken = viewer.token;

  // A REAL uploaded session (real ffmpeg-generated MP4 → real timeline).
  // The media job runs async (autoRun) — poll the REAL artifact store until
  // the `original` reality's normalized MP4 lands (bounded — the honest
  // wait, never a fabricated timeline).
  const clipPath = await generateTestMp4(join(scratch, "clip.mp4"), {
    durationSeconds: 2,
    withAudio: true,
  });
  const bytes = new Uint8Array(await Bun.file(clipPath).arrayBuffer());
  const upload = await uploadSessionRoute(uploadRequest(creatorToken, bytes));
  expect(upload.status).toBe(201);
  const uploadBody = (await bodyOf(upload)) as {
    sessionId: string;
    source: { asset: { durationMs: number } };
  };
  uploadedSessionId = uploadBody.sessionId;
  timelineDurationMs = uploadBody.source.asset.durationMs;
  expect(timelineDurationMs).toBeGreaterThanOrEqual(1900);
  for (let attempt = 0; attempt < 400; attempt += 1) {
    const artifact = server.media
      .artifactsOfSession(uploadedSessionId)
      .find((entry) => entry.reality === "original");
    if (artifact !== undefined) break;
    await Bun.sleep(25);
  }
  expect(
    server.media
      .artifactsOfSession(uploadedSessionId)
      .find((entry) => entry.reality === "original"),
  ).toBeDefined();

  // A dev-seeded story session (real SWM engine, NO real media timeline).
  storySessionId = (await server.control.listSessions()).sessions.find(
    (summary) => server.storyIndex.get(summary.id)?.storyKey === "derby",
  )!.id;
});

afterAll(async () => {
  await rm(scratch, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// The backing: real timelines vs story-only sessions
// ---------------------------------------------------------------------------

describe("J010: the markers list answers the honest timeline state", () => {
  test("an uploaded session's REAL timeline backs markers (the durable asset's duration)", async () => {
    const response = await markersListRoute(
      withCookie(
        `/api/annotations/markers?session=${encodeURIComponent(uploadedSessionId)}`,
        creatorToken,
      ),
    );
    expect(response.status).toBe(200);
    const body = await bodyOf(response);
    expect(body.timeline).toMatchObject({ available: true });
    expect((body.timeline as Record<string, number>).durationMs).toBe(timelineDurationMs);
    expect(body.markers).toEqual([]);
  });

  test("a story-only session honestly has NO timeline (never a guessed extent)", async () => {
    // The ANALYST grant reads any mediated session (the domain gate's own
    // reach); the story session has real SWM state but no stored media.
    const response = await markersListRoute(
      withCookie(
        `/api/annotations/markers?session=${encodeURIComponent(storySessionId)}`,
        analystToken,
      ),
    );
    expect(response.status).toBe(200);
    const body = await bodyOf(response);
    expect(body.timeline).toMatchObject({ available: false, reason: "no-timeline" });
  });

  test("anonymous callers get the real 401; a plain viewer the uniform 403 (no oracle)", async () => {
    const anonymous = await markersListRoute(
      new Request(`http://sporta.test/api/annotations/markers?session=${uploadedSessionId}`),
    );
    expect(anonymous.status).toBe(401);
    const viewer = await markersListRoute(
      withCookie(
        `/api/annotations/markers?session=${encodeURIComponent(uploadedSessionId)}`,
        viewerToken,
      ),
    );
    expect(viewer.status).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// Saving markers (the closed refusal vocabulary)
// ---------------------------------------------------------------------------

describe("J010: saving markers through the domain seam", () => {
  test("the owner saves a MOMENT marker on the real timeline (time range + backing, never bytes)", async () => {
    const response = await markersPostRoute(
      withCookie(
        "/api/annotations/markers",
        creatorToken,
        jsonPost({
          sessionId: uploadedSessionId,
          kind: "moment",
          atMs: 500,
          label: "first look",
        }),
      ),
    );
    expect(response.status).toBe(201);
    const marker = await bodyOf(response);
    expect(marker.markerId).toBe(`mk-${uploadedSessionId}-1`);
    expect(marker.kind).toBe("moment");
    expect(marker.atMs).toBe(500);
    expect(marker.backing).toMatchObject({
      kind: "session-timeline",
      durationMs: timelineDurationMs,
    });
    expect(marker.authorUserId).toBeTruthy();
    // THE NO-BYTES PIN: the persisted document is a time range + a backing
    // reference — no byte-shaped member exists anywhere in it.
    for (const key of Object.keys(marker)) {
      expect(key).not.toMatch(/byte|dataurl|content|buffer|base64/i);
    }
    expect(JSON.stringify(marker)).not.toMatch(/"(bytes|dataUrl|content|buffer)"/i);
  });

  test("the ANALYST GRANT saves a CLIP marker on another owner's session (the grant's own reach)", async () => {
    const response = await markersPostRoute(
      withCookie(
        "/api/annotations/markers",
        analystToken,
        jsonPost({
          sessionId: uploadedSessionId,
          kind: "clip",
          startMs: 250,
          endMs: 1500,
          label: "build-up",
        }),
      ),
    );
    expect(response.status).toBe(201);
    const marker = await bodyOf(response);
    expect(marker.markerId).toBe(`mk-${uploadedSessionId}-2`);
    expect(marker.backing).toMatchObject({ kind: "session-timeline" });
  });

  test("a plain viewer cannot save (the uniform 403)", async () => {
    const response = await markersPostRoute(
      withCookie(
        "/api/annotations/markers",
        viewerToken,
        jsonPost({ sessionId: uploadedSessionId, kind: "moment", atMs: 100 }),
      ),
    );
    expect(response.status).toBe(403);
  });

  test("out-of-range answers the closed vocabulary with the useful next action (422)", async () => {
    const response = await markersPostRoute(
      withCookie(
        "/api/annotations/markers",
        creatorToken,
        jsonPost({ sessionId: uploadedSessionId, kind: "moment", atMs: timelineDurationMs + 5000 }),
      ),
    );
    expect(response.status).toBe(422);
    const body = await bodyOf(response);
    const error = body.error as Record<string, unknown>;
    expect(error.failureClass).toBe("annotation-refused");
    expect((error.details as Record<string, string>).reason).toBe("out-of-range");
    expect(error.message).toContain("inside the session's real timeline extent");
  });

  test("a story-only session refuses with no-timeline (and says what to do)", async () => {
    const response = await markersPostRoute(
      withCookie(
        "/api/annotations/markers",
        analystToken,
        jsonPost({ sessionId: storySessionId, kind: "moment", atMs: 100 }),
      ),
    );
    expect(response.status).toBe(422);
    const error = (await bodyOf(response)).error as Record<string, unknown>;
    expect((error.details as Record<string, string>).reason).toBe("no-timeline");
    expect(error.message).toContain("upload authorized footage");
  });

  test("an unknown session denies uniformly for every standing (no existence oracle at the gate)", async () => {
    // The domain gate's own order: an unreadable ownership record denies
    // unknown-resource FIRST — even for the analyst grant — so probing ids
    // learns nothing (the session-unknown refusal is for the exotic case of
    // readable ownership with no session behind it; the gate is the boundary
    // every caller actually meets).
    const analystResponse = await markersPostRoute(
      withCookie(
        "/api/annotations/markers",
        analystToken,
        jsonPost({ sessionId: "sess-does-not-exist", kind: "moment", atMs: 0 }),
      ),
    );
    expect(analystResponse.status).toBe(403);
    const error = (await bodyOf(analystResponse)).error as Record<string, unknown>;
    expect((error.details as Record<string, string>).reason).toBe("unknown-resource");
  });

  test("a malformed marker body is a typed 400 (never applied)", async () => {
    const response = await markersPostRoute(
      withCookie(
        "/api/annotations/markers",
        creatorToken,
        jsonPost({ sessionId: uploadedSessionId, kind: "moment" }), // no atMs
      ),
    );
    expect(response.status).toBe(400);
    const error = (await bodyOf(response)).error as Record<string, string>;
    expect(error.failureClass).toBe("validation");
  });
});

// ---------------------------------------------------------------------------
// Notes + the revisit seams
// ---------------------------------------------------------------------------

describe("J010: notes attach and the revisit seams list them back", () => {
  test("the analyst attaches a note to the saved marker (verified author + timestamp)", async () => {
    const response = await notesPostRoute(
      withCookie(
        "/api/annotations/notes",
        analystToken,
        jsonPost({ markerId: `mk-${uploadedSessionId}-1`, text: "The press trap starts here." }),
      ),
    );
    expect(response.status).toBe(201);
    const note = await bodyOf(response);
    expect(note.noteId).toBe(`nt-mk-${uploadedSessionId}-1-1`);
    expect(note.text).toBe("The press trap starts here.");
    expect(note.authorUserId).toBeTruthy();
    expect(typeof note.createdAtIso).toBe("string");
  });

  test("an unknown marker answers the honest 404 (marker-unknown)", async () => {
    const response = await notesPostRoute(
      withCookie(
        "/api/annotations/notes",
        analystToken,
        jsonPost({ markerId: "mk-nobody-1", text: "orphan note" }),
      ),
    );
    expect(response.status).toBe(404);
    const error = (await bodyOf(response)).error as Record<string, unknown>;
    expect((error.details as Record<string, string>).reason).toBe("marker-unknown");
  });

  test("a too-long note refuses with invalid-input (the domain's own bound)", async () => {
    const response = await notesPostRoute(
      withCookie(
        "/api/annotations/notes",
        analystToken,
        jsonPost({ markerId: `mk-${uploadedSessionId}-1`, text: "x".repeat(4001) }),
      ),
    );
    expect(response.status).toBe(422);
    const error = (await bodyOf(response)).error as Record<string, unknown>;
    expect((error.details as Record<string, string>).reason).toBe("invalid-input");
  });

  test("the marker drill-down answers the marker WITH its notes (the revisit seam)", async () => {
    const response = await markerRoute(
      withCookie(
        `/api/annotations/markers/${encodeURIComponent(`mk-${uploadedSessionId}-1`)}`,
        creatorToken,
      ),
      { params: Promise.resolve({ markerId: `mk-${uploadedSessionId}-1` }) },
    );
    expect(response.status).toBe(200);
    const body = await bodyOf(response);
    expect((body.marker as Record<string, unknown>).markerId).toBe(`mk-${uploadedSessionId}-1`);
    const notes = body.notes as Record<string, unknown>[];
    expect(notes.length).toBe(1);
    expect(notes[0]!.text).toBe("The press trap starts here.");
  });

  test("the markers list carries BOTH markers in save order", async () => {
    const response = await markersListRoute(
      withCookie(
        `/api/annotations/markers?session=${encodeURIComponent(uploadedSessionId)}`,
        creatorToken,
      ),
    );
    expect(response.status).toBe(200);
    const markers = (await bodyOf(response)).markers as Record<string, unknown>[];
    expect(markers.map((marker) => marker.markerId)).toEqual([
      `mk-${uploadedSessionId}-1`,
      `mk-${uploadedSessionId}-2`,
    ]);
  });
});

// ---------------------------------------------------------------------------
// Persistence (the durable sqlite annotation store)
// ---------------------------------------------------------------------------

describe("J010: the durable annotation store survives a second composition", () => {
  test("a second server over the SAME database file lists the markers back (restart-safe ids)", async () => {
    const second = createSportaServer({
      nowMs: () => NOW_MS,
      passwordHasher: createDeterministicTestHasher(),
      seed: false,
      media: {
        db: ":memory:",
        storage: new LocalFilesystemStorage(join(scratch, "media-storage-2")),
      },
      annotations: { db: annotationsDb },
    });
    // The store itself is the persistence seam — read it through the second
    // composition's own store (the same port the route serves):
    const markers = second.annotationStore.markersOf(uploadedSessionId);
    expect(markers.length).toBe(2);
    expect(markers[0]!.markerId).toBe(`mk-${uploadedSessionId}-1`);
    expect(markers[1]!.kind).toBe("clip");
    // The gap-free counters continue after the persisted maximum:
    const next = second.annotationStore.putMarker({
      sessionId: uploadedSessionId,
      kind: "moment",
      atMs: 1200,
      authorUserId: "j010-analyst",
      createdAtIso: new Date(NOW_MS).toISOString(),
      backing: { kind: "session-timeline", durationMs: timelineDurationMs },
    });
    expect(next.markerId).toBe(`mk-${uploadedSessionId}-3`);
  });
});
