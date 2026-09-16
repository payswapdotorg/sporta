/**
 * The session PUBLICATION store (W906) — the real visibility flag behind the
 * Create Studio's publish/private step.
 *
 * WHAT THIS IS: an explicit, per-session visibility decision
 * (`public` | `private`) with REAL, enforced effects:
 *
 * - the PUBLIC CATALOG (`buildCatalog`) lists `public` sessions only — a
 *   private session is not discoverable;
 * - the WATCH SURFACE (`buildWatchModel` acquisition + the playback-gated
 *   output routes) serves a private session ONLY to its owner or an operator;
 *   every other caller receives the same answer as for an unknown session
 *   (404 — no existence oracle);
 * - the OWNER'S LIBRARY lists their own sessions regardless of visibility.
 *
 * DEFAULT: `public` — the dev seed's sessions (and any session created by a
 * path that does not declare a visibility, e.g. direct control-plane calls)
 * stay discoverable exactly as they were before W906. The Create Studio
 * creates its sessions `private` (fail-closed) and publishing is an explicit
 * owner action.
 *
 * ⚠️ HONEST LIMITATION (this wave): the store is IN-MEMORY, process-local —
 * it lives exactly where the composition stores the rest of the control
 * plane (sessions, renders, outputs) this wave. A restart forgets the flags
 * (back to the `public` default). Durable publication state belongs to the
 * hosted persistence seam (W911/W916) behind this same port.
 */

/** A session's publication decision. */
export type SessionVisibility = "public" | "private";

/** The in-memory publication store (this wave's deployment of the port). */
export class PublicationStore {
  private readonly bySession = new Map<string, SessionVisibility>();

  /** Records (or changes) one session's visibility. */
  set(sessionId: string, visibility: SessionVisibility): void {
    this.bySession.set(sessionId, visibility);
  }

  /** The session's visibility (the documented `public` default). */
  visibilityOf(sessionId: string): SessionVisibility {
    return this.bySession.get(sessionId) ?? "public";
  }

  /** `true` only when the session is explicitly published. */
  isPublic(sessionId: string): boolean {
    return this.visibilityOf(sessionId) === "public";
  }
}
