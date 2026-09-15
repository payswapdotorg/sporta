import type { Metadata } from "next";
import { PageHeader } from "@/components/page-header";
import { DeferredSurface } from "@/components/deferred-surface";

export const metadata: Metadata = {
  title: "Create",
};

/**
 * Create (W903). The studio flow (W906) is described but not wired:
 * no upload form is rendered because it could not actually ingest
 * anything yet.
 */
export default function CreatePage() {
  return (
    <>
      <PageHeader
        kicker="Build"
        title="Create Studio"
        description="Turn authorized footage into new viewing experiences: pick your source, choose the reality, set the recipe, and render."
      />
      <div className="surface-stack">
        <DeferredSurface surface="create" />
      </div>
    </>
  );
}
