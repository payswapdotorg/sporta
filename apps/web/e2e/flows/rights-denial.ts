/**
 * Flow rights-denial (W909) — the real denial states, rendered by the app
 * from the server's own 403/401 answers, with NO operator/rights-holder
 * bytes reaching the browser:
 *
 * - a signed-in VIEWER (the fresh account from the sign-in flow) on
 *   /operations → the "Operator grant required" panel (the real 403 path);
 * - the same viewer on /rights → "The rights-holder grant is required"
 *   (the real 403 body surfaced);
 * - ANONYMOUS on /operations → the signed-in-operator requirement (the
 *   real 401 path);
 * - in every denied state, operator/rights-holder DATA (provider ids,
 *   queue depths, policy records) must be absent from the rendered bytes.
 */
import type { FlowContext } from "../lib/harness";

/** Data strings that only exist inside real 200 operator/rights payloads. */
const OPERATOR_DATA_MARKERS = ["sporta.compute.hosted", "renderQueue", "policySchemaVersion"];

/** The rendered page text (used for the no-bytes proof). */
function pageText(ctx: FlowContext): string {
  return ctx.browser.eval<string>(
    `(document.body && document.body.innerText || '').slice(0, 12000)`,
  );
}

export async function rightsDenialFlow(ctx: FlowContext): Promise<void> {
  const { recorder, browser, baseUrl } = ctx;
  const { assert } = recorder;

  // The sign-in flow left the fresh VIEWER signed in.
  assert(
    "the viewer account is signed in for the denial checks",
    browser.count(".account-button") === 1,
    `.account-button count=${browser.count(".account-button")}`,
  );

  // ------------------------------------------ viewer → /operations (real 403)
  browser.open(`${baseUrl}/operations`);
  const opsDenied = await browser.waitForSelector(".state-panel[data-surface-state]", 20_000);
  assert("the operations page renders a state panel", opsDenied, "selector .state-panel");
  const viewerOpsText = pageText(ctx);
  assert(
    "viewer on /operations sees the operator-grant denial",
    viewerOpsText.includes("Operator grant required") &&
      viewerOpsText.includes("self-registration cannot mint it"),
    `panel title + reason present=${viewerOpsText.includes("Operator grant required")}`,
  );
  const viewerOpsBytes = OPERATOR_DATA_MARKERS.filter((m) => viewerOpsText.includes(m));
  assert(
    "no operator bytes reach a denied viewer on /operations",
    viewerOpsBytes.length === 0,
    `markers found: ${viewerOpsBytes.length === 0 ? "none" : viewerOpsBytes.join(", ")}`,
  );
  browser.screenshot(`${ctx.evidenceDir}/rights-denial-operations-viewer.png`);
  recorder.screenshots.push("rights-denial-operations-viewer.png");

  // --------------------------------------------- viewer → /rights (real 403)
  browser.open(`${baseUrl}/rights`);
  const rightsDenied = await browser.waitForSelector(
    ".state-panel[data-surface-state='denied']",
    20_000,
  );
  const viewerRightsText = pageText(ctx);
  assert(
    "viewer on /rights sees the rights-holder-grant denial",
    rightsDenied &&
      viewerRightsText.includes("The rights-holder grant is required") &&
      viewerRightsText.includes("cannot be self-selected at registration"),
    `denied panel=${String(rightsDenied)}; text present=${viewerRightsText.includes("The rights-holder grant is required")}`,
  );
  assert(
    "no policy-record bytes reach a denied viewer on /rights",
    !viewerRightsText.includes("policySchemaVersion") && !viewerRightsText.includes("training"),
    `policy markers present=${viewerRightsText.includes("policySchemaVersion")}`,
  );
  browser.screenshot(`${ctx.evidenceDir}/rights-denial-rights-viewer.png`);
  recorder.screenshots.push("rights-denial-rights-viewer.png");

  // ------------------------------------ anonymous → /operations (real 401)
  browser.click(".account-button");
  await browser.waitForSelector(".signout-button", 10_000);
  browser.click(".signout-button");
  await browser.waitForJs(
    `(function(){return document.querySelector('.account-button') === null;})()`,
    15_000,
  );
  browser.open(`${baseUrl}/operations`);
  const anonOpsDenied = await browser.waitForSelector(".state-panel[data-surface-state]", 20_000);
  const anonOpsText = pageText(ctx);
  assert(
    "anonymous on /operations sees the sign-in requirement (the real 401 path)",
    anonOpsDenied && anonOpsText.includes("Operations requires a signed-in operator"),
    `panel present=${String(anonOpsDenied)}; text=${anonOpsText.includes("Operations requires a signed-in operator")}`,
  );
  const anonOpsBytes = OPERATOR_DATA_MARKERS.filter((m) => anonOpsText.includes(m));
  assert(
    "no operator bytes reach an anonymous visitor",
    anonOpsBytes.length === 0,
    `markers found: ${anonOpsBytes.length === 0 ? "none" : anonOpsBytes.join(", ")}`,
  );

  // -------------------------------------- anonymous → /rights (sign-in gate)
  browser.open(`${baseUrl}/rights`);
  const anonRightsDenied = await browser.waitForSelector(
    ".state-panel[data-surface-state='denied']",
    20_000,
  );
  const anonRightsText = pageText(ctx);
  assert(
    "anonymous on /rights sees the sign-in denial",
    anonRightsDenied && anonRightsText.includes("Sign in to inspect rights"),
    `denied panel=${String(anonRightsDenied)}`,
  );
  browser.screenshot(`${ctx.evidenceDir}/rights-denial-anonymous.png`);
  recorder.screenshots.push("rights-denial-anonymous.png");
}
