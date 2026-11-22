"""Turn normalized OpenStreetMap elements into the game feature document."""

from __future__ import annotations

import math
from collections import defaultdict
from datetime import datetime, timezone

from .constants import (
    BOUNDARY_WAY_ID,
    DOCUMENTED_DOWNHILL_NAME,
    DOCUMENTED_DOWNHILL_WAYS,
    QUICKDRAW_WAY_ID,
    ROAD_CLASSES,
)
from .geometry import distance_to_polygon, line_within_buffer
from .transform import Origin, local_from_lonlat, transform_metadata


def _timestamp() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def _round_point(osm_id: int, x: float, y: float | None, z: float) -> dict:
    return {
        "osmId": osm_id,
        "x": round(x, 2),
        "y": None if y is None else round(y, 2),
        "z": round(z, 2),
    }


def _tags(element: dict) -> dict:
    return dict(element.get("tags") or {})


def _feature_id(element_type: str, osm_id: int) -> str:
    return f"{element_type}/{osm_id}"


def _sample(sampler, x: float, z: float, origin: Origin) -> float | None:
    if sampler is None:
        return None
    value = sampler.sample(x, z, origin)
    if value is None or not math.isfinite(value):
        return None
    return value


class _Projector:
    def __init__(self, nodes: dict, origin: Origin, sampler):
        self.nodes = nodes
        self.origin = origin
        self.sampler = sampler
        self.sampled = 0
        self.unsampled = 0
        self._cache: dict[int, dict] = {}

    def point(self, node_id: int) -> dict:
        cached = self._cache.get(node_id)
        if cached is not None:
            return dict(cached)
        node = self.nodes.get(node_id)
        if node is None or "lat" not in node or "lon" not in node:
            raise ValueError(f"OSM node {node_id} has no coordinates")
        x, _, z = local_from_lonlat(node["lon"], node["lat"], self.origin)
        y = _sample(self.sampler, x, z, self.origin)
        if y is None:
            self.unsampled += 1
        else:
            self.sampled += 1
        cached = _round_point(node_id, x, y, z)
        self._cache[node_id] = cached
        return dict(cached)

    def points(self, node_ids: list[int], flip: bool = False) -> list[dict]:
        ordered = list(reversed(node_ids)) if flip else list(node_ids)
        return [self.point(node_id) for node_id in ordered]


def _closed(node_ids: list[int]) -> bool:
    return len(node_ids) >= 4 and node_ids[0] == node_ids[-1]


def _way_geometry(tags: dict, node_ids: list[int], kind: str) -> str:
    if tags.get("area") == "yes":
        return "area"
    if tags.get("area") == "no":
        return "line"
    if kind == "building" or (kind == "boundary" and _closed(node_ids)):
        return "area"
    return "line"


def _ring_xz(points: list[dict]) -> list[tuple[float, float]]:
    return [(point["x"], point["z"]) for point in points]


def _select_boundary(ways: dict, relations: dict) -> tuple[dict, str]:
    way = ways.get(BOUNDARY_WAY_ID)
    tags = _tags(way) if way else {}
    if way and tags.get("landuse") == "winter_sports":
        return way, "way"
    named = []
    for element in (*ways.values(), *relations.values()):
        element_tags = _tags(element)
        name = element_tags.get("name") or ""
        if element_tags.get("landuse") == "winter_sports" and "apex" in name.lower():
            named.append(element)
    if len(named) == 1:
        kind = "way" if named[0] in ways.values() or named[0].get("nodes") else "relation"
        return named[0], kind
    if way:
        raise ValueError(
            f"Way {BOUNDARY_WAY_ID} is not landuse=winter_sports "
            f"(tags: {tags or 'missing'})."
        )
    raise ValueError(
        f"Resort boundary way {BOUNDARY_WAY_ID} was not in the Overpass response, "
        "and no landuse=winter_sports feature named Apex was found."
    )


def _boundary_rings(boundary: dict, kind: str, ways: dict, projector: _Projector):
    if kind == "way" or boundary.get("nodes"):
        points = projector.points(boundary["nodes"])
        return [_ring_xz(points)], [], [points]
    outers, inners = [], []
    outer_points, inner_points = [], []
    for member in boundary.get("members") or []:
        if member.get("type") != "way":
            continue
        way = ways.get(member["ref"])
        if not way:
            continue
        role = member.get("role") or "outer"
        ring = projector.points(way["nodes"])
        target = inners if role == "inner" else outers
        target.append(_ring_xz(ring))
        (inner_points if role == "inner" else outer_points).append(ring)
    if not outers:
        raise ValueError("Resort boundary relation has no outer rings")
    return outers, inners, outer_points


