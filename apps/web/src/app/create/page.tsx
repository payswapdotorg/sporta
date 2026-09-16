import type { Metadata } from "next";
import { PageHeader } from "@/components/page-header";
import { CreateStudio } from "@/components/create-studio";

export const metadata: Metadata = {
  title: "Create",
};

/**
 * Create (W906) — the Create Studio: a guided flow from an authorized
 * source, through a rights declaration (identity-attested, fail-closed),
 * a renderer + recipe, a REAL render through the compute plane with real
 * progress, a preview of the stored output, and publish/private.
 */
export default function CreatePage() {
  return (
    <>
      <PageHeader
        kicker="Build"
        title="Create Studio"
        description="Turn authorized footage into new viewing experiences: pick your source, declare your rights, choose the reality, and render."
      />
      <div className="surface-stack">
        <CreateStudio />
      </div>
    </>
  );
}
