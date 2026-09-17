# Sporta Compute Broker

## Purpose

The Compute Broker makes GPU execution a replaceable infrastructure choice. Product flows request workload capabilities and constraints; they do not name a cloud/GPU vendor.

## Compute request

A render or perception job submits a logical request such as:

```text
workload: football-reality-render
runtime: linux-container
accelerator: gpu
minVramGb: 16
cudaRequired: true
output: mp4
maxCostUsd: optional
region: optional
privacy: user-selected
priority: standard | fast
```

## Provider adapter contract

Each provider adapter exposes:

```text
validateCredentials()
capabilities()
quote(request)
submit(request)
status(jobId)
cancel(jobId)
collect(jobId)
health()
```

The adapter must translate provider-specific behavior into the stable Sporta job lifecycle:

```text
queued -> provisioning -> running -> collecting -> succeeded
                                   └-> failed
                                   └-> cancelled
                                   └-> unavailable
```

Provider-specific statuses, pricing, quotas, and errors never escape the adapter boundary.

## Initial provider matrix

| Provider | Intended use | Initial posture |
|---|---|---|
| Modal | free/low-cost development and managed execution | first adapter candidate |
| Lightning AI | free development and alternate hosted execution | second adapter candidate |
| RunPod | user-owned/pay-as-you-go and future Sporta-managed execution | production candidate |
| Vast.ai | low-cost/self-managed GPU marketplace and future managed execution | future adapter |
| Hugging Face ZeroGPU | bounded experiments and technology evaluation | experimental adapter |
| Local GPU | advanced BYOC and development | local adapter |

The matrix is a product architecture, not a permanent provider ranking. Actual provider eligibility is resolved at runtime from live capability, quota and pricing metadata plus Sporta policy.

## User-owned compute

Sporta exposes a Compute Connection Center.

### Connection flow

```text
Create Studio
   ↓
Compute
   ↓
Choose execution source
   ├── Sporta Compute
   ├── Connect Modal
   ├── Connect Lightning AI
   ├── Connect RunPod
   ├── Connect another provider
   └── Local / self-hosted worker
```

Where a provider supports OAuth/authorization redirects, use that mechanism. Where it only supports API credentials, use a narrowly scoped credential flow. Never request or store a provider master password.

The connection record stores only what Sporta needs to call the adapter, protected by the platform's secret-management boundary.

## Compute selection

The default UX is not provider-centric. It presents user goals:

- lowest cost;
- fastest result;
- highest available quality;
- use my connected GPU;
- use Sporta allowance.

Sporta converts those preferences into a ComputeRequest and evaluates eligible provider adapters.

## Managed Sporta compute

Sporta may later offer subscription plans backed by the same broker:

```text
Free
Creator
Pro
Studio / Business
```

Plans control allowance, concurrency, queue priority, resolution, duration and other product limits. The underlying provider can change without changing the customer workflow.

## Failure and fallback

If a provider is unavailable, over quota, or cannot satisfy the resource request, the broker returns a typed capability result. It may select an eligible fallback provider only when the job policy permits it.

The UI must expose meaningful states such as:

- provider unavailable;
- quota exhausted;
- credential invalid/expired;
- no compatible GPU;
- budget exceeded;
- queued;
- running;
- succeeded;
- failed.

No fake progress or silent provider substitution is allowed.

## Cost guardrails

Every execution must carry a cost/usage ledger entry where the provider supports metering. The broker must support fail-closed admission based on user allowance, Sporta plan limits, job limits and provider cost constraints.
