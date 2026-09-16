# W909 browser E2E — run mu3v06ma

Target: http://127.0.0.1:3909 (production build, port 3909)

**1 passed / 0 failed** — 18 assertions passed, 0 failed.

| Flow | Outcome | Assertions | Evidence |
| --- | --- | --- | --- |
| Render — guided flow → dispatch → progress → succeeded → output exists | ✅ passed | 18/18 | render-succeeded.png |

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

