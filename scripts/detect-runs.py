"""Find cleared ski-run corridors in the LiDAR canopy that OpenStreetMap does not map.

Reads the generated data (terrain.json, heights.f32, canopy-cover.u8,
features.json) from a data directory and writes candidate centrelines in
local metres. Used to build the curated overlay in game/src/world/runOverlay.ts;
the candidates are reviewed and named by hand, not loaded directly.

    python3 scripts/detect-runs.py game/public/data out.json [preview.png]
"""
import json
import sys

import numpy as np
from scipy import ndimage
from skimage.morphology import skeletonize

STEP = 5


def rasterize_lines(lines, shape, radius_m):
    mask = np.zeros(shape, bool)
    rows, cols = shape
    for pts in lines:
        for (x0, z0), (x1, z1) in zip(pts, pts[1:]):
            n = max(2, int(np.hypot(x1 - x0, z1 - z0) / 2))
            for t in np.linspace(0, 1, n):
                c = int(round((x0 + (x1 - x0) * t) / STEP))
                r = int(round((z0 + (z1 - z0) * t) / STEP))
                if 0 <= r < rows and 0 <= c < cols:
                    mask[r, c] = True
    return ndimage.binary_dilation(mask, iterations=max(1, int(round(radius_m / STEP))))


def point_in_poly(x, z, poly):
    inside = np.zeros(x.shape, bool)
    j = len(poly) - 1
    for i in range(len(poly)):
        xi, zi = poly[i]
        xj, zj = poly[j]
        cross = ((zi > z) != (zj > z)) & (x < (xj - xi) * (z - zi) / (zj - zi + 1e-12) + xi)
        inside ^= cross
        j = i
    return inside


def longest_path(skel):
    """Longest geodesic path through a skeleton: two breadth-first sweeps."""
    pts = set(zip(*np.nonzero(skel)))
    if not pts:
        return []

    def bfs(start):
        prev = {start: None}
        dist = {start: 0.0}
        frontier = [start]
        while frontier:
            nxt = []
            for p in frontier:
                for dr in (-1, 0, 1):
                    for dc in (-1, 0, 1):
                        q = (p[0] + dr, p[1] + dc)
                        if q in pts and q not in dist:
                            dist[q] = dist[p] + np.hypot(dr, dc)
                            prev[q] = p
                            nxt.append(q)
            frontier = nxt
        end = max(dist, key=dist.get)
        return end, prev, dist[end]

    a, _, _ = bfs(next(iter(pts)))
    b, prev, length = bfs(a)
    path = []
    p = b
    while p is not None:
        path.append(p)
        p = prev[p]
    return path, length * STEP


def simplify(points, tolerance):
    if len(points) < 3:
        return points
    a, b = np.array(points[0]), np.array(points[-1])
    ab = b - a
    denom = np.hypot(*ab) or 1e-9
    dists = [abs(ab[0] * (p[1] - a[1]) - ab[1] * (p[0] - a[0])) / denom for p in points[1:-1]]
    i = int(np.argmax(dists)) + 1
    if dists[i - 1] > tolerance:
        return simplify(points[: i + 1], tolerance)[:-1] + simplify(points[i:], tolerance)
    return [points[0], points[-1]]


