"""
Builds the Apex lifts as they look in photos (Liftblog, Feb 2018; see
game/research/scenery-references.md) and exports game/public/models/scenery/lifts.glb.

    ns = {"REPO": r"<repo>"}
    exec(open(r"<repo>/tools/blender/build_lifts.py").read(), ns)
    ns["build_lifts"]()

Each asset is an empty named for it with its meshes as children, authored in the
frame liftView.ts uses:
- chairs: origin at the rope grip, travelling along +Z, seat about SEAT_DROP below;
- towers: origin on the ground, rope along Z at TOWER_HEIGHT, HALF_GAUGE either side;
- terminals: origin on the ground under the bullwheel, rope at STATION_HEIGHT, +Z
  pointing down the line. Meshes named "hood_*" hide when the camera is inside.
Keep these numbers in step with liftView.ts (a game test checks the anchors).
"""
import bpy
import math
import os
import sys

if "REPO" not in globals():
    REPO = sys.argv[sys.argv.index("--") + 1] if "--" in sys.argv else os.getcwd()
sys.path.insert(0, os.path.join(REPO, "tools", "blender"))
import importlib
import scenery_kit
importlib.reload(scenery_kit)
from scenery_kit import Kit, asset_root, material, MATERIALS, triangle_count  # noqa: E402

TOWER_HEIGHT = 11.0
SURFACE_TOWER_HEIGHT = 7.0
STATION_HEIGHT = 4.5
HALF_GAUGE = 2.6
SEAT_DROP = 2.3
SCENE = "LiftsBuild"


def materials():
    MATERIALS.clear()
    # Low metalness: the game has no environment reflections, so strong metals render black.
    material("galv", "#b4bbc1", roughness=0.5, metalness=0.25)
    material("steel_dark", "#5a6066", roughness=0.55, metalness=0.2)
    material("seat", "#2b2f34", roughness=0.7)
    material("pad_orange", "#e9952e", roughness=0.85)
    material("pad_yellow", "#e2c13a", roughness=0.85)
    material("uni_white", "#e8ecef", roughness=0.45, metalness=0.1)
    material("glass", "#1d2530", roughness=0.08, metalness=0.2)
    material("roof_grey", "#8a9097", roughness=0.6, metalness=0.2)
    material("roof_dark", "#454a4f", roughness=0.55, metalness=0.15)
    material("snow", "#f1f5f8", roughness=0.9)
    material("hut_white", "#e3e6e3", roughness=0.8)
    material("hut_grey", "#9aa3a8", roughness=0.8)
    material("timber_grey", "#7b7770", roughness=0.9)
    material("timber_dark", "#4a3a2c", roughness=0.85)
    material("window", "#26313b", roughness=0.15, metalness=0.3)
    material("sign_blue", "#1f5fa8", roughness=0.6)
    material("sign_yellow", "#f2c230", roughness=0.6)
    material("sign_white", "#f4f4f0", roughness=0.6)
    material("pole_red", "#c8322b", roughness=0.6)
    material("rope_orange", "#f0661c", roughness=0.8)
    material("green", "#3f6e3c", roughness=0.6, metalness=0.2)
    material("cabin_board", "#4b4a36", roughness=0.9)
    material("paint_blue", "#1f4fa0", roughness=0.55, metalness=0.2)
    material("paint_yellow", "#e6b821", roughness=0.55, metalness=0.2)


# ---- Shared parts ---------------------------------------------------------------------

def sheave_train(k, x, top, wheels, length=None, mat="steel_dark"):
    """Wheels under the rope (rope rests on top at `top`), in a frame along Z."""
    length = length or 0.5 * wheels + 0.3
    r = 0.19
    y = top - r
    for side in (-1, 1):
        k.box(mat, (0.04, 0.26, length), (x + side * 0.08, y, 0))
    for i in range(wheels):
        z = -length / 2 + 0.15 + (length - 0.3) * (i + 0.5) / wheels
        k.disc("galv", (x, y, z), r, (1, 0, 0), seg=12, thickness=0.06)
    k.box(mat, (0.2, 0.5, 0.2), (x, y - 0.35, 0))


