# Streaming Contract

## Media session lifecycle

`CREATED -> AUTHORIZED -> INGESTING -> NORMALIZING -> PROCESSING -> RENDERING -> DELIVERING -> COMPLETED`

Terminal failures are explicit and classified. Cancellation is idempotent.

## Stage contract

Each stage receives:

- session ID;
- sequence number / watermark;
- timestamped payload;
- schema version;
- correlation/trace IDs;
- resource budget hints.

Each stage emits:

- success/failure status;
- output payload or reference;
- updated watermark;
- processing latency;
- resource telemetry;
- retryability classification.

## Backpressure

Queues are bounded. When downstream processing falls behind, the system must have an explicit policy: wait, drop only non-essential intermediate frames, reduce quality, reduce processing frequency, or switch to delayed/batch mode. Silent unbounded buffering is prohibited.

## Live latency

The platform must measure stage latency and end-to-end glass-to-glass latency using a controlled timestamping fixture. Targets are set after baseline measurements.

## Delivery

Interactive clients use WebRTC or another measured low-latency transport. Compatibility delivery may use HLS/DASH. Delivery format must not change the canonical SWM or renderer API.

## Recovery

Processing stages support retries where deterministic/idempotent. Stateful stages checkpoint enough information to resume from a safe watermark. Duplicate messages are tolerated through idempotency keys.
