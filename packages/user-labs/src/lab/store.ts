/**
 * The User Lab store (REL-020): tenant-scoped labs, lab runs and lab
 * candidates — the typed user flow of Gate REL-A6:
 *
 *   create a lab -> choose domain/task -> select source data -> set budget
 *     -> request a simulation/search run -> inspect candidates
 *     -> keep private or publish (REL-022) -> request promotion (REQUEST only)
 *
 * THE LAWS THIS STORE ENFORCES (all tested):
 *
 * 1. TENANT ISOLATION IS A HARD BOUNDARY. Every read and write re-checks the
 *    owning tenant and throws `LabIsolationError` on any cross-tenant path —
 *    including read-throughs of the candidate store. Lab candidates are
 *    private by default and STAY private here: the candidate-store
 *    visibility vocabulary has one member ("private"); the only cross-tenant
 *    surface is the REL-022 publication snapshot in src/exchange/publish.ts.
 *
 * 2. FAIL-CLOSED SOURCE BASIS. Source refs are resolved through the injected
 *    `SourceDataPort` at selection time AND re-verified at run-request time;
 *    unknown refs and `unverified` rights bases are typed refusals
 *    (`missing-source-basis`) — a public URL alone never proves rights
 *    (ADR-013 #7).
 *
 * 3. BUDGET IS A GATE, NOT A HOPE. A run request whose estimate would cross
 *    the remaining budget is a typed refusal (`budget-exceeded`) carrying the
 *    numbers; completed runs charge their ACTUAL cost to the lab.
 *
 * 4. DOMAIN DECISIONS ARE TYPED REFUSAL RECORDS (never thrown):
 *    `unknown-domain`, `missing-source-basis`, `lab-not-ready`,
 *    `budget-exceeded`, `lab-archived`, `empty-revision`. Storage-boundary
 *    failures (malformed input, unknown ids, isolation) throw typed errors —
 *    the registry's own split.
 *
 * 5. THE RUN SEAM. `requestRun` delegates to the injected `LabRunPort` (the
 *    durable lab-runtime seam — scripted in tests, wired to the real runtime
 *    by the product later). The port receives the fully-resolved,
 *    rights-verified request; it never re-derives rights.
 *
 * Constitution: no wall time, no randomness — the clock is injected
 * (src/clock.ts); ids are deterministic sequential sources. In-memory this
 * wave; the store shape is the port-friendly seam for a future durable
 * adapter (registry precedent).
 */
import { z } from "zod";
import type {
  CandidateRevision,
  DomainCatalog,
  LabBudget,
  LabCandidate,
  LabRunConfiguration,
  LabRunPort,
  LabRunRecord,
  LabRunRequest,
  LabSelection,
  NewLabInput,
  RunPurpose,
  SourceDataPort,
  SourceDataRecord,
  TenantRef,
  UserLab,
} from "../domain";
import {
  CandidateDefinitionDraftSchema,
  CandidateEvidenceSchema,
  LabBudgetSchema,
  LabRunCandidatePayloadSchema,
  LabRunConfigurationSchema,
  NewLabInputSchema,
  deepFreeze,
  requireTenantRef,
} from "../domain";
import { createUserLabsDefaultClock, createSequentialIdSource, toIsoUtc } from "../clock";
import type { IdSource } from "../clock";
import {
  LabInternalError,
  LabIsolationError,
  LabNotFoundError,
  LabValidationError,
} from "../errors";

// ---------------------------------------------------------------------------
// Typed outcome records (domain decisions — never thrown)
// ---------------------------------------------------------------------------

/** Why a domain/task selection was refused. */
export type DomainSelectionRefusalReason = "unknown-domain" | "lab-archived";

export interface DomainSelectionRefused {
  outcome: "refused";
  reason: DomainSelectionRefusalReason;
  message: string;
}

export interface DomainSelectionSelected {
  outcome: "selected";
  lab: UserLab;
}