def rope_fence(k, points, height=1.0):
    """Red poles with an orange rope run between them."""
    for x, z in points:
        k.cyl("pole_red", (x, 0, z), (x, height + 0.2, z), 0.035, seg=6)
    for (x0, z0), (x1, z1) in zip(points, points[1:]):
        for h in (height * 0.55, height):
            k.cyl("rope_orange", (x0, h, z0), (x1, h, z1), 0.012, seg=4, caps=False)


def hut(k, at, size, wall, roof_kind="flat", door_side=1, windows=True):
    """Operator hut: walls, windows, door, flat or gable roof with snow."""
    x, z = at
    w, h, d = size
    k.box(wall, (w, h, d), (x, h / 2, z))
    if windows:
        k.box("window", (w + 0.04, h * 0.32, d * 0.7), (x, h * 0.62, z))
        k.box("window", (w * 0.7, h * 0.32, d + 0.04), (x, h * 0.62, z))
    k.box("timber_dark", (0.9, 2.0, 0.06), (x + door_side * w * 0.2, 1.0, z + door_side * (d / 2 + 0.03)))
    if roof_kind == "flat":
        k.box("roof_grey", (w + 0.4, 0.2, d + 0.4), (x, h + 0.1, z))
        k.box("snow", (w + 0.35, 0.3, d + 0.35), (x, h + 0.35, z))
    else:
        rise = w * 0.32
        for side in (-1, 1):
            # Two roof planes and their snow, ridge along Z.
            ang = math.atan2(rise, w / 2 + 0.3)
            span = math.hypot(w / 2 + 0.3, rise)
            k.box("roof_dark", (span, 0.14, d + 0.6), (x + side * (w / 4 + 0.15), h + rise / 2, z), (0, 0, -side * ang))
            k.box("snow", (span, 0.28, d + 0.5), (x + side * (w / 4 + 0.15) - side * math.sin(ang) * 0.2, h + rise / 2 + math.cos(ang) * 0.2, z), (0, 0, -side * ang))
        for zs in (-1, 1):
            k.add(wall, [(x - w / 2, h, z + zs * d / 2), (x + w / 2, h, z + zs * d / 2), (x, h + rise, z + zs * d / 2)], [(0, 1, 2) if zs > 0 else (0, 2, 1)])


# ---- Quickdraw (Doppelmayr-CTEC detachable quad, 1994) ------------------------------------

def qd_chair():
    """Open galvanized quad: curved hanger, slatted bench and low back, bar with footrest."""
    root = asset_root("qd_chair")
    k = Kit("qd_chair_mesh")
    # Detachable grip and carriage on the rope.
    k.box("steel_dark", (0.16, 0.24, 0.5), (0, -0.1, 0))
    k.cyl("steel_dark", (-0.12, -0.05, -0.18), (0.12, -0.05, -0.18), 0.06, seg=8)
    k.cyl("steel_dark", (-0.12, -0.05, 0.18), (0.12, -0.05, 0.18), 0.06, seg=8)
    # Hanger: straight down, then a bend back to the top of the backrest.
    k.tube("galv", [(0, -0.22, 0), (0, -1.25, 0.02), (0, -1.55, -0.12), (0, -1.74, -0.36)], 0.045, seg=8)
    w = 1.08
    # Back frame and seat frame.
    k.cyl("galv", (-w, -1.76, -0.37), (w, -1.76, -0.37), 0.035, seg=6)
    for x in (-w, w):
        k.tube("galv", [(x, -1.76, -0.37), (x, -2.32, -0.3), (x, -2.36, 0.26)], 0.035, seg=6)
    k.cyl("galv", (-w, -2.36, 0.26), (w, -2.36, 0.26), 0.035, seg=6)
    k.cyl("galv", (-w, -2.36, -0.3), (w, -2.36, -0.3), 0.035, seg=6)
    # Slatted bench and back.
    for i in range(4):
        z = -0.24 + i * 0.155
        k.box("seat", (2.1, 0.035, 0.12), (0, -2.31, z))
    for i in range(3):
        t = (i + 0.5) / 3
        k.box("seat", (2.1, 0.11, 0.03), (0, -2.28 + t * 0.48, -0.31 - t * 0.06), (-0.12, 0, 0))
    # Armrests at the ends.
    for x in (-w, w):
        k.cyl("galv", (x, -2.0, -0.34), (x, -2.0, 0.2), 0.025, seg=6)
        k.cyl("galv", (x, -2.0, 0.2), (x, -2.33, 0.24), 0.025, seg=6)
    # Safety bar (down, as when riding): pivot on the hanger, over the laps, down to the footrest.
    k.tube("galv", [(0, -1.5, 0.04), (0, -1.66, 0.4), (0, -1.74, 0.62)], 0.032, seg=6)
    k.cyl("galv", (-1.02, -1.74, 0.62), (1.02, -1.74, 0.62), 0.03, seg=6)
    for x in (-0.55, 0.55):
        k.cyl("galv", (x, -1.74, 0.62), (x, -2.72, 0.66), 0.026, seg=6)
    k.cyl("galv", (-0.98, -2.72, 0.66), (0.98, -2.72, 0.66), 0.03, seg=6)
    for x in (-0.82, -0.27, 0.27, 0.82):
        k.box("steel_dark", (0.34, 0.03, 0.12), (x, -2.72, 0.62))
    k.build(root)
    return root


