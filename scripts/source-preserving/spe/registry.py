"""SPE-v1 renderer registry — lookup API over the frozen renderer declarations.

Accepts both the reality key ("cartoon-cel") and the full rendererId
("spr-cartoon-cel-dc1"). Registry rows mirror contract §4.
"""

from .renderers import RENDERER_DECLARATIONS
from . import SPE_ENGINE


class RendererSpec:
    def __init__(self, decl):
        self.reality = decl["reality"]
        self.renderer_id = decl["rendererId"]
        self.renderer_version = decl["rendererVersion"]
        self.family = decl["family"]
        self.spr_id = decl["sprId"]
        self.name = decl["name"]
        self.implementation = decl["implementation"]
        self.default_profile = decl["defaultProfile"]
        self.profiles = decl["profiles"]

    def resolve_profile(self, profile=None):
        name = profile or self.default_profile
        if name not in self.profiles:
            raise KeyError(
                "profile %r not registered for %s (available: %s)"
                % (name, self.renderer_id, sorted(self.profiles)))
        prof = self.profiles[name]
        import copy
        pipeline = copy.deepcopy(prof["pipeline"])
        return name, pipeline, bool(prof.get("needsFlow", False))


_REGISTRY = {d["reality"]: RendererSpec(d) for d in RENDERER_DECLARATIONS.values()}
_BY_ID = {d["rendererId"]: d["reality"] for d in RENDERER_DECLARATIONS.values()}


def lookup(key_or_id):
    key = key_or_id.strip().lower()
    if key in _REGISTRY:
        return _REGISTRY[key]
    if key in _BY_ID:
        return _REGISTRY[_BY_ID[key]]
    raise KeyError("unknown renderer %r; registered: %s"
                   % (key_or_id, sorted(_REGISTRY)))


def all_keys():
    return sorted(_REGISTRY)


def registry_rows():
    """Contract §4 view of the registry."""
    return [
        {
            "reality": s.reality,
            "rendererId": s.renderer_id,
            "rendererVersion": s.renderer_version,
            "family": s.family,
            "sprId": s.spr_id,
            "name": s.name,
            "implementation": s.implementation,
            "engine": SPE_ENGINE,
            "defaultProfile": s.default_profile,
            "profiles": sorted(s.profiles),
        }
        for s in _REGISTRY.values()
    ]
