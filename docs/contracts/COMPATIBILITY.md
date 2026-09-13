# Contract Compatibility Policy

This document defines how `@sporta/contracts` schemas are versioned, what
counts as an additive versus a breaking change, and how the golden-snapshot
test enforces compatibility. It is normative for every change to
`packages/contracts`.

Related authority: `docs/architecture/architecture-lock.md` (§4 SWM
invariants, §9 vendor neutrality, §14 architecture-change procedure) and
`docs/contracts/sports-world-model.md` (Compatibility).

## Versioning scheme

- Contract version is `MAJOR.MINOR` (no patch component). Current values are
  exported from `packages/contracts/src/versioning.ts` as `SCHEMA_MAJOR` and
  `SCHEMA_MINOR`; `SCHEMA_VERSION` is their string form (e.g. `"1.0"`).
- Every versioned document (media session, observation, event, world
  snapshot, render request, stage message, ...) carries a `schemaVersion`
  string in this form.
- **MAJOR** = breaking. **MINOR** = additive, backward-compatible.
- `isCompatibleVersion(v)` returns true when a payload version `v` is
  consumable by the current contracts: same MAJOR, payload MINOR <= current
  MINOR. Consumers that receive a newer-minor payload must reject or defer it
  rather than partially parsing it.

## Additive changes (MINOR bump)

A change is additive when every previously valid document remains valid and
keeps its meaning. Examples:

- adding a new **optional** field to an object (e.g. `cancelledAtIso` on
  `MediaSession`);
- adding a new enum member, payload variant (e.g. a new `ObservationPayload`
  `kind`), or entity kind — producers may emit it, older consumers must treat
  unknown members defensively;
- loosening a constraint (widening a numeric range, relaxing a pattern);
- adding a new entry to `CONTRACT_SCHEMAS` (a new exported contract).

Additive changes require: bump `SCHEMA_MINOR`, extend fixtures to cover the
addition, regenerate goldens intentionally (see below), and note the addition
in this file's change log if it introduces a new cross-contract rule.

## Breaking changes (MAJOR bump)

A change is breaking when a previously valid document becomes invalid or
changes meaning. Examples:

- removing or renaming a field;
- changing a field's type (e.g. `number` -> `string`);
- making an optional field required;
- tightening a constraint (narrowing a range, adding a `min(1)` to a
  collection, changing `z.unknown()` to a specific type);
- removing an enum member or payload variant;
- repurposing a field with new semantics while keeping its name.

Breaking changes additionally require, per architecture-lock §14:

1. an **ADR** under `docs/adr/` describing the problem, alternatives, impact,
   and migration plan;
2. a **migration note** (referenced from the ADR) describing how persisted
   payloads are upgraded or versioned-side-by-side;
3. bump `SCHEMA_MAJOR` (and reset `SCHEMA_MINOR` to 0);
4. regenerate goldens and update all fixtures intentionally.

## Golden-snapshot enforcement workflow

JSON Schemas for every entry in `CONTRACT_SCHEMAS` are exported with zod v4's
`z.toJSONSchema` and committed under `packages/contracts/fixtures/schemas-golden/`
(one `<name>.json` per registry entry). The test
`packages/contracts/test/schema-compatibility.test.ts` deep-compares each
golden against a freshly exported schema and fails with instructions when they
diverge. This makes *any* schema drift — intentional or accidental, including
drift caused by a zod version bump changing JSON-Schema emission — visible in
CI.

Workflow:

1. Make the schema change.
2. Run `bun test` from the repository root. The golden test will fail with
   instructions if the exported schema changed.
3. Decide: if the change is unintentional, revert the source. If intentional,
   classify it additive vs. breaking and bump the version accordingly.
4. Regenerate intentionally:

   ```bash
   cd packages/contracts
   bun run export-schemas            # writes dist/schemas/ (gitignored build output)
   bun run export-schemas --update-golden   # rewrites fixtures/schemas-golden/
   ```

5. Update fixtures under `packages/contracts/fixtures/` and review the golden
   diff in the commit. A golden diff must never land with an unexplained
   change.

`dist/` is gitignored; `fixtures/schemas-golden/` is the committed source of
truth for the exported shape.

## Known structural limits of the JSON Schema export

The exported JSON Schemas are **structural**. The following runtime-only
constraints exist only in the zod schemas and are NOT visible in the JSON
Schemas (consumers validating with JSON Schema must treat them as additional
rules):

- `Interval`: `endTimeMs >= startTimeMs` (zod `refine`);
- `UncertainValue`: a slot with `status: "known"` must carry a `value`
  (zod `superRefine`);
- `Score.status` and `FootballState.possession` inherit the same
  known-requires-value refinement;
- zod objects strip unknown keys at runtime instead of rejecting them, while
  the exported JSON Schemas advertise `additionalProperties: false` for
  strictness. Producers must not rely on either behavior: emit only the
  documented fields.

Cross-field refinements are the only contract semantics not representable in
JSON Schema; if a new contract needs a refinement, document it here.

## zod version pinning

JSON-Schema emission depends on the zod version. The repository pins zod via
`bun.lock`. A zod upgrade that changes emission will trip the golden test:
verify the diff is emission-only (no contract semantics changed), then
regenerate goldens intentionally in the same commit that bumps zod.