def qd_tower():
    """Grey tube tower with an orange base pad, T crossarm, sheave trains, walkway, ladder."""
    root = asset_root("qd_tower")
    k = Kit("qd_tower_mesh")
    top = TOWER_HEIGHT
    arm_y = top - 0.95
    k.cyl("galv", (0, -0.8, 0), (0, arm_y + 0.2, 0), 0.34, 0.26, seg=14)
    k.box("steel_dark", (1.1, 0.12, 1.1), (0, 0.02, 0))
    k.cyl("pad_orange", (0, 0, 0), (0, 1.9, 0), 0.43, seg=14)
    # Head and crossarm.
    k.box("galv", (0.75, 0.75, 0.75), (0, arm_y, 0))
    k.box("galv", (HALF_GAUGE * 2 + 1.0, 0.42, 0.42), (0, arm_y, 0))
    for side in (-1, 1):
        x = side * HALF_GAUGE
        k.box("galv", (0.16, 0.55, 0.16), (x, arm_y + 0.45, 0))
        sheave_train(k, x, top, 6 if side > 0 else 4)
    # Walkway with handrail on the downhill side of the arm.
    k.box("steel_dark", (HALF_GAUGE * 2 + 1.2, 0.05, 0.62), (0, arm_y - 0.18, -0.6))
    rail_z = -0.88
    k.cyl("galv", (-HALF_GAUGE - 0.6, arm_y + 0.9, rail_z), (HALF_GAUGE + 0.6, arm_y + 0.9, rail_z), 0.025, seg=5)
    for x in (-HALF_GAUGE - 0.6, -HALF_GAUGE * 0.3, HALF_GAUGE * 0.3, HALF_GAUGE + 0.6):
        k.cyl("galv", (x, arm_y - 0.18, rail_z), (x, arm_y + 0.9, rail_z), 0.022, seg=5)
    # Ladder up the downhill face and a lightning rod.
    for x in (-0.2, 0.2):
        k.cyl("galv", (x, 2.2, -0.45), (x, arm_y - 0.2, -0.4), 0.022, seg=5)
    y = 2.5
    while y < arm_y - 0.3:
        k.box("galv", (0.4, 0.03, 0.03), (0, y, -0.45 + (y - 2.2) / (arm_y - 2.4) * 0.05))
        y += 0.45
    k.cyl("galv", (0, arm_y + 0.35, 0), (0, top + 1.6, 0), 0.02, seg=4)
    # Tower number plate.
    k.box("sign_white", (0.36, 0.26, 0.03), (0, 3.0, -0.36))
    k.build(root)
    return root


