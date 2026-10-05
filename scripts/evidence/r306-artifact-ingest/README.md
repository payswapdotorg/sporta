# R306 artifact-ingest — the arc's flight 5 (the artifact-delivery/ingest seam)

The hosted golden path (flight 4, `scripts/evidence/r306-hosted-golden-path/`)
closed the producer class but typed-refused 3/4 derived realities at the
render-output INGEST boundary, verbatim:

```
encoding refused (artifact-invalid): no artifact "<sha>" is stored
```

The mechanism (traced, on the record): the hosted compute worker encodes and
registers the artifact in ITS OWN store, then hands the job envelope back with
the artifact INLINE (delivery mode "inline", the base64 document). On the
in-process plane the worker's store IS the app's store (one instance — the
read succeeds); on the hosted plane (`COMPUTE_PROVIDER=http`) they are two
runtimes — the app-side composed store is empty, its read misses, and THE
BYTES ALREADY DELIVERED INLINE were never landed. This flight closes that
seam.

## The closure (measured — see `artifact-ingest-seam.json`, driver `artifact-ingest-seam.ts`)

At the app-side ingest (`apps/web/src/server/derived-reality-media.ts`), when
the composed store read misses with the SPECIFIC `no artifact "…" is stored`
refusal AND the inline delivery is present, the delivery is LANDED:

1. decode the inline document + re-hash (must equal the claim) + the inline
   byte-length claim + the container-manifest validation + the frozen-manifest
   derivation + the session agreement + the verbatim-copy agreement — EVERY
   existing fail-closed check runs BEFORE any put;
2. reconstruct the `EncodedArtifact` from the validated segment and
   `registerEncodedArtifact(appStore, artifact)` — the store's own
   cross-verify (put + decode-back + re-hash);
3. re-read through the SAME verified `loadEncodedArtifact` seam, under the
   registration's RETURNED artifactId (the store's own content address of the
   canonical base64 re-encode — never a re-computed one).

Only that specific miss is registrable. An integrity failure from the store (a
hash disagreement, a contentType mismatch, a tampered pre-stored record) is
NEVER registrable — the laundering class, refused loud, the typed refusal
propagating verbatim. A miss with no decodable inline delivery re-throws the
SAME typed refusal verbatim. The in-process shape never lands a put (the
initial verified read succeeds — zero puts, byte-identical, pinned by test).

## The measured record

- **The pre-fix refusal reproduced VERBATIM** (the exact store read the
  pre-fix ingest made, on the empty app store, the artifact registered only in
  the worker's own store): the message, its sha-256, its kind
  (`artifact-invalid` / `media-invalid`).
- **The post-fix landing**: the real MP4's sha-256 (a REAL ffmpeg/libx264
  encode — `ftyp` verified), byteSize, manifestId, the app store's artifactId,
  the frozen manifest, the media platform's record, the storage seam's
  integrity-verified byte-identical served bytes, the put-counter arithmetic
  (1 dispatched / 1 stored / 0 duplicate), the verified re-read.
- **Base64-canonicality, MEASURED**: the worker's delivered text IS its own
  `base64Of` (canonical), so the registered artifactId IS the missed id; the
  wrapped variant (content + newline — decodes to the same bytes under a
  different text hash) lands under the registration's RETURNED canonical
  artifactId.
- **The in-process shape**: ZERO ingest puts, record-identical +
  byte-identical landing (non-degradation).
- **Re-delivery idempotency**: the same envelope twice → no second put (the
  store read now succeeds); the non-canonical delivery → the store's COUNTED
  duplicate, never a second put.
- **The refusals** (all loud, NOTHING put, no media record): integrity,
  manifest mismatch, session mismatch, the laundered tampered record
  (`verify-failed`, never registrable), the laundered content type, the
  no-delivery miss VERBATIM.

## The gates for this record

- The driver's own battery spawn: **6 pass / 0 fail / 90 expect() calls / exit 0**.
- The fail-closed validator: **22/22 checks PASS**; **7/7 tampered variants
  REFUSED** (laundered sha, fabricated battery, laundered put-count, laundered
  refusal text, laundered refusal flag, fabricated landing, laundered verdict).

## The honest next flight (named, not flown here)

THE HOSTED RE-FLIGHT: a fresh E2B sandbox + redeploy + the golden-path walk
re-run — the 4/4 closure measure. The baked sandbox `i5lvv9q3…` is DEAD (502
measured, the r306-deploy ephemerality doctrine); the deployment is
SSO-walled; the persistent-worker-host operator decision stands. This flight
was LOCAL-ONLY by order.
