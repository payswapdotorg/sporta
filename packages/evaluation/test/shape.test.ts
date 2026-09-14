/**
 * W403 structural self-check tests (`assertArtifactShape`): the minimal
 * artifact passes; unknown or missing keys at every representative level
 * fail LOUD with the full JSON path (the wildcard-rule hole this module
 * closes); stateAt keys are fixture data, not free-form.
 */
import { describe, expect, test } from "bun:test";
import { assertArtifactShape } from "../src/shape";
import { cloneArtifact, minimalArtifact } from "./helpers";
import type { WorldModelArtifact } from "../src/artifact";

const PINS = [1_000];

describe("assertArtifactShape — the happy path", () => {
  test("the minimal artifact passes (every known key, in place)", () => {
    expect(() => assertArtifactShape(minimalArtifact(), PINS)).not.toThrow();
  });
});

describe("assertArtifactShape — unknown keys fail loud with the path", () => {
  test("unknown root key", () => {
    const artifact = cloneArtifact(minimalArtifact());
    (artifact as unknown as Record<string, unknown>).extraRoot = 1;
    expect(() => assertArtifactShape(artifact, PINS)).toThrow(
      /\$ carries unknown key\(s\) \[extraRoot\]/,
    );
  });

  test("unknown fusion-report key", () => {
    const artifact = cloneArtifact(minimalArtifact());
    (artifact.fusion.first as unknown as Record<string, unknown>).extraReport = 1;
    expect(() => assertArtifactShape(artifact, PINS)).toThrow(
      /\$\.fusion\.first carries unknown key\(s\) \[extraReport\]/,
    );
  });

  test("unknown snapshot key (stateAt pin)", () => {
    const artifact = cloneArtifact(minimalArtifact());
    (artifact.stateAt["1000"] as unknown as Record<string, unknown>).extraSnapshot = 1;
    expect(() => assertArtifactShape(artifact, PINS)).toThrow(
      /\$\.stateAt\.1000 carries unknown key\(s\) \[extraSnapshot\]/,
    );
  });

  test("unknown entity-state slot key", () => {
    const artifact = cloneArtifact(minimalArtifact());
    (artifact.stateAt["1000"]!.entities[0]!.state as unknown as Record<string, unknown>).extraSlot =
      1;
    expect(() => assertArtifactShape(artifact, PINS)).toThrow(
      /\$\.stateAt\.1000\.entities\[0\]\.state carries unknown key\(s\) \[extraSlot\]/,
    );
  });

  test("unknown event key", () => {
    const artifact = cloneArtifact(minimalArtifact());
    (artifact.eventWindow.entries[0]!.event as unknown as Record<string, unknown>).extraEvent = 1;
    expect(() => assertArtifactShape(artifact, PINS)).toThrow(
      /\$\.eventWindow\.entries\[0\]\.event carries unknown key\(s\) \[extraEvent\]/,
    );
  });

  test("unknown conflict-record key", () => {
    const artifact = cloneArtifact(minimalArtifact());
    (artifact.fusion.first.conflicts[0] as unknown as Record<string, unknown>).extraConflict = 1;
    expect(() => assertArtifactShape(artifact, PINS)).toThrow(
      /\$\.fusion\.first\.conflicts\[0\] carries unknown key\(s\) \[extraConflict\]/,
    );
  });

  test("unknown replay key", () => {
    const artifact = cloneArtifact(minimalArtifact());
    (artifact.replay as unknown as Record<string, unknown>).extraReplay = 1;
    expect(() => assertArtifactShape(artifact, PINS)).toThrow(
      /\$\.replay carries unknown key\(s\) \[extraReplay\]/,
    );
  });
});

describe("assertArtifactShape — missing keys and pin discipline", () => {
  test("missing required key fails loud", () => {
    const artifact = cloneArtifact(minimalArtifact());
    delete (artifact.stateAt["1000"] as unknown as Record<string, unknown>).watermark;
    expect(() => assertArtifactShape(artifact, PINS)).toThrow(
      /\$\.stateAt\.1000 is missing required key "watermark"/,
    );
  });

  test("a stateAt key that is not a fixture pin fails loud", () => {
    const artifact = cloneArtifact(minimalArtifact());
    (artifact.stateAt as Record<string, WorldModelArtifact["stateAt"][string]>)["2500"] =
      artifact.stateAt["1000"]!;
    expect(() => assertArtifactShape(artifact, PINS)).toThrow(
      /not the fixture's pinned timestamps/,
    );
  });

  test("a missing pinned timestamp fails loud", () => {
    const artifact = cloneArtifact(minimalArtifact());
    delete (artifact.stateAt as Record<string, unknown>)["1000"];
    expect(() => assertArtifactShape(artifact, PINS)).toThrow(
      /\$\.stateAt is missing the pinned timestamp "1000"/,
    );
  });

  test("non-array containers fail loud", () => {
    const artifact = cloneArtifact(minimalArtifact());
    (artifact.eventWindow as unknown as Record<string, unknown>).entries = {};
    expect(() => assertArtifactShape(artifact, PINS)).toThrow(
      /\$\.eventWindow\.entries must be an array/,
    );
  });
});
