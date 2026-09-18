/**
 * Durable SQLite {@link TechnologyRegistryStore} on the built-in `bun:sqlite`
 * (no new dependency), mirroring `@sporta/session`'s
 * `SqliteSessionRepository`.
 *
 * Every table stores the FULL validated contract document in
 * `document_json`; denormalized columns (`task`, `status`, ...) exist only
 * as index keys and are never a second source of truth. Writes validate
 * against the frozen zod schemas before persisting; reads validate again
 * and fail loudly (`RegistryValidationError`) on drift, so a corrupted row
 * can never silently masquerade as a registry record.
 *
 * `saveCurrentProfile` runs inside a transaction: profile document upsert,
 * current-profile pointer, and effective status land together or not at
 * all. Histories are ordered by the explicit append sequence
 * (`AUTOINCREMENT`), never by wall-clock time — the store never calls
 * `Date.now()`.
 */
import {
  BenchmarkRun,
  EvaluationReport,
  PromotionRecord,
  TechnologyCandidate,
  TechnologyProfile,
  TechnologyStatus,
} from "@sporta/contracts";
import { Database } from "bun:sqlite";
import { z } from "zod";
import type { LicenseReviewRecord } from "../license/license-registry";
import { parseLicenseReviewDocument } from "../license/license-registry";
import { RegistryValidationError } from "../errors";
import { type TechnologyRegistryStore, type TechnologyTriple } from "./store";

const CREATE_TABLES_SQL = `
  CREATE TABLE IF NOT EXISTS tr_candidates (
    candidate_id TEXT PRIMARY KEY,
    technology_id TEXT NOT NULL,
    technology_version TEXT NOT NULL,
    adapter_version TEXT NOT NULL,
    task TEXT NOT NULL,
    document_json TEXT NOT NULL,
    UNIQUE (technology_id, technology_version, adapter_version)
  );
  CREATE INDEX IF NOT EXISTS tr_candidates_by_technology
    ON tr_candidates (technology_id, technology_version);

  CREATE TABLE IF NOT EXISTS tr_profiles (
    technology_id TEXT NOT NULL,
    technology_version TEXT NOT NULL,
    adapter_version TEXT NOT NULL,
    task TEXT NOT NULL,
    status TEXT NOT NULL,
    document_json TEXT NOT NULL,
    PRIMARY KEY (technology_id, technology_version, adapter_version)
  );

  CREATE TABLE IF NOT EXISTS tr_current_profiles (
    technology_id TEXT NOT NULL,
    technology_version TEXT NOT NULL,
    adapter_version TEXT NOT NULL,
    PRIMARY KEY (technology_id, technology_version)
  );

  CREATE TABLE IF NOT EXISTS tr_effective_status (
    technology_id TEXT NOT NULL,
    technology_version TEXT NOT NULL,
    status TEXT NOT NULL,
    PRIMARY KEY (technology_id, technology_version)
  );

  CREATE TABLE IF NOT EXISTS tr_benchmark_runs (
    run_id TEXT PRIMARY KEY,
    technology_id TEXT NOT NULL,
    technology_version TEXT NOT NULL,
    adapter_version TEXT NOT NULL,
    fixture_set_version TEXT NOT NULL,
    document_json TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS tr_evaluation_reports (
    report_id TEXT PRIMARY KEY,
    fixture_set_version TEXT NOT NULL,
    document_json TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS tr_promotions (
    seq INTEGER PRIMARY KEY AUTOINCREMENT,
    promotion_id TEXT NOT NULL UNIQUE,
    technology_id TEXT NOT NULL,
    decided_at_ms INTEGER NOT NULL,
    document_json TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS tr_promotions_by_technology
    ON tr_promotions (technology_id, decided_at_ms, seq);

  CREATE TABLE IF NOT EXISTS tr_license_reviews (
    seq INTEGER PRIMARY KEY AUTOINCREMENT,
    review_id TEXT NOT NULL UNIQUE,
    technology_id TEXT NOT NULL,
    technology_version TEXT NOT NULL,
    component TEXT NOT NULL,
    reviewed_at_ms INTEGER NOT NULL,
    document_json TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS tr_license_reviews_by_technology
    ON tr_license_reviews (technology_id, technology_version, reviewed_at_ms, seq);
`;

