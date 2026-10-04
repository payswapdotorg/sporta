/**
 * SPR303 — the executed-trial fail-closed validator (worker 65-i).
 *
 * The record-benchmark.ts / validate-matrix.ts convention applied to the
 * EXECUTED trial: this validator loads scripts/evidence/spr303-animeganv2-trial/
 * trial-record.json and checks it against the EXECUTED artifacts it claims to
 * stand on (results/latency.json + results/determinism.json +
 * scorecard-animeganv2-hayao.json + vlm/*.json + the committed render bytes +
 * the committed substrate bytes + the committed baseline scorecards). The
 * SPR303 shape: the model RAN, so unlike SPR302 every measurement-shaped key
 * is REQUIRED to cross-match an executed run:
 *
 * 1. STRUCTURE: the 17 top-level keys of the trial record present;
 * 2. WEIGHTS: the fetch-meta sha256 (64-hex) matches the record's weights
 *    sha256 VERBATIM; byteSize matches the executed download (8,649,739 B);
 *    ONE style only (Hayao — no second-style weight anywhere in the record);
 *    the NC-terms citation appears VERBATIM both in the record AND in the
 *    committed SPR302 fetch document it cites; the commercial-clearance
 *    NOT-proven statement present (never a promotion);
 * 3. SUBSTRATE: the record's b8 sha256 matches the scorecard-convention pin
 *    (spr-tier2-scorecards/renders-with-b8-determinism.json
 *    inputSubstrate.sha256) AND the RECOMPUTED sha256 of the committed
 *    substrate file (byte-level verification, not trust);
 * 4. LATENCY (the fabrication guard): latency.json frameCount ==
 *    perFrame.length == 60; every one of the 30 committed render PNGs
 *    recomputed sha256 == the recorded rendersSha256 pin; the record's
 *    latency block matches latency.json VERBATIM (p50/p95/mean/n); the host
 *    is honestly CPU-labeled with GPU N/A — any GPU-latency-shaped key
 *    anywhere is a fabrication (this host has no GPU);
 * 5. DETERMINISM: byteIdentical === true AND extractionByteIdentical ===
 *    true; every stylizedFrames run1 sha == the committed render's
 *    recomputed sha; every run2 == run1 (the double-run evidence); the
 *    record's determinism block matches VERBATIM;
 * 6. SCORECARD: 15 per-sample entries all ok=true; every axes value in 1..5;
 *    the 6 meanScores keys; minAxisMean == min(meanScores);
 *    criticalArtifacts == sum(limbs+players); totalArtifacts == sum(all 7);
 *    all 15 per-call vlm/<sample>.json evidence files EXIST and their
 *    choices[0].message.content RE-PARSES to the same axes/artifacts the
 *    entry claims (a verdict without its per-call evidence fails);
 * 7. THE A/B: the record's baseline numbers match the COMMITTED baseline
 *    scorecards VERBATIM (anime-npr / cartoon-cel minAxisMean — never
 *    laundered, never drifted); collapseAxesBeaten matches the arithmetic;
 * 8. NO PROMOTION + THE TIER CLAIM: tierClaim === 0 everywhere; tlApproval
 *    PENDING; noPromotion text present; no rendererId/gatingState/promotion
 *    key anywhere in the record;
 * 9. THE EBSYNTH LEG: the deferral is honest (status DEFERRED + the recorded
 *    design + the next action) or fully executed — never silent.
 *
 * NEGATIVE TESTS (the fail-closed proof — run negative-tests.sh):
 *   (a) a fabricated GPU latency key injected into measurements.latency ->
 *       exit 1 (no executed GPU run exists);
 *   (b) tlApproval flipped to APPROVED -> exit 1 (the TL owns the visual
 *       gate);
 *   (c) the weights sha tampered -> exit 1;
 *   (d) a baseline number laundered (animeNprMinAxisMean 1.8 -> 2.9) ->
 *       exit 1 (the collapse axes stand until honestly beaten);
 *   restored -> exit 0. Run:
 *   bun scripts/evidence/spr303-animeganv2-trial/validate-trial.ts [record-path]
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const RECORD_PATH = process.argv[2] ?? join(HERE, "trial-record.json");
const LATENCY_PATH = join(HERE, "results", "latency.json");
const DETERMISM_PATH = join(HERE, "results", "determinism.json");
const SCORECARD_PATH = join(HERE, "scorecard-animeganv2-hayao.json");
const VLM_DIR = join(HERE, "vlm");
const RENDERS_DIR = join(HERE, "renders");
const FRAMES_DIR = join(HERE, "frames");
const WEIGHTS_META_PATH = join(HERE, "weights-fetch-meta.json");
const SUBSTRATE_PATH = join(HERE, "..", "..", "..", "scripts", "evidence",
  "spr-corpus-bytes", "b8p3.mp4");
const BASELINE_DIR = join(HERE, "..", "spr-tier2-scorecards");
const HAYAO_CARD_PATH = join(BASELINE_DIR, "..", "spr302-v2v-feasibility",
  "fetches", "hf-vumichien-AnimeGANv2_Hayao-README@pinned-rev");
const BASELINE_PIN_PATH = join(BASELINE_DIR, "renders-with-b8-determinism.json");

const failures: string[] = [];
const fail = (message: string): void => {
  failures.push(message);
};

const sha256 = (p: string): string =>
  createHash("sha256").update(readFileSync(p)).digest("hex");

const load = (p: string): Record<string, unknown> | null => {
  if (!existsSync(p)) {
    fail(`missing artifact: ${p}`);
    return null;
  }
  try {
    return JSON.parse(readFileSync(p, "utf8")) as Record<string, unknown>;
  } catch {
    fail(`unparseable JSON: ${p}`);
    return null;
  }
};

// narrow unknown JSON values without `any` (the prior-flight convention)
const obj = (v: unknown): Record<string, unknown> =>
  (v && typeof v === "object" && !Array.isArray(v))
    ? v as Record<string, unknown>
    : {};
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const num = (v: unknown): number => (typeof v === "number" ? v : Number.NaN);

const record = load(RECORD_PATH);
const latency = load(LATENCY_PATH);
const determinism = load(DETERMISM_PATH);
const scorecard = load(SCORECARD_PATH);
const weightsMeta = load(WEIGHTS_META_PATH);

// ---------- 1. structure ----------
const requiredTop = [
  "schemaVersion", "flight", "worker", "workItem", "recordedAtUtc",
  "honestReading", "weights", "substrate", "measurements", "scorecard",
  "abVerdict", "tierClaim", "tierClaimNote", "tlApproval", "ebsynthLeg",
  "noPromotion", "provenance",
];
if (record) {
  for (const k of requiredTop) {
    if (!(k in record)) fail(`structure: missing top-level key ${k}`);
  }
  const wi: string = record.workItem ?? "";
  if (!wi.startsWith("SPR303 — Provider/hosted-inference trial")) {
    fail(`structure: workItem not the verbatim contract: ${wi}`);
  }
  if ((record.honestReading?.typedGap ?? "").length === 0) {
    fail("structure: the hosted-provider typed gap is absent (never faked)");
  }
}

// ---------- 2. weights ----------
if (record && weightsMeta) {
  const w = record.weights;
  const sha = w?.sha256 ?? "";
  if (!/^[0-9a-f]{64}$/.test(sha)) fail(`weights: bad sha256 shape: ${sha}`);
  if (sha !== weightsMeta.sha256) {
    fail("weights: record sha256 != fetch-meta sha256 (drift)");
  }
  if (w?.byteSize !== weightsMeta.byteSize) {
    fail("weights: byteSize drift vs the executed download");
  }
  if (w?.byteSize !== 8649739) {
    fail(`weights: byteSize ${w?.byteSize} != the matrix-recorded 8,649,739`);
  }
  if (w?.style !== "Hayao") fail(`weights: style is not Hayao: ${w?.style}`);
  if (w?.mirror !== "vumichien/AnimeGANv2_Hayao") {
    fail(`weights: mirror is not the recorded mirror: ${w?.mirror}`);
  }
  if (!/^[0-9a-f]{40}$/.test(w?.revision ?? "")) {
    fail("weights: revision is not a 40-hex pinned revision");
  }
  const oneStyleKeys = [w?.style, w?.mirror, w?.file, w?.downloadUrl,
    w?.sha256, w?.revision].join(" ");
  for (const other of ["Paprika", "Shinkai", "face_paint"]) {
    if (oneStyleKeys.includes(other)) {
      fail(`weights: a second style (${other}) appears in the weights pin keys`);
    }
  }
  const citation: string = w?.license?.weightsCitationVerbatim ?? "";
  if (!citation.includes("freely available to academic and non-academic entities "
    + "for non-commercial purposes")) {
    fail("weights: the NC-terms citation is not the verbatim mirror terms");
  }
  if (!citation.includes("authorization letter")) {
    fail("weights: the NC citation omits the commercial-use clause");
  }
  const card = existsSync(HAYAO_CARD_PATH)
    ? readFileSync(HAYAO_CARD_PATH, "utf8").replace(/\s+/g, " ")
    : "";
  if (!card.includes("freely available to academic and non-academic entities")) {
    fail("weights: the cited SPR302 fetch document does not carry the NC terms");
  }
  if (!JSON.stringify(w?.license ?? {}).includes("NOT proven")) {
    fail("weights: the commercial-clearance NOT-proven statement is absent");
  }
}

// ---------- 3. substrate (byte-level) ----------
if (record) {
  const pinFile = load(BASELINE_PIN_PATH);
  const pinSha = pinFile?.inputSubstrate?.sha256;
  const claimed: string = record.substrate?.sha256 ?? "";
  if (claimed !== pinSha) {
    fail(`substrate: record sha != the scorecard-convention pin (${claimed} vs ${pinSha})`);
  }
  if (existsSync(SUBSTRATE_PATH)) {
    const actual = sha256(SUBSTRATE_PATH);
    if (actual !== claimed) {
      fail(`substrate: RECOMPUTED sha drift (${actual} != ${claimed})`);
    }
  } else {
    fail(`substrate: committed substrate missing: ${SUBSTRATE_PATH}`);
  }
  if (record.substrate?.clipId !== "sprclip-b8-inplay-original") {
    fail("substrate: clipId is not the b8 clip");
  }
}

// ---------- 4. latency (the fabrication guard) ----------
if (record && latency) {
  const m = record.measurements.latency;
  if (m?.executed !== true) fail("latency: not marked executed");
  if (m?.p50TotalMs !== latency.p50TotalMs
    || m?.p95TotalMs !== latency.p95TotalMs
    || m?.p50InferenceMs !== latency.p50InferenceMs
    || m?.p95InferenceMs !== latency.p95InferenceMs
    || m?.meanTotalMs !== latency.meanTotalMs
    || m?.frameCount !== latency.frameCount) {
    fail("latency: record block != results/latency.json (drift/fabrication)");
  }
  if (!Array.isArray(latency.perFrame) || latency.perFrame.length !== 60) {
    fail(`latency: perFrame length ${latency.perFrame?.length} != 60`);
  }
  if (latency.frameCount !== latency.perFrame.length) {
    fail("latency: frameCount != perFrame.length");
  }
  const blockIds = arr(latency.perFrame).filter((f) =>
    String(obj(f).id).startsWith("block"));
  if (blockIds.length !== 30) {
    fail(`latency: latency-probe block != 30 frames (${blockIds.length})`);
  }
  if (blockIds.some((f) => obj(f).evidenceClass !== "latency-probe-only (not VLM evidence)")) {
    fail("latency: a block frame is not labeled latency-probe-only");
  }
  const pins: Record<string, unknown> = obj(latency.rendersSha256);
  const pinIds = Object.keys(pins);
  if (pinIds.length !== 30) {
    fail(`latency: rendersSha256 pins != 30 (${pinIds.length})`);
  }
  const expected = ["t2s", "t8s", "t15s", "t30s", "t45s",
    "c189pre", "c189post", "c475pre", "c475post", "c550pre", "c550post",
    "c862pre", "c862post", "c979pre", "c982post"];
  const expectedIds = [...expected, ...expected.map((i) => `${i}p2`)];
  for (const id of expectedIds) {
    if (!(id in pins)) fail(`latency: missing render pin for ${id}`);
  }
  for (const [id, pin] of Object.entries(pins)) {
    const p = join(RENDERS_DIR, `animeganv2-hayao-${id}.png`);
    if (!existsSync(p)) {
      fail(`latency: committed render missing: animeganv2-hayao-${id}.png`);
      continue;
    }
    if (sha256(p) !== pin) {
      fail(`latency: RECOMPUTED render sha drift for ${id}`);
    }
  }
  const host = latency.host ?? {};
  if (host.provider !== "CPUExecutionProvider") {
    fail("latency: provider is not CPUExecutionProvider (honest host labeling)");
  }
  if (!String(host.gpu ?? "").includes("NONE")) {
    fail("latency: the GPU N/A honesty label is absent");
  }
  if (!String(m?.gpu ?? "").includes("N/A")) {
    fail("latency: the record's GPU N/A statement is absent");
  }
  // ANY gpu-latency-shaped key is a fabrication on this host (no GPU ran)
  const scan = (v: unknown, path: string): void => {
    if (v && typeof v === "object") {
      for (const [k, val] of Object.entries(v)) {
        if (/gpu/i.test(k) && !/gpu$|gpuNa|gpuLabel/.test(k)
          && typeof val !== "string") {
          fail(`latency: GPU-latency-shaped key fabricated at ${path}.${k}`);
        }
        scan(val, `${path}.${k}`);
      }
    }
  };
  scan(record, "record");
  scan(latency, "latency");
}

// ---------- 5. determinism (double-run byte-identity) ----------
if (record && determinism) {
  const d = record.measurements.determinism;
  if (d?.executed !== true) fail("determinism: not marked executed");
  if (determinism.byteIdentical !== true) {
    fail("determinism: the double run is NOT byte-identical (recorded honestly "
      + "elsewhere — the record must then carry the non-deterministic verdict)");
  }
  if (determinism.extractionByteIdentical !== true) {
    fail("determinism: extraction not byte-identical");
  }
  if (d?.byteIdentical !== determinism.byteIdentical
    || d?.extractionByteIdentical !== determinism.extractionByteIdentical
    || d?.verdict !== determinism.verdict) {
    fail("determinism: record block != results/determinism.json (drift)");
  }
  const frames: Record<string, unknown> = obj(determinism.stylizedFrames);
  if (Object.keys(frames).length !== 30) {
    fail(`determinism: stylizedFrames != 30 (${Object.keys(frames).length})`);
  }
  const pins: Record<string, unknown> = obj(latency?.rendersSha256);
  for (const [id, entry] of Object.entries(frames)) {
    const e = obj(entry);
    if (e.run1 !== pins[id]) {
      fail(`determinism: run1 sha != the committed render pin for ${id}`);
    }
    if (e.run2 !== e.run1) {
      fail(`determinism: run2 != run1 for ${id} (non-deterministic pair)`);
    }
    if (e.byteIdentical !== true) {
      fail(`determinism: per-frame byteIdentical !== true for ${id}`);
    }
  }
}

// ---------- 6. the scorecard + per-call evidence ----------
if (record && scorecard) {
  const s = record.scorecard;
  if (s?.minAxisMean !== scorecard.vlm?.minAxisMean
    || JSON.stringify(s?.meanScores) !== JSON.stringify(scorecard.vlm?.meanScores)
    || s?.criticalArtifacts !== scorecard.vlm?.criticalArtifacts
    || s?.totalArtifacts !== scorecard.vlm?.totalArtifacts) {
    fail("scorecard: record block != scorecard-animeganv2-hayao.json (drift)");
  }
  const per: unknown[] = arr(scorecard.perSample);
  if (per.length !== 15) fail(`scorecard: perSample != 15 (${per.length})`);
  if (num(scorecard.vlm?.scoredSamples) !== 15) {
    fail("scorecard: scoredSamples != 15 (a call failed — partial is not a verdict)");
  }
  const axesKeys = ["sf", "tc", "ic", "mf", "scf", "ss"];
  for (const raw of per) {
    const e = obj(raw);
    const eAxes = obj(e.axes);
    const eArts = obj(e.artifacts);
    if (e.ok !== true) fail(`scorecard: sample ${e.sample} not ok`);
    if (Object.keys(eAxes).length > 0) {
      for (const k of axesKeys) {
        const v = eAxes[k];
        if (!Number.isInteger(v) || Number(v) < 1 || Number(v) > 5) {
          fail(`scorecard: ${e.sample} axis ${k} out of 1..5: ${v}`);
        }
      }
    } else {
      fail(`scorecard: ${e.sample} has no parsed axes`);
    }
    if (Object.keys(eArts).length === 0) {
      fail(`scorecard: ${e.sample} has no parsed artifacts`);
    }
  }
  const ms = obj(scorecard.vlm?.meanScores);
  const names = ["sourceFidelity", "temporalConsistency", "identityConsistency",
    "motionFidelity", "sceneFidelity", "stylizationStrength"];
  for (const n of names) {
    if (typeof ms[n] !== "number") fail(`scorecard: meanScores missing ${n}`);
  }
  const vals = names.map((n) => num(ms[n]));
  if (num(scorecard.vlm?.minAxisMean) !== Math.min(...vals)) {
    fail("scorecard: minAxisMean != min(meanScores) (laundered axis)");
  }
  const arts = per.map((raw) => obj(obj(raw).artifacts)).filter((a) =>
    Object.keys(a).length > 0);
  const crit = arts.reduce((a, e) => a + num(e.limbs) + num(e.players), 0);
  const tot = arts.reduce((a, e) => a + arr(Object.values(e))
    .reduce((x: number, y: unknown) => x + num(y), 0), 0);
  if (num(scorecard.vlm?.criticalArtifacts) !== crit) {
    fail(`scorecard: criticalArtifacts != sum(limbs+players) (${crit})`);
  }
  if (num(scorecard.vlm?.totalArtifacts) !== tot) {
    fail(`scorecard: totalArtifacts != sum(7 keys) (${tot})`);
  }
  // per-call evidence: every vlm/<sample>.json exists AND re-parses to the
  // entry's claimed axes/artifacts (a verdict without evidence fails)
  const axesRe = /AXES\s+sf\s*=\s*([1-5])\s+tc\s*=\s*([1-5])\s+ic\s*=\s*([1-5])\s+mf\s*=\s*([1-5])\s+scf\s*=\s*([1-5])\s+ss\s*=\s*([1-5])/i;
  const artRe = /ARTIFACTS\s+limbs\s*=\s*(\d+)\s+players\s*=\s*(\d+)\s+warped\s*=\s*(\d+)\s+dupes\s*=\s*(\d+)\s+ball\s*=\s*(\d+)\s+bg\s*=\s*(\d+)\s+tj\s*=\s*(\d+)/i;
  for (const e of per) {
    const p = join(VLM_DIR, `animeganv2-hayao-${e.sample}.json`);
    if (!existsSync(p)) {
      fail(`scorecard: per-call evidence missing: vlm/animeganv2-hayao-${e.sample}.json`);
      continue;
    }
    let content = "";
    try {
      content = JSON.parse(readFileSync(p, "utf8")).choices[0].message.content;
    } catch {
      fail(`scorecard: unparseable per-call evidence ${e.sample}`);
      continue;
    }
    const am = axesRe.exec(content);
    const rm = artRe.exec(content);
    if (!am || !rm) {
      fail(`scorecard: evidence ${e.sample} lacks the AXES/ARTIFACTS contract`);
      continue;
    }
    const aVals = am.slice(1).map(Number);
    const rVals = rm.slice(1).map(Number);
    if (JSON.stringify(aVals) !== JSON.stringify(axesKeys.map((k) => e.axes[k]))) {
      fail(`scorecard: evidence ${e.sample} axes != the entry's parsed axes`);
    }
    if (JSON.stringify(rVals) !== JSON.stringify(
      ["limbs", "players", "warped", "dupes", "ball", "bg", "tj"]
        .map((k) => e.artifacts[k]))) {
      fail(`scorecard: evidence ${e.sample} artifacts != the entry's parsed artifacts`);
    }
  }
  // the committed originals (the VLM Image 1s) exist
  for (const e of per) {
    if (!existsSync(join(FRAMES_DIR, `original-${e.sample}.png`))) {
      fail(`scorecard: committed original frame missing for ${e.sample}`);
    }
  }
  if (scorecard.tierClaim !== 0) {
    fail(`scorecard: tierClaim ${scorecard.tierClaim} !== 0 (no tier from a `
      + `sampled-frame trial — never laundered)`);
  }
  if (scorecard.tlApproval?.status !== "PENDING") {
    fail("scorecard: tlApproval is not PENDING (the TL owns the visual gate)");
  }
}

// ---------- 7. the A/B vs the COMMITTED baselines ----------
if (record) {
  const ab = record.abVerdict;
  const anime = load(join(BASELINE_DIR, "scorecard-anime-npr.json"));
  const cel = load(join(BASELINE_DIR, "scorecard-cartoon-cel.json"));
  if (anime && ab?.animeNprMinAxisMean !== anime.vlm?.minAxisMean) {
    fail(`A/B: anime-npr baseline ${ab?.animeNprMinAxisMean} != the committed `
      + `${anime.vlm?.minAxisMean} (laundered baseline)`);
  }
  if (cel && ab?.cartoonCelMinAxisMean !== cel.vlm?.minAxisMean) {
    fail(`A/B: cartoon-cel baseline ${ab?.cartoonCelMinAxisMean} != the committed `
      + `${cel.vlm?.minAxisMean} (laundered baseline)`);
  }
  const beaten = ab?.trialMinAxisMean > anime?.vlm?.minAxisMean
    && ab?.trialMinAxisMean > cel?.vlm?.minAxisMean;
  if (ab?.collapseAxesBeaten !== beaten) {
    fail(`A/B: collapseAxesBeaten ${ab?.collapseAxesBeaten} != the arithmetic `
      + `${beaten} (the honest verdict stands)`);
  }
  if (ab?.trialMinAxisMean !== scorecard?.vlm?.minAxisMean) {
    fail("A/B: trialMinAxisMean != the trial scorecard's minAxisMean (drift)");
  }
  if (!Array.isArray(ab?.caveats) || ab.caveats.length < 3) {
    fail("A/B: the honesty caveats block is absent/thin");
  }
}

// ---------- 8. no promotion + the tier claim ----------
if (record) {
  if (record.tierClaim !== 0) {
    fail(`no-promotion: record tierClaim ${record.tierClaim} !== 0`);
  }
  if (record.tlApproval?.status !== "PENDING") {
    fail("no-promotion: tlApproval is not PENDING");
  }
  const blob = JSON.stringify(record);
  for (const forbidden of [
    '"rendererId":', '"gatingState"', '"promotion"', '"DELIVERED"', '"TIER 1"',
    '"TIER 2"',
  ]) {
    if (blob.includes(forbidden)) {
      fail(`no-promotion: forbidden claim-shaped key present: ${forbidden}`);
    }
  }
  if (!String(record.noPromotion).includes("never a promotion")) {
    fail("no-promotion: the no-promotion statement is absent");
  }
}

// ---------- 9. the EbSynth leg ----------
if (record) {
  const eb = record.ebsynthLeg;
  if (eb?.status !== "DEFERRED (honest)") {
    fail(`EbSynth: status is not the honest deferral: ${eb?.status}`);
  }
  if (!eb?.reason || !eb?.recordedDesign || !eb?.nextAction) {
    fail("EbSynth: the deferral record is incomplete (silent drop)");
  }
}

// ---------- verdict ----------
const vlmCount = existsSync(VLM_DIR)
  ? readdirSync(VLM_DIR).filter((f) => f.endsWith(".json")).length
  : 0;
if (vlmCount !== 15) {
  fail(`evidence: vlm/ per-call files != 15 (${vlmCount})`);
}
const renderCount = existsSync(RENDERS_DIR)
  ? readdirSync(RENDERS_DIR).filter((f) => f.endsWith(".png")).length
  : 0;
if (renderCount !== 30) {
  fail(`evidence: committed renders != 30 (${renderCount})`);
}
const frameCount = existsSync(FRAMES_DIR)
  ? readdirSync(FRAMES_DIR).filter((f) => f.endsWith(".png")).length
  : 0;
if (frameCount !== 15) {
  fail(`evidence: committed original frames != 15 (${frameCount})`);
}

if (failures.length > 0) {
  console.error(`FAIL (${failures.length}):`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log("SPR303 trial record VALID (fail-closed): weights pin + substrate "
  + "byte-verified + 60 executed stylizations + double-run byte-identity + "
  + "15/15 VLM per-call evidence re-parsed + the A/B baselines verbatim + "
  + "tier 0 + TL PENDING + no promotion.");
process.exit(0);
