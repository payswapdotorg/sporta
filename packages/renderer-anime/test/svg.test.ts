import { describe, expect, test } from "bun:test";
import {
  BALL_STYLE,
  CANVAS_H,
  CANVAS_W,
  FIELD_PALETTE,
  PLAYER_PALETTE,
  animeEntityStyle,
  composeFrameSvg,
  escapeXml,
  possessionRingSvg,
} from "../src/index";
import type { SvgFrameInput, SvgMarker } from "../src/index";

/** A minimal in-play participant marker. */
function participantMarker(entityId: string, x: number, y: number): SvgMarker {
  return {
    entityId,
    kind: "participant",
    canvas: { x, y },
    outOfPlay: false,
    uncertain: false,
    style: animeEntityStyle(entityId),
  };
}

/** The base scene every composition test starts from. */
function baseScene(overrides: Partial<SvgFrameInput> = {}): SvgFrameInput {
  return {
    frameIndex: 0,
    markers: [],
    possession: null,
    statusLine: null,
    eventPhrases: [],
    ...overrides,
  };
}

describe("composeFrameSvg — document structure (deterministic order)", () => {
  const svg = composeFrameSvg(baseScene());

  test("well-formed SVG root with the fixed viewBox and frame title", () => {
    expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1170 880">')).toBe(
      true,
    );
    expect(svg.endsWith("</svg>")).toBe(true);
    expect(svg).toContain("<title>anime.prototype frame 0</title>");
  });

  test("grass: 10 alternating full-width stripes above the caption band", () => {
    expect(svg).toContain('x="0" y="0" width="117" height="800"');
    expect(svg).toContain(`fill="${FIELD_PALETTE.grassLight}"`);
    expect(svg).toContain(`fill="${FIELD_PALETTE.grassDark}"`);
    const stripes = svg.match(/<rect x="-?\d+(\.\d+)?" y="0"/g);
    expect(stripes).toHaveLength(10);
  });

  test("pitch markings: boundary, halfway, center circle, boxes, spots, arcs (pinned fragments)", () => {
    expect(svg).toContain('<rect x="60" y="60" width="1050" height="680"');
    expect(svg).toContain('<line x1="585" y1="60" x2="585" y2="740"');
    expect(svg).toContain('<circle cx="585" cy="400" r="91.5"');
    expect(svg).toContain('<circle cx="585" cy="400" r="3"');
    expect(svg).toContain('<rect x="60" y="198.4" width="165" height="403.2"');
    expect(svg).toContain('<rect x="945" y="198.4" width="165" height="403.2"');
    expect(svg).toContain('<rect x="60" y="308.4" width="55" height="183.2"');
    expect(svg).toContain('<rect x="1055" y="308.4" width="55" height="183.2"');
    expect(svg).toContain('<circle cx="170" cy="400" r="3"');
    expect(svg).toContain('<circle cx="1000" cy="400" r="3"');
    expect(svg).toContain('d="M 225 326.88 A 91.5 91.5 0 0 1 225 473.12"');
    expect(svg).toContain('d="M 945 326.88 A 91.5 91.5 0 0 0 945 473.12"');
  });

  test("caption band rect spans the full canvas bottom", () => {
    expect(svg).toContain(`y="800" width="1170" height="80" fill="${FIELD_PALETTE.captionBand}"`);
  });

  test("canvas constants are consistent (1170 × 880)", () => {
    expect(CANVAS_W).toBe(1170);
    expect(CANVAS_H).toBe(880);
  });
});

