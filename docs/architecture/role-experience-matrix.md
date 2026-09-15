# Sporta Role Experience Matrix

| Capability | Viewer | Creator | Analyst/Commentator | Rights Holder | Operator/Admin |
|---|---:|---:|---:|---:|---:|
| Discover/watch | yes | yes | yes | yes | yes |
| Reality Switcher | yes | yes | yes | preview | operator preview |
| Upload authorized source | no | yes | optional | yes | yes |
| Render recipe creation | no | yes | optional | policy-scoped | yes |
| SWM/event inspection | summary | summary | full | audit view | operational view |
| Commentary tools | listen/transcript | optional | full | audit | diagnostic |
| Publish/share | authorized | authorized | authorized | policy owner | restricted |
| Rights policy editing | no | no | no | yes | policy administration |
| Queue/health monitoring | no | job-only | job-only | no | yes |
| Renderer/model operations | no | capability view | capability view | no | yes |
| Audit log | personal | personal content | personal content | rights scope | system scope |

## Role semantics

Roles are capabilities/workspaces, not identities. A user can hold multiple roles and switch between them. Server-side authorization remains authoritative.

## Product surface map

- Viewer: Home, Live, Explore, Watch, Library.
- Creator: Home, Create Studio, Jobs, Library.
- Analyst: Home, Watch, Match Lab, Clips, Notes.
- Rights Holder: Home, Rights Center, Catalog, Audit.
- Operator: Operations, Jobs, Health, Providers, Audit.

Every surface must degrade gracefully when a capability is unavailable.
