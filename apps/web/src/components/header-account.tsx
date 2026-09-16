"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAccount } from "@/components/account-provider";
import { fetchPendingWork, logoutAccount, switchActiveRole, ApiError } from "@/lib/client-api";
import { ROUTES } from "@/lib/navigation";
import {
  ROLE_LABELS,
  isRouteInWorkspace,
  switchableRoles,
  workspaceDefaultPath,
  type PendingWorkByRole,
} from "@/lib/role-workspaces";
import { NavIcon } from "@/components/nav-icon";

/**
 * The header's role/profile area (W904 → W907): anonymous visitors get the
 * real sign-in action; signed-in visitors get their account, the upgraded
 * ACTIVE-ROLE SWITCHER and sign-out.
 *
 * W907 switcher spec (ux-architecture "Role switching"):
 * - shows the CURRENT role (the account chip) — with a clear "no active
 *   role" state when none is active;
 * - lists the GRANTED ROLES ONLY (exactly the account's real grants from
 *   /api/auth/me — a role the account does not hold is never offered);
 * - shows PENDING WORK where the role has any (real counts from
 *   /api/workspaces/pending-work: creator jobs in flight, operator failed
 *   jobs; roles with no data plane carry no badge — honest absence);
 * - SAFE RETURN: switching never strands the visitor — when the current
 *   page is not part of the new role's workspace, the app navigates to the
 *   workspace's entry point, and the previous role stays one switch away
 *   (the switcher is always reachable from every page's header).
 *
 * Switching is PRESENTATION ONLY: the switcher never expands authority —
 * every protected action stays authorized server-side against the grants.
 */
export function HeaderAccount() {
  const { phase, account, refresh } = useAccount();
  const router = useRouter();
  const [switching, setSwitching] = useState(false);
  const [switchError, setSwitchError] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [pending, setPending] = useState<PendingWorkByRole | null>(null);

  const loadPending = useCallback(() => {
    void fetchPendingWork().then(
      (data) => setPending(data === null ? null : data.roles),
      () => setPending(null),
    );
  }, []);

  useEffect(() => {
    if (phase === "ready" && account !== null) loadPending();
  }, [phase, account, loadPending]);

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

  const offered = switchableRoles({ roles: account.roles, activeRole: null });

  async function onSwitchRole(role: ReturnType<typeof switchableRoles>[number]) {
    setSwitching(true);
    setSwitchError(null);
    try {
      await switchActiveRole(role);
      await refresh();
      // SAFE RETURN: never strand the visitor on a surface the new
      // workspace does not own — jump to the workspace's entry point; the
      // previous workspace stays one switch away in this same menu.
      if (!isRouteInWorkspace(role, window.location.pathname)) {
        router.push(workspaceDefaultPath(role));
      }
      setMenuOpen(false);
    } catch (err) {
      setSwitchError(
        err instanceof ApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : "the role switch failed",
      );
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
        <span className={`account-role ${account.activeRole === null ? "no-role" : ""}`}>
          {account.activeRole === null
            ? "no active role"
            : `${ROLE_LABELS[account.activeRole as keyof typeof ROLE_LABELS] ?? account.activeRole} workspace`}
        </span>
      </button>
      {menuOpen && (
        <div className="account-menu" role="menu" aria-label="Account">
          <p className="account-menu-heading">
            Active role (workspace only){account.activeRole !== null ? ` — ${ROLE_LABELS[account.activeRole as keyof typeof ROLE_LABELS] ?? account.activeRole}` : " — none"}
          </p>
          {offered.length === 0 ? (
            <p className="role-note">
              This account holds no role grants yet — every surface stays read-only until a
              grant is assigned.
            </p>
          ) : (
            <ul className="role-switcher" aria-label="Switch active role">
              {offered.map((role) => {
                const pendingBadge = pending?.[role];
                return (
                  <li key={role}>
                    <button
                      type="button"
                      role="menuitemradio"
                      aria-checked={account.activeRole === role}
                      disabled={switching}
                      className={`role-option ${account.activeRole === role ? "active" : ""}`}
                      onClick={() => void onSwitchRole(role)}
                    >
                      <span className="role-option-name">
                        {ROLE_LABELS[role]}
                        {account.activeRole === role && (
                          <span className="sr-only"> (current)</span>
                        )}
                      </span>
                      {pendingBadge !== undefined && (
                        <span className="role-badge">{pendingBadge.label}</span>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          <p className="role-note">
            Switching changes your workspace, never your authority — every action is
            reauthorized server-side against your grants, and your previous workspace stays
            one switch away.
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
