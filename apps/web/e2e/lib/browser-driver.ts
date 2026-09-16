/**
 * The agent-browser driver (W909) — a thin, typed wrapper over the
 * `agent-browser` CLI (the sandbox's real headless-Chrome automation).
 *
 * One named browser session per harness run (AGENT_BROWSER_SESSION) so the
 * E2E never hijacks another agent's shared default browser. Every command
 * is a real CLI invocation against the real browser — nothing here fakes,
 * stubs or short-circuits a browser step.
 */
import { spawnSync } from "node:child_process";

/** One recorded command (evidence of what the browser was really asked). */
export interface BrowserCommandRecord {
  args: readonly string[];
  ok: boolean;
  stdout: string;
}

/** Thrown when a driver command fails (non-zero exit). */
export class BrowserCommandError extends Error {
  constructor(
    public readonly args: readonly string[],
    public readonly stdout: string,
    public readonly stderr: string,
  ) {
    super(`agent-browser ${args.join(" ")} failed: ${stderr || stdout}`);
    this.name = "BrowserCommandError";
  }
}

/**
 * True when an agent-browser click failure is the "covered by" refusal —
 * the CLI REFUSES to dispatch when another element (e.g. a sticky header)
 * overlaps the target's click point. The message shape (verified against
 * the CLI): "Element '.x' is covered by <div.y> at its click point, …".
 */
export function isCoveredByRefusal(message: string): boolean {
  return /is covered by .* at its click point/.test(message);
}

/** The breathing room (px) a covering-element nudge leaves around the cover. */
export const COVERING_NUDGE_MARGIN = 16;

/**
 * The window.scrollBy `top` (px) that clears a covering element sitting
 * ABOVE the target: scrolling by this delta moves the target's viewport
 * top to just below the cover's bottom edge (+ margin). Negative = the
 * page scrolls UP, so the target moves DOWN the viewport, out from under
 * a sticky top header. Pure math, unit-tested; the driver applies it to the
 * live rects the page reports.
 */
export function coveringNudgeDelta(
  target: { readonly top: number },
  cover: { readonly bottom: number },
  margin = COVERING_NUDGE_MARGIN,
): number {
  return target.top - cover.bottom - margin;
}

/**
 * Page-side twin of {@link coveringNudgeDelta}: measures the target and
 * whatever element actually covers its click point, and scrolls the page
 * so the target clears the cover (instantly — see `click`).
 */
function coveringNudgeJs(selector: string): string {
  return `(function () {
    const el = document.querySelector(${JSON.stringify(selector)});
    if (el === null) return 'gone';
    const r = el.getBoundingClientRect();
    const probe = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    if (probe === null || probe === el || el.contains(probe) || probe.contains(el)) return 'clear';
    const c = probe.getBoundingClientRect();
    window.scrollBy({ top: ${COVERING_NUDGE_MARGIN} + c.bottom - r.top, left: 0, behavior: 'instant' });
    return 'nudged';
  })()`;
}

export class BrowserDriver {
  readonly session: string;
  /** The last N command records (kept small; the report cites counts). */
  readonly commands: BrowserCommandRecord[] = [];
  private readonly maxRecords = 400;

  constructor(session: string) {
    this.session = session;
  }

  /** Runs one agent-browser CLI command. */
  run(args: readonly string[], timeoutMs = 45_000): string {
    const result = spawnSync("agent-browser", [...args], {
      encoding: "utf8",
      timeout: timeoutMs,
      env: { ...process.env, AGENT_BROWSER_SESSION: this.session },
    });
    const stdout = result.stdout ?? "";
    if (result.status !== 0) {
      throw new BrowserCommandError(args, stdout, result.stderr ?? "");
    }
    if (this.commands.length < this.maxRecords) {
      this.commands.push({ args, ok: true, stdout: stdout.slice(0, 400) });
    }
    return stdout;
  }

  /** Runs a command, returning its stdout without the CLI's status lines. */
  private clean(args: readonly string[]): string {
    return this.run(args).replace(/^[✓✗]\s*/gm, "").trim();
  }

  // ------------------------------------------------------------- navigation

  open(url: string): void {
    this.run(["open", url]);
  }

  url(): string {
    return this.clean(["get", "url"]);
  }

  title(): string {
    return this.clean(["get", "title"]);
  }

  reload(): void {
    this.run(["reload"]);
  }

  // ------------------------------------------------------------- interaction

