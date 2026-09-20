/**
 * THE COMPUTE CENTER SERVICE (J005) — the product-plane connect/verify/
 * disconnect/status lifecycle over the REAL `@sporta/connection-center`
 * ConnectionCenter (R406), whose provider plane is built from the REAL
 * `@sporta/compute-provider-adapters` (R402-R405) by the composition root.
 *
 * ## The journey-3 accept criteria, restated
 *
 * - a FIRST-CLASS, persistent destination (the routes + the page — no
 *   guessing URLs), reachable from the account menu and the Create Studio's
 *   compute step;
 * - the connect/verify/disconnect lifecycle with TYPED provider
 *   failure/quota states (the adapters' own honest vocabularies — never
 *   invented states), the Sporta-compute vs BYOC distinction (the R408
 *   execution-ownership vocabulary over the operator's declared facts),
 *   and goal-oriented selection language (the compute-broker.md UX goals,
 *   mapped onto the REAL selection seam — no infrastructure jargon needed
 *   to choose);
 * - NO master passwords (the package's fail-closed refusal posture stays
 *   intact — the typed MasterPasswordRefusalError + the audit entry ride
 *   through untouched);
 * - provider-specific behavior stays behind the adapters (this service
 *   knows provider IDS as data only);
 * - honest unavailable/degraded states when a provider is unreachable
 *   (verify maps the adapter's honest four-state answer verbatim; an
 *   unreachable provider proves NOTHING about a credential — the record
 *   stays `connected-unverified` with the real reason).
 *
 * ## Account isolation
 *
 * Every operation is scoped by the authenticated account (the W701 control
 * gate precedent): the caller's token resolves the account; the center
 * keys every record, audit entry and runtime binding by that account id.
 */
import {
  ConnectionCenter,
  isMasterPasswordRefusalError,
} from "@sporta/connection-center";
import type {
  ConnectionRecord,
  ConnectionStatusReport,
  CredentialPresentation,
} from "@sporta/connection-center";
import type { Account } from "@sporta/identity";
import type { SportaServer } from "./composition";

// ---------------------------------------------------------------------------
// The wire documents (goal-oriented, provider-neutral)
// ---------------------------------------------------------------------------

/** One provider's product-facing line in the Compute Center status. */
export interface ComputeCenterProviderStatus {
  /** The provider identity (DATA — the connection plane's entry id). */
  providerId: string;
  /** The connection posture (the center's closed vocabulary, verbatim). */
  posture: ConnectionStatusReport["posture"];
  /** The abstract descriptor summary (capabilities as DATA, no jargon). */
  descriptor: ConnectionStatusReport["descriptor"];
  /** The scoped credential kinds this provider's adapter accepts. */
  supportedCredentialKinds: string[];
  /** The connection record (present when connected). */
  connection: ConnectionRecord | null;
  /**
   * The provider's execution zone (the operator's DATA declaration): where
   * jobs would run — the Sporta-vs-BYOC distinction's raw fact.
   */
  executionZone: "user-controlled" | "provider-cloud" | "sporta-managed";
  /** Goal-oriented, jargon-free framing for THIS provider's plane. */
  goalFraming: string;
}

/** The destination's full status document (GET /api/account/compute). */
export interface ComputeCenterStatus {
  /** The deployment's Sporta-managed plane (the composition's own compute). */
  sportaPlane: {
    /** Whether a Sporta-managed compute plane is configured at all. */
    configured: boolean;
    /** The plane's provider selection (env-driven, honest when null). */
    provider: string | null;
    /** The registered provider id + the operator's declared facts. */
    selection: {
      providerId: string;
      privacyZone: string;
      capabilityClasses: string[];
    } | null;
    /** The goal-oriented explanation of the Sporta-compute option. */
    framing: string;
  };
  /** Every provider in the connection plane (BYOC), posture-honest. */
  providers: ComputeCenterProviderStatus[];
  /** The goal-oriented selection language (the product's UX goals). */
  goals: ComputeSelectionGoal[];
  /** The honest master-password policy line (the refusal posture). */
  credentialPolicy: {
    acceptedKinds: string[];
    refusedKinds: string[];
    refusalNote: string;
  };
  /** The caller's daily compute allowance states (the W919 quotas). */
  quotas: unknown;
  /** The plane's metered usage totals (null = not measured, never a fake 0). */
  usage: unknown;
}

