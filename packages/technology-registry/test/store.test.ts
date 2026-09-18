/**
 * R001 — persistence round-trips: the full store contract exercised
 * identically against the InMemory and SQLite implementations (the
 * `@sporta/session` repository-test pattern), plus SQLite-specific
 * durability and corruption-refusal tests.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Database } from "bun:sqlite";
import {
  InMemoryTechnologyRegistryStore,
  RegistryValidationError,
  SqliteTechnologyRegistryStore,
  type TechnologyRegistryStore,
} from "../src/index";
import {
  buildBenchmarkRun,
  buildEvaluationReport,
  buildLicenseReview,
  buildPromotionRecord,
  buildTechnologyCandidate,
  buildTechnologyProfile,
} from "./builders";

function roundTripSuite(makeStore: () => TechnologyRegistryStore, label: string) {
  describe(`${label} round-trips`, () => {
    test("candidate put + find by id/triple/technology", () => {
      const store = makeStore();
      const candidate = buildTechnologyCandidate({
        candidateId: "cand-rt",
        technologyId: "tech-rt",
        technologyVersion: "1.0.0",
        adapterVersion: "1.0.0",
      });
      store.putCandidate(candidate);
      expect(store.getCandidateById("cand-rt")?.technologyId).toBe("tech-rt");
      expect(
        store.findCandidateByTriple({
          technologyId: "tech-rt",
          technologyVersion: "1.0.0",
          adapterVersion: "1.0.0",
        })?.candidateId,
      ).toBe("cand-rt");
      expect(store.findCandidateByTechnology("tech-rt", "1.0.0")?.candidateId).toBe("cand-rt");
      expect(store.getCandidateById("missing")).toBeNull();
    });

    test("profile saveCurrentProfile makes it current with effective status", () => {
      const store = makeStore();
      const profile = buildTechnologyProfile({
        technologyId: "tech-p",
        technologyVersion: "1.0.0",
        adapterVersion: "1.0.0",
        status: "candidate",
      });
      store.saveCurrentProfile(profile);
      expect(store.getCurrentProfileDocument("tech-p", "1.0.0")?.adapterVersion).toBe("1.0.0");
      expect(store.getEffectiveStatus("tech-p", "1.0.0")).toBe("candidate");
      expect(
        store.getRecordedProfile({
          technologyId: "tech-p",
          technologyVersion: "1.0.0",
          adapterVersion: "1.0.0",
        })?.displayName,
      ).toBe(profile.displayName);
    });

    test("a revision becomes current; the old document stays recorded", () => {
      const store = makeStore();
      store.saveCurrentProfile(
        buildTechnologyProfile({
          technologyId: "tech-p",
          adapterVersion: "1.0.0",
          status: "candidate",
        }),
      );
      store.saveCurrentProfile(
        buildTechnologyProfile({
          technologyId: "tech-p",
          adapterVersion: "1.1.0",
          status: "candidate",
        }),
      );
      expect(store.getCurrentProfileDocument("tech-p", "1.0.0")?.adapterVersion).toBe("1.1.0");
      expect(
        store.getRecordedProfile({
          technologyId: "tech-p",
          technologyVersion: "1.0.0",
          adapterVersion: "1.0.0",
        }),
      ).not.toBeNull();
    });

    test("setEffectiveStatus overwrites the status (promotion path)", () => {
      const store = makeStore();
      store.saveCurrentProfile(
        buildTechnologyProfile({ technologyId: "tech-s", status: "candidate" }),
      );
      store.setEffectiveStatus("tech-s", "1.0.0", "benchmarked");
      expect(store.getEffectiveStatus("tech-s", "1.0.0")).toBe("benchmarked");
    });

    test("listCurrentProfileDocuments returns every current unit", () => {
      const store = makeStore();
      store.saveCurrentProfile(buildTechnologyProfile({ technologyId: "tech-l1" }));
      store.saveCurrentProfile(buildTechnologyProfile({ technologyId: "tech-l2" }));
      expect(store.listCurrentProfileDocuments()).toHaveLength(2);
    });

    test("benchmark runs and evaluation reports round-trip", () => {
      const store = makeStore();
      const run = buildBenchmarkRun({ runId: "run-rt" });
      store.putBenchmarkRun(run);
      expect(store.getBenchmarkRun("run-rt")?.runId).toBe("run-rt");
      expect(store.getBenchmarkRun("missing")).toBeNull();

      const report = buildEvaluationReport({ reportId: "report-rt", benchmarkRunIds: ["run-rt"] });
      store.putEvaluationReport(report);
      expect(store.getEvaluationReport("report-rt")?.reportId).toBe("report-rt");
      expect(store.getEvaluationReport("missing")).toBeNull();
    });

    test("promotion records append and list in (decidedAtMs, seq) order", () => {
      const store = makeStore();
      const late = buildPromotionRecord({
        promotionId: "promo-late",
        technologyId: "tech-h",
        decidedAtMs: 2_000,
      });
      const early = buildPromotionRecord({
        promotionId: "promo-early",
        technologyId: "tech-h",
        decidedAtMs: 1_000,
      });
      const other = buildPromotionRecord({
        promotionId: "promo-other",
        technologyId: "tech-other",
        decidedAtMs: 1_500,
      });
      store.putPromotionRecord(late);
      store.putPromotionRecord(early);
      store.putPromotionRecord(other);
      expect(store.getPromotionRecord("promo-late")?.promotionId).toBe("promo-late");
      expect(store.listPromotionRecords("tech-h").map((r) => r.promotionId)).toEqual([
        "promo-early",
        "promo-late",
      ]);
      expect(store.listPromotionRecords("tech-other")).toHaveLength(1);
      expect(() => store.putPromotionRecord(late)).toThrow(/duplicate promotion id/);
    });

    test("same-decidedAtMs promotions keep append order", () => {
      const store = makeStore();
      store.putPromotionRecord(
        buildPromotionRecord({
          promotionId: "promo-a",
          technologyId: "tech-o",
          decidedAtMs: 5_000,
        }),
      );
      store.putPromotionRecord(
        buildPromotionRecord({
          promotionId: "promo-b",
          technologyId: "tech-o",
          decidedAtMs: 5_000,
        }),
      );
      expect(store.listPromotionRecords("tech-o").map((r) => r.promotionId)).toEqual([
        "promo-a",
        "promo-b",
      ]);
    });

    test("license reviews append, list per technology version, and reject duplicates", () => {
      const store = makeStore();
      store.putLicenseReview(
        buildLicenseReview({
          reviewId: "rev-1",
          technologyId: "tech-r",
          technologyVersion: "1.0.0",
          component: "code",
          reviewedAtMs: 1_000,
        }),
      );
      store.putLicenseReview(
        buildLicenseReview({
          reviewId: "rev-2",
          technologyId: "tech-r",
          technologyVersion: "1.0.0",
          component: "model",
          reviewedAtMs: 2_000,
        }),
      );
      store.putLicenseReview(
        buildLicenseReview({
          reviewId: "rev-3",
          technologyId: "tech-r",
          technologyVersion: "2.0.0",
          component: "code",
          reviewedAtMs: 3_000,
        }),
      );
      expect(store.listLicenseReviews("tech-r", "1.0.0").map((r) => r.reviewId)).toEqual([
        "rev-1",
        "rev-2",
      ]);
      expect(store.listLicenseReviews("tech-r", "2.0.0").map((r) => r.reviewId)).toEqual(["rev-3"]);
      expect(store.getLicenseReview("rev-1")?.component).toBe("code");
      expect(() =>
        store.putLicenseReview(
          buildLicenseReview({ reviewId: "rev-1", technologyId: "tech-r", reviewedAtMs: 9_000 }),
        ),
      ).toThrow(/duplicate license review id/);
    });

    test("handed-out documents are deep copies (no store mutation through references)", () => {
      const store = makeStore();
      store.saveCurrentProfile(buildTechnologyProfile({ technologyId: "tech-c" }));
      const view = store.getCurrentProfileDocument("tech-c", "1.0.0");
      if (view === null) throw new Error("expected profile");
      view.status = "production";
      expect(store.getEffectiveStatus("tech-c", "1.0.0")).toBe("candidate");
      expect(store.getCurrentProfileDocument("tech-c", "1.0.0")?.status).toBe("candidate");
    });
  });
}

roundTripSuite(() => new InMemoryTechnologyRegistryStore(), "InMemory store");

describe("SqliteTechnologyRegistryStore", () => {
  let tempDir: string;

  beforeAll(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "tech-registry-store-"));
  });
  afterAll(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  roundTripSuite(
    () => new SqliteTechnologyRegistryStore(join(tempDir, `shared-${crypto.randomUUID()}.sqlite`)),
    "SQLite store",
  );

  test("persists across close/reopen (durability)", () => {
    const path = join(tempDir, "durable.sqlite");
    const store = new SqliteTechnologyRegistryStore(path);
    store.putCandidate(buildTechnologyCandidate({ candidateId: "cand-d", technologyId: "tech-d" }));
    store.saveCurrentProfile(
      buildTechnologyProfile({ technologyId: "tech-d", status: "candidate" }),
    );
    store.setEffectiveStatus("tech-d", "1.0.0", "approved");
    store.putPromotionRecord(
      buildPromotionRecord({ promotionId: "promo-d", technologyId: "tech-d" }),
    );
    store.close();

    const reopened = new SqliteTechnologyRegistryStore(path);
    expect(reopened.getCandidateById("cand-d")?.technologyId).toBe("tech-d");
    expect(reopened.getEffectiveStatus("tech-d", "1.0.0")).toBe("approved");
    expect(reopened.listPromotionRecords("tech-d")).toHaveLength(1);
    reopened.close();
  });

  test("fails loudly on a corrupted profile row (validation on read)", () => {
    const path = join(tempDir, "corrupt.sqlite");
    const store = new SqliteTechnologyRegistryStore(path);
    store.saveCurrentProfile(buildTechnologyProfile({ technologyId: "tech-x" }));
    store.close();

    const db = new Database(path);
    db.run(
      "UPDATE tr_profiles SET document_json = '{\"schemaVersion\": \"1.1\"}' WHERE technology_id = 'tech-x'",
    );
    db.close();

    const reopened = new SqliteTechnologyRegistryStore(path);
    expect(() => reopened.getCurrentProfileDocument("tech-x", "1.0.0")).toThrow(
      RegistryValidationError,
    );
    reopened.close();
  });

  test("accepts an injected open Database instance", () => {
    const db = new Database(":memory:");
    const store = new SqliteTechnologyRegistryStore(db);
    store.putCandidate(buildTechnologyCandidate({ candidateId: "cand-i" }));
    expect(store.getCandidateById("cand-i")?.candidateId).toBe("cand-i");
    store.close();
  });
});
