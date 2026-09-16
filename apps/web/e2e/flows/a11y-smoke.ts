/**
 * Flow a11y-smoke (W909) — the accessibility smoke, run ANONYMOUS first:
 *
 * - skip link present + focusable + it moves focus to the main landmark;
 * - landmarks (header / nav / main / footer) with their labels;
 * - every <img> has alt and every role="img" has an aria-label (checked on
 *   the watch page where the real SVG frames render);
 * - contrast spot-check: the visible text pairs the browser collects are
 *   computed by the pure WCAG math in ../lib/contrast (build-time palette
 *   spot-checked at runtime — honest boundary: this is a smoke, not an audit);
 * - keyboard navigation reaches the main interactive elements (Tab walk).
 */
import { contrastRatio, meetsWcagAaNormal } from "../lib/contrast";
import type { FlowContext } from "../lib/harness";

/** Collects a text pair's rendered colors (ancestor walk for alpha bg). */
const COLOR_PAIR_JS = `(function () {
  function effectiveBg(el) {
    let node = el;
    while (node && node !== document.documentElement) {
      const bg = getComputedStyle(node).backgroundColor;
    const m = bg.match(/rgba?\\((\\d+),\\s*(\\d+),\\s*(\\d+)(?:,\\s*([\\d.]+))?\\)/);
      if (m && (m[4] === undefined || Number(m[4]) > 0.9)) return bg;
      node = node.parentElement;
    }
    return 'rgb(255, 255, 255)';
  }
  const selectors = ['.skip-link', '.brand', '.session-card-title', '.field-hint',
                      '.account-name', '.page-header .lede', '.section-lede', '.state-panel p'];
  const pairs = [];
  for (const sel of selectors) {
    for (const el of document.querySelectorAll(sel).slice(0, 1)) {
      const style = getComputedStyle(el);
      if ((el.textContent || '').trim().length === 0) continue;
      pairs.push({ selector: sel, text: (el.textContent || '').trim().slice(0, 40),
                   fg: style.color, bg: effectiveBg(el) });
    }
  }
  return pairs;
})()`;

