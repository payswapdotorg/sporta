/**
 * WCAG contrast math (W909 a11y smoke) — PURE, shared by the browser flow
 * and the root unit suite.
 *
 * The BROWSER collects the rendered colors (getComputedStyle + the
 * ancestor walk for transparent backgrounds); THIS module computes the
 * ratio so the arithmetic is testable without a browser.
 */

/** Parses `#rgb`, `#rrggbb`, `rgb(r,g,b)` and `rgba(r,g,b,a)` to [r,g,b,a]. */
export function parseCssColor(color: string): [number, number, number, number] | null {
  const trimmed = color.trim();
  const hex = trimmed.match(/^#([0-9a-fA-F]{3})$/);
  if (hex !== null) {
    const digits = [...hex[1]!];
    return [
      Number.parseInt(digits[0]! + digits[0]!, 16),
      Number.parseInt(digits[1]! + digits[1]!, 16),
      Number.parseInt(digits[2]! + digits[2]!, 16),
      1,
    ];
  }
  const hex6 = trimmed.match(/^#([0-9a-fA-F]{6})$/);
  if (hex6 !== null) {
    const n = parseInt(hex6[1]!, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255, 1];
  }
  const rgb = trimmed.match(/^rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)(?:[,\s/]+([\d.]+))?\s*\)$/);
  if (rgb !== null) {
    const a = rgb[4] !== undefined ? Number(rgb[4]) : 1;
    return [Number(rgb[1]!), Number(rgb[2]!), Number(rgb[3]!), a];
  }
  return null;
}

/** WCAG 2.x relative luminance of an sRGB channel triplet. */
export function relativeLuminance(rgb: readonly [number, number, number]): number {
  const channels = rgb.map((channel) => {
    const s = channel / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

/** WCAG contrast ratio between two colors (1..21). */
export function contrastRatio(foreground: string, background: string): number | null {
  const fg = parseCssColor(foreground);
  const bg = parseCssColor(background);
  if (fg === null || bg === null) return null;
  const l1 = relativeLuminance([fg[0], fg[1], fg[2]]);
  const l2 = relativeLuminance([bg[0], bg[1], bg[2]]);
  const [hi, lo] = l1 >= l2 ? [l1, l2] : [l2, l1];
  return (hi + 0.05) / (lo + 0.05);
}

/** The WCAG 2.1 AA thresholds the smoke checks (normal / large text). */
export const WCAG_AA_NORMAL = 4.5;
export const WCAG_AA_LARGE = 3.0;

/** Whether a ratio clears WCAG 2.1 AA for normal-size text. */
export function meetsWcagAaNormal(ratio: number): boolean {
  return ratio >= WCAG_AA_NORMAL;
}
