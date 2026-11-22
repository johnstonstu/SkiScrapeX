"""Fetch and cache raw OpenStreetMap data for the Apex resort.

Overpass is tried across several mirrors. If every mirror fails, the main OSM
map API (`/api/0.6/map`) is used for the terrain bbox. That second path is a
normal option of this module, not a patch applied by the caller.
"""

from __future__ import annotations

import hashlib
import json
import sys
import time
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from pathlib import Path

import requests

from .constants import (
    BOUNDARY_WAY_ID,
    MAP_ENDPOINT,
    MAP_MAX_SQUARE_DEGREES,
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
[out:json][timeout:60];
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
[out:json][timeout:60];
(
  way["building"]({bbox});
  relation["building"]({bbox});
);
out body;
>;
out skel qt;
""".strip()
    highways = f"""
[out:json][timeout:60];
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
    attempts: int = 2,
    backoff: float = 3,
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
    tries = max(1, attempts)
    for endpoint in endpoints:
        response = None
        for attempt in range(tries):
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
                if attempt + 1 < tries and backoff:
                    time.sleep(backoff * (attempt + 1))
                    continue
                break
            if response.status_code in (429, 502, 503, 504) and attempt + 1 < tries:
                errors.append(f"{name} {endpoint}: HTTP {response.status_code}")
                if backoff:
                    time.sleep(backoff * (attempt + 1))
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
    timeout: float = 70,
    attempts: int = 2,
    backoff: float = 3,
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
        payload, meta = _download_query(
            name, query, cache_dir, refresh, endpoints, timeout, attempts, backoff,
        )
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
        "api": "Overpass API",
        "endpoint": records[-1].get("endpoint") if records else None,
        "retrievedAt": max((record.get("retrievedAt") or "" for record in records), default=None) or None,
        "querySha256": digest,
        "fromCache": all(record.get("fromCache") for record in records),
        "queries": records,
    }
    return combined, fetch


def _local_tag(element: ET.Element) -> str:
    return element.tag.split("}")[-1]


def parse_osm_map(content: bytes) -> dict:
    """Turn an OSM API 0.6 `/map` document into the element list Overpass uses."""
    try:
        root = ET.fromstring(content)
    except ET.ParseError as exc:
        raise ValueError(f"OSM map response was not XML ({exc})") from exc
    if _local_tag(root) == "error":
        message = " ".join(root.itertext()).strip()
        raise ValueError(message[:300] or "OSM API error")
    error = next((child for child in root if _local_tag(child) == "error"), None)
    if error is not None:
        message = " ".join(error.itertext()).strip()
        raise ValueError(message[:300] or "OSM API error")
    if _local_tag(root) != "osm":
        raise ValueError(f"OSM map response root was {root.tag!r}")

    elements = []
    timestamps = []
    for child in list(root):
        kind = _local_tag(child)
        if kind not in ("node", "way", "relation"):
            continue
        element: dict = {"type": kind, "id": int(child.attrib["id"])}
        if "version" in child.attrib:
            element["version"] = int(child.attrib["version"])
        if child.attrib.get("timestamp"):
            element["timestamp"] = child.attrib["timestamp"]
            timestamps.append(child.attrib["timestamp"])
        if kind == "node":
            element["lat"] = float(child.attrib["lat"])
            element["lon"] = float(child.attrib["lon"])
        elif kind == "way":
            element["nodes"] = [int(node.attrib["ref"]) for node in child if _local_tag(node) == "nd"]
        else:
            element["members"] = [
                {
                    "type": member.attrib.get("type"),
                    "ref": int(member.attrib["ref"]),
                    "role": member.attrib.get("role") or "",
                }
                for member in child
                if _local_tag(member) == "member"
            ]
        tags = {
            tag.attrib["k"]: tag.attrib["v"]
            for tag in child
            if _local_tag(tag) == "tag"
        }
        if tags:
            element["tags"] = tags
        elements.append(element)
    if not elements:
        raise ValueError("OSM map response contained no elements")

    copyright_text = root.attrib.get("copyright") or "© OpenStreetMap contributors"
    license_url = root.attrib.get("license") or ""
    if license_url and "odbl" not in copyright_text.lower():
        copyright_text = f"{copyright_text} (ODbL {license_url})"
    return {
        "elements": elements,
        "osm3s": {
            "timestamp_osm_base": min(timestamps) if timestamps else None,
            "copyright": copyright_text,
        },
    }


