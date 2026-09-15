import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { DeferredSurface } from "@/components/deferred-surface";
import { ROUTES } from "@/lib/navigation";

export const metadata: Metadata = {
  title: "Sign in",
};

/**
 * /auth/signin (W903). The identity scaffold: the route and its honest
 * explanation exist; no sign-in form is rendered because no identity
 * plane exists to authenticate against (W902). One account will be able
 * to hold many roles (Viewer, Creator, Analyst, Rights Holder, Operator)
 * — the role switcher changes the workspace, never the authority.
 */
export default function SignInPage() {
  return (
    <>
      <PageHeader
        kicker="Account"
        title="Sign in"
        description="Sign in to Sporta and switch between your roles — Viewer, Creator, Analyst, Rights Holder, Operator — from one account."
      />
      <div className="surface-stack">
        <DeferredSurface surface="signin" />
        <section className="signin-return">
          <p>
            In the meantime, the shell is fully explorable without an
            account.
          </p>
          <Link className="button-ghost" href={ROUTES.home}>
            Back to Home
          </Link>
        </section>
      </div>
    </>
  );
}
