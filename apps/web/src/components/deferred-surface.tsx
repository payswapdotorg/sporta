import { getDeferredSurface, type SurfaceKey } from "@/lib/deferred-surfaces";

/**
 * The honest placeholder surface (W903).
 *
 * Every data-bearing surface in the shell renders one of these instead of
 * fabricated content: a clearly-worded "not available yet" panel that says
 * what will live here, why nothing is shown now, and which work order
 * delivers it. Styling is intentional (it is part of the product's design
 * language), but the content is deliberately plain-spoken and truthful.
 */
export function DeferredSurface({ surface }: { surface: SurfaceKey }) {
  const spec = getDeferredSurface(surface);
  return (
    <section className="deferred-surface" data-surface={spec.id}>
      <div className="deferred-frame" aria-hidden="true">
        <svg viewBox="0 0 96 96" focusable="false">
          <circle cx="40" cy="38" r="24" fill="none" strokeWidth="7" />
          <circle cx="56" cy="38" r="24" fill="none" strokeWidth="7" />
          <circle cx="48" cy="54" r="24" fill="none" strokeWidth="7" />
          <circle cx="48" cy="43" r="9" />
        </svg>
      </div>
      <p className="status-chip" role="status">
        Not available yet
      </p>
      <h2 className="deferred-title">{spec.title}</h2>
      <p className="deferred-summary">{spec.summary}</p>
      <p className="deferred-detail">{spec.detail}</p>
      <p className="deferred-plan">
        Arrives with
        <span className="work-order">{spec.plannedWorkOrder}</span>
      </p>
    </section>
  );
}