def _name_notes(element_type: str, osm_id: int, name: str | None, kind: str) -> list[str]:
    if not name:
        return []
    notes = []
    if "chiar" in name.lower():
        notes.append(f"{element_type}/{osm_id} {kind} name is {name!r}.")
    connectors = {"of", "the", "and", "de", "du", "la", "le"}
    for word in name.split():
        bare = word.strip("'\u2019").lower()
        if bare in connectors or not word.isalpha():
            continue
        if word[:1].islower():
            notes.append(
                f"{element_type}/{osm_id} {kind} name {name!r} has an internal lowercase word {word!r}."
            )
            break
    return notes


def _shared_value(members: list[dict], key: str):
    values = {member[key] for member in members}
    if len(values) == 1:
        return members[0][key]
    return None


def _vector(start: dict, end: dict) -> tuple[float, float] | None:
    dx, dz = end["x"] - start["x"], end["z"] - start["z"]
    if dx == 0 and dz == 0:
        return None
    return dx, dz


def _dot(left: tuple[float, float], right: tuple[float, float]) -> float:
    left_len = math.hypot(*left)
    right_len = math.hypot(*right)
    if left_len == 0 or right_len == 0:
        return 0.0
    return (left[0] * right[0] + left[1] * right[1]) / (left_len * right_len)


def _component_count(ways: list[dict]) -> int:
    adjacent: dict[int, set[int]] = defaultdict(set)
    for index, way in enumerate(ways):
        ends = {way["nodes"][0], way["nodes"][-1]}
        for other_index in range(index + 1, len(ways)):
            other_ends = {ways[other_index]["nodes"][0], ways[other_index]["nodes"][-1]}
            if ends & other_ends:
                adjacent[index].add(other_index)
                adjacent[other_index].add(index)
    seen: set[int] = set()
    count = 0
    for index in range(len(ways)):
        if index in seen:
            continue
        count += 1
        stack = [index]
        while stack:
            current = stack.pop()
            if current in seen:
                continue
            seen.add(current)
            stack.extend(adjacent[current])
    return count


def _walk_path(ways: list[dict]) -> list[tuple[dict, bool]] | None:
    adjacent: dict[int, list[int]] = defaultdict(list)
    for index, way in enumerate(ways):
        adjacent[way["nodes"][0]].append(index)
        adjacent[way["nodes"][-1]].append(index)
    odds = [node for node, refs in adjacent.items() if len(refs) == 1]
    if len(odds) != 2 or any(len(refs) > 2 for refs in adjacent.values()):
        return None

    def walk(start: int) -> list[tuple[dict, bool]] | None:
        ordered = []
        used: set[int] = set()
        current = start
        while len(ordered) < len(ways):
            choices = [index for index in adjacent[current] if index not in used]
            if len(choices) != 1:
                return None
            index = choices[0]
            way = ways[index]
            flip = way["nodes"][0] != current
            if flip and way["nodes"][-1] != current:
                return None
            used.add(index)
            ordered.append((way, flip))
            current = way["nodes"][0] if flip else way["nodes"][-1]
        return ordered

    candidates = [walk(node) for node in odds]
    candidates = [candidate for candidate in candidates if candidate]
    if not candidates:
        return None

    def score(ordered: list[tuple[dict, bool]]):
        flips = sum(1 for _, flip in ordered if flip)
        return flips, ordered[0][0]["id"]

    return min(candidates, key=score)


def _apply_documented(ways: list[dict]) -> list[tuple[dict, bool]] | None:
    by_id = {way["id"]: way for way in ways}
    if set(by_id) != set(DOCUMENTED_DOWNHILL_WAYS):
        return None
    ordered = []
    previous_end = None
    for way_id in DOCUMENTED_DOWNHILL_WAYS:
        way = by_id[way_id]
        if previous_end is None:
            ordered.append((way, False))
            previous_end = way["nodes"][-1]
            continue
        if way["nodes"][0] == previous_end:
            ordered.append((way, False))
            previous_end = way["nodes"][-1]
        elif way["nodes"][-1] == previous_end:
            ordered.append((way, True))
            previous_end = way["nodes"][0]
        else:
            return None
    return ordered


