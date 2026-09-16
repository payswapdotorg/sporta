import type { CapabilityLike } from "@/lib/api-types";
import { deriveProviderNotices, providerNoticeLine } from "@/lib/surface-state";

/**
 * The global provider-degradation notices (W908, Simulation E step 4): the
 * capability response's REAL `providers[]` feed, made visible. Only non-ok
 * providers appear — a healthy deployment renders nothing here (no noise,
 * no fake stability banner either). Color is never the only signal: every
 * notice carries its words and the `degraded` state as text.
 */
export function ProviderNotices({ capability }: { capability: CapabilityLike }) {
  const notices = deriveProviderNotices(capability);
  if (notices.length === 0) return null;
  return (
    <aside
      className="provider-notices"
      role="status"
      aria-label="Platform degradation notices"
      data-notice-count={notices.length}
    >
      <p className="provider-notices-title">
        Platform degraded — {notices.length} provider{notices.length === 1 ? "" : "s"} reporting a
        non-healthy state
      </p>
      <ul className="provider-notices-list">
        {notices.map((notice) => (
          <li key={`${notice.kind}:${notice.reasonCode}`} className="provider-notice">
            <span className="status-chip state-degraded" role="status" data-state="degraded">
              degraded
            </span>
            <span className="provider-notice-line">{providerNoticeLine(notice)}</span>
          </li>
        ))}
      </ul>
      <p className="provider-notices-note">
        These are the control plane&rsquo;s own provider health reports, not UI guesses. Authorized
        playback and listings remain available where the notices say they do.
      </p>
    </aside>
  );
}
