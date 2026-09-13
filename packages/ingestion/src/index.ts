/**
 * @sporta/ingestion — validation-level source ingestion (W101).
 *
 * The first boundary of the Sporta pipeline: authorized media in, receipts
 * out. Consumes the W002 contracts, the W004 session rights gate
 * (`assertAuthorized`, fail-closed), and the W007 observability seams.
 * Deliberately contains NO media decoder/demuxer — container detection is
 * magic-byte level only; decoding is W102. Module map:
 *
 * - `container`: pure magic-byte container sniffing (mp4/webm/mkv/mpegts/avi)
 *   that is safe on short and hostile buffers;
 * - `policy`: the `IngestionPolicy` resource bounds + frozen defaults
 *   (streaming container family, 2 GiB size cap);
 * - `errors`: typed ingestion errors carrying the contracts
 *   `terminalFailureClass` (`rights-denied` / `media-invalid` /
 *   `resource-limit`) plus structured `details`;
 * - `ingest`: `ingestSource` — rights gate first (fail closed), size bound,
 *   container allowlist, sha-256 receipt, checksum-keyed idempotency
 *   (`SourceRegistry`), one structured log line and metrics counters per
 *   decision path.
 */
export { sniffContainer } from "./container";
export type { Container, ContainerInfo } from "./container";
export { DEFAULT_INGESTION_POLICY } from "./policy";
export type { IngestionPolicy } from "./policy";
export {
  isIngestionError,
  ResourceLimitError,
  RightsDeniedError,
  UnsupportedMediaError,
} from "./errors";
export type { IngestionError, IngestionErrorDetails } from "./errors";
export { INGESTION_METRIC_NAMES, ingestSource, noopObservability, SourceRegistry } from "./ingest";
export type { IngestionObservability, IngestionReceipt, IngestionSourceInput } from "./ingest";
