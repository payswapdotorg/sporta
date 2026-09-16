import type { NextConfig } from "next";

/**
 * Sporta web shell configuration (W903).
 *
 * Deliberately minimal so the app deploys to Vercel Hobby with zero
 * project configuration. No exotic output modes, no rewrites, no
 * image loaders: the shell is self-contained and data-free.
 */
const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // W914 (ADDITIVE): the /api/compute worker route imports the sporta
  // workspace packages as TypeScript sources — transpile them (and their
  // workspace deps) so the server bundle builds.
  transpilePackages: [
    "@sporta/compute-adapter-hosted",
    "@sporta/compute-adapter",
    "@sporta/contracts",
    "@sporta/output-pipeline",
    "@sporta/renderer-anime",
    "@sporta/renderer-contract",
  ],
};

export default nextConfig;
