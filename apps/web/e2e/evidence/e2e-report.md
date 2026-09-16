# W909 browser E2E — run mu3qy7dx

Target: http://127.0.0.1:3909 (production build, port 3909)

**4 passed / 4 failed** — 33 assertions passed, 4 failed.

| Flow | Outcome | Assertions | Evidence |
| --- | --- | --- | --- |
| Accessibility smoke — skip link, landmarks, alt text, contrast, keyboard | ✅ passed | 10/10 | a11y-smoke-failure.png |
| Sign-in — register → login → nav shows the account → sign out | ✅ passed | 2/2 | sign-in-failure.png |
| Rights denial — viewer/anonymous on a denied route → real 403 state, no bytes | ❌ failed | 0/1 | rights-denial-failure.png |
| Watch — the real output renders (SVG frames) + timeline/event markers | ❌ failed | 9/10 | watch-failure.png |
| Reality Switcher — real availabilities, switch without page reload | ✅ passed | 6/6 | reality-switch-failure.png |
| Output playback — the real output document loads and its frames render | ❌ failed | 5/6 | output-playback-failure.png |
| Render — guided flow → dispatch → progress → succeeded → output exists | ✅ passed | 1/1 | render-failure.png |
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
- 📝 FLOW ABORTED: agent-browser eval (function () {
  function effectiveBg(el) {
    let node = el;
    while (node && node !== document.documentElement) {
      const bg = getComputedStyle(node).backgroundColor;
    const m = bg.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/);
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
})() failed: ✗ Evaluation error: TypeError: document.querySelectorAll.slice is not a function or its return value is not iterable
    at <anonymous>:16:53
    at <anonymous>:24:3


## Sign-in — register → login → nav shows the account → sign out

- ✅ **auth surface renders** — selector #auth-username
- ✅ **auth surface starts in sign-in mode** — data-auth-mode=signin
- 📝 FLOW ABORTED: agent-browser find text "Create an account" click failed: ✗ No element found by text '"Create an account"'. Verify the selector, role, or name is correct and the element exists in the DOM.


## Rights denial — viewer/anonymous on a denied route → real 403 state, no bytes

- ❌ **the viewer account is signed in for the denial checks** — .account-button count=0
- 📝 FLOW ABORTED: the viewer account is signed in for the denial checks — .account-button count=0

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
- ❌ **the provenance panel renders real render metadata** — panel text starts="Provenance — the real artifact
RENDERER
anime.prototype@0.1."
- 📝 FLOW ABORTED: the provenance panel renders real render metadata — panel text starts="Provenance — the real artifact
RENDERER
anime.prototype@0.1."

## Reality Switcher — real availabilities, switch without page reload

- ✅ **the watch page is still open on the seeded session** — url=http://127.0.0.1:3909/watch?session=sess-1
- ✅ **the switcher lists renderer options** — 2 options
- ✅ **a stored-output renderer (anime.prototype) is offered ready** — state=ready disabled=false
- ✅ **non-ready options carry an honest reason (never a fake 'coming soon')** — 1 non-ready options, all disabled with reasons
- ✅ **the current player surface names its renderer** — data-renderer=anime.prototype
- ✅ **a switch target with a stored output exists** — target=anime.prototype
- 📝 switcher options: anime.prototype=ready, sporta.testcard=no-stored-output (disabled)
- 📝 FLOW ABORTED: agent-browser find text "anime.prototype" click failed: ✗ No element found by text '"anime.prototype"'. Verify the selector, role, or name is correct and the element exists in the DOM.


## Output playback — the real output document loads and its frames render

- ✅ **the watch page is open for the playback checks** — selector .player-surface
- ✅ **the real output document loads (200 JSON segment document)** — status=200 content-type=application/json
- ✅ **the output document carries its artifact-source header** — x-sporta-artifact-source=in-memory
- ✅ **the output document's manifest counts real frames** — manifest.frameCount=6
- ✅ **event markers offer frame jumps** — marker-jump count=3
- ❌ **an event-marker jump moves the playhead (snaps to a real frame)** — seek: "0:00, frame 1 of 6" → "0:00, frame 1 of 6"
- 📝 output document /api/watch/sess-1/renders/r-2/outputs/anime-clip-c0f83b01 → 200 application/json (source=in-memory, frames=6)
- 📝 FLOW ABORTED: an event-marker jump moves the playhead (snaps to a real frame) — seek: "0:00, frame 1 of 6" → "0:00, frame 1 of 6"

## Render — guided flow → dispatch → progress → succeeded → output exists

- ✅ **auth surface renders for the creator registration** — selector #auth-username
- 📝 FLOW ABORTED: agent-browser find text "Create an account" click failed: ✗ No element found by text '"Create an account"'. Verify the selector, role, or name is correct and the element exists in the DOM.


## Role switch — grants-only offers; switching changes the workspace nav

- ❌ **the creator account is signed in** — .account-button present
- 📝 FLOW ABORTED: the creator account is signed in — .account-button present

