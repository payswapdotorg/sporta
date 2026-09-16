/**
 * CLIENT API (W904/W905) — typed fetch wrappers over this app's own /api
 * routes. Client components consume ONLY these (never `@sporta/*`, never
 * other hosts). Errors surface as `ApiError` with the route's status and
 * classified body.
 */
import type {
  AccountViewLike,
  ApiErrorBodyLike,
  CapabilityLike,
  RealityOptionsLike,
  RenderOutputLike,
  RightsPreviewLike,
  SessionCardLike,
  StudioDispatchLike,
  StudioJobLike,
  StudioOptionsLike,
  StudioOutputProfileLike,
  StudioPublicationLike,
  StudioSessionLike,
  StudioSessionStateLike,
  WatchModelLike,
} from "./api-types";

/** A classified API failure. */
export class ApiError extends Error {
  readonly status: number;
  readonly failureClass: string;
  readonly details: Record<string, unknown>;

  constructor(status: number, body: ApiErrorBodyLike | null) {
    super(body?.error?.message ?? `request failed with status ${status}`);
    this.name = "ApiError";
    this.status = status;
    this.failureClass = body?.error?.failureClass ?? "unknown";
    this.details = body?.error?.details ?? {};
  }
}

async function getJson<T>(path: string): Promise<T> {
  const response = await fetch(path, { headers: { accept: "application/json" } });
  const text = await response.text();
  const body = text.length > 0 ? (JSON.parse(text) as unknown) : null;
  if (!response.ok) throw new ApiError(response.status, body as ApiErrorBodyLike | null);
  return body as T;
}

async function postJson<T>(path: string, payload: unknown): Promise<T> {
  const response = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify(payload),
  });
  const text = await response.text();
  const body = text.length > 0 ? (JSON.parse(text) as unknown) : null;
  if (!response.ok) throw new ApiError(response.status, body as ApiErrorBodyLike | null);
  return body as T;
}

/** The mounted-fetch outcome: `loading` until settled, then data or error. */
export type FetchState<T> =
  | { phase: "loading" }
  | { phase: "ready"; data: T }
  | { phase: "failed"; error: string; status?: number };

/** GET /api/capability (the frozen seam). */
export function fetchCapability(): Promise<CapabilityLike> {
  return getJson<CapabilityLike>("/api/capability");
}

/** GET /api/auth/me — null when unauthenticated (401 is the expected state). */
export async function fetchMe(): Promise<AccountViewLike | null> {
  try {
    return await getJson<AccountViewLike>("/api/auth/me");
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) return null;
    throw err;
  }
}

/** POST /api/auth/register. */
export function registerAccount(input: {
  username: string;
  password: string;
  roles?: string[];
}): Promise<AccountViewLike> {
  return postJson<AccountViewLike>("/api/auth/register", input);
}

/** POST /api/auth/login (sets the HttpOnly session cookie). */
export function loginAccount(input: {
  username: string;
  password: string;
}): Promise<AccountViewLike> {
  return postJson<{ token: string; account: AccountViewLike }>("/api/auth/login", input).then(
    (result) => result.account,
  );
}

/** POST /api/auth/logout. */
export function logoutAccount(): Promise<{ revoked: true }> {
  return postJson<{ revoked: true }>("/api/auth/logout", {});
}

/** POST /api/auth/switch-role (presentation role only — never authority). */
export function switchActiveRole(role: string): Promise<AccountViewLike> {
  return postJson<AccountViewLike>("/api/auth/switch-role", { role });
}

/** GET /api/catalog/sessions (the public catalog). */
export function fetchCatalog(): Promise<SessionCardLike[]> {
  return getJson<{ sessions: SessionCardLike[] }>("/api/catalog/sessions").then((r) => r.sessions);
}

/**
 * GET /api/catalog/library — null when unauthenticated (401 is the
 * authentication-required state, not a failure).
 */
export async function fetchLibrary(): Promise<SessionCardLike[] | null> {
  try {
    const result = await getJson<{ sessions: SessionCardLike[] }>("/api/catalog/library");
    return result.sessions;
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) return null;
    throw err;
  }
}