export type DomainSelectionOutcome = DomainSelectionSelected | DomainSelectionRefused;

/** Why a source-data selection was refused. */
export type SourceSelectionRefusalReason = "missing-source-basis" | "lab-archived";

export interface SourceSelectionRefused {
  outcome: "refused";
  reason: SourceSelectionRefusalReason;
  message: string;
  unknownRefs: string[];
  unverifiedRefs: string[];
}

export interface SourceSelectionSelected {
  outcome: "selected";
  lab: UserLab;
  resolved: readonly SourceDataRecord[];
}

export type SourceSelectionOutcome = SourceSelectionSelected | SourceSelectionRefused;

/** Why a budget could not be set. */
export type BudgetRefusalReason = "lab-archived";

export interface BudgetRefused {
  outcome: "refused";
  reason: BudgetRefusalReason;
  message: string;
}

export interface BudgetSet {
  outcome: "set";
  lab: UserLab;
}

export type BudgetOutcome = BudgetSet | BudgetRefused;

/** Why a run request was refused (the typed-refusal paths REL-020 demands). */
export type LabRunRefusalReason =
  "lab-not-ready" | "missing-source-basis" | "budget-exceeded" | "lab-archived";

export interface LabRunRefused {
  outcome: "refused";
  reason: LabRunRefusalReason;
  message: string;
  /** Present iff reason is `lab-not-ready`: the missing configuration pieces. */
  missingPieces: string[];
  /** Present iff reason is `missing-source-basis` (re-checked at run time). */
  unknownRefs: string[];
  unverifiedRefs: string[];
}

export interface LabRunRequested {
  outcome: "requested";
  run: LabRunRecord;
  candidates: readonly LabCandidate[];
}

export type LabRunOutcome = LabRunRequested | LabRunRefused;

/** Why a candidate revision was refused. */
export type RevisionRefusalReason = "lab-archived" | "empty-revision";

export interface RevisionRefused {
  outcome: "refused";
  reason: RevisionRefusalReason;
  message: string;
}

export interface RevisionMade {
  outcome: "revised";
  candidate: LabCandidate;
}

export type RevisionOutcome = RevisionMade | RevisionRefused;

/** The run-request input (validated at the boundary). */
export interface LabRunRequestInput {
  purpose: RunPurpose;
  estimatedCostUsd: number;
  configuration?: LabRunConfiguration | null;
}

const LabRunRequestInputSchema = z.strictObject({
  purpose: z.enum(["simulation", "search"]),
  estimatedCostUsd: z.number().finite().positive(),
  configuration: LabRunConfigurationSchema.nullish(),
});

const CandidateRevisionSchema = z.strictObject({
  definition: CandidateDefinitionDraftSchema.optional(),
  evidence: CandidateEvidenceSchema.optional(),
  lineageAdditions: z.array(z.string().min(1)).optional(),
  rightsRequirements: z
    .array(
      z.strictObject({
        requirementId: z.string().min(1),
        description: z.string().min(1),
        scope: z.string().min(1).optional(),
      }),
    )
    .optional(),
});

const SourceSelectionInputSchema = z.strictObject({
  refs: z.array(z.string().min(1)).min(1),
});

const DomainSelectionInputSchema = z.strictObject({
  domainPackId: z.string().min(1),
  task: z.string().min(1),
});

// ---------------------------------------------------------------------------
// The store
// ---------------------------------------------------------------------------

/** Options for {@link createUserLabs}. */
export interface UserLabsOptions {
  /** Injected clock (deterministic default — never `Date.now`). */
  clock?: () => number;
  /** The selectable domain packs (REL-A6 step 2's catalog). */
  domainCatalog: DomainCatalog;
  /** The historical-corpus seam (source-data resolution + rights basis). */
  sourceData: SourceDataPort;
  /** The durable lab-runtime seam (scripted in tests). */
  runPort: LabRunPort;
  /** Injectable id sources (deterministic sequential defaults). */
  labIds?: IdSource;
  runIds?: IdSource;
  candidateIds?: IdSource;
}

