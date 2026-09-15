/**
 * The PLAYER IDENTITY CONTINUITY dimension (W605 deliverable 3).
 *
 * The renderer's documented contract (RENDERER.md §4, architecture-lock
 * §6): every color property of an entity is a pure function of
 * `(styleKey, entityId)` — `styleKey = "<rendererId>:<rendererVersion>"` —
 * with NO dependence on the entity's SWM `version` (which bumps on every
 * upsert). Consequences, all measured:
 *
 * - **Token correctness** (stronger than W503's modal-stability check): the
 *   recorded token must equal the RECOMPUTED token through the renderer's
 *   own exported `stableAvatarStyle(styleKey, entityId)` — a renderer that
 *   hashed with a wrong key for the WHOLE run is caught here, where a
 *   purely temporal (modal) comparison would be blind;
 * - **Token stability**: the token is constant across the entire rundown
 *   (per entity, per style kind);
 * - **No identity swaps**: a token matching ANOTHER entity's expectation
 *   while not matching its own is a swap signature (two entities
 *   exchanging styles), even when each is internally "stable";
 * - **Kind/style-kind stability**: an entity's recorded kind and style kind
 *   never change (an entity entry never becomes a different entity);
 * - **Sanctioned restyle accounting**: the ONLY sanctioned restyle moment
 *   is a rendererVersion change (which changes the style key) — and within
 *   one render output the rendererVersion is immutable, so
 *   `sanctionedRestyleCount` is 0 BY CONSTRUCTION and any divergence is a
 *   defect. A genuine restyle is a NEW output under a bumped version,
 *   evaluated separately (the 0.2.0 bump is exercised by the renderer's
 *   own test suite; this field keeps the accounting explicit and computed,
 *   never asserted).
 */
import { OFFICIAL_STYLE } from "@sporta/renderer-3d";
import type { AvatarStyle, Render3dStyleKind } from "@sporta/renderer-3d";
import type { EvalFrame, ValidatedSceneEvaluationInput } from "./validate";
import type { FrameExpectation } from "./expected";
import { expectedStyleKind, expectedStyleToken } from "./expected";
import type { SceneEvaluationFinding } from "./findings";
import { frameFinding } from "./findings";
import { describeValue } from "./internal";

/** The identity-continuity dimension's measured metrics. */
export interface IdentityMetrics {
  /** Distinct entities that carried an identity style token anywhere in the rundown. */
  identityStyledEntityCount: number;
  /** (frame, entity) pairs carrying an identity style token (the measurement base). */
  tokenFrameCount: number;
  /** Token pairs whose recorded token ≠ the recomputed expectation for (styleKey, entityId). */
  styleTokenDivergenceCount: number;
  /** Token pairs whose recorded token ≠ the entity's first-seen token (temporal stability). */
  styleTokenInstabilityCount: number;
  /** Token pairs matching another styled entity's expectation while not matching their own. */
  entityIdentitySwapCount: number;
  /** Entities whose recorded kind differs across frames. */
  entityKindChangeCount: number;
  /** Entities whose recorded style kind differs across frames. */
  entityStyleKindChangeCount: number;
  /**
   * Adjacent frame pairs whose style key changed (the sanctioned restyle
   * moments — 0 within one output by construction; see module docblock).
   */
  sanctionedRestyleCount: number;
  /** Entities seen (evidence). */
  entityCount: number;
}

/**
 * Measures player identity continuity over the whole rundown. Pure.
 *
 * The `official-fixed` and `ball-fixed` styles are constants (not hashed)
 * and are checked for constancy the same way (their expectation is the
 * renderer's exported constant / absence-of-token respectively).
 */
