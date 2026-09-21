/**
 * THE L014 RECOVERY JOURNEY CHILD — one REAL PROCESS per phase of the
 * live/replay continuity PLATFORM battery (the J014 three-process pattern
 * applied to the live lane). The parent test
 * (`l014-platform-recovery.test.ts`) spawns THIS script over the SAME
 * scratch directory:
 *
 * - phase `live` (the fresh deployment): register + sign in, create TWO
 *   REAL sessions through the REAL upload route with LIVE-authorized
 *   policies (durable control-plane write-through), register their finite
 *   live sources on the transport, stream the COMPLETED session's window
 *   through the REAL SSE route to its honest `live-window-complete` close
 *   (recording the wire frames), then partially stream the INTERRUPTED
 *   session's long window (a few frames) and DIE (explicit exit — the
 *   process death mid-window). The completed window's record must be on
 *   disk before the exit; the interrupted window's frames are partial
 *   rows only.
 * - phase `restarted` (the RESTART — a process that never saw the live
 *   process's memory): the OLD token still resolves (the durable
 *   identity), the COMPLETED session's stream route answers the honest
 *   410 + replay pointer (NEVER a second live window over a session that
 *   already completed one), the replay route serves the PERSISTED record
 *   with the frames VERBATIM (the exact wire frames the live phase
 *   recorded), and the INTERRUPTED session answers the honest no-record
 *   (partial frames never serve) while its re-registered source opens a
 *   FRESH window honestly (ordinals from 1 — the live view recovers).
 *
 * Every durable plane rides REAL files in the scratch directory; the live
 * transport is the REAL env-gated SSE transport (SPORTA_LIVE_TRANSPORT=sse)
 * at a 100ms cadence, and the replay-record persistence is the REAL sqlite
 * store (SPORTA_LIVE_REPLAY_DB). The child fails LOUD (exit 1 + stderr) on
 * any structural surprise.
 */
const [, , phaseArg, scratchArg, reportArg] = process.argv;

if (phaseArg !== "live" && phaseArg !== "restarted") {
  console.error("usage: bun run test/helpers/l014-recovery-journey.ts <live|restarted> <scratchDir> <reportPath>");
  process.exit(2);
}
const phase: "live" | "restarted" = phaseArg;
const scratchDir = scratchArg ?? "";
const reportPath = reportArg ?? "";
if (scratchDir.length === 0 || reportPath.length === 0) {
  console.error("l014-recovery-journey: scratchDir and reportPath are required");
  process.exit(2);
}

// ---------------------------------------------------------------------------
// The durable planes — ALL pointed at the scratch directory BEFORE any
// module of the composition loads (the composition root is the only env
// reader; the singleton builds lazily on the first getSportaServer()).
// ---------------------------------------------------------------------------
const env = process.env as Record<string, string | undefined>;
env.SPORTA_IDENTITY_DB = `${scratchDir}/identity.db`;
env.SPORTA_CONTROL_DB = `${scratchDir}/control-plane.db`;
env.SPORTA_OWNERSHIP_DB = `${scratchDir}/media-ownership.db`;
env.SPORTA_MEDIA_DB = `${scratchDir}/media-platform.db`;
env.SPORTA_MEDIA_STORAGE = `${scratchDir}/media-storage`;
env.SPORTA_COMPUTE_DB = `${scratchDir}/compute-connections.db`;
// THE LIVE LANE: the real env-gated SSE transport at a fast cadence (the
// 24-tick window completes in ~2.4s), and the REAL sqlite replay store.
env.SPORTA_LIVE_TRANSPORT = "sse";
env.SPORTA_LIVE_CADENCE_MS = "100";
env.SPORTA_LIVE_REPLAY_DB = `${scratchDir}/live-replay.db`;
// The hosted gate must stay OFF — this battery proves the LOCAL durable
// shape (the sandbox has no Neon/R2 credentials; the Wave 0 record).
delete env.DATABASE_URL;

const USERNAME = "l014-recovery-user";
const PASSWORD = "a-real-l014-recovery-password";
const OPERATIONS = ["analysis", "liveDelivery", "transformation", "derivativeGeneration", "storage"];

/** The shared request builder (the cookie form the browser carries). */
function withCookie(token: string | null, path: string): Request {
  return new Request(`http://sporta.test${path}`, {
    headers: token === null ? {} : { cookie: `sporta_session=${token}` },
  });
}

async function bodyOf(response: Response): Promise<Record<string, unknown>> {
  return (await response.json()) as Record<string, unknown>;
}

function fail(message: string): never {
  console.error(`[l014-recovery-journey:${phase}] FAIL: ${message}`);
  process.exit(1);
}

