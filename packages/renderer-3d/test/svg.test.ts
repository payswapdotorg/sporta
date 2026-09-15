import { describe, expect, test } from "bun:test";
import { projectScene } from "@sporta/scene-projection";
import { buildEventEnvelope, buildWorldSnapshot } from "@sporta/testing";
import {
  buildFieldGeometry,
  cameraFromSlot,
  composeFrame3dSvg,
  render3dClip,
  render3dFromSnapshot,
  FIELD_PALETTE,
} from "../src/index";
import { build3dRequest, buildFixtureClip } from "./helpers";
import type { WorldEventStreamEntry } from "@sporta/contracts";

const CANVAS = { width: 1280, height: 720 };

/** The fixture clip's frame 0 SVG (rendered once per test group). */
function fixtureFrameSvg(frameIndex: number): string {
  const out = render3dClip(build3dRequest(), buildFixtureClip());
  return out.frames[frameIndex]!.svg;
}

describe("composeFrame3dSvg — document structure (painter's order)", () => {
  const svg = fixtureFrameSvg(0);

  test("root: the svg element, title, and backdrop", () => {
    expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1280 720">')).toBe(
      true,
    );
    expect(svg).toContain("<title>avatar-field.prototype frame 0</title>");
    expect(svg.endsWith("</svg>")).toBe(true);
    expect(svg).toContain('<rect x="0" y="0" width="1280" height="720" fill="#232b36"/>');
  });

  test("element counts: 22 polygons, 156 lines, 8 circles, 8 texts, 5 groups", () => {
    expect((svg.match(/<polygon/g) ?? []).length).toBe(22); // 12 ground + halo + shadow + possession + 7 figure quads/wedges
    expect((svg.match(/<line/g) ?? []).length).toBe(156); // 155 field lines + 1 ball drop line
    expect((svg.match(/<circle/g) ?? []).length).toBe(8); // 3 heads + ball + OUT ring + 2 spots + center mark
    expect((svg.match(/<text/g) ?? []).length).toBe(8); // 4 labels + OUT tag + 3 HUD lines
    expect((svg.match(/<g /g) ?? []).length).toBe(5); // the 5 DRAWN entities only
  });

  test("the drawn entities appear in painter's order (depth far → near)", () => {
    const order = [...svg.matchAll(/data-entity="([^"]+)"/g)].map((match) => match[1]);
    expect(order).toEqual(["official-1", "outlier-8", "ball-1", "striker-9", "winger-7"]);
  });

  test("omitted entities never appear in the document", () => {
    expect(svg).not.toContain('data-entity="bench-12"');
    expect(svg).not.toContain('data-entity="corner-player"');
    expect(svg).not.toContain('data-entity="team-home"');
  });

  test("the document is self-contained: no scripts, no references", () => {
    expect(svg).not.toContain("<script");
    expect(svg).not.toContain("href");
    expect(svg).not.toContain("xlink");
    expect(svg).not.toContain("url(");
    // The ONLY http occurrence is the required SVG xmlns declaration.
    expect((svg.match(/http:\/\//g) ?? []).length).toBe(1);
  });
});

describe("composeFrame3dSvg — the avatar group", () => {
  const svg = fixtureFrameSvg(0);

  test("the striker: trim legs, jersey torso, neutral head, facing wedge, label", () => {
    const group = svg.slice(
      svg.indexOf('data-entity="striker-9"'),
      svg.indexOf("</g>", svg.indexOf('data-entity="striker-9"')),
    );
    // Legs quad in the trim color.
    expect(group).toContain('fill="#e63946"'); // trim of palette entry 5 (0.2.0 key)
    // Torso quad: jersey fill + trim outline.
    expect(group).toContain('fill="#00b4d8" stroke="#e63946" stroke-width="1.5"');
    // Head circle: the fixed neutral head color with trim outline.
    expect(group).toContain('fill="#c3cad6" stroke="#e63946"');
    // The facing wedge (heading 0.6 carried, known → solid).
    expect((group.match(/<polygon/g) ?? []).length).toBe(3); // legs + torso + facing
    expect(group).not.toContain("dasharray"); // known heading: solid wedge
    // The label at base + 18 px.
    expect(group).toContain(">striker-9</text>");
    expect(group).toContain('x="705.63" y="389.24"');
  });

  test("the uncertain winger: dashed halo ring + confidence opacity", () => {
    const group = svg.slice(
      svg.indexOf('data-entity="winger-7"'),
      svg.indexOf("</g>", svg.indexOf('data-entity="winger-7"')),
    );
    expect(group).toContain('fill="none" stroke="#e63946" stroke-width="2" stroke-dasharray="4 3"');
    expect(group).toContain('opacity="0.805"'); // 0.35 + 0.65·0.7
  });

  test("the out-of-play outlier: dashed ring + OUT tag, NO styled figure", () => {
    const group = svg.slice(
      svg.indexOf('data-entity="outlier-8"'),
      svg.indexOf("</g>", svg.indexOf('data-entity="outlier-8"')),
    );
    expect(group).toContain('stroke="#d9534f" stroke-width="3" stroke-dasharray="6 4"');
    expect(group).toContain(">OUT</text>");
    expect((group.match(/<polygon/g) ?? []).length).toBe(0); // no figure quads
  });

  test("the official: the fixed uniform style", () => {
    const group = svg.slice(
      svg.indexOf('data-entity="official-1"'),
      svg.indexOf("</g>", svg.indexOf('data-entity="official-1"')),
    );
    expect(group).toContain('fill="#22223b"'); // official jersey
    expect(group).toContain('stroke="#ffd166"'); // official trim
  });
});

describe("composeFrame3dSvg — the ball group (honest height cues)", () => {
  test("height carried (frame 0): ground shadow + dashed drop line + solid ball", () => {
    const svg = fixtureFrameSvg(0);
    const group = svg.slice(
      svg.indexOf('data-entity="ball-1"'),
      svg.indexOf("</g>", svg.indexOf('data-entity="ball-1"')),
    );
    expect(group).toContain('fill="#1c2f22" fill-opacity="0.4"'); // the ground shadow
    expect(group).toContain('stroke="#161a1f" stroke-width="1" stroke-dasharray="2 3"'); // the drop line
    // The ball itself: fixed style, confidence opacity, NO dash on the outline.
    expect(group).toContain(
      'r="2.5" fill="#fdfdf6" stroke="#161a1f" stroke-width="1.5" opacity="0.935"',
    );
  });

  test("height ABSENT (frame 5): NO shadow, NO drop line, dashed height-unknown ball", () => {
    const svg = fixtureFrameSvg(5);
    const group = svg.slice(
      svg.indexOf('data-entity="ball-1"'),
      svg.indexOf("</g>", svg.indexOf('data-entity="ball-1"')),
    );
    expect(group).not.toContain("polygon");
    expect(group).not.toContain("<line");
    expect(group).toContain(
      'fill="#fdfdf6" stroke="#161a1f" stroke-width="1.5" stroke-dasharray="3 3"',
    );
  });

  test("the aerial slot draws the ball at its (x, y) ground position (depth 60 − 1.2)", () => {
    const req = build3dRequest({
      styleConfig: {
        styleId: "s",
        configSchemaVersion: "1.0",
        config: { cameraSlotId: "aerial-tactical" },
      },
    });
    const out = render3dClip(req, buildFixtureClip());
    const group = out.frames[0]!.svg.slice(
      out.frames[0]!.svg.indexOf('data-entity="ball-1"'),
      out.frames[0]!.svg.indexOf("</g>", out.frames[0]!.svg.indexOf('data-entity="ball-1"')),
    );
    // Nadir projection: x = 640 + 512·(58 − 52.5)/(60 − 1.2).
    expect(group).toContain('cx="687.89" cy="390.48"');
  });
});

describe("composeFrame3dSvg — the possession ring + HUD band", () => {
  const svg = fixtureFrameSvg(0);

  test("the possession ring: dashed ground polygon with verbatim-confidence opacity", () => {
    expect(svg).toContain(
      'fill="none" stroke="#ffd166" stroke-width="2" stroke-dasharray="6 5" opacity="0.818"',
    );
  });

  test("the HUD band: status line, camera label, event chips (verbatim text)", () => {
    expect(svg).toContain('<rect x="0" y="0" width="1280" height="64" fill="#10151d"/>');
    expect(svg).toContain(">Second half · 45:04 · 2-1</text>");
    expect(svg).toContain(">CAM · main-touchline</text>");
    expect(svg).toContain(">Kick-off</text>"); // frame 0's window (0, 1000]
  });

  test("marker chips land in their frame windows", () => {
    const out = render3dClip(build3dRequest(), buildFixtureClip());
    // Step windows are (previous atMs, this atMs]: kickoff@1000 → step 0,
    // pass@2500 → step 2, shot@4000 → step 3, unknown@4700 → step 4,
    // goal@5500 → step 5.
    expect(out.frames[0]!.svg).toContain(">Kick-off</text>");
    expect(out.frames[1]!.svg).not.toContain(">Pass</text>");
    expect(out.frames[2]!.svg).toContain(">Pass</text>");
    expect(out.frames[3]!.svg).toContain(">Shot!</text>");
    expect(out.frames[5]!.svg).toContain(">GOAL!</text>");
  });

  test("an unknown event type renders its VERBATIM ref (never an invented phrase)", () => {
    const out = render3dClip(build3dRequest(), buildFixtureClip());
    expect(out.frames[4]!.svg).toContain(">football/v9/variant-unknown</text>");
    expect(out.frames[4]!.svg).not.toContain(">Shot!</text>");
  });

  test("no football state → no status line (honest omission)", () => {
    const snapshot = buildWorldSnapshot(
      {
        sessionId: "sess-no-football",
        watermark: { watermarkMs: 1_000, sequence: 1 },
        generatedAtMs: 1_736_164_800_000,
        football: undefined,
        entities: [],
      },
      42,
    );
    const out = render3dFromSnapshot(build3dRequest({ sessionId: "sess-no-football" }), {
      snapshot,
      events: [],
    });
    expect(out.frames[0]!.svg).not.toContain("Second half");
    expect(out.frames[0]!.svg).not.toContain("First half");
    expect(out.frames[0]!.svg).toContain(">CAM · main-touchline</text>"); // camera label stays
  });
});

describe("composeFrame3dSvg — XML escaping of verbatim text", () => {
  test("a hostile eventTypeRef renders escaped (the chip text is verbatim data)", () => {
    const snapshot = buildWorldSnapshot(
      {
        sessionId: "sess-escape",
        watermark: { watermarkMs: 1_000, sequence: 1 },
        generatedAtMs: 1_736_164_800_000,
        entities: [],
        football: {
          pitch: {
            lengthAxisMeters: 105,
            widthAxisMeters: 68,
            origin: "corner",
            axes: "x=touchline, y=goal-line",
          },
          clock: { period: "first-half", clockMs: 0, stoppage: false },
          score: { home: 0, away: 0, status: { status: "known", value: "confirmed" } },
          possession: { status: "unknown" },
          eventTaxonomyVersion: "v1",
        },
      },
      42,
    );
    const hostile = "evil&<>\"'.txt";
    const event = buildEventEnvelope(
      { eventId: "fe-evil", sessionId: "sess-escape", eventTimeMs: 1_500, eventTypeRef: hostile },
      4321,
    );
    const entry: WorldEventStreamEntry = { sequence: 2, snapshotVersionAfter: 3, event };
    const scene = projectScene(snapshot, { events: [entry] });
    const frame = composeFrame3dSvg({
      frameIndex: 0,
      camera: cameraFromSlot(scene.cameraSlots[0]!),
      canvas: CANVAS,
      field: buildFieldGeometry(scene),
      entities: [],
      possession: null,
      hud: {
        statusLine: null,
        cameraLabel: "CAM · main-touchline",
        eventChips: [hostile],
      },
    });
    expect(frame).toContain("evil&amp;&lt;&gt;&quot;&apos;.txt");
    expect(frame).not.toContain("evil&<");
  });
});

describe("composeFrame3dSvg — determinism", () => {
  test("byte-identical reruns (same input → same document)", () => {
    const a = fixtureFrameSvg(0);
    const b = fixtureFrameSvg(0);
    expect(a).toBe(b);
  });

  test("the palette constants are the documented flat colors", () => {
    expect(FIELD_PALETTE.backdrop).toBe("#232b36");
    expect(FIELD_PALETTE.pitch).toBe("#3f7a4b");
    expect(FIELD_PALETTE.stripeA).toBe("#42804f");
    expect(FIELD_PALETTE.stripeB).toBe("#3b7347");
    expect(FIELD_PALETTE.lines).toBe("#eef4ea");
    expect(FIELD_PALETTE.possession).toBe("#ffd166");
    expect(FIELD_PALETTE.outOfPlay).toBe("#d9534f");
  });
});
