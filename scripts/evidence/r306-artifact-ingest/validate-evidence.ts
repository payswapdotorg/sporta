/**
 * R306 ARTIFACT-INGEST SEAM — THE FAIL-CLOSED VALIDATOR (DEVELOPMENT-TIME
 * EVIDENCE, not a test): machine-checks the measurement record
 * `artifact-ingest-seam.json` — every claim the verdict makes is
 * cross-verified against the record's own measured fields; a
 * tampered/laundered record is REFUSED with the check named (never a
 * silent pass). Negative variants are exercised by
 * `bun run scripts/evidence/r306-artifact-ingest/validate-evidence.ts --negative`
 * which flips one field per variant and asserts the validator refuses each.
 *
 * Checks (the honest posture — the record must agree with ITSELF):
 *  1. the battery leg is green (exit 0, 0 fail, the 6 measured cases);
 *  2. the pre-fix refusal is the SPECIFIC miss class, VERBATIM, and the
 *     recorded sha-256 is the sha of the recorded message (a laundered
 *     message or sha is refused);
 *  3. the post-fix landing is internally consistent (the served bytes'
 *     hash === the content hash; the frozen manifest agrees on hash +
 *     byteSize; the put arithmetic adds up; the base64-canonicality claim
 *     agrees with the artifactId identity claim; the re-read verified);
 *  4. the landing landed EXACTLY what the miss named (the registered
 *     artifact id === the missed id, the canonical case);
 *  5. the in-process shape degraded NOTHING (ZERO ingest puts,
 *     record-identical + byte-identical);
 *  6. re-delivery is idempotent (no second put on the same envelope; the
 *     non-canonical delivery is the store's COUNTED duplicate, never a
 *     second put — the store's own stats agree);
 *  7. EVERY refusal stayed loud with NOTHING put (each message's sha is
 *     the sha of its own text; the laundered classes are typed; the
 *     no-delivery refusal is the miss VERBATIM);
 *  8. the verdict agrees with the record (the landing's own sha, the
 *     battery's own counts, the ZERO-put claim).
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const HERE = dirname(new URL(import.meta.url).pathname);
const RECORD = resolve(join(HERE, "artifact-ingest-seam.json"));

/** One measured check with its verdict and the detail the record carried. */
interface Check {
  name: string;
  ok: boolean;
  detail?: string;
}

type Obj = Record<string, unknown>;

/** Narrows an unknown value to an object (never throws — a wrong shape fails checks). */
const asObj = (v: unknown): Obj => (v !== null && typeof v === "object" ? (v as Obj) : {});
/** The honest number (a wrong shape reads -1 — the check fails, never crashes). */
const num = (v: unknown): number => (typeof v === "number" ? v : -1);
/** The honest string (a wrong shape reads ""). */
const str = (v: unknown): string => (typeof v === "string" ? v : "");
/** The honest boolean (a wrong shape reads false). */
const bool = (v: unknown): boolean => v === true;
/** sha-256 of a text (the record's own message-hashing convention). */
const shaOfText = (text: string): string =>
  createHash("sha256").update(new TextEncoder().encode(text)).digest("hex");

/** The specific store-miss refusal pattern (the one registrable class). */
const MISS_PATTERN = /^encoding refused \(artifact-invalid\): no artifact "([0-9a-f]{64})" is stored$/;