def uni_housing(k, prefix, length=13.0, start=-3.0, base=STATION_HEIGHT + 0.5, half=3.4, roof="flat"):
    """
    Early Uni terminal housing: a stadium-shaped "boat" with a white band, a sloped band
    of tinted glass all round and a grey roof (or a dark hipped roof over the drive).
    """
    centre_start = start + half
    centre_end = start + length - half

    def ring(offset, y, n=12):
        pts = []
        r = half + offset
        for i in range(n + 1):  # bullwheel end: semicircle round -Z
            a = math.pi / 2 + math.pi * i / n
            pts.append((r * math.sin(a) * -1, y, centre_start + r * math.cos(a)))
        for i in range(n + 1):  # far end
            a = -math.pi / 2 + math.pi * i / n
            pts.append((r * math.sin(a) * -1, y, centre_end + r * math.cos(a)))
        return pts

    rings_white = [ring(-0.15, base), ring(0.0, base + 0.08), ring(0.12, base + 0.85)]
    k.loft("uni_white", rings_white, cap_start=True, smooth=True)
    k.loft("steel_dark", [ring(0.12, base + 0.85), ring(0.16, base + 0.9), ring(0.1, base + 0.95)], smooth=True)
    k.loft("glass", [ring(0.1, base + 0.95), ring(-0.38, base + 1.7)], smooth=True)
    k.loft("roof_grey", [ring(-0.38, base + 1.7), ring(-0.42, base + 1.78)], smooth=True, cap_end=roof == "flat")
    if roof == "hip":
        # Dark corrugated hipped roof over the whole housing, ridge along Z.
        r0 = ring(-0.42, base + 1.78)
        top_ring = [(x * 0.25, base + 3.0, centre_start + (z - centre_start) * 0.92 if z < (centre_start + centre_end) / 2 else centre_end + (z - centre_end) * 0.92) for x, _, z in r0]
        k.loft("roof_dark", [r0, top_ring], cap_end=True, smooth=False)
    return base


def qd_terminal(end):
    """Quickdraw bottom return or top drive."""
    root = asset_root(f"qd_terminal_{end}")
    hood = Kit(f"hood_qd_{end}")
    base = uni_housing(hood, "qd", roof="hip" if end == "top" else "flat")
    # Under-housing frame, bullwheel, detach rails and columns hide with the housing
    # when the camera is inside the station (boarding and unloading).
    hood.box("steel_dark", (5.6, 0.35, 10.0), (0, base - 0.18, 3.0))
    hood.torus("steel_dark", (0, STATION_HEIGHT + 0.15, 0), HALF_GAUGE, 0.12, axis="y", seg=32)
    for side in (-1, 1):
        hood.box("galv", (0.12, 0.22, 11.0), (side * HALF_GAUGE, STATION_HEIGHT + 0.35, 3.5))
    # Columns: two square columns at the bottom; one big column and a rear leg at the top.
    if end == "bottom":
        for z in (0.2, 6.4):
            hood.box("galv", (0.95, base, 0.95), (0, base / 2, z))
    else:
        hood.box("galv", (1.25, base, 1.25), (0, base / 2, 0.4))
        hood.box("galv", (0.7, base, 0.7), (0, base / 2, 7.2))
    hood.build(root)
    k = Kit(f"qd_{end}_frame")
    # Service ladder.
    for x in (2.2, 2.6):
        k.cyl("galv", (x, 0, 7.6), (x, base, 7.6), 0.025, seg=5)
    for i in range(int(base / 0.4)):
        k.box("galv", (0.42, 0.03, 0.03), (2.4, 0.3 + i * 0.4, 7.6))
    # Doppelmayr plate on the line end.
    k.box("sign_blue", (1.4, 0.32, 0.04), (0, base + 0.45, 10.02))
    if end == "bottom":
        # Chair parking rail curving off the side on two posts.
        pts = []
        for i in range(9):
            a = i / 8 * math.pi / 2
            pts.append((3.3 + 4.0 * (1 - math.cos(a)), STATION_HEIGHT + 0.4, 6.0 + 4.0 * math.sin(a)))
        k.tube("galv", pts, 0.09, seg=6)
        for x, z in ((5.2, 8.6), (7.2, 10.0)):
            k.box("galv", (0.25, STATION_HEIGHT + 0.4, 0.25), (x, (STATION_HEIGHT + 0.4) / 2, z))
        hut(k, (6.4, 3.0), (3.2, 2.6, 2.8), "hut_white", "flat", door_side=1)
        # Blue Quickdraw safety board and yellow "wait for the operator" sign.
        k.box("sign_blue", (1.4, 1.0, 0.06), (-4.2, 1.7, 9.5))
        k.box("sign_white", (1.1, 0.25, 0.07), (-4.2, 2.05, 9.5))
        k.cyl("galv", (-4.2, 0, 9.5), (-4.2, 1.2, 9.5), 0.05, seg=6)
        k.box("sign_yellow", (0.7, 0.9, 0.05), (4.0, 1.6, 12.0))
        k.cyl("galv", (4.0, 0, 12.0), (4.0, 1.15, 12.0), 0.04, seg=6)
        # Antenna mast with a cross piece.
        k.cyl("galv", (8.5, 0, 0.5), (8.5, 10.5, 0.5), 0.06, seg=6)
        k.box("galv", (0.06, 0.06, 1.2), (8.5, 9.6, 0.5))
        rope_fence(k, [(-3.6, 9.0), (-3.6, 13.5), (-1.2, 15.5), (1.2, 15.5), (3.6, 13.5), (3.6, 9.0)])
    else:
        # Grey-sided operator hut with a snowy gable roof, and an unload area fence.
        hut(k, (-7.0, 2.0), (3.8, 2.8, 3.4), "hut_grey", "gable", door_side=-1)
        rope_fence(k, [(-3.4, 12.0), (-3.4, 16.0)], 1.0)
        rope_fence(k, [(3.4, 12.0), (3.4, 16.0)], 1.0)
    k.build(root)
    return root