/** The user-lab store port (labs, runs, candidates — all tenant-scoped). */
export interface UserLabs {
  // labs
  createLab(caller: TenantRef, input: NewLabInput): Promise<UserLab>;
  getLab(caller: TenantRef, labId: string): Promise<UserLab>;
  listLabs(caller: TenantRef): Promise<UserLab[]>;
  chooseDomainAndTask(
    caller: TenantRef,
    labId: string,
    selection: LabSelection,
  ): Promise<DomainSelectionOutcome>;
  selectSourceData(
    caller: TenantRef,
    labId: string,
    refs: readonly string[],
  ): Promise<SourceSelectionOutcome>;
  setBudget(caller: TenantRef, labId: string, budget: LabBudget): Promise<BudgetOutcome>;
  archiveLab(caller: TenantRef, labId: string): Promise<UserLab>;

  // runs
  requestRun(caller: TenantRef, labId: string, request: LabRunRequestInput): Promise<LabRunOutcome>;
  getRun(caller: TenantRef, runId: string): Promise<LabRunRecord>;
  listRuns(caller: TenantRef, labId: string): Promise<LabRunRecord[]>;

  // candidates (the private-by-default store)
  getCandidate(caller: TenantRef, candidateId: string): Promise<LabCandidate>;
  getCandidateVersion(
    caller: TenantRef,
    candidateId: string,
    version: number,
  ): Promise<LabCandidate>;
  listCandidates(caller: TenantRef, labId: string): Promise<LabCandidate[]>;
  reviseCandidate(
    caller: TenantRef,
    candidateId: string,
    revision: CandidateRevision,
  ): Promise<RevisionOutcome>;
}

