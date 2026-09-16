# W909 browser E2E — run mu3v0hdl

Target: http://127.0.0.1:3909 (production build, port 3909)

**8 passed / 0 failed** — 101 assertions passed, 0 failed.

| Flow | Outcome | Assertions | Evidence |
| --- | --- | --- | --- |
| Accessibility smoke — skip link, landmarks, alt text, contrast, keyboard | ✅ passed | 20/20 | a11y-smoke-watch.png |
| Sign-in — register → login → nav shows the account → sign out | ✅ passed | 15/15 | sign-in-registered.png, sign-in-logged-in.png |
| Rights denial — viewer/anonymous on a denied route → real 403 state, no bytes | ✅ passed | 9/9 | rights-denial-operations-viewer.png, rights-denial-rights-viewer.png, rights-denial-anonymous.png |
| Watch — the real output renders (SVG frames) + timeline/event markers | ✅ passed | 1/1 | watch-failure.png |
| Reality Switcher — real availabilities, switch without page reload | ✅ passed | 13/13 | reality-switch-after.png |
| Output playback — the real output document loads and its frames render | ✅ passed | 8/8 | output-playback.png |
| Render — guided flow → dispatch → progress → succeeded → output exists | ✅ passed | 18/18 | render-succeeded.png |
| Role switch — grants-only offers; switching changes the workspace nav | ✅ passed | 17/17 | role-switch-creator.png, role-switch-operator-console.png, role-switch-rights-holder.png |

## Accessibility smoke — skip link, landmarks, alt text, contrast, keyboard

- ✅ **home page renders** — title=Home
- ✅ **skip link is present** — count=1
- ✅ **skip link is named for screen readers** — text="Skip to main content"
- ✅ **skip link is the first keyboard stop** — first focus: class="skip-link" id=""
- ✅ **activating the skip link focuses the main landmark** — activeElement=main-content|MAIN
- ✅ **header landmark present** — count=6
- ✅ **nav landmarks present** — count=3
- ✅ **nav landmarks are labelled** — labels=["Primary","Footer","Primary"]
- ✅ **main landmark present** — count=1
- ✅ **footer landmark present** — count=1
- ✅ **contrast spot-check has measurable pairs** — 4 measurable of 4 collected
- ✅ **contrast AA for .skip-link** — rgb(255, 255, 255) on rgb(0, 112, 62) → 6.20:1
- ✅ **contrast AA for .brand** — rgb(19, 26, 42) on rgb(242, 245, 250) → 15.90:1
- ✅ **contrast AA for .session-card-title** — rgb(19, 26, 42) on rgb(255, 255, 255) → 17.37:1
- ✅ **contrast AA for .section-lede** — rgb(70, 83, 107) on rgb(242, 245, 250) → 7.09:1
- ✅ **keyboard navigation reaches into the main landmark** — focus entered <main> during the 30-stop walk=true
- ✅ **keyboard navigation moves through distinct interactive elements** — 12 distinct stops over 30 tabs
- ✅ **watch page renders the player for the alt-text check** — selector .player-surface
- ✅ **every <img> on the watch page has alt text** — 0 imgs, 0 missing
- ✅ **every role="img" (the SVG frame stages) has an aria-label** — 1 role=img, 0 missing
- 📝 contrast spot-check pairs: .skip-link=6.20, .brand=15.90, .session-card-title=17.37, .section-lede=7.09
- 📝 tab stops (last 8): BODY → skip-link → brand → site-search-input → search-submit → signin-link → nav-link → nav-link
- 📝 alt coverage: 0 <img> (0 missing alt), 1 role="img" (0 missing aria-label)

## Sign-in — register → login → nav shows the account → sign out

