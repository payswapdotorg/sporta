/**
 * Shared test helpers for the durable-jobs tests (REL-012): the resumable
 * five-step executor (the restart test's workhorse), checkpoint signals,
 * temp scratch directories (cleaned by exact name) and the wall-clock
 * stripper for the restart deep-equality.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { JobExecutor } from "../src/runtime";

export const FIVE_STEPS = ["s1", "s2", "s3", "s4", "s5"] as const;

export interface FiveStepOptions {
  /** Notified after each PERSISTED checkpoint (the test handshakes on these). */
  onCheckpoint?: (step: string) => void;
  /** The step whose WORK blocks on the gate (the simulated worker crash point). */
  blockBeforeStep?: string;
  /** Released by the test to let the blocked (abandoned) worker continue. */
  gate?: Promise<void>;
}

/**
 * The five-step executor: one checkpoint per step, RESUMABLE from the last
 * checkpoint (completed steps are skipped on resume). Deterministic output
 * artifact refs so the deep-equality comparisons bite on real content.
 * Declares its code version (the REL-029 lineage leg).
 */
export function fiveStepExecutor(options: FiveStepOptions = {}): JobExecutor {
  return {
    kind: "five-step",
    codeVersion: "five-step/v1",
    async execute(ctx) {
      const last = ctx.job.checkpoints[ctx.job.checkpoints.length - 1];
      const completed = new Set<string>(
        (last?.state as { completedSteps?: string[] } | undefined)?.completedSteps ?? [],
      );
      for (const step of FIVE_STEPS) {
        if (completed.has(step)) continue;
        if (options.blockBeforeStep === step && options.gate !== undefined) {
          await options.gate; // the crash point: the worker never returns here
        }
        completed.add(step);
        await ctx.checkpoint({ completedSteps: [...completed] });
        options.onCheckpoint?.(step);
      }
      return ["artifact://five-step/result"];
    },
  };
}

/** A test gate: resolves when `count` checkpoints have been persisted. */
export function checkpointSignal(count: number): {
  promise: Promise<void>;
  notify: () => void;
} {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  let seen = 0;
  return {
    promise,
    notify: () => {
      seen += 1;
      if (seen >= count) resolve();
    },
  };
}

/** A never-resolving-until-released gate (the abandoned worker's blocker). */
export function releaseGate(): { gate: Promise<void>; release: () => void } {
  let release!: () => void;
  const gate = new Promise<void>((done) => {
    release = done;
  });
  return { gate, release };
}

/**
 * Strips the wall-clock fields (and the checkpoint timestamps) so the
 * interrupted and uninterrupted final records can be compared for
 * deep-equality: everything that MEANS something (state, checkpoints,
 * attempts, artifacts, retry policy, flags) must be identical.
 */
export function stripWallClock(record: unknown): unknown {
  return JSON.parse(
    JSON.stringify(record, (key, value) => {
      if (
        [
          "createdAt",
          "updatedAt",
          "completedAt",
          "acquiredAt",
          "expiresAt",
          "at",
          "retryAt",
        ].includes(key)
      ) {
        return undefined;
      }
      return value;
    }),
    (_key, value) => value,
  );
}

/** Creates an exact-name scratch directory in the OS tmpdir (cleaned after all). */
export function scratchDir(name: string): string {
  return mkdtempSync(join(tmpdir(), `sporta-durable-jobs-${name}-`));
}

/** Removes a scratch directory by exact name (force for idempotence). */
export function removeScratchDir(path: string): void {
  rmSync(path, { recursive: true, force: true });
}