  click(selector: string): void {
    // Bring the first match to the viewport center INSTANTLY, first: the
    // app's CSS `scroll-behavior: smooth` (globals.css) makes a plain
    // scrollIntoView animate asynchronously, and a click issued while that
    // animation is in flight either lands on whatever scrolled under the
    // stale coordinates (the silent "Play → Play" miss) or is REFUSED when
    // the hit-test catches the target still under the sticky site header
    // ("covered by <div.site-header-inner>"). `behavior:'instant'` bypasses
    // the CSS smooth scrolling AND cancels any in-flight smooth scroll, so
    // the geometry the click then measures is final. This is what a user's
    // hand does — aim, let the page settle, click.
    this.eval(
      `(function(){const el=document.querySelector(${JSON.stringify(selector)});if(el!==null)el.scrollIntoView({block:'center',inline:'nearest',behavior:'instant'});return el!==null;})()`,
    );
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        this.run(["click", selector]);
        return;
      } catch (error) {
        // agent-browser REFUSES a covered click as a hard error (it never
        // dispatches the input). Re-settle the geometry — nudge the page so
        // the covering element no longer overlaps the target — and retry.
        // A refusal that survives the retries is rethrown: the coverage is
        // real and the flow must report it, never green over it.
        if (
          !(error instanceof BrowserCommandError) ||
          !isCoveredByRefusal(error.message) ||
          attempt === 2
        ) {
          throw error;
        }
        this.eval(coveringNudgeJs(selector));
      }
    }
  }

  /**
   * Clicks and waits for `outcomeJs` (a page JS expression) to hold; if
   * nothing happened — a layout shift (e.g. the web-font swap reflow)
   * moved the button between agent-browser's coordinate measure and its
   * event dispatch, so the click landed on empty page — scrolls the target
   * into view and clicks again. Returns whether the outcome finally held.
   * (Covered-click REFUSALS are already settled+retried inside `click`.)
   */
  async clickForOutcome(
    selector: string,
    outcomeJs: string,
    attempts = 3,
    waitMs = 4_000,
  ): Promise<boolean> {
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      this.click(selector);
      if (await this.waitForJs(outcomeJs, waitMs)) return true;
    }
    return this.waitForJs(outcomeJs, 1_000);
  }

  clickText(text: string): void {
    // RAW text (no quotes): args bypass the shell, so JSON.stringify would
    // make the quotes part of the searched string (verified against the CLI).
    this.run(["find", "text", text, "click"]);
  }

  /**
   * Clicks the elements of `selector` for which `predicateJs` (a JS
   * EXPRESSION, evaluated with `this` = the element) is truthy: the page
   * marks the exact targets with `data-e2e-target`, agent-browser clicks
   * them, the marks are cleared. Deterministic where text search would be
   * ambiguous.
   */
  clickWhere(selector: string, predicateJs: string): number {
    const marked = this.eval<number>(`(function () {
      let n = 0;
      for (const el of document.querySelectorAll(${JSON.stringify(selector)})) {
        if (Function('return () => (' + ${JSON.stringify(predicateJs)} + ')').call(el)()) {
          el.setAttribute('data-e2e-target', '1');
          n += 1;
        }
      }
      return n;
    })()`);
    if (marked === 0) return 0;
    this.click("[data-e2e-target]");
    this.eval(
      `(function () { document.querySelectorAll('[data-e2e-target]').forEach(el => el.removeAttribute('data-e2e-target')); return 'cleared'; })()`,
    );
    return marked;
  }

  fill(selector: string, text: string): void {
    this.run(["fill", selector, text]);
  }

  press(key: string): void {
    this.run(["press", key]);
  }

  focus(selector: string): void {
    this.run(["focus", selector]);
  }

  screenshot(path: string): void {
    this.run(["screenshot", path]);
  }

  close(): void {
    this.run(["close"]);
  }

  // ------------------------------------------------------------------ reads

  text(selector: string): string {
    return this.clean(["get", "text", selector]);
  }

  attr(selector: string, name: string): string {
    return this.clean(["get", "attr", selector, name]);
  }

  count(selector: string): number {
    const value = this.clean(["get", "count", selector]);
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  /** Runs page JavaScript; the CLI prints the value — JSON when possible. */
  eval<T = unknown>(js: string): T {
    const out = this.clean(["eval", js]);
    try {
      return JSON.parse(out) as T;
    } catch {
      return out as unknown as T;
    }
  }

  /** The interactive-element snapshot (accessibility tree with refs). */
  snapshot(interactiveOnly = true): string {
    return this.clean(interactiveOnly ? ["snapshot", "-i"] : ["snapshot"]);
  }

  // ------------------------------------------------------------------ waits

  /** Waits for a selector to exist in the page (polling count). */
  async waitForSelector(selector: string, timeoutMs = 20_000): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (this.count(selector) > 0) return true;
      await Bun.sleep(250);
    }
    return this.count(selector) > 0;
  }

  /** Waits until an in-page predicate (eval'd JS returning boolean) holds. */
  async waitForJs(js: string, timeoutMs = 20_000): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (this.eval<boolean>(js) === true) return true;
      await Bun.sleep(300);
    }
    return this.eval<boolean>(js) === true;
  }

  /** Waits until the page URL contains `fragment`. */
  async waitForUrl(fragment: string, timeoutMs = 20_000): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (this.url().includes(fragment)) return true;
      await Bun.sleep(250);
    }
    return this.url().includes(fragment);
  }
}