export function measureIdentity(options: {
  input: ValidatedSceneEvaluationInput;
  frames: readonly EvalFrame[];
  expectations: readonly FrameExpectation[];
  findings: SceneEvaluationFinding[];
}): IdentityMetrics {
  const { frames, expectations, findings } = options;
  const styleKey = expectations[0]!.styleKey;

  // The styled-entity universe: entityId -> the expected style kind (from
  // the expectations; an entity's kind is stable, so first-seen wins and a
  // later disagreement is itself measured below).
  const firstToken = new Map<string, AvatarStyle>();
  const firstKind = new Map<string, string>();
  const firstStyleKind = new Map<string, Render3dStyleKind>();
  const seenEntities = new Set<string>();

  let tokenFrameCount = 0;
  let styleTokenDivergenceCount = 0;
  let styleTokenInstabilityCount = 0;
  let entityIdentitySwapCount = 0;
  let entityKindChangeCount = 0;
  let entityStyleKindChangeCount = 0;
  let sanctionedRestyleCount = 0;

  for (let i = 0; i < frames.length; i += 1) {
    const frame = frames[i]!;
    const expectation = expectations[i]!;
    const expectedKindById = new Map<string, string>();
    for (const sceneEntity of expectation.scene.entities) {
      expectedKindById.set(sceneEntity.entityId, sceneEntity.kind);
    }
    for (const entity of frame.entry.entities) {
      const entityId = entity.entityId;
      seenEntities.add(entityId);

      // Kind stability (the identity key itself never changes).
      const recordedKind = entity.kind;
      const firstSeenKind = firstKind.get(entityId);
      if (firstSeenKind === undefined) {
        firstKind.set(entityId, recordedKind);
      } else if (firstSeenKind !== recordedKind) {
        entityKindChangeCount += 1;
        findings.push(
          frameFinding(frame, {
            dimension: "identity",
            metric: "identity.entityKindChangeCount",
            entityId,
            path: `$.output.manifest.frames[${frame.frameIndex}].entry.entities[${entity.entityId}].kind`,
            expected: describeValue(firstSeenKind),
            actual: describeValue(recordedKind),
          }),
        );
      }

      // Style-kind stability.
      const recordedStyleKind = entity.styleKind;
      const firstSeenStyleKind = firstStyleKind.get(entityId);
      if (firstSeenStyleKind === undefined) {
        firstStyleKind.set(entityId, recordedStyleKind);
      } else if (firstSeenStyleKind !== recordedStyleKind) {
        entityStyleKindChangeCount += 1;
        findings.push(
          frameFinding(frame, {
            dimension: "identity",
            metric: "identity.entityStyleKindChangeCount",
            entityId,
            path: `$.output.manifest.frames[${frame.frameIndex}].entry.entities[${entity.entityId}].styleKind`,
            expected: describeValue(firstSeenStyleKind),
            actual: describeValue(recordedStyleKind),
          }),
        );
      }

      // The expected style kind for THIS frame's authoritative scene entity.
      const sceneEntity = expectation.scene.entities.find(
        (candidate) => candidate.entityId === entityId,
      );
      const expectedKind = sceneEntity === undefined ? undefined : expectedStyleKind(sceneEntity);
      if (expectedKind !== undefined && expectedKind !== recordedStyleKind) {
        // A style-kind disagreement with the authoritative scene is a
        // scene-state defect (measured there); identity measures continuity.
        continue;
      }
      if (recordedStyleKind !== "identity" && recordedStyleKind !== "official-fixed") {
        continue; // ball-fixed carries no token; "none" has none to check.
      }
      tokenFrameCount += 1;
      const recordedToken = entity.style;
      if (recordedToken === undefined) {
        styleTokenDivergenceCount += 1;
        findings.push(
          frameFinding(frame, {
            dimension: "identity",
            metric: "identity.styleTokenDivergenceCount",
            entityId,
            path: `$.output.manifest.frames[${frame.frameIndex}].entry.entities[${entity.entityId}].style`,
            expected: describeValue(
              recordedStyleKind === "official-fixed"
                ? OFFICIAL_STYLE
                : expectedStyleToken(styleKey, entityId),
            ),
            actual: describeValue(undefined),
          }),
        );
        continue;
      }
      // Token correctness: the recomputed expectation (the renderer's own
      // pure function over the output's own renderer identity).
      const expectedToken =
        recordedStyleKind === "official-fixed"
          ? OFFICIAL_STYLE
          : expectedStyleToken(styleKey, entityId);
      if (!tokensEqual(recordedToken, expectedToken)) {
        styleTokenDivergenceCount += 1;
        findings.push(
          frameFinding(frame, {
            dimension: "identity",
            metric: "identity.styleTokenDivergenceCount",
            entityId,
            path: `$.output.manifest.frames[${frame.frameIndex}].entry.entities[${entity.entityId}].style`,
            expected: describeValue(expectedToken),
            actual: describeValue(recordedToken),
          }),
        );
      }
      // Token stability: the entity's first-seen token.
      const firstSeenToken = firstToken.get(entityId);
      if (firstSeenToken === undefined) {
        firstToken.set(entityId, recordedToken);
      } else if (!tokensEqual(recordedToken, firstSeenToken)) {
        styleTokenInstabilityCount += 1;
        findings.push(
          frameFinding(frame, {
            dimension: "identity",
            metric: "identity.styleTokenInstabilityCount",
            entityId,
            path: `$.output.manifest.frames[${frame.frameIndex}].entry.entities[${entity.entityId}].style`,
            expected: describeValue(firstSeenToken),
            actual: describeValue(recordedToken),
          }),
        );
      }
    }

    // The sanctioned-restyle accounting: adjacent frames whose style key
    // differs (0 within one output — the rendererVersion is immutable).
    if (i > 0 && expectations[i - 1]!.styleKey !== expectation.styleKey) {
      sanctionedRestyleCount += 1;
    }
  }

  // Identity swaps: a token that matches another entity's expectation
  // while not matching its own (a two-entity exchange is internally
  // "stable" per entity — only the cross-match exposes it). Officials
  // dress uniformly (a fixed constant) and cannot be swap parties — their
  // continuity is the divergence check against OFFICIAL_STYLE.
  const styledIds: string[] = [];
  for (const [entityId, styleKind] of firstStyleKind) {
    if (styleKind === "identity") styledIds.push(entityId);
  }
  for (let i = 0; i < frames.length; i += 1) {
    const frame = frames[i]!;
    const styleKeyFrame = expectations[i]!.styleKey;
    for (const entity of frame.entry.entities) {
      if (entity.style === undefined || entity.styleKind === "official-fixed") continue;
      const own = expectedStyleToken(styleKeyFrame, entity.entityId);
      if (tokensEqual(entity.style, own)) continue;
      for (const otherId of styledIds) {
        if (otherId === entity.entityId) continue;
        if (tokensEqual(entity.style, expectedStyleToken(styleKeyFrame, otherId))) {
          entityIdentitySwapCount += 1;
          findings.push(
            frameFinding(frame, {
              dimension: "identity",
              metric: "identity.entityIdentitySwapCount",
              entityId: entity.entityId,
              path: `$.output.manifest.frames[${frame.frameIndex}].entry.entities[${entity.entityId}].style`,
              expected: describeValue(own),
              actual: describeValue(entity.style),
            }),
          );
          break;
        }
      }
    }
  }

  return {
    identityStyledEntityCount: styledIds.length,
    tokenFrameCount,
    styleTokenDivergenceCount,
    styleTokenInstabilityCount,
    entityIdentitySwapCount,
    entityKindChangeCount,
    entityStyleKindChangeCount,
    sanctionedRestyleCount,
    entityCount: seenEntities.size,
  };
}

/** Token equality (field-wise, exact). */
function tokensEqual(a: AvatarStyle, b: AvatarStyle): boolean {
  return a.paletteIndex === b.paletteIndex && a.jersey === b.jersey && a.trim === b.trim;
}
