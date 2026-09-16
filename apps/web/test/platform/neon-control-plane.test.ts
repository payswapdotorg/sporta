/**
 * W921 INTEGRATION TESTS — the REAL Neon PostgreSQL durable control plane.
 *
 * ENV-GATED, LOUD (the W911 pattern): these tests run ONLY when `DATABASE_URL`
 * is set to a Neon endpoint (`*.neon.tech` — the hosted/beta database; see
 * docs/deployment/DEPLOYMENT.md §Neon). Without the env, the suite SKIPS with
 * a banner so the root `bun test` battery stays green in every environment
 * that has no database (the honest local posture).
 *
 * What is proven (W921 acceptance — the pg adapter + migration 0002 +
 * reconstruction against real PostgreSQL):
 * 1. migration 0002 applies cleanly through the deployed runner
 *    (`applyPlatformMigrations` — the same code `platform:migrate` runs);
 * 2. the record store's WRITE-THROUGH persists and a BRAND-NEW client + store
 *    (a simulated second serverless instance / redeploy) reads the SAME
 *    session record (verbatim rights declaration + publication decision) and
 *    the SAME render records (verbatim result documents + stored segment ids);
 * 3. the writes are IDEMPOTENT (a re-observed render is not a duplicate row)
 *    and `setVisibility` persists across store recreation while an unknown
 *    session's flip is REFUSED (fail-loud, never a silent no-op);
 * 4. THE FULL RECONSTRUCTION against the real database: two REAL `apps/web`
 *    compositions (no mocks — the real control plane, real identity gate,
 *    real in-process compute plane, real W504 pipeline) over TWO INDEPENDENT
 *    pg record-store instances on the SAME Neon database: a session created +
 *    rendered on composition A is watchable with the SAME render id and
 *    byte-identical outputs from composition B, which never saw the create —
 *    the W920 defect class, dead against real Postgres.
 *
 * CLEANUP: every row this suite writes is deleted in `afterAll` (the run's
 * session ids are tracked; the database is shared production state).
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createDeterministicTestHasher } from "@sporta/identity";
import {
  InMemoryAccountStore,
  InMemoryMediaOwnershipStore,
  InMemorySessionStore,
  SessionService,
  createSequentialEntropySource,
} from "@sporta/identity";
import { createSportaServer, installSportaServerForTests } from "../../src/server/composition";
import type { SportaServer } from "../../src/server/composition";
import { applyPlatformMigrations } from "../../src/server/platform/db/migrate";
import { createPostgresClient } from "../../src/server/platform/db/pg";
import type { PostgresSql } from "../../src/server/platform/db/pg";
import { PgControlPlaneRecordStore } from "../../src/server/platform/control/pg-records";
import { InMemoryRedis } from "../../src/server/platform/upstash/redis";
import { SPORTA_SESSION_COOKIE } from "../../src/server/auth-service";
import { POST as createSessionRoute } from "../../src/app/api/create/sessions/route";
import { POST as dispatchRoute } from "../../src/app/api/create/sessions/[sessionId]/renders/route";
import { GET as jobRoute } from "../../src/app/api/create/sessions/[sessionId]/jobs/[jobId]/route";
import { GET as watchRoute } from "../../src/app/api/watch/[sessionId]/route";
import { GET as outputRoute } from "../../src/app/api/watch/[sessionId]/renders/[renderId]/outputs/[segmentId]/route";

/**
 * The gate: run ONLY against the REAL hosted database — a `DATABASE_URL`
 * whose host is a Neon endpoint (`*.neon.tech`). A missing (or non-Neon)
 * URL SKIPS the suite loudly (the root battery stays green).
 */
function neonDatabaseUrl(): string | null {
  const url = process.env["DATABASE_URL"];
  if (typeof url !== "string" || url.length === 0) return null;
  try {
    const host = new URL(url).hostname;
    return host.endsWith(".neon.tech") ? url : null;
  } catch {
    return null;
  }
}

const DATABASE_URL = neonDatabaseUrl();
const HAS_DATABASE = DATABASE_URL !== null;

if (!HAS_DATABASE) {
  console.warn(
    [
      "",
      "==================================================================",
      " SKIP neon-control-plane.test.ts — no Neon DATABASE_URL.",
      " These are the W921 REAL-Neon control-plane integration tests.",
      " To run them:",
      "   . ~/.secrets/env.sh  # or export DATABASE_URL=postgres://…*.neon.tech/…",
      "   bun test apps/web/test/platform/neon-control-plane.test.ts",
      " (The connection string never appears in output, files, or commits.)",
      "==================================================================",
      "",
    ].join("\n"),
  );
}