- ✅ **auth surface renders** — selector #auth-username
- ✅ **auth surface starts in sign-in mode** — data-auth-mode=signin
- ✅ **register tab switches the form** — data-auth-mode=register
- ✅ **register signs the fresh account in** — selector .account-button
- ✅ **register lands on the Library (the signed-in home)** — url=http://127.0.0.1:3909/library
- ✅ **the nav shows the account** — .account-name="e2e-viewer-mu3v0hdl"
- ✅ **the account chip shows no active role yet** — .account-role="no active role"
- ✅ **the account menu opens** — selector .signout-button
- ✅ **sign out clears the account** — .account-button gone
- ✅ **the header offers sign-in again** — link text="Sign in"
- ✅ **auth surface renders again** — selector #auth-username
- ✅ **a wrong password shows the API's real error (no sign-in)** — form-error="invalid username or password"
- ✅ **auth surface renders for the login** — selector #auth-username
- ✅ **login signs the existing account in** — selector .account-button
- ✅ **the nav shows the same account after login** — .account-name="e2e-viewer-mu3v0hdl"

## Rights denial — viewer/anonymous on a denied route → real 403 state, no bytes

- ✅ **the viewer account is signed in for the denial checks** — .account-button count=1
- ✅ **the operations page renders a state panel** — selector .state-panel
- ✅ **viewer on /operations sees the operator-grant denial** — panel title + reason present=true
- ✅ **no operator bytes reach a denied viewer on /operations** — markers found: none
- ✅ **viewer on /rights sees the rights-holder-grant denial** — denied panel=true; text present=true
- ✅ **no policy-record bytes reach a denied viewer on /rights** — policy markers present=false
- ✅ **anonymous on /operations sees the sign-in requirement (the real 401 path)** — panel present=true; text=true
- ✅ **no operator bytes reach an anonymous visitor** — markers found: none
- ✅ **anonymous on /rights sees the sign-in denial** — denied panel=true

## Watch — the real output renders (SVG frames) + timeline/event markers

- ✅ **the watch page renders the player for the seeded session** — session=sess-1; selector .player-surface
- 📝 FLOW ABORTED: agent-browser get attr .player-stage[role='img'] aria-label failed: ✗ Element not found: .player-stage[role='img']. Verify the selector, role, or name is correct and the element exists in the DOM.


## Reality Switcher — real availabilities, switch without page reload

- ✅ **the watch page is still open on the seeded session** — url=http://127.0.0.1:3909/watch?session=sess-1
- ✅ **the switcher lists renderer options** — 2 options
- ✅ **a stored-output renderer (anime.prototype) is offered ready** — state=ready disabled=false
- ✅ **non-ready options carry an honest reason (never a fake 'coming soon')** — 1 non-ready options, all disabled with reasons
- ✅ **the current player surface names its renderer** — data-renderer=anime.prototype
- ✅ **a switch target with a stored output exists** — target=anime.prototype
- ✅ **the target renderer's switcher option was clicked** — switcher options matching anime.prototype: 1
- ✅ **switching updates the player surface to the target renderer** — data-renderer now=anime.prototype
- ✅ **the switch did NOT reload the page (window marker survives)** — marker="e2e-alive-mu3v0hdl"
- ✅ **the match session is held constant (same watch URL)** — url=http://127.0.0.1:3909/watch?session=sess-1
- ✅ **the switched surface renders the target renderer's output** — aria-label="The anime.prototype rendering of match session sess-1, frame 1 of 6"
- ✅ **the switched surface carries SVG frames** — svg elements=1
- ✅ **the switch reported itself (aria-live notice)** — notice="anime.prototype: this reality is already showing"
- 📝 switcher options: anime.prototype=ready, sporta.testcard=no-stored-output (disabled)

## Output playback — the real output document loads and its frames render

- ✅ **the watch page is open for the playback checks** — selector .player-surface
- ✅ **the real output document loads (200 JSON segment document)** — status=200 content-type=application/json
- ✅ **the output document carries its artifact-source header** — x-sporta-artifact-source=in-memory
- ✅ **the output document's manifest counts real frames** — manifest.frameCount=6
- ✅ **event markers offer frame jumps** — marker-jump count=3
- ✅ **a marker targeting a different frame exists to jump to** — markers off frame 1: 2
- ✅ **an event-marker jump moves the playhead (snaps to a real frame)** — seek: "0:00, frame 1 of 6" → "0:02, frame 3 of 6"
- ✅ **the play transport starts playback (Play → Pause)** — toggle: "Play" → "Pause"
- 📝 output document /api/watch/sess-1/renders/r-2/outputs/anime-clip-c0f83b01 → 200 application/json (source=in-memory, frames=6)

