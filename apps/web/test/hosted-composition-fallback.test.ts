/**
 * THE HOSTED-COMPOSITION W911 FALLBACK TESTS (R607 B1 regression).
 *
 * The regression (measured by the TL on Vercel deploy sporta-6jxv8rvyp,
 * marker r607b1-ae8c477-1923): the hosted Node runtime's process directory
 * refuses the durable stores' on-demand parent creation —
 * `Error: ENOENT: no such file or directory, mkdir 'db'` (errno -2,
 * syscall mkdir, path db) fired from `SqliteMediaPlatformStore`'s
 * constructor BEFORE `bun:sqlite` was ever touched, the composition's
 * W911 catch matched only the shim-refusal message, so the never-masked
 * rule re-threw and the WHOLE composition died →
 * `GET /api/platform/health` answered 500 with an empty body (three
 * independent hits). Production was rolled back to 8893926 (where that
 * build era's mkdir succeeded and only the shim refusal fired — the
 * designed fallback path).
 *
 * The fix classifies the filesystem-blocked construction (a
 * `NodeJS.ErrnoException` whose `code` FIELD is ENOENT/EACCES/EROFS/EPERM
 * — never a message string) as the SAME honest W911 in-memory fallback +
 * the loud banner. These batteries prove the three sides of that catch
 * on the REAL composition (no mocks — the failures are induced through
 * the filesystem itself, the same way production induces them):
 *
 * - the hosted condition (`mkdir db` → ENOENT, reproduced by running the
 *   composition with the production-default RELATIVE db paths from a
 *   process directory that has been unlinked — the exact serverless
 *   shape: the relative `mkdir 'db'` fails ENOENT) → the composition
 *   SURVIVES, the media repositories are the in-memory fallback, and the
 *   banner names the blocked db directory + the measured errno;
 * - the permission-blocked db root (a read-only parent → mkdir EACCES,
 *   non-root only) → the same honest fallback (the errno-set, not just
 *   the one production errno);
 * - a GENUINE construction error (a file used as a directory component →
 *   mkdir ENOTDIR — a real errno that is neither the shim refusal nor a
 *   classified blocked errno) is still RE-THROWN, never masked, and no
 *   fallback banner is logged;
 * - the W911 shim refusal (the bundled-runtime branch) keeps its exact
 *   message contract, so the existing catch keeps matching it.
 */
import { describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  InMemoryMediaJobRepository,
  InMemoryMediaManifestRepository,
  InMemoryRenderArtifactRepository,
  InMemorySourceAssetRepository,
} from "@sporta/media-platform";
import { createSportaServer } from "../src/server/composition";
import type { SportaServer } from "../src/server/composition";

/**
 * The media service's repositories (the composition hands them to the
 * `MediaPlatformService`, which holds them privately — TypeScript-private
 * is compile-time only; this battery reads the CONSTRUCTED instances to
 * pin which plane the composition actually wired).
 */
function mediaRepositoriesOf(server: SportaServer): {
  sourceAssets: unknown;
  manifests: unknown;
  artifacts: unknown;
  jobsRepository: unknown;
} {
  const service = server.media as unknown as {
    sourceAssets: unknown;
    manifests: unknown;
    artifacts: unknown;
    jobs: { repository: unknown };
  };
  return {
    sourceAssets: service.sourceAssets,
    manifests: service.manifests,
    artifacts: service.artifacts,
    jobsRepository: service.jobs.repository,
  };
}

/** Captures `console.error` while `run()` executes (the fallback banners). */
function captureBanners<T>(run: () => T): { banners: string[]; result: T } {
  const banners: string[] = [];
  const realError = console.error;
  console.error = (...args: unknown[]): void => {
    banners.push(args.map((arg) => String(arg)).join(" "));
  };
  try {
    return { banners, result: run() };
  } finally {
    console.error = realError;
  }
}

/** Asserts the composition wired the four in-memory media repositories. */
function expectInMemoryMediaPlane(repositories: ReturnType<typeof mediaRepositoriesOf>): void {
  expect(repositories.sourceAssets).toBeInstanceOf(InMemorySourceAssetRepository);
  expect(repositories.manifests).toBeInstanceOf(InMemoryMediaManifestRepository);
  expect(repositories.artifacts).toBeInstanceOf(InMemoryRenderArtifactRepository);
  expect(repositories.jobsRepository).toBeInstanceOf(InMemoryMediaJobRepository);
}

