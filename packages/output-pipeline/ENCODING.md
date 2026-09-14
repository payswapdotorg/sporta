# ENCODING.md — the W504 anime segment encoding format

`@sporta/output-pipeline` `encodeAnimeClip` turns one W502 `AnimeRenderOutput`
(the anime renderer's SVG frame sequence + per-frame render manifest) into
**one self-contained animated SVG document** plus a deterministic **container
manifest** (JSON). The stored/played-back unit — the "encoded segment" — is
the pair of them; the SVG document alone is the playable artifact.

## Honest scope

This is an **SVG-timeline segment, not raster video**. Raster codecs (H.264,
VP9, AV1, WebM/MP4 containers) and audio are **out of scope** for W504: the
W502 anime prototype emits deterministic SVG frames, and the pipeline encodes
exactly what the renderer produced — no transcoding, no frame interpolation,
no invented timing. Playback is native browser rendering of SVG + SMIL
(Chrome, Firefox, and Safari all support SMIL in SVG documents). There is
**no JavaScript inside the SVG** and no external references (no `<image>`
hrefs, no fonts fetched, no `<script>`), so the document is self-contained
and safe to render from a Blob URL or an `<img>` element.

## The document structure

For a W502 output with frames `f0..fN` and profile resolution `W×H`:

```xml
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 W H" width="W" height="H">
  <title>anime.prototype@0.1.0 animated clip</title>
  <desc>segmentId=anime-clip-1a2b3c4d frameCount=6 totalDurationMs=6000</desc>
  <g data-frame-index="0" display="none">
    <set attributeName="display" to="inline" begin="0s" dur="1s" fill="remove"/>
    <!-- frame 0's inner content (everything between the W502 root tag and </svg>) -->
  </g>
  <!-- …one group per frame, in W502 frame order… -->
  <g data-frame-index="N" display="none">
    <set attributeName="display" to="inline" begin="…s" dur="…s" fill="freeze"/>
    <!-- frame N's inner content -->
  </g>
</svg>
```

Rules, all byte-pinned by tests:

- element order is fixed: root → `title` → `desc` → one group per frame in
  W502 frame order → close;
- every frame group starts `display="none"`; its single `<set>` makes it
  visible for exactly `[begin, begin + dur)` on the document timeline
  (`fill="remove"` restores the hidden base value when the window ends);
- the **last** frame freezes (`fill="freeze"`): the clip ends showing its
  final frame — a presentation choice, documented here, not a data claim;
- the frame's own `<title>` (`anime.prototype frame N`) is kept inside its
  group — per-frame provenance travels with the document;
- text is XML-escaped exactly like W502 (five predefined entities).

## The timing model (never invented)

Per frame `i`, with the W502 manifest's output window
`windowMs = { startMs, endMs }` and `t0` the first frame's output timestamp:

| SMIL attribute | Value | Source |
| --- | --- | --- |
| `begin` | `(outputTimestampMs_i − t0) / 1000` seconds | W502 `frames[i].outputTimestampMs` |
| `dur` | `(windowMs.endMs − windowMs.startMs) / 1000` seconds | W502 `frames[i].windowMs` |

The container manifest records the same numbers in milliseconds
(`frames[i].beginMs` / `frames[i].durMs`), so the SVG timeline and the
manifest agree exactly. Clock values are serialized at microsecond precision
(`toFixed(6)`, trailing zeros trimmed); W502 emits integer-millisecond
windows, so serialization is exact there.

Encoding requires the W502 output windows to be **contiguous**, **strictly
positive**, first-anchored at `manifest.output.startMs`, and last-anchored
at `startMs + durationMs`, and every frame document to be a complete
`<svg …>…</svg>` root whose open tag declares the profile `viewBox` and
whose inner content carries no embedded `</svg>` — exactly the shape both
W502 render paths produce. Anything else fails loud with
`SegmentEncodingError` (`media-invalid`); the encoder never guesses,
re-times, or clips. HONEST LIMITATION: the frame-document checks are
pragmatic structural checks, not a full XML parse (a root-tag attribute
value containing `>` could still confuse the splice boundary — the W502
serializer never emits one).

## Identity and integrity

- **`segmentId`** = `anime-clip-` + 8 lowercase hex digits of the FNV-1a 32
  hash of the render **identity string** — the W502 manifest's renderer
  identity (`rendererId`, `rendererVersion`, `styleId`,
  `configSchemaVersion`), session scope (`sessionId`, `snapshotVersion`,
  `eventsSinceSequence`), output window (`startMs`, `durationMs`), and frame
  count, `|`-joined in that fixed order. Deliberately **not** a function of
  the frame content: re-encoding the same logical render with different
  content keeps the segment id, so the render store fails loud with a
  `SegmentConflictError` instead of silently growing a second copy. The
  32-bit identity hash and the `|`-joined fields are not a collision-proof
  encoding; the consequence of an alias is only ever that fail-loud store
  conflict (the store decides duplicate-vs-conflict by **full content
  comparison**, never by the id alone) — never a silent merge.
- **`contentHash`** = sha-256 of the **full encoded SVG document text**
  (UTF-8 bytes), computed with Bun's built-in `CryptoHasher` (zero
  dependencies — the W101 ingestion-checksum precedent), serialized as 64
  lowercase hex digits. This hash doubles as the CONTENT-ADDRESSED artifact
  id: the same bytes are the same id everywhere, so the artifact store is
  idempotent by construction.
