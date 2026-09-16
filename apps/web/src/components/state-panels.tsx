import type { UxState } from "@/lib/api-types";

/**
 * A state chip: the visual vocabulary for the UX state contract. Color is
 * never the ONLY signal — every chip carries its state as text (and the
 * `data-state` hook for tests).
 */
export function StateChip({
  state,
  children,
}: {
  state: UxState | "authorized" | "denied" | "not-live";
  children: React.ReactNode;
}) {
  return (
    <p className={`status-chip state-${state}`} role="status" data-state={state}>
      {children}
    </p>
  );
}

/**
 * The honest unavailable/denied/degraded panel: a plain-spoken explanation of
 * a REAL operational state — never a simulated failure and never a fake
 * "coming soon" for something the control plane could actually answer.
 */
export function StatePanel({
  state,
  title,
  reason,
}: {
  state: UxState;
  title: string;
  reason: string;
}) {
  return (
    <section className={`state-panel state-${state}`} data-surface-state={state}>
      <StateChip state={state}>{state}</StateChip>
      <h2 className="state-title">{title}</h2>
      <p className="state-reason">{reason}</p>
    </section>
  );
}

/** The loading panel (surfaces are honestly `loading` until data arrives). */
export function LoadingPanel({ label }: { label: string }) {
  return (
    <section className="state-panel state-loading" data-surface-state="loading" aria-busy="true">
      <StateChip state="loading">loading</StateChip>
      <h2 className="state-title">{label}</h2>
      <p className="state-reason">Reading the real capability and catalog state…</p>
    </section>
  );
}
