"""Polygon tests in projected metres. No GEOS or GDAL dependency."""

from __future__ import annotations

import math


Point = tuple[float, float]


def point_in_ring(x: float, z: float, ring: list[Point]) -> bool:
    """Even-odd test. A closed ring may repeat its first point."""
    points = ring[:-1] if len(ring) >= 2 and ring[0] == ring[-1] else ring
    if len(points) < 3:
        return False
    inside = False
    for index in range(len(points)):
        x1, z1 = points[index]
        x2, z2 = points[(index + 1) % len(points)]
        if (z1 > z) != (z2 > z):
            cross_x = x1 + (x2 - x1) * (z - z1) / (z2 - z1)
            if x < cross_x:
                inside = not inside
    return inside


def distance_point_to_segment(point: Point, start: Point, end: Point) -> float:
    px, pz = point
    ax, az = start
    bx, bz = end
    dx, dz = bx - ax, bz - az
    length_sq = dx * dx + dz * dz
    if length_sq == 0:
        return math.hypot(px - ax, pz - az)
    offset = ((px - ax) * dx + (pz - az) * dz) / length_sq
    offset = max(0.0, min(1.0, offset))
    return math.hypot(px - (ax + offset * dx), pz - (az + offset * dz))


def _orient(a: Point, b: Point, c: Point) -> float:
    return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])


def _on_segment(start: Point, point: Point, end: Point) -> bool:
    return (
        min(start[0], end[0]) - 1e-9 <= point[0] <= max(start[0], end[0]) + 1e-9
        and min(start[1], end[1]) - 1e-9 <= point[1] <= max(start[1], end[1]) + 1e-9
    )


def segments_intersect(a: Point, b: Point, c: Point, d: Point) -> bool:
    o1, o2 = _orient(a, b, c), _orient(a, b, d)
    o3, o4 = _orient(c, d, a), _orient(c, d, b)
    if o1 * o2 < 0 and o3 * o4 < 0:
        return True
    if o1 == 0 and _on_segment(a, c, b):
        return True
    if o2 == 0 and _on_segment(a, d, b):
        return True
    if o3 == 0 and _on_segment(c, a, d):
        return True
    if o4 == 0 and _on_segment(c, b, d):
        return True
    return False


def distance_segment_to_segment(a: Point, b: Point, c: Point, d: Point) -> float:
    if segments_intersect(a, b, c, d):
        return 0.0
    return min(
        distance_point_to_segment(a, c, d),
        distance_point_to_segment(b, c, d),
        distance_point_to_segment(c, a, b),
        distance_point_to_segment(d, a, b),
    )


def _edges(ring: list[Point]) -> list[tuple[Point, Point]]:
    if len(ring) < 2:
        return []
    if ring[0] == ring[-1]:
        pairs = zip(ring, ring[1:])
    else:
        pairs = ((ring[index], ring[(index + 1) % len(ring)]) for index in range(len(ring)))
    return [(start, end) for start, end in pairs if start != end]


def distance_to_polygon(point: Point, outer: list[Point], inners: list[list[Point]] | None = None) -> float:
    """Metres from a point to the polygon. Inside the filled area this is 0."""
    holes = inners or []
    in_outer = point_in_ring(point[0], point[1], outer)
    in_hole = any(point_in_ring(point[0], point[1], hole) for hole in holes)
    if in_outer and not in_hole:
        return 0.0
    distances = [
        distance_point_to_segment(point, start, end)
        for ring in (outer, *holes)
        for start, end in _edges(ring)
    ]
    if not distances:
        return math.inf
    return min(distances)


def line_within_buffer(
    line: list[Point],
    outer: list[Point],
    inners: list[list[Point]] | None,
    buffer_metres: float,
) -> bool:
    """True when any part of the line meets the polygon expanded by buffer_metres."""
    if len(line) == 0:
        return False
    holes = inners or []
    if len(line) == 1:
        return distance_to_polygon(line[0], outer, holes) <= buffer_metres
    edges = _edges(outer) + [edge for hole in holes for edge in _edges(hole)]
    for index in range(len(line) - 1):
        start, end = line[index], line[index + 1]
        if start == end:
            if distance_to_polygon(start, outer, holes) <= buffer_metres:
                return True
            continue
        if distance_to_polygon(start, outer, holes) <= buffer_metres:
            return True
        for edge_start, edge_end in edges:
            if distance_segment_to_segment(start, end, edge_start, edge_end) <= buffer_metres:
                return True
    return distance_to_polygon(line[-1], outer, holes) <= buffer_metres