# ---- Stock's (GMD Müller fixed-grip triple, 1981) --------------------------------------------

def st_chair():
    """Müller triple: hanger arcing over into a tall loop back, light grey bench, simple bar."""
    root = asset_root("st_chair")
    k = Kit("st_chair_mesh")
    k.box("steel_dark", (0.14, 0.2, 0.32), (0, -0.08, 0))
    w = 0.82
    # Hanger down and back, splitting into the loop that frames the backrest.
    k.tube("galv", [(0, -0.18, 0), (0, -1.0, -0.05), (0, -1.35, -0.3)], 0.04, seg=8)
    loop = []
    for i in range(13):
        a = math.pi * i / 12
        loop.append((-w * math.cos(a), -1.35 - 0.45 * (1 - math.sin(a)) - 0.12, -0.3 - 0.02 * math.sin(a)))
    k.tube("galv", loop, 0.032, seg=6)
    for x in (-w, w):
        k.tube("galv", [(x, -1.82, -0.32), (x, -2.33, -0.3), (x, -2.36, 0.24)], 0.032, seg=6)
    k.cyl("galv", (-w, -2.36, 0.24), (w, -2.36, 0.24), 0.032, seg=6)
    k.box("hut_grey", (1.6, 0.05, 0.5), (0, -2.31, -0.02))
    k.box("hut_grey", (1.6, 0.42, 0.04), (0, -2.05, -0.32), (-0.1, 0, 0))
    k.tube("galv", [(0, -1.4, -0.28), (0, -1.6, 0.3), (0, -1.75, 0.55)], 0.028, seg=6)
    k.cyl("galv", (-0.75, -1.75, 0.55), (0.75, -1.75, 0.55), 0.026, seg=6)
    k.build(root)
    return root


def st_tower():
    """Grey tube with a yellow base pad, short crossarm, sheaves and a lifting frame on top."""
    root = asset_root("st_tower")
    k = Kit("st_tower_mesh")
    top = TOWER_HEIGHT
    arm_y = top - 0.85
    k.cyl("galv", (0, -0.8, 0), (0, arm_y + 0.2, 0), 0.26, 0.2, seg=12)
    k.box("steel_dark", (0.9, 0.1, 0.9), (0, 0.02, 0))
    k.cyl("pad_yellow", (0, 0, 0), (0, 1.7, 0), 0.34, seg=12)
    k.box("galv", (HALF_GAUGE * 2 + 0.7, 0.32, 0.32), (0, arm_y, 0))
    for side in (-1, 1):
        x = side * HALF_GAUGE
        k.box("galv", (0.14, 0.45, 0.14), (x, arm_y + 0.38, 0))
        sheave_train(k, x, top, 4)
    # Lifting frame: a small A over the arm.
    for side in (-1, 1):
        k.cyl("galv", (side * 1.6, arm_y + 0.15, 0), (0, arm_y + 1.6, 0), 0.04, seg=5)
    k.cyl("galv", (-0.3, arm_y + 1.6, 0), (0.3, arm_y + 1.6, 0), 0.05, seg=5)
    for x in (-0.18, 0.18):
        k.cyl("galv", (x, 2.0, -0.32), (x, arm_y - 0.2, -0.28), 0.02, seg=5)
    y = 2.3
    while y < arm_y - 0.3:
        k.box("galv", (0.36, 0.03, 0.03), (0, y, -0.31))
        y += 0.45
    k.build(root)
    return root


