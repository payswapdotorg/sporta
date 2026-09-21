/**
 * THE J014 JOURNEY CHILD — one REAL PROCESS per phase of the restart/
 * redeploy battery. The parent test (`j014-restart-redeploy.test.ts`)
 * spawns THIS script three times over the SAME scratch directory:
 *
 * - phase `a` (the fresh deployment): register a REAL account through the
 *   real route, sign in (the one-time token), run the REAL upload flow (a
 *   real ffmpeg-generated MP4 → the R101 boundary), dispatch a real render
 *   through the async compute plane, poll it to its terminal state, and
 *   record the render's content-addressed output hash.
 * - phase `b` (the RESTART — a process that never saw A's memory): the
 *   OLD login token must still resolve (the durable identity plane), the
 *   Library must list the session, Watch must serve the SAME render with
 *   the SAME content hash, the output BYTES must serve, the health surface
 *   must report the sqlite identity honestly, a FRESH sign-in with the
 *   SAME credentials must work (the password hash survived), the honest
 *   per-instance job-ledger boundary is recorded (a cold instance never
 *   saw the dispatch), and the publication is flipped for phase C.
 * - phase `c` (the REDEPLOY): the ANONYMOUS catalog sees the now-public
 *   session, anonymous Watch serves the same output, and the owner's
 *   STILL-OLD token keeps resolving (identity durable across TWO boots).
 *
 * Every durable plane rides REAL files in the scratch directory (sqlite
 * WAL files + the local-filesystem media storage); every observation is
 * recorded in the phase's JSON report for the parent to assert. The child
 * fails LOUD (exit 1 + stderr) on any structural surprise — never a
 * smoothed-over green.
 */
const [, , phaseArg, scratchArg, reportArg] = process.argv;

if (phaseArg !== "a" && phaseArg !== "b" && phaseArg !== "c") {
  console.error("usage: bun run test/helpers/j014-journey.ts <a|b|c> <scratchDir> <reportPath>");
  process.exit(2);
}
const phase: "a" | "b" | "c" = phaseArg;
const scratchDir = scratchArg ?? "";
const reportPath = reportArg ?? "";
if (scratchDir.length === 0 || reportPath.length === 0) {
  console.error("j014-journey: scratchDir and reportPath are required");
  process.exit(2);
}

// ---------------------------------------------------------------------------
// The durable planes — ALL of them pointed at the scratch directory BEFORE
// any module of the composition is loaded (the composition root is the only
// env reader; the singleton builds lazily on the first getSportaServer()).
// ---------------------------------------------------------------------------
const env = process.env as Record<string, string | undefined>;
env.SPORTA_IDENTITY_DB = `${scratchDir}/identity.db`;
env.SPORTA_CONTROL_DB = `${scratchDir}/control-plane.db`;
env.SPORTA_OWNERSHIP_DB = `${scratchDir}/media-ownership.db`;
env.SPORTA_MEDIA_DB = `${scratchDir}/media-platform.db`;
env.SPORTA_MEDIA_STORAGE = `${scratchDir}/media-storage`;
env.SPORTA_COMPUTE_DB = `${scratchDir}/compute-connections.db`;
// The hosted gate must stay OFF — this battery proves the LOCAL durable
// shape (the sandbox has no Neon/R2 credentials; the Wave 0 record).
delete env.DATABASE_URL;

const USERNAME = "j014-restart-user";
const PASSWORD = "a-real-j014-restart-password";
const OPERATIONS = ["analysis", "transformation", "derivativeGeneration", "storage"];

/** The shared request builder (the cookie form the browser carries). */
function withCookie(token: string | null, path: string, init: RequestInit = {}): Request {
  return new Request(`http://sporta.test${path}`, {
    ...init,
    headers: {
      ...((init.headers as Record<string, string> | undefined) ?? {}),
      ...(token === null ? {} : { cookie: `sporta_session=${token}` }),
    },
  });
}

async function bodyOf(response: Response): Promise<Record<string, unknown>> {
  return (await response.json()) as Record<string, unknown>;
}

function fail(message: string): never {
  console.error(`[j014-journey:${phase}] FAIL: ${message}`);
  process.exit(1);
}

async function writeReport(report: Record<string, unknown>): Promise<void> {
  await Bun.write(reportPath, JSON.stringify(report, null, 2));
}

