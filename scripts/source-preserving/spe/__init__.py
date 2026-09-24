"""SPE-v1 — Sporta Source-Preserving Reality Engine v1.

Deterministic-classical renderer implementations behind Sporta-owned contracts
(docs/contracts/source-preserving-renderer.md, ADR-012).
"""

from .renderers import REGISTRY, CARTOON_CEL, ANIME_NPR, NOIR_RETRO, MOTION_TRAILS
from . import stages, encode, provenance

__all__ = ["REGISTRY", "CARTOON_CEL", "ANIME_NPR", "NOIR_RETRO", "MOTION_TRAILS",
           "stages", "encode", "provenance"]