/** GET /api/watch/[sessionId] (the playback-session acquisition). */
export function fetchWatchModel(sessionId: string): Promise<WatchModelLike> {
  return getJson<WatchModelLike>(`/api/watch/${encodeURIComponent(sessionId)}`);
}

/**
 * GET /api/watch/[sessionId]/realities — the Reality Switcher surface: the
 * per-renderer availability for the SAME session (Simulation G — the
 * session is the constant; switching never re-acquires the match).
 */
export function fetchRealityOptions(sessionId: string): Promise<RealityOptionsLike> {
  return getJson<RealityOptionsLike>(`/api/watch/${encodeURIComponent(sessionId)}/realities`);
}

/**
 * GET /api/watch/[sessionId]/renders/[renderId]/outputs/[segmentId] — the
 * playback-gate read. A 403 is the REAL rights denial (surfaced, not thrown
 * away): the caller decides how to present it.
 */
export function fetchRenderOutput(
  sessionId: string,
  renderId: string,
  segmentId: string,
): Promise<RenderOutputLike> {
  return getJson<RenderOutputLike>(
    `/api/watch/${encodeURIComponent(sessionId)}/renders/${encodeURIComponent(renderId)}/outputs/${encodeURIComponent(segmentId)}`,
  );
}

// ---------------------------------------------------------------------------
// W906 — the Create Studio (/api/create/*)
// ---------------------------------------------------------------------------

/**
 * GET /api/create/options — null when unauthenticated (401 is the
 * authentication-required state, not a failure; the UI shows sign-in).
 */
export async function fetchCreateOptions(): Promise<StudioOptionsLike | null> {
  try {
    return await getJson<StudioOptionsLike>("/api/create/options");
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) return null;
    throw err;
  }
}

/** POST /api/create/rights-preview — what a declaration really permits. */
export function previewRights(declaration: {
  operations: string[];
  expiresAtIso?: string;
  storageDurationDays?: number;
  sharingScope?: string;
}): Promise<RightsPreviewLike> {
  return postJson<RightsPreviewLike>("/api/create/rights-preview", declaration);
}

/** POST /api/create/sessions — create a session under the declaration. */
export function createStudioSession(input: {
  sourceKey: string;
  operations: string[];
  expiresAtIso?: string;
  storageDurationDays?: number;
  sharingScope?: string;
  label?: string;
}): Promise<StudioSessionLike> {
  return postJson<StudioSessionLike>("/api/create/sessions", input);
}

/** GET /api/create/sessions/[sessionId] — the studio session state. */
export function fetchStudioSession(
  sessionId: string,
): Promise<StudioSessionStateLike> {
  return getJson<StudioSessionStateLike>(
    `/api/create/sessions/${encodeURIComponent(sessionId)}`,
  );
}

/** POST /api/create/sessions/[sessionId]/renders — dispatch a real render. */
export function dispatchStudioRender(
  sessionId: string,
  input: {
    rendererId: string;
    rendererVersion?: string;
    styleId?: string;
    outputProfile?: StudioOutputProfileLike;
  },
): Promise<StudioDispatchLike> {
  return postJson<StudioDispatchLike>(
    `/api/create/sessions/${encodeURIComponent(sessionId)}/renders`,
    input,
  );
}

/** GET /api/create/sessions/[sessionId]/jobs/[jobId] — poll job progress. */
export function fetchStudioJob(sessionId: string, jobId: string): Promise<StudioJobLike> {
  return getJson<StudioJobLike>(
    `/api/create/sessions/${encodeURIComponent(sessionId)}/jobs/${encodeURIComponent(jobId)}`,
  );
}

/** POST /api/create/sessions/[sessionId]/publication — publish or privatize. */
export function setStudioPublication(
  sessionId: string,
  visibility: "public" | "private",
): Promise<StudioPublicationLike> {
  return postJson<StudioPublicationLike>(
    `/api/create/sessions/${encodeURIComponent(sessionId)}/publication`,
    { visibility },
  );
}