def st_terminal(end):
    root = asset_root(f"st_terminal_{end}")
    k = Kit(f"st_{end}_mesh")
    base = STATION_HEIGHT
    if end == "bottom":
        # Green steel portal with splayed legs, a horizontal bullwheel and a counterweight box.
        for z in (-1.6, 1.6):
            for side in (-1, 1):
                k.box("green", (0.32, 5.4, 0.32), (side * 3.75, base / 2 + 0.1, z), (0, 0, side * 0.22))
            k.box("green", (7.4, 0.42, 0.42), (0, base + 0.35, z))
        for side in (-1, 1):
            k.box("green", (0.3, 0.3, 3.6), (side * 3.2, base + 0.35, 0))
        k.box("green", (1.2, 0.5, 3.8), (0, base + 0.55, 0))
        k.torus("steel_dark", (0, base, 0), HALF_GAUGE, 0.13, axis="y", seg=32)
        for side in (-1, 1):
            sheave_train(k, side * HALF_GAUGE, base + 0.05, 4, length=2.4)
        # Counterweight box on its own frame beside the portal.
        k.box("green", (1.5, 2.4, 1.5), (5.6, 3.4, 0))
        for dx in (-0.6, 0.6):
            for dz in (-0.6, 0.6):
                k.box("green", (0.18, 2.4, 0.18), (5.6 + dx, 1.2, dz))
        hut(k, (-6.8, 3.5), (3.0, 2.4, 2.8), "hut_white", "gable", door_side=1)
        rope_fence(k, [(-3.2, 6.0), (-3.2, 10.0)])
        rope_fence(k, [(3.2, 6.0), (3.2, 10.0)])
    else:
        # A-frame drive cabin on splayed steel legs over the bullwheel (diesel drive).
        floor = base + 0.6
        span = 3.9   # half width of the A at the floor
        rise = 7.0
        length = 6.4
        for z in (-length / 2 + 0.3, length / 2 - 0.3):
            for side in (-1, 1):
                k.box("steel_dark", (0.3, 5.6, 0.3), (side * 3.1, floor / 2 - 0.1, z), (0, 0, side * 0.32))
        k.box("steel_dark", (7.6, 0.4, length), (0, floor - 0.2, 0))
        k.torus("steel_dark", (0, base, 0), HALF_GAUGE, 0.13, axis="y", seg=32)
        k.box("steel_dark", (0.9, 0.9, 0.9), (0, floor - 0.6, 0))
        # Gable faces (dark boards, two windows) at both ends of the ridge, which runs along Z.
        for zs in (-1, 1):
            z = zs * length / 2
            tri = [(-span, floor, z), (span, floor, z), (0, floor + rise, z)]
            k.add("cabin_board", tri, [(0, 1, 2) if zs > 0 else (0, 2, 1)])
            for wx in (-0.9, 0.9):
                k.box("window", (0.9, 1.0, 0.06), (wx, floor + 2.6, z + zs * 0.03))
            k.box("window", (0.6, 0.7, 0.06), (0, floor + 4.6, z + zs * 0.03))
        # Steep roof planes with snow sliding off, and the ridge cap.
        ang = math.atan2(rise, span)
        slope = math.hypot(span, rise) + 0.5
        for side in (-1, 1):
            cx = side * span / 2
            cy = floor + rise / 2
            k.box("roof_dark", (slope, 0.16, length + 0.6), (cx + side * 0.05, cy, 0), (0, 0, -side * ang))
            k.box("snow", (slope * 0.55, 0.22, length + 0.5), (cx * 1.35 + side * 0.12, floor + rise * 0.28, 0), (0, 0, -side * ang))
        k.box("roof_dark", (0.35, 0.3, length + 0.7), (0, floor + rise + 0.05, 0))
        # Control position under the cabin, with an unload ramp fence.
        k.box("hut_grey", (2.0, 2.2, 1.6), (-4.6, 1.1, -1.2))
        k.box("window", (2.04, 0.7, 1.2), (-4.6, 1.5, -1.2))
        rope_fence(k, [(-3.4, 6.0), (-3.4, 10.0)])
        rope_fence(k, [(3.4, 6.0), (3.4, 10.0)])
    k.build(root)
    return root


# ---- T-bar (GMD Müller, 1968) -------------------------------------------------------------

