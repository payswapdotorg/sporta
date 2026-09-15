/**
 * Sporta brand tokens (W903).
 *
 * Single source of truth for values that must agree across artifacts:
 * the web app manifest (public/manifest.webmanifest), the generated
 * icons (scripts/generate-icons.ts) and the CSS design tokens
 * (src/app/globals.css). Tests cross-check these artifacts against the
 * values here so they can never silently drift.
 */

export const BRAND = {
  name: "Sporta",
  shortName: "Sporta",
  tagline: "One event. Every reality.",
  description:
    "Sporta reimagines how you watch sport: the same event, rendered as Original, Anime, 3D and Tactical realities.",
  /** Night-stadium ink used for theme + background color. */
  themeColor: "#0a0e18",
  /** Reality accents (Original, Anime, 3D, Tactical). */
  realityAccents: {
    original: "#8fb0ff",
    anime: "#ffc24d",
    "3d": "#2df08c",
    tactical: "#ff9d6f",
  },
} as const;

export type RealityKey = keyof typeof BRAND.realityAccents;

/** The four realities Sporta will offer (architecture-lock §5). */
export const REALITIES: readonly {
  key: RealityKey;
  name: string;
  description: string;
}[] = [
  {
    key: "original",
    name: "Original",
    description:
      "The broadcast presentation of the source event, enhanced from the world model.",
  },
  {
    key: "anime",
    name: "Anime",
    description:
      "A stylized hand-drawn reality — the same match, re-imagined frame-coherent.",
  },
  {
    key: "3d",
    name: "3D",
    description:
      "A game-like three-dimensional reality you can follow from any angle.",
  },
  {
    key: "tactical",
    name: "Tactical",
    description:
      "The pure intelligence view: pitches, positioning, events and evidence.",
  },
];
