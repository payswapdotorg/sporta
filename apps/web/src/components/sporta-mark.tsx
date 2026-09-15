/**
 * The Sporta mark: three overlapping realities converging on one ball.
 *
 * Original geometry (W903): a green ring (the pitch), an amber ring (the
 * spectacle) and a slate ring (the analysis) overlap around a single ball —
 * the product thesis drawn as one glyph. Decorative by contract: every use
 * sits next to visible text, so it is aria-hidden.
 */
export function SportaMark({ size = 28 }: { size?: number }) {
  return (
    <svg
      className="sporta-mark"
      viewBox="0 0 96 96"
      width={size}
      height={size}
      aria-hidden="true"
      focusable="false"
    >
      <circle
        cx="40"
        cy="38"
        r="24"
        fill="none"
        stroke="var(--mark-green, #2df08c)"
        strokeWidth="7"
      />
      <circle
        cx="56"
        cy="38"
        r="24"
        fill="none"
        stroke="var(--mark-amber, #ffc24d)"
        strokeWidth="7"
      />
      <circle
        cx="48"
        cy="54"
        r="24"
        fill="none"
        stroke="var(--mark-slate, #8fb0ff)"
        strokeWidth="7"
      />
      <circle cx="48" cy="43" r="9" fill="var(--mark-ball, #e9eefb)" />
    </svg>
  );
}
