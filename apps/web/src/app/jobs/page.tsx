import type { Metadata } from "next";
import { PageHeader } from "@/components/page-header";
import { JobsSurface } from "@/components/jobs-surface";

export const metadata: Metadata = {
  title: "Jobs",
};

/**
 * Jobs (W907) — the Creator workspace's job monitor (the Operator's
 * platform-wide one): the sessions' dispatched jobs with their REAL compute
 * state, progress and completions.
 */
export default function JobsPage() {
  return (
    <>
      <PageHeader
        kicker="Work"
        title="Jobs"
        description="Render jobs and their real progress — the sessions you own, or every session when you hold the operator grant."
      />
      <JobsSurface />
    </>
  );
}
