/**
 * Shared steps for the three live-gate flows (L015/L016/L017) — everything
 * a flow needs around the REAL product surfaces: signing a fresh account
 * in through the real register form (the stream route's fail-closed auth
 * demands it — the same journey a real user walks), discovering the live
 * sources over the product's own listing, and recording measured evidence.
 */
import type { FlowContext } from "../lib/harness";
import type { BrowserDriver } from "../lib/browser-driver";
import { discoverLiveSources } from "../lib/live-gates";
import type { LiveSourceRow } from "../lib/live-instrument";

/**
 * Signs the browser out (idempotent — the role-switch flow may have left
 * the demo account signed in) so a live flow can start from a FRESH
 * anonymous state.
 */
export async function ensureSignedOut(browser: BrowserDriver): Promise<void> {
  if (browser.count(".account-button") === 0) return;
  browser.click(".account-button");
  const menu = await browser.waitForSelector(".signout-button", 10_000);
  if (menu) {
    browser.click(".signout-button");
    await browser.waitForJs(
      `(function(){return document.querySelector('.account-button') === null;})()`,
      15_000,
    );
  }
}

/**
 * Registers a FRESH account through the real register form (the product's
 * own /api/auth/register path — never a fixture session) and returns the
 * username. The live SSE route requires an authenticated session; this is
 * the real user's journey, not a harness shortcut.
 */
export async function registerLiveViewer(
  ctx: FlowContext,
  tag: string,
): Promise<{ username: string; password: string }> {
  const { browser, baseUrl, runId, recorder } = ctx;
  const username = `e2e-live-${tag}-${runId}`;
  const password = `e2e-live-pw-${runId}-10chars`;
  browser.open(`${baseUrl}/auth/signin`);
  if (!(await browser.waitForSelector("#auth-username", 15_000))) {
    throw new Error("the auth surface did not render for the live gate's sign-in");
  }
  if (browser.attr("section.auth-surface", "data-auth-mode") !== "register") {
    browser.clickText("Create an account");
  }
  browser.fill("#auth-username", username);
  browser.fill("#auth-password", password);
  const registered = await browser.clickForOutcome(
    "form.auth-form button[type='submit']",
    `(function(){return document.querySelector('.account-button') !== null || document.querySelector('p.form-error') !== null;})()`,
  );
  const signedIn = registered && (await browser.waitForSelector(".account-button", 10_000));
  if (!signedIn) {
    const error = browser.count("p.form-error") > 0 ? browser.text("p.form-error") : "(no error)";
    throw new Error(`the live gate's fresh account registration failed: ${error}`);
  }
  recorder.note(`signed in a fresh viewer account through the real register form (${username})`);
  return { username, password };
}

/** Discovers the live sources over the product's own listing; asserts the transport is really serving. */
export async function liveSourcesOf(ctx: FlowContext): Promise<LiveSourceRow[]> {
  const listing = await discoverLiveSources(ctx.api);
  if (!listing.available || listing.transportKind !== "live-network") {
    throw new Error(
      `the live transport is not serving (available=${listing.available}, transportKind=${listing.transportKind}, detail="${listing.detail}")`,
    );
  }
  return listing.sources;
}
