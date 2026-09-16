/**
 * Flow role-switch (W909) — the profile switcher:
 *
 * - GRANTS-ONLY: the menu offers EXACTLY the account's grants — the
 *   creator-registered account (viewer+creator) sees two; the demo
 *   account sees all five; switching to an ungranted role is impossible
 *   from the UI because the server refuses it (W907's HTTP proof);
 * - CONTEXT-ONLY: switching narrows the workspace NAVIGATION (the sidebar
 *   is the same one-model projection, now scoped to the role's surface
 *   map) while the URL safe-returns and the account stays one identity.
 */
import type { FlowContext } from "../lib/harness";

/** The sidebar nav's destination hrefs, in order. */
function navHrefs(ctx: FlowContext): string[] {
  return ctx.browser.eval<string[]>(
    `(function(){return [...document.querySelectorAll('nav.site-sidebar a.nav-link')].map(a => a.getAttribute('href'));})()`,
  );
}

async function openAccountMenu(ctx: FlowContext): Promise<string[]> {
  ctx.browser.click(".account-button");
  const opened = await ctx.browser.waitForSelector(".role-switcher", 10_000);
  if (!opened) throw new Error("account menu did not open");
  return ctx.browser.eval<string[]>(
    `(function(){return [...document.querySelectorAll('.role-switcher .role-option-name')].map(e => e.textContent.replace(/\\s*\\(current\\)\\s*$/,'').trim());})()`,
  );
}

/** Clicks one role option in the open account menu (exact label match). */
function clickRoleOption(ctx: FlowContext, label: string): number {
  return ctx.browser.clickWhere(
    ".role-option",
    `(this.querySelector('.role-option-name') || {textContent: ''}).textContent.replace(/\\s*\\(current\\)\\s*$/, '').trim() === ${JSON.stringify(label)}`,
  );
}

