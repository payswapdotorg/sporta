# Sporta Productization Dependency Graph

Legend: `A -> B` means B depends on A.

```text
W701
 |
 +--> W901 capability contract --> W903 web shell --> W904 discovery
 |                                |               \
 +--> W902 auth/roles ------------+                -> W905 watch/reality switcher
 |                                                  |\
 |                                                  | +-> W909 browser E2E
 |                                                  |
 |                                                  +-> W906 Create Studio -> W907 role workspaces -> W908 operational UX states
 |
 W910 hosted edge/API
 |\
 +--> W911 Neon persistence
 +--> W912 R2 artifacts
 +--> W913 Upstash queue/cache
 |
 W303/W304/W504 -> W914 real compute adapter
 |
 W305 + W910 + W914 -> W915 real network live
 |
 W902 + W905 + W910 -> W916 catalog
 W916 + W902 + W912 -> W917 rights/publication
 W910-W915 -> W918 operations console
 W911-W914 + W918 -> W919 cost/usage guardrails
 W909 + W915 + W917 + W919 + W803-W806 -> W920 public beta
```

## Parallel-safe waves

Wave 1: A=W903; B=W901/W902; C=W914 audit.

Wave 2: A=W904/W905; B=W910-W913; C=W914.

Wave 3: A=W906-W908; B=W915/W919; C=hosted rendering/live validation.

Wave 4: A=W909 + product UI; B=W916-W918 backend/ops; C=integration hardening.

Wave 5: tech lead W920.

Shared contract rule: if a worker needs to change W901 capability/auth semantics or an existing core contract, all dependent waves pause until the tech lead reviews the change.
