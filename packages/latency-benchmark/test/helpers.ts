/**
 * Mutable-mirror + deep-clone helpers (the W801 `Mutable<T>` precedent): the
 * production shapes are readonly to protect the benchmark's construction; the
 * tampering tests remove exactly that protection for clones.
 */
export type Mutable<T> = T extends (...args: never[]) => unknown
  ? T
  : { -readonly [K in keyof T]: Mutable<T[K]> };
