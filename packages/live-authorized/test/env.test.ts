/**
 * THE L009 ENV-GATE BATTERY — the honest capability gate: incomplete
 * bindings keep the authorized feed BLOCKED with the exact missing names;
 * complete bindings resolve ready; secret values NEVER appear in any
 * capability output (presence only).
 */
import { describe, expect, test } from "bun:test";
import {
  SKILLCORNER_USERNAME_ENV,
  SKILLCORNER_PASSWORD_ENV,
  SKILLCORNER_MATCH_ID_ENV,
  SKILLCORNER_API_BASE_ENV,
  SKILLCORNER_DEFAULT_API_BASE,
  authorizedSkillCornerConfig,
  authorizedFeedCapability,
} from "../src/env";

describe("L009 — the authorized-feed env gate (the honest capability)", () => {
  test("an empty env is BLOCKED with the EXACT missing binding names (never a smoothed unknown)", () => {
    const capability = authorizedFeedCapability({});
    expect(capability.state).toBe("blocked");
    expect(capability.missingBindings).toEqual([
      SKILLCORNER_USERNAME_ENV,
      SKILLCORNER_PASSWORD_ENV,
      SKILLCORNER_MATCH_ID_ENV,
    ]);
    expect(capability.matchId).toBeNull();
    expect(capability.activationNote).toContain(SKILLCORNER_USERNAME_ENV);
    expect(capability.activationNote).toContain(SKILLCORNER_MATCH_ID_ENV);
  });

  test("each individual missing binding is named precisely", () => {
    const onlyUser = authorizedFeedCapability({ [SKILLCORNER_USERNAME_ENV]: "u" });
    expect(onlyUser.state).toBe("blocked");
    expect(onlyUser.missingBindings).toEqual([SKILLCORNER_PASSWORD_ENV, SKILLCORNER_MATCH_ID_ENV]);

    const noMatch = authorizedFeedCapability({
      [SKILLCORNER_USERNAME_ENV]: "u",
      [SKILLCORNER_PASSWORD_ENV]: "p",
    });
    expect(noMatch.state).toBe("blocked");
    expect(noMatch.missingBindings).toEqual([SKILLCORNER_MATCH_ID_ENV]);
  });

  test("blank/whitespace bindings count as MISSING (never an empty-string credential)", () => {
    const capability = authorizedFeedCapability({
      [SKILLCORNER_USERNAME_ENV]: "   ",
      [SKILLCORNER_PASSWORD_ENV]: "",
      [SKILLCORNER_MATCH_ID_ENV]: "2017461",
    });
    expect(capability.state).toBe("blocked");
    expect(capability.missingBindings).toEqual([
      SKILLCORNER_USERNAME_ENV,
      SKILLCORNER_PASSWORD_ENV,
    ]);
  });

  test("the complete binding set resolves READY with the non-secret facts (the recorded default base)", () => {
    const capability = authorizedFeedCapability({
      [SKILLCORNER_USERNAME_ENV]: "sporta-operator",
      [SKILLCORNER_PASSWORD_ENV]: "a-real-secret",
      [SKILLCORNER_MATCH_ID_ENV]: "2017461",
    });
    expect(capability.state).toBe("ready");
    expect(capability.missingBindings).toEqual([]);
    expect(capability.matchId).toBe("2017461");
    expect(capability.apiBase).toBe(SKILLCORNER_DEFAULT_API_BASE);
    // The secret NEVER appears in the capability surface.
    expect(JSON.stringify(capability)).not.toContain("a-real-secret");
  });

  test("an explicit API base overrides the recorded default (trailing slashes normalize)", () => {
    const resolved = authorizedSkillCornerConfig({
      [SKILLCORNER_USERNAME_ENV]: "u",
      [SKILLCORNER_PASSWORD_ENV]: "p",
      [SKILLCORNER_MATCH_ID_ENV]: "m",
      [SKILLCORNER_API_BASE_ENV]: "https://proxy.example.com/",
    });
    expect(resolved).not.toHaveProperty("blocked");
    expect((resolved as { apiBase: string }).apiBase).toBe("https://proxy.example.com");
  });

  test("the config resolution carries the secrets ONLY inside the config object (the feed's auth header)", () => {
    const resolved = authorizedSkillCornerConfig({
      [SKILLCORNER_USERNAME_ENV]: "sporta-operator",
      [SKILLCORNER_PASSWORD_ENV]: "a-real-secret",
      [SKILLCORNER_MATCH_ID_ENV]: "2017461",
    });
    expect("blocked" in resolved).toBe(false);
    expect(resolved).toMatchObject({
      provider: "skillcorner",
      username: "sporta-operator",
      matchId: "2017461",
    });
  });
});
