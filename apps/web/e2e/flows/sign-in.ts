/**
 * Flow sign-in (W909) — register → login → nav shows the account → sign out.
 *
 * A REAL fresh account is registered through the real form (the real
 * /api/auth/register + /api/auth/login over HttpOnly cookies), the shell's
 * account surface must show the account, sign-out clears it, and a second
 * sign-in of the SAME account proves the login path (not just the
 * register-auto-sign-in path).
 */
import type { FlowContext } from "../lib/harness";

export async function signInFlow(ctx: FlowContext): Promise<void> {
  const { recorder, browser, baseUrl, runId } = ctx;
  const { assert } = recorder;
  const username = `e2e-viewer-${runId}`;
  const password = `e2e-password-${runId}-10chars`;

  browser.open(`${baseUrl}/auth/signin`);
  assert(
    "auth surface renders",
    await browser.waitForSelector("#auth-username", 15_000),
    "selector #auth-username",
  );
  const authMode = browser.attr("section.auth-surface", "data-auth-mode");
  assert(
    "auth surface starts in sign-in mode",
    authMode === "signin",
    `data-auth-mode=${authMode}`,
  );

  // ------------------------------------------------------------- register
  browser.clickText("Create an account");
  const registerMode = browser.attr("section.auth-surface", "data-auth-mode");
  assert(
    "register tab switches the form",
    registerMode === "register",
    `data-auth-mode=${registerMode}`,
  );

  browser.fill("#auth-username", username);
  browser.fill("#auth-password", password);
  // The viewer role checkbox is checked by default — the fresh account holds
  // exactly the viewer grant (self-registration cannot mint more).
  // clickForOutcome: the auth page reflows seconds after load (web-font
  // swap), and a click dispatched at the pre-reflow coordinates lands on
  // empty page — a user re-clicks; so does the harness.
  const registered = await browser.clickForOutcome(
    "form.auth-form button[type='submit']",
    `(function(){return document.querySelector('.account-button') !== null || document.querySelector('p.form-error') !== null;})()`,
  );
  const accountShown = registered && (await browser.waitForSelector(".account-button", 10_000));
  assert("register signs the fresh account in", accountShown, "selector .account-button");
  const afterRegisterUrl = browser.url();
  assert(
    "register lands on the Library (the signed-in home)",
    afterRegisterUrl.includes("/library"),
    `url=${afterRegisterUrl}`,
  );
  const accountName = browser.text(".account-name");
  assert("the nav shows the account", accountName === username, `.account-name="${accountName}"`);
  const roleLine = browser.text(".account-role");
  assert(
    "the account chip shows no active role yet",
    roleLine.includes("no active role"),
    `.account-role="${roleLine}"`,
  );
  browser.screenshot(`${ctx.evidenceDir}/sign-in-registered.png`);
  recorder.screenshots.push("sign-in-registered.png");

  // ------------------------------------------------------------- sign out
  browser.click(".account-button");
  assert(
    "the account menu opens",
    await browser.waitForSelector(".signout-button", 10_000),
    "selector .signout-button",
  );
  browser.click(".signout-button");
  const signedOut = await browser.waitForJs(
    `(function(){return document.querySelector('.account-button') === null;})()`,
    15_000,
  );
  assert("sign out clears the account", signedOut, ".account-button gone");
  const signinLink = browser.eval<string>(
    `(function(){const a=document.querySelector('a[href="/auth/signin"]');return a?a.textContent.trim():'';})()`,
  );
  assert(
    "the header offers sign-in again",
    signinLink.toLowerCase().includes("sign in"),
    `link text="${signinLink}"`,
  );

  // --------------------- wrong-password honesty, BEFORE the real login
  // (the API's own classified error, surfaced — and no sign-in happens).
  // This runs while signed out, so the flow can then do the real LOGIN and
  // END signed in — the inventory's contract for the rights-denial flow
  // that follows ("sign-in ends SIGNED IN as the fresh viewer account").
  browser.open(`${baseUrl}/auth/signin`);
  assert(
    "auth surface renders again",
    await browser.waitForSelector("#auth-username", 15_000),
    "selector #auth-username",
  );
  browser.fill("#auth-username", username);
  browser.fill("#auth-password", "definitely-not-the-password");
  const errorAppeared = await browser.clickForOutcome(
    "form.auth-form button[type='submit']",
    `(function(){return document.querySelector('p.form-error') !== null || document.querySelector('.account-button') !== null;})()`,
  );
  // Read the error text ONLY when it rendered (agent-browser `get text`
  // throws on a missing selector — the flight-2 abort).
  const errorText =
    browser.count("p.form-error") > 0 ? browser.text("p.form-error") : "(no form-error rendered)";
  assert(
    "a wrong password shows the API's real error (no sign-in)",
    errorAppeared && browser.count("p.form-error") > 0 && browser.count(".account-button") === 0,
    `form-error="${errorText.slice(0, 120)}"`,
  );

  // ------------------------------------------- sign in AGAIN (the login path)
  browser.open(`${baseUrl}/auth/signin`);
  assert(
    "auth surface renders for the login",
    await browser.waitForSelector("#auth-username", 15_000),
    "selector #auth-username",
  );
  browser.fill("#auth-username", username);
  browser.fill("#auth-password", password);
  const signedInAgain = await browser.clickForOutcome(
    "form.auth-form button[type='submit']",
    `(function(){return document.querySelector('.account-button') !== null || document.querySelector('p.form-error') !== null;})()`,
  );
  assert(
    "login signs the existing account in",
    signedInAgain && (await browser.waitForSelector(".account-button", 10_000)),
    "selector .account-button",
  );
  const accountNameAfterLogin = browser.text(".account-name");
  assert(
    "the nav shows the same account after login",
    accountNameAfterLogin === username,
    `.account-name="${accountNameAfterLogin}"`,
  );
  browser.screenshot(`${ctx.evidenceDir}/sign-in-logged-in.png`);
  recorder.screenshots.push("sign-in-logged-in.png");
}
