/**
 * THE BOUNDARY TESTS (the package's fail-closed constitution):
 *
 * 1. NO ENVIRONMENT READS in the domain modules (the
 *    `@sporta/compute-provider-adapters` test/boundary precedent — env
 *    resolution belongs to an app composition root, never this package);
 * 2. NO WALL-CLOCK READS in the domain modules (every timestamp comes
 *    from the injected clock — the determinism constitution);
 * 3. NO CREDENTIAL VALUES anywhere: a full product flow's store dump,
 *    status report, audit trail, ledger records, explanations, and
 *    settlement outcomes are scanned for the secret strings;
 * 4. NO PROVIDER NAMES in any contract vocabulary member (the
 *    architecture-lock §9 posture — provider ids are DATA; the closed
 *    vocabularies are scanned for vendor substrings fail-closed).
 */
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { InMemoryComputeBroker } from "@sporta/compute-adapter";
import { ConnectionCenter } from "../src/connections";
import { SelectionDirector } from "../src/selection";
import { UsageLedger } from "../src/ledger";
import { ManagedComputeSeam, ManagedComputeEntitlement } from "../src/managed";
import {
  stubPlaneProvider,
  buildJob,
  buildUsageRecord,
  buildQuoteRequest,
  manualClock,
  TEST_EPOCH_MS,
} from "./helpers";

/** Every .ts file under src/ (the domain surface the constitution covers). */
function srcFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) out.push(...srcFiles(path));
    else if (entry.endsWith(".ts")) out.push(path);
  }
  return out;
}

const SRC = join(import.meta.dir, "..", "src");

describe("boundary — no environment reads in the domain modules", () => {
  test("no src/ module references process.env (env is the composition root's)", () => {
    for (const file of srcFiles(SRC)) {
      const source = readFileSync(file, "utf8");
      expect(source.includes("process.env"), `${file} reads process.env`).toBe(false);
    }
  });

  test("no src/ module reads the wall clock (injected clocks only)", () => {
    const offenders: string[] = [];
    for (const file of srcFiles(SRC)) {
      const source = readFileSync(file, "utf8");
      // The determinism constitution: no Date.now / new Date() in domain
      // code (SqliteEntitlementStore's written_at bookkeeping column is
      // the one documented row-stamp exception — the RECORD payloads all
      // carry the injected clock; the guard below still fails on
      // Date.now, so that module stamps via Date.now ONLY for the
      // non-contract column... it must not: scan catches it here).
      if (/Date\.now\(\)/.test(source) && !file.endsWith("managed.ts")) {
        offenders.push(file);
      }
      if (/\bnew Date\(/.test(source)) offenders.push(file);
    }
    // managed.ts's Date.now is forbidden too — let the test fail loudly if
    // it is present anywhere; the entitlement row-stamp uses the injected
    // clock (fixed in-source: no Date.now anywhere).
    expect(
      srcFiles(SRC).filter((file) => readFileSync(file, "utf8").includes("Date.now()")),
    ).toEqual([]);
    expect(offenders).toEqual([]);
  });
});

describe("boundary — no credential VALUE ever persists or reports", () => {
  test("a full product flow: store, status, audit, ledger, explanation, settlement — scanned", async () => {
    const clock = manualClock();
    const { provider, observations } = stubPlaneProvider({
      providerId: "provider.stub",
      nowMs: clock,
    });
    const center = new ConnectionCenter({ providers: [provider], nowMs: clock });
    await center.connect("account-1", "provider.stub", {
      kind: "scoped-api-key",
      apiKey: "sk-boundary-SECRET-value-9",
    });
    observations.lastAdapter!.setStatus({ state: "verified", detail: "HTTP 200" });
    await center.verify("account-1", "provider.stub");

    // R407 over the account's broker.
    const broker = new InMemoryComputeBroker({
      providers: center.connectedAdapters("account-1"),
      nowMs: clock,
    });
    const director = new SelectionDirector({
      broker,
      facts: new Map([
        ["provider.stub", { providerId: "provider.stub", privacyZone: "provider-cloud" as const }],
      ]),
      nowMs: clock,
    });
    const { explanation } = await director.explain(buildQuoteRequest(), { mode: "sporta-auto" });

    // R408 + R409 flows.
    const ledger = new UsageLedger({ nowMs: clock });
    await ledger.record("account-1", "provider.stub", "user-owned-provider", buildUsageRecord());
    const seam = new ManagedComputeSeam({ broker, nowMs: clock });
    await seam.grantEntitlement(
      ManagedComputeEntitlement.parse({
        schemaVersion: "1.0",
        accountId: "account-1",
        planId: "plan.boundary",
        periodStartMs: TEST_EPOCH_MS,
        periodEndMs: TEST_EPOCH_MS + 3_600_000,
        allowances: [{ unitId: "jobs", limit: 5 }],
        maxConcurrentJobs: 2,
      }),
    );
    await seam.admit("account-1", buildJob({ jobId: "boundary-job-1" }));
    const settlement = await seam.settle(
      "account-1",
      "provider.stub",
      buildUsageRecord({ jobId: "boundary-job-1" }),
    );

    // The scan: every serialized product surface must be free of the VALUE.
    const secret = "sk-boundary-SECRET-value-9";
    const surfaces = [
      JSON.stringify(await center.status("account-1")),
      JSON.stringify(await center.backingStore.listAudit("account-1")),
      JSON.stringify(await center.backingStore.listRecords("account-1")),
      JSON.stringify(await ledger.summary("account-1")),
      JSON.stringify(await ledger.history("account-1")),
      JSON.stringify(explanation),
      JSON.stringify(settlement),
      JSON.stringify(await seam.status("account-1")),
    ];
    for (const surface of surfaces) {
      expect(surface.includes(secret)).toBe(false);
    }
  });
});

describe("boundary — no provider names in any contract vocabulary", () => {
  test("every exported closed vocabulary is scanned for vendor substrings", async () => {
    const index = await import("../src/index");
    const vocabularies: Record<string, readonly string[]> = {
      acceptedKinds: index.ACCEPTED_CREDENTIAL_KINDS,
      masterKinds: index.MASTER_PASSWORD_KINDS,
      presentationKinds: index.CREDENTIAL_PRESENTATION_KINDS,
      auditOutcomes: index.CONNECTION_AUDIT_OUTCOMES,
      connectionStates: index.CONNECTION_STATES,
      eventTypes: index.CONNECTION_EVENT_TYPES,
      postures: index.CONNECTION_POSTURES,
      privacyPostures: index.SELECTION_PRIVACY_POSTURES,
      factZones: index.PROVIDER_FACT_ZONES,
      exclusionAxes: index.SELECTION_EXCLUSION_AXES,
      directiveModes: index.SELECTION_DIRECTIVE_MODES,
      ownerships: index.EXECUTION_OWNERSHIPS,
      refusalBounds: index.MANAGED_REFUSAL_BOUNDS,
    };
    const vendors = ["modal", "lightning", "runpod", "aws", "azure", "gcp", "google"];
    for (const [name, members] of Object.entries(vocabularies)) {
      for (const member of members) {
        for (const vendor of vendors) {
          expect(
            member.toLowerCase().includes(vendor),
            `vocabulary '${name}' member '${member}' contains the vendor substring '${vendor}'`,
          ).toBe(false);
        }
      }
    }
  });
});
