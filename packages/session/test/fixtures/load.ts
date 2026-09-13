/**
 * Typed fixture loading (W004 tests).
 *
 * JSON fixtures live in `test/fixtures/`; they are validated against the
 * `@sporta/contracts` zod schemas on load, so fixture drift fails loudly —
 * the same discipline the contracts package applies to its own fixtures.
 */
import { AuthorizationPolicy, MediaSession } from "@sporta/contracts";
import type { AuthorizationPolicy as AuthorizationPolicyDoc, SourceMedia } from "@sporta/contracts";
import analysisOnlyPolicyJson from "./authorization-policy-analysis-only.json";
import expiredPolicyJson from "./authorization-policy-expired.json";
import fullPolicyJson from "./authorization-policy-full.json";
import mediaSessionInvalidJson from "./media-session-invalid.json";
import sessionCreatedJson from "./session-created.json";

/** A policy allowing every operation (no expiry). */
export const fullPolicy: AuthorizationPolicyDoc = AuthorizationPolicy.parse(fullPolicyJson);

/** A policy allowing only `analysis` (fails the `rendering` gate). */
export const analysisOnlyPolicy: AuthorizationPolicyDoc =
  AuthorizationPolicy.parse(analysisOnlyPolicyJson);

/** A policy allowing everything but expired since 2020. */
export const expiredPolicy: AuthorizationPolicyDoc = AuthorizationPolicy.parse(expiredPolicyJson);

/** A valid `created`-status session document. */
export const sessionFixture = MediaSession.parse(sessionCreatedJson);

/** Raw (unparsed) invalid session document for negative validation tests. */
export const invalidSessionDoc: unknown = mediaSessionInvalidJson;

const [source] = sessionFixture.sources;
if (source === undefined) {
  throw new Error("fixture 'session-created.json' must declare at least one source");
}

/** The source declared by the session fixture. */
export const fixtureSource: SourceMedia = source;

/** A future expiry timestamp (far future, ISO-8601 UTC). */
export const FAR_FUTURE_ISO = "2999-01-01T00:00:00Z";