def _continuation(ordered: list[tuple[dict, bool]], projector: _Projector) -> bool:
    sequences = []
    for way, flip in ordered:
        node_ids = list(reversed(way["nodes"])) if flip else list(way["nodes"])
        sequences.append([projector.point(node_id) for node_id in node_ids])
    for left, right in zip(sequences, sequences[1:]):
        if len(left) < 2 or len(right) < 2:
            return False
        incoming = _vector(left[-2], left[-1])
        outgoing = _vector(right[0], right[1])
        if incoming is None or outgoing is None or _dot(incoming, outgoing) < 0:
            return False
    return True


def _endpoint_height(points: list[dict], at_end: bool) -> float | None:
    ordered = list(reversed(points)) if at_end else points
    for point in ordered:
        if point["y"] is not None:
            return point["y"]
    return None


def _reverse_order(ordered: list[tuple[dict, bool]]) -> list[tuple[dict, bool]]:
    return [(way, not flip) for way, flip in reversed(ordered)]


def _member_points(way: dict, flip: bool, projector: _Projector) -> list[dict]:
    return projector.points(way["nodes"], flip)


def _concat(parts: list[list[dict]]) -> list[dict]:
    line: list[dict] = []
    for part in parts:
        if line and part and line[-1]["osmId"] == part[0]["osmId"]:
            line.extend(part[1:])
        else:
            line.extend(part)
    return line


def _orient_downhill(ordered: list[tuple[dict, bool]], projector: _Projector, documented: bool):
    parts = [_member_points(way, flip, projector) for way, flip in ordered]
    line = _concat(parts)
    start_y = _endpoint_height(line, at_end=False)
    end_y = _endpoint_height(line, at_end=True)
    contradiction = False
    if start_y is not None and end_y is not None and abs(end_y - start_y) > 1:
        descends = start_y > end_y
        if documented:
            contradiction = not descends
            return ordered, True, "documented-way-sequence", contradiction
        if not descends:
            ordered = _reverse_order(ordered)
        return ordered, True, "height-grid", False
    if documented:
        return ordered, True, "documented-way-sequence", False
    return ordered, False, "openstreetmap", False


def _way_record(way: dict, flip: bool, projector: _Projector, kind: str) -> dict:
    tags = _tags(way)
    points = _member_points(way, flip, projector)
    return {
        "id": _feature_id("way", way["id"]),
        "osmType": "way",
        "osmId": way["id"],
        "osmVersion": way.get("version"),
        "name": tags.get("name"),
        "difficulty": tags.get("piste:difficulty"),
        "grooming": tags.get("piste:grooming"),
        "geometry": _way_geometry(tags, way["nodes"], kind),
        "reversed": flip,
        "tags": tags,
        "points": points,
    }


def _group_linear_features(ways: list[dict], projector: _Projector, kind: str) -> list[dict]:
    groups: dict[tuple, list[dict]] = defaultdict(list)
    for way in ways:
        name = _tags(way).get("name")
        key = ("name", name) if name else ("way", way["id"])
        groups[key].append(way)
    def group_sort(item):
        if item[0] == "name":
            return (0, str(item[1]).lower(), 0)
        return (1, "", item[1])

    features = []
    for key in sorted(groups, key=group_sort):
        members = groups[key]
        documented = _apply_documented(members)
        documented_failed = (
            documented is None and {way["id"] for way in members} == set(DOCUMENTED_DOWNHILL_WAYS)
        )
        if documented is not None:
            ordered = documented
            topology = "path"
        elif len(members) == 1:
            ordered = [(members[0], False)]
            topology = "path"
        else:
            components = _component_count(members)
            walked = _walk_path(members) if components == 1 else None
            if walked and _continuation(walked, projector):
                ordered = walked
                topology = "path"
            elif components > 1:
                ordered = [(way, False) for way in sorted(members, key=lambda way: way["id"])]
                topology = "separate"
            else:
                ordered = [(way, False) for way in sorted(members, key=lambda way: way["id"])]
                topology = "branches"
        if topology == "path":
            ordered, downhill, source, contradiction = _orient_downhill(
                ordered, projector, documented is not None,
            )
        else:
            downhill, source, contradiction = False, "none", False
        records = [_way_record(way, flip, projector, kind) for way, flip in ordered]
        name = key[1] if key[0] == "name" else None
        feature = {
            "name": name,
            "difficulty": _shared_value(records, "difficulty"),
            "grooming": _shared_value(records, "grooming"),
            "geometry": records[0]["geometry"] if len({item["geometry"] for item in records}) == 1 else "mixed",
            "topology": topology,
            "orderedDownhill": downhill,
            "orderSource": source,
            "members": records,
        }
        if topology == "path":
            feature["points"] = _concat([record["points"] for record in records])
        if documented is not None:
            feature["documentedSequence"] = list(DOCUMENTED_DOWNHILL_WAYS)
        if documented_failed:
            feature["documentedSequenceMismatch"] = True
        if contradiction:
            feature["downhillContradiction"] = True
        features.append(feature)
    return features


