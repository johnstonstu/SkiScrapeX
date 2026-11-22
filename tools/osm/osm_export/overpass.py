"""Fetch and cache raw Overpass responses for the Apex resort."""

from __future__ import annotations

import hashlib
import json
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import requests

from .constants import (
    BOUNDARY_WAY_ID,
    OVERPASS_ENDPOINTS,
    PEAK_EAST,
    PEAK_NORTH,
    PEAK_SOUTH,
    PEAK_WEST,
    SEARCH_EAST,
    SEARCH_NORTH,
    SEARCH_SOUTH,
    SEARCH_WEST,
    USER_AGENT,
)


def overpass_queries() -> list[tuple[str, str]]:
    """Small queries. A single combined request is often rejected when Overpass is busy."""
    bbox = f"{SEARCH_SOUTH},{SEARCH_WEST},{SEARCH_NORTH},{SEARCH_EAST}"
    peaks = f"{PEAK_SOUTH},{PEAK_WEST},{PEAK_NORTH},{PEAK_EAST}"
    resort = f"""
[out:json][timeout:120];
(
  way({BOUNDARY_WAY_ID});
  way["landuse"="winter_sports"]["name"~"Apex",i]({bbox});
  relation["landuse"="winter_sports"]["name"~"Apex",i]({bbox});
  way["piste:type"~"^(downhill|snow_park)$"]({bbox});
  relation["piste:type"~"^(downhill|snow_park)$"]({bbox});
  relation["route"="piste"]["piste:type"~"^(downhill|snow_park)$"]({bbox});
  way["aerialway"]({bbox});
  relation["route"="aerialway"]({bbox});
  node["aerialway"~"^(pylon|station)$"]({bbox});
  node["natural"="peak"]["name"]({peaks});
);
out body;
>;
out skel qt;
""".strip()
    buildings = f"""
[out:json][timeout:120];
(
  way["building"]({bbox});
  relation["building"]({bbox});
);
out body;
>;
out skel qt;
""".strip()
    highways = f"""
[out:json][timeout:120];
(
  way["highway"]({bbox});
);
out body;
>;
out skel qt;
""".strip()
    return [("resort", resort), ("buildings", buildings), ("highways", highways)]


def _now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def cache_paths(cache_dir: Path, query: str) -> tuple[Path, Path]:
    digest = hashlib.sha256(query.encode("utf-8")).hexdigest()[:16]
    return cache_dir / f"overpass-{digest}.json", cache_dir / f"overpass-{digest}.meta.json"


def _download_query(
    name: str,
    query: str,
    cache_dir: Path,
    refresh: bool,
    endpoints: tuple[str, ...],
    timeout: float,
) -> tuple[dict, dict]:
    body_path, meta_path = cache_paths(cache_dir, query)
    if body_path.exists() and not refresh:
        payload = json.loads(body_path.read_text(encoding="utf-8"))
        meta = json.loads(meta_path.read_text(encoding="utf-8")) if meta_path.exists() else {}
        meta["name"] = name
        meta["fromCache"] = True
        return payload, meta

    headers = {"User-Agent": USER_AGENT}
    errors: list[str] = []
    for endpoint in endpoints:
        response = None
        for attempt in range(4):
            print(f"Fetching {name} from {endpoint} (attempt {attempt + 1})", file=sys.stderr)
            try:
                response = requests.post(
                    endpoint,
                    data={"data": query},
                    headers=headers,
                    timeout=timeout,
                )
            except requests.RequestException as exc:
                errors.append(f"{name} {endpoint}: {exc}")
                response = None
                if attempt < 3:
                    time.sleep(15 * (attempt + 1))
                    continue
                break
            if response.status_code in (429, 502, 503, 504) and attempt < 3:
                errors.append(f"{name} {endpoint}: HTTP {response.status_code}")
                time.sleep(15 * (attempt + 1))
                continue
            break
        if response is None or response.status_code != 200 or response.content.lstrip().startswith(b"<"):
            if response is not None and response.status_code not in (429, 502, 503, 504):
                errors.append(f"{name} {endpoint}: HTTP {response.status_code} {response.text[:160]}")
            continue
        try:
            payload = json.loads(response.content)
        except json.JSONDecodeError as exc:
            errors.append(f"{name} {endpoint}: {exc}")
            continue
        body_path.write_bytes(response.content)
        meta = {
            "name": name,
            "endpoint": endpoint,
            "retrievedAt": _now(),
            "querySha256": hashlib.sha256(query.encode("utf-8")).hexdigest(),
            "bytes": body_path.stat().st_size,
            "fromCache": False,
        }
        meta_path.write_text(json.dumps(meta, indent=2) + "\n", encoding="utf-8")
        return payload, meta
    raise RuntimeError(f"Overpass request failed for {name}. " + " | ".join(errors))


def fetch_overpass(
    cache_dir: Path,
    refresh: bool = False,
    endpoints: tuple[str, ...] = OVERPASS_ENDPOINTS,
    timeout: float = 120,
) -> tuple[dict, dict]:
    """Return one combined Overpass document and a small fetch record.

    Each raw response is stored under cache_dir and is meant to stay out of Git.
    A matching cache file is reused unless refresh is set.
    """
    cache_dir.mkdir(parents=True, exist_ok=True)
    elements = []
    records = []
    timestamps = []
    copyright_text = None
    for name, query in overpass_queries():
        payload, meta = _download_query(name, query, cache_dir, refresh, endpoints, timeout)
        elements.extend(payload.get("elements", []))
        stamp = (payload.get("osm3s") or {}).get("timestamp_osm_base")
        if stamp:
            timestamps.append(stamp)
            meta["osmTimestamp"] = stamp
        copyright_text = copyright_text or (payload.get("osm3s") or {}).get("copyright")
        records.append(meta)
    combined = {
        "elements": elements,
        "osm3s": {
            "timestamp_osm_base": min(timestamps) if timestamps else None,
            "copyright": copyright_text,
        },
    }
    digest = hashlib.sha256(
        "".join(query for _, query in overpass_queries()).encode("utf-8")
    ).hexdigest()
    fetch = {
        "endpoint": records[-1].get("endpoint") if records else None,
        "retrievedAt": max((record.get("retrievedAt") or "" for record in records), default=None) or None,
        "querySha256": digest,
        "fromCache": all(record.get("fromCache") for record in records),
        "queries": records,
    }
    return combined, fetch


def normalize_elements(payload: dict) -> dict:
    """Merge duplicate elements from `out body` followed by `out skel`.

    A node that is both a tagged station and a way vertex appears twice. Tags
    from the body output are kept, and coordinates from either copy are kept.
    """
    merged: dict[tuple[str, int], dict] = {}
    for element in payload.get("elements", []):
        key = (element["type"], element["id"])
        current = merged.get(key)
        if current is None:
            merged[key] = dict(element)
            continue
        for field in ("lat", "lon", "nodes", "members", "version", "timestamp"):
            if element.get(field) is not None and not current.get(field):
                current[field] = element[field]
        if element.get("tags") and not current.get("tags"):
            current["tags"] = element["tags"]
    nodes, ways, relations = {}, {}, {}
    for (element_type, element_id), element in merged.items():
        if element_type == "node":
            nodes[element_id] = element
        elif element_type == "way":
            ways[element_id] = element
        elif element_type == "relation":
            relations[element_id] = element
    osm3s = payload.get("osm3s") or {}
    return {
        "nodes": nodes,
        "ways": ways,
        "relations": relations,
        "osmTimestamp": osm3s.get("timestamp_osm_base"),
        "copyright": osm3s.get("copyright"),
    }