describe("composeFrameSvg — markers", () => {
  test("participant marker: identity-stable palette colors + entity label", () => {
    const svg = composeFrameSvg(baseScene({ markers: [participantMarker("player-7", 585, 400)] }));
    const style = animeEntityStyle("player-7");
    expect(svg).toContain(
      `<circle cx="585" cy="400" r="12" fill="${style.jersey}" stroke="${style.trim}" stroke-width="3"/>`,
    );
    expect(svg).toContain(`fill="${PLAYER_PALETTE[1]!.jersey}"`);
    expect(svg).toContain(`<text x="585" y="426" text-anchor="middle" font-size="13"`);
    expect(svg).toContain(">player-7</text>");
  });

  test("ball marker: fixed style, no label, NO opacity attribute when confidence absent", () => {
    const marker: SvgMarker = {
      entityId: "ball-1",
      kind: "ball",
      canvas: { x: 565, y: 405 },
      outOfPlay: false,
      uncertain: false,
    };
    const svg = composeFrameSvg(baseScene({ markers: [marker] }));
    expect(svg).toContain(
      `<circle cx="565" cy="405" r="6" fill="${BALL_STYLE.fill}" stroke="${BALL_STYLE.stroke}" stroke-width="2"/>`,
    );
    expect(svg).not.toContain("opacity="); // honest: no confidence, no visual claim
  });

  test("ball confidence drives opacity via the documented formula (0.9 → 0.935)", () => {
    const marker: SvgMarker = {
      entityId: "ball-1",
      kind: "ball",
      canvas: { x: 565, y: 405 },
      outOfPlay: false,
      uncertain: false,
      confidence: 0.9,
    };
    const svg = composeFrameSvg(baseScene({ markers: [marker] }));
    expect(svg).toContain('opacity="0.935"');
  });

  test("uncertain (candidate) participant position: dashed halo ring in the trim color", () => {
    const certain = composeFrameSvg(
      baseScene({ markers: [participantMarker("player-9", 360, 260)] }),
    );
    expect(certain).not.toContain('stroke-dasharray="4 3"'); // certain: no halo
    const uncertainMarker: SvgMarker = {
      ...participantMarker("player-9", 360, 260),
      uncertain: true,
    };
    const svg = composeFrameSvg(baseScene({ markers: [uncertainMarker] }));
    const style = animeEntityStyle("player-9");
    expect(svg).toContain(
      `<circle cx="360" cy="260" r="17" fill="none" stroke="${style.trim}" stroke-width="2" stroke-dasharray="4 3"/>`,
    );
  });

  test("out-of-play marker: dashed red ring + OUT tag, TRUE position (never clamped)", () => {
    const outMarker: SvgMarker = {
      ...participantMarker("player-out", 30, 400),
      outOfPlay: true,
    };
    const svg = composeFrameSvg(baseScene({ markers: [outMarker] }));
    expect(svg).toContain('data-entity="player-out" data-out-of-play="true"');
    expect(svg).toContain(
      `<circle cx="30" cy="400" r="12" fill="none" stroke="${FIELD_PALETTE.outOfPlay}" stroke-width="3" stroke-dasharray="6 4"/>`,
    );
    expect(svg).toContain(`>OUT</text>`);
  });

  test("a participant marker WITHOUT a style fails loudly (descriptive TypeError)", () => {
    const styleless: SvgMarker = {
      entityId: "player-x",
      kind: "participant",
      canvas: { x: 585, y: 400 },
      outOfPlay: false,
      uncertain: false,
    };
    expect(() => composeFrameSvg(baseScene({ markers: [styleless] }))).toThrow(TypeError);
    expect(() => composeFrameSvg(baseScene({ markers: [styleless] }))).toThrow(
      /player-x.*requires SvgMarker\.style/,
    );
  });

  test("markers render in input order (snapshot order preserved, no re-sorting)", () => {
    const svg = composeFrameSvg(
      baseScene({
        markers: [
          { ...participantMarker("alpha-1", 100, 100) },
          { ...participantMarker("beta-2", 200, 200) },
        ],
      }),
    );
    const alphaAt = svg.indexOf('data-entity="alpha-1"');
    const betaAt = svg.indexOf('data-entity="beta-2"');
    expect(alphaAt).toBeGreaterThan(-1);
    expect(betaAt).toBeGreaterThan(alphaAt);
  });
});