async function main(): Promise<void> {
  // Dynamic imports — AFTER the env is set (no module-scope composition
  // state can outlive this point).
  const { POST: registerRoute } = await import("../../src/app/api/auth/register/route");
  const { POST: loginRoute } = await import("../../src/app/api/auth/login/route");
  const { GET: meRoute } = await import("../../src/app/api/auth/me/route");
  const { POST: uploadSessionRoute } =
    await import("../../src/app/api/create/upload-sessions/route");
  const { POST: renderRoute } =
    await import("../../src/app/api/create/sessions/[sessionId]/renders/route");
  const { GET: jobRoute } =
    await import("../../src/app/api/create/sessions/[sessionId]/jobs/[jobId]/route");
  const { GET: sessionStateRoute } =
    await import("../../src/app/api/create/sessions/[sessionId]/route");
  const { POST: publicationRoute } =
    await import("../../src/app/api/create/sessions/[sessionId]/publication/route");
  const { GET: watchRoute } = await import("../../src/app/api/watch/[sessionId]/route");
  const { GET: libraryRoute } = await import("../../src/app/api/catalog/library/route");
  const { GET: catalogRoute } = await import("../../src/app/api/catalog/sessions/route");
  const { GET: outputRoute } =
    await import("../../src/app/api/watch/[sessionId]/renders/[renderId]/outputs/[segmentId]/route");
  const { GET: healthRoute } = await import("../../src/app/api/platform/health/route");
  const { generateTestMp4 } = await import("@sporta/media-platform");

  if (phase === "a") {
    // ---------------------------------------------------------------------
    // PHASE A — the fresh deployment: the full real journey.
    // ---------------------------------------------------------------------
    const register = await registerRoute(
      withCookie(null, "/api/auth/register", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          username: USERNAME,
          password: PASSWORD,
          roles: ["creator", "viewer"],
        }),
      }),
    );
    if (register.status !== 200) {
      fail(`register answered ${register.status}: ${await register.text()}`);
    }
    const account = (await bodyOf(register)) as { userId: string; username: string };

    const login = await loginRoute(
      withCookie(null, "/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username: USERNAME, password: PASSWORD }),
      }),
    );
    if (login.status !== 200) fail(`login answered ${login.status}`);
    const loginBody = (await bodyOf(login)) as { token: string };
    const token = loginBody.token;

    // The REAL upload flow (a real ffmpeg-generated MP4).
    const clipPath = await generateTestMp4(`${scratchDir}/j014-clip.mp4`, {
      durationSeconds: 2,
      withAudio: true,
    });
    const bytes = new Uint8Array(await Bun.file(clipPath).arrayBuffer());
    const form = new FormData();
    form.append(
      "file",
      new File([bytes.slice().buffer as ArrayBuffer], "j014-clip.mp4", { type: "video/mp4" }),
    );
    form.append("operations", JSON.stringify(OPERATIONS));
    const upload = await uploadSessionRoute(
      withCookie(token, "/api/create/upload-sessions", { method: "POST", body: form }),
    );
    if (upload.status !== 201) fail(`upload answered ${upload.status}: ${await upload.text()}`);
    const sessionId = ((await bodyOf(upload)) as { sessionId: string }).sessionId;

    // A real render through the async compute plane.
    const dispatch = await renderRoute(
      withCookie(token, `/api/create/sessions/${sessionId}/renders`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          rendererId: "anime.prototype",
          styleId: "j014-restart-test",
          compute: { mode: "sporta-auto" },
        }),
      }),
      { params: Promise.resolve({ sessionId }) },
    );
    if (dispatch.status !== 202)
      fail(`dispatch answered ${dispatch.status}: ${await dispatch.text()}`);
    const dispatchBody = (await bodyOf(dispatch)) as { jobId: string };

    let renderId = "";
    let jobState = "";
    for (let attempt = 0; attempt < 600; attempt += 1) {
      const poll = await jobRoute(
        withCookie(token, `/api/create/sessions/${sessionId}/jobs/${dispatchBody.jobId}`),
        { params: Promise.resolve({ sessionId, jobId: dispatchBody.jobId }) },
      );
      if (poll.status !== 200) fail(`job poll answered ${poll.status}`);
      const job = (await bodyOf(poll)) as { renderId?: string; state: string };
      jobState = job.state;
      if (typeof job.renderId === "string" && job.renderId.length > 0) {
        renderId = job.renderId;
        break;
      }
      await Bun.sleep(50);
    }
    if (renderId === "") fail(`the render never reached a renderId (last state: ${jobState})`);

    // The watch answer carries the stored output's content address.
    const watch = await watchRoute(withCookie(token, `/api/watch/${sessionId}`), {
      params: Promise.resolve({ sessionId }),
    });
    if (watch.status !== 200) fail(`watch answered ${watch.status}`);
    const watchBody = (await bodyOf(watch)) as {
      renders: { renderId: string; outputs: { segmentId: string; contentHash: string }[] }[];
    };
    const render = watchBody.renders.find((entry) => entry.renderId === renderId);
    if (render === undefined || render.outputs.length === 0) fail("watch carried no outputs");
    const first = render.outputs[0]!;

    await writeReport({
      phase: "a",
      username: USERNAME,
      password: PASSWORD,
      token,
      userId: account.userId,
      sessionId,
      renderId,
      segmentId: first.segmentId,
      contentHash: first.contentHash,
      jobState,
    });
    process.exit(0);
  }

  if (phase === "b") {
    // ---------------------------------------------------------------------
    // PHASE B — the RESTART: a process that never saw A's memory. Everything
    // below must recover from the durable files ALONE (zero developer
    // intervention).
    // ---------------------------------------------------------------------
    const reportA = JSON.parse(await Bun.file(`${scratchDir}/report-a.json`).text()) as {
      token: string;
      userId: string;
      sessionId: string;
      renderId: string;
      segmentId: string;
      contentHash: string;
    };

    // 1. THE IDENTITY PLANE: the OLD token (issued by process A, BEFORE the
    //    restart) still resolves — the login session survived.
    const me = await meRoute(withCookie(reportA.token, "/api/auth/me"));
    if (me.status !== 200) fail(`me with the OLD token answered ${me.status}`);
    const meBody = (await bodyOf(me)) as { userId: string; username: string };

    // 2. LIBRARY recovery: the owner's library lists the session.
    const library = await libraryRoute(withCookie(reportA.token, "/api/catalog/library"));
    if (library.status !== 200) fail(`library answered ${library.status}`);
    const libraryBody = (await bodyOf(library)) as { sessions: { sessionId: string }[] };
    const libraryHasSession = libraryBody.sessions.some(
      (entry) => entry.sessionId === reportA.sessionId,
    );

    // 3. WATCH recovery: the same render, the SAME content-addressed output.
    const watch = await watchRoute(withCookie(reportA.token, `/api/watch/${reportA.sessionId}`), {
      params: Promise.resolve({ sessionId: reportA.sessionId }),
    });
    if (watch.status !== 200) fail(`watch answered ${watch.status}`);
    const watchBody = (await bodyOf(watch)) as {
      renders: { renderId: string; outputs: { segmentId: string; contentHash: string }[] }[];
    };
    const render = watchBody.renders.find((entry) => entry.renderId === reportA.renderId);
    const watchRenderFound = render !== undefined;
    const contentHashMatches =
      watchRenderFound && render!.outputs[0]?.contentHash === reportA.contentHash;

    // 4. The output BYTES serve from the durable storage (the playback read).
    const output = await outputRoute(
      withCookie(
        reportA.token,
        `/api/watch/${reportA.sessionId}/renders/${reportA.renderId}/outputs/${reportA.segmentId}`,
      ),
      {
        params: Promise.resolve({
          sessionId: reportA.sessionId,
          renderId: reportA.renderId,
          segmentId: reportA.segmentId,
        }),
      },
    );
    const outputStatus = output.status;
    const outputText = outputStatus === 200 ? await output.text() : "";

    // 5. The health surface reports the sqlite identity plane honestly.
    const health = await healthRoute();
    if (health.status !== 200) fail(`health answered ${health.status}`);
    const healthBody = (await bodyOf(health)) as {
      providers: {
        identity: {
          provider: string;
          configured: boolean;
          check: { state: string; detail?: string };
        };
      };
    };
    const identity = healthBody.providers.identity;

    // 6. A FRESH sign-in with the SAME credentials (the password hash + the
    //    account row survived the restart).
    const freshLogin = await loginRoute(
      withCookie(null, "/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username: USERNAME, password: PASSWORD }),
      }),
    );
    if (freshLogin.status !== 200) fail(`fresh login answered ${freshLogin.status}`);
    const freshLoginBody = (await bodyOf(freshLogin)) as {
      token: string;
      account: { userId: string };
    };

    // 7. The honest per-instance job-ledger boundary (W921/DEPLOYMENT.md §8):
    //    the cold instance never saw the dispatch — the session's job list
    //    is EMPTY, never invented.
    const state = await sessionStateRoute(
      withCookie(reportA.token, `/api/create/sessions/${reportA.sessionId}`),
      { params: Promise.resolve({ sessionId: reportA.sessionId }) },
    );
    if (state.status !== 200) fail(`session state answered ${state.status}`);
    const stateBody = (await bodyOf(state)) as { jobs: unknown[] };
    const jobsCount = Array.isArray(stateBody.jobs) ? stateBody.jobs.length : -1;

    // 8. Flip the publication (the visibility write-through persists for C).
    const publish = await publicationRoute(
      withCookie(reportA.token, `/api/create/sessions/${reportA.sessionId}/publication`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ visibility: "public" }),
      }),
      { params: Promise.resolve({ sessionId: reportA.sessionId }) },
    );
    if (publish.status !== 200) fail(`publication answered ${publish.status}`);

    await writeReport({
      phase: "b",
      meStatus: me.status,
      meUserId: meBody.userId,
      meUsername: meBody.username,
      libraryHasSession,
      watchRenderFound,
      contentHashMatches,
      outputStatus,
      outputContainsSegment: outputText.includes(reportA.segmentId),
      identityProvider: identity.provider,
      identityConfigured: identity.configured,
      identityCheckState: identity.check.state,
      identityCheckDetail: identity.check.detail ?? null,
      freshLoginStatus: freshLogin.status,
      freshLoginUserId: freshLoginBody.account.userId,
      freshTokenIsNew: freshLoginBody.token !== reportA.token,
      jobsCount,
      publicationStatus: publish.status,
    });
    process.exit(0);
  }

  // phase === "c"
  // -------------------------------------------------------------------------
  // PHASE C — the REDEPLOY: the anonymous public path + the owner's STILL-old
  // token (identity durable across TWO boots).
  // -------------------------------------------------------------------------
  const reportA = JSON.parse(await Bun.file(`${scratchDir}/report-a.json`).text()) as {
    token: string;
    userId: string;
    sessionId: string;
    renderId: string;
    contentHash: string;
  };

  const catalog = await catalogRoute(withCookie(null, "/api/catalog/sessions"));
  if (catalog.status !== 200) fail(`catalog answered ${catalog.status}`);
  const catalogBody = (await bodyOf(catalog)) as { sessions: { sessionId: string }[] };
  const catalogHasSession = catalogBody.sessions.some(
    (entry) => entry.sessionId === reportA.sessionId,
  );

  const watch = await watchRoute(withCookie(null, `/api/watch/${reportA.sessionId}`), {
    params: Promise.resolve({ sessionId: reportA.sessionId }),
  });
  if (watch.status !== 200) fail(`anonymous watch answered ${watch.status}`);
  const watchBody = (await bodyOf(watch)) as {
    renders: { renderId: string; outputs: { contentHash: string }[] }[];
  };
  const render = watchBody.renders.find((entry) => entry.renderId === reportA.renderId);
  const anonymousContentHashMatches =
    render !== undefined && render.outputs[0]?.contentHash === reportA.contentHash;

  const me = await meRoute(withCookie(reportA.token, "/api/auth/me"));
  if (me.status !== 200) fail(`owner me across TWO restarts answered ${me.status}`);
  const meBody = (await bodyOf(me)) as { userId: string };

  const library = await libraryRoute(withCookie(reportA.token, "/api/catalog/library"));
  if (library.status !== 200) fail(`owner library answered ${library.status}`);
  const libraryBody = (await bodyOf(library)) as { sessions: { sessionId: string }[] };

  await writeReport({
    phase: "c",
    catalogHasSession,
    anonymousWatchStatus: watch.status,
    anonymousContentHashMatches,
    ownerMeStatus: me.status,
    ownerMeUserId: meBody.userId,
    ownerLibraryHasSession: libraryBody.sessions.some(
      (entry) => entry.sessionId === reportA.sessionId,
    ),
  });
  process.exit(0);
}

main().catch((error) => {
  console.error(`[j014-journey:${phase}] UNCAUGHT:`, error);
  process.exit(1);
});
