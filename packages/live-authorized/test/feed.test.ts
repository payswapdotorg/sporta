/**
 * THE L009 AUTHORIZED-FEED BATTERY — the adapter over FORMAT-FIXTURES at
 * the injected fetch seam: the exact wire requests (URL + the Basic
 * header), page walking, buffering, the STRICT LiveObservation contract on
 * every emitted batch, provider-field isolation, the typed failure
 * postures (auth rejection / http error / network error — counted, never
 * smoothed, never silently retried), and the deterministic parse (same
 * fixture → the same observations).
 */
import { describe, expect, test } from "bun:test";
import { parseLiveObservation } from "@sporta/live-source";
import type { LiveObservation } from "@sporta/live-source";
import {
  SkillCornerAuthorizedFeed,
  skillCornerTrackingUrl,
  skillCornerBasicAuthHeader,
} from "../src/skillcorner/authorized-feed";
import type { AuthorizedFetchLike } from "../src/skillcorner/authorized-feed";

/** The recorded wire calls the fixtures served (asserted verbatim). */
interface RecordedCall {
  url: string;
  authorization: string;
  accept: string;
}

/**
 * A fixture fetcher: serves scripted pages and RECORDS every wire call.
 * Realistic statuses are scriptable per page (auth rejections, errors).
 */
function fixtureFetcher(pages: { status?: number; body?: unknown; throwMessage?: string }[]): {
  fetcher: AuthorizedFetchLike;
  calls: RecordedCall[];
} {
  const calls: RecordedCall[] = [];
  let index = 0;
  const fetcher: AuthorizedFetchLike = async (url, init) => {
    calls.push({
      url,
      authorization: init.headers.authorization ?? "",
      accept: init.headers.accept ?? "",
    });
    const scripted = pages[index] ?? { status: 404 };
    index += 1;
    if (scripted.throwMessage !== undefined) {
      throw new Error(scripted.throwMessage);
    }
    return {
      status: scripted.status ?? 200,
      json: async () => scripted.body ?? { count: 0, next: null, previous: null, results: [] },
    };
  };
  return { fetcher, calls };
}

/** One synthetic frame in the RECORDED shape (format-fixture, not data). */
function frameAt(frame: number, secondsIntoMatch: number): Record<string, unknown> {
  return {
    frame,
    timestamp: `00:${String(Math.floor(secondsIntoMatch / 60)).padStart(2, "0")}:${String(
      secondsIntoMatch % 60,
    ).padStart(2, "0")}.00`,
    period: 1,
    ball_data: { x: -9.5, y: -33.0, z: 1.8, is_detected: true },
    player_data: [
      { x: -44.6, y: -8.3, player_id: 51678, is_detected: false },
      { x: 12.4, y: 3.1, player_id: 51679, is_detected: true },
    ],
    possession: { player_id: 51679, group: "home" },
    image_corners_projection: [],
  };
}

function page(results: Record<string, unknown>[], next: string | null): unknown {
  return { count: results.length, next, previous: null, results };
}

/** A fixed injectable clock (the repo's no-hidden-clock convention). */
let clockMs = 1_777_900_000_000;
const nowMs = () => (clockMs += 50);

function newFeed(fetcher: AuthorizedFetchLike): SkillCornerAuthorizedFeed {
  return new SkillCornerAuthorizedFeed({
    sessionId: "live-session-j014",
    username: "sporta-operator",
    password: "a-real-secret",
    matchId: "2017461",
    apiBase: "https://skillcorner.com",
    fetcher,
    nowMs,
  });
}

describe("L009 — the wire shape (the recorded endpoint + the Basic header)", () => {
  test("the first pull hits the RECORDED tracking URL with the provider's Basic auth convention", async () => {
    const { fetcher, calls } = fixtureFetcher([{ body: page([frameAt(0, 10)], null) }]);
    const feed = newFeed(fetcher);
    await feed.pullPage();
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe("https://skillcorner.com/api/match/2017461/tracking");
    expect(calls[0]!.authorization).toBe(
      skillCornerBasicAuthHeader("sporta-operator", "a-real-secret"),
    );
    expect(calls[0]!.authorization).toBe(`Basic ${btoa("sporta-operator:a-real-secret")}`);
    expect(calls[0]!.accept).toBe("application/json");
  });

  test("the endpoint helper encodes the match id (never a path-injection)", () => {
    expect(skillCornerTrackingUrl("https://skillcorner.com", "a/b c")).toBe(
      "https://skillcorner.com/api/match/a%2Fb%20c/tracking",
    );
  });

  test("subsequent pulls walk the page's `next` link (the recorded DRF convention)", async () => {
    const { fetcher, calls } = fixtureFetcher([
      { body: page([frameAt(0, 10)], "https://skillcorner.com/api/match/2017461/tracking?page=2") },
      { body: page([frameAt(1, 11)], null) },
    ]);
    const feed = newFeed(fetcher);
    await feed.pullPage();
    await feed.pullPage();
    expect(calls.map((call) => call.url)).toEqual([
      "https://skillcorner.com/api/match/2017461/tracking",
      "https://skillcorner.com/api/match/2017461/tracking?page=2",
    ]);
  });
});

