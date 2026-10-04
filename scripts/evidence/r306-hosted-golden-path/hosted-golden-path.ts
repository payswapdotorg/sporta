/**
 * R306 HOSTED GOLDEN PATH — THE ARC'S CLOSURE (DEVELOPMENT-TIME EVIDENCE, not
 * a test): the derived kinds' four-reality journey WITH the encode seam
 * injected, driven against the LIVE production deployment — the flight the
 * G12 walk named. The G12 walk's measured gap (the J004 one-submission leg
 * of `r607-decode-seam-recovery/hosted-golden-path.ts`) recorded the derived
 * kinds refusing with the TYPED `producer-unavailable` class because the
 * hosted runtime ships no ffmpeg: the derived-reality plane composes ONLY
 * when the R306/R301 encode toolchain probes available, and at every
 * pre-seam sha the local probes refused on the hosted Vercel runtime.
 *
 * At the R306 arc's tip (the encode-seam merge `dc2ed8f` + the live-wire +
 * deploy merges; deployMarker `r306-encode-seam-deploy-1`) the code-measured
 * expectation FLIPS: the composition injects the http encode pair into
 * `createDerivedRealityPlane` when `MEDIA_TOOLCHAIN=http`, so the hosted
 * runtime's derived-reality plane composes over the wire (the pair's own
 * honest availability = the live worker's descriptor advertising the
 * ADDITIVE `encode-frames` operation) and the J004 plan's producers
 * register. THIS driver measures what MEASURED happened — the derived kinds'
 * REAL hosted encodes (the artifacts played back integrity-verified over the
 * watch byte routes) or any honest typed refusal (recorded as the typed
 * outcome, never fabricated around).
 *
 * Legs (the r607 hosted walk's shape, the derived kinds' journey measured):
 *   0. the production plane's boot state (the marker) + BOTH live workers'
 *      descriptors + the media toolchain's worker-side stats/usage BEFORE;
 *   1. register a fresh user → login (the session cookie);
 *   2. leg A — the r607 walk's upload admission, mirrored: the REAL
 *      corpus-shaped clip (generateTestMp4, pitch scene, 2s, 320x240, audio)
 *      + the four allowed operations + a label → the media job polled to its
 *      terminal state → the watch leg: the catalog + the Original's
 *      byte-route playback INTEGRITY-VERIFIED (sha-matched, ftyp, the 206
 *      Range slice);
 *   3. leg B — THE J004 ONE-SUBMISSION (the decisive leg): the `realities`
 *      form field + the compute directive + a styleId; the upload answer's
 *      render plan (per-reality rendererId/disposition/jobId/typed failure
 *      VERBATIM — the exact surface the G12 walk measured refusing); each
 *      dispatched job polled to terminal on the app's own job view AND the
 *      compute worker's own job record; the reality catalog walked (bounded);
 *      THE FOUR REALITIES played back — for every kind that PRODUCED, the
 *      artifact's byte route INTEGRITY-VERIFIED (the sha, the byte length,
 *      the ftyp magic, the geometry re-measured with ffprobe at the
 *      receiving boundary); for every kind that refused, the typed class
 *      recorded verbatim;
 *   4. the accounting AFTER: the media toolchain's worker-side stats/usage
 *      re-read (every NEW job record fetched for its operation — the
 *      encode-frames dispatches counted at the worker, the ledger identities
 *      re-derived from the record's own numbers).
 *
 * Modes:
 *   --base https://sporta-flame.vercel.app   REQUIRED — the production alias
 *     serving the r306-encode-seam-deploy-1 deployment (the arc tip 6832183).
 *   --expected-marker r306-encode-seam-deploy-1 (the family the walk expects).
 *   --media-worker https://3971-….e2b.app    the baked live media toolchain.
 *   --compute-worker https://3973-….e2b.app  the baked live compute worker.
 *
 * Run (from the REPO ROOT):
 *   bun run scripts/evidence/r306-hosted-golden-path/hosted-golden-path.ts \
 *     --base https://sporta-flame.vercel.app
 */
import { mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { generateTestMp4, sha256OfBytes } from "@sporta/media-platform";

// ---------------------------------------------------------------------------
// CLI (dev-time: argparse by hand, no deps)
// ---------------------------------------------------------------------------
const argv = process.argv.slice(2);
function argValue(flag: string): string | undefined {
  const at = argv.indexOf(flag);
  return at === -1 ? undefined : argv[at + 1];
}
const baseArg = argValue("--base");
if (baseArg === undefined) {
  console.error("FATAL: --base <url> is required (the production alias serving the seam deployment)");
  process.exit(1);
}
const base = baseArg.replace(/\/$/, "");
/** The seam-deployment marker this walk expects (the deploy record's family). */
const expectedMarker = argValue("--expected-marker") ?? "r306-encode-seam-deploy-1";
const mediaWorkerUrl = (argValue("--media-worker") ?? "https://3971-i5lvv9q3jrumm914o1rca.e2b.app").replace(
  /\/$/,
  "",
);
const computeWorkerUrl = (
  argValue("--compute-worker") ?? "https://3973-i5lvv9q3jrumm914o1rca.e2b.app"
).replace(/\/$/, "");
const outDir = resolve(import.meta.dirname, ".");

/** A full wall-clock measurement pair (dev-time measurement code). */
function timed<T>(fn: () => Promise<T>): Promise<{ value: T; wallMs: number }> {
  const startedAt = Date.now();
  return fn().then((value) => ({ value, wallMs: Math.max(0, Date.now() - startedAt) }));
}

const USER = `r306hgp-${Date.now().toString(36)}`;
const PASSWORD = "r306-hosted-golden-path-live-password";

const record: Record<string, unknown> = {
  schemaVersion: "1.0",
  kind: "r306-hosted-golden-path",
  clientHonesty:
    "the client is THIS DRIVER walking the hosted Vercel runtime's public API (register → login → upload-sessions with the J004 realities form) — the derived kinds' four-reality journey WITH the R306 encode seam injected, the flight the G12 walk named when its derived kinds refused with the TYPED producer-unavailable class (the hosted runtime shipped no ffmpeg); every derived kind's answer below is MEASURED — a real hosted encode played back integrity-verified, or an honest typed refusal recorded verbatim; NEVER fabricated",
  target: { base, expectedDeployMarker: expectedMarker, mediaWorkerUrl, computeWorkerUrl },
  steps: {} as Record<string, unknown>,
};

/** One worker-side media stats document (the /v1/media/stats route). */
interface MediaStats {
  jobsDispatched: number;
  duplicates: number;
  succeeded: number;
  failed: number;
  inFlight: number;
  capacityRefusals: number;
  usageRecords: number;
  probeRuns: number;
  transcodeRuns: number;
  inputBytes: number;
  outputBytes: number;
  totalExecutionMs: number;
}

/** One usage-ledger record (the /v1/media/usage route). */
interface UsageRecord {
  jobId: string;
  idempotencyKey?: string;
  sessionId: string;
  terminalDisposition: string;
  meteredAtMs?: number;
}

/** The geometry measured at the receiving boundary (local ffprobe). */
function probeGeometry(bytes: Uint8Array, path: string): Record<string, unknown> {
  try {
    const run = spawnSync(
      "ffprobe",
      ["-v", "error", "-print_format", "json", "-show_format", "-show_streams", path],
      { timeout: 20_000, maxBuffer: 16 * 1024 * 1024, encoding: "utf8" },
    );
    if (run.status !== 0 || typeof run.stdout !== "string") {
      return {
        measurable: false,
        reason: `ffprobe exited ${String(run.status)}: ${String(run.stderr).slice(0, 200)}`,
      };
    }
    const doc = JSON.parse(run.stdout) as {
      format?: { duration?: string; nb_streams?: string; format_name?: string };
      streams?: {
        codec_type?: string;
        codec_name?: string;
        width?: number;
        height?: number;
        nb_frames?: string;
        r_frame_rate?: string;
      }[];
    };
    const video = (doc.streams ?? []).find((s) => s.codec_type === "video");
    const audio = (doc.streams ?? []).find((s) => s.codec_type === "audio");
    return {
      measurable: true,
      probedBytes: bytes.byteLength,
      formatName: doc.format?.format_name ?? null,
      durationSec: doc.format?.duration ?? null,
      streamCount: doc.format?.nb_streams ?? null,
      video: video === undefined ? null : {
        codec: video.codec_name ?? null,
        width: video.width ?? null,
        height: video.height ?? null,
        frameRate: video.r_frame_rate ?? null,
      },
      hasAudio: audio !== undefined,
    };
  } catch (err) {
    return {
      measurable: false,
      reason: `ffprobe could not be executed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

const scratch = await mkdtemp(join(tmpdir(), "r306-hosted-gp-"));
try {
  // --- step 0: the production plane's boot state + BOTH live workers + the
  //     worker-side accounting BEFORE (the honest ledger's starting line).
  const healthRun = await timed(() => fetch(`${base}/api/platform/health`));
  const health = (await healthRun.value.json().catch(() => null)) as
    | { deployMarker?: string }
    | null;
  const mediaDescriptorRun = await timed(() => fetch(`${mediaWorkerUrl}/v1/media/adapter`));
  const mediaDescriptor = (await mediaDescriptorRun.value.json().catch(() => null)) as
    | { operations?: string[] }
    | null;
  const computeDescriptorRun = await timed(() => fetch(`${computeWorkerUrl}/v1/adapter`));
  const computeDescriptor = (await computeDescriptorRun.value.json().catch(() => null)) as
    | { supportedRenderers?: { rendererId: string }[]; adapterId?: string }
    | null;
  const statsBeforeRun = await timed(() => fetch(`${mediaWorkerUrl}/v1/media/stats`));
  const statsBefore = (await statsBeforeRun.value.json().catch(() => null)) as MediaStats | null;
  const usageBeforeRun = await timed(() => fetch(`${mediaWorkerUrl}/v1/media/usage`));
  const usageBefore = (await usageBeforeRun.value.json().catch(() => null)) as UsageRecord[] | null;
  (record.steps as Record<string, unknown>).boot = {
    httpStatusCode: healthRun.value.status,
    deployMarker: health?.deployMarker ?? null,
    wallMs: healthRun.wallMs,
    mediaWorker: {
      url: mediaWorkerUrl,
      descriptorHttpStatusCode: mediaDescriptorRun.value.status,
      operationsAdvertised: (mediaDescriptor?.operations ?? []).slice().sort(),
      statsBeforeHttpStatusCode: statsBeforeRun.value.status,
      statsBefore,
      usageBeforeJobIds: (usageBefore ?? []).map((u) => u.jobId),
      wallMs: mediaDescriptorRun.wallMs,
    },
    computeWorker: {
      url: computeWorkerUrl,
      descriptorHttpStatusCode: computeDescriptorRun.value.status,
      adapterId: computeDescriptor?.adapterId ?? null,
      renderersAdvertised: (computeDescriptor?.supportedRenderers ?? []).map((r) => r.rendererId),
      wallMs: computeDescriptorRun.wallMs,
    },
    note: "the boot descriptor fetch must SUCCEED (the live compute worker) and the media worker's descriptor must advertise the encode seam's FIVE operations — the pair the plane's availability probes",
  };
  if (healthRun.value.status !== 200 || health?.deployMarker !== expectedMarker) {
    throw new Error(
      `the production plane is not the seam deployment (HTTP ${healthRun.value.status}, marker ${health?.deployMarker ?? "none"})`,
    );
  }
  const advertised = (mediaDescriptor?.operations ?? []).slice().sort();
  if (advertised.join(",") !== "decode-frames,decode-probe,encode-frames,normalize,probe") {
    throw new Error(
      `the live media worker does not advertise the encode seam's five operations (got [${advertised.join(", ")}])`,
    );
  }

  // --- step 1: the fresh sign-up.
  const registerRun = await timed(() =>
    fetch(`${base}/api/auth/register`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: USER, password: PASSWORD, roles: ["creator", "viewer"] }),
    }),
  );
  const registerBody = (await registerRun.value.json().catch(() => null)) as unknown;
  (record.steps as Record<string, unknown>).register = {
    httpStatusCode: registerRun.value.status,
    body: registerBody,
    wallMs: registerRun.wallMs,
  };
  if (registerRun.value.status !== 200) {
    throw new Error(`register failed: HTTP ${registerRun.value.status} ${JSON.stringify(registerBody)}`);
  }

  // --- step 2: the login (the session cookie every leg carries).
  const loginRun = await timed(() =>
    fetch(`${base}/api/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: USER, password: PASSWORD }),
    }),
  );
  const setCookie = loginRun.value.headers.get("set-cookie") ?? "";
  const sessionToken = /sporta_session=([^;]+)/.exec(setCookie)?.[1] ?? "";
  const loginBody = (await loginRun.value.json().catch(() => null)) as unknown;
  (record.steps as Record<string, unknown>).login = {
    httpStatusCode: loginRun.value.status,
    sessionCookieIssued: sessionToken.length > 0,
    body: loginBody,
    wallMs: loginRun.wallMs,
  };
  if (loginRun.value.status !== 200 || sessionToken === "") {
    throw new Error(`login failed: HTTP ${loginRun.value.status} (cookie ${sessionToken.length} chars)`);
  }
  const cookie = { cookie: `sporta_session=${sessionToken}` } as const;

  // =====================================================================
  // LEG A — the r607 walk's upload admission, mirrored (the corpus-shaped
  // source; the R207 decode over the wire; the Original's byte route).
  // =====================================================================
  const clipPath = await generateTestMp4(join(scratch, "hosted-gp.mp4"), {
    durationSeconds: 2,
    withAudio: true,
    scene: "pitch",
  });
  const bytes = new Uint8Array(await readFile(clipPath));
  const sourceHash = sha256OfBytes(bytes);
  const form = new FormData();
  form.append(
    "file",
    new File([bytes.slice().buffer as ArrayBuffer], "hosted-gp.mp4", { type: "video/mp4" }),
  );
  form.append(
    "operations",
    JSON.stringify(["analysis", "transformation", "derivativeGeneration", "storage"]),
  );
  form.append("label", "R306 hosted golden path — the arc's closure");
  const uploadRun = await timed(() =>
    fetch(`${base}/api/create/upload-sessions`, {
      method: "POST",
      headers: cookie,
      body: form,
    }),
  );
  const uploadBody = (await uploadRun.value.json().catch(() => null)) as unknown;
  (record.steps as Record<string, unknown>).upload = {
    httpStatusCode: uploadRun.value.status,
    wallMs: uploadRun.wallMs,
    sourceBytes: bytes.byteLength,
    sourceSha256: sourceHash,
    body: uploadBody,
    note: "the r607 walk's upload admission, mirrored: the R207 decode dispatches over the wire to the live E2B worker (the decode seam, closed at r607) — the Original leg that carries leg B's derived kinds",
  };
  const upload = uploadBody as {
    sessionId?: string;
    source?: {
      asset?: { uploadState?: string; checksumVerified?: boolean; container?: string };
      job?: { jobId?: string; state?: string };
    };
    perception?: { frameCount?: number; summary?: string };
  } | null;
  const uploadOk = uploadRun.value.status === 201 && upload?.source?.asset?.uploadState === "stored";

  let watchStep: Record<string, unknown> | undefined;
  if (uploadOk && upload?.source?.job?.jobId !== undefined) {
    // --- the media job to terminal (the Original normalization leg).
    const jobId = upload.source.job.jobId;
    let terminal = null as unknown;
    for (let attempt = 0; attempt < 60 && terminal === null; attempt += 1) {
      await new Promise((r) => setTimeout(r, 3000));
      const statusRun = await timed(() =>
        fetch(`${base}/api/media/jobs/${encodeURIComponent(jobId)}`, { headers: cookie }),
      );
      if (statusRun.value.status !== 200) continue;
      const statusBody = (await statusRun.value.json().catch(() => null)) as { state?: string } | null;
      if (statusBody?.state === "succeeded" || statusBody?.state === "failed") {
        terminal = statusBody;
      }
    }
    (record.steps as Record<string, unknown>).mediaJob = {
      jobId,
      terminal: terminal ?? "poll-timeout (bounded 180s)",
    };

    // --- the watch leg: the catalog + the Original's byte-route playback
    //     integrity-verified (the r607 precedent: sha, ftyp, the 206 slice).
    const sessionId = upload.sessionId ?? "";
    if (sessionId !== "") {
      watchStep = {} as Record<string, unknown>;
      let catalogRun = { value: new Response(""), wallMs: 0 } as { value: Response; wallMs: number };
      let catalogBody: {
        artifacts?: {
          playback?: { state?: string };
          readyRealityCount?: number;
          realities?: {
            kind?: string;
            availability?: string;
            artifacts?: {
              artifactId?: string;
              integrityHash?: string;
              byteSize?: number;
              contentType?: string;
            }[];
          }[];
        };
      } | null = null;
      const catalogAttempts: number[] = [];
      for (let attempt = 0; attempt < 5; attempt += 1) {
        if (attempt > 0) await new Promise((r) => setTimeout(r, 3000));
        catalogRun = await timed(() =>
          fetch(`${base}/api/watch/${encodeURIComponent(sessionId)}/realities`, { headers: cookie }),
        );
        catalogAttempts.push(catalogRun.value.status);
        if (catalogRun.value.status === 200) {
          catalogBody = (await catalogRun.value.json().catch(() => null)) as typeof catalogBody;
          if ((catalogBody?.artifacts?.realities?.length ?? 0) > 0) break;
        }
      }
      const catalogDoc = catalogBody?.artifacts;
      const originalEntry = catalogDoc?.realities?.find((entry) => entry.kind === "original");
      const originalDescriptor = originalEntry?.artifacts?.find((a) => a.contentType?.includes("mp4"));
      watchStep.catalogHttpStatusCode = catalogRun.value.status;
      watchStep.catalogAttempts = catalogAttempts;
      watchStep.playbackState = catalogDoc?.playback?.state ?? null;
      watchStep.readyRealityCount = catalogDoc?.readyRealityCount ?? null;
      watchStep.originalAvailability = originalEntry?.availability ?? null;
      watchStep.wallMs = catalogRun.wallMs;
      if (originalDescriptor?.artifactId !== undefined && originalDescriptor.integrityHash !== undefined) {
        const contentUrl = `${base}/api/watch/${encodeURIComponent(sessionId)}/realities/original/artifacts/${encodeURIComponent(originalDescriptor.artifactId)}/content`;
        let fullRun = { value: new Response(""), wallMs: 0 } as { value: Response; wallMs: number };
        let served = new Uint8Array(0);
        const fullAttempts: number[] = [];
        for (let attempt = 0; attempt < 3; attempt += 1) {
          if (attempt > 0) await new Promise((r) => setTimeout(r, 3000));
          fullRun = await timed(() => fetch(contentUrl, { headers: cookie }));
          fullAttempts.push(fullRun.value.status);
          served = new Uint8Array(await fullRun.value.arrayBuffer());
          if (fullRun.value.status === 200) break;
        }
        watchStep.full = {
          httpStatusCode: fullRun.value.status,
          attempts: fullAttempts,
          contentType: fullRun.value.headers.get("content-type"),
          acceptRanges: fullRun.value.headers.get("accept-ranges"),
          servedBytes: served.byteLength,
          descriptorBytes: originalDescriptor.byteSize ?? null,
          servedSha256: sha256OfBytes(served),
          descriptorIntegrityHash: originalDescriptor.integrityHash ?? null,
          integrityVerified:
            sha256OfBytes(served) === originalDescriptor.integrityHash &&
            served.byteLength === (originalDescriptor.byteSize ?? -1),
          ftypMagic:
            served.byteLength >= 8 &&
            Buffer.from(served.subarray(4, 8)).toString("ascii") === "ftyp",
          wallMs: fullRun.wallMs,
        };
        const rangeRun = await timed(() =>
          fetch(contentUrl, { headers: { ...cookie, range: "bytes=0-1023" } }),
        );
        const slice = new Uint8Array(await rangeRun.value.arrayBuffer());
        watchStep.range = {
          httpStatusCode: rangeRun.value.status,
          contentRange: rangeRun.value.headers.get("content-range"),
          sliceBytes: slice.byteLength,
          sliceMatches: Array.from(slice).every((byte, i) => byte === (served[i] ?? -1)),
        };
      }
      (record.steps as Record<string, unknown>).watch = watchStep;
    }
  }

  // =====================================================================
  // LEG B — THE J004 ONE-SUBMISSION (the decisive leg: the derived kinds'
  // four-reality journey WITH the seam injected — where the G12 walk
  // measured the TYPED producer-unavailable refusals, THIS walk measures
  // what the seam answers).
  // =====================================================================
  const oneShotClip = await generateTestMp4(join(scratch, "one-submission.mp4"), {
    durationSeconds: 1,
    withAudio: false,
  });
  const oneShotBytes = new Uint8Array(await readFile(oneShotClip));
  const oneShotForm = new FormData();
  oneShotForm.append(
    "file",
    new File([oneShotBytes.slice().buffer as ArrayBuffer], "one-submission.mp4", { type: "video/mp4" }),
  );
  oneShotForm.append(
    "operations",
    JSON.stringify(["analysis", "transformation", "derivativeGeneration", "storage"]),
  );
  oneShotForm.append("realities", JSON.stringify(["tactical", "three-d-game", "anime-npr"]));
  oneShotForm.append(
    "compute",
    JSON.stringify({ mode: "user-explicit", providerId: "sporta.compute.hosted" }),
  );
  oneShotForm.append("styleId", "r306-hgp-hosted");
  const oneShotRun = await timed(() =>
    fetch(`${base}/api/create/upload-sessions`, {
      method: "POST",
      headers: cookie,
      body: oneShotForm,
    }),
  );
  const oneShotBody = (await oneShotRun.value.json().catch(() => null)) as {
    sessionId?: string;
    renderPlan?: {
      realities?: {
        reality?: string;
        rendererId?: string | null;
        disposition?: string;
        jobId?: string;
        jobState?: string;
        failure?: { errorClass?: string; message?: string };
      }[];
    };
  } | null;
  const j004: Record<string, unknown> = {
    httpStatusCode: oneShotRun.value.status,
    wallMs: oneShotRun.wallMs,
    sessionId: oneShotBody?.sessionId ?? null,
    sourceBytes: oneShotBytes.byteLength,
    sourceSha256: sha256OfBytes(oneShotBytes),
    plan: (oneShotBody?.renderPlan?.realities ?? []).map((entry) => ({
      reality: entry.reality ?? "?",
      rendererId: entry.rendererId ?? null,
      disposition: entry.disposition ?? null,
      jobId: entry.jobId ?? null,
      jobState: entry.jobState ?? null,
      ...(entry.failure !== undefined ? { failure: entry.failure } : {}),
    })),
    note: "THE DECISIVE LEG: the G12 walk's exact form (the realities + compute + styleId fields). At the pre-seam shas this answered rendererId=null + disposition=failed + errorClass=producer-unavailable for every derived kind (the hosted runtime shipped no ffmpeg — the plane refused to compose). At the arc tip the seam injects the http encode pair: every entry below is the MEASURED answer",
  };
  (record.steps as Record<string, unknown>).j004OneSubmission = j004;
  const oneShotSessionId = oneShotBody?.sessionId ?? "";

  if (oneShotSessionId !== "") {
    // --- the per-kind job records (the plan's dispatched jobs polled to
    //     terminal on the app's own job view + the compute worker's own
    //     record — the honest terminal states, never interpolated). The app
    //     view carries the INGEST state verbatim: the job's outputs land in
    //     the session's stores only when the ingest succeeded — a failed
    //     ingest is the typed refusal the catalog's availability then
    //     honestly reflects.
    interface JobPoll {
      reality: string;
      jobId: string;
      appView: Record<string, unknown> | null;
      appViewAttempts: number[];
      computeWorkerRecord: Record<string, unknown> | null;
      workerRecordHttpStatusCode: number | null;
      terminalState: string;
      wallMsTotal: number;
    }
    const dispatched = (oneShotBody?.renderPlan?.realities ?? []).filter(
      (entry) => entry.jobId !== undefined && entry.jobId !== null,
    );
    interface PolledJob {
      reality: string;
      jobId: string;
      appViewAttempts: number[];
      appView: Record<string, unknown> | null;
    }
    const polls: PolledJob[] = [];
    for (const entry of dispatched) {
      polls.push({
        reality: entry.reality ?? "?",
        jobId: entry.jobId as string,
        appViewAttempts: [],
        appView: null,
      });
    }
    const TERMINAL_STATES = new Set(["succeeded", "failed", "cancelled", "dead-lettered"]);
    const pollStart = Date.now();
    const pendingIds = new Set(polls.map((poll) => poll.jobId));
    // Round-robin until every dispatched job is terminal (bounded 180s).
    for (let round = 0; round < 60 && pendingIds.size > 0; round += 1) {
      await new Promise((r) => setTimeout(r, 3000));
      for (const poll of polls) {
        if (!pendingIds.has(poll.jobId)) continue;
        const response = await fetch(
          `${base}/api/create/sessions/${encodeURIComponent(oneShotSessionId)}/jobs/${encodeURIComponent(poll.jobId)}`,
          { headers: cookie },
        );
        poll.appViewAttempts.push(response.status);
        if (response.status !== 200) continue;
        const view = (await response.json().catch(() => null)) as
          | { state?: string }
          | Record<string, unknown>
          | null;
        if (view !== null) poll.appView = view as Record<string, unknown>;
        if (view !== null && typeof view.state === "string" && TERMINAL_STATES.has(view.state)) {
          pendingIds.delete(poll.jobId);
        }
      }
    }
    const jobWallMs = Date.now() - pollStart;
    // The compute worker's own job records (the worker-side view of the
    // same job ids — the honest cross-plane terminal states).
    const jobPolls: JobPoll[] = [];
    for (const poll of polls) {
      const workerRun = await timed(() =>
        fetch(`${computeWorkerUrl}/v1/jobs/${encodeURIComponent(poll.jobId)}`),
      );
      jobPolls.push({
        reality: poll.reality,
        jobId: poll.jobId,
        appView: poll.appView,
        appViewAttempts: poll.appViewAttempts,
        computeWorkerRecord:
          workerRun.value.status === 200
            ? ((await workerRun.value.json().catch(() => null)) as Record<string, unknown>)
            : null,
        workerRecordHttpStatusCode: workerRun.value.status,
        terminalState:
          (poll.appView?.state as string | undefined) ?? "poll-expired-nonterminal",
        wallMsTotal: jobWallMs,
      });
    }
    j004.jobRecords = jobPolls.map((poll) => {
      const view = poll.appView ?? {};
      const ingest = (view.ingest ?? null) as { status?: string; error?: string } | null;
      const completion = (view.completion ?? null) as
        | {
            status?: string;
            outputs?: { artifactId?: string; contentType?: string; byteLength?: number; frameCount?: number; totalDurationMs?: number }[];
          }
        | null;
      // The compute worker's own record — projected WITHOUT the inline
      // delivery payloads (the base64 artifacts ride the wire; the RECORD
      // carries the envelope's own honest claims only, never the bytes).
      const workerRecord = poll.computeWorkerRecord ?? null;
      const workerResult = (workerRecord?.["result"] ?? null) as
        | { status?: string; outputs?: Record<string, unknown>[] }
        | null;
      const workerOutputs = (workerResult?.outputs ?? []).map((output) => ({
        artifactId: (output["artifactId"] as string | undefined) ?? null,
        contentHash: (output["contentHash"] as string | undefined) ?? null,
        contentType: (output["contentType"] as string | undefined) ?? null,
        byteLength: (output["byteLength"] as number | undefined) ?? null,
        manifest: output["manifest"] ?? null,
        deliveryMode:
          ((output["delivery"] as { mode?: string } | undefined)?.mode as string | undefined) ??
          null,
      }));
      return {
        reality: poll.reality,
        jobId: poll.jobId,
        appTerminalState: poll.terminalState,
        appRenderId: (view.renderId as string | undefined) ?? null,
        ingest,
        completion:
          completion === null
            ? null
            : {
                status: completion.status ?? null,
                outputs: (completion.outputs ?? []).map((o) => ({
                  artifactId: o.artifactId ?? null,
                  contentType: o.contentType ?? null,
                  byteLength: o.byteLength ?? null,
                  frameCount: o.frameCount ?? null,
                  totalDurationMs: o.totalDurationMs ?? null,
                })),
              },
        computeWorkerState:
          ((poll.computeWorkerRecord?.["state"] as string | undefined) ?? null),
        computeWorkerRecord: workerRecord === null ? null : {
          jobId: (workerRecord["jobId"] as string | undefined) ?? null,
          state: (workerRecord["state"] as string | undefined) ?? null,
          startedAtMs: (workerRecord["startedAtMs"] as number | undefined) ?? null,
          finishedAtMs: (workerRecord["finishedAtMs"] as number | undefined) ?? null,
          resultStatus: workerResult?.status ?? null,
          outputs: workerOutputs,
        },
        appViewAttempts: poll.appViewAttempts,
        jobPollWallMs: poll.wallMsTotal,
      };
    });

    // --- the catalog walked (bounded; the honest availability states
    //     recorded at the bound when not all four are ready). The walk exits
    //     early at all-four-ready OR at a STABLE availability map (10
    //     consecutive identical polls ≈ 30s — the honest settled state; a
    //     refused kind never flips to ready, never waited for the full
    //     bound).
    let catalog: {
      artifacts?: {
        playback?: { state?: string };
        readyRealityCount?: number;
        realities?: {
          kind?: string;
          availability?: string;
          artifacts?: { artifactId?: string; integrityHash?: string; byteSize?: number; contentType?: string }[];
        }[];
      };
    } | null = null;
    let catalogAttempts = 0;
    let stablePolls = 0;
    let lastSignature = "";
    for (let attempt = 0; attempt < 100; attempt += 1) {
      catalogAttempts = attempt + 1;
      if (attempt > 0) await new Promise((r) => setTimeout(r, 3000));
      const response = await fetch(`${base}/api/watch/${encodeURIComponent(oneShotSessionId)}/realities`, {
        headers: cookie,
      });
      if (response.status !== 200) {
        stablePolls = 0;
        continue;
      }
      catalog = (await response.json().catch(() => null)) as typeof catalog;
      const signature = JSON.stringify(
        (catalog?.artifacts?.realities ?? []).map((entry) => [
          entry.kind,
          entry.availability,
          (entry.artifacts ?? []).map((a) => a.artifactId),
        ]),
      );
      if (signature === lastSignature) {
        stablePolls += 1;
      } else {
        stablePolls = 0;
        lastSignature = signature;
      }
      if ((catalog?.artifacts?.readyRealityCount ?? 0) >= 4) break;
      if (stablePolls >= 10) break;
    }
    const catalogDoc = catalog?.artifacts;
    j004.catalog = {
      attempts: catalogAttempts,
      playbackState: catalogDoc?.playback?.state ?? null,
      readyRealityCount: catalogDoc?.readyRealityCount ?? null,
      kinds: (catalogDoc?.realities ?? []).map((entry) => ({
        kind: entry.kind ?? "?",
        availability: entry.availability ?? null,
        artifactContentTypes: (entry.artifacts ?? []).map((a) => a.contentType ?? "?"),
      })),
    };

    // --- THE FOUR REALITIES played back: for every kind that PRODUCED, the
    //     byte-route integrity (sha, byte length, ftyp, the geometry
    //     re-measured with ffprobe at the receiving boundary); for every kind
    //     that refused, the typed class recorded VERBATIM — the catalog's own
    //     availability state +, when the kind's render job ran, the job's
    //     INGEST refusal (the exact typed boundary the refusal happened at).
    const fourKinds = ["original", "tactical", "three-d-game", "anime-npr"] as const;
    const jobByReality = new Map<
      string,
      { jobId: string; ingest?: { status?: string; error?: string }; appTerminalState?: string }
    >();
    for (const entry of (j004.jobRecords ?? []) as {
      reality: string;
      jobId: string;
      ingest?: { status?: string; error?: string };
      appTerminalState?: string;
    }[]) {
      jobByReality.set(entry.reality, entry);
    }
    const planEntries = (j004.plan ?? []) as { reality?: string; disposition?: string }[];
    const playedBack: Record<string, unknown> = {};
    for (const kind of fourKinds) {
      const entry = catalogDoc?.realities?.find((candidate) => candidate.kind === kind);
      const descriptor = entry?.artifacts?.find((a) => a.contentType?.includes("mp4"));
      if (entry === undefined || descriptor?.artifactId === undefined || descriptor.integrityHash === undefined) {
        const job = jobByReality.get(kind);
        playedBack[kind] = {
          availability: entry?.availability ?? "absent",
          produced: false,
          planDisposition: planEntries.find((p) => p.reality === kind)?.disposition ?? null,
          jobTerminalState: job?.appTerminalState ?? null,
          ingestStatus: job?.ingest?.status ?? null,
          typedRefusal:
            job?.ingest?.status === "failed" && job.ingest.error !== undefined
              ? job.ingest.error
              : (entry?.availability ?? "absent"),
          refusalBoundary:
            job?.ingest?.status === "failed"
              ? "render-output ingest (the artifact never landed in the session's stores — the catalog's availability is the honest derived state)"
              : "catalog availability (no dispatched job for this kind)",
        };
        continue;
      }
      const contentUrl = `${base}/api/watch/${encodeURIComponent(oneShotSessionId)}/realities/${kind}/artifacts/${encodeURIComponent(descriptor.artifactId)}/content`;
      // The content reads retry BOUNDED (3x, 3s apart) — the
      // eventual-consistency race the G12 walk measured (one transient 500
      // per run, recorded per attempt).
      let fullRun = { value: new Response(""), wallMs: 0 } as { value: Response; wallMs: number };
      let served = new Uint8Array(0);
      const contentAttempts: number[] = [];
      for (let attempt = 0; attempt < 3; attempt += 1) {
        if (attempt > 0) await new Promise((r) => setTimeout(r, 3000));
        fullRun = await timed(() => fetch(contentUrl, { headers: cookie }));
        contentAttempts.push(fullRun.value.status);
        served = new Uint8Array(await fullRun.value.arrayBuffer());
        if (fullRun.value.status === 200) break;
      }
      const errorBody =
        fullRun.value.status !== 200
          ? Buffer.from(served.subarray(0, 400)).toString("utf8")
          : undefined;
      const localPath = join(scratch, `served-${kind}.mp4`);
      await writeFile(localPath, served);
      playedBack[kind] = {
        availability: entry.availability ?? null,
        produced: true,
        httpStatusCode: fullRun.value.status,
        contentAttempts,
        contentType: fullRun.value.headers.get("content-type"),
        servedBytes: served.byteLength,
        descriptorBytes: descriptor.byteSize ?? null,
        servedSha256: sha256OfBytes(served),
        descriptorIntegrityHash: descriptor.integrityHash ?? null,
        integrityVerified:
          sha256OfBytes(served) === descriptor.integrityHash &&
          served.byteLength === (descriptor.byteSize ?? -1),
        ftypMagic:
          served.byteLength >= 8 &&
          Buffer.from(served.subarray(4, 8)).toString("ascii") === "ftyp",
        geometry: probeGeometry(served, localPath),
        ...(errorBody !== undefined ? { errorBody } : {}),
      };
    }
    j004.playback = playedBack;
    const producedKinds = fourKinds.filter(
      (kind) =>
        (playedBack[kind] as { produced?: boolean; integrityVerified?: boolean } | undefined)
          ?.integrityVerified === true,
    );
    j004.producedKinds = producedKinds;
    j004.refusedKinds = fourKinds.filter((kind) => !producedKinds.includes(kind));
    j004.allFourRealitiesIntegrityVerified = producedKinds.length === 4;
  }

  // =====================================================================
  // The accounting AFTER: the media toolchain's worker-side stats/usage
  // re-read; every NEW job record fetched for its operation (the
  // encode-frames dispatches counted at the worker — the stats route).
  // THE EPHEMERALITY DOCTRINE (the r607/r306 arc's own measured class): the
  // sandbox can DIE mid-walk — the E2B proxy then answers 502 "The sandbox
  // was not found" on both worker routes. The accounting records the death
  // TYPED (the body verbatim, measurable: false) instead of crashing: the
  // walk's own legs already measured; the ledger's AFTER read is honestly
  // marked, never fabricated.
  // =====================================================================
  const statsAfterRun = await timed(() => fetch(`${mediaWorkerUrl}/v1/media/stats`));
  const statsAfterParsed = (await statsAfterRun.value.json().catch(() => null)) as unknown;
  const statsAfter =
    statsAfterRun.value.status === 200 &&
    statsAfterParsed !== null &&
    typeof statsAfterParsed === "object" &&
    Array.isArray((statsAfterParsed as MediaStats).usageRecords) === false &&
    typeof (statsAfterParsed as MediaStats).jobsDispatched === "number"
      ? (statsAfterParsed as MediaStats)
      : null;
  const usageAfterRun = await timed(() => fetch(`${mediaWorkerUrl}/v1/media/usage`));
  const usageAfterParsed = (await usageAfterRun.value.json().catch(() => null)) as unknown;
  const usageAfter =
    usageAfterRun.value.status === 200 && Array.isArray(usageAfterParsed)
      ? (usageAfterParsed as UsageRecord[])
      : null;
  const workerDiedMidWalk =
    statsAfter === null || usageAfter === null ? true : false;
  const deathBody =
    workerDiedMidWalk && statsAfterParsed !== null && typeof statsAfterParsed === "object"
      ? JSON.stringify(statsAfterParsed)
      : workerDiedMidWalk
        ? `(stats HTTP ${statsAfterRun.value.status}, usage HTTP ${usageAfterRun.value.status})`
        : null;
  const beforeIds = new Set((usageBefore ?? []).map((u) => u.jobId));
  const newRecords = (usageAfter ?? []).filter((u) => !beforeIds.has(u.jobId));
  // Each new dispatch's worker-side job record (the operation counted at
  // the worker — never inferred from the client's own view).
  const newJobRecords: {
    jobId: string;
    sessionId: string;
    operation: string | null;
    terminalDisposition: string;
  }[] = [];
  for (const usage of newRecords) {
    const jobRun = await fetch(`${mediaWorkerUrl}/v1/media/jobs/${encodeURIComponent(usage.jobId)}`);
    const jobDoc =
      jobRun.status === 200
        ? ((await jobRun.json().catch(() => null)) as { operation?: string; state?: string } | null)
        : null;
    newJobRecords.push({
      jobId: usage.jobId,
      sessionId: usage.sessionId,
      operation: jobDoc?.operation ?? null,
      terminalDisposition: usage.terminalDisposition,
    });
  }
  const encodeFramesDispatches = newJobRecords.filter((r) => r.operation === "encode-frames");
  const before = statsBefore ?? {
    jobsDispatched: -1,
    duplicates: -1,
    succeeded: -1,
    failed: -1,
    inFlight: -1,
    capacityRefusals: -1,
    usageRecords: -1,
    probeRuns: -1,
    transcodeRuns: -1,
    inputBytes: -1,
    outputBytes: -1,
    totalExecutionMs: -1,
  };
  const after = statsAfter ?? before;
  const accounting: Record<string, unknown> = {
    statsRouteHttpStatusCode: statsAfterRun.value.status,
    before,
    after,
    ...(workerDiedMidWalk
      ? {
          workerDiedMidWalk: true,
          deathClass: "the E2B proxy's 502 'The sandbox was not found' (the ephemerality doctrine's measured class — the sandbox's keep-alive window closed during the walk)",
          deathBody,
          measurable: false,
          note: "the AFTER reads answered the proxy's dead-sandbox class; the BEFORE reads and every walk leg above are the honest measurement — the delta accounting is honestly marked unmeasurable, never fabricated",
        }
      : { measurable: true }),
    delta: workerDiedMidWalk
      ? null
      : {
          dispatched: after.jobsDispatched - before.jobsDispatched,
          succeeded: after.succeeded - before.succeeded,
          failed: after.failed - before.failed,
          usageRecords: after.usageRecords - before.usageRecords,
        },
    newUsageRecords: newJobRecords,
    newDispatches: newJobRecords.length,
    encodeFramesDispatches: encodeFramesDispatches.length,
    encodeFramesJobIds: encodeFramesDispatches.map((r) => r.jobId),
    ledgerIdentities: workerDiedMidWalk
      ? null
      : {
          dispatchedEqualsSucceededPlusFailedPlusInFlight:
            after.jobsDispatched === after.succeeded + after.failed + after.inFlight,
          usageRecordsEqualsTerminal: after.usageRecords === after.succeeded + after.failed,
        },
    usageDrainCount: usageAfter === null ? null : usageAfter.length,
    note2:
      "the encode-frames dispatches counted AT THE WORKER (the stats + usage routes): every NEW job record since the walk's BEFORE read was fetched back for its own operation — the count is the worker's own ledger, never the client's inference",
  };
  (record.steps as Record<string, unknown>).workerAccounting = accounting;

  // --- the verdict: exactly what measured, never forced.
  const watchOk =
    (watchStep?.full as { integrityVerified?: boolean } | undefined)?.integrityVerified === true;
  const j004Step = (record.steps as Record<string, Record<string, unknown>>).j004OneSubmission;
  const producedKinds = (j004Step?.producedKinds ?? []) as string[];
  const refusedKinds = (j004Step?.refusedKinds ?? []) as string[];
  const planEntries = (j004Step?.plan ?? []) as {
    disposition?: string;
    failure?: { errorClass?: string };
  }[];
  const producerUnavailableAtPlan = planEntries.filter(
    (entry) => entry.failure?.errorClass === "producer-unavailable",
  ).length;
  const admittedAtPlan = planEntries.filter((entry) => entry.disposition === "admitted").length;
  const jobRecords = (j004Step?.jobRecords ?? []) as {
    appTerminalState?: string;
    computeWorkerState?: string;
    ingest?: { status?: string; error?: string };
  }[];
  const jobsSucceededBothPlanes = jobRecords.filter(
    (job) => job.appTerminalState === "succeeded" && job.computeWorkerState === "succeeded",
  ).length;
  const ingestRefused = jobRecords.filter((job) => job.ingest?.status === "failed");
  // The measured typed class, derived from the verbatim ingest error (never
  // presumed: the string itself is the record's own evidence).
  const ingestClassOf = (error: string | undefined): string =>
    /encoding refused \(([^)]+)\)/.exec(error ?? "")?.[1] ?? "(unparsed — the verbatim error is in the record)";
  let verdict: string;
  if (uploadOk && oneShotRun.value.status === 201) {
    verdict =
      "PASS — the hosted upload admissions through the seams (the R207 decode over the wire; the R306 encode pair injected at the composition)";
    verdict += watchOk
      ? "; leg A: the Original's byte-route playback INTEGRITY-VERIFIED over the LIVE plane (sha-matched, ftyp, the 206 Range slice)"
      : "; leg A: the watch leg measured its honest state (recorded, never fabricated)";
    // THE G12 COMPARISON, stated exactly: the dispatch-plane answer flipped
    // or it did not — either way the measured class is the verdict.
    if (producerUnavailableAtPlan === 0 && admittedAtPlan === 3) {
      verdict +=
        "; leg B: THE PLAN'S producer-unavailable CLASS IS CLOSED — all three derived kinds ADMITTED with real producers (the plane composed on the hosted runtime through the seam)";
    } else if (producerUnavailableAtPlan > 0) {
      verdict += `; leg B: the plan still answered ${producerUnavailableAtPlan} producer-unavailable refusal(s) at dispatch (typed, verbatim)`;
    }
    if (jobsSucceededBothPlanes === 3) {
      verdict +=
        "; the three render jobs TERMINAL SUCCEEDED on BOTH planes (the app's view + the compute worker's own record — REAL renders executed at the baked compute worker)";
    }
    if (producedKinds.length === 4) {
      verdict +=
        "; ALL FOUR realities played back integrity-verified — the derived kinds' REAL hosted encodes (THE G12 WALK'S GAP CLOSED, the arc's closure MEASURED)";
    } else if (producedKinds.length > 0) {
      verdict += `; ${producedKinds.length}/4 realities produced + integrity-verified (${producedKinds.join(", ")})`;
      if (ingestRefused.length > 0) {
        verdict += `; the ${ingestRefused.length} derived kinds' artifacts REFUSED at the render-output INGEST typed \`${ingestClassOf(ingestRefused[0]?.ingest?.error)}\` (verbatim: "${(ingestRefused[0]?.ingest?.error ?? "").slice(0, 90)}…" — the jobs executed + delivered REAL MP4s at the baked compute worker, the ingest's store read-back refused; the catalog's honest \`requires-render\` states recorded, never fabricated)`;
      } else {
        verdict += `; ${refusedKinds.length} refused (the typed states recorded verbatim — the honest split, never forced)`;
      }
    } else if (ingestRefused.length > 0) {
      verdict += `; the derived kinds' artifacts REFUSED at the render-output INGEST, typed verbatim (${ingestRefused.length}× "${(ingestRefused[0]?.ingest?.error ?? "").slice(0, 120)}…") — the jobs executed + delivered, the ingest's store read-back refused; the catalog's honest availability states recorded, never fabricated`;
    } else {
      verdict += "; the derived kinds refused (the typed classes recorded verbatim — the honest measurement, never fabricated)";
    }
    verdict +=
      accounting.measurable === true
        ? `; the worker-side accounting: ${String(accounting.encodeFramesDispatches)} encode-frames dispatch(es) counted at the worker (the stats + usage routes)`
        : "; the worker-side accounting: THE WORKER DIED MID-WALK (the E2B proxy's 502 'The sandbox was not found' — the ephemerality doctrine's measured class, recorded typed; the delta accounting honestly unmeasurable)";
  } else {
    verdict = `the honest typed outcome (upload HTTP ${uploadRun.value.status} / one-submission HTTP ${oneShotRun.value.status}) — recorded verbatim, never fabricated around`;
  }
  (record as { verdict?: string }).verdict = verdict;

  const outPath = resolve(outDir, "hosted-golden-path.json");
  await writeFile(outPath, JSON.stringify(record, null, 2) + "\n");
  console.log("=== R306 hosted golden path (the derived kinds' four-reality journey, the seam injected) ===");
  console.log(`boot:        HTTP ${healthRun.value.status} (marker ${health?.deployMarker})`);
  console.log(
    `workers:     media ${mediaDescriptorRun.value.status} (${advertised.join(",")}) / compute ${computeDescriptorRun.value.status} (${(computeDescriptor?.supportedRenderers ?? []).length} renderers)`,
  );
  console.log(`register:    HTTP ${registerRun.value.status} (${USER})`);
  console.log(`login:       HTTP ${loginRun.value.status} (session cookie issued)`);
  console.log(
    `upload A:    HTTP ${uploadRun.value.status} in ${uploadRun.wallMs}ms — ${upload?.source?.asset?.uploadState ?? "refused"}${upload?.source?.asset?.checksumVerified === true ? " (checksum verified)" : ""}`,
  );
  const mediaJobStep = (record.steps as Record<string, Record<string, unknown>>).mediaJob;
  if (mediaJobStep !== undefined) {
    console.log(
      `mediaJob:    ${String(mediaJobStep.jobId)} — ${JSON.stringify((mediaJobStep.terminal as { state?: string } | null)?.state ?? mediaJobStep.terminal ?? "n/a")}`,
    );
  }
  if (watchStep !== undefined) {
    const full = (watchStep.full as { integrityVerified?: boolean; servedBytes?: number } | undefined) ?? undefined;
    console.log(
      `watch A:     catalog HTTP ${String(watchStep.catalogHttpStatusCode)} (ready ${String(watchStep.readyRealityCount ?? "?")}) — original playback ${full?.integrityVerified === true ? `INTEGRITY-VERIFIED (${String(full.servedBytes)} B)` : "honest state recorded"}`,
    );
  }
  console.log(`upload B:    HTTP ${oneShotRun.value.status} in ${oneShotRun.wallMs}ms`);
  const planSummary = ((j004 as { plan?: { reality?: string; disposition?: string; rendererId?: string | null; failure?: { errorClass?: string } }[] }).plan ?? [])
    .map((e) => `${e.reality}:${e.disposition ?? "?"}${e.rendererId != null ? `(${e.rendererId})` : e.failure?.errorClass != null ? `(${e.failure.errorClass})` : ""}`)
    .join(" ");
  console.log(`plan:        ${planSummary || "(no plan)"}`);
  const jobsStep = (j004 as { jobRecords?: { reality: string; appTerminalState: string; computeWorkerState: string | null; ingest?: { status?: string; error?: string } }[] }).jobRecords ?? [];
  for (const job of jobsStep) {
    console.log(
      `  job:       ${job.reality} — app ${job.appTerminalState} / worker ${job.computeWorkerState ?? "n/a"}${job.ingest?.status === "failed" ? ` / INGEST REFUSED: ${String(job.ingest.error).slice(0, 110)}` : ""}`,
    );
  }
  const catalogStep = (j004 as { catalog?: { readyRealityCount?: number; attempts?: number } }).catalog;
  if (catalogStep !== undefined) {
    console.log(`catalog B:   ready ${String(catalogStep.readyRealityCount ?? "?")}/4 (${String(catalogStep.attempts ?? "?")} polls)`);
  }
  const pb = (j004 as Record<string, unknown>).playback as
    | Record<
        string,
        {
          produced?: boolean;
          integrityVerified?: boolean;
          availability?: string;
          servedBytes?: number;
          geometry?: { measurable?: boolean; video?: { codec?: string; width?: number; height?: number } | null };
          typedRefusal?: string;
        }
      >
    | undefined;
  if (pb !== undefined) {
    const summary = Object.entries(pb)
      .map(([kind, entry]) => {
        if (entry?.integrityVerified === true) {
          const geo = entry.geometry?.measurable === true ? ` ${entry.geometry?.video?.width}x${entry.geometry?.video?.height}` : "";
          return `${kind}:✓${String(entry.servedBytes)}B${geo}`;
        }
        const refusal = entry?.typedRefusal !== undefined ? `(${String(entry.typedRefusal).slice(0, 60)})` : "";
        return `${kind}:${String(entry?.availability ?? "?")}${refusal}`;
      })
      .join(" ");
    console.log(`realities:   ${summary || "honest state recorded"}`);
  }
  const accountingDelta = (accounting["delta"] ?? null) as { dispatched?: number; succeeded?: number; failed?: number } | null;
  console.log(
    accountingDelta === null
      ? `accounting:  THE WORKER DIED MID-WALK (stats HTTP ${String(accounting["statsRouteHttpStatusCode"])} — the 502 class recorded typed)`
      : `accounting:  Δ dispatched ${String(accountingDelta.dispatched)} / succeeded ${String(accountingDelta.succeeded)} / failed ${String(accountingDelta.failed)} — encode-frames at the worker: ${String(accounting.encodeFramesDispatches)}`,
  );
  console.log(`verdict:     ${verdict}`);
  console.log(`record:      ${outPath}`);
} finally {
  await rm(scratch, { recursive: true, force: true });
}