def _relation_members(relation: dict, ways: dict) -> list[dict]:
    ordered = []
    for member in relation.get("members") or []:
        if member.get("type") != "way":
            continue
        way = ways.get(member["ref"])
        if way:
            ordered.append(way)
    return ordered


def _piste_ways(ways: dict, piste_type: str) -> list[dict]:
    return [
        way for way in ways.values()
        if _tags(way).get("piste:type") == piste_type
    ]


def _consume_relations(relations: dict, ways: dict, piste_type: str) -> tuple[list[list[dict]], set[int]]:
    groups = []
    used: set[int] = set()
    for relation in relations.values():
        tags = _tags(relation)
        if tags.get("piste:type") != piste_type:
            continue
        members = _relation_members(relation, ways)
        if not members:
            continue
        groups.append(members)
        used.update(way["id"] for way in members)
    return groups, used


def _build_runs_and_parks(data: dict, projector: _Projector, outer, inners, buffer_metres: float):
    ways = data["ways"]
    relations = data["relations"]
    outside = []

    def keep(way: dict) -> bool:
        points = _ring_xz(projector.points(way["nodes"]))
        return line_within_buffer(points, outer, inners, buffer_metres)

    runs = []
    parks = []
    for piste_type, target in (("downhill", runs), ("snow_park", parks)):
        relation_groups, used = _consume_relations(relations, ways, piste_type)
        loose = [
            way for way in _piste_ways(ways, piste_type)
            if way["id"] not in used
        ]
        kept_groups = []
        for group in relation_groups:
            if any(keep(way) for way in group):
                kept_groups.append(group)
            else:
                outside.extend(group)
        kept = [way for way in loose if keep(way)]
        kept_ids = {way["id"] for way in kept}
        outside.extend(way for way in loose if way["id"] not in kept_ids)
        features = _group_linear_features(kept, projector, "run" if piste_type == "downhill" else "park")
        for group in kept_groups:
            features.extend(_group_linear_features(group, projector, "run"))
        target.extend(features)
    runs.sort(key=lambda feature: ((feature["name"] or "").lower(), feature["members"][0]["osmId"]))
    parks.sort(key=lambda feature: ((feature["name"] or "").lower(), feature["members"][0]["osmId"]))
    return runs, parks, outside


def _node_kind(node: dict | None) -> str:
    aerialway = _tags(node or {}).get("aerialway")
    if aerialway == "station":
        return "station"
    if aerialway == "pylon":
        return "pylon"
    return "vertex"