/** Builds the in-memory user-lab store. */
export function createUserLabs(options: UserLabsOptions): UserLabs {
  const clock = options.clock ?? createUserLabsDefaultClock();
  const labIds = options.labIds ?? createSequentialIdSource("lab");
  const runIds = options.runIds ?? createSequentialIdSource("run");
  const candidateIds = options.candidateIds ?? createSequentialIdSource("cand");
  /** labId -> the lab record (replaced immutably on every update). */
  const labs = new Map<string, UserLab>();
  /** runId -> the run record (append-only history). */
  const runs = new Map<string, LabRunRecord>();
  /** candidateId -> all versions, oldest first (registry precedent). */
  const candidates = new Map<string, LabCandidate[]>();
  /** The domain catalog the selection gate checks against. */
  const domainCatalog: DomainCatalog = options.domainCatalog;
  const sourceData: SourceDataPort = options.sourceData;
  const runPort: LabRunPort = options.runPort;

  // -- shared guards -------------------------------------------------------

  function zodIssues(error: z.ZodError): unknown[] {
    return error.issues.map((issue) => ({
      path: issue.path.map(String).join("."),
      message: issue.message,
    }));
  }

  function labOf(labId: string): UserLab {
    const lab = labs.get(labId);
    if (lab === undefined) {
      throw new LabNotFoundError("lab not found", { labId });
    }
    return lab;
  }

  function ownLab(caller: TenantRef, labId: string): UserLab {
    const lab = labOf(labId);
    if (lab.owner.tenantId !== caller.tenantId) {
      throw new LabIsolationError(
        `tenant '${caller.tenantId}' may not access lab '${labId}' owned by tenant ` +
          `'${lab.owner.tenantId}' — tenant isolation is a hard boundary`,
        {
          attemptingTenantId: caller.tenantId,
          owningTenantId: lab.owner.tenantId,
          resourceType: "lab",
          resourceId: labId,
        },
      );
    }
    return lab;
  }

  function versionsOf(candidateId: string): LabCandidate[] {
    const versions = candidates.get(candidateId);
    if (versions === undefined) {
      throw new LabNotFoundError("candidate not found", { candidateId });
    }
    return versions;
  }

  function latestOf(candidateId: string): LabCandidate {
    const versions = versionsOf(candidateId);
    const latest = versions[versions.length - 1];
    if (latest === undefined) {
      throw new LabInternalError("candidate store invariant broken: empty version list", {
        candidateId,
      });
    }
    return latest;
  }

  function ownCandidate(caller: TenantRef, candidateId: string): LabCandidate {
    const candidate = latestOf(candidateId);
    if (candidate.owner.tenantId !== caller.tenantId) {
      throw new LabIsolationError(
        `tenant '${caller.tenantId}' may not read candidate '${candidateId}' owned by tenant ` +
          `'${candidate.owner.tenantId}' — lab candidates are private to their tenant and become ` +
          `visible outside it only through the publish operation (REL-022)`,
        {
          attemptingTenantId: caller.tenantId,
          owningTenantId: candidate.owner.tenantId,
          resourceType: "candidate",
          resourceId: candidateId,
        },
      );
    }
    return candidate;
  }

  function replaceLab(lab: UserLab, next: UserLab): UserLab {
    labs.set(lab.labId, deepFreeze(next));
    return labs.get(lab.labId) as UserLab;
  }

  // -- the source-data refusal (the fail-closed rights check) --------------

  async function resolveVerifiedSource(refs: readonly string[]): Promise<
    | { ok: true; resolved: SourceDataRecord[] }
    | {
        ok: false;
        unknownRefs: string[];
        unverifiedRefs: string[];
      }
  > {
    const records = await sourceData.resolve(refs);
    const known = new Set(records.map((record) => record.sourceRef));
    const unknownRefs = refs.filter((ref) => !known.has(ref));
    const unverifiedRefs = records
      .filter((record) => record.rightsBasis.basisType === "unverified")
      .map((record) => record.sourceRef);
    if (unknownRefs.length > 0 || unverifiedRefs.length > 0) {
      return { ok: false, unknownRefs, unverifiedRefs };
    }
    return { ok: true, resolved: records };
  }

  function missingSourceMessage(unknownRefs: string[], unverifiedRefs: string[]): string {
    const parts: string[] = [];
    if (unknownRefs.length > 0) {
      parts.push(`unknown source ref(s): ${unknownRefs.join(", ")}`);
    }
    if (unverifiedRefs.length > 0) {
      parts.push(
        `source ref(s) with an unverified rights basis: ${unverifiedRefs.join(", ")}` +
          ` (a public URL alone never proves transformation rights — ADR-013 #7)`,
      );
    }
    return `source-data basis is missing or unproven — ${parts.join("; ")}`;
  }

  // -- the store ------------------------------------------------------------

  return {
    async createLab(caller, input) {
      requireTenantRef(caller);
      const parsed = NewLabInputSchema.safeParse(input);
      if (!parsed.success) {
        throw new LabValidationError("lab creation input is invalid", zodIssues(parsed.error));
      }
      const now = toIsoUtc(clock());
      const lab = deepFreeze({
        labId: labIds.nextId(),
        owner: { ...caller },
        name: parsed.data.name,
        status: "active",
        selection: null,
        sourceDataRefs: [],
        budget: null,
        spentUsd: 0,
        createdAt: now,
        updatedAt: now,
      } satisfies UserLab);
      labs.set(lab.labId, lab);
      return lab;
    },

    async getLab(caller, labId) {
      requireTenantRef(caller);
      return ownLab(caller, labId);
    },

    async listLabs(caller) {
      requireTenantRef(caller);
      const own: UserLab[] = [];
      for (const lab of labs.values()) {
        if (lab.owner.tenantId === caller.tenantId) own.push(lab);
      }
      return own;
    },

    async chooseDomainAndTask(caller, labId, selection) {
      requireTenantRef(caller);
      const lab = ownLab(caller, labId);
      const parsed = DomainSelectionInputSchema.safeParse(selection);
      if (!parsed.success) {
        throw new LabValidationError("domain/task selection is invalid", zodIssues(parsed.error));
      }
      if (lab.status === "archived") {
        return {
          outcome: "refused",
          reason: "lab-archived",
          message: `lab '${labId}' is archived — configuration changes are closed`,
        } satisfies DomainSelectionRefused;
      }
      const entry = domainCatalog.find((item) => item.domainPackId === parsed.data.domainPackId);
      if (entry === undefined || !entry.tasks.includes(parsed.data.task)) {
        const known = domainCatalog
          .map((item) => `${item.domainPackId}(${item.tasks.join("|")})`)
          .join(", ");
        return {
          outcome: "refused",
          reason: "unknown-domain",
          message:
            `unknown domain/task selection '${parsed.data.domainPackId}' / '${parsed.data.task}' — ` +
            `selectable catalog: ${known.length > 0 ? known : "(empty)"}`,
        } satisfies DomainSelectionRefused;
      }
      const next = replaceLab(lab, {
        ...lab,
        selection: { ...parsed.data },
        updatedAt: toIsoUtc(clock()),
      });
      return { outcome: "selected", lab: next } satisfies DomainSelectionSelected;
    },

    async selectSourceData(caller, labId, refs) {
      requireTenantRef(caller);
      const lab = ownLab(caller, labId);
      const parsed = SourceSelectionInputSchema.safeParse({ refs });
      if (!parsed.success) {
        throw new LabValidationError("source-data selection is invalid", zodIssues(parsed.error));
      }
      if (lab.status === "archived") {
        return {
          outcome: "refused",
          reason: "lab-archived",
          message: `lab '${labId}' is archived — configuration changes are closed`,
          unknownRefs: [],
          unverifiedRefs: [],
        } satisfies SourceSelectionRefused;
      }
      const resolved = await resolveVerifiedSource(parsed.data.refs);
      if (!resolved.ok) {
        return {
          outcome: "refused",
          reason: "missing-source-basis",
          message: missingSourceMessage(resolved.unknownRefs, resolved.unverifiedRefs),
          unknownRefs: resolved.unknownRefs,
          unverifiedRefs: resolved.unverifiedRefs,
        } satisfies SourceSelectionRefused;
      }
      const deduped = [...new Set(parsed.data.refs)];
      const next = replaceLab(lab, {
        ...lab,
        sourceDataRefs: deduped,
        updatedAt: toIsoUtc(clock()),
      });
      return {
        outcome: "selected",
        lab: next,
        resolved: resolved.resolved,
      } satisfies SourceSelectionSelected;
    },

    async setBudget(caller, labId, budget) {
      requireTenantRef(caller);
      const lab = ownLab(caller, labId);
      const parsed = LabBudgetSchema.safeParse(budget);
      if (!parsed.success) {
        throw new LabValidationError("lab budget is invalid", zodIssues(parsed.error));
      }
      if (lab.status === "archived") {
        return {
          outcome: "refused",
          reason: "lab-archived",
          message: `lab '${labId}' is archived — configuration changes are closed`,
        } satisfies BudgetRefused;
      }
      const next = replaceLab(lab, {
        ...lab,
        budget: { ...parsed.data },
        updatedAt: toIsoUtc(clock()),
      });
      return { outcome: "set", lab: next } satisfies BudgetSet;
    },

    async archiveLab(caller, labId) {
      requireTenantRef(caller);
      const lab = ownLab(caller, labId);
      if (lab.status === "archived") return lab;
      return replaceLab(lab, { ...lab, status: "archived", updatedAt: toIsoUtc(clock()) });
    },

    async requestRun(caller, labId, request) {
      requireTenantRef(caller);
      const lab = ownLab(caller, labId);
      const parsedRequest = LabRunRequestInputSchema.safeParse(request);
      if (!parsedRequest.success) {
        throw new LabValidationError("lab run request is invalid", zodIssues(parsedRequest.error));
      }
      if (lab.status === "archived") {
        return {
          outcome: "refused",
          reason: "lab-archived",
          message: `lab '${labId}' is archived — run requests are closed`,
          missingPieces: [],
          unknownRefs: [],
          unverifiedRefs: [],
        } satisfies LabRunRefused;
      }
      const missingPieces: string[] = [];
      if (lab.selection === null) missingPieces.push("domain/task selection");
      if (lab.sourceDataRefs.length === 0) missingPieces.push("source-data selection");
      if (lab.budget === null) missingPieces.push("budget");
      if (missingPieces.length > 0) {
        return {
          outcome: "refused",
          reason: "lab-not-ready",
          message: `lab '${labId}' is not ready to run — missing: ${missingPieces.join(", ")}`,
          missingPieces,
          unknownRefs: [],
          unverifiedRefs: [],
        } satisfies LabRunRefused;
      }
      // Fail-closed re-check: source basis is re-verified at run time.
      const resolved = await resolveVerifiedSource(lab.sourceDataRefs);
      if (!resolved.ok) {
        return {
          outcome: "refused",
          reason: "missing-source-basis",
          message: `run request refused — ${missingSourceMessage(
            resolved.unknownRefs,
            resolved.unverifiedRefs,
          )}`,
          missingPieces: [],
          unknownRefs: resolved.unknownRefs,
          unverifiedRefs: resolved.unverifiedRefs,
        } satisfies LabRunRefused;
      }
      const budget = lab.budget as LabBudget;
      const remaining = budget.totalUsd - lab.spentUsd;
      if (parsedRequest.data.estimatedCostUsd > remaining) {
        return {
          outcome: "refused",
          reason: "budget-exceeded",
          message:
            `run request refused on budget — requested ${parsedRequest.data.estimatedCostUsd.toFixed(2)} USD ` +
            `against remaining ${remaining.toFixed(2)} USD (spent ${lab.spentUsd.toFixed(2)} of ` +
            `${budget.totalUsd.toFixed(2)} USD)`,
          missingPieces: [],
          unknownRefs: [],
          unverifiedRefs: [],
        } satisfies LabRunRefused;
      }
      const requestedAt = toIsoUtc(clock());
      const runRequest: LabRunRequest = deepFreeze({
        runId: runIds.nextId(),
        labId,
        requestedBy: { ...caller },
        purpose: parsedRequest.data.purpose,
        configuration:
          parsedRequest.data.configuration === undefined ||
          parsedRequest.data.configuration === null
            ? null
            : { ...parsedRequest.data.configuration },
        estimatedCostUsd: parsedRequest.data.estimatedCostUsd,
        selection: { ...lab.selection } as LabSelection,
        sourceData: resolved.resolved.map((record) => ({ ...record })),
        requestedAt,
      });
      const record = await runPort.requestRun(runRequest);
      if (record.runId !== runRequest.runId || record.labId !== labId) {
        throw new LabInternalError("run port violated its contract: echoed ids do not match", {
          expectedRunId: runRequest.runId,
          echoedRunId: record.runId,
          labId,
        });
      }
      // Ingest the run's candidates as PRIVATE, version-1 records.
      const ingested: LabCandidate[] = [];
      for (const [index, payload] of record.candidates.entries()) {
        const parsedPayload = LabRunCandidatePayloadSchema.safeParse(payload);
        if (!parsedPayload.success) {
          throw new LabValidationError(
            `run '${record.runId}' produced a malformed candidate payload at index ${index}`,
            zodIssues(parsedPayload.error),
          );
        }
        const value = parsedPayload.data;
        const candidate = deepFreeze({
          candidateId: candidateIds.nextId(),
          labId,
          owner: { ...caller },
          version: 1,
          visibility: "private",
          definition: value.definition,
          evidence: value.evidence,
          provenance: {
            runId: record.runId,
            sourceRefs: [...lab.sourceDataRefs],
            lineage: [...value.provenance.lineage],
            rightsRequirements: value.provenance.rightsRequirements.map((r) => ({ ...r })),
          },
          createdAt: record.completedAt,
          updatedAt: record.completedAt,
        } satisfies LabCandidate);
        candidates.set(candidate.candidateId, [candidate]);
        ingested.push(candidate);
      }
      const storedRun = deepFreeze({ ...record });
      runs.set(storedRun.runId, storedRun);
      replaceLab(lab, {
        ...lab,
        spentUsd: lab.spentUsd + record.costUsd,
        updatedAt: toIsoUtc(clock()),
      });
      return {
        outcome: "requested",
        run: storedRun,
        candidates: ingested,
      } satisfies LabRunRequested;
    },

    async getRun(caller, runId) {
      requireTenantRef(caller);
      const run = runs.get(runId);
      if (run === undefined) {
        throw new LabNotFoundError("run not found", { runId });
      }
      ownLab(caller, run.labId);
      return run;
    },

    async listRuns(caller, labId) {
      requireTenantRef(caller);
      ownLab(caller, labId);
      const own: LabRunRecord[] = [];
      for (const run of runs.values()) {
        if (run.labId === labId) own.push(run);
      }
      return own;
    },

    async getCandidate(caller, candidateId) {
      requireTenantRef(caller);
      return ownCandidate(caller, candidateId);
    },

    async getCandidateVersion(caller, candidateId, version) {
      requireTenantRef(caller);
      ownCandidate(caller, candidateId);
      const found = versionsOf(candidateId).find((c) => c.version === version);
      if (found === undefined) {
        throw new LabNotFoundError("candidate version not found", { candidateId, version });
      }
      return found;
    },

    async listCandidates(caller, labId) {
      requireTenantRef(caller);
      ownLab(caller, labId);
      const latest: LabCandidate[] = [];
      for (const versions of candidates.values()) {
        const candidate = versions[versions.length - 1];
        if (candidate === undefined) {
          throw new LabInternalError("candidate store invariant broken: empty version list");
        }
        if (candidate.labId === labId) latest.push(candidate);
      }
      return latest;
    },

    async reviseCandidate(caller, candidateId, revision) {
      requireTenantRef(caller);
      const current = ownCandidate(caller, candidateId);
      const parsed = CandidateRevisionSchema.safeParse(revision);
      if (!parsed.success) {
        throw new LabValidationError("candidate revision is invalid", zodIssues(parsed.error));
      }
      const lab = labOf(current.labId);
      if (lab.status === "archived") {
        return {
          outcome: "refused",
          reason: "lab-archived",
          message: `lab '${current.labId}' is archived — candidate revisions are closed`,
        } satisfies RevisionRefused;
      }
      const parts = parsed.data;
      const empty =
        parts.definition === undefined &&
        parts.evidence === undefined &&
        parts.lineageAdditions === undefined &&
        parts.rightsRequirements === undefined;
      if (empty) {
        return {
          outcome: "refused",
          reason: "empty-revision",
          message: `candidate revision refused — nothing to revise on '${candidateId}'`,
        } satisfies RevisionRefused;
      }
      const next: LabCandidate = {
        ...current,
        version: current.version + 1,
        definition:
          parts.definition === undefined
            ? current.definition
            : { ...current.definition, ...parts.definition },
        evidence:
          parts.evidence === undefined
            ? current.evidence
            : { ...current.evidence, ...parts.evidence },
        provenance: {
          runId: current.provenance.runId,
          sourceRefs: current.provenance.sourceRefs,
          lineage: [...current.provenance.lineage, ...(parts.lineageAdditions ?? [])],
          rightsRequirements: parts.rightsRequirements ?? current.provenance.rightsRequirements,
        },
        updatedAt: toIsoUtc(clock()),
      };
      const frozen = deepFreeze(next);
      versionsOf(candidateId).push(frozen);
      return { outcome: "revised", candidate: frozen } satisfies RevisionMade;
    },
  };
}