def main():
    data, out = sys.argv[1], sys.argv[2]
    preview = sys.argv[3] if len(sys.argv) > 3 else None
    m = json.load(open(f'{data}/terrain.json'))
    rows, cols = m['rows'], m['columns']
    heights = np.fromfile(f'{data}/heights.f32', '<f4').reshape(rows, cols)
    cover = np.fromfile(f'{data}/canopy-cover.u8', 'u1').reshape(rows, cols) / 255
    f = json.load(open(f'{data}/features.json'))

    def lines(items):
        return [[(p['x'], p['z']) for p in mb['points']] for it in items for mb in it.get('members', [it]) if len(mb.get('points', [])) > 1]

    runs = lines(f['runs'])
    lifts = [[(p['x'], p['z']) for p in l['line']['points']] if isinstance(l['line'], dict) else [(p['x'], p['z']) for p in l['line']] for l in f['lifts']]
    roads = lines(f['roads'])
    buildings = lines(f['buildings'])
    taken = rasterize_lines(runs, (rows, cols), 20) | rasterize_lines(lifts, (rows, cols), 14) \
        | rasterize_lines(roads, (rows, cols), 10) | rasterize_lines(buildings, (rows, cols), 12)

    zz, xx = np.mgrid[0:rows, 0:cols] * STEP
    boundary = [(p['x'], p['z']) for p in f['boundary']['points']]
    inside = point_in_poly(xx.astype(float), zz.astype(float), boundary)

    smooth = ndimage.median_filter(cover, size=3)
    open_ground = (smooth < 0.18) & inside & ~taken
    open_ground = ndimage.binary_opening(open_ground, iterations=1)
    labels, n = ndimage.label(open_ground)
    gz, gx = np.gradient(heights, STEP)
    pitch = np.degrees(np.arctan(np.hypot(gx, gz)))
    width_map = ndimage.distance_transform_edt(open_ground) * STEP

    candidates = []
    for k in range(1, n + 1):
        comp = labels == k
        area = comp.sum() * STEP * STEP
        if area < 2500:
            continue
        path, length = longest_path(skeletonize(comp))
        if length < 120:
            continue
        # Downhill order and simplify in metres.
        pts = [(float(c * STEP), float(r * STEP)) for r, c in path]
        if heights[path[0]] < heights[path[-1]]:
            pts.reverse()
        drop = abs(float(heights[path[0]] - heights[path[-1]]))
        if drop < 25:
            continue  # flat clearings, meadows and cat tracks
        simple = simplify(pts, 4.0)
        along = [pitch[int(z / STEP), int(x / STEP)] for x, z in pts]
        widths = [width_map[int(z / STEP), int(x / STEP)] for x, z in pts]
        candidates.append({
            'id': len(candidates) + 1,
            'points': [[round(x, 1), round(z, 1)] for x, z in simple],
            'lengthMetres': round(length),
            'dropMetres': round(drop),
            'meanPitchDeg': round(float(np.mean(along)), 1),
            'maxPitchDeg': round(float(np.percentile(along, 90)), 1),
            'halfWidthMetres': round(float(np.median(widths)), 1),
            'areaSquareMetres': int(area),
            'topHeight': round(float(max(heights[path[0]], heights[path[-1]])) + m['originElevation']),
        })
    json.dump({'source': 'LidarBC canopy-cover gaps not covered by OSM runs', 'candidates': candidates}, open(out, 'w'), indent=1)
    print(f'{len(candidates)} candidates')
    for c in candidates:
        print(c['id'], c['lengthMetres'], 'm, drop', c['dropMetres'], 'pitch', c['meanPitchDeg'], '/', c['maxPitchDeg'], 'half width', c['halfWidthMetres'], 'top', c['topHeight'])

    if preview:
        from PIL import Image, ImageDraw
        S = 2
        shade = np.clip(0.75 + (gx * 0.6 - gz * 0.6), 0.4, 1.1)
        img = (np.stack([255 - cover * 200] * 3, -1) * shade[..., None]).clip(0, 255).astype('u1')
        img[open_ground] = (img[open_ground] * 0.5 + np.array([255, 200, 0]) * 0.5).astype('u1')
        im = Image.fromarray(img).resize((cols * S, rows * S), Image.NEAREST)
        d = ImageDraw.Draw(im)
        for pts in runs:
            d.line([(x / STEP * S, z / STEP * S) for x, z in pts], fill=(60, 90, 200), width=2)
        d.line([(x / STEP * S, z / STEP * S) for x, z in boundary + boundary[:1]], fill=(150, 0, 150), width=1)
        for c in candidates:
            pts = [(x / STEP * S, z / STEP * S) for x, z in c['points']]
            d.line(pts, fill=(220, 0, 0), width=3)
            d.ellipse([pts[0][0] - 4, pts[0][1] - 4, pts[0][0] + 4, pts[0][1] + 4], fill=(220, 0, 0))
            d.text((pts[0][0] + 6, pts[0][1] - 6), str(c['id']), fill=(0, 0, 0))
        im.save(preview)


if __name__ == '__main__':
    main()