def _build_lift(way: dict, projector: _Projector, nodes: dict) -> dict:
    tags = _tags(way)
    line = []
    for node_id in way["nodes"]:
        point = dict(projector.point(node_id))
        point["kind"] = _node_kind(nodes.get(node_id))
        line.append(point)
    stations = [point for point in line if point["kind"] == "station"]
    if len(stations) < 2 and len(line) >= 2:
        for index in (0, len(line) - 1):
            if line[index]["kind"] != "station":
                line[index]["kind"] = "station"
                line[index]["inferred"] = True
        stations = [point for point in line if point["kind"] == "station"]
    for point in line:
        point.setdefault("inferred", False)
    towers = [point for point in line if point["kind"] == "pylon"]
    ordered_bottom_to_top = False
    if len(stations) >= 2:
        start_y, end_y = stations[0]["y"], stations[-1]["y"]
        if start_y is not None and end_y is not None and abs(end_y - start_y) > 1:
            if start_y > end_y:
                line.reverse()
                for point in line:
                    point.pop("index", None)
                stations = [point for point in line if point["kind"] == "station"]
                towers = [point for point in line if point["kind"] == "pylon"]
            stations[0]["role"] = "bottom"
            stations[-1]["role"] = "top"
            for station in stations[1:-1]:
                station["role"] = "middle"
            ordered_bottom_to_top = True
        else:
            stations[0]["role"] = "start"
            stations[-1]["role"] = "end"
            for station in stations[1:-1]:
                station["role"] = "middle"
    for index, tower in enumerate(towers):
        tower["index"] = index
    station_records = [
        {
            "osmId": station["osmId"],
            "role": station.get("role"),
            "inferred": bool(station.get("inferred")),
            "x": station["x"],
            "y": station["y"],
            "z": station["z"],
        }
        for station in stations
    ]
    tower_records = [
        {
            "osmId": tower["osmId"],
            "index": tower["index"],
            "x": tower["x"],
            "y": tower["y"],
            "z": tower["z"],
        }
        for tower in towers
    ]
    line_records = [
        {
            "osmId": point["osmId"],
            "kind": point["kind"],
            "x": point["x"],
            "y": point["y"],
            "z": point["z"],
        }
        for point in line
    ]
    return {
        "id": _feature_id("way", way["id"]),
        "osmType": "way",
        "osmId": way["id"],
        "osmVersion": way.get("version"),
        "name": tags.get("name"),
        "aerialway": tags.get("aerialway"),
        "orderedBottomToTop": ordered_bottom_to_top,
        "tags": tags,
        "stations": station_records,
        "towers": tower_records,
        "line": line_records,
    }


def _build_lifts(data: dict, projector: _Projector, outer, inners, buffer_metres: float):
    kept, outside = [], []
    for way in data["ways"].values():
        aerialway = _tags(way).get("aerialway")
        if aerialway in (None, "pylon", "station") or len(way.get("nodes") or []) < 2:
            continue
        points = _ring_xz(projector.points(way["nodes"]))
        if line_within_buffer(points, outer, inners, buffer_metres):
            kept.append(way)
        else:
            outside.append(way)
    lifts = [_build_lift(way, projector, data["nodes"]) for way in kept]
    lifts.sort(key=lambda lift: ((lift["name"] or "").lower(), lift["osmId"]))
    relations = [
        relation for relation in data["relations"].values()
        if _tags(relation).get("route") == "aerialway" or _tags(relation).get("aerialway")
    ]
    return lifts, outside, relations


def _build_areas(data: dict, projector: _Projector, outer, inners, buffer_metres: float, kind: str):
    features = []
    skipped: dict[str, int] = defaultdict(int)
    for way in data["ways"].values():
        tags = _tags(way)
        if kind == "building":
            if "building" not in tags or tags.get("building") == "no":
                continue
        else:
            highway = tags.get("highway")
            if not highway:
                continue
            points = _ring_xz(projector.points(way["nodes"]))
            if not line_within_buffer(points, outer, inners, buffer_metres):
                continue
            if highway not in ROAD_CLASSES:
                skipped[highway] += 1
                continue
        if kind == "building":
            points = _ring_xz(projector.points(way["nodes"]))
            if not line_within_buffer(points, outer, inners, buffer_metres):
                continue
        geometry = _way_geometry(tags, way["nodes"], kind)
        features.append({
            "id": _feature_id("way", way["id"]),
            "osmType": "way",
            "osmId": way["id"],
            "osmVersion": way.get("version"),
            "name": tags.get("name"),
            "building": tags.get("building") if kind == "building" else None,
            "highway": tags.get("highway") if kind == "road" else None,
            "geometry": geometry,
            "tags": tags,
            "points": projector.points(way["nodes"]),
        })
        if kind == "road":
            features[-1].pop("building")
        else:
            features[-1].pop("highway")
    features.sort(key=lambda feature: feature["osmId"])
    return features, dict(sorted(skipped.items()))


