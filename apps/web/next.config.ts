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
};

export default nextConfig;
