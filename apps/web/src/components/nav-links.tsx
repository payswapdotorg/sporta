"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { PRIMARY_NAV, isNavActive } from "@/lib/navigation";
import { NavIcon } from "@/components/nav-icon";

/**
 * One navigation model, two renderings: the desktop sidebar and the mobile
 * tab bar are both projections of `PRIMARY_NAV`, so they cannot drift.
 * Active destinations are conveyed by `aria-current="page"` AND visual
 * treatment — never by motion alone.
 */
export function NavLinks({ variant }: { variant: "sidebar" | "tabbar" }) {
  const pathname = usePathname() ?? "/";
  return (
    <ul className={`nav-list nav-${variant}`}>
      {PRIMARY_NAV.map((item) => {
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
