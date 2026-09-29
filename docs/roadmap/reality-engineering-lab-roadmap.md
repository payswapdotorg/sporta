# Reality Engineering Lab Roadmap

```
Existing Sporta core
  ├── SWM / batch / live                 ✅
  ├── Renderer contract                  ✅
  ├── Compute Broker                     ✅
  ├── R606 / R607 / Live gates           ☐ current blockers
  │
  ↓ ADR-013
  │
  ├── Domain Pack                        ☐ REL-001
  ├── Lab Run + simulator                ☐ REL-002..003
  ├── Agent Body                         ☐ REL-004
  ├── Agent Organization                 ☐ REL-005
  ├── Organization search               ☐ REL-006
  ├── Evaluator / reward                ☐ REL-007
  ├── Calibration                       ☐ REL-008
  │
  ├── Historical source/corpus           ☐ REL-009..011
  ├── Durable workers                    ☐ REL-012
  ├── Long-running harness              ☐ REL-013
  ├── External HTTP + MCP               ☐ REL-014..015
  ├── Feed processing                   ☐ REL-016
  │
  ├── Organization Registry             ☐ REL-017
  ├── Automated promotion/rollback      ☐ REL-018
  ├── Organization choice UI            ☐ REL-019
  ├── User Labs                         ☐ REL-020
  ├── User Lab incentives               ☐ REL-021
  ├── Organization publishing/exchange  ☐ REL-022..023
  ├── Platform processing workspace     ☐ REL-024
  │
  ├── Robustness + safety gates         ☐ REL-025..031
  ├── Second domain proof               ☐ REL-032
  ├── Production choice proof           ☐ REL-033
  ├── Incentive proof                    ☐ REL-034
  ├── External platform proof            ☐ REL-035
  └── Final drift audit                  ☐ REL-036
```

## Product evolution

Phase 1 — Sporta learns football rendering organizations.

Phase 2 — users can run private labs and publish organizations.

Phase 3 — organizations become selectable production backends.

Phase 4 — external platforms discover and invoke Sporta organizations through API/MCP.

Phase 5 — external platforms can continuously feed media to Sporta.

Phase 6 — additional sports and non-sport domain packs expand the lab without redesigning its core.

## Promotion invariant

A lab breakthrough is not a product feature until it passes the same promotion/evidence gates as a hand-engineered organization.
