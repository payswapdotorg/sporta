/**
 * THE RIGHTS DOMAIN SEAM COMPOSITION (J008/J009 — wave 4, Worker B) — the
 * thin, honest adapter layer that lets THIS app's real stores back the
 * `@sporta/session` domain services (the wave-3 seams), without forking a
 * single semantic:
 *
 * - the domain `RightsEditor`'s `editPolicy`/`revoke` now back BOTH edit
 *   surfaces (the Rights Center's J008 UI and the W917 policy console) —
 *   every rights change is validated by the frozen contract, re-attested
 *   with the VERIFIED editor id (the W902 rule), stored as the override the
 *   rights-governed control plane re-derives every read from, and audited
 *   with the J008 classification vocabulary (`editKind`:
 *   grant/widen/narrow/revoke);
 * - the domain `RightsAuditQueryService` reads the SAME append-only
 *   `PolicyAuditLog` through a domain-vocabulary VIEW: the app-layer log is
 *   one store with a WIDER entry vocabulary than the domain's (it also
 *   records publication-visibility entries, which carry no `editKind` — a
 *   visibility change is a W916 publication decision, not a rights edit).
 *   The domain seam serves the RIGHTS trail — `changeKind` policy/
 *   revocation WITH the `editKind` classification — which is exactly the
 *   J009 acceptance's trail. Publication-visibility events remain honestly
 *   visible on the Rights Center's policy console (their own real surface);
 * - the domain `AnalystAnnotationService` (J010) composes over the same
 *   pattern in ./annotations-service.ts.
 *
 * THE ADAPTER RULE (no semantics are re-implemented here): every method
 * delegates to the app-layer store VERBATIM; the only added behavior is the
 * vocabulary filter on the READ side (entries outside the domain's closed
 * vocabulary are not presented AS domain entries — they are never mutated,
 * never hidden from their own surface, and never deleted).
 */
import { createRightsEditor } from "@sporta/session";
import type { RightsAuditStore, RightsAuditEntry, RightsEditor } from "@sporta/session";
import type { PolicyAuditLog, PolicyAuditEntry } from "./rights-policy-store";
import type { EffectivePolicyStore } from "./rights-policy-store";

/** Whether one app-layer audit entry speaks the DOMAIN vocabulary. */
function isDomainRightsEntry(
  entry: PolicyAuditEntry,
): entry is PolicyAuditEntry & RightsAuditEntry {
  return (
    (entry.changeKind === "policy" || entry.changeKind === "revocation") &&
    typeof (entry as PolicyAuditEntry & { editKind?: unknown }).editKind === "string"
  );
}

/**
 * The domain-vocabulary VIEW of the app-layer `PolicyAuditLog`: writes pass
 * through VERBATIM (a domain `RightsAuditEntry` is an app-layer entry plus
 * the additive `editKind`), reads answer ONLY the domain-vocabulary entries
 * (policy/revocation with `editKind` — the rights trail; publication
 * visibility entries are outside the domain's closed vocabulary and stay on
 * their own surface). `lastOf` answers the newest RIGHTS change (the domain
 * state view's own question), skipping later publication-only entries.
 */
export function asDomainRightsAuditStore(log: PolicyAuditLog): RightsAuditStore {
  return {
    append(entry) {
      log.append(entry);
    },
    of(sessionId) {
      return log.of(sessionId).filter(isDomainRightsEntry);
    },
    ofSessions(sessionIds) {
      return log.ofSessions(sessionIds).filter(isDomainRightsEntry);
    },
    lastOf(sessionId) {
      const scoped = log.of(sessionId).filter(isDomainRightsEntry);
      return scoped.length > 0 ? (scoped[scoped.length - 1] ?? null) : null;
    },
    all() {
      return log.all().filter(isDomainRightsEntry);
    },
  };
}

/** Options for {@link createAppRightsEditor}. */
export interface AppRightsEditorOptions {
  /** The app-layer effective-policy store (the SAME store the serving seam re-derives from). */
  policies: EffectivePolicyStore;
  /** The domain-vocabulary audit view (see {@link asDomainRightsAuditStore}). */
  audit: RightsAuditStore;
  /** The composition's clock. */
  nowMs: () => number;
}

/**
 * The J008 domain rights editor over THIS app's real stores. Every
 * `editPolicy`/`revoke` lands in the SAME `EffectivePolicyStore` the
 * rights-governed control plane re-derives every read from — so an edit or
 * revocation takes effect on playback/publication fail-closed, exactly as
 * the W917 composition already enforced (the domain editor is the SAME
 * semantics, adopted — never a second implementation).
 *
 * The editor is constructed WITHOUT the optional session-existence lookup:
 * this composition's `createSession` recording path means every mediated
 * session has a policy record, and an edit/revoke for a record-less session
 * refuses fail-loud at the domain seam (never a silent edit into the void).
 * Route wrappers still run the identity gates + the control plane's typed
 * existence check FIRST — the domain seam never bypasses them.
 */
export function createAppRightsEditor(options: AppRightsEditorOptions): RightsEditor {
  return createRightsEditor({
    policies: options.policies,
    audit: options.audit,
    nowMs: options.nowMs,
  });
}
