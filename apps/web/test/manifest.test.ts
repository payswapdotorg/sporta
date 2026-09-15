import { describe, expect, test } from "bun:test";
import { BRAND } from "../src/lib/brand";

const manifestUrl = new URL("../public/manifest.webmanifest", import.meta.url);

type ManifestIcon = {
  src: string;
  sizes: string;
  type: string;
  purpose?: string;
};

describe("W903 PWA manifest", () => {
  test("parses as JSON and is a valid install manifest", async () => {
    const manifest = JSON.parse(await Bun.file(manifestUrl).text());
    expect(manifest.name).toContain(BRAND.name);
    expect(manifest.short_name).toBe(BRAND.shortName);
    expect(manifest.short_name.length).toBeLessThanOrEqual(12);
    expect(manifest.display).toBe("standalone");
    expect(manifest.start_url).toBe("/");
    expect(manifest.scope).toBe("/");
    expect(manifest.id).toBe("/");
    expect(manifest.description).toBe(BRAND.description);
  });

  test("theme and background colors are the brand ink and match tokens", async () => {
    const manifest = JSON.parse(await Bun.file(manifestUrl).text());
    const hex = /^#[0-9a-f]{6}$/;
    expect(manifest.theme_color).toMatch(hex);
    expect(manifest.background_color).toMatch(hex);
    expect(manifest.theme_color).toBe(BRAND.themeColor);
    expect(manifest.background_color).toBe(BRAND.themeColor);
  });

  test("declares 192 and 512 'any' icons plus a maskable icon", async () => {
    const manifest = JSON.parse(await Bun.file(manifestUrl).text());
    const icons: ManifestIcon[] = manifest.icons;
    expect(icons.length).toBeGreaterThanOrEqual(3);

    const purposes = (icon: ManifestIcon) => icon.purpose ?? "any";
    const anyIcons = icons.filter((icon) => purposes(icon) === "any");
    const maskable = icons.filter((icon) => purposes(icon) === "maskable");

    expect(anyIcons.map((icon) => icon.sizes)).toContain("192x192");
    expect(anyIcons.map((icon) => icon.sizes)).toContain("512x512");
    expect(maskable.length).toBeGreaterThanOrEqual(1);
    for (const icon of maskable) {
      expect(icon.sizes).toBe("512x512");
    }
    for (const icon of icons) {
      expect(icon.type).toBe("image/png");
    }
  });

  test("every icon referenced by the manifest exists on disk", async () => {
    const manifest = JSON.parse(await Bun.file(manifestUrl).text());
    for (const icon of manifest.icons as ManifestIcon[]) {
      const file = Bun.file(new URL(`../public${icon.src}`, import.meta.url));
      expect(await file.exists()).toBe(true);
    }
  });

  test("icons carry the Sporta brand geometry (signature + size sanity)", async () => {
    for (const name of ["icon-192.png", "icon-512.png", "icon-maskable-512.png"]) {
      const bytes = new Uint8Array(
        await Bun.file(new URL(`../public/icons/${name}`, import.meta.url)).arrayBuffer(),
      );
      // PNG magic signature
      expect(Array.from(bytes.slice(0, 8))).toEqual([
        0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
      ]);
      const width = (bytes[16]! << 24) | (bytes[17]! << 16) | (bytes[18]! << 8) | bytes[19]!;
      const height = (bytes[20]! << 24) | (bytes[21]! << 16) | (bytes[22]! << 8) | bytes[23]!;
      expect(width).toBe(height); // square icons
      expect(bytes.length).toBeGreaterThan(2000); // not an empty stub
    }
  });
});
