/**
 * W504 encoder unit tests: SMIL structure byte-pinned, frame timing math
 * exact, determinism reruns deep-equal, malformed render output fail-loud.
 *
 * The canonical fixture is the 6-step W502 clip (test/helpers.ts), encoded
 * through the REAL `renderAnimeClip` — pinned values were computed once from
 * this exact fixture and are asserted verbatim (byte-level pinning).
 */
import { describe, expect, test } from "bun:test";
import { renderAnimeClip } from "@sporta/renderer-anime";
import type { AnimeRenderOutput } from "@sporta/renderer-anime";
import {
  SEGMENT_ID_PREFIX,
  contentHashOf,
  encodeAnimeClip,
  formatSmilClock,
  segmentIdentityOf,
  segmentIdOf,
} from "../src/index";
import { SegmentEncodingError } from "../src/index";
import { buildClipRequest, buildFixtureOutput, buildFixtureSteps } from "./helpers";

/** The canonical fixture output + its encoding (deterministic). */
const output = buildFixtureOutput();
const segment = encodeAnimeClip(output);

// Pinned fixture values (computed once from the fixture above).
const PINNED = {
  segmentId: "anime-clip-2c334347",
  contentHash: "f866c3a89f630112f4f1460aac94ddd57efe7ebe62e129259b7935ce6081f6a8",
  byteLength: 17_551,
} as const;

/** The `<set …/>` prefix of each frame group, byte-pinned. */
const FRAME_SET_TAGS = [
  '<g data-frame-index="0" display="none"><set attributeName="display" to="inline" begin="0s" dur="1s" fill="remove"/>',
  '<g data-frame-index="1" display="none"><set attributeName="display" to="inline" begin="1s" dur="1s" fill="remove"/>',
  '<g data-frame-index="2" display="none"><set attributeName="display" to="inline" begin="2s" dur="1s" fill="remove"/>',
  '<g data-frame-index="3" display="none"><set attributeName="display" to="inline" begin="3s" dur="1s" fill="remove"/>',
  '<g data-frame-index="4" display="none"><set attributeName="display" to="inline" begin="4s" dur="1s" fill="remove"/>',
  '<g data-frame-index="5" display="none"><set attributeName="display" to="inline" begin="5s" dur="1s" fill="freeze"/>',
] as const;

describe("encodeAnimeClip — SMIL document structure (byte-pinned)", () => {
  test("root + title + desc prefix is exact", () => {
    expect(
      segment.content.startsWith(
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1170 880" width="1170" height="880">',
      ),
    ).toBe(true);
    expect(segment.content).toContain("<title>anime.prototype@0.1.0 animated clip</title>");
    expect(segment.content).toContain(
      `<desc>segmentId=${PINNED.segmentId} frameCount=6 totalDurationMs=6000</desc>`,
    );
  });

  test("one display-none frame group per frame, in W502 frame order", () => {
    expect(segment.content.match(/<g data-frame-index="\d+" display="none">/g)).toHaveLength(6);
    for (const setTag of FRAME_SET_TAGS) {
      expect(segment.content).toContain(setTag);
    }
  });

  test("every frame's W502 inner content (incl. its own <title>) is embedded", () => {
    for (const frame of output.frames) {
      expect(segment.content).toContain(`<title>anime.prototype frame ${frame.frameIndex}</title>`);
    }
    // The pitch boundary rect from the W502 frame is present (inner content
    // was preserved, not re-synthesized).
    expect(segment.content).toContain(
      '<rect x="60" y="60" width="1050" height="680" fill="none" stroke="#f2f7ee" stroke-width="3"/>',
    );
  });

  test("the LAST frame freezes; every other frame removes (exclusive windows)", () => {
    const fills = [...segment.content.matchAll(/fill="(remove|freeze)"/g)].map((m) => m[1]);
    expect(fills).toEqual(["remove", "remove", "remove", "remove", "remove", "freeze"]);
  });

  test("the document closes with </svg> and declares no scripts or external refs", () => {
    expect(segment.content.endsWith("</svg>")).toBe(true);
    expect(segment.content).not.toContain("<script");
    expect(segment.content).not.toContain("href");
    expect(segment.content).not.toContain("xlink");
  });
});