/** Per-test timeout: the REAL Neon endpoint over the WAN (TLS + RTT). */
const WAN_TIMEOUT_MS = 60_000;

/** Fixed, DIFFERENT clocks per composition (warm instances are hours apart). */
const NOW_MS_A = 1_789_222_222_000;
const NOW_MS_B = NOW_MS_A + 2 * 60 * 60 * 1000;

const FULL_OPERATIONS = [
  "analysis",
  "transformation",
  "liveDelivery",
  "derivativeGeneration",
  "storage",
  "sharing",
];

const clients: PostgresSql[] = [];
/** Every untagged session id this run writes (cleanup deletes exactly these). */
const createdSessionIds: string[] = [];

function withCookie(token: string | null, path: string, init: RequestInit = {}): Request {
  return new Request(`http://sporta.test${path}`, {
    ...init,
    headers: {
      ...((init.headers as Record<string, string> | undefined) ?? {}),
      ...(token !== null ? { cookie: `${SPORTA_SESSION_COOKIE}=${token}` } : {}),
    },
  });
}

function post(path: string, body: unknown): RequestInit {
  return {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  };
}

async function bodyOf(response: Response): Promise<Record<string, unknown>> {
  return (await response.json()) as Record<string, unknown>;
}

(HAS_DATABASE ? describe : describe.skip)("W921 Neon durable control plane (real database)", () => {
  const RUN_TAG = crypto.randomUUID().slice(0, 8);
  /** The adapter round-trip's tagged ids (cleaned by prefix in afterAll). */
  const adapterSessionId = `sess-u-neonit${RUN_TAG}aaaa`;

  /** A fresh client (tracked for cleanup). */
  function freshClient(): PostgresSql {
    const sql = createPostgresClient(DATABASE_URL!);
    clients.push(sql);
    return sql;
  }

  beforeAll(async () => {
    // The deployed migration procedure (platform:migrate) — proving 0002
    // applies cleanly to the real database (and is idempotent when the
    // deployment already applied it).
    await applyPlatformMigrations(freshClient());
  }, WAN_TIMEOUT_MS);

  test(
    "upsertSession → a fresh client + store reads the SAME record (verbatim)",
    async () => {
      const writer = new PgControlPlaneRecordStore(freshClient(), () => 1_000);
      await writer.upsertSession({
        sessionId: adapterSessionId,
        ownerUserId: `user-neonit-${RUN_TAG}`,
        sourceKey: "derby",
        label: "neon integration session",
        rightsDeclaration: {
          policyId: `policy-neonit-${RUN_TAG}`,
          allowedOperations: ["analysis", "transformation"],
          assertedBy: `user-neonit-${RUN_TAG}`,
        },
        visibility: { kind: "private", roles: [] },
        status: "active",
        publishedAtMs: null,
        createdAtIso: "2026-09-16T00:00:00.000Z",
        updatedAtMs: 1_000,
      });

      // A BRAND-NEW client + store (a second instance / a redeploy).
      const reader = new PgControlPlaneRecordStore(freshClient(), () => 2_000);
      const record = await reader.findSession(adapterSessionId);
      expect(record).not.toBeNull();
      expect(record!.sessionId).toBe(adapterSessionId);
      expect(record!.ownerUserId).toBe(`user-neonit-${RUN_TAG}`);
      expect(record!.sourceKey).toBe("derby");
      expect(record!.label).toBe("neon integration session");
      expect(record!.rightsDeclaration.policyId).toBe(`policy-neonit-${RUN_TAG}`);
      expect(record!.visibility).toEqual({ kind: "private", roles: [] });
      expect(record!.createdAtIso).toBe("2026-09-16T00:00:00.000Z");
      // The record is listed for other instances too.
      const listed = await reader.listSessions();
      expect(listed.map((entry) => entry.sessionId)).toContain(adapterSessionId);
    },
    WAN_TIMEOUT_MS,
  );

  test(
    "recordRender is idempotent + readable verbatim; setVisibility persists; unknown flips throw",
    async () => {
      const writer = new PgControlPlaneRecordStore(freshClient(), () => 1_000);
      const renderId = `r-u-neonit${RUN_TAG}bbbb`;
      const result = {
        sessionId: adapterSessionId,
        rendererId: "anime.prototype",
        outputSegments: [
          {
            segmentId: `seg-neonit-${RUN_TAG}`,
            startMs: 0,
            endMs: 6000,
            artifactRef: `memory:seg-neonit-${RUN_TAG}`,
          },
        ],
        watermarkAfter: { watermarkMs: 6_000, sequence: 12 },
        rendererHealth: { lagMs: 0, degraded: false },
        provenance: { snapshotVersion: 6, lastEventSequence: 12 },
      };
      await writer.recordRender({
        sessionId: adapterSessionId,
        renderOrdinal: 1,
        renderId,
        rendererId: "anime.prototype",
        recipe: { styleConfig: { styleId: "neon-it", config: {} } },
        result,
        storedSegmentIds: [`seg-neonit-${RUN_TAG}`],
        createdAtMs: 1_000,
      });
      // A re-observation of the SAME render is a counted no-op — never a
      // second row.
      await writer.recordRender({
        sessionId: adapterSessionId,
        renderOrdinal: 1,
        renderId,
        rendererId: "anime.prototype",
        recipe: {},
        result,
        storedSegmentIds: [`seg-neonit-${RUN_TAG}`],
        createdAtMs: 9_999,
      });

      const reader = new PgControlPlaneRecordStore(freshClient(), () => 2_000);
      const renders = await reader.findRenders(adapterSessionId);
      expect(renders.length).toBe(1);
      expect(renders[0]!.renderId).toBe(renderId);
      expect(renders[0]!.storedSegmentIds).toEqual([`seg-neonit-${RUN_TAG}`]);
      expect(renders[0]!.result).toEqual(result);
      expect(renders[0]!.recipe.styleConfig?.styleId).toBe("neon-it");

      // The publication flip persists across store recreation.
      await writer.setVisibility(adapterSessionId, { kind: "public", roles: [] });
      const after = await new PgControlPlaneRecordStore(freshClient(), () => 3_000).findSession(
        adapterSessionId,
      );
      expect(after!.visibility.kind).toBe("public");
      expect(after!.publishedAtMs).not.toBeNull();

      // An unknown session's flip is REFUSED (fail-loud — never a silent
      // no-op that would pretend durability).
      await expect(
        writer.setVisibility("sess-u-neonit-unknown", { kind: "public", roles: [] }),
      ).rejects.toThrow(/unknown session/);
    },
    WAN_TIMEOUT_MS,
  );

  test(
    "create + render on composition A → watch + byte-identical output from composition B (never saw the create)",
    async () => {
      // The shared durable planes (what production shares): identity is
      // in-memory here (its Neon persistence is W911's, proven separately);
      // the CONTROL-PLANE RECORDS ride the real Neon database through TWO
      // INDEPENDENT pg clients — exactly the per-instance boundary.
      const accounts = new InMemoryAccountStore();
      const sessions = new SessionService({
        store: new InMemorySessionStore(),
        nowMs: () => NOW_MS_A,
        entropy: createSequentialEntropySource(),
      });
      const ownership = new InMemoryMediaOwnershipStore();
      const compose = (clock: () => number): SportaServer =>
        createSportaServer({
          nowMs: clock,
          passwordHasher: createDeterministicTestHasher(),
          accounts,
          sessions,
          ownership,
          transient: { redis: new InMemoryRedis(clock), provider: "in-memory" },
          controlRecords: new PgControlPlaneRecordStore(freshClient(), clock),
          seed: false,
        });
      const serverA = compose(() => NOW_MS_A);
      await serverA.ready;
      const serverB = compose(() => NOW_MS_B);
      await serverB.ready;
      const creator = await serverA.auth.register({
        username: "w921-neon-creator",
        password: "a-real-w921-neon-password",
        roles: ["creator", "viewer"],
      });
      const creatorToken = (await serverA.auth.issueSession({ userId: creator.userId })).token;

      // CREATE on A (through the real route; the studio write-through lands).
      installSportaServerForTests(serverA);
      const createResponse = await createSessionRoute(
        withCookie(
          creatorToken,
          "/api/create/sessions",
          post("/api/create/sessions", { sourceKey: "derby", operations: FULL_OPERATIONS }),
        ),
      );
      expect(createResponse.status).toBe(201);
      const { sessionId } = (await bodyOf(createResponse)) as { sessionId: string };
      createdSessionIds.push(sessionId);
      expect(sessionId).toMatch(/^sess-u-[0-9a-f]{32}$/);

      // DISPATCH + POLL on A (the render write-through lands at the poll).
      const dispatchResponse = await dispatchRoute(
        withCookie(
          creatorToken,
          `/api/create/sessions/${sessionId}/renders`,
          post(`/api/create/sessions/${sessionId}/renders`, {
            rendererId: "anime.prototype",
            styleId: "w921-neon",
          }),
        ),
        { params: Promise.resolve({ sessionId }) },
      );
      expect(dispatchResponse.status).toBe(202);
      const dispatch = (await bodyOf(dispatchResponse)) as { jobId: string };
      let renderId = "";
      for (let attempt = 0; attempt < 300; attempt += 1) {
        const poll = await jobRoute(
          withCookie(creatorToken, `/api/create/sessions/${sessionId}/jobs/${dispatch.jobId}`),
          { params: Promise.resolve({ sessionId, jobId: dispatch.jobId }) },
        );
        expect(poll.status).toBe(200);
        const job = await bodyOf(poll);
        if (job.state === "succeeded" || job.state === "failed") {
          expect(job.state).toBe("succeeded");
          renderId = job.renderId as string;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      expect(renderId).toMatch(/^r-u-[0-9a-f]{32}$/);

      // WATCH from A: capture the segment id + the real bytes.
      installSportaServerForTests(serverA);
      const watchAResponse = await watchRoute(withCookie(creatorToken, `/api/watch/${sessionId}`), {
        params: Promise.resolve({ sessionId }),
      });
      if (watchAResponse.status !== 200) {
        console.error("DEBUG watchA status:", watchAResponse.status, await watchAResponse.text());
      }
      const watchA = (await bodyOf(watchAResponse)) as {
        renders: { renderId: string; outputs: { segmentId: string }[] }[] | null;
      };
      expect(watchA.renders).not.toBeNull();
      const segmentId = watchA.renders![0]!.outputs[0]!.segmentId;
      const outputA = (await bodyOf(
        await outputRoute(
          withCookie(
            creatorToken,
            `/api/watch/${sessionId}/renders/${renderId}/outputs/${segmentId}`,
          ),
          { params: Promise.resolve({ sessionId, renderId, segmentId }) },
        ),
      )) as { content: string; contentHash: string };

      // WATCH from B — a composition that NEVER saw the create: the session
      // reconstructs from the REAL Neon rows, the render is the SAME work.
      installSportaServerForTests(serverB);
      const watchBResponse = await watchRoute(withCookie(creatorToken, `/api/watch/${sessionId}`), {
        params: Promise.resolve({ sessionId }),
      });
      expect(watchBResponse.status).toBe(200);
      const watchB = (await bodyOf(watchBResponse)) as {
        sessionId: string;
        renders:
          | { renderId: string; outputs: { segmentId: string; contentHash: string }[] }[]
          | null;
      };
      expect(watchB.sessionId).toBe(sessionId);
      expect(watchB.renders!.map((entry) => entry.renderId)).toEqual([renderId]);
      expect(watchB.renders![0]!.outputs[0]!.segmentId).toBe(segmentId);
      expect(watchB.renders![0]!.outputs[0]!.contentHash).toBe(outputA.contentHash);

      // The materialized BYTES are equal (the reconstruction re-encoded
      // through the real renderer + W504 encoder and ASSERTED the
      // content-addressed segment id against the recorded one).
      const outputB = (await bodyOf(
        await outputRoute(
          withCookie(
            creatorToken,
            `/api/watch/${sessionId}/renders/${renderId}/outputs/${segmentId}`,
          ),
          { params: Promise.resolve({ sessionId, renderId, segmentId }) },
        ),
      )) as { content: string; contentHash: string };
      expect(outputB.content).toBe(outputA.content);
      expect(outputB.contentHash).toBe(outputA.contentHash);
    },
    WAN_TIMEOUT_MS,
  );

  afterAll(async () => {
    // Best-effort cleanup of THIS run's rows (the database is shared state).
    if (clients.length > 0) {
      const cleaner = clients[0]!;
      try {
        for (const sessionId of createdSessionIds) {
          await cleaner`DELETE FROM sporta_control_renders WHERE session_id = ${sessionId}`;
          await cleaner`DELETE FROM sporta_control_sessions WHERE session_id = ${sessionId}`;
        }
        // The adapter round-trip's rows (tagged ids only).
        await cleaner`DELETE FROM sporta_control_renders WHERE session_id LIKE 'sess-u-neonit%'`;
        await cleaner`DELETE FROM sporta_control_sessions WHERE session_id LIKE 'sess-u-neonit%'`;
      } catch {
        // Cleanup is best-effort; the assertions already ran.
      }
    }
    await Promise.all(clients.map((sql) => sql.end({ timeout: 5 })));
  }, WAN_TIMEOUT_MS);
});
