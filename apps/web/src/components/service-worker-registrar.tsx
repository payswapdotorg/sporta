"use client";

import { useEffect } from "react";

/**
 * Service-worker registration (W903).
 *
 * Registers the hand-written app-shell service worker (`/public/sw.js`)
 * after the page has fully loaded, in production builds only — dev servers
 * and the SW cache would fight over hot-reloaded assets. Registration
 * failure is intentionally non-fatal: the app works online-first.
 */
export function ServiceWorkerRegistrar() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (typeof navigator === "undefined") return;
    if (!("serviceWorker" in navigator)) return;

    const register = () => {
      navigator.serviceWorker.register("/sw.js").catch(() => {
        // Registration failure is non-fatal; the shell remains usable.
      });
    };

    if (document.readyState === "complete") {
      register();
      return;
    }
    window.addEventListener("load", register, { once: true });
    return () => window.removeEventListener("load", register);
  }, []);

  return null;
}
