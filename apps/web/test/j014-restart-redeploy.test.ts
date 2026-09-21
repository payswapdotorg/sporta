/**
 * THE J014 RESTART/REDEPLOY ACCEPTANCE BATTERY — REAL PROCESSES.
 *
 * J007 proved the durable control plane at the COMPOSITION level (three
 * compositions over the same files, one process). J014 closes the remaining
 * gap the deployment-shape analysis documented: the IDENTITY plane (accounts
 * + login sessions) was in-memory, and no battery had ever proven the
 * restart property against REAL process death. This battery spawns THREE
 * REAL CHILD PROCESSES over the same scratch directory:
 *
 * - process A boots the composition from scratch (the real sqlite identity
 *   plane constructed by the composition root), runs the REAL journey
 *   (register → login → real MP4 upload → real async render → terminal
 *   state), and DIES;
 * - process B (the RESTART — no shared memory with A, a genuinely cold
 *   boot over the same files) must resolve A's STILL-OLD login token,
 *   list the session in the Library, serve the SAME content-addressed
 *   Watch output + bytes, report the sqlite identity plane on the health
 *   surface, honor a FRESH sign-in with the same credentials, show the
 *   honest per-instance job-ledger boundary, and flip the publication;
 * - process C (the REDEPLOY) must serve the now-public session to the
 *   ANONYMOUS catalog/watch path and STILL resolve the owner's old token
 *   (identity durable across TWO boots).
 *
 * The battery runs SERVER + TESTS IN ONE INVOCATION (each child is spawned
 * and awaited by this test file — the sandbox reaper never sees a detached
 * background server). Everything is asserted from the children's recorded
 * reports plus direct reads of the REAL sqlite files (bytes on disk, not
 * in-process claims).
 */
import { beforeAll, afterAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Database } from "bun:sqlite";

const JOURNEY = join(import.meta.dir, "helpers", "j014-journey.ts");
const WEB_ROOT = join(import.meta.dir, "..");

let scratch = "";

interface PhaseAReport {
  phase: "a";
  username: string;
  password: string;
  token: string;
  userId: string;
  sessionId: string;
  renderId: string;
  segmentId: string;
  contentHash: string;
  jobState: string;
}

interface PhaseBReport {
  phase: "b";
  meStatus: number;
  meUserId: string;
  meUsername: string;
  libraryHasSession: boolean;
  watchRenderFound: boolean;
  contentHashMatches: boolean;
  outputStatus: number;
  outputContainsSegment: boolean;
  identityProvider: string;
  identityConfigured: boolean;
  identityCheckState: string;
  identityCheckDetail: string | null;
  freshLoginStatus: number;
  freshLoginUserId: string;
  freshTokenIsNew: boolean;
  jobsCount: number;
  publicationStatus: number;
}

interface PhaseCReport {
  phase: "c";
  catalogHasSession: boolean;
  anonymousWatchStatus: number;
  anonymousContentHashMatches: boolean;
  ownerMeStatus: number;
  ownerMeUserId: string;
  ownerLibraryHasSession: boolean;
}

/** Spawns ONE real child process and returns its recorded report. */
async function runPhase<T>(phase: "a" | "b" | "c"): Promise<T> {
  const reportPath = join(scratch, `report-${phase}.json`);
  const proc = Bun.spawn({
    cmd: ["bun", JOURNEY, phase, scratch, reportPath],
    cwd: WEB_ROOT,
    stdout: "pipe",
    stderr: "pipe",
  });
  const code = await proc.exited;
  if (code !== 0) {
    const stderr = await new Response(proc.stderr).text();
    console.error(`--- j014 phase ${phase} child stderr ---\n${stderr}\n---`);
  }
  expect(code, `the phase-${phase} child process exited 0`).toBe(0);
  return JSON.parse(await readFile(reportPath, "utf8")) as T;
}

