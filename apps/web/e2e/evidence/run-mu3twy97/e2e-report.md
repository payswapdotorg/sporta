# W909 browser E2E — run mu3twy97

Target: http://127.0.0.1:3909 (production build, port 3909)

**6 passed / 2 failed** — 77 assertions passed, 2 failed.

| Flow | Outcome | Assertions | Evidence |
| --- | --- | --- | --- |
| Accessibility smoke — skip link, landmarks, alt text, contrast, keyboard | ✅ passed | 20/20 | a11y-smoke-watch.png |
| Sign-in — register → login → nav shows the account → sign out | ✅ passed | 15/15 | sign-in-registered.png, sign-in-logged-in.png |
| Rights denial — viewer/anonymous on a denied route → real 403 state, no bytes | ✅ passed | 9/9 | rights-denial-operations-viewer.png, rights-denial-rights-viewer.png, rights-denial-anonymous.png |
| Watch — the real output renders (SVG frames) + timeline/event markers | ✅ passed | 11/11 | watch-seeded-session.png |
| Reality Switcher — real availabilities, switch without page reload | ✅ passed | 13/13 | reality-switch-after.png |
| Output playback — the real output document loads and its frames render | ✅ passed | 7/7 | output-playback-failure.png |
| Render — guided flow → dispatch → progress → succeeded → output exists | ❌ failed | 2/3 | render-failure.png |
| Role switch — grants-only offers; switching changes the workspace nav | ❌ failed | 0/1 | role-switch-failure.png |

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
- ✅ **the nav shows the account** — .account-name="e2e-viewer-mu3twy97"
- ✅ **the account chip shows no active role yet** — .account-role="no active role"
- ✅ **the account menu opens** — selector .signout-button
- ✅ **sign out clears the account** — .account-button gone
- ✅ **the header offers sign-in again** — link text="Sign in"
- ✅ **auth surface renders again** — selector #auth-username
- ✅ **a wrong password shows the API's real error (no sign-in)** — form-error="invalid username or password"
- ✅ **auth surface renders for the login** — selector #auth-username
- ✅ **login signs the existing account in** — selector .account-button
- ✅ **the nav shows the same account after login** — .account-name="e2e-viewer-mu3twy97"

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
- ✅ **the output's frame stage is present and labelled** — aria-label="The anime.prototype rendering of match session sess-1, frame 1 of 6"
- ✅ **the real output renders SVG frames** — svg/frame elements in stage=1
- ✅ **the artifact's own manifest clock drives the frame count** — aria-label says "of 6"
- ✅ **the player's frame clock matches the manifest** — .player-clock-frame="frame 1 of 6"
- ✅ **the timeline renders the manifest's frame windows** — windows=6
- ✅ **event markers are visible on the timeline** — timeline-marker dots=3; marker-jump buttons=3
- ✅ **the event marker list is rendered (real SWM events)** — marker-jump buttons=3
- ✅ **the output is honestly labeled a review artifact** — note="Rendered output — review format: this is the real stored artifact (a self-contai…"
- ✅ **the provenance panel renders the active renderer's real identity** — data-renderer=anime.prototype; panel starts="Provenance — the real artifact
RENDERER
anime.prototype@0.1."
- ✅ **the provenance panel renders the real byte + hash accounting** — bytes line present=true

## Reality Switcher — real availabilities, switch without page reload

- ✅ **the watch page is still open on the seeded session** — url=http://127.0.0.1:3909/watch?session=sess-1
- ✅ **the switcher lists renderer options** — 2 options
- ✅ **a stored-output renderer (anime.prototype) is offered ready** — state=ready disabled=false
- ✅ **non-ready options carry an honest reason (never a fake 'coming soon')** — 1 non-ready options, all disabled with reasons
- ✅ **the current player surface names its renderer** — data-renderer=anime.prototype
- ✅ **a switch target with a stored output exists** — target=anime.prototype
- ✅ **the target renderer's switcher option was clicked** — switcher options matching anime.prototype: 1
- ✅ **switching updates the player surface to the target renderer** — data-renderer now=anime.prototype
- ✅ **the switch did NOT reload the page (window marker survives)** — marker="e2e-alive-mu3twy97"
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
- 📝 output document /api/watch/sess-1/renders/r-2/outputs/anime-clip-c0f83b01 → 200 application/json (source=in-memory, frames=6)
- 📝 FLOW ABORTED: agent-browser click .player-toggle failed: ✗ Element '.player-toggle' is covered by <div.site-header-inner> at its click point, so the input would land on that element instead. Dismiss or interact with the covering element first (it is often a dialog, banner, or sticky header).


## Render — guided flow → dispatch → progress → succeeded → output exists

- ✅ **auth surface renders for the creator registration** — selector #auth-username
- ✅ **the creator role checkbox was picked** — role-picker options matching creator: 1
- ❌ **the creator account registers and signs in** — selector .account-button
- 📝 FLOW ABORTED: the creator account registers and signs in — selector .account-button

## Role switch — grants-only offers; switching changes the workspace nav

- ❌ **the creator account is signed in** — .account-button present
- 📝 FLOW ABORTED: the creator account is signed in — .account-button present

