"use client";

import { useState } from "react";
import Link from "next/link";
import { useAccount } from "@/components/account-provider";
import { logoutAccount, switchActiveRole } from "@/lib/client-api";
import { ROUTES } from "@/lib/navigation";
import { NavIcon } from "@/components/nav-icon";

/**
 * The header's role/profile area (W904): anonymous visitors get the real
 * sign-in action; signed-in visitors get their account, the ACTIVE-ROLE
 * switcher (presentation only — the switcher lists exactly the account's
 * grants and never expands authority), and sign-out.
 */
export function HeaderAccount() {
  const { phase, account, refresh } = useAccount();
  const [switching, setSwitching] = useState(false);
  const [switchError, setSwitchError] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);

  if (phase === "loading") {
    return (
      <span className="header-account" aria-busy="true">
        Checking session…
      </span>
    );
  }

  if (account === null) {
    return (
      <Link href={ROUTES.signin} className="signin-link">
        <NavIcon name="signin" />
        <span>Sign in</span>
      </Link>
    );
  }

  async function onSwitchRole(role: string) {
    setSwitching(true);
    setSwitchError(null);
    try {
      await switchActiveRole(role);
      await refresh();
    } catch (err) {
      setSwitchError(err instanceof Error ? err.message : "the role switch failed");
    } finally {
      setSwitching(false);
    }
  }

  async function onSignOut() {
    try {
      await logoutAccount();
    } finally {
      await refresh();
    }
  }

  return (
    <div className="header-account">
      <button
        type="button"
        className="account-button"
        aria-expanded={menuOpen}
        aria-haspopup="menu"
        onClick={() => setMenuOpen((open) => !open)}
      >
        <span className="account-avatar" aria-hidden="true">
          {account.username.slice(0, 1).toUpperCase()}
        </span>
        <span className="account-name">{account.username}</span>
        <span className="account-role">{account.activeRole ?? "no active role"}</span>
      </button>
      {menuOpen && (
        <div className="account-menu" role="menu" aria-label="Account">
          <p className="account-menu-heading">Active role (workspace only)</p>
          <ul className="role-switcher" aria-label="Switch active role">
            {account.roles.map((role) => (
              <li key={role}>
                <button
                  type="button"
                  role="menuitemradio"
                  aria-checked={account.activeRole === role}
                  disabled={switching}
                  className={`role-option ${account.activeRole === role ? "active" : ""}`}
                  onClick={() => void onSwitchRole(role)}
                >
                  {role}
                  {account.activeRole === role && <span className="sr-only"> (current)</span>}
                </button>
              </li>
            ))}
          </ul>
          <p className="role-note">
            Switching changes your workspace, never your authority — every action is authorized
            server-side against your grants.
          </p>
          {switchError !== null && (
            <p className="role-error" role="alert">
              {switchError}
            </p>
          )}
          <button
            type="button"
            role="menuitem"
            className="signout-button"
            onClick={() => void onSignOut()}
          >
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}