describe("encodeAnimeClip — frame timing math (exact, never invented)", () => {
  test("container manifest timing equals the W502 windows verbatim", () => {
    expect(segment.manifest.frames).toEqual(
      output.manifest.frames.map((frame, index) => ({
        frameIndex: index,
        outputTimestampMs: frame.outputTimestampMs,
        beginMs: frame.outputTimestampMs - output.manifest.output.startMs,
        durMs: frame.windowMs.endMs - frame.windowMs.startMs,
      })),
    );
    expect(segment.manifest.frames.map((frame) => [frame.beginMs, frame.durMs])).toEqual([
      [0, 1000],
      [1000, 1000],
      [2000, 1000],
      [3000, 1000],
      [4000, 1000],
      [5000, 1000],
    ]);
  });

  test("SMIL begin/dur attributes agree exactly with the manifest timings", () => {
    const sets = [
      ...segment.content.matchAll(
        /<set attributeName="display" to="inline" begin="([^"]*)" dur="([^"]*)" fill="([^"]*)"\/>/g,
      ),
    ];
    expect(sets).toHaveLength(6);
    for (let i = 0; i < sets.length; i += 1) {
      const match = sets[i]!;
      const timing = segment.manifest.frames[i]!;
      expect(match[1]).toBe(formatSmilClock(timing.beginMs));
      expect(match[2]).toBe(formatSmilClock(timing.durMs));
    }
  });

  test("container manifest scalars: frameCount, totalDurationMs, sessionId, format", () => {
    expect(segment.manifest.frameCount).toBe(6);
    expect(segment.manifest.totalDurationMs).toBe(output.manifest.output.durationMs);
    expect(segment.manifest.sessionId).toBe(output.manifest.session.sessionId);
    expect(segment.manifest.format).toEqual({ kind: "animated-svg", version: 1 });
  });
});

describe("encodeAnimeClip — identity, integrity, provenance", () => {
  test("pinned deterministic segment id and content hash", () => {
    expect(segment.segmentId).toBe(PINNED.segmentId);
    expect(segment.segmentId.startsWith(SEGMENT_ID_PREFIX)).toBe(true);
    expect(segment.contentHash).toBe(PINNED.contentHash);
    expect(segment.contentHash).toMatch(/^[0-9a-f]{64}$/); // sha-256, 64 hex
    expect(segment.byteLength).toBe(PINNED.byteLength);
    expect(segment.contentType).toBe("image/svg+xml");
  });

  test("hash + byte length are MEASURED from the document", () => {
    expect(segment.contentHash).toBe(contentHashOf(segment.content));
    expect(segment.byteLength).toBe(new TextEncoder().encode(segment.content).length);
    expect(segment.manifest.contentHash).toBe(segment.contentHash);
    expect(segment.manifest.segmentId).toBe(segment.segmentId);
  });

  test("the W502 render manifest is carried VERBATIM (deep-equal, unmodified)", () => {
    expect(segment.manifest.sourceManifest).toEqual(output.manifest);
    expect(segment.manifest.sourceManifest).toBe(segment.manifest.sourceManifest); // stable ref
    // Encoding did not mutate the input manifest.
    expect(output.manifest.frames).toHaveLength(6);
    expect(output.frames).toHaveLength(6);
  });

  test("segment identity is a pure function of the render identity, NOT the content", () => {
    // Same identity fields, different frame content (player-7 moved +5m):
    // the manifest identity (renderer, style, session, snapshot version,
    // event tail, output window, frame count) is unchanged.
    const shiftedSteps = buildFixtureSteps().map((step) => {
      const clone = structuredClone(step);
      const player7 = clone.snapshot.entities[0]!;
      const slot = player7.state.pitchPosition!;
      slot.value = { x: (slot.value as { x: number; y: number }).x + 5, y: 34 };
      return clone;
    });
    const rerendered = renderAnimeClip(buildClipRequest(), shiftedSteps);
    expect(rerendered.manifest.session).toEqual(output.manifest.session);
    expect(segmentIdentityOf(rerendered.manifest)).toBe(segmentIdentityOf(output.manifest));
    expect(segmentIdOf(rerendered.manifest)).toBe(segment.segmentId);
    // …but the content differs — the store's conflict path (same id,
    // different content → fail-loud) is reachable by construction.
    const shiftedSegment = encodeAnimeClip(rerendered);
    expect(shiftedSegment.contentHash).not.toBe(segment.contentHash);
    expect(shiftedSegment.content).not.toBe(segment.content);
  });

  test("different snapshot version → different segment id (identity fields matter)", () => {
    const otherRequest = buildClipRequest();
    otherRequest.snapshotVersion = 2;
    const otherOutput = renderAnimeClip(otherRequest, buildFixtureSteps());
    expect(segmentIdOf(otherOutput.manifest)).not.toBe(segment.segmentId);
  });
});

