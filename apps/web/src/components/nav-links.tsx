"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAccount } from "@/components/account-provider";
import { isNavActive } from "@/lib/navigation";
import { navForRole } from "@/lib/role-workspaces";
import { NavIcon } from "@/components/nav-icon";

/**
 * One navigation model, two renderings: the desktop sidebar and the mobile
 * tab bar are both projections of the same list, so they cannot drift.
 *
 * W907 — the list itself is ROLE-AWARE: an active role narrows navigation to
 * that role's workspace (the matrix's product surface map); no active role
 * (signed out, or signed in without one selected) shows the shared
 * navigation. This is PRESENTATION ONLY: the destinations a workspace lists
 * say nothing about what the account may do there — every protected action
 * is reauthorized server-side against the grants.
 *
 * Active destinations are conveyed by `aria-current="page"` AND visual
 * treatment — never by motion alone.
 */
export function NavLinks({ variant }: { variant: "sidebar" | "tabbar" }) {
  const pathname = usePathname() ?? "/";
  const { account } = useAccount();
  const items = navForRole(account === null ? null : account.activeRole);
  return (
    <ul className={`nav-list nav-${variant}`}>
      {items.map((item) => {
        const active = isNavActive(pathname, item.href);
        return (
          <li key={item.href} className="nav-item">
            <Link
              href={item.href}
              className="nav-link"
              aria-current={active ? "page" : undefined}
              title={item.description}
            >
              <NavIcon name={item.icon} />
              <span className="nav-label">{item.label}</span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
