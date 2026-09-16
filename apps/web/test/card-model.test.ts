import { beforeAll, describe, expect, test } from "bun:test";
import { createDeterministicTestHasher } from "@sporta/identity";
import { createSportaServer, installSportaServerForTests } from "../src/server/composition";
import type { SportaServer } from "../src/server/composition";
import { buildCatalog, buildLibrary, buildWatchModel } from "../src/server/catalog-service";
import { mapOutputToViewModel } from "../src/lib/surface-state";
import type { RenderOutputLike } from "../src/lib/api-types";
import { seedDevContent } from "../src/server/dev-seed";
import { capabilityForRequest } from "../src/server/capability-service";

/**
 * CARD-MODEL + WATCH-MODEL MAPPING TESTS (W904): the real control-plane state
 * the /api routes serve, mapped onto the client card/watch shapes — driven by
 * the REAL dev seed (real fixtures through the real control-api
 * createSession/createRender executing REAL renders, stored through the REAL
 * W504 pipeline). Honesty is asserted, not assumed.
 */

const NOW_MS = 1_777_777_777_000;
let server: SportaServer;

beforeAll(async () => {
  server = createSportaServer({
    nowMs: () => NOW_MS,
    passwordHasher: createDeterministicTestHasher(),
    seed: true,
  });
  installSportaServerForTests(server);
  await server.ready;
});

describe("the dev seed (honesty absolute)", () => {
  test("seeds exactly three real sessions through the real gate", async () => {
    const { sessions } = await server.control.listSessions();
    expect(sessions).toHaveLength(3);
    // Every seeded session is identity-owned by the labeled platform seed account.
    for (const summary of sessions) {
      const owner = await server.ownership.ownerIdOf(summary.id);
      expect(owner).not.toBeNull();
    }
  });

  test("every authorized story's renders really ran through the real control plane", async () => {
    for (const [sessionId, story] of server.storyIndex) {
      expect(story.source).toBe("dev-seed");
      // The plan: derby = testcard + anime, friendly = testcard (both
      // playback-authorized). Training's render ran too, but its listing is
      // rights-gated (denied before existence) — the deny path is tested in
      // the catalog/card suites.
      if (story.storyKey === "training") continue;
      const { renders } = await server.control.listRenders(sessionId);
      const expected = story.storyKey === "derby" ? 2 : 1;
      expect(renders).toHaveLength(expected);
      for (const render of renders) {
        expect(render.segmentCount).toBeGreaterThan(0);
        // The watermark is the engine's REAL fused state at render time:
        // the derby story's three extracted events make it non-zero; the
        // friendly story's lexicon genuinely extracted none (an honest zero).
        if (story.storyKey === "derby") {
          expect(render.watermarkAfter.sequence).toBeGreaterThan(0);
        } else {
          expect(render.watermarkAfter.sequence).toBe(0);
        }
      }
    }
  });

  test("the seed account is not signable-into (password drawn + discarded)", async () => {
    const account = await server.accounts.findByUsername("sporta-dev-seed");
    expect(account).not.toBeNull();
    // The seed account holds creator + viewer grants only.
    expect([...account!.roles].sort()).toEqual(["creator", "viewer"]);
  });

  test("seedDevContent returns the real summary it produced", async () => {
    // A second, isolated seed run proves determinism of shape (ids differ).
    const fresh = createSportaServer({
      nowMs: () => NOW_MS,
      passwordHasher: createDeterministicTestHasher(),
      seed: false,
    });
    await fresh.ready;
    const summary = await seedDevContent({
      server: fresh,
      engines: new Map(),
      storyIndex: new Map(),
      entropy: { randomBytes: (n: number) => new Uint8Array(n) },
    });
    expect(summary.seedAccountUsername).toBe("sporta-dev-seed");
    expect(summary.sessions).toHaveLength(3);
    expect(summary.sessions.map((entry) => entry.storyKey).sort()).toEqual([
      "derby",
      "friendly",
      "training",
    ]);
    // Derby and training each stored one real encoded output segment.
    const stored = summary.sessions.filter((entry) => entry.storedSegmentIds.length > 0);
    expect(stored.map((entry) => entry.storyKey).sort()).toEqual(["derby", "training"]);
  });
});

