import { describe, expect, test } from "bun:test";
import { A11Y, SKIP_LINK_HREF } from "../src/lib/a11y";
import { BRAND } from "../src/lib/brand";

const read = async (path: string) => Bun.file(new URL(path, import.meta.url)).text();

/**
 * Accessibility-baseline wiring checks (W903). The shell's a11y contract
 * lives in src/lib/a11y.ts; these tests pin that the layout and the
 * stylesheet actually use it — landmarks, skip link, focus states and
 * reduced-motion support cannot silently regress.
 */
describe("W903 accessibility baseline wiring", () => {
  test("layout declares the document language and renders the skip link to the main landmark", async () => {
    const layout = await read("../src/app/layout.tsx");
    expect(layout).toContain('lang="en"');
    expect(layout).toContain("SKIP_LINK_HREF");
    expect(layout).toContain("A11Y.skipLinkText");
    expect(layout).toContain(`id={A11Y.mainId}`);
    expect(layout).toContain("tabIndex={-1}");
  });

  test("layout composes the semantic landmark components", async () => {
    const layout = await read("../src/app/layout.tsx");
    expect(layout).toContain("SiteHeader");
    expect(layout).toContain("SiteSidebar");
    expect(layout).toContain("<main");
    expect(layout).toContain("SiteFooter");
    expect(layout).toContain("MobileTabbar");
  });

  test("the header, navigations and footer are landmark elements with labels", async () => {
    const header = await read("../src/components/site-header.tsx");
    expect(header).toContain("<header");
    const sidebar = await read("../src/components/site-sidebar.tsx");
    expect(sidebar).toContain("<nav");
    expect(sidebar).toContain("aria-label={A11Y.sidebarNavLabel}");
    const tabbar = await read("../src/components/mobile-tabbar.tsx");
    expect(tabbar).toContain("<nav");
    expect(tabbar).toContain("aria-label={A11Y.tabbarNavLabel}");
    const footer = await read("../src/components/site-footer.tsx");
    expect(footer).toContain("<footer");
    expect(footer).toContain("aria-label={A11Y.footerNavLabel}");
  });

  test("active navigation is carried by aria-current, not by motion", async () => {
    const navLinks = await read("../src/components/nav-links.tsx");
    expect(navLinks).toContain('aria-current={active ? "page" : undefined}');
  });

  test("decorative mark and icons are hidden from assistive tech", async () => {
    const mark = await read("../src/components/sporta-mark.tsx");
    expect(mark).toContain('aria-hidden="true"');
    const icon = await read("../src/components/nav-icon.tsx");
    expect(icon).toContain('aria-hidden="true"');
  });

  test("the search seam is a labelled search landmark form", async () => {
    const search = await read("../src/components/search-box.tsx");
    expect(search).toContain('role="search"');
    expect(search).toContain("A11Y.searchInputLabel");
  });

  test("stylesheet ships the a11y primitives", async () => {
    const css = await read("../src/app/globals.css");
    expect(css).toContain(".sr-only");
    expect(css).toContain(".skip-link");
    expect(css).toContain(":focus-visible");
    expect(css).toContain("prefers-reduced-motion");
  });

  test("footer is pinned to the bottom of the frame (mt-auto flex layout)", async () => {
    const css = await read("../src/app/globals.css");
    expect(css).toContain(".app-frame");
    expect(css).toContain("flex-direction: column");
    expect(css).toContain(".site-footer");
    expect(css).toContain("margin-top: auto");
  });

  test("viewport theme color agrees with the manifest and brand tokens", async () => {
    const layout = await read("../src/app/layout.tsx");
    expect(layout).toContain("themeColor: BRAND.themeColor");
    const manifest = JSON.parse(
      await Bun.file(new URL("../public/manifest.webmanifest", import.meta.url)).text(),
    );
    expect(manifest.theme_color).toBe(BRAND.themeColor);
  });

  test("skip link href and main landmark id are one constant", () => {
    expect(SKIP_LINK_HREF).toBe(`#${A11Y.mainId}`);
  });
});
