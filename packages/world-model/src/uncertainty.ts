/**
 * Constructors and a reader for the `UncertainValue` pattern from
 * `@sporta/contracts` (architecture-lock §4: explicit uncertainty rather than
 * invented certainty).
 *
 * The engine (and its tests) MUST build every uncertainty slot through these
 * helpers: a slot that is not established is `unknown`, a candidate carries a
 * confidence, and a `known` slot must actually carry a value. Anything invalid
 * throws instead of silently producing invented certainty.
 */
import { UncertainValue, type UncertaintyStatus } from "@sporta/contracts";
import { InvalidUncertainValueError } from "./errors";
import { issuesOf } from "./internal";

/**
 * A directly established value. `confidence` is optional and bounded to
 * [0, 1]; the value must actually be present (`known(undefined)` throws).
 */
export function known<T>(value: T, confidence?: number): UncertainValue<T> {
  const slot = {
    status: "known" as const,
    ...(value !== undefined ? { value } : {}),
    ...(confidence !== undefined ? { confidence } : {}),
  };
  const parsed = UncertainValue.safeParse(slot);
  if (!parsed.success) {
    throw new InvalidUncertainValueError(issuesOf(parsed.error));
  }
  return {
    status: "known",
    ...(value !== undefined ? { value } : {}),
    ...(confidence !== undefined ? { confidence } : {}),
  };
}

/**
 * An unset slot. Never carries a value: absence of knowledge is represented
 * explicitly instead of with an invented value.
 */
export function unknownValue(): UncertainValue<never> {
  return { status: "unknown" };
}

/**
 * A candidate value with its confidence in [0, 1]. The value is a candidate,
 * not an established fact: consumers see `status: "uncertain"`.
 */
export function uncertain<T>(value: T, confidence: number): UncertainValue<T> {
  const slot = {
    status: "uncertain" as const,
    ...(value !== undefined ? { value } : {}),
    confidence,
  };
  const parsed = UncertainValue.safeParse(slot);
  if (!parsed.success) {
    throw new InvalidUncertainValueError(issuesOf(parsed.error));
  }
  return {
    status: "uncertain",
    ...(value !== undefined ? { value } : {}),
    confidence,
  };
}

/**
 * Resolves an uncertainty slot for consumers: a normalized
 * `{ value?, status }` view. `value` is present only when the slot actually
 * carries one (`known` or an `uncertain` candidate).
 */
export function resolveUncertain<T>(slot: UncertainValue<T>): {
  value?: T;
  status: UncertaintyStatus;
} {
  if (slot.status === "unknown" || slot.value === undefined) {
    return { status: slot.status };
  }
  return { status: slot.status, value: slot.value };
}