- **`byteLength`** = the measured UTF-8 byte length of the document.

The store compares the **full content** when deciding duplicate-vs-conflict,
so even a hypothetical sha-256 collision can never silently merge two
different segments — it fails loud. Reads re-verify the hash and byte length
against the stored content and fail loud (`SegmentIntegrityError`) on drift —
corrupted data is never served.

## The container manifest

Deterministic JSON, deep-equal across re-encodes of the same input:

```jsonc
{
  "format": { "kind": "animated-svg", "version": 1 },
  "segmentId": "anime-clip-2c334347",
  "sessionId": "sess-1",
  "frameCount": 6,
  "totalDurationMs": 6000,
  "contentHash": "f866c3a89f630112f4f1460aac94ddd57efe7ebe62e129259b7935ce6081f6a8",
  "frames": [
    { "frameIndex": 0, "outputTimestampMs": 1000, "beginMs": 0, "durMs": 1000 }
    // … one entry per frame, W502 order …
  ],
  "sourceManifest": {
    // The COMPLETE W502 AnimeClipManifest, VERBATIM: renderer identity,
    // session/provenance, output profile + window, per-frame output windows,
    // source watermarks, appliedEventSequences, captions, possession, every
    // snapshot entity id with its explicit disposition, skippedEvents, and
    // the degradation state. The output pipeline never rewrites, summarizes,
    // or augments it — this is the W503 temporal-consistency measurement
    // source and the honest provenance record.
  }
}
```

## Determinism

`encodeAnimeClip` is a pure function: no clocks, no RNG, no I/O. The same
`AnimeRenderOutput` yields a byte-identical document and a deep-equal
manifest on every call (pinned by tests, including a full-chain e2e rerun).
The store is likewise deterministic given an injected clock (its default is
the repo's `TEST_EPOCH_MS + ticks` counter; production callers inject a real
wall clock).

## Playback

The W701 control API exposes stored segments through its playback routes
(rights-gated, fail-closed — `canStoreDerivatives` required):

- `GET /v1/sessions/:id/renders/:renderId/outputs` — segment summaries;
- `GET /v1/sessions/:id/renders/:renderId/outputs/:segmentId` — the segment
  document: `contentType` (`image/svg+xml`), the SVG text, the byte length,
  the content hash, and the container manifest verbatim.

A viewer renders the segment by creating a Blob from the returned `content`
with type `image/svg+xml` (Blob URL into an `<img>`, or inline DOM
insertion); the SMIL timeline then plays the clip autonomously.

## `anime://` ref resolution (`locateAnimeRef`)

A W502 ref `anime://<sessionId>/<snapshotVersion>/<frameIndex>` resolves to
the playback coordinates above through the pipeline: the artifact layer's
metadata (`sessionId`, `snapshotVersion`, `frameCount`) answers "does this
ref's content exist" (the ref's `frameIndex` must be below `frameCount`),
and the segment store answers "which scope serves it" (a candidate scope is
a location iff its `getSegment` returns content whose hash equals the
artifact id). Scope semantics:

- the content-addressed layer indexes ONE scope per content hash (first
  write wins — that is what content addressing means), so an un-narrowed
  lookup resolves to the indexed scope;
- with `renderId` narrowing, the narrowed scope is PROBED directly, so the
  same logical render stored under several render ids resolves under each
  of them (a scope serving DIFFERENT bytes under the same segment id fails
  the probe's hash check and is never located);
- honest limitation: scopes serving the identical bytes under a DIFFERENT
  segment id are not discoverable — the artifact layer has no reverse
  content index (such scopes are still playable through their own playback
  route; only ref resolution cannot enumerate them).

The rights gate runs BEFORE any of this: `locateAnimeRef` re-derives the
caller-supplied policy's capabilities fail-closed (including a finite-clock
guard — a non-finite `nowMs` denies, because every expiry comparison would
be vacuously false) and a malformed ref throws typed.

## Limitations

- SVG-timeline, not raster video; no audio; no adaptive streaming (W305 is
  the live-delivery path).
- 1 fps by construction (the W502 output profile); SMIL windows make the
  timing exact regardless of frame rate, but there is no sub-frame motion.
- The last frame freezes; the document does not loop.
- `display`-based SMIL show/hide requires SMIL support (all current major
  browsers; not headless-imaging tools without SMIL).
- The single-snapshot W502 path holds entity positions between watermarks
  (a W502 property, inherited verbatim — see the W502 status record).
- `segmentId` uses a 32-bit FNV-1a identity hash (W502 parity) over
  `|`-joined fields — not collision-proof; collision safety comes from
  full-content comparison in the store, not from the hash width. The
  content hash itself is full sha-256 (64 hex digits).