def lattice_leg(k, mat, foot, head, width=0.42, step=0.7):
    """Square lattice leg between two points: four chords and zig-zag braces on each face."""
    from mathutils import Vector
    foot, head = Vector(foot), Vector(head)
    axis = head - foot
    u = Vector((1, 0, 0))
    v = axis.cross(u).normalized()
    u = v.cross(axis).normalized()
    corners = [(u * sx + v * sz) * width / 2 for sx, sz in ((-1, -1), (1, -1), (1, 1), (-1, 1))]
    for c in corners:
        k.cyl(mat, foot + c, head + c, 0.035, seg=4, caps=False)
    n = max(2, int(axis.length / step))
    for i in range(n):
        a = foot + axis * (i / n)
        b = foot + axis * ((i + 1) / n)
        for f in range(4):
            c0, c1 = corners[f], corners[(f + 1) % 4]
            k.cyl(mat, a + (c0 if i % 2 == 0 else c1), b + (c1 if i % 2 == 0 else c0), 0.018, seg=3, caps=False)


def tb_tower():
    """Yellow lattice portal gantry; the rope runs under its beam at SURFACE_TOWER_HEIGHT."""
    root = asset_root("tb_tower")
    k = Kit("tb_tower_mesh")
    top = SURFACE_TOWER_HEIGHT
    half = HALF_GAUGE + 1.0
    for side in (-1, 1):
        lattice_leg(k, "paint_yellow", (side * (half + 0.5), 0, 0), (side * half, top + 0.4, 0))
        k.box("paint_yellow", (0.8, 0.5, 0.8), (side * (half + 0.5), 0.25, 0))
    # Beam: a lattice box girder across the top.
    for y in (top + 0.4, top + 1.0):
        for z in (-0.25, 0.25):
            k.cyl("paint_yellow", (-half - 0.3, y, z), (half + 0.3, y, z), 0.04, seg=4, caps=False)
    n = 12
    for i in range(n):
        x0 = -half + 2 * half * i / n
        x1 = -half + 2 * half * (i + 1) / n
        for z in (-0.25, 0.25):
            k.cyl("paint_yellow", (x0, top + 0.4, z), (x1, top + 1.0, z), 0.02, seg=3, caps=False)
    for side in (-1, 1):
        k.box("steel_dark", (0.12, 0.6, 0.12), (side * HALF_GAUGE, top + 0.15, 0))
        sheave_train(k, side * HALF_GAUGE, top + 0.2, 4, length=2.2)
    k.build(root)
    return root


