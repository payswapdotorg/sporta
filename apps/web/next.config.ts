import type { NextConfig } from "next";

/**
 * The @sporta/* engine packages this app's SERVER composes (route handlers +
 * src/server only — never client components). They ship raw TypeScript, so
 * they are TRANSPILED into the server bundle (W911 deployment fix): the
 * hosted runtime is Vercel's **Node** server, which can neither execute
 * `node_modules/*.ts` (the old `serverExternalPackages` mode required the
 * Bun runtime to import them natively) nor resolve `bun:sqlite`.
 *
 * The one Bun-native import in the composed graph (`bun:sqlite`, inside
 * `@sporta/session` and `@sporta/output-pipeline`) is aliased to a loud
 * throwing shim (`src/server/bun-sqlite-shim.ts`): the graph loads on both
 * runtimes, and constructing a sqlite-backed store fails with the reason —
 * the deployed composition only ever constructs the in-memory stores
 * (hosted: W912/W914). Bun-global APIs (`Bun.CryptoHasher`, …) are covered
 * by `src/instrumentation.ts` at server startup.
 */
const SPORTA_SERVER_PACKAGES = [
  "@sporta/asr",
  "@sporta/capability",
  "@sporta/commentary-segmentation",
  "@sporta/commentary-understanding",
  "@sporta/contracts",
  "@sporta/compute-adapter",
  "@sporta/compute-adapter-hosted",
  "@sporta/control-api",
  "@sporta/field-mapping",
  "@sporta/fusion",
  "@sporta/identity",
  "@sporta/observation",
  "@sporta/output-pipeline",
  "@sporta/perception-detection",
  "@sporta/perception-tracking",
  "@sporta/renderer-anime",
  "@sporta/renderer-contract",
  "@sporta/session",
  "@sporta/spatial-state",
  "@sporta/temporal",
  "@sporta/testing",
  "@sporta/timeline",
  "@sporta/world-model",
] as const;

const BUN_SQLITE_SHIM = "./src/server/bun-sqlite-shim.ts";

/**
 * Sporta web app configuration (W903 shell + W904/W905 data surfaces + the
 * W910–W913 hosted platform seams).
 *
 * Deliberately minimal so the app deploys to Vercel Hobby with zero project
 * configuration beyond this file: no exotic output modes, no rewrites, no
 * image loaders. `poweredByHeader` off is standard hardening.
 */
const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  transpilePackages: [...SPORTA_SERVER_PACKAGES],
  turbopack: {
    resolveAlias: {
      "bun:sqlite": BUN_SQLITE_SHIM,
    },
  },
  webpack: (config) => {
    config.resolve.alias["bun:sqlite"] = BUN_SQLITE_SHIM;
    return config;
  },
};

export default nextConfig;