export async function roleSwitchFlow(ctx: FlowContext): Promise<void> {
  const { recorder, browser, baseUrl } = ctx;
  const { assert } = recorder;

  // ------------------------------------- the creator account (viewer+creator)
  assert(
    "the creator account is signed in",
    browser.count(".account-button") === 1,
    ".account-button present",
  );
  let offered = await openAccountMenu(ctx);
  recorder.note(`creator account's offered roles: ${offered.join(", ")}`);
  assert(
    "the switcher offers EXACTLY the account's grants (grants-only)",
    offered.length === 2 &&
      offered.includes("Viewer") &&
      offered.includes("Creator") &&
      !offered.includes("Operator / Admin") &&
      !offered.includes("Rights Holder"),
    `offered=[${offered.join(", ")}]`,
  );

  // Switch to Creator → the nav narrows to the creator workspace.
  const creatorClicked = clickRoleOption(ctx, "Creator");
  assert(
    "the Creator role option was clicked (exactly one)",
    creatorClicked === 1,
    `role options matching Creator: ${creatorClicked}`,
  );
  const roleLine = await browser.waitForJs(
    `(function(){const el=document.querySelector('.account-role');return el !== null && el.textContent.includes('Creator');})()`,
    15_000,
  );
  assert(
    "switching to Creator updates the account chip",
    roleLine,
    `.account-role="${browser.text(".account-role")}"`,
  );
  let nav = navHrefs(ctx);
  recorder.note(`creator workspace nav: ${nav.join(" | ")}`);
  assert(
    "the Creator workspace nav lists the Create Studio",
    nav.includes("/create"),
    `nav=[${nav.join(", ")}]`,
  );
  assert(
    "the Creator workspace nav omits operator surfaces",
    !nav.includes("/operations") && !nav.includes("/audit"),
    `nav=[${nav.join(", ")}]`,
  );
  const creatorUrl = browser.url();
  assert(
    "the switch safe-returns (no stranding navigation)",
    creatorUrl.includes("/create") || creatorUrl.includes("/library"),
    `url=${creatorUrl}`,
  );
  browser.screenshot(`${ctx.evidenceDir}/role-switch-creator.png`);
  recorder.screenshots.push("role-switch-creator.png");

  // Switch to Viewer → the nav narrows to the viewer workspace.
  await openAccountMenu(ctx);
  clickRoleOption(ctx, "Viewer");
  const viewerLine = await browser.waitForJs(
    `(function(){const el=document.querySelector('.account-role');return el !== null && el.textContent.includes('Viewer');})()`,
    15_000,
  );
  assert("switching back to Viewer updates the chip", viewerLine, `.account-role="${browser.text(".account-role")}"`);
  nav = navHrefs(ctx);
  recorder.note(`viewer workspace nav: ${nav.join(" | ")}`);
  assert(
    "the Viewer workspace nav lists the watching surfaces",
    nav.includes("/") && nav.includes("/watch"),
    `nav=[${nav.join(", ")}]`,
  );
  assert(
    "the Viewer workspace nav omits the Create Studio",
    !nav.includes("/create"),
    `nav=[${nav.join(", ")}]`,
  );

  // ------------------------------------------- the demo account (all five)
  browser.click(".account-button");
  await browser.waitForSelector(".signout-button", 10_000);
  browser.click(".signout-button");
  await browser.waitForJs(`(function(){return document.querySelector('.account-button') === null;})()`, 15_000);

  browser.open(`${baseUrl}/auth/signin`);
  await browser.waitForSelector("#auth-username", 15_000);
  browser.fill("#auth-username", "sporta-demo");
  browser.fill("#auth-password", ctx.demoPassword);
  const demoSignedIn = await browser.clickForOutcome(
    "form.auth-form button[type='submit']",
    `(function(){return document.querySelector('.account-button') !== null || document.querySelector('p.form-error') !== null;})()`,
  );
  assert(
    "the demo account signs in (one identity, five grants)",
    demoSignedIn && (await browser.waitForSelector(".account-button", 10_000)),
    "selector .account-button",
  );

  offered = await openAccountMenu(ctx);
  recorder.note(`demo account's offered roles: ${offered.join(", ")}`);
  assert(
    "the demo account's switcher offers all FIVE granted roles",
    offered.length === 5 &&
      ["Viewer", "Creator", "Analyst / Commentator", "Rights Holder", "Operator / Admin"].every(
        (label) => offered.includes(label),
      ),
    `offered=[${offered.join(", ")}]`,
  );

  // Switch to Operator → the operator workspace nav + a REAL console page.
  clickRoleOption(ctx, "Operator / Admin");
  const operatorLine = await browser.waitForJs(
    `(function(){const el=document.querySelector('.account-role');return el !== null && el.textContent.includes('Operator');})()`,
    15_000,
  );
  assert("switching to Operator updates the chip", operatorLine, `.account-role="${browser.text(".account-role")}"`);
  nav = navHrefs(ctx);
  recorder.note(`operator workspace nav: ${nav.join(" | ")}`);
  assert(
    "the Operator workspace nav lists the operations console",
    nav.includes("/operations"),
    `nav=[${nav.join(", ")}]`,
  );

  // With the operator role ACTIVE, the console renders REAL operator data
  // (the grant is the account's own — context vs authority proven by W907).
  browser.open(`${baseUrl}/operations`);
  const consoleReady = await browser.waitForSelector("section[aria-labelledby^='ops-']", 25_000);
  const opsText = browser.eval<string>(`(document.body.innerText || '').slice(0, 12000)`);
  assert(
    "the operator console renders real operational sections",
    consoleReady && opsText.length > 0,
    `sections=${browser.count("section[aria-labelledby^='ops-']")}`,
  );
  browser.screenshot(`${ctx.evidenceDir}/role-switch-operator-console.png`);
  recorder.screenshots.push("role-switch-operator-console.png");

  // Switch to Rights Holder → the rights workspace nav.
  await openAccountMenu(ctx);
  clickRoleOption(ctx, "Rights Holder");
  const rightsLine = await browser.waitForJs(
    `(function(){const el=document.querySelector('.account-role');return el !== null && el.textContent.includes('Rights');})()`,
    15_000,
  );
  assert("switching to Rights Holder updates the chip", rightsLine, `.account-role="${browser.text(".account-role")}"`);
  nav = navHrefs(ctx);
  assert(
    "the Rights Holder workspace nav lists the Rights Center",
    nav.includes("/rights"),
    `nav=[${nav.join(", ")}]`,
  );
  browser.screenshot(`${ctx.evidenceDir}/role-switch-rights-holder.png`);
  recorder.screenshots.push("role-switch-rights-holder.png");
}
