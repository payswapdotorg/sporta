/**
 * Shared test fixtures for the historical-corpus tests (REL-009) — the
 * org-registry precedent: every builder returns fresh objects so a test
 * mutating its own copy can never contaminate another.
 */
import type { RightsBasis, SourceMetadata, UserUploadMetadata } from "../src";

/** A well-formed user-ownership basis (the user-fed path's canonical type). */
export function userOwnedBasis(overrides: Partial<RightsBasis> = {}): RightsBasis {
  return {
    basisType: "user-declared-ownership",
    grantRef: "declaration:upload-42",
    scope: "acquisition for normalization and benchmarking",
    declaredBy: "user:1",
    ...overrides,
  };
}

/** A well-formed provider-permitted basis (the connector path). */
export function providerPermittedBasis(overrides: Partial<RightsBasis> = {}): RightsBasis {
  return {
    basisType: "provider-permitted-terms",
    grantRef: "tos:provider-terms#download-allowed",
    scope: "acquisition for private analysis",
    declaredBy: "system:connector",
    ...overrides,
  };
}

/** A minimal, contract-valid YouTube-like source metadata. */
export function youtubeMetadata(overrides: Partial<SourceMetadata> = {}): SourceMetadata {
  return {
    provider: "youtube",
    providerContentId: "vid-001",
    canonicalUrl: "https://www.youtube.com/watch?v=vid-001",
    ownerRef: "channel:league-official",
    observedAt: 1_700_000_000_000,
    availability: "publicly-listed",
    restrictions: [],
    title: "Full Match — Week 12",
    description: "Official league upload",
    ...overrides,
  };
}

/** A reference-only metadata (the URL is a reference, full stop). */
export function referenceOnlyMetadata(overrides: Partial<SourceMetadata> = {}): SourceMetadata {
  return youtubeMetadata({
    providerContentId: "vid-ref-only",
    canonicalUrl: "https://www.youtube.com/watch?v=vid-ref-only",
    restrictions: ["reference-only"],
    title: "Third party clip",
    ...overrides,
  });
}

/** A no-transformation metadata (access may be authorized; normalization never). */
export function noTransformationMetadata(overrides: Partial<SourceMetadata> = {}): SourceMetadata {
  return youtubeMetadata({
    providerContentId: "vid-no-transform",
    canonicalUrl: "https://www.youtube.com/watch?v=vid-no-transform",
    restrictions: ["no-transformation"],
    title: "Archived footage",
    ...overrides,
  });
}

/** Deterministic fixture bytes for a seed (the test media stand-in). */
export function fixtureBytes(seed: string, length = 64): Uint8Array {
  const bytes = new Uint8Array(length);
  let hash = 0;
  for (let i = 0; i < length; i += 1) {
    hash = (hash * 31 + seed.charCodeAt(i % seed.length) + i) % 256;
    bytes[i] = hash;
  }
  return bytes;
}

/** Contract-valid upload metadata. */
export function uploadMetadata(overrides: Partial<UserUploadMetadata> = {}): UserUploadMetadata {
  return {
    ownerRef: "user:1",
    observedAt: 1_700_000_100_000,
    restrictions: [],
    title: "My recorded match",
    description: "user-fed upload",
    ...overrides,
  };
}

/** A deterministic uppercasing normalizer (a real transformation, recorded). */
export const upperCaseNormalizer = {
  normalize(bytes: Uint8Array): { bytes: Uint8Array; pipeline: string; pipelineVersion: string } {
    const upper = new Uint8Array(bytes.length);
    for (let i = 0; i < bytes.length; i += 1) {
      const byte = bytes[i] ?? 0;
      upper[i] = byte >= 97 && byte <= 122 ? byte - 32 : byte;
    }
    return { bytes: upper, pipeline: "upper-case", pipelineVersion: "1" };
  },
} as const;