async function writeReport(report: Record<string, unknown>): Promise<void> {
  await Bun.write(reportPath, JSON.stringify(report, null, 2));
}

/** Reads SSE events from a route's stream until `count` arrive (never a hang). */
async function readSseEvents(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  parser: ReturnType<typeof import("../../src/lib/live-sse").createSseParser>,
  count: number,
  timeoutMs = 30_000,
): Promise<import("../../src/lib/live-sse").SseEvent[]> {
  const decoder = new TextDecoder();
  const events: import("../../src/lib/live-sse").SseEvent[] = [];
  const deadline = Date.now() + timeoutMs;
  // ONE pending read at a time — NEVER a concurrent `reader.read()` (a
  // race-loser read would still consume the next chunk into an abandoned
  // promise; the same pending promise is re-raced against fresh timers
  // until it resolves).
  let pending: Promise<ReadableStreamReadResult<Uint8Array>> | null = null;
  while (events.length < count && Date.now() < deadline) {
    pending ??= reader.read();
    const chunk = await Promise.race([
      pending,
      new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), 25)),
    ]);
    if (chunk === undefined) continue; // the timer won — the SAME read stays pending
    pending = null;
    if (chunk.done) break;
    events.push(...parser.write(decoder.decode(chunk.value, { stream: true })));
  }
  return events;
}

/** Registers one finite live source (the transport's own seam). */
function registerFiniteSource(
  live: { registerSource(source: unknown): void },
  sessionId: string,
  tickCount: number,
  seed: number,
): void {
  live.registerSource({
    sessionId,
    label: `L014 recovery journey — ${tickCount === 24 ? "completed" : "interrupted"} window`,
    storyKey: "live-tactical-synthetic",
    steps: [],
    policy: {
      policyId: "policy-l014-recovery-journey",
      allowedOperations: OPERATIONS,
      assertedBy: "l014-recovery-journey",
    },
    snapshotVersion: 0,
    watermarkSequence: 0,
    tactical: {
      config: {
        seed,
        scenario: "normal",
        tickCount,
        rateMs: 100,
        playersPerTeam: 11,
        referees: 1,
      },
      sourceNote: "the L014 platform recovery journey (finite window)",
      finiteWindow: true,
    },
  });
}

