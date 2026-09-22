"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAccount } from "@/components/account-provider";
import { isNavActive } from "@/lib/navigation";
import { navGroupsForRole } from "@/lib/role-workspaces";
import { NavIcon } from "@/components/nav-icon";

/**
 * One navigation model, two renderings: the desktop sidebar and the mobile
 * tab bar are both projections of the same grouped model, so they cannot
 * drift.
 *
 * W907 → J002 — the model is ROLE-AWARE and SUPPLEMENTARY: the CORE
 * product navigation (Home, Live, Explore, Library, Following, Create)
 * comes first for EVERY role state, then the active role's workspace
 * surfaces as a labeled supplement group. A role workspace can never trap
 * a visitor away from the global product (global Home/discovery stay one
 * click away from every role). This is PRESENTATION ONLY: the
 * destinations a workspace lists say nothing about what the account may
 * do there — every protected action is reauthorized server-side against
 * the grants.
 *
 * Active destinations are conveyed by `aria-current="page"` AND visual
 * treatment — never by motion alone.
 */
export function NavLinks({ variant }: { variant: "sidebar" | "tabbar" }) {
  const pathname = usePathname() ?? "/";
  const { account } = useAccount();
  const groups = navGroupsForRole(account === null ? null : account.activeRole);
  return (
    <>
      {groups.map((group) => (
        <div key={group.id} className={`nav-group nav-group-${group.id}`}>
          {variant === "sidebar" && group.label !== null && (
            <p className="nav-group-label">{group.label}</p>
          )}
          <ul
            className={`nav-list nav-${variant}`}
            aria-label={group.id === "core" ? "Primary" : (group.label ?? "Workspace")}
          >
            {group.items.map((item) => {
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
        </div>
      ))}
    </>
  );
}
