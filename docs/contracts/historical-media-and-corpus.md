# Historical Media and Corpus Contract

Status: FROZEN under ADR-013

## Source classes

Sporta can acquire historical event material from:
1. user-fed uploads;
2. user-authorized account/provider connectors;
3. permitted public/source provider adapters;
4. authorized live/tracking/statistical feeds;
5. reference-only URLs.

A URL is a source reference, not proof of transformation rights.

## Source record

Every source records:
- sourceId;
- provider;
- providerContentId when available;
- canonical URL;
- owner/creator reference when available;
- observed/publication time;
- acquisition time;
- rights/policy basis;
- acquisition method/version;
- media availability state;
- checksum for acquired bytes;
- metadata digest;
- feature bundle/version;
- source restrictions.

## Acquisition states

```
referenced
  -> authorized-for-access
  -> acquired
  -> normalized
  -> benchmarked
```

Reference-only sources can be indexed and used for metadata discovery without acquiring bytes.

## YouTube and similar providers

The provider adapter may:
- discover/search metadata;
- retain canonical references;
- retrieve bytes only when the applicable access/rights/policy path permits it.

The system must not bypass access controls, provider restrictions or rights requirements.

## User-fed historical matches

A user can upload a match or a permitted clip directly. The same normalization, provenance, SWM and evaluation pipeline is used as for provider-acquired sources.

## Corpus design

Corpus entries are reference-first with derived feature bundles. Repeated simulation should reuse durable derived features rather than repeatedly fetching source media.

## Reproducibility

Every benchmark fixture is content-addressed by:
- source identifier/reference;
- acquired-byte checksum where applicable;
- normalized-byte checksum;
- time window;
- feature/decoder versions.

## Non-sports extension

The source contract is event-domain neutral. A non-sports domain pack may consume the same source and corpus infrastructure.
