import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { CONTRACT_SCHEMAS } from "../src/index";

const VALID_DIR = join(import.meta.dir, "..", "fixtures", "valid");
const INVALID_DIR = join(import.meta.dir, "..", "fixtures", "invalid");

/** Valid fixture file -> contract schema name in CONTRACT_SCHEMAS. */
const VALID_SCHEMA_BY_FILE: Record<string, string> = {
  "media-session.json": "media-session",
  "observation-detection.json": "observation",
  "observation-transcription.json": "observation",
  "event.json": "event",
  "world-snapshot.json": "world-snapshot",
  "render-request.json": "render-request",
  "stage-message.json": "stage-message",
};

/**
 * Invalid fixtures are single-defect variants of valid fixtures. Each case
 * names the schema to validate against and the expected issue path that must
 * appear in the rejection message tail.
 */
const INVALID_CASES: Array<{ file: string; schema: string; expectPathIn: string }> = [
  {
    file: "observation-confidence-out-of-range.json",
    schema: "observation",
    expectPathIn: "confidence",
  },
  { file: "event-evidence-empty.json", schema: "event", expectPathIn: "evidence" },
  {
    file: "event-interval-end-before-start.json",
    schema: "event",
    expectPathIn: "endTimeMs",
  },
  { file: "media-session-no-sources.json", schema: "media-session", expectPathIn: "sources" },
  {
    file: "render-request-missing-rights-capabilities.json",
    schema: "render-request",
    expectPathIn: "rightsCapabilities",
  },
];

function readJson(dir: string, file: string): unknown {
  return JSON.parse(readFileSync(join(dir, file), "utf8")) as unknown;
}

function schemaFor(name: string): z.ZodType {
  const schema = CONTRACT_SCHEMAS[name];
  if (!schema) {
    throw new Error(`no contract schema registered under "${name}"`);
  }
  return schema;
}

function failureTail(error: z.ZodError): string {
  return error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ");
}

describe("valid fixtures", () => {
  test("every file under fixtures/valid is registered", () => {
    const files = readdirSync(VALID_DIR)
      .filter((file) => file.endsWith(".json"))
      .sort();
    expect(files).toEqual(Object.keys(VALID_SCHEMA_BY_FILE).sort());
  });

  for (const [file, schemaName] of Object.entries(VALID_SCHEMA_BY_FILE)) {
    test(`validates against "${schemaName}": ${file}`, () => {
      const result = schemaFor(schemaName).safeParse(readJson(VALID_DIR, file));
      if (!result.success) {
        throw new Error(
          `valid fixture "${file}" was rejected by "${schemaName}": ${failureTail(result.error)}`,
        );
      }
      expect(result.success).toBe(true);
    });
  }
});

describe("invalid fixtures", () => {
  test("every declared invalid fixture exists on disk", () => {
    const files = readdirSync(INVALID_DIR)
      .filter((file) => file.endsWith(".json"))
      .sort();
    const declared = INVALID_CASES.map((c) => c.file).sort();
    expect(files).toEqual(declared);
  });

  for (const { file, schema: schemaName, expectPathIn } of INVALID_CASES) {
    test(`rejected by "${schemaName}": ${file}`, () => {
      const result = schemaFor(schemaName).safeParse(readJson(INVALID_DIR, file));
      if (result.success) {
        throw new Error(
          `invalid fixture "${file}" must be REJECTED by "${schemaName}" but validated`,
        );
      }
      const tail = failureTail(result.error);
      expect(tail.length).toBeGreaterThan(0);
      expect(tail).toContain(expectPathIn);
    });
  }
});
