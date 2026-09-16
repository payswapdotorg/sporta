/**
 * THE `bun:sqlite` BUNDLER SHIM (W911 deployment fix).
 *
 * `@sporta/session` and `@sporta/output-pipeline` import `bun:sqlite` at
 * module scope (they are Bun-native engine packages — the zero-dep rule).
 * The hosted runtime is Vercel's **Node** server, where the `bun:sqlite`
 * specifier cannot resolve at all — the import would crash the module graph
 * before any code runs. This module is aliased in for `bun:sqlite` at build
 * time (next.config.ts `resolveAlias`), so the graph LOADS everywhere while
 * the sqlite-backed classes fail loudly the moment anyone constructs one.
 *
 * The hosted composition (W904/W910-W914) never constructs a
 * `SqliteSessionRepository` / sqlite output store: the deployed backing is
 * the in-memory control plane (W912/W914 bring the hosted replacements).
 */
export class Database {
  constructor() {
    throw new Error(
      "bun:sqlite is available only under the Bun runtime — this deployment uses the in-process stores (hosted: W912/W914)",
    );
  }
}
