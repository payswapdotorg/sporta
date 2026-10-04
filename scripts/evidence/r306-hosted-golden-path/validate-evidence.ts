/**
 * R306 HOSTED GOLDEN PATH — THE FAIL-CLOSED VALIDATOR (DEVELOPMENT-TIME
 * EVIDENCE, not a test): machine-checks the walk record `hosted-golden-path.json`
 * — every claim the verdict makes is cross-verified against the record's own
 * measured steps; a tampered/laundered record is REFUSED with the check named
 * (never a silent pass). Negative variants are exercised by
 * `bun run scripts/evidence/r306-hosted-golden-path/validate-evidence.ts --negative`
 * which flips one field per variant and asserts the validator refuses each.
 *
 * Checks (the honest posture — the record must agree with ITSELF):
 *  1. the boot step's marker is exactly the deployed `r306-encode-seam-deploy-1`
 *     and BOTH worker descriptors answered 200 (the plane the walk claims);
 *  2. leg A: the Original's playback is integrity-verified (sha-matched, the
 *     206 Range slice) — the verdict's claim;
 *  3. leg B: every derived kind's outcome is EITHER produced+integrity-verified
 *     OR refused with a TYPED refusal present verbatim — never neither, never
 *     both, and never a laundered flag on a refusal (the honest split is
 *     exhaustive and flag-consistent);
 *  4. the three render jobs' terminal states on BOTH planes agree (a job that
 *     succeeded on both planes may still refuse at ingest — the typed state IS
 *     the record);
 *  5. the worker-side accounting's delta is self-consistent (after - before ===
 *     delta);
 *  6. the verdict's counts (produced/refused) match the playback legs' own
 *     fields — a laundered verdict is refused.
 */
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const HERE = dirname(new URL(import.meta.url).pathname);
const RECORD = resolve(join(HERE, "hosted-golden-path.json"));

/** One measured check with its verdict and the detail the record carried. */
interface Check {
  name: string;
  ok: boolean;
  detail?: string;
}

type Obj = Record<string, unknown>;

/** Narrows an unknown value to an object (never throws — a wrong shape fails checks). */
const asObj = (v: unknown): Obj => (v !== null && typeof v === "object" ? (v as Obj) : {});
/** Narrows an unknown value to an array. */
const asArr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
/** The honest number (a wrong shape reads -1 — the check fails, never crashes). */
const num = (v: unknown): number => (typeof v === "number" ? v : -1);
/** The honest string (a wrong shape reads ""). */
const str = (v: unknown): string => (typeof v === "string" ? v : "");

function validate(rec: unknown): Check[] {
  const checks: Check[] = [];
  const r = asObj(rec);
  const steps = asObj(r.steps);
  const boot = asObj(steps.boot);
  const watch = asObj(steps.watch);
  const j = asObj(steps.j004OneSubmission);
  const playback = asObj(j.playback);
  const verdict = str(r.verdict);
  const accounting = asObj(steps.workerAccounting);

  // 1. the plane
  const marker = str(boot.deployMarker ?? boot.marker);
  checks.push({
    name: "the boot marker is the deployed r306 marker",
    ok: marker === "r306-encode-seam-deploy-1",
    detail: `marker=${marker}`,
  });
  const mediaWorker = asObj(boot.mediaWorker);
  const computeWorker = asObj(boot.computeWorker);
  checks.push({
    name: "both worker descriptors answered 200",
    ok: num(mediaWorker.descriptorHttpStatusCode) === 200 && num(computeWorker.descriptorHttpStatusCode) === 200,
  });

  // 2. leg A
  const full = asObj(watch.full);
  const range = asObj(watch.range);
  checks.push({
    name: "the Original's playback integrity-verified",
    ok: full.integrityVerified === true && num(range.httpStatusCode) === 206,
    detail: `integrity=${String(full.integrityVerified)} range=${String(num(range.httpStatusCode))}`,
  });

  // 3. leg B — the honest split is exhaustive and flag-consistent
  const kinds = ["original", "tactical", "three-d-game", "anime-npr"];
  for (const kind of kinds) {
    const leg = asObj(playback[kind]);
    if (playback[kind] === undefined) {
      checks.push({ name: `the ${kind} kind is recorded`, ok: false });
      continue;
    }
    const produced = leg.produced === true;
    const refusal = str(leg.typedRefusal);
    // A produced kind must be integrity-verified; a REFUSED kind must NOT
    // carry a verified flag at all (a refusal with a "verified" integrity
    // mark is a laundered record — the flag belongs to produced kinds only).
    const good = produced
      ? leg.integrityVerified === true
      : refusal.length > 0 && leg.produced === false && leg.integrityVerified === undefined;
    checks.push({
      name: `the ${kind} kind: produced+verified OR typed-refused (exhaustive, no laundered flags)`,
      ok: good,
      detail: produced ? `integrity=${String(leg.integrityVerified)}` : `refusal=${refusal.slice(0, 90)}`,
    });
  }

  // 4. the jobs' terminal states agree on BOTH planes
  const jobRecords = asArr(j.jobRecords);
  for (const [i, jobRecRaw] of jobRecords.entries()) {
    const jobRec = asObj(jobRecRaw);
    const completion = asObj(jobRec.completion);
    const workerRecord = asObj(jobRec.computeWorkerRecord);
    const ok = str(completion.status) === "succeeded" && str(workerRecord.resultStatus) === "succeeded";
    checks.push({
      name: `jobRecord[${i}] terminal-succeeded on BOTH planes`,
      ok,
      detail: `completion=${str(completion.status)} worker=${str(workerRecord.resultStatus)}`,
    });
  }

  // 5. the accounting's arithmetic
  const b = asObj(accounting.before);
  const a = asObj(accounting.after);
  const d = asObj(accounting.delta);
  const arithOk =
    num(a.jobsDispatched) - num(b.jobsDispatched) === num(d.dispatched) &&
    num(a.succeeded) - num(b.succeeded) === num(d.succeeded) &&
    num(a.failed) - num(b.failed) === num(d.failed);
  checks.push({
    name: "the worker accounting's delta arithmetic (after-before === delta)",
    ok: arithOk,
    detail: `${num(a.jobsDispatched)}-${num(b.jobsDispatched)}===${num(d.dispatched)} etc.`,
  });

  // 6. the verdict's counts match the legs (a laundered verdict refused)
  const producedCount = kinds.filter((k) => asObj(playback[k]).produced === true).length;
  const refusedCount = kinds.filter((k) => asObj(playback[k]).produced !== true).length;
  const verdictCountsOk =
    verdict.includes(`${producedCount}/4 realities produced`) && verdict.includes(`${refusedCount} refused`);
  checks.push({
    name: "the verdict's counts match the playback legs",
    ok: verdictCountsOk,
    detail: `verdict says …${producedCount}/4 produced, ${refusedCount} refused; legs measure the same`,
  });

  return checks;
}

