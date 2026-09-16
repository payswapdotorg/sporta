import type { NextConfig } from "next";

/**
 * The @sporta/* engine packages this app's SERVER composes (route handlers +
 * src/server only — never client components). They ship raw TypeScript with
 * Bun-specific externals (`bun:sqlite` in @sporta/session and
 * @sporta/output-pipeline), so they are declared server-external: the bundler
 * never resolves them and the runtime (Bun) imports them natively. Client
 * components consume ONLY fetch/JSON from the /api routes.
 */
const SPORTA_SERVER_PACKAGES = [
  "@sporta/asr",
  "@sporta/capability",
  "@sporta/commentary-segmentation",
  "@sporta/commentary-understanding",
  "@sporta/contracts",
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

/**
 * Sporta web app configuration (W903 shell + W904/W905 data surfaces).
 *
 * Deliberately minimal so the app deploys to Vercel Hobby with zero
 * project configuration: no exotic output modes, no rewrites, no image
 * loaders. `poweredByHeader` off is standard hardening.
 */
const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  serverExternalPackages: [...SPORTA_SERVER_PACKAGES],
};

export default nextConfig;
