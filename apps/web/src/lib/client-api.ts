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
  SessionCardLike,
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