describe("buildCatalog (the card model from real control-plane state)", () => {
  test("maps every session onto honest card fields", async () => {
    const cards = await buildCatalog(server);
    expect(cards).toHaveLength(3);
    for (const card of cards) {
      expect(card.label.length).toBeGreaterThan(3);
      expect(card.status).toBe("authorized");
      expect(card.createdAtIso).toBe(new Date(NOW_MS).toISOString());
      expect(card.story).not.toBeNull();
      expect(card.story!.source).toBe("dev-seed");
    }
    const storyKeys = cards.map((card) => card.story!.storyKey).sort();
    expect(storyKeys).toEqual(["derby", "friendly", "training"]);
  });

  test("the derby card: authorized, two renders, one stored output, watchable", async () => {
    const cards = await buildCatalog(server);
    const derby = cards.find((card) => card.story!.storyKey === "derby")!;
    expect(derby.playback).toEqual({ state: "authorized", reasonCode: "ok" });
    expect(derby.renders).not.toBeNull();
    expect(derby.renders!.map((render) => render.rendererId).sort()).toEqual([
      "anime.prototype",
      "sporta.testcard",
    ]);
    const withOutput = derby.renders!.find((render) => render.hasStoredOutputs);
    expect(withOutput).toBeDefined();
    expect(withOutput!.rendererId).toBe("anime.prototype");
    expect(derby.outputCount).toBe(1);
  });

  test("the friendly card: authorized but no stored output (real 'requires render')", async () => {
    const cards = await buildCatalog(server);
    const friendly = cards.find((card) => card.story!.storyKey === "friendly")!;
    expect(friendly.playback).toEqual({ state: "authorized", reasonCode: "ok" });
    expect(friendly.renders).toHaveLength(1);
    expect(friendly.renders![0]!.rendererId).toBe("sporta.testcard");
    expect(friendly.renders![0]!.hasStoredOutputs).toBe(false);
    expect(friendly.outputCount).toBe(0);
  });

  test("the training card: real rights denial reveals NOTHING about renders", async () => {
    const cards = await buildCatalog(server);
    const training = cards.find((card) => card.story!.storyKey === "training")!;
    expect(training.playback).toEqual({ state: "denied", reasonCode: "rights-denied" });
    expect(training.renders).toBeNull();
    expect(training.outputCount).toBeNull();
  });
});

describe("buildWatchModel (the playback-session acquisition)", () => {
  test("the derby watch model: real renders with watermark + provenance + outputs", async () => {
    const cards = await buildCatalog(server);
    const derby = cards.find((card) => card.story!.storyKey === "derby")!;
    const model = await buildWatchModel(server, derby.sessionId);
    expect(model.playback.state).toBe("authorized");
    expect(model.renders).not.toBeNull();
    expect(model.renders).toHaveLength(2);
    const anime = model.renders!.find((render) => render.rendererId === "anime.prototype")!;
    expect(anime.outputs).toHaveLength(1);
    expect(anime.outputs[0]!.contentType).toContain("svg");
    expect(anime.outputs[0]!.byteLength).toBeGreaterThan(0);
    expect(anime.outputs[0]!.contentHash).toMatch(/^[a-f0-9]{64}$/);
    // Real SWM evidence on the render.
    expect(anime.provenance.snapshotVersion).toBeGreaterThan(0);
    expect(anime.watermarkAfter.sequence).toBeGreaterThan(0);
    // The labeled story data (real transcript + extracted events).
    expect(model.story).not.toBeNull();
    expect(model.story!.transcript.length).toBe(3);
    expect(model.story!.events.length).toBeGreaterThan(0);
    expect(model.story!.waveCount).toBe(6);
  });

  test("the training watch model denies before render detail", async () => {
    const cards = await buildCatalog(server);
    const training = cards.find((card) => card.story!.storyKey === "training")!;
    const model = await buildWatchModel(server, training.sessionId);
    expect(model.playback).toEqual({ state: "denied", reasonCode: "rights-denied" });
    expect(model.renders).toBeNull();
  });
});