interface DocumentRow {
  document_json: string;
}

function parseDocument<T>(raw: string, schema: z.ZodType<T>, label: string): T {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new RegistryValidationError(`stored ${label} document is not valid JSON`, [], {
      cause: err,
    });
  }
  const result = schema.safeParse(parsed);
  if (!result.success) {
    throw new RegistryValidationError(`stored ${label} document failed schema validation`, [
      ...result.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`),
    ]);
  }
  return result.data;
}

/**
 * Durable {@link TechnologyRegistryStore}.
 *
 * @param dbOrPath file path to a sqlite database (created if absent) or an
 *   open `bun:sqlite` `Database`. DDL is applied idempotently. `.close()`
 *   closes the underlying connection.
 */
export class SqliteTechnologyRegistryStore implements TechnologyRegistryStore {
  private readonly db: Database;
  private closed = false;

  constructor(dbOrPath: string | Database) {
    this.db = typeof dbOrPath === "string" ? new Database(dbOrPath) : dbOrPath;
    this.db.run("CREATE TABLE IF NOT EXISTS _tr_meta (k TEXT PRIMARY KEY)");
    this.db.exec(CREATE_TABLES_SQL);
  }

  // ---- candidates -------------------------------------------------------

  putCandidate(candidate: TechnologyCandidate): void {
    this.assertOpen();
    const doc = TechnologyCandidate.parse(candidate);
    this.db
      .query(
        `INSERT INTO tr_candidates
           (candidate_id, technology_id, technology_version, adapter_version, task, document_json)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT (candidate_id) DO UPDATE SET
           technology_id = excluded.technology_id,
           technology_version = excluded.technology_version,
           adapter_version = excluded.adapter_version,
           task = excluded.task,
           document_json = excluded.document_json`,
      )
      .run(
        doc.candidateId,
        doc.technologyId,
        doc.technologyVersion,
        doc.adapterVersion,
        doc.task,
        JSON.stringify(doc),
      );
  }

  getCandidateById(candidateId: string): TechnologyCandidate | null {
    this.assertOpen();
    const row = this.db
      .query("SELECT document_json FROM tr_candidates WHERE candidate_id = ?")
      .get(candidateId) as DocumentRow | null;
    return row === null ? null : parseDocument(row.document_json, TechnologyCandidate, "candidate");
  }

  findCandidateByTriple(triple: TechnologyTriple): TechnologyCandidate | null {
    this.assertOpen();
    const row = this.db
      .query(
        "SELECT document_json FROM tr_candidates WHERE technology_id = ? AND technology_version = ? AND adapter_version = ?",
      )
      .get(
        triple.technologyId,
        triple.technologyVersion,
        triple.adapterVersion,
      ) as DocumentRow | null;
    return row === null ? null : parseDocument(row.document_json, TechnologyCandidate, "candidate");
  }

  findCandidateByTechnology(
    technologyId: string,
    technologyVersion: string,
  ): TechnologyCandidate | null {
    this.assertOpen();
    const row = this.db
      .query(
        "SELECT document_json FROM tr_candidates WHERE technology_id = ? AND technology_version = ? ORDER BY candidate_id ASC LIMIT 1",
      )
      .get(technologyId, technologyVersion) as DocumentRow | null;
    return row === null ? null : parseDocument(row.document_json, TechnologyCandidate, "candidate");
  }

  // ---- profiles ---------------------------------------------------------

  getRecordedProfile(triple: TechnologyTriple): TechnologyProfile | null {
    this.assertOpen();
    const row = this.db
      .query(
        "SELECT document_json FROM tr_profiles WHERE technology_id = ? AND technology_version = ? AND adapter_version = ?",
      )
      .get(
        triple.technologyId,
        triple.technologyVersion,
        triple.adapterVersion,
      ) as DocumentRow | null;
    return row === null ? null : parseDocument(row.document_json, TechnologyProfile, "profile");
  }

  getCurrentProfileDocument(
    technologyId: string,
    technologyVersion: string,
  ): TechnologyProfile | null {
    this.assertOpen();
    const row = this.db
      .query(
        `SELECT p.document_json AS document_json
           FROM tr_current_profiles c
           JOIN tr_profiles p
             ON p.technology_id = c.technology_id
            AND p.technology_version = c.technology_version
            AND p.adapter_version = c.adapter_version
          WHERE c.technology_id = ? AND c.technology_version = ?`,
      )
      .get(technologyId, technologyVersion) as DocumentRow | null;
    return row === null ? null : parseDocument(row.document_json, TechnologyProfile, "profile");
  }

  saveCurrentProfile(profile: TechnologyProfile): void {
    this.assertOpen();
    const doc = TechnologyProfile.parse(profile);
    this.db.transaction(() => {
      this.db
        .query(
          `INSERT INTO tr_profiles
             (technology_id, technology_version, adapter_version, task, status, document_json)
           VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT (technology_id, technology_version, adapter_version) DO UPDATE SET
             task = excluded.task,
             status = excluded.status,
             document_json = excluded.document_json`,
        )
        .run(
          doc.technologyId,
          doc.technologyVersion,
          doc.adapterVersion,
          doc.task,
          doc.status,
          JSON.stringify(doc),
        );
      this.db
        .query(
          `INSERT INTO tr_current_profiles (technology_id, technology_version, adapter_version)
           VALUES (?, ?, ?)
           ON CONFLICT (technology_id, technology_version) DO UPDATE SET
             adapter_version = excluded.adapter_version`,
        )
        .run(doc.technologyId, doc.technologyVersion, doc.adapterVersion);
      this.db
        .query(
          `INSERT INTO tr_effective_status (technology_id, technology_version, status)
           VALUES (?, ?, ?)
           ON CONFLICT (technology_id, technology_version) DO UPDATE SET
             status = excluded.status`,
        )
        .run(doc.technologyId, doc.technologyVersion, doc.status);
    })();
  }

  listCurrentProfileDocuments(): TechnologyProfile[] {
    this.assertOpen();
    const rows = this.db
      .query(
        `SELECT p.document_json AS document_json
           FROM tr_current_profiles c
           JOIN tr_profiles p
             ON p.technology_id = c.technology_id
            AND p.technology_version = c.technology_version
            AND p.adapter_version = c.adapter_version
          ORDER BY p.technology_id ASC, p.technology_version ASC`,
      )
      .all() as DocumentRow[];
    return rows.map((row) => parseDocument(row.document_json, TechnologyProfile, "profile"));
  }

  getEffectiveStatus(technologyId: string, technologyVersion: string): TechnologyStatus | null {
    this.assertOpen();
    const row = this.db
      .query(
        "SELECT status FROM tr_effective_status WHERE technology_id = ? AND technology_version = ?",
      )
      .get(technologyId, technologyVersion) as { status: string } | null;
    return row === null ? null : TechnologyStatus.parse(row.status);
  }

  setEffectiveStatus(
    technologyId: string,
    technologyVersion: string,
    status: TechnologyStatus,
  ): void {
    this.assertOpen();
    this.db
      .query(
        `INSERT INTO tr_effective_status (technology_id, technology_version, status)
         VALUES (?, ?, ?)
         ON CONFLICT (technology_id, technology_version) DO UPDATE SET
           status = excluded.status`,
      )
      .run(technologyId, technologyVersion, status);
  }

  // ---- benchmark runs & evaluation reports ------------------------------

  putBenchmarkRun(run: BenchmarkRun): void {
    this.assertOpen();
    const doc = BenchmarkRun.parse(run);
    this.db
      .query(
        `INSERT INTO tr_benchmark_runs
           (run_id, technology_id, technology_version, adapter_version, fixture_set_version, document_json)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT (run_id) DO UPDATE SET
           technology_id = excluded.technology_id,
           technology_version = excluded.technology_version,
           adapter_version = excluded.adapter_version,
           fixture_set_version = excluded.fixture_set_version,
           document_json = excluded.document_json`,
      )
      .run(
        doc.runId,
        doc.technologyId,
        doc.technologyVersion,
        doc.adapterVersion,
        doc.fixtureSetVersion,
        JSON.stringify(doc),
      );
  }

  getBenchmarkRun(runId: string): BenchmarkRun | null {
    this.assertOpen();
    const row = this.db
      .query("SELECT document_json FROM tr_benchmark_runs WHERE run_id = ?")
      .get(runId) as DocumentRow | null;
    return row === null ? null : parseDocument(row.document_json, BenchmarkRun, "benchmark run");
  }

  putEvaluationReport(report: EvaluationReport): void {
    this.assertOpen();
    const doc = EvaluationReport.parse(report);
    this.db
      .query(
        `INSERT INTO tr_evaluation_reports (report_id, fixture_set_version, document_json)
         VALUES (?, ?, ?)
         ON CONFLICT (report_id) DO UPDATE SET
           fixture_set_version = excluded.fixture_set_version,
           document_json = excluded.document_json`,
      )
      .run(doc.reportId, doc.fixtureSetVersion, JSON.stringify(doc));
  }

  getEvaluationReport(reportId: string): EvaluationReport | null {
    this.assertOpen();
    const row = this.db
      .query("SELECT document_json FROM tr_evaluation_reports WHERE report_id = ?")
      .get(reportId) as DocumentRow | null;
    return row === null
      ? null
      : parseDocument(row.document_json, EvaluationReport, "evaluation report");
  }

  // ---- promotion records --------------------------------------------------

  putPromotionRecord(record: PromotionRecord): void {
    this.assertOpen();
    const doc = PromotionRecord.parse(record);
    try {
      this.db
        .query(
          `INSERT INTO tr_promotions (promotion_id, technology_id, decided_at_ms, document_json)
           VALUES (?, ?, ?, ?)`,
        )
        .run(doc.promotionId, doc.technologyId, doc.decidedAtMs, JSON.stringify(doc));
    } catch (err) {
      throw new Error(`duplicate promotion id '${doc.promotionId}'`, { cause: err });
    }
  }

  getPromotionRecord(promotionId: string): PromotionRecord | null {
    this.assertOpen();
    const row = this.db
      .query("SELECT document_json FROM tr_promotions WHERE promotion_id = ?")
      .get(promotionId) as DocumentRow | null;
    return row === null
      ? null
      : parseDocument(row.document_json, PromotionRecord, "promotion record");
  }

  listPromotionRecords(technologyId: string): PromotionRecord[] {
    this.assertOpen();
    const rows = this.db
      .query(
        "SELECT document_json FROM tr_promotions WHERE technology_id = ? ORDER BY decided_at_ms ASC, seq ASC",
      )
      .all(technologyId) as DocumentRow[];
    return rows.map((row) => parseDocument(row.document_json, PromotionRecord, "promotion record"));
  }

  // ---- license reviews ----------------------------------------------------

  putLicenseReview(review: LicenseReviewRecord): void {
    this.assertOpen();
    const doc = parseLicenseReviewDocument(review);
    try {
      this.db
        .query(
          `INSERT INTO tr_license_reviews
             (review_id, technology_id, technology_version, component, reviewed_at_ms, document_json)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(
          doc.reviewId,
          doc.technologyId,
          doc.technologyVersion,
          doc.component,
          doc.reviewedAtMs,
          JSON.stringify(doc),
        );
    } catch (err) {
      throw new Error(`duplicate license review id '${doc.reviewId}'`, { cause: err });
    }
  }

  getLicenseReview(reviewId: string): LicenseReviewRecord | null {
    this.assertOpen();
    const row = this.db
      .query("SELECT document_json FROM tr_license_reviews WHERE review_id = ?")
      .get(reviewId) as DocumentRow | null;
    return row === null ? null : this.parseReview(row.document_json);
  }

  listLicenseReviews(technologyId: string, technologyVersion: string): LicenseReviewRecord[] {
    this.assertOpen();
    const rows = this.db
      .query(
        "SELECT document_json FROM tr_license_reviews WHERE technology_id = ? AND technology_version = ? ORDER BY reviewed_at_ms ASC, seq ASC",
      )
      .all(technologyId, technologyVersion) as DocumentRow[];
    return rows.map((row) => this.parseReview(row.document_json));
  }

  /** Closes the underlying sqlite connection. Idempotent. */
  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.db.close();
  }

  private assertOpen(): void {
    if (this.closed) {
      throw new Error("SqliteTechnologyRegistryStore is closed");
    }
  }

  private parseReview(raw: string): LicenseReviewRecord {
    // LicenseReviewRecord's zod schema lives in the license module; validate
    // via its parse helper to keep a single schema source.
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      throw new RegistryValidationError("stored license review is not valid JSON", [], {
        cause: err,
      });
    }
    return parseLicenseReviewDocument(parsed);
  }
}
