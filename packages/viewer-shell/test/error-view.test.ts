/**
 * Error-view tests (W702): the complete failure-class table — every class
 * the viewer can surface has a label, a retryability decision, and maps
 * through `errorViewFrom` without ever being swallowed.
 */
import { describe, expect, test } from "bun:test";
import {
  FAILURE_CLASS_LABELS,
  RETRYABLE_FAILURE_CLASSES,
  VIEWER_FAILURE_CLASSES,
  ViewerControlError,
  errorViewFrom,
  isViewerFailureClass,
  toErrorView,
} from "../src/errors.ts";
import type { ViewerFailureClass } from "../src/errors.ts";

const CONTROL_CLASSES = [
  "rights-denied",
  "media-invalid",
  "validation",
  "resource-limit",
  "internal",
  "unknown-session",
  "unknown-render",
  "unknown-route",
  "method-not-allowed",
] as const;

describe("failure class table — every class is labeled and retry-classified", () => {
  test("the class list is exactly the control classes + network + unsupported-output", () => {
    const expected: ViewerFailureClass[] = [...CONTROL_CLASSES, "network", "unsupported-output"];
    expect([...VIEWER_FAILURE_CLASSES].sort()).toEqual(expected.sort());
  });

  test("every class has a non-empty human label", () => {
    for (const failureClass of VIEWER_FAILURE_CLASSES) {
      const label = FAILURE_CLASS_LABELS[failureClass];
      expect(typeof label).toBe("string");
      expect(label.length).toBeGreaterThan(0);
    }
  });

  test("retryability matches the documented table", () => {
    expect(RETRYABLE_FAILURE_CLASSES.has("network")).toBe(true);
    expect(RETRYABLE_FAILURE_CLASSES.has("internal")).toBe(true);
    expect(RETRYABLE_FAILURE_CLASSES.has("resource-limit")).toBe(true);
    for (const failureClass of CONTROL_CLASSES) {
      if (failureClass === "internal" || failureClass === "resource-limit") continue;
      expect(RETRYABLE_FAILURE_CLASSES.has(failureClass)).toBe(false);
    }
    expect(RETRYABLE_FAILURE_CLASSES.has("unsupported-output")).toBe(false);
  });

  test("isViewerFailureClass validates", () => {
    expect(isViewerFailureClass("rights-denied")).toBe(true);
    expect(isViewerFailureClass("nonsense")).toBe(false);
    expect(isViewerFailureClass(42)).toBe(false);
  });
});

describe("errorViewFrom — nothing is swallowed", () => {
  test("a typed viewer error keeps its class, message, and details", () => {
    const error = new ViewerControlError("rights-denied", "playback access denied", {
      sessionId: "sess-1",
    });
    const view = errorViewFrom("loadOutput", error);
    expect(view).toEqual({
      failureClass: "rights-denied",
      label: "Rights denied",
      message: "playback access denied",
      retryable: false,
      operation: "loadOutput",
      details: { sessionId: "sess-1" },
    });
  });

  test("a raw Error becomes an internal view (surfaced, retryable)", () => {
    const view = errorViewFrom("connect", new Error("boom"));
    expect(view.failureClass).toBe("internal");
    expect(view.message).toBe("boom");
    expect(view.retryable).toBe(true);
  });

  test("a non-Error thrown value still surfaces with its string form", () => {
    const view = errorViewFrom("connect", "just a string");
    expect(view.failureClass).toBe("internal");
    expect(view.message).toBe("just a string");
    expect(view.retryable).toBe(true);
    expect(view.details).toEqual({ thrown: "string" });
  });

  test("toErrorView builds views from classified parts", () => {
    const view = toErrorView("connect", "network", "unreachable");
    expect(view.label).toBe("Connection failed");
    expect(view.retryable).toBe(true);
    expect(view.details).toEqual({});
  });
});
