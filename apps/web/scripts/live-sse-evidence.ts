/**
 * W915 LIVE SSE EVIDENCE COLLECTOR — the honest measurement harness for the
 * local real-HTTP live transport evidence.
 *
 * `curl -N` (the real HTTP client) streams the SSE endpoint; THIS script is
 * the consumer: it timestamps every chunk's arrival on its real clock, parses
 * the stream with the SAME grammar the server encodes and the browser's
 * EventSource consumes (`@/lib/live-sse`), and measures the end-to-end latency
 * per frame with the REAL `LiveLatencyWindow` (server generation timestamp →
 * receipt timestamp; the clocks are unsynchronized — the number includes
 * their skew, and is never smoothed or invented).
 *
 * Usage:
 *   curl -Ns -H "cookie: sporta_session=<token>" \
 *     http://localhost:<port>/api/live/<sessionId> | \
 *   bun run apps/web/scripts/live-sse-evidence.ts
 *
 * Prints one line per event, then the honest summary: frames, cadence gaps
 * (client-observed inter-frame arrivals), and latency p50/p95/max.
 */
import { createSseParser } from "../src/lib/live-sse";
import type { LiveCloseDoc, LiveFrameDoc, LiveHelloDoc } from "../src/lib/live-sse";
import { LiveLatencyWindow } from "../src/lib/live-latency";

const parser = createSseParser();
const latency = new LiveLatencyWindow();
const arrivalGaps: number[] = [];
let lastFrameArrival: number | null = null;
let frames = 0;
let hello: LiveHelloDoc | null = null;
let close: LiveCloseDoc | null = null;
let totalBytes = 0;

const decoder = new TextDecoder();

process.stdin.on("data", (chunk: Buffer) => {
  const receivedAtMs = Date.now(); // THIS process's real clock at byte receipt
  const text = decoder.decode(chunk, { stream: true });
  totalBytes += chunk.byteLength;
  for (const event of parser.write(text)) {
    if (event.event === "hello") {
      hello = JSON.parse(event.data) as LiveHelloDoc;
      console.log(
        `[hello] session=${hello.sessionId} story=${hello.storyKey} cadenceMs=${hello.cadenceMs} bufferDepth=${hello.bufferDepth} openedAtMs=${hello.openedAtMs}`,
      );
    } else if (event.event === "frame") {
      const frame = JSON.parse(event.data) as LiveFrameDoc;
      frames += 1;
      const gap = lastFrameArrival === null ? null : receivedAtMs - lastFrameArrival;
      if (gap !== null) arrivalGaps.push(gap);
      lastFrameArrival = receivedAtMs;
      latency.add(receivedAtMs - frame.generatedAtMs); // measured end-to-end
      console.log(
        `[frame] ordinal=${frame.ordinal} storyStep=${frame.storyStepIndex} svgBytes=${frame.byteLength} renderMs=${frame.renderDurationMs} latencyMs=${receivedAtMs - frame.generatedAtMs}${gap === null ? "" : ` gapMs=${gap}`}`,
      );
    } else if (event.event === "close") {
      close = JSON.parse(event.data) as LiveCloseDoc;
      console.log(
        `[close] reason=${close.reason} deliveredFrames=${close.deliveredFrames} droppedFrames=${close.droppedFrames}`,
      );
    }
  }
});

process.stdin.on("end", () => {
  for (const event of parser.end()) {
    if (event.event === "close") {
      close = JSON.parse(event.data) as LiveCloseDoc;
      console.log(
        `[close] reason=${close.reason} deliveredFrames=${close.deliveredFrames} droppedFrames=${close.droppedFrames}`,
      );
    }
  }
  const snapshot = latency.snapshot();
  const sortedGaps = [...arrivalGaps].sort((a, b) => a - b);
  const gapAt = (p: number): number | null =>
    sortedGaps.length === 0
      ? null
      : sortedGaps[Math.min(sortedGaps.length - 1, Math.ceil(p * sortedGaps.length) - 1)]!;
  console.log("---");
  console.log(
    `SUMMARY frames=${frames} bytes=${totalBytes}${close !== null ? ` closeReason=${close.reason}` : ""}`,
  );
  console.log(
    `CADENCE client-observed gaps n=${sortedGaps.length} p50=${gapAt(0.5)}ms p95=${gapAt(0.95)}ms max=${sortedGaps[sortedGaps.length - 1] ?? "—"}ms (server cadence ${hello?.cadenceMs ?? "?"}ms)`,
  );
  console.log(
    snapshot === null
      ? "LATENCY none (no frame arrived)"
      : `LATENCY measured end-to-end n=${snapshot.count} last=${snapshot.lastMs}ms p50=${snapshot.p50Ms}ms p95=${snapshot.p95Ms}ms max=${snapshot.maxMs}ms (server generation clock → client receipt clock, unsynchronized; real measurement, never a promise)`,
  );
});
