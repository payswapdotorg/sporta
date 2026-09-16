/**
 * W912 INTEGRATION TESTS — the REAL Cloudflare R2 artifact storage.
 *
 * ENV-GATED, LOUD: these tests run ONLY when the R2 bindings are present
 * (`R2_S3_ENDPOINT`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` — see
 * docs/deployment/DEPLOYMENT.md §R2). Without them the suite SKIPS with a
 * banner so the root `bun test` battery stays green in every environment
 * that has no bucket (the honest local posture).
 *
 * What is proven (W912 acceptance — authorized artifacts persist in R2,
 * private objects stay access-controlled, delivery is short-lived):
 * 1. STORE SEGMENT → PRESIGNED GET ROUND-TRIP: the exact segment content
 *    comes back byte-identical (measured UTF-8 length + sha-256), fetched
 *    through the SHORT-LIVED presigned URL form — the only authorized
 *    delivery path for private objects.
 * 2. UNSIGNED DIRECT URL IS REFUSED: the raw object URL (no SigV4 signature)
 *    answers a client error — no bytes are ever served to an unauthenticated
 *    reader.
 * 3. EXPIRED SIGNATURE IS REFUSED: a presign from the past with a lapsed
 *    expiry answers 403 (R2 `ExpiredRequest`), and a TAMPERED signature is
 *    refused as well.
 * 4. LISTING / MANIFEST READS: `listSegments` returns the stored entry in
 *    insertion order; `getSegment` returns the manifest VERBATIM (the
 *    deterministic container document is never reinterpreted); duplicates
 *    are COUNTED, not re-stored; conflicting content is a fail-loud
 *    `SegmentConflictError`.
 * 5. DELETION: removed objects stop resolving (idempotent delete).
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import {
  R2RenderOutputStore,
  SegmentConflictError,
  type HostedStoredRenderSegment,
} from "../../src/server/platform/r2/r2-store";
import { presignGetUrl } from "../../src/server/platform/r2/sigv4";
import type { AuthorizationPolicy } from "@sporta/contracts";

/**
 * The gate: run ONLY against the REAL hosted bucket — R2 bindings whose
 * endpoint is a Cloudflare R2 S3 host (`*.r2.cloudflarestorage.com`).
 * Anything missing (or a non-R2 placeholder) SKIPS the suite loudly.
 */
function r2Bindings(): {
  endpoint: string;
  accessKeyId: string;
  secretAccessKey: string;
} | null {
  const endpoint = process.env["R2_S3_ENDPOINT"];
  const accessKeyId = process.env["R2_ACCESS_KEY_ID"];
  const secretAccessKey = process.env["R2_SECRET_ACCESS_KEY"];
  if (
    typeof endpoint !== "string" ||
    endpoint.length === 0 ||
    typeof accessKeyId !== "string" ||
    accessKeyId.length === 0 ||
    typeof secretAccessKey !== "string" ||
    secretAccessKey.length === 0
  ) {
    return null;
  }
  try {
    const host = new URL(endpoint).hostname;
    return host.endsWith(".r2.cloudflarestorage.com")
      ? { endpoint, accessKeyId, secretAccessKey }
      : null;
  } catch {
    return null;
  }
}

const BINDINGS = r2Bindings();
const HAS_R2 = BINDINGS !== null;

if (!HAS_R2) {
  console.warn(
    [
      "",
      "==================================================================",
      " SKIP r2-artifacts.test.ts — no R2 bindings.",
      " These are the W912 REAL-R2 integration tests. To run them:",
      "   . ~/.secrets/env.sh  # or export R2_S3_ENDPOINT/R2_ACCESS_KEY_ID/R2_SECRET_ACCESS_KEY",
      "   bun test apps/web/test/platform/r2-artifacts.test.ts",
      "==================================================================",
      "",
    ].join("\n"),
  );
}

const BUCKET = "sporta-beta-artifacts";
const RUN_KEY = `w912-it-${Date.now().toString(36)}`;

/** The real W701 `AuthorizationPolicy` shape (as the dev seed stores it). */
const PLAYBACK_POLICY: AuthorizationPolicy = {
  policyId: `policy-w912-it-${RUN_KEY}`,
  allowedOperations: ["analysis", "transformation", "derivativeGeneration", "storage"],
  assertedBy: "w912-integration-test",
  sharingScope: "private",
};

/** The same policy WITHOUT the storage operation — retrieval must deny. */
const NO_DERIVATIVES_POLICY: AuthorizationPolicy = {
  policyId: `policy-w912-it-nostore-${RUN_KEY}`,
  allowedOperations: ["analysis"],
  assertedBy: "w912-integration-test",
  sharingScope: "private",
};

const nowMs = (): number => Date.now();