describe("L009 — the emitted batches (the STRICT frozen contract, provider fields isolated)", () => {
  test("every buffered observation parses against the strict LiveObservation contract", async () => {
    const { fetcher } = fixtureFetcher([
      { body: page([frameAt(0, 10), frameAt(1, 11), frameAt(2, 12)], null) },
    ]);
    const feed = newFeed(fetcher);
    const pull = await feed.pullPage();
    expect(pull).toMatchObject({ kind: "page", framesParsed: 3, observationsBuffered: 3 });
    const batches: LiveObservation[] = [];
    for (let index = 0; index < 3; index += 1) {
      const batch = feed.next();
      expect(batch).not.toBeNull();
      // The strict revalidation — a provider leak would refuse here.
      batches.push(parseLiveObservation(JSON.parse(JSON.stringify(batch))));
    }
    expect(feed.next()).toBeNull();
    expect(batches.map((batch) => batch.sequence)).toEqual([1, 2, 3]);
    expect(batches[0]!.sourceId).toBe("skillcorner-authorized");
    expect(batches[0]!.sourceType).toBe("TRACKING");
    expect(batches[0]!.provenance).toBe("DERIVED");
    // Provider-field isolation: the possession hypothesis and the image
    // corners NEVER survive into the product contract.
    const flat = JSON.stringify(batches);
    expect(flat).not.toContain("possession");
    expect(flat).not.toContain("image_corners");
    expect(flat).not.toContain("player_id");
    // Coordinate normalization: center-origin provider frame → the Sporta
    // canonical pitch frame (x+52.5 / y+34).
    const player = batches[0]!.entityObservations.find((row) => row.entityRef === "sc-p-51678")!;
    expect(player.position.xMeters).toBeCloseTo(-44.6 + 52.5, 6);
    expect(player.position.yMeters).toBeCloseTo(-8.3 + 34, 6);
    // The detectedness prior honesty (0.85 detected / 0.25 carried).
    const carried = batches[0]!.entityObservations.find((row) => row.entityRef === "sc-p-51678")!;
    expect(carried.detected).toBe(false);
    expect(carried.confidence).toBe(0.25);
  });

  test("the all-null pre-match frames are SKIPPED and counted (never a fabricated empty batch)", async () => {
    const nullFrame = {
      frame: 5,
      timestamp: null,
      period: null,
      ball_data: { x: null, y: null, z: null, is_detected: null },
      player_data: [],
    };
    const { fetcher } = fixtureFetcher([{ body: page([nullFrame, frameAt(6, 10)], null) }]);
    const feed = newFeed(fetcher);
    await feed.pullPage();
    expect(feed.stats().emptyFramesSkipped).toBe(1);
    expect(feed.stats().observationsEmitted).toBe(0);
    const batch = feed.next();
    expect(batch).not.toBeNull();
    expect(feed.stats().observationsEmitted).toBe(1);
  });

  test("the same fixture yields the SAME observations (deterministic parse)", async () => {
    const run = async (): Promise<string> => {
      clockMs = 1_777_900_000_000;
      const { fetcher } = fixtureFetcher([{ body: page([frameAt(0, 10), frameAt(1, 11)], null) }]);
      const feed = newFeed(fetcher);
      await feed.pullPage();
      const batches = [feed.next(), feed.next()];
      return JSON.stringify(batches);
    };
    expect(await run()).toBe(await run());
  });
});

