# External Platform API and MCP Contract

Status: FROZEN under ADR-013

## Principle

API and MCP expose the same Sporta application capabilities. Neither adapter creates a second job, rights, artifact or promotion authority.

## External capabilities

A permitted external platform may:
- discover eligible organizations;
- compare organizations against declared requirements;
- request a lab run;
- submit media/source references;
- submit a live/feed session;
- start a transformation/render job;
- subscribe/poll for progress;
- retrieve validated outputs;
- retrieve evidence/quality metadata;
- import a validated organization into its integration scope;
- request continuous processing of a feed.

## Logical resources

- PlatformConnection
- OrganizationCatalogQuery
- OrganizationSelection
- LabRunRequest
- MediaProcessingJob
- FeedProcessingJob
- OutputArtifact
- EvidenceBundle
- OrganizationPromotionRequest

## API/MCP parity

Every exposed MCP tool maps to a versioned application service. MCP is an interaction protocol, not business logic.

Example tool families:
- search_organizations
- inspect_organization
- launch_lab
- submit_video
- submit_feed
- get_job
- cancel_job
- get_output
- get_evidence
- promote_organization

## Long-running jobs

Long jobs return a durable job identifier immediately. Clients can:
- poll;
- subscribe;
- reconnect;
- cancel;
- resume when supported.

CopilotKit/OpenMuse/AG-UI or equivalent harnesses may present these operations and stream state, but canonical state remains Sporta's job/run store.

## Feed processing

An external platform may stream or periodically submit a feed. Sporta runs the configured domain pack, organization, renderer and delivery policy.

Example:
```
video platform upload
  -> Sporta source validation
  -> domain/organization selection
  -> render
  -> quality gates
  -> transformed asset
  -> platform publication pipeline
```

## Security

- tenant/platform isolation;
- scoped credentials;
- signed job/artifact references;
- rights/policy enforcement;
- rate and compute limits;
- audit log;
- idempotency keys;
- webhook signing where webhooks exist.

External clients may not request internal worker execution, mutate SWM truth, bypass canary/promotion, or inject untrusted organization code into the production runtime.
