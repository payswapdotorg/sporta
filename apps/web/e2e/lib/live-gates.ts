/**
 * THE LIVE-GATE BROWSER HELPERS (L015/L016/L017) — the driver-level pieces
 * the three live-gate flows share: the page-side LIVE PROBE (a pure
 * OBSERVER over the page's own real `EventSource` traffic — it records
 * every `hello`/`world` event the product's live stream really delivers,
 * with the browser's real receipt clock; it never fabricates, alters or
 * short-circuits a single byte), the product-surface navigation (the real
 * sign-in form, the /live source picker, the entity inspector), and the
 * DOM fact readers (the tactical surface's own visible state).
 *
 * NOTHING here calls an internal or developer API: the flows drive exactly
 * the surfaces a user drives (the nav, the radio picker, the select, the
 * buttons) and read exactly what the page renders.
 */
import type { BrowserDriver } from "./browser-driver";
import type { CapturedWorldFrame, LiveSourceRow } from "./live-instrument";
import { finiteSourceOf, scenarioSourceOf, type LiveScenarioKindOf } from "./live-instrument";

// ---------------------------------------------------------------------------
// The page-side live probe (a pure observer over the REAL stream)
// ---------------------------------------------------------------------------

/** The probe's page-side state (read back through the driver). */
export interface LiveProbeState {
  opens: number;
  hello: { cadenceMs?: number; sessionId?: string; sourceKind?: string } | null;
  frames: CapturedWorldFrame[];
}

/**
 * Installs the live probe into the CURRENT page document: patches
 * `window.EventSource` so every `/api/live/*` connection the page's own
 * code opens is observed — each `hello` and each `world` event's full doc
 * plus the browser's real receipt timestamp are recorded on
 * `window.__e2eLiveProbe`.
 *
 * MUST run in a document before the live surface mounts its stream (the
 * flows call it immediately after `open`); the constructor patch is a pure
 * wrapper — the real `EventSource` is constructed and returned untouched,
 * only listeners are attached. A missed install (the stream mounted first)
 * is detectable: `readLiveProbe().opens` stays 0 while the surface is
 * live — the flows then reload + reinstall (the retry loop in
 * `openLiveWithProbe`).
 */
export function installLiveProbe(browser: BrowserDriver): string {
  return browser.eval<string>(`(function installE2eLiveProbe() {
  if (window.__e2eLiveProbe !== undefined) return 'already-installed';
  var probe = { opens: 0, hello: null, frames: [] };
  window.__e2eLiveProbe = probe;
  var Orig = window.EventSource;
  function PatchedEventSource(url, opts) {
    var es = new Orig(url, opts);
    if (String(url).indexOf('/api/live/') !== -1) {
      probe.opens += 1;
      es.addEventListener('hello', function (event) {
        try { probe.hello = JSON.parse(event.data); } catch (err) { probe.hello = { parseError: String(err) }; }
      });
      es.addEventListener('world', function (event) {
        try {
          var doc = JSON.parse(event.data);
          probe.frames.push({
            sessionId: doc.sessionId,
            ordinal: doc.ordinal,
            worldVersion: doc.worldVersion,
            eventTimeMs: doc.eventTimeMs,
            generatedAtMs: doc.generatedAtMs,
            sourceSequence: doc.sourceSequence,
            quality: doc.quality,
            entities: (doc.entities || []).map(function (en) {
              return { entityRef: en.entityRef, kind: en.kind, xMeters: en.xMeters, yMeters: en.yMeters, detected: en.detected };
            }),
            frameEvents: doc.eventsSincePreviousFrame || [],
            receivedAtMs: Date.now(),
          });
        } catch (err) { /* a malformed world event is the stream's own failure — the flow's other assertions catch it */ }
      });
    }
    return es;
  }
  PatchedEventSource.prototype = Orig.prototype;
  window.EventSource = PatchedEventSource;
  return 'installed';
})()`);
}

/** Reads the probe back (empty state when the page has none). */
export function readLiveProbe(browser: BrowserDriver): LiveProbeState {
  return browser.eval<LiveProbeState>(
    `(function(){ var p = window.__e2eLiveProbe; return p === undefined ? { opens: 0, hello: null, frames: [] } : { opens: p.opens, hello: p.hello, frames: p.frames }; })()`,
  );
}

/**
 * Opens the live page with the probe installed BEFORE the surface can
 * mount its stream: open → immediately install → verify the probe caught
 * the connection (frames arrive). On a miss (the stream mounted before the
 * install landed), reload and retry — each attempt is a fresh race the
 * probe wins with wide margin (page load → hydration → capability fetch →
 * sources fetch → mount all precede the first `EventSource`).
 *
 * Returns when the tactical surface is LIVE and the probe has ≥
 * `minFrames` captured frames.
 */
export async function openLiveWithProbe(
  browser: BrowserDriver,
  baseUrl: string,
  minFrames: number,
  attempts = 3,
): Promise<LiveProbeState> {
  let last: LiveProbeState = { opens: 0, hello: null, frames: [] };
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    browser.open(`${baseUrl}/live`);
    installLiveProbe(browser);
    // Wait for the live tactical phase + probe frames (the auto-selected
    // first tactical source — the "normal delivery" session).
    const live = await browser.waitForSelector(
      ".player-surface[data-surface='live-tactical'][data-live-phase='live']",
      25_000,
    );
    if (live) {
      const deadline = Date.now() + 20_000;
      while (Date.now() < deadline) {
        last = readLiveProbe(browser);
        if (last.frames.length >= minFrames) return last;
        await Bun.sleep(400);
      }
      last = readLiveProbe(browser);
      if (last.frames.length >= minFrames) return last;
    } else {
      last = readLiveProbe(browser);
    }
    // Miss (probe installed after the stream mounted, or the phase never
    // went live) → reload and retry.
  }
  return last;
}

