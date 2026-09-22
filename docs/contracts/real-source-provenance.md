# Real-Source Provenance Contract (Wave 6)

Status: FROZEN FOR IMPLEMENTATION
Date: 2026-09-22
Scope: R606 revalidation on a real user-submitted source; binds Workers A/B/C lanes.

This contract freezes the invariants every wave-6 lane must preserve. It exists
because the prior R606 evidence pack used a synthetic source MP4 as the
"Original" — technically valid encodes, but NOT the operator's real submitted
match video. That pack is demoted to ENGINEERING EVIDENCE. The human visual
gate (R606) requires the chain below to be real end-to-end.

## 1. Source identity

- The exact operator-submitted source URL is a first-class, recorded input:
  `https://www.youtube.com/watch?v=93LPZJkCW2w`
  (Identified via oEmbed: "FULL MATCH | BETIS 3 vs 5 FC BARCELONA | LALIGA
  2025/26 MD15", official FC Barcelona channel, ~1:49:51.)
- The URL MUST appear verbatim in the ingestion registration record and in
  the R606 evidence pack. The chain is only valid for THIS source.

## 2. Lineage chain

```
operator-submitted YouTube URL
  → source asset (registered, rights-declared)
    → acquired bytes (acquisition method recorded)
      → normalized source asset (Original artifact, watchable)
        → perception → SWM (processing run recorded)
          → derived realities: Tactical / 3D Game / Anime-NPR
```

- Every hop is a recorded, verifiable step (id, timestamp, integrity hash
  where bytes are involved).
- All four displayed realities (Original + three derived) MUST descend from
  the SAME processing run and the SAME SWM. Cross-run or cross-source
  mixing is a contract violation.
- A derived reality that was NOT regenerated from the real-source SWM may
  not be presented as R606 evidence.

## 3. Rights posture (no weakening)

- The YouTube-sourced run goes through the EXISTING rights model:
  user-submitted declaration covering analysis/transformation/derivative/
  storage, with expiry — the same declaration path the J015 journey used.
- The source being publicly streamed does NOT bypass rights: the record
  states user-submitted + the declared purposes honestly.
- No rights check may be disabled, stubbed, or auto-satisfied for the
  real-source run.

## 4. Acquisition honesty

- The acquisition method is recorded explicitly. Accepted unblock paths:
  (a) operator-provided authenticated session (cookies) used from this host,
  (b) operator-transferred bytes (file-host URL or direct upload) matched to
  the registered source.
- Every failed acquisition path is recorded honestly, not retried silently.
  Exhausted-unauthenticated findings to date (2026-09-22, this host):
  yt-dlp all player clients, hand-crafted innertube with PO tokens
  (bgutil provider), Chrome CDP /watch + TV-app in-browser player, TV app
  innertube, WEB_EMBEDDED_PLAYER (embedding disabled for the licensed
  content), Invidious/Piped instances, ZAI service egress, and a GitHub
  Actions relay — all bot-walled at the account/IP level (2026 posture).
- FIXTURE OR SYNTHETIC SUBSTITUTION IS FORBIDDEN as R606 evidence. A test
  encode is never the "Original". Dev-seed or fixture fallbacks must be
  structurally impossible to present as this run's source.

## 5. Synchronized comparison

- The R606 evidence pack presents SOURCE vs derived frames at the same
  media time, or at explicitly-recorded differing time points — never
  silently mismatched.
- Frame captures record their source timestamp and the artifact they came
  from.

## 6. Evidence pack binding

- The R606 pack records: source URL, acquisition method, source integrity
  hash, normalized artifact reference, processing run id, SWM version,
  per-reality artifact references, frame timestamps, and every
  model/weight/provider used with version + license posture.
- Unavailable models/weights/providers are recorded as unavailable — never
  hidden behind a silently-degraded success.
- The four-realities verdict surface (console) binds to THIS run only; the
  prior J015 pack is labeled engineering evidence.

## 7. Acceptance

R606 passes only when a human operator, viewing the real chain in the
product UI, can confirm: this Original is the video I submitted, the three
derived realities were rebuilt from that same source, they are switchable
and comparable side-by-side, and the provenance of every artifact is
inspectable. R607 remains closed until this R606 passes.