## Render — guided flow → dispatch → progress → succeeded → output exists

- ✅ **auth surface renders for the creator registration** — selector #auth-username
- ✅ **the creator role checkbox was picked** — role-picker options matching creator: 1
- ✅ **the creator account registers and signs in** — selector .account-button
- ✅ **the Create Studio renders its guided flow** — selector .studio-stepper
- ✅ **the authorized source list offers real fixtures** — radio inputs present
- ✅ **step 2 (rights declaration) is reached** — selector #studio-rights-heading
- ✅ **the server-derived rights preview renders (fail-closed derivation)** — selector .studio-rights-preview
- ✅ **the preview lists derived capabilities** — permit lines=4
- ✅ **step 3 (renderer) is reached** — selector #studio-renderer-heading
- ✅ **at least one registered renderer is dispatchable** — dispatchable renderer radios=1
- ✅ **step 4 (recipe) is reached** — selector #studio-recipe-heading
- ✅ **step 5 (review) is reached** — selector #studio-review-heading
- ✅ **the render step renders (session + job dispatched)** — selector #studio-render-heading
- ✅ **the dispatched session id is shown** — session code="sess-4"
- ✅ **the job reaches succeeded and the output EXISTS (a real rendered frame preview)** — selector .studio-preview [aria-label^='A real frame of the rendered output']
- ✅ **the completion accounting is rendered (consumed inputs, usage, outputs)** — completion fact rows=5
- ✅ **the output preview renders SVG frames** — svg elements=1
- ✅ **the 'Open in Watch' hand-off targets the new session** — href=/watch?session=sess-4
- 📝 dispatched session sess-4

## Role switch — grants-only offers; switching changes the workspace nav

- ✅ **the creator account is signed in** — .account-button present
- ✅ **the switcher offers EXACTLY the account's grants (grants-only)** — offered=[Viewer, Creator]
- ✅ **the Creator role option was clicked (exactly one)** — role options matching Creator: 1
- ✅ **switching to Creator updates the account chip** — .account-role="Creator workspace"
- ✅ **the Creator workspace nav lists the Create Studio** — nav=[/, /create, /jobs, /library]
- ✅ **the Creator workspace nav omits operator surfaces** — nav=[/, /create, /jobs, /library]
- ✅ **the switch safe-returns (no stranding navigation)** — url=http://127.0.0.1:3909/create
- ✅ **switching back to Viewer updates the chip** — .account-role="Viewer workspace"
- ✅ **the Viewer workspace nav lists the watching surfaces** — nav=[/, /live, /explore, /watch, /library]
- ✅ **the Viewer workspace nav omits the Create Studio** — nav=[/, /live, /explore, /watch, /library]
- ✅ **the demo account signs in (one identity, five grants)** — selector .account-button
- ✅ **the demo account's switcher offers all FIVE granted roles** — offered=[Viewer, Creator, Analyst / Commentator, Rights Holder, Operator / Admin]
- ✅ **switching to Operator updates the chip** — .account-role="Operator / Admin workspace"
- ✅ **the Operator workspace nav lists the operations console** — nav=[/operations, /jobs, /operations#health, /operations#providers, /audit]
- ✅ **the operator console renders real operational sections** — sections=5
- ✅ **switching to Rights Holder updates the chip** — .account-role="Rights Holder workspace"
- ✅ **the Rights Holder workspace nav lists the Rights Center** — nav=[/, /rights, /explore, /audit]
- 📝 creator account's offered roles: Viewer, Creator
- 📝 creator workspace nav: / | /create | /jobs | /library
- 📝 viewer workspace nav: / | /live | /explore | /watch | /library
- 📝 demo account's offered roles: Viewer, Creator, Analyst / Commentator, Rights Holder, Operator / Admin
- 📝 operator workspace nav: /operations | /jobs | /operations#health | /operations#providers | /audit