export async function a11ySmokeFlow(ctx: FlowContext): Promise<void> {
  const { recorder, browser, baseUrl } = ctx;
  const { assert, check } = recorder;

  // ---------------------------------------------------------------- home page
  browser.open(`${baseUrl}/`);
  const homeReady = await browser.waitForSelector("#main-content", 15_000);
  assert("home page renders", homeReady, `title=${browser.title()}`);

  // Skip link: present, focusable, and it moves focus into main.
  assert("skip link is present", browser.count(".skip-link") === 1, `count=${browser.count(".skip-link")}`);
  const skipText = browser.text(".skip-link");
  assert("skip link is named for screen readers", skipText.toLowerCase().includes("skip to main"), `text="${skipText}"`);
  browser.press("Tab");
  const firstFocus = browser.eval<{ cls: string; id: string }>(
    `(function(){const el=document.activeElement;return {cls: el ? el.className : '', id: el ? el.id : ''};})()`,
  );
  check(
    "skip link is the first keyboard stop",
    typeof firstFocus.cls === "string" && firstFocus.cls.includes("skip-link"),
    `first focus: class="${firstFocus.cls}" id="${firstFocus.id}"`,
  );
  browser.focus(".skip-link");
  browser.press("Enter");
  const afterSkip = browser.eval<string>(
    `(function(){const el=document.activeElement;return el ? el.id + '|' + el.tagName : 'none';})()`,
  );
  assert(
    "activating the skip link focuses the main landmark",
    afterSkip.startsWith("main-content"),
    `activeElement=${afterSkip}`,
  );

  // Landmarks: header, nav (named), main, footer.
  const landmarks = browser.eval<{
    headers: number;
    navs: number;
    main: number;
    footer: number;
    navLabels: string[];
  }>(`(function(){
    const navs = [...document.querySelectorAll('nav')].map(n => n.getAttribute('aria-label') || '');
    return { headers: document.querySelectorAll('header').length,
             navs: navs.length, main: document.querySelectorAll('main').length,
             footer: document.querySelectorAll('footer').length, navLabels: navs };
  })()`);
  assert("header landmark present", landmarks.headers >= 1, `count=${landmarks.headers}`);
  assert("nav landmarks present", landmarks.navs >= 1, `count=${landmarks.navs}`);
  assert(
    "nav landmarks are labelled",
    landmarks.navLabels.length >= 1 && landmarks.navLabels.every((l) => l.length > 0),
    `labels=${JSON.stringify(landmarks.navLabels)}`,
  );
  assert("main landmark present", landmarks.main >= 1, `count=${landmarks.main}`);
  assert("footer landmark present", landmarks.footer >= 1, `count=${landmarks.footer}`);

  // Contrast spot-check (the pure math is unit-tested at the root).
  const pairs = browser.eval<{ selector: string; fg: string; bg: string }[]>(COLOR_PAIR_JS);
  const checked = pairs.map((pair) => {
    const ratio = contrastRatio(pair.fg, pair.bg);
    return { ...pair, ratio };
  });
  recorder.note(
    `contrast spot-check pairs: ${checked.map((c) => `${c.selector}=${c.ratio === null ? "n/a" : c.ratio.toFixed(2)}`).join(", ")}`,
  );
  const measurable = checked.filter((c) => c.ratio !== null);
  assert(
    "contrast spot-check has measurable pairs",
    measurable.length >= 3,
    `${measurable.length} measurable of ${checked.length} collected`,
  );
  for (const pair of measurable) {
    check(
      `contrast AA for ${pair.selector}`,
      meetsWcagAaNormal(pair.ratio!),
      `${pair.fg} on ${pair.bg} → ${pair.ratio!.toFixed(2)}:1`,
    );
  }

  // Keyboard: Tab reaches the header's interactive elements then main content.
  browser.open(`${baseUrl}/`);
  await browser.waitForSelector("#main-content", 15_000);
  const stops: string[] = [];
  for (let i = 0; i < 30; i += 1) {
    browser.press("Tab");
    const stop = browser.eval<string>(
      `(function(){const el=document.activeElement;if(!el)return 'none';return (el.id || el.className || el.tagName).toString().slice(0,60);})()`,
    );
    stops.push(stop);
    if (stop === "none") break;
  }
  const reachedMain = browser.eval<boolean>(
    `(function(){const el=document.activeElement;return el !== null && el.closest('main') !== null;})()`,
  );
  recorder.note(`tab stops (last 8): ${stops.slice(-8).join(" → ")}`);
  assert(
    "keyboard navigation reaches into the main landmark",
    reachedMain,
    `${stops.length} tab stops walked; activeElement in main=${reachedMain}`,
  );
  const uniqueStops = new Set(stops);
  assert(
    "keyboard navigation moves through distinct interactive elements",
    uniqueStops.size >= 8,
    `${uniqueStops.size} distinct stops over ${stops.length} tabs`,
  );

  // --------------------------------------------------- watch page (real SVG)
  const sessionId = ctx.discovery.primarySession.sessionId;
  browser.open(`${baseUrl}/watch?session=${encodeURIComponent(sessionId)}`);
  const playerReady = await browser.waitForSelector(".player-surface", 20_000);
  assert("watch page renders the player for the alt-text check", playerReady, "selector .player-surface");

  const images = browser.eval<{
    img: { total: number; missingAlt: number };
    roleImg: { total: number; missingLabel: number };
  }>(`(function(){
    const imgs = [...document.querySelectorAll('img')];
    const roleImgs = [...document.querySelectorAll('[role="img"]')];
    return { img: { total: imgs.length, missingAlt: imgs.filter(i => !i.hasAttribute('alt')).length },
             roleImg: { total: roleImgs.length, missingLabel: roleImgs.filter(i => !(i.getAttribute('aria-label') || '').trim()).length } };
  })()`);
  recorder.note(
    `alt coverage: ${images.img.total} <img> (${images.img.missingAlt} missing alt), ${images.roleImg.total} role="img" (${images.roleImg.missingLabel} missing aria-label)`,
  );
  assert(
    "every <img> on the watch page has alt text",
    images.img.missingAlt === 0,
    `${images.img.total} imgs, ${images.img.missingAlt} missing`,
  );
  assert(
    "every role=\"img\" (the SVG frame stages) has an aria-label",
    images.roleImg.total >= 1 && images.roleImg.missingLabel === 0,
    `${images.roleImg.total} role=img, ${images.roleImg.missingLabel} missing`,
  );

  browser.screenshot(`${ctx.evidenceDir}/a11y-smoke-watch.png`);
  recorder.screenshots.push("a11y-smoke-watch.png");
}