def tb_terminal(end):
    root = asset_root(f"tb_terminal_{end}")
    k = Kit(f"tb_{end}_mesh")
    base = STATION_HEIGHT
    if end == "bottom":
        # Tall blue counterweight column painted with snowflakes, and the drive column
        # under a yellow horizontal bullwheel.
        cw = (5.2, -1.2)
        k.cyl("paint_blue", (cw[0], 0, cw[1]), (cw[0], 7.5, cw[1]), 0.95, seg=20)
        k.cyl("snow", (cw[0], 7.5, cw[1]), (cw[0], 7.75, cw[1]), 0.97, seg=20)
        import random
        rnd = random.Random(7)
        for _ in range(26):
            a = rnd.uniform(0, 2 * math.pi)
            y = rnd.uniform(0.8, 7.0)
            r = rnd.uniform(0.12, 0.3)
            cx, cz = cw[0] + math.sin(a) * 0.96, cw[1] + math.cos(a) * 0.96
            for spoke in range(3):
                s = spoke * math.pi / 3
                dx, dy = math.cos(s) * r, math.sin(s) * r
                k.cyl("sign_white", (cx - dx * math.cos(a), y - dy, cz + dx * math.sin(a)), (cx + dx * math.cos(a), y + dy, cz - dx * math.sin(a)), 0.025, seg=3, caps=False)
        k.cyl("paint_blue", (0, 0, 0), (0, base - 0.4, 0), 0.75, seg=16)
        k.box("paint_blue", (1.4, 1.2, 1.6), (1.4, base - 1.4, 0))
        k.cyl("steel_dark", (0, base - 0.4, 0), (0, base, 0), 0.4, seg=12)
        k.disc("paint_yellow", (0, base + 0.05, 0), HALF_GAUGE + 0.15, (0, 1, 0), seg=32, thickness=0.18)
        k.torus("paint_yellow", (0, base + 0.05, 0), HALF_GAUGE + 0.1, 0.12, axis="y", seg=32)
        # Cable from the counterweight over a sheave to the carriage.
        k.cyl("steel_dark", (cw[0], 7.4, cw[1]), (0.6, base - 0.2, -0.4), 0.03, seg=4)
        hut(k, (-6.2, 1.5), (3.6, 2.6, 3.0), "hut_grey", "gable", door_side=1)
        rope_fence(k, [(-3.0, 5.0), (-3.0, 11.0)])
        rope_fence(k, [(3.0, 5.0), (3.0, 11.0)])
    else:
        # Yellow lattice portal carrying the fixed return wheel, and the lookout hut.
        half = HALF_GAUGE + 0.8
        for side in (-1, 1):
            lattice_leg(k, "paint_yellow", (side * (half + 0.4), 0, -0.4), (side * half, base + 0.3, -0.4))
            k.box("paint_yellow", (0.7, 0.5, 0.7), (side * (half + 0.4), 0.25, -0.4))
        k.box("paint_yellow", (2 * half + 0.6, 0.5, 0.5), (0, base + 0.5, -0.4))
        k.box("paint_yellow", (0.6, 0.6, 2.4), (0, base + 0.4, 0.4))
        k.torus("paint_yellow", (0, base, 0), HALF_GAUGE, 0.12, axis="y", seg=32)
        for a in range(6):
            t = a * math.pi / 3
            k.cyl("paint_yellow", (0, base, 0), (math.cos(t) * HALF_GAUGE, base, math.sin(t) * HALF_GAUGE), 0.05, seg=4)
        hut(k, (6.4, 1.0), (2.6, 2.4, 2.4), "timber_dark", "gable", door_side=-1)
        # Blue run board: Rookies Trail, Okanagan Run, Spruce Hollow, Terrain Parks.
        k.box("timber_dark", (1.7, 1.5, 0.08), (-5.5, 1.75, 6.0))
        for i in range(4):
            k.box("sign_blue", (1.5, 0.28, 0.1), (-5.5, 1.2 + i * 0.34, 6.0))
        for x in (-6.3, -4.7):
            k.cyl("timber_dark", (x, 0, 6.0), (x, 2.5, 6.0), 0.06, seg=6)
    k.build(root)
    return root


# ---- Build and export -------------------------------------------------------------------

def fresh_scene():
    old = bpy.data.scenes.get(SCENE)
    if old:
        for obj in list(old.objects):
            bpy.data.objects.remove(obj, do_unlink=True)
        bpy.data.scenes.remove(old)
    for coll in (bpy.data.meshes, bpy.data.materials):
        for block in list(coll):
            if block.users == 0:
                coll.remove(block)
    scene = bpy.data.scenes.new(SCENE)
    if bpy.context.window:
        bpy.context.window.scene = scene
    return scene


BUILDERS = {
    "qd_chair": qd_chair,
    "qd_tower": qd_tower,
    "qd_terminal_bottom": lambda: qd_terminal("bottom"),
    "qd_terminal_top": lambda: qd_terminal("top"),
    "st_chair": st_chair,
    "st_tower": st_tower,
    "st_terminal_bottom": lambda: st_terminal("bottom"),
    "st_terminal_top": lambda: st_terminal("top"),
    "tb_tower": tb_tower,
    "tb_terminal_bottom": lambda: tb_terminal("bottom"),
    "tb_terminal_top": lambda: tb_terminal("top"),
}


def export(path):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    for o in bpy.context.scene.objects:
        o.select_set(True)
    bpy.ops.export_scene.gltf(
        filepath=path, export_format="GLB", use_selection=True, use_active_scene=True,
        export_animations=False, export_skins=False, export_morph=False, export_yup=True,
        export_extras=False, export_vertex_color="NONE", export_attributes=False,
    )
    return path


def build_lifts(names=None, out=None):
    fresh_scene()
    materials()
    report = {}
    for name in names or BUILDERS:
        root = BUILDERS[name]()
        report[name] = sum(triangle_count(c) for c in root.children)
    path = export(out or os.path.join(REPO, "game", "public", "models", "scenery", "lifts.glb"))
    report["bytes"] = os.path.getsize(path)
    return report


if __name__ == "__main__" and bpy.app.background:
    print(build_lifts())
