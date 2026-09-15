/**
 * The W306 live store + source driver: the growing `SwmUpdateStore` the REAL
 * W304 orchestrator consumes, plus the async loop that advances the injected
 * clock across the fixture's authored arrival schedule.
 *
 * ## Why visibility is CLOCK-DERIVED (the W304 fixture semantics, adapted)
 *
 * An update is visible iff the injected clock has reached its authored
 * `visibleAtMs` (revealed lazily on read, exactly like the W304 growth
 * fixtures). This sidesteps the waiter/append ordering hazard of an
 * actively-appending source on a virtual clock: `VirtualGpuClock` fires
 * crossed `waitUntil` waiters BEFORE the sleeper's continuation resumes, so a
 * consumer woken at the arrival instant would race the source's append and
 * see a store that announces a growth time the clock has already passed —
 * the W304 consumer's spin guard rejects exactly that. Clock-derived
 * visibility is deterministic, arrival-exact (virtual time moves only
 * through the authored `sleep`s), and honest: `visibleAtMs` IS the moment
 * the update entered the store in the injected clock domain.
 *
 * The store INSTRUMENTS the consumption seam: it records, per sequence, the
 * injected-clock reading of the FIRST `updatesAfter` slice that returned it
 * (`firstQueriedAtMs` — the batch-cut boundary; the consumer cuts in the
 * same synchronous segment as the query, and virtual time cannot pass
 * between synchronous statements), plus the query/materialization counters
 * (the incremental-consumption evidence, the W304 fixture pattern).
 */
import type { Watermark } from "@sporta/contracts";
import type { GpuClock } from "@sporta/gpu-worker";
import type { SwmUpdate, SwmUpdateStore } from "@sporta/render-orchestration";
import { LatencyFixtureError } from "./errors";
import type { LiveFixture } from "./fixture";

/** The instrumented growing store over the authored live-source schedule. */
export class LiveSwmStore implements SwmUpdateStore {
  private readonly fixture: LiveFixture;
  private readonly clock: GpuClock;
  private revealed = 0;
  private readonly firstQueryAtMs = new Map<number, number>();
  queryCount = 0;
  materializedEntries = 0;

  constructor(fixture: LiveFixture, clock: GpuClock) {
    if (fixture.steps.length < 1) {
      throw new LatencyFixtureError("the live fixture must carry at least one step");
    }
    this.fixture = fixture;
    this.clock = clock;
  }

  /** Reveals every step whose authored visibility time the clock has reached. */
  private revealUpToNow(): void {
    const now = this.clock.now();
    while (this.revealed < this.fixture.steps.length) {
      const step = this.fixture.steps[this.revealed]!;
      if (step.visibleAtMs > now) break;
      this.revealed += 1;
    }
  }

  /** Number of steps currently revealed (test/report observability). */
  get revealedCount(): number {
    this.revealUpToNow();
    return this.revealed;
  }

  /** The injected-clock reading of the first query that returned `sequence`. */
  firstQueriedAtMs(sequence: number): number | undefined {
    return this.firstQueryAtMs.get(sequence);
  }

  availableWatermark(): Watermark {
    this.revealUpToNow();
    if (this.revealed === 0) return { watermarkMs: 0, sequence: 0 };
    return this.fixture.steps[this.revealed - 1]!.update.watermark;
  }

  isComplete(): boolean {
    this.revealUpToNow();
    return this.revealed >= this.fixture.steps.length;
  }

  updatesAfter(
    afterSequence: number,
    toMs: number,
    limit: number,
  ): { updates: SwmUpdate[]; more: boolean } {
    this.revealUpToNow();
    this.queryCount += 1;
    const now = this.clock.now();
    const updates: SwmUpdate[] = [];
    let more = false;
    for (let i = 0; i < this.revealed; i += 1) {
      const step = this.fixture.steps[i]!;
      const update = step.update;
      if (update.sequence > afterSequence && update.watermark.watermarkMs <= toMs) {
        if (updates.length >= limit) {
          more = true;
          break;
        }
        updates.push(update);
        this.materializedEntries += 1;
        if (!this.firstQueryAtMs.has(update.sequence)) {
          this.firstQueryAtMs.set(update.sequence, now);
        }
      }
    }
    return { updates, more };
  }

  hasUpdatesAfter(afterSequence: number): boolean {
    this.revealUpToNow();
    for (let i = 0; i < this.revealed; i += 1) {
      if (this.fixture.steps[i]!.update.sequence > afterSequence) return true;
    }
    return false;
  }

  nextGrowthAtMs(): number | undefined {
    this.revealUpToNow();
    if (this.revealed >= this.fixture.steps.length) return undefined;
    return this.fixture.steps[this.revealed]!.visibleAtMs;
  }
}

/**
 * Drives the live source's clock: walks the authored schedule and sleeps the
 * clock forward to each step's `visibleAtMs` in order. Every sleep is bounded
 * (one per step — the W303 runaway rule holds); render work advancing the
 * clock past a future arrival simply means the update is already visible when
 * the driver reaches it (the source model does not claim exclusivity over
 * clock advancement — it claims only that each update exists in the store no
 * later than its authored `visibleAtMs`).
 *
 * ## The interleaving model (documented, deterministic)
 *
 * A virtual clock has no true parallelism: concurrent work interleaves ONLY
 * at await points, and WHO runs between awaits is a property of the driver.
 * After each authored arrival the driver therefore yields a FIXED number of
 * microtask quanta ({@link SETTLE_QUANTA_PER_ARRIVAL}) so the pipeline's
 * queued continuations (claim → execute → report → emit) run BETWEEN clock
 * advances instead of being starved behind the source's next sleep — the
 * virtual-clock stand-in for the source and the renderer executing
 * concurrently on real infrastructure. The quanta count is echoed into the
 * report (`benchmark.driver.settleQuantaPerArrival`) so every number it
 * carries is interpretable against the exact interleaving that produced it.
 *
 * Resolves when the whole schedule has been crossed (the store is then
 * complete from the consumer's point of view).
 */
export const SETTLE_QUANTA_PER_ARRIVAL = 32;

async function yieldQuanta(quanta: number): Promise<void> {
  for (let i = 0; i < quanta; i += 1) {
    await Promise.resolve();
  }
}

export async function driveLiveSource(clock: GpuClock, fixture: LiveFixture): Promise<void> {
  for (const step of fixture.steps) {
    const now = clock.now();
    if (step.visibleAtMs > now) {
      await clock.sleep(step.visibleAtMs - now);
    }
    // A clock already past the authored time (render work advanced it):
    // nothing to sleep — visibility is clock-derived and already holds.
    await yieldQuanta(SETTLE_QUANTA_PER_ARRIVAL);
  }
}
