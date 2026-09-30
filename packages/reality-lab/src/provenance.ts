/**
 * The ADR-013 §8 provenance-class taxonomy for lab outputs (the binding
 * "lab world state is NEVER production truth" rule).
 *
 * These three classes are EXPLICITLY DISTINCT:
 *
 * - `real-observation` — a record of something that actually happened in
 *   the real world and was observed (a real broadcast frame, a real feed
 *   sample);
 * - `historical-replay` — a faithful replay of recorded historical media
 *   (Worker B's REL-009..011 corpus territory);
 * - `lab-simulation` — a SIMULATED world produced by the Reality
 *   Engineering Lab's World Simulator. It may be internally consistent, it
 *   may be useful for searching organizations — it is NEVER production
 *   truth and can never be presented as a real observation.
 *
 * Every world state, observation and claim the lab's simulator produces
 * carries `provenanceClass: "lab-simulation"`, and the domain packs' hard
 * invalidity rules hard-refuse any lab-run claim that presents itself as
 * `real-observation` or `historical-replay` (the `provenance-bypass` rule).
 *
 * NOTE (deliberate non-import): `@sporta/contracts`'s `ProvenanceKind`
 * (OBSERVED/REPORTED/DERIVED) describes the EVIDENCE-CHAIN axis of a single
 * observation inside production ingestion. This taxonomy describes WHICH
 * WORLD a record came from. They are different axes; conflating them would
 * let a simulated record launder itself into production provenance, so the
 * lab keeps its own frozen vocabulary here.
 */
import { z } from "zod";

/** The three explicitly-distinct provenance classes of ADR-013 §8. */
export const LabProvenanceClass = z.enum([
  "real-observation",
  "historical-replay",
  "lab-simulation",
]);
export type LabProvenanceClass = z.infer<typeof LabProvenanceClass>;

/** The provenance class every simulator-produced record carries, without exception. */
export const LAB_SIMULATION_PROVENANCE = "lab-simulation" as const;

/** Type guard: `true` when `value` is a lab provenance class. */
export function isLabProvenanceClass(value: unknown): value is LabProvenanceClass {
  return LabProvenanceClass.safeParse(value).success;
}