function sha256Hex(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

describe.if(HAS_R2)("W912 R2 artifact storage (real bucket integration)", () => {
  let store: R2RenderOutputStore;
  const sessionId = `it-session-${RUN_KEY}`;
  const renderId = `it-render-${RUN_KEY}`;
  const segmentId = `it-segment-${RUN_KEY}`;
  const content = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 9"><text>x-w912-integration-${RUN_KEY}</text></svg>`;
  const byteLength = new TextEncoder().encode(content).length;
  const contentHash = sha256Hex(content);
  const manifest = {
    schema: "sporta.anime-container/1",
    deterministic: true,
    frames: 1,
    probe: RUN_KEY,
  };

  beforeAll(() => {
    store = new R2RenderOutputStore({
      endpoint: BINDINGS!.endpoint,
      bucket: BUCKET,
      credentials: {
        accessKeyId: BINDINGS!.accessKeyId,
        secretAccessKey: BINDINGS!.secretAccessKey,
        region: "auto",
        service: "s3",
      },
      nowMs,
    });
  });

  afterAll(async () => {
    if (!HAS_R2) return;
    // Leave the bucket clean of this run's segment objects (idempotent).
    // (The scope index + stats envelope objects remain — the store keeps no
    // public API to remove them; documented, byte-scale residue.)
    await store.deleteSegment(sessionId, renderId, segmentId);
  });

  test("1. store → presigned GET round-trip returns byte-identical content", async () => {
    const outcome = await store.storeSegment({
      sessionId,
      renderId,
      segment: {
        segmentId,
        contentType: "image/svg+xml",
        content,
        byteLength,
        contentHash,
        manifest,
      },
    });
    expect(outcome.outcome).toBe("stored");

    // The ONLY authorized delivery form: a short-lived presigned GET.
    const url = store.presignedGetUrl(sessionId, renderId, segmentId, 120);
    expect(url).toContain("X-Amz-Signature=");
    expect(url).toContain("X-Amz-Expires=120");
    const response = await fetch(url);
    expect(response.status).toBe(200);
    const envelope = (await response.json()) as {
      schema: string;
      content: string;
      byteLength: number;
      contentHash: string;
    };
    expect(envelope.schema).toBe("sporta.render-output/1");
    expect(envelope.content).toBe(content); // byte-identical (string equality = same UTF-8 bytes)
    expect(envelope.byteLength).toBe(byteLength);
    expect(envelope.contentHash).toBe(contentHash);
  });

  test("2. unsigned direct object URL is refused (no bytes)", async () => {
    const unsigned = `${BINDINGS!.endpoint}/${BUCKET}/render-outputs/${sessionId}/${renderId}/${segmentId}.json`;
    const response = await fetch(unsigned);
    expect(response.status).toBeGreaterThanOrEqual(400); // R2: 400/403 — refused either way
    expect(response.status).toBeLessThan(500);
    const body = await response.text();
    expect(body).not.toContain(content); // never the artifact bytes
  });

  test("3a. expired presign is refused (403 ExpiredRequest)", async () => {
    const expired = presignGetUrl({
      url: new URL(
        `${BINDINGS!.endpoint}/${BUCKET}/render-outputs/${sessionId}/${renderId}/${segmentId}.json`,
      ),
      credentials: {
        accessKeyId: BINDINGS!.accessKeyId,
        secretAccessKey: BINDINGS!.secretAccessKey,
        region: "auto",
        service: "s3",
      },
      expiresSeconds: 5,
      amzDate: new Date(Date.now() - 60 * 60 * 1000), // signed an hour ago, 5s expiry
    });
    const response = await fetch(expired);
    expect(response.status).toBe(403);
    expect(await response.text()).not.toContain(content);
  });

  test("3b. tampered presign signature is refused", async () => {
    const good = store.presignedGetUrl(sessionId, renderId, segmentId, 120);
    const tampered = good.replace(/X-Amz-Signature=.{8}/, "X-Amz-Signature=deadbeef");
    const response = await fetch(tampered);
    expect(response.status).toBe(403);
  });

  test("4. listing + manifest reads (verbatim manifest, counted duplicates, conflict fail-loud)", async () => {
    const listed = await store.listSegments({
      sessionId,
      renderId,
      policy: PLAYBACK_POLICY,
      nowMs: nowMs(),
    });
    expect(listed.length).toBe(1);
    expect(listed[0]).toEqual({
      segmentId,
      contentType: "image/svg+xml",
      byteLength,
      contentHash,
    });

    const record: HostedStoredRenderSegment | null = await store.getSegment({
      sessionId,
      renderId,
      segmentId,
      policy: PLAYBACK_POLICY,
      nowMs: nowMs(),
    });
    expect(record).not.toBeNull();
    expect(record!.manifest).toEqual(manifest); // verbatim, never reinterpreted

    // Same content again: a COUNTED duplicate, never a silent replace.
    const again = await store.storeSegment({
      sessionId,
      renderId,
      segment: {
        segmentId,
        contentType: "image/svg+xml",
        content,
        byteLength,
        contentHash,
        manifest,
      },
    });
    expect(again.outcome).toBe("duplicate");

    // Different content under the same key: fail-loud conflict.
    const otherContent = `${content}<!-- mutated -->`;
    await expect(
      store.storeSegment({
        sessionId,
        renderId,
        segment: {
          segmentId,
          contentType: "image/svg+xml",
          content: otherContent,
          byteLength: new TextEncoder().encode(otherContent).length,
          contentHash: sha256Hex(otherContent),
          manifest,
        },
      }),
    ).rejects.toBeInstanceOf(SegmentConflictError);
  });

  test("5. retrieval without derivative rights denies before existence", async () => {
    await expect(
      store.getSegment({
        sessionId,
        renderId,
        segmentId,
        policy: NO_DERIVATIVES_POLICY,
        nowMs: nowMs(),
      }),
    ).rejects.toThrow(/playback denied/i);
  });

  test("6. deletion removes the object (idempotent)", async () => {
    await store.deleteSegment(sessionId, renderId, segmentId);
    await store.deleteSegment(sessionId, renderId, segmentId); // idempotent
    const record = await store.getSegment({
      sessionId,
      renderId,
      segmentId,
      policy: PLAYBACK_POLICY,
      nowMs: nowMs(),
    });
    expect(record).toBeNull();
  });
});