def _build_peaks(data: dict, projector: _Projector, outer, inners, buffer_metres: float):
    inside, outside = [], []
    for node in data["nodes"].values():
        tags = _tags(node)
        if tags.get("natural") != "peak" or not tags.get("name"):
            continue
        point = projector.point(node["id"])
        distance = distance_to_polygon((point["x"], point["z"]), outer, inners)
        ele = tags.get("ele")
        try:
            ele_value = float(ele) if ele is not None else None
        except ValueError:
            ele_value = None
        record = {
            "id": _feature_id("node", node["id"]),
            "osmType": "node",
            "osmId": node["id"],
            "name": tags.get("name"),
            "ele": ele_value,
            "x": point["x"],
            "y": point["y"],
            "z": point["z"],
            "tags": tags,
        }
        if distance <= buffer_metres:
            inside.append(record)
        else:
            record["distanceMetres"] = round(distance, 1)
            outside.append(record)
    inside.sort(key=lambda peak: peak["name"])
    outside.sort(key=lambda peak: peak["distanceMetres"])
    return inside, outside


def _boundary_feature(boundary: dict, kind: str, outer_points) -> dict:
    tags = _tags(boundary)
    element_type = "relation" if kind == "relation" else "way"
    feature = {
        "id": _feature_id(element_type, boundary["id"]),
        "osmType": element_type,
        "osmId": boundary["id"],
        "osmVersion": boundary.get("version"),
        "name": tags.get("name"),
        "geometry": "area",
        "tags": tags,
    }
    if len(outer_points) == 1:
        feature["points"] = outer_points[0]
    else:
        feature["rings"] = [{"role": "outer", "points": ring} for ring in outer_points]
    return feature


def validate_document(document: dict) -> list[str]:
    """Return structural problems. An empty list means the document matches version 1."""
    errors = []
    if document.get("version") != 1:
        errors.append("version must be 1")
    source = document.get("source") or {}
    if "OpenStreetMap" not in str(source.get("attribution", "")):
        errors.append("source.attribution must credit OpenStreetMap")
    if "ODbL" not in str(source.get("license", "")):
        errors.append("source.license must name ODbL")
    crs = document.get("crs") or {}
    if crs.get("horizontal") != "EPSG:2955" or crs.get("vertical") != "EPSG:6647":
        errors.append("crs must be EPSG:2955 and EPSG:6647")
    transform = document.get("transform") or {}
    for key in ("originEasting", "originNorthing", "originElevation"):
        if not isinstance(transform.get(key), (int, float)):
            errors.append(f"transform.{key} must be a number")
    axes = str(transform.get("axes", ""))
    if "+X east" not in axes or "+Z south" not in axes:
        errors.append("transform.axes must describe +X east and +Z south")
    boundary = document.get("boundary") or {}
    if not isinstance(boundary.get("osmId"), int) or not boundary.get("points") and not boundary.get("rings"):
        errors.append("boundary needs an osmId and a ring")
    for group in ("runs", "terrainParks", "lifts", "buildings", "roads", "peaks"):
        if not isinstance(document.get(group), list):
            errors.append(f"{group} must be a list")
    for run in document.get("runs") or []:
        if not run.get("members"):
            errors.append("run missing members")
            continue
        for member in run["members"]:
            if not isinstance(member.get("osmId"), int) or not member.get("points"):
                errors.append(f"run member {member.get('id')} needs osmId and points")
            for point in member.get("points") or []:
                if not {"osmId", "x", "y", "z"} <= set(point):
                    errors.append("run point is missing coordinates")
                    break
    for lift in document.get("lifts") or []:
        if len(lift.get("stations") or []) < 2:
            errors.append(f"lift {lift.get('id')} needs both stations")
        if not isinstance(lift.get("towers"), list):
            errors.append(f"lift {lift.get('id')} needs a towers list")
    return errors