function main() {
  const negative = process.argv.includes("--negative");
  const raw = readFileSync(RECORD, "utf8");
  const rec: unknown = JSON.parse(raw);

  if (negative) {
    // One tampered field per variant; each MUST be refused (the check named).
    const variants: Array<{ name: string; mutate: (x: Obj) => void }> = [
      {
        name: "laundered verdict counts (says 4/4 produced)",
        mutate: (x) => {
          x.verdict = str(x.verdict).replace("1/4 realities produced", "4/4 realities produced");
        },
      },
      {
        name: "laundered refusal (a refused kind made 'produced')",
        mutate: (x) => {
          const p = asObj(asObj(x.steps).j004OneSubmission);
          const legs = asObj(p.playback);
          const tactical = asObj(legs.tactical);
          tactical.produced = true;
          delete tactical.typedRefusal;
        },
      },
      {
        name: "fabricated integrity (an unverified playback marked verified)",
        mutate: (x) => {
          const p = asObj(asObj(x.steps).j004OneSubmission);
          asObj(asObj(p.playback)["anime-npr"]).integrityVerified = true;
        },
      },
      {
        name: "a laundered marker (the wrong deployment)",
        mutate: (x) => {
          const boot = asObj(asObj(x.steps).boot);
          if (boot.deployMarker !== undefined) boot.deployMarker = "r607-…-superseded";
          else boot.marker = "r607-…-superseded";
        },
      },
      {
        name: "the accounting's arithmetic broken (a laundered delta)",
        mutate: (x) => {
          asObj(asObj(asObj(x.steps).workerAccounting).delta).dispatched = 99;
        },
      },
      {
        name: "a job's terminal state laundered",
        mutate: (x) => {
          const p = asObj(asObj(x.steps).j004OneSubmission);
          asObj(asArr(p.jobRecords)[0] as Obj).completion = { status: "refused-by-tamper" };
        },
      },
    ];
    let refused = 0;
    for (const v of variants) {
      const tampered: Obj = JSON.parse(raw);
      v.mutate(tampered);
      const checks = validate(tampered);
      const failed = checks.filter((c) => !c.ok);
      if (failed.length > 0) {
        refused += 1;
        console.log(`  refused: ${v.name} (checks: ${failed.map((c) => c.name).join("; ")})`);
      } else {
        console.error(`NEGATIVE FAILURE — variant NOT refused: ${v.name}`);
        process.exit(1);
      }
    }
    console.log(`negative battery: ${refused}/${variants.length} tampered variants REFUSED — PASS`);
    process.exit(0);
  }

  const checks = validate(rec);
  for (const c of checks) {
    console.log(`  ${c.ok ? "PASS" : "FAIL"} — ${c.name}${c.detail ? ` (${c.detail})` : ""}`);
  }
  if (checks.some((c) => !c.ok)) {
    console.error("REFUSED — the record does not validate");
    process.exit(1);
  }
  console.log(`validate-evidence: ${checks.length}/${checks.length} checks PASS`);
}

main();
