/**
 * The live status plan (W704): the PURE decision module for the live-output
 * status surface — the W702 pane-signature / pure-decision-module pattern
 * applied to the live section. The browser bootstrap (compile-checked, never
 * unit-tested — no DOM-testing dependency by constitution) renders this plan;
 * it makes no decisions of its own.
 *
 * LATENCY HONESTY (the acceptance core): every number in the plan comes from
 * a REAL seam — the playhead and buffered-ahead counts from the live player
 * (`./live-player.ts`), the latency from `now − the newest applied window's
 * emittedAtMs` in the INJECTED clock domain (W305's own
 * `latencyToLatestWindowMs` semantics), the accounting from W305's
 * never-silent receipts (`applied + skipped === accounted`, verbatim counts).
 * Absent metrics stay absent: before the first window there is no frame, no
 * latency, and no accounting — the plan says "waiting", never a faked 0.
 * Real NETWORK latency measurement is W306's; SLO formalization is W802's;
 * this surface never presents the injected-domain number as network latency
 * (the line says "delivery latency", the docs say the domain).
 */
import type { LiveView } from "./viewer-core.ts";
import type { LiveAccountingView } from "./live-ports.ts";

/** Formats milliseconds as `s.d s` (one decimal, deterministic). */
function formatMs(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`;
}

/** What the bootstrap's live section should render (one plan per snapshot). */
export interface LiveStatusPlan {
  /** The section headline (state-derived, deterministic). */
  headline: string;
  /** The primary status line (always defined). */
  statusText: string;
  /** The delivery-accounting line (`null` before the first accounting snapshot). */
  accountingText: string | null;
  /** The degradation line (`null` when the session is not degraded). */
  degradationText: string | null;
  /** The reconnect countdown line (`null` outside a reconnect window). */
  reconnectHint: string | null;
  /** The terminal-outcome line (`null` while the stream is live/awaited). */
  outcomeText: string | null;
  /** Whether the "close live" affordance is offered (a stream is/was mounted). */
  canClose: boolean;
}

/**
 * Derives the live status plan. Deterministic pure function over
 * `(view, nowMs)` — the same inputs yield the deep-equal plan (pinned by
 * tests, including the absent-metrics-absent cases).
 */
export function liveStatusPlan(live: LiveView, nowMs: number): LiveStatusPlan {
  if (!live.available) {
    return {
      headline: "Live output",
      statusText: live.note,
      accountingText: null,
      degradationText: null,
      reconnectHint: null,
      outcomeText: null,
      canClose: false,
    };
  }
  const base = {
    accountingText: liveAccountingText(live.accounting),
    degradationText:
      live.accounting === null || live.degradationReasons.length === 0
        ? null
        : `Degraded: ${live.degradationReasons.join(", ")}`,
    reconnectHint: liveReconnectHint(live, nowMs),
    outcomeText:
      live.outcome === null
        ? null
        : `Live stream ended (${live.outcome.outcome}${
            live.outcome.failureClass === undefined ? "" : ` — ${live.outcome.failureClass}`
          })`,
    canClose: live.state !== "idle",
  };
  switch (live.state) {
    case "idle":
      return {
        ...base,
        headline: "Live output",
        statusText: "Not connected — open the live stream for this session.",
      };
    case "connecting":
      return { ...base, headline: "Live output", statusText: "Requesting the live offer…" };
    case "reconnecting":
      return { ...base, headline: "Live output", statusText: "Connection lost — reconnecting…" };
    case "ended":
      return { ...base, headline: "Live output", statusText: "The live stream has ended." };
    case "playing": {
      const player = live.player;
      if (player === null || player.frame === null) {
        return {
          ...base,
          headline: "Live output",
          statusText: "Waiting for the live stream…",
        };
      }
      const parts: string[] = [
        player.buffering ? "Buffering" : "Live",
        `frame ${String(player.frame.frameIndex)} @ ${formatMs(player.frame.timestampMs)}`,
        `${String(player.bufferedAhead)} frame${player.bufferedAhead === 1 ? "" : "s"} buffered ahead`,
      ];
      // The delivery latency — INJECTED clock domain (see the module docs);
      // present only when a window has actually been applied.
      if (player.latencyMs !== null) parts.push(`delivery latency ${formatMs(player.latencyMs)}`);
      return { ...base, headline: "Live output", statusText: parts.join(" · ") };
    }
  }
}

/** The accounting line from W305's verbatim counts (or null before the first). */
function liveAccountingText(accounting: LiveAccountingView | null): string | null {
  if (accounting === null) return null;
  return (
    `${String(accounting.appliedWindows)} windows applied · ` +
    `${String(accounting.skippedWindows)} skipped · ` +
    `${String(accounting.duplicateWindows)} duplicates · ` +
    `${String(accounting.accountedOrdinals)} accounted`
  );
}

/** The reconnect countdown (or null outside a reconnect window). */
function liveReconnectHint(
  live: Extract<LiveView, { available: true }>,
  nowMs: number,
): string | null {
  if (live.state !== "reconnecting" || live.reconnect === null) return null;
  if (live.reconnect.nextAttemptAtMs === null) return null;
  const remainingMs = live.reconnect.nextAttemptAtMs - nowMs;
  const remaining = remainingMs > 0 ? formatMs(remainingMs) : "now";
  // `attempts` IS the pending attempt's number while a window is open (it
  // was set to the scheduled attempt at window-open and only advances with
  // the NEXT window — see `openReconnectWindow` in `./viewer-core.ts`).
  return `attempt ${String(live.reconnect.attempts)} of ${String(live.reconnect.maxAttempts)} — next try ${remaining}`;
}