/** One goal-oriented selection frame (no infrastructure jargon). */
export interface ComputeSelectionGoal {
  /** The goal id (stable). */
  id: string;
  /** The user-facing question this goal answers. */
  title: string;
  /** The plain-language description. */
  description: string;
  /** Where this goal is exercised (the honest destination). */
  where: string;
}

/** The connect answer: the record, or the honest typed refusal. */
export type ComputeConnectAnswer =
  | { outcome: "connected"; record: ConnectionRecord }
  | { outcome: "duplicate"; record: ConnectionRecord }
  | { outcome: "refused-master-password"; message: string; presentedKind: string };

// ---------------------------------------------------------------------------
// The service
// ---------------------------------------------------------------------------

/** Options for {@link ComputeCenterService}. */
export interface ComputeCenterServiceOptions {
  /** The server getter (the lazy-composition convention). */
  getServer: () => SportaServer;
  /** The composed connection center (the composition root wires the plane). */
  center: ConnectionCenter;
  /** The provider plane's execution-zone declarations (operator DATA). */
  executionZones: ReadonlyMap<string, ComputeCenterProviderStatus["executionZone"]>;
}

/** The goal-oriented frames (product DATA — the compute-broker.md UX). */
const SELECTION_GOALS: readonly ComputeSelectionGoal[] = [
  {
    id: "use-sporta-compute",
    title: "Just render it — Sporta's compute",
    description:
      "The simplest start: the platform runs your renders on the compute it manages, inside your plan's allowance. No provider account needed.",
    where: "Choose \u201cLet the platform choose\u201d in the Create Studio's compute step.",
  },
  {
    id: "use-my-compute",
    title: "Use my own compute (BYOC)",
    description:
      "Connect your own provider account once here; your renders can then run on the compute you already pay for, under your provider's own limits.",
    where: "Connect a provider below, then pick it in the Create Studio's compute step.",
  },
  {
    id: "fastest-result",
    title: "Fastest result",
    description:
      "When you want the render back sooner, the selection director ranks providers by quoted queue time and explains every choice it makes.",
    where: "The Create Studio's compute step shows the auditable selection explanation.",
  },
  {
    id: "stay-private",
    title: "Keep execution where I control it",
    description:
      "For private footage, choose compute whose execution zone you control (your own machine or your provider account) — never a silent substitution.",
    where: "Connect a self-hosted or provider account below; the selection respects the zone.",
  },
];

/**
 * The Compute Center service (J005). One instance per composition; every
 * operation is account-scoped through the authenticated token.
 */
export class ComputeCenterService {
  private readonly getServer: () => SportaServer;
  private readonly center: ConnectionCenter;
  private readonly executionZones: ReadonlyMap<string, ComputeCenterProviderStatus["executionZone"]>;

  constructor(options: ComputeCenterServiceOptions) {
    this.getServer = options.getServer;
    this.center = options.center;
    this.executionZones = options.executionZones;
  }

  /** The composed center (for the composition's health/lifecycle surfaces). */
  get connectionCenter(): ConnectionCenter {
    return this.center;
  }

  private async requireAccount(token: string): Promise<Account> {
    const server = this.getServer();
    return server.gate.requireAccount(token);
  }

  /** The goal-oriented zone framing for one provider (jargon-free). */
  private framingOf(providerId: string, zone: ComputeCenterProviderStatus["executionZone"]): string {
    switch (zone) {
      case "user-controlled":
        return "Runs on hardware you control — your own machine, your own rules.";
      case "provider-cloud":
        return `Runs on your ${providerId.replace("provider.", "")} account — the compute you already pay for, under your provider's limits.`;
      case "sporta-managed":
        return "Runs on Sporta-managed infrastructure — covered by your Sporta allowance.";
    }
  }