def build_features(
    data: dict,
    origin: Origin,
    sampler=None,
    buffer_metres: float = 50,
    fetch: dict | None = None,
    heights_meta: dict | None = None,
) -> dict:
    """Assemble the version 1 feature document. sampler.sample(x, z, origin) may be None."""
    projector = _Projector(data["nodes"], origin, sampler)
    boundary, kind = _select_boundary(data["ways"], data["relations"])
    outers, inners, outer_points = _boundary_rings(boundary, kind, data["ways"], projector)
    outer = outers[0]
    runs, parks, outside_pistes = _build_runs_and_parks(
        data, projector, outer, inners, buffer_metres,
    )
    lifts, outside_lifts, lift_relations = _build_lifts(
        data, projector, outer, inners, buffer_metres,
    )
    buildings, _skipped_buildings = _build_areas(
        data, projector, outer, inners, buffer_metres, "building",
    )
    roads, skipped_highways = _build_areas(
        data, projector, outer, inners, buffer_metres, "road",
    )
    peaks, outside_peaks = _build_peaks(data, projector, outer, inners, buffer_metres)

    notes = []
    for feature in (*runs, *parks):
        for member in feature["members"]:
            notes.extend(_name_notes("way", member["osmId"], member.get("name"), "piste"))
    for lift in lifts:
        notes.extend(_name_notes("way", lift["osmId"], lift.get("name"), "lift"))
    for peak in peaks:
        notes.extend(_name_notes("node", peak["osmId"], peak.get("name"), "peak"))
    contradictions = [feature["name"] for feature in runs if feature.get("downhillContradiction")]
    if contradictions:
        notes.append(
            "Height samples disagree with the documented downhill order for: "
            + ", ".join(contradictions)
            + "."
        )
    quickdraw = next((lift for lift in lifts if lift["osmId"] == QUICKDRAW_WAY_ID), None)
    run_ids = {member["osmId"] for run in runs for member in run["members"]}
    road_and_run = sorted(road["osmId"] for road in roads if road["osmId"] in run_ids)
    boundary_tags = _tags(boundary)
    document = {
        "version": 1,
        "generator": "ski-scrapex-osm-export",
        "generatedAt": _timestamp(),
        "source": {
            "name": "OpenStreetMap",
            "api": (fetch or {}).get("api") or "Overpass API",
            "endpoint": (fetch or {}).get("endpoint"),
            "retrievedAt": (fetch or {}).get("retrievedAt"),
            "fromCache": bool((fetch or {}).get("fromCache")),
            "querySha256": (fetch or {}).get("querySha256"),
            "osmTimestamp": data.get("osmTimestamp"),
            "queries": [
                {
                    "name": record.get("name"),
                    "osmTimestamp": record.get("osmTimestamp"),
                    "querySha256": record.get("querySha256"),
                    "fromCache": record.get("fromCache"),
                }
                for record in (fetch or {}).get("queries") or []
            ],
            "copyright": data.get("copyright"),
            "attribution": "© OpenStreetMap contributors",
            "license": "ODbL-1.0",
            "licenseUrl": "https://opendatacommons.org/licenses/odbl/1-0/",
        },
        "crs": {
            "horizontal": "EPSG:2955",
            "horizontalName": "NAD83(CSRS) / UTM zone 11N",
            "vertical": "EPSG:6647",
            "verticalName": "CGVD2013",
            "sourceHorizontal": "EPSG:4326",
            "note": (
                "OpenStreetMap lon/lat is transformed from EPSG:4326 to EPSG:2955 "
                "with easting/northing axis order, the same horizontal step as the terrain export. "
                "Y is metres above originElevation and is present only when a terrain height grid "
                "can be sampled. OSM ele tags are copied onto peaks and are not used as Y."
            ),
        },
        "transform": transform_metadata(origin),
        "heights": heights_meta or {
            "attached": False,
            "source": None,
            "sampledPoints": projector.sampled,
            "unsampledPoints": projector.unsampled,
        },
        "bufferMetres": buffer_metres,
        "verification": {
            "resortBoundary": {
                "expectedOsmId": BOUNDARY_WAY_ID,
                "expectedTag": "landuse=winter_sports",
                "found": boundary.get("id") == BOUNDARY_WAY_ID and boundary_tags.get("landuse") == "winter_sports",
                "osmId": boundary.get("id"),
                "name": boundary_tags.get("name"),
                "landuse": boundary_tags.get("landuse"),
            },
            "quickdraw": {
                "expectedOsmId": QUICKDRAW_WAY_ID,
                "found": quickdraw is not None and quickdraw.get("aerialway") == "chair_lift",
                "name": None if quickdraw is None else quickdraw.get("name"),
                "aerialway": None if quickdraw is None else quickdraw.get("aerialway"),
            },
            "grandfatherDownhillWays": list(DOCUMENTED_DOWNHILL_WAYS),
        },
        "counts": {},
        "quality": {
            "nameNotes": notes,
            "peaksOutsideBuffer": [
                {"osmId": peak["osmId"], "name": peak["name"], "distanceMetres": peak["distanceMetres"]}
                for peak in outside_peaks
            ],
            "pistesOutsideBuffer": [
                {"osmId": way["id"], "name": _tags(way).get("name"), "pisteType": _tags(way).get("piste:type")}
                for way in outside_pistes
            ],
            "liftsOutsideBuffer": [
                {"osmId": way["id"], "name": _tags(way).get("name")}
                for way in outside_lifts
            ],
            "highwaysSkipped": skipped_highways,
            "aerialwayRelations": len(lift_relations),
            "buildingRelations": sorted(
                relation["id"] for relation in data["relations"].values() if "building" in _tags(relation)
            ),
            "waysUsedAsRunAndRoad": road_and_run,
        },
        "boundary": _boundary_feature(boundary, kind, outer_points),
        "runs": runs,
        "terrainParks": parks,
        "lifts": lifts,
        "buildings": buildings,
        "roads": roads,
        "peaks": peaks,
    }
    if heights_meta is not None:
        document["heights"]["sampledPoints"] = projector.sampled
        document["heights"]["unsampledPoints"] = projector.unsampled
    document["counts"] = {
        "runs": len(runs),
        "runWays": sum(len(run["members"]) for run in runs),
        "runsOrderedDownhill": sum(1 for run in runs if run["orderedDownhill"]),
        "terrainParks": len(parks),
        "terrainParkWays": sum(len(park["members"]) for park in parks),
        "lifts": len(lifts),
        "stations": sum(len(lift["stations"]) for lift in lifts),
        "towers": sum(len(lift["towers"]) for lift in lifts),
        "buildings": len(buildings),
        "roads": len(roads),
        "peaks": len(peaks),
    }
    return document


