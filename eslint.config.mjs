import eslint from "@eslint/js";
import tseslint from "typescript-eslint";

export default [
  {
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "**/coverage/**",
      "**/.next/**",
      "**/out/**",
      // Hand-written service worker: WebWorker global scope, no DOM globals.
      "apps/web/public/sw.js",
    ],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["packages/*/src/**/*.{ts,tsx}"],
    rules: {
      "no-console": "warn",
    },
  },
];