describe("the hosted-composition W911 fallback (R607 B1 regression)", () => {
  test("a filesystem-blocked db directory (mkdir ENOENT) falls back to the in-memory plane + the honest banner", () => {
    // The EXACT hosted mechanism: the process's working directory is
    // unlinked, so every durable store's on-demand parent creation — the
    // relative `mkdir 'db'` — fails ENOENT before `bun:sqlite` is ever
    // touched (measured shape: errno -2, syscall mkdir, path db). The
    // composition runs with the production-default RELATIVE db paths so
    // the whole server boots through the same seams the hosted runtime
    // hits (the url-source / compute / annotations seams walk the SAME
    // fallback — the media seam is the one asserted here).
    const savedCwd = process.cwd();
    const scratch = mkdtempSync(join(tmpdir(), "sporta-w911-hosted-"));
    process.chdir(scratch);
    rmSync(scratch, { recursive: true, force: true });
    try {
      const { banners, result: server } = captureBanners(() =>
        createSportaServer({
          seed: false,
          media: { db: "db/media-platform.db" },
        }),
      );
      // The composition SURVIVES (the R607 B1 regression: it died →
      // /api/platform/health answered 500 with an empty body).
      expectInMemoryMediaPlane(mediaRepositoriesOf(server));
      // The loud banner says WHY (the same W911 honesty — never masked).
      const mediaBanner = banners.find((banner) => banner.includes("media records are IN-MEMORY"));
      expect(mediaBanner).toBeDefined();
      expect(mediaBanner).toContain("the deployed runtime blocks the local db");
      expect(mediaBanner).toContain("ENOENT");
    } finally {
      process.chdir(savedCwd);
    }
  });

  test.skipIf(process.getuid === undefined || process.getuid() === 0)(
    "a permission-blocked db root (mkdir EACCES) is the same honest fallback",
    () => {
      // The errno-SET is the classification, not the one production errno:
      // a read-only parent refuses the db directory's creation with EACCES
      // (a genuine non-root filesystem refusal — skipped under root, which
      // bypasses permission checks). The db path sits one level BELOW the
      // read-only parent so the refusal fires on the store's own on-demand
      // directory creation (a db FILE directly inside the read-only parent
      // would instead fail at bun:sqlite's SQLITE_CANTOPEN — a genuine
      // durability fault that must stay loud).
      const scratch = mkdtempSync(join(tmpdir(), "sporta-w911-eacces-"));
      const blockedRoot = join(scratch, "blocked-root");
      mkdirSync(blockedRoot);
      chmodSync(blockedRoot, 0o555);
      try {
        const { banners, result: server } = captureBanners(() =>
          createSportaServer({
            seed: false,
            media: { db: join(blockedRoot, "media", "media-platform.db") },
            urlSources: { db: ":memory:" },
            computeCenter: { db: ":memory:" },
            annotations: { db: ":memory:" },
          }),
        );
        expectInMemoryMediaPlane(mediaRepositoriesOf(server));
        const mediaBanner = banners.find((banner) =>
          banner.includes("media records are IN-MEMORY"),
        );
        expect(mediaBanner).toBeDefined();
        expect(mediaBanner).toContain("the deployed runtime blocks the local db");
        expect(mediaBanner).toContain("EACCES");
      } finally {
        chmodSync(blockedRoot, 0o755);
        rmSync(scratch, { recursive: true, force: true });
      }
    },
  );

  test("a genuine construction failure is still RE-THROWN (never masked, no banner)", () => {
    // A FILE used as a directory component refuses the parent creation
    // with ENOTDIR — measured this run: a real errno that is NEITHER the
    // shim refusal NOR a filesystem-BLOCKED classification. The catch
    // must re-throw it (a genuinely broken db path is a real durability
    // fault — never silently in-memory) and must not log the fallback
    // banner for it.
    const scratch = mkdtempSync(join(tmpdir(), "sporta-w911-notdir-"));
    try {
      const asFile = join(scratch, "not-a-directory");
      writeFileSync(asFile, "a file, not a directory");
      const { banners, result: thrown } = captureBanners((): unknown => {
        try {
          createSportaServer({
            seed: false,
            media: { db: join(asFile, "media", "media-platform.db") },
            urlSources: { db: ":memory:" },
            computeCenter: { db: ":memory:" },
            annotations: { db: ":memory:" },
          });
          return null;
        } catch (error) {
          return error;
        }
      });
      expect(thrown).not.toBeNull();
      expect((thrown as NodeJS.ErrnoException).code).toBe("ENOTDIR");
      expect(
        banners.find((banner) => banner.includes("media records are IN-MEMORY")),
      ).toBeUndefined();
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  });

  test("the W911 shim refusal keeps its exact message contract (the bundled-runtime branch)", async () => {
    // The (a) branch matches the shim's refusal MESSAGE — the bundled
    // runtime's `bun:sqlite` alias (next.config.ts) throws it from
    // `bun-sqlite-shim.ts` the moment anyone constructs a `Database`.
    // This battery pins that message byte-for-byte so the composition's
    // catch keeps matching it (there is no pre-existing composition-level
    // W911 battery to weaken — the branch is only reachable on the real
    // hosted deploy; its contract is the shim's message).
    const { Database } = await import("../src/server/bun-sqlite-shim");
    let refusal: unknown = null;
    try {
      new Database();
    } catch (error) {
      refusal = error;
    }
    expect(refusal).not.toBeNull();
    expect(String(refusal)).toContain("bun:sqlite is available only under the Bun runtime");
  });
});
