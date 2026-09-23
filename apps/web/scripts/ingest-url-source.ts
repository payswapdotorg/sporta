/**
 * THE URL-SOURCE INGEST DRIVER (W6 Worker B) — the operator/machine CLI over
 * the acquisition seam's HTTP surface.
 *
 * WHY HTTP-ONLY: the transfer MUST land IN THE SERVER'S PROCESS. The Next
 * server tree runs route handlers at its own composed-server boundary; a
 * separate in-process composition here (its own stores) would silently
 * diverge from the server the UI polls — the exact cross-process state
 * drift the F2 posture documents. The capability-gated seam route
 * (POST /api/create/url-sources/[id]/transfer) is the ONE place the
 * transferred bytes become server state, so this driver drives THAT.
 *
 * Phases (the acquisition state machine's own acts):
 *   --phase show    the machine's pre-flight read (URL + state + integrity)
 *   --phase begin   mark ACQUIRING (BEFORE any byte moves — honest in-flight)
 *   --phase fail    record the honest failure (state FAILED + reason)
 *   --phase ingest  THE BINDING: bytesPath + via + claimed integrity → the
 *                   seam measures, re-derives rights, runs the studio's own
 *                   session creation; ACQUIRED only on success
 *
 * Owner-facing reads (a session cookie, not the machine capability):
 *   --list                 the caller's registrations
 *   --show-owner <id>      the owner's registration read
 *
 * Every refusal prints the server's typed answer verbatim and exits
 * non-zero — never a silent fallback.
 *
 * Run (from apps/web): bun run scripts/ingest-url-source.ts --phase show …
 */
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

const DEFAULT_SERVER = process.env.SPORTA_ACQUIRE_SERVER ?? "http://localhost:3000";

interface DriverFlags {
  server: string;
  registration: string | null;
  token: string | null;
  ownerToken: string | null;
  phase: "show" | "begin" | "fail" | "ingest";
  list: boolean;
  showOwner: string | null;
  bytesFile: string | null;
  viaKind: "cookies" | "url" | "file" | null;
  viaDetail: string | null;
  reason: string | null;
}

function parseFlags(argv: string[]): DriverFlags {
  const flags: DriverFlags = {
    server: DEFAULT_SERVER,
    registration: null,
    token: null,
    ownerToken: null,
    phase: "show",
    list: false,
    showOwner: null,
    bytesFile: null,
    viaKind: null,
    viaDetail: null,
    reason: null,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]!;
    const next = (): string => {
      const value = argv[index + 1];
      if (value === undefined) {
        throw new Error(`flag '${arg}' needs a value`);
      }
      index += 1;
      return value;
    };
    switch (arg) {
      case "--server":
        flags.server = next();
        break;
      case "--registration":
        flags.registration = next();
        break;
      case "--acquisition-token":
        flags.token = next();
        break;
      case "--owner-token":
        flags.ownerToken = next();
        break;
      case "--phase":
        flags.phase = next() as DriverFlags["phase"];
        break;
      case "--list":
        flags.list = true;
        break;
      case "--show-owner":
        flags.showOwner = next();
        break;
      case "--bytes-file":
        flags.bytesFile = next();
        break;
      case "--via-kind":
        flags.viaKind = next() as DriverFlags["viaKind"];
        break;
      case "--via-detail":
        flags.viaDetail = next();
        break;
      case "--reason":
        flags.reason = next();
        break;
      default:
        throw new Error(`unknown flag '${arg}'`);
    }
  }
  return flags;
}

/** The machine's call into the seam route (capability-gated). */
async function seamCall(
  flags: DriverFlags,
  body: Record<string, unknown>,
): Promise<{ status: number; body: Record<string, unknown> }> {
  if (flags.registration === null) {
    throw new Error("--registration <id> is required for the machine acts");
  }
  if (flags.token === null) {
    throw new Error("--acquisition-token <capability> is required for the machine acts");
  }
  const response = await fetch(
    `${flags.server}/api/create/url-sources/${encodeURIComponent(flags.registration)}/transfer`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json",
        "x-acquisition-token": flags.token,
      },
      body: JSON.stringify(body),
    },
  );
  const text = await response.text();
  const parsed = text.length > 0 ? (JSON.parse(text) as Record<string, unknown>) : {};
  return { status: response.status, body: parsed };
}

/** The owner's read (session cookie — the UI's own surface). */
async function ownerCall(
  flags: DriverFlags,
  path: string,
): Promise<{ status: number; body: Record<string, unknown> }> {
  if (flags.ownerToken === null) {
    throw new Error("--owner-token <cookie> is required for the owner reads");
  }
  const response = await fetch(`${flags.server}${path}`, {
    headers: { accept: "application/json", cookie: `sporta_session=${flags.ownerToken}` },
  });
  const text = await response.text();
  const parsed = text.length > 0 ? (JSON.parse(text) as Record<string, unknown>) : {};
  return { status: response.status, body: parsed };
}

async function main(): Promise<number> {
  const flags = parseFlags(process.argv.slice(2));

  // The owner-facing reads.
  if (flags.list) {
    const answer = await ownerCall(flags, "/api/create/url-sources");
    console.log(JSON.stringify(answer.body, null, 2));
    return answer.status === 200 ? 0 : 1;
  }
  if (flags.showOwner !== null) {
    const answer = await ownerCall(
      flags,
      `/api/create/url-sources/${encodeURIComponent(flags.showOwner)}`,
    );
    console.log(JSON.stringify(answer.body, null, 2));
    return answer.status === 200 ? 0 : 1;
  }

  // The machine acts (the capability-gated seam).
  if (flags.phase === "show") {
    const answer = await seamCall(flags, { phase: "show" });
    console.log(JSON.stringify(answer.body, null, 2));
    return answer.status === 200 ? 0 : 1;
  }
  if (flags.phase === "begin") {
    const answer = await seamCall(flags, {
      phase: "begin",
      ...(flags.viaKind !== null ? { kind: flags.viaKind } : { kind: "acquisition" }),
      ...(flags.viaDetail !== null ? { detail: flags.viaDetail } : {}),
    });
    console.log(JSON.stringify(answer.body, null, 2));
    return answer.status === 200 ? 0 : 1;
  }
  if (flags.phase === "fail") {
    const answer = await seamCall(flags, {
      phase: "fail",
      reason: flags.reason ?? "the acquisition failed (operator-recorded reason)",
    });
    console.log(JSON.stringify(answer.body, null, 2));
    return answer.status === 200 ? 0 : 1;
  }

  // phase === "ingest" — THE BINDING. The machine hands the bytes path +
  // the measured claim; the SEAM re-measures and cross-checks.
  if (flags.bytesFile === null) {
    console.error("the ingest phase requires --bytes-file <path>");
    return 2;
  }
  if (flags.viaKind === null) {
    console.error("the ingest phase requires --via-kind cookies|url|file");
    return 2;
  }
  const bytes = await readFile(flags.bytesFile);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const answer = await seamCall(flags, {
    phase: "ingest",
    bytesPath: flags.bytesFile,
    via: {
      kind: flags.viaKind,
      detail: flags.viaDetail ?? "",
    },
    claimed: { byteSize: bytes.byteLength, sha256 },
  });
  console.log(JSON.stringify(answer.body, null, 2));
  return answer.status === 200 ? 0 : 1;
}

main().then(
  (code) => {
    process.exit(code);
  },
  (err) => {
    console.error(
      JSON.stringify(
        {
          error: {
            failureClass: "driver-error",
            message: err instanceof Error ? err.message : String(err),
          },
        },
        null,
        2,
      ),
    );
    process.exit(2);
  },
);
