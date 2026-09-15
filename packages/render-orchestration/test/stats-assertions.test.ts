/**
 * The accounting-assertion teeth (W304): every identity broken one at a
 * time throws `RangeError` naming the identity — the never-silent proof the
 * settle path relies on (the W302/W303 stats-assertion posture).
 */
import { describe, expect, test } from "bun:test";
import { assertRenderAccounting, emptyStats, RENDER_METRIC_NAMES } from "../src/types";
import type { RenderOrchestrationStats } from "../src/types";

describe("assertRenderAccounting", () => {
  test("a fresh all-zero snapshot is balanced", () => {
    expect(() => assertRenderAccounting(emptyStats())).not.toThrow();
  });

  test("a fully-balanced closing snapshot passes (the e2e shape)", () => {
    const stats: RenderOrchestrationStats = {
      ...emptyStats(),
      batchesIn: 12,
      batchesRendered: 9,
      batchesSkippedStale: 2,
      batchesDropped: 0,
      batchesCancelled: 0,
      batchesDuplicateSkips: 1,
      batchesInFlight: 0,
      batchesSkippedStaleAtAdmission: 2,
      batchesSkippedStaleInQueue: 0,
      batchesDuplicateSkipsAtConsume: 1,
      batchesDuplicateSubmits: 0,
      batchesSentToQueue: 9,
      batchesReceivedFromQueue: 9,
      queuedNow: 0,
      batchesCancelledInQueue: 0,
      batchesRenderCancelled: 0,
      renderJobsSubmitted: 9,
      renderJobsDuplicate: 0,
      renderJobsInFlight: 0,
      outputsEmitted: 9,
    };
    expect(() => assertRenderAccounting(stats)).not.toThrow();
  });

  // Every case keeps the EARLIER identities balanced so the breach lands on
  // its own check (the checks run in order 0..8).
  const breaks: Array<{
    label: string;
    mutate: (stats: RenderOrchestrationStats) => void;
    identity: string;
  }> = [
    {
      label: "identity 1: a cut batch never reached any boundary disposition",
      mutate: (s) => {
        s.batchesIn = 1;
      },
      identity: "batchesIn === duplicateSkipsAtConsume + staleAtAdmission + sentToQueue",
    },
    {
      label: "identity 2: a sent batch was never received, evicted, or held",
      mutate: (s) => {
        s.batchesIn = 2;
        s.batchesSentToQueue = 2;
        s.batchesReceivedFromQueue = 1;
      },
      identity: "batchesSentToQueue === receivedFromQueue + queueEvicted + queuedNow",
    },
    {
      label: "identity 3: a dequeued batch never reached the protocol",
      mutate: (s) => {
        s.batchesIn = 1;
        s.batchesSentToQueue = 1;
        s.batchesReceivedFromQueue = 1;
      },
      identity: "batchesReceivedFromQueue === jobsSubmitted + jobDuplicates",
    },
    {
      label: "identity 4: an admitted job never landed a disposition",
      mutate: (s) => {
        s.batchesIn = 1;
        s.batchesSentToQueue = 1;
        s.batchesReceivedFromQueue = 1;
        s.renderJobsSubmitted = 1;
      },
      identity: "renderJobsSubmitted === rendered + renderFailed + renderCancelled",
    },
    {
      label: "identity 5: the dropped bucket is a silent lump, not labeled reasons",
      mutate: (s) => {
        s.batchesIn = 1;
        s.batchesSentToQueue = 1;
        s.batchesReceivedFromQueue = 1;
        s.renderJobsSubmitted = 1;
        s.batchesRendered = 1;
        // One dropped batch with NO labeled reason at all (a pure lump).
        s.batchesDropped = 1;
      },
      identity: "batchesDropped === queueEvicted + queueRefused + abandoned",
    },
    {
      // The batch was counted at a boundary (staleAtAdmission — identity 1
      // stays balanced) but never landed in ANY terminal bucket: exactly the
      // "terminalBatchCore forgot the master-bucket increment" bug class.
      label: "master identity: a batch vanishes from every bucket",
      mutate: (s) => {
        s.batchesIn = 1;
        s.batchesSkippedStaleAtAdmission = 1;
      },
      identity: "master:",
    },
    {
      // Two batches skipped, one admission attribution, one batch accounted
      // through the queue as a dispatcher duplicate (identity 2): the phases
      // sum to 1 while `batchesSkippedStale` says 2 — one skip is attributed
      // to NO phase. Earlier identities (incl. the master) stay balanced.
      label: "sub-identity: stale skips do not add up to their phases",
      mutate: (s) => {
        s.batchesIn = 2;
        s.batchesSkippedStale = 2;
        s.batchesSkippedStaleAtAdmission = 1;
        s.batchesSentToQueue = 1;
        s.batchesReceivedFromQueue = 1;
        s.renderJobsDuplicate = 1;
      },
      identity: "batchesSkippedStale === staleAtAdmission + staleInQueue",
    },
    {
      // One duplicate-skip double-attributed (a consume skip AND a submit
      // duplicate): the sources sum to 2 while the total says 1.
      label: "sub-identity: duplicate skips do not add up to their sources",
      mutate: (s) => {
        s.batchesIn = 1;
        s.batchesDuplicateSkips = 1;
        s.batchesDuplicateSkipsAtConsume = 1;
        s.batchesDuplicateSubmits = 1;
      },
      identity: "batchesDuplicateSkips === duplicateSkipsAtConsume + duplicateSubmits",
    },
    {
      label: "sub-identity: a rendered batch without an emitted output",
      mutate: (s) => {
        s.batchesIn = 1;
        s.batchesSentToQueue = 1;
        s.batchesReceivedFromQueue = 1;
        s.renderJobsSubmitted = 1;
        s.batchesRendered = 1;
      },
      identity: "batchesRendered === outputsEmitted",
    },
  ];

  for (const { label, mutate, identity } of breaks) {
    test(`${label} fails LOUD with the identity's name`, () => {
      const stats = emptyStats();
      mutate(stats);
      try {
        assertRenderAccounting(stats);
        expect.unreachable(`expected breach '${label}' to throw`);
      } catch (err) {
        expect(err).toBeInstanceOf(RangeError);
        const message = (err as RangeError).message;
        expect(message).toContain(identity);
        // The full breakdown rides along (the operator's evidence).
        expect(message).toContain("batchesIn");
      }
    });
  }

  test("the metric vocabulary is package-prefixed (no unlabeled collisions)", () => {
    for (const name of Object.values(RENDER_METRIC_NAMES)) {
      expect(name.startsWith("render_")).toBe(true);
    }
  });
});