function validate(rec: unknown): Check[] {
  const checks: Check[] = [];
  const r = asObj(rec);
  const battery = asObj(r.battery);
  const preFix = asObj(r.preFixRefusal);
  const landing = asObj(r.postFixLanding);
  const inProcess = asObj(r.inProcessShape);
  const reDelivery = asObj(r.reDelivery);
  const refusals = asObj(r.refusals);
  const verdict = str(r.verdict);

  // 1. the battery
  checks.push({
    name: "the battery leg is green (exit 0, 0 fail, 6 cases)",
    ok: num(battery.exitCode) === 0 && num(battery.fail) === 0 && num(battery.pass) === 6,
    detail: `pass=${num(battery.pass)} fail=${num(battery.fail)} exit=${num(battery.exitCode)}`,
  });

  // 2. the pre-fix refusal, verbatim + sha'd
  const preFixVerbatim = str(preFix.verbatim);
  const preFixMatch = MISS_PATTERN.exec(preFixVerbatim);
  const preFixShaOk = str(preFix.sha256OfMessage) === shaOfText(preFixVerbatim);
  checks.push({
    name: "the pre-fix refusal is the specific miss class, VERBATIM",
    ok: preFixMatch !== null && bool(preFix.reproduced) && str(preFix.kind) === "artifact-invalid",
    detail: preFixVerbatim.slice(0, 90),
  });
  checks.push({
    name: "the pre-fix refusal's sha is the sha of its own message",
    ok: preFixShaOk,
    detail: `recorded=${str(preFix.sha256OfMessage).slice(0, 16)}…`,
  });

  // 3. the landing's internal consistency
  const contentHash = str(landing.contentHash);
  const media = asObj(landing.mediaPlatform);
  const frozen = asObj(landing.frozenManifest);
  const putCounters = asObj(landing.putCounters);
  const canonical = asObj(landing.base64Canonical);
  const reRead = asObj(landing.reRead);
  checks.push({
    name: "the landing's served bytes hash to the landing's content hash",
    ok:
      bool(landing.landed) &&
      /^[0-9a-f]{64}$/.test(contentHash) &&
      str(media.servedBytesSha256) === contentHash &&
      bool(media.servedBytesByteIdenticalToWorkerEncode) &&
      bool(media.ftyp),
    detail: `servedSha=${str(media.servedBytesSha256).slice(0, 16)}…`,
  });
  checks.push({
    name: "the frozen manifest + byteSize agree with the landing",
    ok:
      str(frozen.contentHash) === contentHash &&
      num(frozen.byteSize) === num(landing.byteSize) &&
      num(media.servedByteLength) === num(landing.byteSize) &&
      num(landing.byteSize) > 1024,
    detail: `byteSize=${num(landing.byteSize)}`,
  });
  checks.push({
    name: "the landing's put arithmetic (dispatched === stored + duplicate)",
    ok:
      num(putCounters.stored) + num(putCounters.duplicate) === num(putCounters.dispatched) &&
      num(putCounters.dispatched) === 1 &&
      num(putCounters.stored) === 1,
    detail: JSON.stringify(putCounters),
  });
  checks.push({
    name: "the base64-canonicality claim agrees with the artifactId identity claim",
    ok:
      bool(canonical.deliveredEqualsCanonicalReEncode) ===
        bool(landing.appStoreArtifactIdEqualsMissedId) &&
      /^[0-9a-f]{64}$/.test(str(landing.appStoreArtifactId)),
    detail: `canonical=${String(bool(canonical.deliveredEqualsCanonicalReEncode))}`,
  });
  checks.push({
    name: "the verified re-read (hash + byte identity + typed content)",
    ok: bool(reRead.contentHashVerified) && bool(reRead.bytesByteIdentical),
  });

  // 4. the landing is what the miss named
  checks.push({
    name: "the landing landed EXACTLY what the miss named (the canonical case)",
    ok:
      bool(landing.appStoreArtifactIdEqualsMissedId) &&
      str(preFix.missedArtifactId) === str(landing.appStoreArtifactId),
    detail: `miss=${str(preFix.missedArtifactId).slice(0, 16)}… landed=${str(landing.appStoreArtifactId).slice(0, 16)}…`,
  });

  // 5. the in-process shape
  checks.push({
    name: "the in-process shape degraded NOTHING (ZERO ingest puts, record-identical + byte-identical)",
    ok:
      num(inProcess.ingestPuts) === 0 &&
      bool(inProcess.recordDeepEqualsHosted) &&
      bool(inProcess.bytesByteIdentical),
    detail: `ingestPuts=${num(inProcess.ingestPuts)}`,
  });

  // 6. re-delivery idempotency
  const sameEnvelope = asObj(reDelivery.sameEnvelope);
  const sameCounters = asObj(sameEnvelope.putCounters);
  const nonCanonical = asObj(reDelivery.nonCanonicalDelivery);
  const nonCanonicalCounters = asObj(nonCanonical.putCounters);
  const nonCanonicalStats = asObj(nonCanonical.storeStats);
  checks.push({
    name: "the same-envelope re-delivery made NO second put",
    ok:
      num(sameCounters.dispatched) === 1 &&
      num(sameCounters.duplicate) === 0 &&
      num(sameEnvelope.mediaRecords) === 1,
    detail: JSON.stringify(sameCounters),
  });
  checks.push({
    name: "the non-canonical re-delivery is the store's COUNTED duplicate, never a second put",
    ok:
      num(nonCanonicalCounters.dispatched) === 2 &&
      num(nonCanonicalCounters.stored) === 1 &&
      num(nonCanonicalCounters.duplicate) === 1 &&
      num(nonCanonicalStats.artifacts) === 1 &&
      num(nonCanonicalStats.duplicatePuts) === 1 &&
      bool(nonCanonical.registeredUnderCanonicalArtifactId),
    detail: `counters=${JSON.stringify(nonCanonicalCounters)} stats.artifacts=${num(nonCanonicalStats.artifacts)}`,
  });

  // 7. every refusal stayed loud with NOTHING put
  const refusalNames = [
    "integrity",
    "manifestMismatch",
    "sessionMismatch",
    "launderedTamperedRecord",
    "launderedContentType",
    "noDelivery",
  ];
  for (const name of refusalNames) {
    if (refusals[name] === undefined) {
      checks.push({ name: `the ${name} refusal is recorded`, ok: false });
      continue;
    }
    const refusal = asObj(refusals[name]);
    const counters = asObj(refusal.putCounters);
    const messageOk = str(refusal.message).length > 0 && str(refusal.messageSha256) === shaOfText(str(refusal.message));
    const nothingPut =
      num(counters.dispatched) === 0 && num(counters.stored) === 0 && num(counters.duplicate) === 0;
    checks.push({
      name: `the ${name} refusal: loud, sha'd, NOTHING put, no record`,
      ok: bool(refusal.refused) && messageOk && nothingPut && num(refusal.mediaRecords) === 0,
      detail: `kind=${str(refusal.kind) || "plain-Error"} puts=${num(counters.dispatched)}`,
    });
  }
  const noDelivery = asObj(refusals.noDelivery);
  checks.push({
    name: "the no-delivery refusal is the miss VERBATIM (the sha'd exact text)",
    ok: MISS_PATTERN.exec(str(noDelivery.message)) !== null && bool(noDelivery.refused),
    detail: str(noDelivery.message).slice(0, 90),
  });
  checks.push({
    name: "the laundered tampered-record refusal is the store's verify-failed class",
    ok: str(asObj(refusals.launderedTamperedRecord).kind) === "verify-failed",
  });

  // 8. the verdict agrees with the record
  checks.push({
    name: "the verdict carries the landing's own measured sha + the battery's own counts",
    ok:
      verdict.includes(contentHash) &&
      verdict.includes(`${num(battery.pass)}/${num(battery.pass)}`) &&
      verdict.includes("ZERO ingest puts"),
    detail: `contentHash in verdict: ${verdict.includes(contentHash)}`,
  });
  // The verdict must NOT claim the hosted re-flight (the honest scope).
  checks.push({
    name: "the verdict scopes itself honestly (the hosted re-flight typed as the NEXT flight)",
    ok: verdict.includes("NEXT flight") && verdict.includes("LOCAL-ONLY"),
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
        name: "laundered sha (the pre-fix refusal's message sha replaced)",
        mutate: (x) => {
          asObj(x.preFixRefusal).sha256OfMessage = shaOfText("laundered");
        },
      },
      {
        name: "fabricated battery (the pass count inflated)",
        mutate: (x) => {
          asObj(x.battery).pass = 99;
        },
      },
      {
        name: "laundered put-count (the in-process shape claims an ingest put)",
        mutate: (x) => {
          asObj(x.inProcessShape).ingestPuts = 1;
        },
      },
      {
        name: "laundered refusal (the no-delivery refusal rewritten as a quiet pass)",
        mutate: (x) => {
          asObj(asObj(x.refusals).noDelivery).message = "stored fine";
        },
      },
      {
        name: "a laundered refusal flag (a quiet pass marked refused)",
        mutate: (x) => {
          asObj(asObj(x.refusals).launderedTamperedRecord).refused = false;
        },
      },
      {
        name: "fabricated landing (the byte size inflated against the frozen manifest)",
        mutate: (x) => {
          asObj(x.postFixLanding).byteSize = num(asObj(x.postFixLanding).byteSize) * 2;
        },
      },
      {
        name: "laundered verdict (the battery counts rewritten)",
        mutate: (x) => {
          x.verdict = str(x.verdict).replace("6/6", "0/6");
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