async function main(): Promise<void> {
  // Dynamic imports — AFTER the env is set.
  const { POST: registerRoute } = await import("../../src/app/api/auth/register/route");
  const { POST: loginRoute } = await import("../../src/app/api/auth/login/route");
  const { GET: meRoute } = await import("../../src/app/api/auth/me/route");
  const { POST: uploadSessionRoute } =
    await import("../../src/app/api/create/upload-sessions/route");
  const { GET: liveStreamRoute } = await import("../../src/app/api/live/[sessionId]/route");
  const { GET: replayRoute } = await import("../../src/app/api/live/[sessionId]/replay/route");
  const { createSseParser } = await import("../../src/lib/live-sse");
  const { generateTestMp4 } = await import("@sporta/media-platform");
  const { getSportaServer } = await import("../../src/server/runtime");

  if (phase === "live") {
    // ---------------------------------------------------------------------
    // PHASE LIVE — the fresh deployment: two real live-authorized sessions,
    // one window completed, one window interrupted by process death.
    // ---------------------------------------------------------------------
    const register = await registerRoute(
      new Request("http://sporta.test/api/auth/register", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username: USERNAME, password: PASSWORD, roles: ["creator", "viewer"] }),
      }),
    );
    if (register.status !== 200) fail(`register answered ${register.status}`);
    const login = await loginRoute(
      new Request("http://sporta.test/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username: USERNAME, password: PASSWORD }),
      }),
    );
    if (login.status !== 200) fail(`login answered ${login.status}`);
    const token = ((await bodyOf(login)) as { token: string }).token;

    // The server singleton (boots the seed + the live transport).
    const server = await getSportaServer();
    await server.ready;
    if (server.live.state() !== "active") fail("the live transport is not env-active");

    // ONE real MP4, TWO real upload sessions (durable write-through).
    const clipPath = await generateTestMp4(`${scratchDir}/l014-clip.mp4`, {
      durationSeconds: 2,
      withAudio: true,
    });
    const bytes = new Uint8Array(await Bun.file(clipPath).arrayBuffer());
    async function uploadSession(): Promise<string> {
      const form = new FormData();
      form.append(
        "file",
        new File([bytes.slice().buffer as ArrayBuffer], "l014-clip.mp4", { type: "video/mp4" }),
      );
      form.append("operations", JSON.stringify(OPERATIONS));
      const upload = await uploadSessionRoute(
        new Request("http://sporta.test/api/create/upload-sessions", {
          method: "POST",
          headers: { cookie: `sporta_session=${token}` },
          body: form,
        }),
      );
      if (upload.status !== 201) fail(`upload answered ${upload.status}: ${await upload.text()}`);
      return ((await bodyOf(upload)) as { sessionId: string }).sessionId;
    }
    const completedSessionId = await uploadSession();
    const interruptedSessionId = await uploadSession();

    // Register both finite sources on the REAL transport (the live
    // ingestion's registration seam — the dev seed's own pattern).
    registerFiniteSource(server.live, completedSessionId, 24, 20260921);
    registerFiniteSource(server.live, interruptedSessionId, 600, 20260922);

    // 1. THE COMPLETED WINDOW: stream through the REAL route to the honest
    //    `live-window-complete` close, recording the wire frames.
    const streamResponse = await liveStreamRoute(
      withCookie(token, `/api/live/${completedSessionId}`),
      { params: Promise.resolve({ sessionId: completedSessionId }) },
    );
    if (streamResponse.status !== 200) fail(`the live stream answered ${streamResponse.status}`);
    const reader = streamResponse.body!.getReader();
    const parser = createSseParser();
    const helloEvents = await readSseEvents(reader, parser, 1);
    if (helloEvents.length === 0) fail("the hello never arrived");
    const wireFrames: unknown[] = [];
    let closeReason = "";
    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline) {
      // Read whatever arrives next (EVERY parsed event — a chunk may carry
      // more than one), until the terminal close.
      const events = await readSseEvents(reader, parser, 1, 5_000);
      if (events.length === 0) continue;
      for (const event of events) {
        if (event.event === "world") {
          wireFrames.push(JSON.parse(event.data));
        } else if (event.event === "close") {
          closeReason = (JSON.parse(event.data) as { reason: string }).reason;
        }
      }
      if (closeReason !== "") break;
    }
    if (closeReason !== "live-window-complete") {
      fail(`the completed window's close reason was '${closeReason}' (frames: ${wireFrames.length})`);
    }
    if (wireFrames.length !== 24) fail(`expected 24 wire frames, got ${wireFrames.length}`);
    reader.cancel().catch(() => {});

    // The pre-restart sanity: the replay route serves the in-memory record
    // and its frames EQUAL the wire frames (the platform sink wrote the
    // same bytes — asserted here, re-asserted across the restart below).
    const replayResponse = await replayRoute(
      withCookie(token, `/api/live/${completedSessionId}/replay`),
      { params: Promise.resolve({ sessionId: completedSessionId }) },
    );
    if (replayResponse.status !== 200) fail(`the replay route answered ${replayResponse.status}`);
    const record = (await bodyOf(replayResponse)) as {
      state: string;
      frames: unknown[];
      meta?: Record<string, unknown>;
    };
    if (record.state !== "complete") fail(`the pre-restart record state was ${record.state}`);
    if (JSON.stringify(record.frames) !== JSON.stringify(wireFrames)) {
      fail("the pre-restart record frames differ from the wire frames");
    }

    // 2. THE INTERRUPTED WINDOW: partially stream the long window, then
    //    DIE. The channel keeps ticking into the process death; the sink
    //    persisted the partial frames (rows without a completion).
    const interruptedResponse = await liveStreamRoute(
      withCookie(token, `/api/live/${interruptedSessionId}`),
      { params: Promise.resolve({ sessionId: interruptedSessionId }) },
    );
    if (interruptedResponse.status !== 200) {
      fail(`the interrupted session's stream answered ${interruptedResponse.status}`);
    }
    const interruptedReader = interruptedResponse.body!.getReader();
    const interruptedParser = createSseParser();
    const interruptedHello = await readSseEvents(interruptedReader, interruptedParser, 1);
    if (interruptedHello.length === 0) fail("the interrupted window's hello never arrived");
    const interruptedFrames = await readSseEvents(interruptedReader, interruptedParser, 4);
    if (interruptedFrames.filter((event) => event.event === "world").length < 4) {
      fail("the interrupted window never yielded 4 frames before the death");
    }
    // The reader is ABANDONED (never cancelled) — the window stays open;
    // the explicit exit below is the process death mid-window.
    await writeReport({
      phase,
      token,
      username: USERNAME,
      completedSessionId,
      interruptedSessionId,
      wireFrames,
      recordMeta: record.meta ?? null,
      interruptedFramesSeen: interruptedFrames.filter((event) => event.event === "world").length,
    });
    process.exit(0); // the DEATH — mid-window, after the completed record is on disk
  }

  // -------------------------------------------------------------------------
  // PHASE RESTARTED — a process that never saw the live process's memory.
  // -------------------------------------------------------------------------
  const live = JSON.parse(await Bun.file(`${scratchDir}/report-live.json`).text()) as {
    token: string;
    completedSessionId: string;
    interruptedSessionId: string;
    wireFrames: { ordinal: number; worldVersion: number; eventTimeMs: number }[];
    recordMeta: Record<string, unknown> | null;
  };

  // 0. The durable identity: the OLD token still resolves (re-proven on the
  //    live lane; the full identity battery is J014's own).
  const me = await meRoute(withCookie(live.token, "/api/auth/me"));
  if (me.status !== 200) fail(`the old token did not resolve after the restart (${me.status})`);
    const server = await getSportaServer();
  await server.ready;
  if (server.live.state() !== "active") fail("the live transport is not env-active after restart");

  // 1. THE COMPLETED SESSION: the stream route answers the honest 410 +
  //    the replay pointer (NEVER a second live window over a completed
  //    session — the no-silent-replay-as-live rule at the platform layer).
  const streamAfterRestart = await liveStreamRoute(
    withCookie(live.token, `/api/live/${live.completedSessionId}`),
    { params: Promise.resolve({ sessionId: live.completedSessionId }) },
  );
  const streamStatus = streamAfterRestart.status;
  const streamBody =
    streamStatus === 410 ? ((await bodyOf(streamAfterRestart)) as Record<string, unknown>) : null;

  // 2. The replay route serves the PERSISTED record — frames VERBATIM.
  const replayAfterRestart = await replayRoute(
    withCookie(live.token, `/api/live/${live.completedSessionId}/replay`),
    { params: Promise.resolve({ sessionId: live.completedSessionId }) },
  );
  const replayStatus = replayAfterRestart.status;
  const replayBody =
    replayStatus === 200 ? ((await bodyOf(replayAfterRestart)) as Record<string, unknown>) : null;
  const replayFramesEqual =
    replayBody !== undefined && replayBody !== null
      ? JSON.stringify(replayBody.frames) === JSON.stringify(live.wireFrames)
      : false;

  // 3. THE INTERRUPTED SESSION: the restart's live-ingestion story — the
  //    source is re-registered FIRST (the registration is the data the
  //    restart re-provides; the replayable state survives in the platform
  //    store regardless), THEN the honest no-record answers (the partial
  //    frames of the interrupted window never serve), and a FRESH window
  //    honestly runs (ordinals from 1).
  registerFiniteSource(server.live, live.interruptedSessionId, 600, 20260922);
  const interruptedReplay = await replayRoute(
    withCookie(live.token, `/api/live/${live.interruptedSessionId}/replay`),
    { params: Promise.resolve({ sessionId: live.interruptedSessionId }) },
  );
  const interruptedReplayStatus = interruptedReplay.status;
  const interruptedReplayState =
    interruptedReplayStatus === 200
      ? ((await bodyOf(interruptedReplay)) as { state: string }).state
      : null;

  const freshWindowResponse = await liveStreamRoute(
    withCookie(live.token, `/api/live/${live.interruptedSessionId}`),
    { params: Promise.resolve({ sessionId: live.interruptedSessionId }) },
  );
  const freshWindowStatus = freshWindowResponse.status;
  let freshWindowOrdinals: number[] = [];
  if (freshWindowStatus === 200) {
    const freshReader = freshWindowResponse.body!.getReader();
    const freshParser = createSseParser();
    await readSseEvents(freshReader, freshParser, 1); // hello
    const freshFrames = await readSseEvents(freshReader, freshParser, 3);
    freshWindowOrdinals = freshFrames
      .filter((event) => event.event === "world")
      .map((event) => (JSON.parse(event.data) as { ordinal: number }).ordinal);
  }

  await writeReport({
    phase,
    meStatus: me.status,
    streamStatus,
    streamFailureClass:
      streamBody !== null ? ((streamBody.error as { failureClass: string })?.failureClass ?? null) : null,
    streamReplayPath:
      streamBody !== null ? (((streamBody.error as { replayPath?: string })?.replayPath ?? null)) : null,
    streamWorldVersionLast:
      streamBody !== null
        ? (((streamBody.error as { worldVersionLast?: number })?.worldVersionLast ?? null))
        : null,
    replayStatus,
    replayState: replayBody !== null ? ((replayBody as { state: string }).state) : null,
    replayFramesLength:
      replayBody !== null ? ((replayBody as { frames: unknown[] }).frames.length) : 0,
    replayFramesEqual,
    replayMeta: replayBody !== null ? ((replayBody as { meta?: unknown }).meta ?? null) : null,
    interruptedReplayStatus,
    interruptedReplayState,
    freshWindowStatus,
    freshWindowOrdinals,
  });
  process.exit(0);
}

await main().catch((error) => {
  console.error(`[l014-recovery-journey:${phase}] UNEXPECTED: ${error}`);
  process.exit(1);
});
