/**
 * The account role vocabulary (W901).
 *
 * Source of truth: `docs/architecture/role-experience-matrix.md` — "Roles are
 * capabilities/workspaces, not identities. A user can hold multiple roles and
 * switch between them. Server-side authorization remains authoritative."
 *
 * Wire form is lower-case kebab (`"rights-holder"`, not `"Rights Holder"`)
 * following the repo's closed-vocabulary conventions (zod enums, e.g.
 * `@sporta/contracts`' `SessionStatus`).
 *
 * W902 (`@sporta/identity`) CONSUMES this vocabulary: roles are stored as
 * GRANTS on the account, and the active role is a per-session presentation
 * field that never changes grants. The two normative notes below are carried
 * INSIDE every capability response as pinned literals so a frontend can render
 * the semantics without hard-coding its own copy (they can never drift).
 */
import { z } from "zod";

/**
 * The five account roles from the role-experience matrix. A role is a grant
 * (what the account may be offered), NEVER authority (what a request may do —
 * that is decided server-side per action by `@sporta/identity`'s policy).
 */
export const ROLES = [
  "viewer",
  "creator",
  "analyst",
  "rights-holder",
  "operator",
] as const;

/** An account role grant. */
export type Role = (typeof ROLES)[number];

/** Zod schema for {@link Role}. */
export const RoleSchema = z.enum(ROLES);

/**
 * The pinned active-role context note (auth section of every capability
 * response). Role switching changes the workspace, not permissions — this is
 * the architecture-lock no-drift rule "do not let role switching grant
 * authority" made machine-enforceable: the field is a zod LITERAL.
 */
export const ACTIVE_ROLE_CONTEXT_NOTE =
  "The active role is workspace presentation context only: it never changes account grants, rights, or authorization, and every protected action is reauthorized server-side.";

/**
 * The pinned grants note (account section of every capability response).
 * Roles listed on the account are grants, not authority.
 */
export const ROLES_ARE_GRANTS_NOTE =
  "Account roles are grants, not authority: they describe the workspaces the account may be offered; authorization is enforced server-side per action and never derived client-side from this list.";
