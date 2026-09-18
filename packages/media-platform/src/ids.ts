/**
 * Deterministic id helpers for the media platform (crypto-random hex ids,
 * the repo's `sess-u-<32 hex>` convention).
 */
import { randomBytes } from "node:crypto";

/** One crypto-random id: `<prefix>-<32 lowercase hex digits>`. */
export function randomMediaId(prefix: string): string {
  return `${prefix}-${randomBytes(16).toString("hex")}`;
}