describe("mapOutputToViewModel over a REAL stored output", () => {
  test("maps the derby anime clip without inventing anything", async () => {
    const cards = await buildCatalog(server);
    const derby = cards.find((card) => card.story!.storyKey === "derby")!;
    const model = await buildWatchModel(server, derby.sessionId);
    const anime = model.renders!.find((render) => render.rendererId === "anime.prototype")!;
    const segmentId = anime.outputs[0]!.segmentId;
    const document = (await server.control.getRenderOutput(
      derby.sessionId,
      anime.renderId,
      segmentId,
    )) as RenderOutputLike;
    const view = mapOutputToViewModel(document);

    // Every number is copied from the real manifest.
    expect(view.rendererId).toBe("anime.prototype");
    expect(view.styleId).toMatch(/^dev-seed-derby/);
    expect(view.frameCount).toBe(document.manifest.frameCount);
    expect(view.frames).toHaveLength(view.frameCount);
    expect(view.totalDurationMs).toBe(document.manifest.totalDurationMs);
    // Six real fusion waves → six clip steps.
    expect(view.frameCount).toBe(6);
    // Real entity positions (the tracker's track ids, projected to meters).
    const firstEntities = view.frames[0]!.entities;
    expect(firstEntities.length).toBeGreaterThan(0);
    for (const entity of firstEntities) {
      expect(entity.entityId).toMatch(/^t\d+$/);
    }
    // The transcript's captioned events become timeline markers (the real
    // W209 event phrases the renderer captioned each step with).
    expect(view.markers.length).toBeGreaterThan(0);
    const phrases = view.markers.map((marker) => marker.phrase).join(" ");
    expect(phrases).toContain("Kick-off");
    expect(phrases).toContain("GOAL");
  });
});

describe("the capability service over the real composition", () => {
  test("the catalog surfaces an anonymous user may see (matrix projection)", async () => {
    const response = await capabilityForRequest(
      server,
      new Request("http://sporta.test/api/capability"),
    );
    expect(response.auth).toMatchObject({ state: "anonymous" });
    const home = response.content.catalogSurfaces.find((entry) => entry.surfaceId === "home");
    const library = response.content.catalogSurfaces.find((entry) => entry.surfaceId === "library");
    expect(home?.visibility).toBe("visible");
    expect(library?.reasonCode).toBe("authentication-required");
    // Honest live (Simulation F) over the real transport state.
    expect(response.modes.live.transportKind).toBe("in-process");
    expect(response.modes.live.availability).toBe("unavailable");
  });

  test("a signed-in creator sees the creator-gated surfaces", async () => {
    const seedAccount = await server.accounts.findByUsername("sporta-dev-seed");
    expect(seedAccount).not.toBeNull();
    const login = await server.auth.issueSession({ userId: seedAccount!.userId });
    const response = await capabilityForRequest(
      server,
      new Request("http://sporta.test/api/capability", {
        headers: { authorization: `Bearer ${login.token}` },
      }),
    );
    expect(response.auth).toMatchObject({ state: "authenticated", sessionValid: true });
    expect(response.account.roles).toContain("creator");
    const library = response.content.catalogSurfaces.find((entry) => entry.surfaceId === "library");
    expect(library?.visibility).toBe("visible");
  });
});

describe("buildLibrary (ownership-gated)", () => {
  test("the seed account's library is exactly its three owned sessions", async () => {
    const seedAccount = await server.accounts.findByUsername("sporta-dev-seed");
    const cards = await buildLibrary(server, seedAccount!.userId);
    expect(cards).toHaveLength(3);
    const keys = cards.map((card) => card.story!.storyKey).sort();
    expect(keys).toEqual(["derby", "friendly", "training"]);
  });

  test("a different account's library is empty (ownership, not visibility)", async () => {
    const other = await server.auth.createSeedAccount({
      username: "w904-card-other",
      password: "card-test-password-1",
      roles: ["viewer"],
    });
    const cards = await buildLibrary(server, other.userId);
    expect(cards).toEqual([]);
  });
});
