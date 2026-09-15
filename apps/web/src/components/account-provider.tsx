"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { AccountViewLike } from "@/lib/api-types";
import { fetchMe } from "@/lib/client-api";

/**
 * The account context (W904): one fetch of the real auth state shared by the
 * header's profile area, the role switcher and the auth-aware surfaces.
 * `refresh()` re-reads /api/auth/me after sign-in/out/role-switch.
 */
interface AccountContextValue {
  phase: "loading" | "ready" | "failed";
  account: AccountViewLike | null;
  refresh: () => Promise<void>;
}

const AccountContext = createContext<AccountContextValue | null>(null);

/** Provides the auth state to the tree (client — one fetch per load). */
export function AccountProvider({ children }: { children: React.ReactNode }) {
  const [phase, setPhase] = useState<"loading" | "ready" | "failed">("loading");
  const [account, setAccount] = useState<AccountViewLike | null>(null);

  const refresh = useCallback(async () => {
    try {
      setAccount(await fetchMe());
      setPhase("ready");
    } catch {
      setAccount(null);
      setPhase("failed");
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const value = useMemo<AccountContextValue>(() => ({ phase, account, refresh }), [phase, account, refresh]);
  return <AccountContext.Provider value={value}>{children}</AccountContext.Provider>;
}

/** Consumes the auth state (throws when used outside the provider). */
export function useAccount(): AccountContextValue {
  const context = useContext(AccountContext);
  if (context === null) {
    throw new Error("useAccount must be used inside <AccountProvider>");
  }
  return context;
}