describe("composeFrameSvg — possession ring", () => {
  test("drawn UNDER the possessing participant marker, matched by entity id", () => {
    const scene = baseScene({
      markers: [participantMarker("player-7", 585, 400)],
      possession: { entityId: "player-7", canvas: { x: 585, y: 400 } },
    });
    const svg = composeFrameSvg(scene);
    const ringAt = svg.indexOf('<circle cx="585" cy="400" r="20"');
    const markerAt = svg.indexOf('data-entity="player-7"');
    expect(ringAt).toBeGreaterThan(-1);
    expect(ringAt).toBeLessThan(markerAt); // ring first, marker second
    expect(svg).toContain(
      `fill="none" stroke="${FIELD_PALETTE.captionEventText}" stroke-width="3" stroke-dasharray="8 6"`,
    );
  });

  test("no ring when possession is null; ring opacity from confidence when present", () => {
    const noRing = composeFrameSvg(
      baseScene({ markers: [participantMarker("player-7", 585, 400)] }),
    );
    expect(noRing).not.toContain('r="20"');
    const ring = possessionRingSvg({
      entityId: "player-7",
      canvas: { x: 585, y: 400 },
      confidence: 0.75,
    });
    expect(ring).toContain('opacity="0.838"'); // 0.35 + 0.65·0.75 = 0.8375 → 0.838
    const ringNoConfidence = possessionRingSvg({
      entityId: "player-7",
      canvas: { x: 585, y: 400 },
    });
    expect(ringNoConfidence).not.toContain("opacity=");
  });

  test("a possession ring for an entity with no marker is simply absent", () => {
    const svg = composeFrameSvg(
      baseScene({
        markers: [participantMarker("player-7", 585, 400)],
        possession: { entityId: "player-11", canvas: { x: 100, y: 100 } },
      }),
    );
    expect(svg).not.toContain('r="20"');
  });
});

describe("composeFrameSvg — caption band", () => {
  test("status line on the first band line (verbatim template text)", () => {
    const svg = composeFrameSvg(baseScene({ statusLine: "First half · 12:34 · 1-0?" }));
    expect(svg).toContain(`fill="${FIELD_PALETTE.captionText}">First half · 12:34 · 1-0?</text>`);
    expect(svg).toContain('y="838"');
  });

  test("event phrases on the second band line, input order, joined by ' · '", () => {
    const svg = composeFrameSvg(baseScene({ eventPhrases: ["GOAL!", "Save!"] }));
    expect(svg).toContain(`fill="${FIELD_PALETTE.captionEventText}">GOAL! · Save!</text>`);
    expect(svg).toContain('y="868"');
  });

  test("empty captions draw the band but no text elements", () => {
    const svg = composeFrameSvg(baseScene());
    expect(svg.match(/<text/g)).toBeNull();
  });

  test("XML escaping: entity ids and caption text are escaped (never raw)", () => {
    const svg = composeFrameSvg(
      baseScene({
        markers: [participantMarker('weird&id<"x"', 585, 400)],
        statusLine: "a<b&c",
      }),
    );
    expect(svg).toContain('data-entity="weird&amp;id&lt;&quot;x&quot;"');
    expect(svg).toContain(">a&lt;b&amp;c</text>");
    expect(escapeXml(`&<>"'`)).toBe("&amp;&lt;&gt;&quot;&apos;");
  });
});

describe("composeFrameSvg — determinism (byte-identical rerun)", () => {
  const scene = baseScene({
    markers: [
      participantMarker("player-7", 585, 400),
      {
        entityId: "ball-1",
        kind: "ball",
        canvas: { x: 565, y: 405 },
        outOfPlay: false,
        uncertain: true,
        confidence: 0.9,
      },
    ],
    possession: { entityId: "player-7", canvas: { x: 585, y: 400 }, confidence: 0.75 },
    statusLine: "First half · 12:34 · 1-0?",
    eventPhrases: ["GOAL!"],
  });

  test("the same scene composes a byte-identical document every call", () => {
    expect(composeFrameSvg(scene)).toBe(composeFrameSvg(scene));
  });

  test("distinct frames differ only in the frame index title", () => {
    const first = composeFrameSvg({ ...scene, frameIndex: 0 });
    const second = composeFrameSvg({ ...scene, frameIndex: 1 });
    expect(first).not.toBe(second);
    expect(second).toContain("<title>anime.prototype frame 1</title>");
  });
});