describe("encodeAnimeClip — determinism", () => {
  test("re-encoding the same output is byte-identical + deep-equal", () => {
    const second = encodeAnimeClip(buildFixtureOutput());
    expect(second.content).toBe(segment.content);
    expect(second.manifest).toEqual(segment.manifest);
    expect(second.segmentId).toBe(segment.segmentId);
    expect(second.contentHash).toBe(segment.contentHash);
  });

  test("encoding a deep clone of the output is byte-identical (no reference tricks)", () => {
    const cloned = structuredClone(output);
    const second = encodeAnimeClip(cloned);
    expect(second.content).toBe(segment.content);
  });

  test("encode does not mutate its input", () => {
    const before = structuredClone(output);
    encodeAnimeClip(output);
    expect(output).toEqual(before);
  });
});

describe("encodeAnimeClip — malformed render output fails loud", () => {
  /** Deep clone of the fixture output for mutation. */
  function mutated(mutate: (output: AnimeRenderOutput) => void): AnimeRenderOutput {
    const clone = structuredClone(output);
    mutate(clone);
    return clone;
  }

  test("empty frames", () => {
    expect(() =>
      encodeAnimeClip(
        mutated((o) => {
          o.frames = [];
        }),
      ),
    ).toThrow(SegmentEncodingError);
  });

  test("frames/manifest length mismatch", () => {
    expect(() =>
      encodeAnimeClip(
        mutated((o) => {
          o.frames.pop();
        }),
      ),
    ).toThrow(/same length/);
  });

  test("frameIndex sequence broken", () => {
    expect(() =>
      encodeAnimeClip(
        mutated((o) => {
          o.frames[3]!.frameIndex = 9;
        }),
      ),
    ).toThrow(/frameIndex/);
  });

  test("frame timestamp disagrees with the manifest", () => {
    expect(() =>
      encodeAnimeClip(
        mutated((o) => {
          o.frames[2]!.outputTimestampMs = 3_500;
        }),
      ),
    ).toThrow(/outputTimestampMs/);
  });

  test("first frame not anchored at output.startMs", () => {
    expect(() =>
      encodeAnimeClip(
        mutated((o) => {
          // Both sides of the timestamp agreement are moved, so the failure is
          // specifically the start anchor, not the frame/manifest mismatch.
          o.frames[0]!.outputTimestampMs = 1_001;
          o.manifest.frames[0]!.outputTimestampMs = 1_001;
        }),
      ),
    ).toThrow(/startMs/);
  });

  test("non-contiguous output windows (a gap)", () => {
    expect(() =>
      encodeAnimeClip(
        mutated((o) => {
          // Frame 1's window is shortened, so frame 2's start no longer
          // continues it — a pure contiguity break.
          o.manifest.frames[1]!.windowMs = { startMs: 2_000, endMs: 2_900 };
        }),
      ),
    ).toThrow(/contiguous/);
  });

  test("degenerate window (endMs <= startMs)", () => {
    expect(() =>
      encodeAnimeClip(
        mutated((o) => {
          o.manifest.frames[2]!.windowMs = { startMs: 3_000, endMs: 3_000 };
        }),
      ),
    ).toThrow(/must be > windowMs.startMs/);
  });

  test("last window does not end at startMs + durationMs", () => {
    expect(() =>
      encodeAnimeClip(
        mutated((o) => {
          o.manifest.frames[5]!.windowMs = { startMs: 6_000, endMs: 6_500 };
        }),
      ),
    ).toThrow(/durationMs/);
  });

  test("frame svg is not an SVG document", () => {
    expect(() =>
      encodeAnimeClip(
        mutated((o) => {
          o.frames[1]!.svg = "<div>not svg</div>";
        }),
      ),
    ).toThrow(/svg/);
  });

  test("frame svg with an embedded </svg> before the trailing close fails loud", () => {
    // The mutated document still starts with `<svg` and ends with `</svg>`
    // (the shape checks pass), but its inner content carries a stray close
    // tag — splicing it into the composed document would emit broken XML.
    expect(() =>
      encodeAnimeClip(
        mutated((o) => {
          const svg = o.frames[1]!.svg;
          o.frames[1]!.svg = `${svg.slice(0, -"</svg>".length)}</g></svg></svg>`;
        }),
      ),
    ).toThrow(/embedded/);
  });

  test("frame viewBox disagrees with the output profile resolution", () => {
    expect(() =>
      encodeAnimeClip(
        mutated((o) => {
          o.manifest.output.profile.resolution = { w: 800, h: 600 };
        }),
      ),
    ).toThrow(/viewBox/);
  });

  test("non-finite duration", () => {
    expect(() =>
      encodeAnimeClip(
        mutated((o) => {
          o.manifest.output.durationMs = Number.NaN;
        }),
      ),
    ).toThrow(/durationMs/);
  });

  test("non-object output", () => {
    expect(() => encodeAnimeClip(null as unknown as AnimeRenderOutput)).toThrow(
      SegmentEncodingError,
    );
    expect(() => encodeAnimeClip({} as AnimeRenderOutput)).toThrow(SegmentEncodingError);
  });

  test("every rejection carries structured details", () => {
    try {
      encodeAnimeClip(
        mutated((o) => {
          o.frames = [];
        }),
      );
      expect.unreachable();
    } catch (err) {
      expect(err instanceof SegmentEncodingError).toBe(true);
      if (err instanceof SegmentEncodingError) {
        expect(err.failureClass).toBe("media-invalid");
        expect(err.message.length).toBeGreaterThan(0);
      }
    }
  });
});