/** SHA-256 hex of the token (the identity package's stored form). */
async function sha256Hex(text: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

beforeAll(async () => {
  scratch = await mkdtemp(join(tmpdir(), "sporta-j014-restart-"));
});

afterAll(async () => {
  await rm(scratch, { recursive: true, force: true });
});

describe("J014 — user/session/artifacts survive a REAL process restart (three boots, one scratch)", () => {
  let a: PhaseAReport;

  test("process A (fresh deployment): the REAL journey — register, login, upload, render, terminal", async () => {
    a = await runPhase<PhaseAReport>("a");
    expect(a.username).toBe("j014-restart-user");
    expect(a.token.length).toBeGreaterThan(0);
    expect(a.userId.length).toBeGreaterThan(0);
    expect(a.sessionId.length).toBeGreaterThan(0);
    expect(a.renderId.length).toBeGreaterThan(0);
    expect(a.segmentId.length).toBeGreaterThan(0);
    expect(a.contentHash.length).toBeGreaterThan(0);
  }, 240_000);

  test("process B (the RESTART): the OLD token resolves; Library/Watch/bytes recover; health is honest", async () => {
    const b = await runPhase<PhaseBReport>("b");
    // THE IDENTITY PLANE — the acceptance's core increment: the login
    // session issued by process A survives A's death.
    expect(b.meStatus).toBe(200);
    expect(b.meUserId).toBe(a.userId);
    expect(b.meUsername).toBe(a.username);
    // Watch + Library recover through the real routes.
    expect(b.libraryHasSession).toBe(true);
    expect(b.watchRenderFound).toBe(true);
    expect(b.contentHashMatches).toBe(true);
    expect(b.outputStatus).toBe(200);
    expect(b.outputContainsSegment).toBe(true);
    // The health surface reports the LOCAL durable identity honestly.
    expect(b.identityProvider).toBe("sqlite");
    expect(b.identityConfigured).toBe(true);
    expect(b.identityCheckState).toBe("ok");
    expect(b.identityCheckDetail).toBe("sqlite");
    // A fresh sign-in with the SAME credentials works (the account row +
    // password hash survived) and issues a NEW token.
    expect(b.freshLoginStatus).toBe(200);
    expect(b.freshLoginUserId).toBe(a.userId);
    expect(b.freshTokenIsNew).toBe(true);
    // The honest per-instance boundary (W921/DEPLOYMENT.md §8): the cold
    // instance's job ledger never saw the dispatch — empty, never invented.
    expect(b.jobsCount).toBe(0);
    expect(b.publicationStatus).toBe(200);
  }, 240_000);

  test("process C (the REDEPLOY): the anonymous public path + the owner's old token across TWO boots", async () => {
    const c = await runPhase<PhaseCReport>("c");
    expect(c.catalogHasSession).toBe(true);
    expect(c.anonymousWatchStatus).toBe(200);
    expect(c.anonymousContentHashMatches).toBe(true);
    expect(c.ownerMeStatus).toBe(200);
    expect(c.ownerMeUserId).toBe(a.userId);
    expect(c.ownerLibraryHasSession).toBe(true);
  }, 240_000);

  test("the durable identity is REAL BYTES on disk (the sqlite rows hold the account + the old token's hash)", async () => {
    const identity = new Database(join(scratch, "identity.db"));
    const accountRow = identity
      .query("SELECT user_id FROM sporta_identity_accounts WHERE username = ?")
      .get(a.username) as { user_id: string };
    expect(accountRow.user_id).toBe(a.userId);

    // A's ORIGINAL token hash (the pre-restart session) + the fresh phase-B
    // sign-in — both rows for this user, only hashes on disk.
    const tokenHash = await sha256Hex(a.token);
    const oldSessionRow = identity
      .query("SELECT user_id FROM sporta_identity_sessions WHERE token_hash = ?")
      .get(tokenHash) as { user_id: string } | null;
    expect(oldSessionRow).not.toBeNull();
    expect(oldSessionRow!.user_id).toBe(a.userId);
    const sessionCount = identity
      .query("SELECT COUNT(*) AS n FROM sporta_identity_sessions WHERE user_id = ?")
      .get(a.userId) as { n: number };
    expect(sessionCount.n).toBeGreaterThanOrEqual(2);
    identity.close();

    // And the control-plane session row (J007's plane, re-proven through a
    // REAL restart this time).
    const control = new Database(join(scratch, "control-plane.db"));
    const sessionRows = control
      .query("SELECT COUNT(*) AS n FROM sporta_control_sessions WHERE session_id = ?")
      .get(a.sessionId) as { n: number };
    expect(sessionRows.n).toBe(1);
    control.close();
  });
});