// ---------------------------------------------------------------------------
// Product-surface navigation (the picker, the inspector, the sign-in form)
// ---------------------------------------------------------------------------

/**
 * Selects a live source through the PRODUCT's radio picker (the /live
 * surface's own `input[name='live-source']`), matching the label fragment
 * (e.g. "reconnect", "finite window"). Returns 'selected' | 'not-found'.
 */
export function selectLiveSource(browser: BrowserDriver, labelFragment: string): string {
  return browser.eval<string>(
    `(function(){ var inputs = Array.prototype.slice.call(document.querySelectorAll("input[name='live-source']"));
  for (var i = 0; i < inputs.length; i += 1) {
    var label = inputs[i].closest('label');
    if (label !== null && label.textContent.indexOf(${JSON.stringify(labelFragment)}) !== -1) {
      inputs[i].click();
      return 'selected';
    }
  }
  return 'not-found'; })()`,
  );
}

/**
 * Pins an entity in the product's identity inspector (the keyboard-
 * reachable `#live-entity-picker` select). Returns 'pinned' | 'not-found'.
 */
export function pickEntity(browser: BrowserDriver, entityRef: string): string {
  return browser.eval<string>(
    `(function(){ var s = document.getElementById('live-entity-picker');
  if (s === null) return 'not-found';
  var has = Array.prototype.slice.call(s.options).some(function (o) { return o.value === ${JSON.stringify(entityRef)}; });
  if (!has) return 'not-found';
  s.value = ${JSON.stringify(entityRef)};
  s.dispatchEvent(new Event('change', { bubbles: true }));
  return 'pinned'; })()`,
  );
}

/** The option values the entity picker currently offers. */
export function entityPickerOptions(browser: BrowserDriver): string[] {
  return browser.eval<string[]>(
    `(function(){ var s = document.getElementById('live-entity-picker');
  return s === null ? [] : Array.prototype.slice.call(s.options).map(function (o) { return o.value; }); })()`,
  );
}

/** Reads the tactical surface's own visible facts (dt → dd text). */
export function readTacticalFacts(browser: BrowserDriver): Record<string, string> {
  return browser.eval<Record<string, string>>(
    `(function(){ var out = {};
  var surface = document.querySelector(".player-surface[data-surface='live-tactical']");
  if (surface === null) return out;
  var facts = surface.querySelectorAll('.live-stats .fact');
  for (var i = 0; i < facts.length; i += 1) {
    var dt = facts[i].querySelector('dt');
    var dd = facts[i].querySelector('dd');
    if (dt !== null && dd !== null) out[dt.textContent.trim()] = dd.textContent.trim();
  }
  return out; })()`,
  );
}

/** Reads the entity inspector's own visible facts (dt → dd text). */
export function readInspectorFacts(browser: BrowserDriver): Record<string, string> {
  return browser.eval<Record<string, string>>(
    `(function(){ var out = {};
  var box = document.querySelector(".live-entity-inspector");
  if (box === null) return out;
  var facts = box.querySelectorAll('.fact');
  for (var i = 0; i < facts.length; i += 1) {
    var dt = facts[i].querySelector('dt');
    var dd = facts[i].querySelector('dd');
    if (dt !== null && dd !== null) out[dt.textContent.trim()] = dd.textContent.trim();
  }
  return out; })()`,
  );
}

/** The tactical canvas's aria-label (the rendered world version + count). */
export function tacticalCanvasLabel(browser: BrowserDriver): string {
  const count = browser.count(".live-tactical-canvas");
  return count > 0 ? browser.attr(".live-tactical-canvas", "aria-label") : "(no canvas)";
}

/** Waits until the tactical surface's data-live-phase equals `phase`. */
export async function waitForLivePhase(
  browser: BrowserDriver,
  phase: "connecting" | "live" | "closed" | "failed" | "replay",
  timeoutMs: number,
): Promise<boolean> {
  return browser.waitForJs(
    `(function(){ var el = document.querySelector(".player-surface[data-surface='live-tactical']"); return el !== null && el.getAttribute('data-live-phase') === ${JSON.stringify(phase)}; })()`,
    timeoutMs,
  );
}

// ---------------------------------------------------------------------------
// The real-API discovery (the product's own live listing — no fixtures)
// ---------------------------------------------------------------------------

/** Reads the live sources listing exactly as the /live page does. */
export async function discoverLiveSources(api: (path: string) => Promise<Response>): Promise<{
  available: boolean;
  transportKind: string;
  detail: string;
  sources: LiveSourceRow[];
}> {
  const response = await api("/api/live");
  if (!response.ok) {
    throw new Error(`the live listing answered ${response.status} (the gate cannot run)`);
  }
  const doc = (await response.json()) as {
    available: boolean;
    transportKind: string;
    detail: string;
    sources: LiveSourceRow[];
  };
  return doc;
}

/** The scenario session a gate flow needs (fail loud with the honest reason). */
export function requireScenarioSource(
  sources: readonly LiveSourceRow[],
  scenario: LiveScenarioKindOf,
): LiveSourceRow {
  const source = scenarioSourceOf(sources, scenario);
  if (source === null) {
    throw new Error(
      `no live source for the '${scenario}' scenario in the transport's own listing (${sources.length} sources)`,
    );
  }
  return source;
}

/** The finite-window session a gate flow needs (fail loud with the honest reason). */
export function requireFiniteSource(sources: readonly LiveSourceRow[]): LiveSourceRow {
  const source = finiteSourceOf(sources);
  if (source === null) {
    throw new Error(
      `no finite live-window source in the transport's own listing (${sources.length} sources)`,
    );
  }
  return source;
}