def fetch_osm_map(
    bbox: tuple[float, float, float, float],
    endpoint: str = MAP_ENDPOINT,
    timeout: float = 90,
    attempts: int = 2,
    backoff: float = 3,
) -> tuple[dict, dict]:
    """Download one bbox from the main OSM map API.

    `bbox` is `(west lon, south lat, east lon, north lat)`. The API allows at
    most 0.25 square degrees and asks callers to send a User-Agent.
    """
    west, south, east, north = bbox
    if west >= east or south >= north:
        raise RuntimeError(f"OSM map bbox is empty: {bbox}")
    area = (east - west) * (north - south)
    if area > MAP_MAX_SQUARE_DEGREES:
        raise RuntimeError(
            f"OSM map bbox covers {area:.4f} square degrees, "
            f"above the {MAP_MAX_SQUARE_DEGREES} limit."
        )
    box = f"{west:.6f},{south:.6f},{east:.6f},{north:.6f}"
    headers = {"User-Agent": USER_AGENT}
    errors: list[str] = []
    tries = max(1, attempts)
    for attempt in range(tries):
        print(f"Fetching map from {endpoint} bbox {box} (attempt {attempt + 1})", file=sys.stderr)
        try:
            response = requests.get(endpoint, params={"bbox": box}, headers=headers, timeout=timeout)
        except requests.RequestException as exc:
            errors.append(f"{endpoint}: {exc}")
            if attempt + 1 < tries and backoff:
                time.sleep(backoff * (attempt + 1))
            continue
        if response.status_code != 200:
            errors.append(f"{endpoint}: HTTP {response.status_code} {response.text[:160]}")
            if response.status_code in (429, 502, 503, 504) and attempt + 1 < tries and backoff:
                time.sleep(backoff * (attempt + 1))
                continue
            break
        try:
            payload = parse_osm_map(response.content)
        except ValueError as exc:
            errors.append(f"{endpoint}: {exc}")
            if attempt + 1 < tries and backoff:
                time.sleep(backoff * (attempt + 1))
            continue
        retrieved = _now()
        digest = hashlib.sha256(box.encode("utf-8")).hexdigest()
        record = {
            "api": "OSM API 0.6 map",
            "name": "map",
            "endpoint": endpoint,
            "retrievedAt": retrieved,
            "querySha256": digest,
            "fromCache": False,
            "bbox": [west, south, east, north],
            "bytes": len(response.content),
        }
        fetch = {
            "api": "OSM API 0.6 map",
            "endpoint": endpoint,
            "retrievedAt": retrieved,
            "querySha256": digest,
            "fromCache": False,
            "bbox": [west, south, east, north],
            "queries": [record],
        }
        return payload, fetch
    raise RuntimeError("OSM map request failed. " + " | ".join(errors))


def fetch_resort(
    cache_dir: Path,
    refresh: bool = False,
    endpoints: tuple[str, ...] = OVERPASS_ENDPOINTS,
    timeout: float = 70,
    attempts: int = 2,
    backoff: float = 3,
    map_fallback: bool = True,
    map_bbox: tuple[float, float, float, float] | None = None,
    map_endpoint: str = MAP_ENDPOINT,
) -> tuple[dict, dict]:
    """Overpass across mirrors, then the OSM map API for `map_bbox`."""
    try:
        return fetch_overpass(
            cache_dir,
            refresh=refresh,
            endpoints=endpoints,
            timeout=timeout,
            attempts=attempts,
            backoff=backoff,
        )
    except RuntimeError as exc:
        if not map_fallback:
            raise
        if map_bbox is None:
            raise RuntimeError(f"{exc} Map fallback needs a bbox.") from exc
        print(f"Overpass failed; trying the OSM map API ({exc})", file=sys.stderr)
        try:
            return fetch_osm_map(
                map_bbox,
                endpoint=map_endpoint,
                timeout=max(timeout, 90),
                attempts=attempts,
                backoff=backoff,
            )
        except RuntimeError as map_error:
            raise RuntimeError(f"{map_error} | {exc}") from map_error


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