  /**
   * The destination's status document: the Sporta plane, every BYOC
   * provider's honest posture, the goal frames, the credential policy,
   * and the caller's quota/cost context (the SAME R506 seams the Create
   * Studio's compute step reads — one consistent UX, no second truth).
   */
  async status(token: string): Promise<ComputeCenterStatus> {
    const account = await this.requireAccount(token);
    const server = this.getServer();
    const reports = await this.center.status(account.userId);
    const providers: ComputeCenterProviderStatus[] = reports.map((report) => {
      const zone = this.executionZones.get(report.providerId) ?? "provider-cloud";
      return {
        providerId: report.providerId,
        posture: report.posture,
        descriptor: report.descriptor,
        supportedCredentialKinds: [...report.supportedCredentialKinds],
        connection: report.connection ?? null,
        executionZone: zone,
        goalFraming: this.framingOf(report.providerId, zone),
      };
    });
    // The caller's quota/usage context — the studio's own R506 projection
    // (the REAL seams; `usage` nulls stay nulls, never fabricated zeros).
    const computeStatus = await server.studio.computeStatus(token);
    return {
      sportaPlane: {
        configured: server.compute !== null,
        provider: server.compute?.provider ?? null,
        selection:
          server.selection === null
            ? null
            : {
                providerId: server.selection.providerId,
                privacyZone: server.selection.facts.privacyZone,
                capabilityClasses: [...(server.selection.facts.capabilityClasses ?? [])],
              },
        framing:
          "Sporta compute is the managed option — the platform executes your render jobs on the compute it operates, inside your plan's allowance. It is always available when the platform's compute plane is configured, and the Create Studio's \u201cLet the platform choose\u201d mode uses exactly this plane.",
      },
      providers,
      goals: [...SELECTION_GOALS],
      credentialPolicy: {
        acceptedKinds: ["scoped-api-key", "scoped-token-pair", "oauth-access-token"],
        refusedKinds: ["account-password", "console-password", "master-password"],
        refusalNote:
          "Provider master/console passwords are never accepted — not stored, not forwarded, refused before anything happens and the refusal is recorded in your connection audit trail.",
      },
      quotas: computeStatus.quotas,
      usage: computeStatus.usage,
    };
  }

  /**
   * Connects one provider: the presentation is validated + the password
   * class refused fail-closed (typed, audited) by the center; the answer
   * carries the record or the honest refusal — never a silent anything.
   */
  async connect(
    token: string,
    providerId: string,
    presentation: CredentialPresentation | null,
  ): Promise<ComputeConnectAnswer> {
    const account = await this.requireAccount(token);
    try {
      const record = await this.center.connect(account.userId, providerId, presentation);
      const duplicate = record.history.some((entry) => entry.type === "connect-duplicate");
      return { outcome: duplicate ? "duplicate" : "connected", record };
    } catch (err) {
      if (isMasterPasswordRefusalError(err)) {
        // The typed refusal (fail-closed BEFORE anything is stored) — the
        // honest product answer, never a 500.
        return {
          outcome: "refused-master-password",
          message: err.message,
          presentedKind: err.presentedKind,
        };
      }
      throw err;
    }
  }

  /** Verifies one connection (the adapter's REAL verification call). */
  async verify(token: string, providerId: string): Promise<ConnectionRecord> {
    const account = await this.requireAccount(token);
    return this.center.verify(account.userId, providerId);
  }

  /** Disconnects one connection (typed unknown-connection error rides). */
  async disconnect(token: string, providerId: string): Promise<ConnectionRecord> {
    const account = await this.requireAccount(token);
    return this.center.disconnect(account.userId, providerId);
  }

  /** The account's connection audit trail (the honest history). */
  async audit(token: string, limit = 50): Promise<unknown[]> {
    const account = await this.requireAccount(token);
    const store = this.center.backingStore;
    return store.listAudit(account.userId, limit);
  }
}
