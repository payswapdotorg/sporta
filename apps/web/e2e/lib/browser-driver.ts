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
    this.run(["click", selector]);
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