def summarize(document: dict) -> str:
    """Plain-text report of what the export contains."""
    transform = document["transform"]
    heights = document["heights"]
    verification = document["verification"]
    boundary = verification["resortBoundary"]
    lines = [
        "Apex Mountain Resort OSM export",
        f"OSM timestamp: {document['source'].get('osmTimestamp')}",
        (
            f"Origin: E {transform['originEasting']} N {transform['originNorthing']} "
            f"elevation {transform['originElevation']} ({transform['originSource']})"
        ),
        (
            "Heights: attached"
            if heights.get("attached")
            else "Heights: not attached (Y is null)"
        ),
        (
            f"Boundary: {document['boundary']['id']} landuse={boundary.get('landuse')} "
            f"{boundary.get('name')!r}"
        ),
        (
            f"Runs: {document['counts']['runs']} groups from {document['counts']['runWays']} ways "
            f"({document['counts']['runsOrderedDownhill']} ordered downhill)"
        ),
        f"Terrain parks: {document['counts']['terrainParks']}",
        f"Lifts: {document['counts']['lifts']}",
    ]
    for lift in document["lifts"]:
        inferred = sum(1 for station in lift["stations"] if station["inferred"])
        station_note = f"{len(lift['stations'])}"
        if inferred:
            station_note += f" ({inferred} inferred)"
        lines.append(
            f"  {lift.get('name')} {lift.get('aerialway')} "
            f"stations={station_note} towers={len(lift['towers'])} "
            f"bottomToTop={lift['orderedBottomToTop']}"
        )
    lines.append(f"Buildings: {document['counts']['buildings']}")
    lines.append(f"Roads: {document['counts']['roads']}")
    lines.append("Peaks: " + ", ".join(peak["name"] for peak in document["peaks"]))
    skipped = document["quality"]["highwaysSkipped"]
    if skipped:
        detail = ", ".join(f"{name} {count}" for name, count in skipped.items())
        lines.append(f"Highways inside the buffer left out: {detail}")
    outside_pistes = document["quality"]["pistesOutsideBuffer"]
    if outside_pistes:
        lines.append(f"Pistes outside the buffer: {len(outside_pistes)}")
    outside = document["quality"]["peaksOutsideBuffer"]
    if outside:
        lines.append(
            "Peaks outside the buffer: "
            + ", ".join(f"{peak['name']} ({peak['distanceMetres']} m)" for peak in outside)
        )
    notes = document["quality"]["nameNotes"]
    if notes:
        lines.append("Name notes:")
        lines.extend(f"  {note}" for note in notes)
    else:
        lines.append("Name notes: none")
    return "\n".join(lines)
