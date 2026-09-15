import type { Metadata } from "next";
import { WatchExperience } from "@/components/watch-experience";

export const metadata: Metadata = {
  title: "Watch",
};

/**
 * Watch (W905) — the main product surface: one match, many realities.
 * `?session=<id>` selects the match (constant for the page's life);
 * `?renderer=<id>` optionally pre-selects a reality.
 */
export default async function WatchPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const sessionParam = params.session;
  const rendererParam = params.renderer;
  const sessionId =
    typeof sessionParam === "string" && sessionParam.length > 0 ? sessionParam : null;
  const initialRenderer =
    typeof rendererParam === "string" && rendererParam.length > 0 ? rendererParam : null;

  return <WatchExperience sessionId={sessionId} initialRenderer={initialRenderer} />;
}
