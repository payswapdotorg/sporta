import type { Metadata } from "next";
import { WatchExperience } from "@/components/watch-experience";

export const metadata: Metadata = {
  title: "Watch",
};

/**
 * Watch (W905 → R504/R505) — the main product surface: one match, many
 * realities. `?session=<id>` selects the match (constant for the page's
 * life); `?reality=<kind>` pre-selects a reality (the URL-addressable
 * selection the Reality Switcher maintains — shareable, refresh-stable).
 * The legacy `?renderer=<id>` alias maps onto its reality kind through the
 * catalog's own producer data.
 */
export default async function WatchPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const sessionParam = params.session;
  const realityParam = params.reality;
  const rendererParam = params.renderer;
  const sessionId =
    typeof sessionParam === "string" && sessionParam.length > 0 ? sessionParam : null;
  const reality =
    typeof realityParam === "string" && realityParam.length > 0 ? realityParam : null;
  const initialRenderer =
    typeof rendererParam === "string" && rendererParam.length > 0 ? rendererParam : null;

  return (
    <WatchExperience
      sessionId={sessionId}
      initialReality={reality}
      initialRenderer={initialRenderer}
    />
  );
}