describe("formatSmilClock — deterministic serialization (pinned)", () => {
  test("integer milliseconds serialize exactly", () => {
    expect(formatSmilClock(0)).toBe("0s");
    expect(formatSmilClock(1)).toBe("0.001s");
    expect(formatSmilClock(1_000)).toBe("1s");
    expect(formatSmilClock(1_500)).toBe("1.5s");
    expect(formatSmilClock(1_234)).toBe("1.234s");
    expect(formatSmilClock(60_000)).toBe("60s");
    expect(formatSmilClock(3_600_000)).toBe("3600s");
  });

  test("fractional milliseconds serialize at microsecond precision", () => {
    expect(formatSmilClock(999.5)).toBe("0.9995s");
    expect(formatSmilClock(1_234.25)).toBe("1.23425s");
  });

  test("invalid clock values fail loud", () => {
    expect(() => formatSmilClock(-1)).toThrow(SegmentEncodingError);
    expect(() => formatSmilClock(Number.NaN)).toThrow(SegmentEncodingError);
    expect(() => formatSmilClock(Number.POSITIVE_INFINITY)).toThrow(SegmentEncodingError);
  });
});

describe("contentHashOf — sha-256 via Bun.CryptoHasher (the W101 precedent)", () => {
  /** sha-256 of a string's UTF-8 bytes, computed in-test with the raw hasher. */
  function rawSha256(content: string): string {
    const hasher = new Bun.CryptoHasher("sha256");
    hasher.update(new TextEncoder().encode(content));
    return hasher.digest("hex");
  }

  test("known-answer pins (RFC 6234 / FIPS 180-2 test vectors)", () => {
    expect(contentHashOf("")).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
    expect(contentHashOf("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });

  test("agrees exactly with an in-test Bun.CryptoHasher over the fixture document", () => {
    expect(contentHashOf(segment.content)).toBe(rawSha256(segment.content));
    expect(segment.contentHash).toBe(rawSha256(segment.content));
  });

  test("64 lowercase hex digits; same content = same id; different content = different id", () => {
    expect(segment.contentHash).toMatch(/^[0-9a-f]{64}$/);
    expect(contentHashOf(segment.content)).toBe(contentHashOf(`${segment.content}`));
    expect(contentHashOf(segment.content)).not.toBe(contentHashOf(`${segment.content} `));
  });
});
