import type { Metadata } from "next";
import { PageHeader } from "@/components/page-header";
import { AuthForms } from "@/components/auth-forms";

export const metadata: Metadata = {
  title: "Sign in",
};

/**
 * /auth/signin (W904): the real auth surface — sign-in and registration
 * wired to /api/auth/* against the real identity stores. One account can
 * hold many roles; the active role changes the workspace, never authority.
 */
export default function SignInPage() {
  return (
    <>
      <PageHeader
        kicker="Account"
        title="Sign in"
        description="Sign in to Sporta and switch between your roles — Viewer, Creator, Analyst, Rights Holder, Operator — from one account."
      />
      <AuthForms />
    </>
  );
}
