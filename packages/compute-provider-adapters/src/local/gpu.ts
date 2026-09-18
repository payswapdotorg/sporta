/**
 * The LOCAL GPU probe (R405): the honest nvidia-smi availability detection
 * behind `provider.local`'s descriptor — a REAL subprocess probe (Bun.spawn,
 * the `@sporta/decoding` ffmpeg-detect precedent: bounded by a timeout kill,
 * stdout read through a pipe, nonzero exit or a spawn fault honestly means
 * "no local GPU detected" — never a fabricated GPU).
 *
 * The probe result is DATA the adapter's descriptor is DERIVED from:
 * available → `providerKind: "gpu-worker"` (with the detected GPU name as
 * evidence); absent → `providerKind: "cpu-worker"` and GPU-requiring
 * workloads get the typed `no-compatible-gpu` refusal at dispatch
 * (./adapter.ts) and at broker-quote time (the R401 descriptor check).
 */
/** The honest local-GPU probe result (never a fabricated GPU). */
export interface LocalGpuProbe {
  /** Whether a local GPU was detected (nvidia-smi available + exit 0). */
  available: boolean;
  /** The detected GPU name (first nvidia-smi line) when available. */
  name?: string;
  /** How the probe ran (the documented detection mechanism — DATA). */
  probe: "nvidia-smi";
}

/** The probe's explicit timeout (ms) — never an unbounded subprocess. */
const GPU_PROBE_TIMEOUT_MS = 2_000;

/**
 * Runs the REAL local GPU probe: `nvidia-smi --query-gpu=name
 * --format=csv,noheader`. A missing binary, a nonzero exit, or a timeout
 * honestly answers `{ available: false }` (the only honest GPU claims are
 * observed ones).
 */
export async function detectLocalGpu(): Promise<LocalGpuProbe> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    const proc = Bun.spawn(["nvidia-smi", "--query-gpu=name", "--format=csv,noheader"], {
      stdout: "pipe",
      stderr: "pipe",
      stdin: "ignore",
    });
    timeout = setTimeout(() => {
      proc.kill();
    }, GPU_PROBE_TIMEOUT_MS);
    timeout.unref?.();
    const [exitCode, stdout] = await Promise.all([proc.exited, new Response(proc.stdout).text()]);
    if (exitCode === 0) {
      const name = stdout.split("\n", 1)[0]?.trim() ?? "";
      return {
        available: true,
        ...(name.length > 0 ? { name } : {}),
        probe: "nvidia-smi",
      };
    }
    return { available: false, probe: "nvidia-smi" };
  } catch {
    // nvidia-smi not on PATH (or the spawn failed): no local GPU detected.
    return { available: false, probe: "nvidia-smi" };
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }
}

/**
 * Whether a job's declared resource hints require GPU-class compute: the
 * advisory `constraints.resourceHints.computeClass` mentioning a `gpu`
 * word segment (e.g. "gpu", "gpu-class", "nvidia-gpu"). Advisory hints
 * are the W303 posture — this is the documented honest reading the local
 * adapter applies when it has no GPU.
 */
export function jobRequiresGpu(computeClass: string | undefined): boolean {
  if (computeClass === undefined) return false;
  return /\bgpu\b/i.test(computeClass);
}
