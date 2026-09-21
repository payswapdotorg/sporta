/**
 * THE L009 APP-SIDE BATTERY — the authorized live provider's capability
 * surfaced through the REAL operator route: `GET /api/operations/providers`
 * carries the `liveAuthorized` panel, honestly `blocked` with the EXACT
 * missing binding names in this deployment (no SKILLCORNER_* bindings
 * exist here — the recorded external dependency), and secret values never
 * appear anywhere in the answer. The adapter itself, the env gate, the
 * recorded response schema and the §6 registration are pinned by the
 * package battery (`packages/live-authorized/test/` — 36 tests); this file
 * pins the OPERATOR-VISIBLE surface over the real route.
 */
import { beforeAll, describe, expect, test } from "bun:test";
import { createDeterministicTestHasher } from "@sporta/identity";
import { createSportaServer, installSportaServerForTests } from "../src/server/composition";
import type { SportaServer } from "../src/server/composition";
import { SPORTA_SESSION_COOKIE } from "../src/server/auth-service";
import { InMemoryRedis } from "../src/server/platform/upstash/redis";
import { GET as providersRoute } from "../src/app/api/operations/providers/route";

const NOW_MS = 1_777_777_778_000;

let server: SportaServer;
let operatorToken = "";

beforeAll(async () => {
  server = createSportaServer({
    nowMs: () => NOW_MS,
    passwordHasher: createDeterministicTestHasher(),
    transient: { redis: new InMemoryRedis(() => NOW_MS), provider: "in-memory" },
    seed: true,
  });
  installSportaServerForTests(server);
  await server.ready;
  const operator = await server.accounts.create({
    username: "l009-ops-operator",
    email: undefined,
    passwordHash: "not-a-login-path",
    roles: ["operator", "viewer"],
    createdAtIso: new Date(NOW_MS).toISOString(),
  });
  operatorToken = (await server.auth.issueSession({ userId: operator.userId })).token;
});

function withCookie(token: string | null, path: string): Request {
  return new Request(`http://sporta.test${path}`, {
    headers: token === null ? {} : { cookie: `${SPORTA_SESSION_COOKIE}=${token}` },
  });
}

describe("L009 — the authorized live provider on the operator providers panel", () => {
  test("GET /api/operations/providers carries the liveAuthorized panel: BLOCKED with the exact missing bindings", async () => {
    const response = await providersRoute(withCookie(operatorToken, "/api/operations/providers"));
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      liveAuthorized: {
        providers: {
          provider: string;
          technologyId: string;
          adapterId: string;
          state: "blocked" | "ready";
          missingBindings: string[];
          matchId: string | null;
          apiBase: string;
          note: string;
        }[];
        summary: { ready: number; blocked: number; note: string };
      };
      notes: string[];
    };
    const panel = body.liveAuthorized;
    expect(panel.providers).toHaveLength(1);
    const row = panel.providers[0]!;
    // This deployment holds NO SkillCorner bindings — the honest blocked
    // record with the exact external dependency (never a smoothed unknown).
    expect(row.provider).toBe("skillcorner");
    expect(row.state).toBe("blocked");
    expect(row.missingBindings).toEqual([
      "SKILLCORNER_USERNAME",
      "SKILLCORNER_PASSWORD",
      "SKILLCORNER_MATCH_ID",
    ]);
    expect(row.matchId).toBeNull();
    expect(row.technologyId).toBe("skillcorner-authorized-tracking");
    expect(row.adapterId).toBe("live-authorized.skillcorner-tracking");
    expect(row.note).toContain("SKILLCORNER_USERNAME");
    expect(panel.summary).toMatchObject({ ready: 0, blocked: 1 });
    // The panel's note documents the first-pull verification posture.
    expect(panel.summary.note).toContain("first-pull");
    // And the operator notes point at the L009 record.
    expect(body.notes.some((note) => note.includes("liveAuthorized"))).toBe(true);
  });

  test("the panel never leaks a secret (no binding VALUES exist here — and none are invented)", async () => {
    const response = await providersRoute(withCookie(operatorToken, "/api/operations/providers"));
    const text = await response.text();
    expect(text).not.toContain("SKILLCORNER_PASSWORD=");
    // The honest answer names the BINDINGS; it never fabricates credentials.
    expect(text).toContain("SKILLCORNER_USERNAME");
  });

  test("the panel is operator-gated like the rest of the providers surface", async () => {
    const anonymous = await providersRoute(withCookie(null, "/api/operations/providers"));
    expect(anonymous.status).toBe(401);
  });
});
