/**
 * Flow render (W909) — the full Create Studio guided flow in the real
 * browser: register a CREATOR account → /create → authorized source →
 * rights declaration (the server-derived preview) → renderer → recipe →
 * review → DISPATCH → REAL progress (the compute ledger's own events) →
 * SUCCEEDED → the stored output EXISTS (a real rendered frame preview +
 * the "Open in Watch" hand-off).
 */
import type { FlowContext } from "../lib/harness";

export async function renderFlow(ctx: FlowContext): Promise<void> {
  const { recorder, browser, baseUrl, runId } = ctx;
  const { assert } = recorder;
  const username = `e2e-creator-${runId}`;
  const password = `e2e-password-${runId}-10chars`;

  // ------------------------------------------------- register a creator
  browser.open(`${baseUrl}/auth/signin`);
  assert(
    "auth surface renders for the creator registration",
    await browser.waitForSelector("#auth-username", 15_000),
    "selector #auth-username",
  );
  browser.clickText("Create an account");
  browser.fill("#auth-username", username);
  browser.fill("#auth-password", password);
  // The creator grant checkbox (viewer stays checked too) — clicked by its
  // own label so the text search cannot hit some other "creator" string.
  const creatorPicked = browser.clickWhere(
    "label.role-picker-option",
    `(this.textContent || '').trim() === 'creator'`,
  );
  assert(
    "the creator role checkbox was picked",
    creatorPicked === 1,
    `role-picker options matching creator: ${creatorPicked}`,
  );
  // clickForOutcome (the sign-in flow's fix): the auth page reflows seconds
  // after load (web-font swap) and a click dispatched at the pre-reflow
  // coordinates lands on empty page — a user re-clicks; so does the harness.
  // The outcome is the account chip OR the form's own error surface — if the
  // register POST genuinely fails, the error text is surfaced as evidence.
  const registered = await browser.clickForOutcome(
    "form.auth-form button[type='submit']",
    `(function(){return document.querySelector('.account-button') !== null || document.querySelector('p.form-error') !== null;})()`,
  );
  assert(
    "the creator account registers and signs in",
    registered && (await browser.waitForSelector(".account-button", 10_000)),
    browser.count("p.form-error") > 0
      ? `form-error="${browser.text("p.form-error").slice(0, 120)}"`
      : "selector .account-button",
  );

  // ------------------------------------------------------- /create studio
  browser.open(`${baseUrl}/create`);
  assert(
    "the Create Studio renders its guided flow",
    await browser.waitForSelector(".studio-stepper", 20_000),
    "selector .studio-stepper",
  );
  const options = await browser.waitForSelector(".studio-source input[type='radio']", 20_000);
  assert("the authorized source list offers real fixtures", options, "radio inputs present");

  // Step 1 — source.
  browser.click(".studio-source input[type='radio']");
  browser.click(".studio-nav .button-primary"); // Continue
  assert(
    "step 2 (rights declaration) is reached",
    await browser.waitForSelector("#studio-rights-heading", 10_000),
    "selector #studio-rights-heading",
  );

  // Step 2 — rights (default declaration: the four operations).
  const previewShown = await browser.waitForSelector(".studio-rights-preview", 15_000);
  assert(
    "the server-derived rights preview renders (fail-closed derivation)",
    previewShown,
    "selector .studio-rights-preview",
  );
  const permitLines = browser.count(".studio-permit-list li");
  assert("the preview lists derived capabilities", permitLines >= 3, `permit lines=${permitLines}`);
  browser.click(".studio-nav .button-primary"); // Continue

  // Step 3 — renderer (first dispatchable one).
  assert(
    "step 3 (renderer) is reached",
    await browser.waitForSelector("#studio-renderer-heading", 10_000),
    "selector #studio-renderer-heading",
  );
  const dispatchable = browser.eval<number>(
    `(function(){return [...document.querySelectorAll('input[name="studio-renderer"]')].filter(r => !r.disabled).length;})()`,
  );
  assert(
    "at least one registered renderer is dispatchable",
    dispatchable >= 1,
    `dispatchable renderer radios=${dispatchable}`,
  );
  browser.click(`input[name="studio-renderer"]:not([disabled])`);
  browser.click(".studio-nav .button-primary"); // Continue

  // Step 4 — recipe.
  assert(
    "step 4 (recipe) is reached",
    await browser.waitForSelector("#studio-recipe-heading", 10_000),
    "selector #studio-recipe-heading",
  );
  browser.fill("#studio-style", `e2e-${runId}`);
  browser.click(".studio-nav .button-primary"); // Continue

  // Step 5 — review + dispatch.
  assert(
    "step 5 (review) is reached",
    await browser.waitForSelector("#studio-review-heading", 10_000),
    "selector #studio-review-heading",
  );
  browser.clickText("Create session and render");

  // Step 6 — dispatch → progress → succeeded.
  assert(
    "the render step renders (session + job dispatched)",
    await browser.waitForSelector("#studio-render-heading", 20_000),
    "selector #studio-render-heading",
  );
  // The render step's session id (the section is keyed by its heading — the
  // flight-2 selector `.studio-render` matched nothing and aborted the flow).
  const dispatchedSession = browser.text("section[aria-labelledby='studio-render-heading'] code");
  assert(
    "the dispatched session id is shown",
    /^sess-/.test(dispatchedSession.trim()),
    `session code="${dispatchedSession.trim()}"`,
  );
  recorder.note(`dispatched session ${dispatchedSession.trim()}`);

  const succeeded = await browser.waitForSelector(
    ".studio-preview [aria-label^='A real frame of the rendered output']",
    90_000,
  );
  assert(
    "the job reaches succeeded and the output EXISTS (a real rendered frame preview)",
    succeeded,
    "selector .studio-preview [aria-label^='A real frame of the rendered output']",
  );

  // The completion accounting (the never-silent ledger) rendered.
  const completion = browser.count(".studio-completion .fact");
  assert(
    "the completion accounting is rendered (consumed inputs, usage, outputs)",
    completion >= 3,
    `completion fact rows=${completion}`,
  );

  // The preview is a REAL stored artifact frame (inline SVG on the page).
  const previewSvg = browser.eval<number>(
    `(function(){return document.querySelectorAll('.studio-preview svg').length;})()`,
  );
  assert("the output preview renders SVG frames", previewSvg >= 1, `svg elements=${previewSvg}`);

  // The watch hand-off exists and points at the new session.
  const watchHref = browser.eval<string>(
    `(function(){const a=[...document.querySelectorAll('a')].find(a => (a.getAttribute('href')||'').includes('/watch?session='));return a ? a.getAttribute('href') : '';})()`,
  );
  assert(
    "the 'Open in Watch' hand-off targets the new session",
    watchHref.includes("/watch?session=") &&
      watchHref.includes(encodeURIComponent(dispatchedSession.trim())),
    `href=${watchHref}`,
  );

  browser.screenshot(`${ctx.evidenceDir}/render-succeeded.png`);
  recorder.screenshots.push("render-succeeded.png");
}