describe("L009 — the typed failure postures (counted, never smoothed, never retried)", () => {
  test("a 401 is an auth-rejected result + counted; the wire saw exactly one call (no silent retry)", async () => {
    const { fetcher, calls } = fixtureFetcher([
      { status: 401, body: { detail: "Invalid token" } },
      { status: 401, body: { detail: "Invalid token" } },
    ]);
    const feed = newFeed(fetcher);
    const pull = await feed.pullPage();
    expect(pull).toMatchObject({ kind: "auth-rejected", status: 401 });
    expect(feed.stats().authRejections).toBe(1);
    expect(calls).toHaveLength(1);
    // The cursor stays on the SAME page — the caller's policy decides retry.
    const again = await feed.pullPage();
    expect(again).toMatchObject({ kind: "auth-rejected", status: 401 });
    expect(calls).toHaveLength(2);
    expect(feed.stats().authRejections).toBe(2);
  });

  test("a non-200 non-auth status is an http-error result + counted", async () => {
    const { fetcher } = fixtureFetcher([{ status: 503 }]);
    const feed = newFeed(fetcher);
    expect(await feed.pullPage()).toMatchObject({ kind: "http-error", status: 503 });
    expect(feed.stats().httpErrors).toBe(1);
  });

  test("a fetcher throw is a network-error result + counted (the message is honest)", async () => {
    const { fetcher } = fixtureFetcher([{ throwMessage: "ECONNREFUSED" }]);
    const feed = newFeed(fetcher);
    const pull = await feed.pullPage();
    expect(pull).toMatchObject({ kind: "network-error" });
    if (pull.kind === "network-error") expect(pull.message).toContain("ECONNREFUSED");
    expect(feed.stats().networkErrors).toBe(1);
  });

  test("an unparseable body is a network-error (never a partial page)", async () => {
    const badJson = {
      status: 200,
      json: async () => {
        throw new Error("invalid json");
      },
    };
    const calls: RecordedCall[] = [];
    const fetcher: AuthorizedFetchLike = async (url, init) => {
      calls.push({
        url,
        authorization: init.headers.authorization ?? "",
        accept: init.headers.accept ?? "",
      });
      return badJson;
    };
    const feed = newFeed(fetcher);
    expect(await feed.pullPage()).toMatchObject({ kind: "network-error" });
    expect(feed.stats().networkErrors).toBe(1);
  });
});

describe("L009 — the honest stats + the port surface", () => {
  test("stats carry the full accounting: pages, frames, refusals, unmapped, unknown-by-name, rows", async () => {
    const exotic = {
      ...frameAt(0, 10),
      speed: 7.9, // beyond the recorded format — must be named, not forwarded
    };
    const { fetcher } = fixtureFetcher([{ body: page([exotic, frameAt(1, 11)], null) }]);
    const feed = newFeed(fetcher);
    await feed.pullPage();
    feed.next();
    const stats = feed.stats();
    expect(stats).toMatchObject({
      pagesFetched: 1,
      framesParsed: 2,
      framesRefused: 0,
      observationsEmitted: 1,
      playerRowsEmitted: 2,
      ballRowsEmitted: 1,
      carriedRowsEmitted: 1,
      bufferDepth: 1,
      knownUnmappedFieldRows: 4, // 2 unmapped fields x 2 frames
    });
    expect(stats.unknownFieldKinds).toEqual(["speed"]);
  });

  test("plannedIngestTimeMs exposes the buffered head's ingest stamp; null when empty", async () => {
    const { fetcher } = fixtureFetcher([{ body: page([frameAt(0, 10)], null) }]);
    const feed = newFeed(fetcher);
    expect(feed.plannedIngestTimeMs()).toBeNull();
    await feed.pullPage();
    expect(feed.plannedIngestTimeMs()).not.toBeNull();
    feed.next();
    expect(feed.plannedIngestTimeMs()).toBeNull();
  });

  test("exhaustion is honest: `next` null + no cursor; close() ends the feed idempotently", async () => {
    const { fetcher } = fixtureFetcher([{ body: page([], null) }]);
    const feed = newFeed(fetcher);
    await feed.pullPage(); // empty final page
    expect(await feed.pullPage()).toMatchObject({ kind: "exhausted" });
    expect(feed.next()).toBeNull();
    expect(feed.stats().exhausted).toBe(true);
    feed.close();
    expect(await feed.pullPage()).toMatchObject({ kind: "exhausted" });
    expect(feed.stats()).toMatchObject({ pagesFetched: 1 });
  });

  test("the constructor refuses a missing injection (no hidden fetcher, no hidden clock)", () => {
    expect(
      () =>
        new SkillCornerAuthorizedFeed({
          sessionId: "s",
          username: "u",
          password: "p",
          matchId: "m",
          apiBase: "https://skillcorner.com",
          // @ts-expect-error — the fetcher is deliberately absent
          fetcher: undefined,
          nowMs,
        }),
    ).toThrow(RangeError);
    expect(
      () =>
        new SkillCornerAuthorizedFeed({
          sessionId: "s",
          username: "u",
          password: "p",
          matchId: "m",
          apiBase: "https://skillcorner.com",
          fetcher: async () => ({ status: 200, json: async () => ({}) }),
          // @ts-expect-error — the clock is deliberately absent
          nowMs: undefined,
        }),
    ).toThrow(RangeError);
  });
});
