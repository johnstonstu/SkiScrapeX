"""
Builds hand-modelled hero buildings on their OSM footprints and exports
game/public/models/scenery/buildings.glb. See game/research/scenery-references.md.

    ns = {"REPO": r"<repo>"}
    exec(open(r"<repo>/tools/blender/build_buildings.py").read(), ns)
    ns["build_buildings"]()

Footprints come from tools/blender/footprints.json (kept in step with the game
data by tests/heroFootprints.test.ts). Each model's origin is the footprint
centroid at the lowest ground under it; the game places it there, unrotated.
Game space throughout: +X east, +Y up, +Z south.
"""
import bpy
import json
import math
import os
import sys

import numpy as np

if "REPO" not in globals():
    REPO = sys.argv[sys.argv.index("--") + 1] if "--" in sys.argv else os.getcwd()
sys.path.insert(0, os.path.join(REPO, "tools", "blender"))
import importlib
import scenery_kit
importlib.reload(scenery_kit)
from scenery_kit import Kit, asset_root, material, MATERIALS, triangle_count, srgb_to_linear  # noqa: E402
from mathutils import Vector  # noqa: E402

SCENE = "BuildingsBuild"
FOOTPRINTS = {f["name"]: f for f in json.load(open(os.path.join(REPO, "tools", "blender", "footprints.json")))}


# ---- Textures ----------------------------------------------------------------------------

def wood_texture(name, base, size=256, boards=8, batten=True, seed=3):
    """Vertical boards with battens (or plain planks), grain and weathering, tiling."""
    rng = np.random.default_rng(seed)
    b = np.array(srgb_to_linear(base))
    u = np.linspace(0, 1, size, endpoint=False)
    U, V = np.meshgrid(u, u)
    board = np.floor(U * boards)
    tone = rng.uniform(0.82, 1.12, boards)[board.astype(int)]
    grain = 0.06 * np.sin(V * 90 + np.sin(U * 40 + board) * 3) + 0.04 * rng.standard_normal((size, size))
    shade = tone + grain
    frac = (U * boards) % 1
    if batten:
        # Battens over the joints: lighter strips with a shadow line each side.
        shade = np.where(frac < 0.09, shade * 1.12, shade)
        shade = np.where((frac >= 0.09) & (frac < 0.13), shade * 0.55, shade)
        shade = np.where(frac > 0.96, shade * 0.6, shade)
    else:
        shade = np.where(frac > 0.95, shade * 0.5, shade)
    px = np.clip(b[None, None, :] * shade[..., None], 0, 1)
    rgba = np.concatenate([px, np.ones((size, size, 1))], axis=2).astype(np.float32)
    old = bpy.data.images.get(name)
    if old:
        bpy.data.images.remove(old)
    # Float buffer keeps the linear values exactly; the glTF exporter writes it out as JPEG.
    img = bpy.data.images.new(name, size, size, float_buffer=True)
    img.pixels = rgba.ravel()
    img.update()
    return img


def textured(name, image, roughness=0.85):
    """A material whose base colour is a tiling image (UVs in metres / tile size)."""
    if name in MATERIALS:
        return MATERIALS[name]
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nt = mat.node_tree
    bsdf = nt.nodes.get("Principled BSDF")
    bsdf.inputs["Roughness"].default_value = roughness
    tex = nt.nodes.new("ShaderNodeTexImage")
    tex.image = image
    tex.extension = "REPEAT"
    nt.links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
    MATERIALS[name] = mat
    return mat


def materials():
    MATERIALS.clear()
    textured("batten_brown", wood_texture("tex_batten_brown", "#6e4a30", boards=6))
    textured("plank_deck", wood_texture("tex_plank_deck", "#7a5a40", boards=10, batten=False, seed=5))
    material("log", "#9a6e44", roughness=0.8)
    material("log_dark", "#5d4029", roughness=0.85)
    material("trim", "#3b2a1e", roughness=0.8)
    material("glass", "#2a3a46", roughness=0.1, metalness=0.2)
    # Daylight: dark glass with a hint of the warm interior behind it.
    material("glass_warm", "#4a4238", roughness=0.12, metalness=0.2, emissive="#ffb35c", emissive_strength=0.18)
    material("roof_metal", "#4b3b30", roughness=0.6, metalness=0.15)
    material("snow", "#f1f5f8", roughness=0.9)
    material("stone", "#857d72", roughness=0.95)
    material("bulb", "#ffd28a", roughness=0.4, emissive="#ffc46b", emissive_strength=4.0)
    material("sign_board", "#3a2617", roughness=0.8)
    material("sign_cream", "#efe2c2", roughness=0.7)
    material("sign_red", "#b23a2a", roughness=0.7)
    material("flag_red", "#d0202a", roughness=0.8)
    material("flag_white", "#f5f5f2", roughness=0.8)
    material("table", "#8a5a33", roughness=0.85)


def uv_project(obj, size=2.0):
    """Box-project UVs so tiling textures repeat every `size` metres."""
    for o in bpy.context.scene.objects:
        o.select_set(False)
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.cube_project(cube_size=size, correct_aspect=False, scale_to_bounds=False)
    bpy.ops.object.mode_set(mode="OBJECT")


# ---- Footprint helpers ----------------------------------------------------------------------

def principal_axes(ring):
    """Unit vectors along and across the footprint's long axis, and its half extents."""
    pts = np.array(ring)
    centred = pts - pts.mean(axis=0)
    _, vecs = np.linalg.eigh(centred.T @ centred)
    along = vecs[:, 1]
    across = np.array([-along[1], along[0]])
    a = centred @ along
    c = centred @ across
    return along, across, (a.min(), a.max()), (c.min(), c.max())


class Ground:
    def __init__(self, terrain):
        self.t = terrain
        self.h = np.array(terrain["heights"]).reshape(terrain["rows"], terrain["columns"])

    def __call__(self, x, z):
        t = self.t
        fx = (x - t["minX"]) / t["step"]
        fz = (z - t["minZ"]) / t["step"]
        c0 = int(np.clip(np.floor(fx), 0, t["columns"] - 2))
        r0 = int(np.clip(np.floor(fz), 0, t["rows"] - 2))
        tx = float(np.clip(fx - c0, 0, 1))
        tz = float(np.clip(fz - r0, 0, 1))
        h = self.h
        return float((h[r0, c0] * (1 - tx) + h[r0, c0 + 1] * tx) * (1 - tz) + (h[r0 + 1, c0] * (1 - tx) + h[r0 + 1, c0 + 1] * tx) * tz)


def inside(ring, x, z):
    """Even-odd point-in-polygon test on an (x, z) ring."""
    hit = False
    n = len(ring)
    for i in range(n):
        x0, z0 = ring[i]
        x1, z1 = ring[(i + 1) % n]
        if (z0 > z) != (z1 > z) and x < x0 + (z - z0) * (x1 - x0) / (z1 - z0):
            hit = not hit
    return hit


def outward(ring, i):
    """Unit outward normal of edge i (whatever the ring's winding)."""
    x0, z0 = ring[i]
    x1, z1 = ring[(i + 1) % len(ring)]
    length = max(math.hypot(x1 - x0, z1 - z0), 1e-9)
    nx, nz = (z1 - z0) / length, -(x1 - x0) / length
    mx, mz = (x0 + x1) / 2, (z0 + z1) / 2
    if inside(ring, mx + nx * 0.5, mz + nz * 0.5):
        nx, nz = -nx, -nz
    return nx, nz


def to_world(along, across, a, c):
    p = along * a + across * c
    return float(p[0]), float(p[1])


# ---- Gunbarrel Saloon -------------------------------------------------------------------------

def gunbarrel():
    fp = FOOTPRINTS["Gunbarrel Saloon"]
    ring = [tuple(p) for p in fp["ring"]]
    ground = Ground(fp["terrain"])
    root = asset_root("gunbarrel")
    walls = Kit("gunbarrel_walls")
    k = Kit("gunbarrel_detail")
    along, across, (a0, a1), (c0, c1) = principal_axes(ring)
    # Which side faces the slope (uphill): the side whose ground is higher.
    up_side = 1 if ground(*to_world(along, across, 0, c1 + 3)) > ground(*to_world(along, across, 0, c0 - 3)) else -1
    floor = max(fp["ground"]) + 0.15        # main saloon floor at the uphill snow level
    eaves = floor + 3.6
    base = -0.6

    # Walls on the exact outline, from below the snow to the eaves.
    walls.prism("batten_brown", [(x, z) for x, z in ring], base, eaves, cap_top=False)
    # Dark soffit over the footprint at the eaves: where the outline steps in under the roof,
    # this is what shows between the wall tops and the sloping roof (not the empty inside).
    k.fill("trim", [(x, eaves, z) for x, z in ring])
    k.fill("trim", [(x, eaves, z) for x, z in ring], reverse=True)
    # Dark trim band at the main floor line and at the eaves.
    for y in (floor - 0.1, eaves - 0.15):
        k.loft("trim", [[(x * 1.004, y, z * 1.004) for x, z in ring], [(x * 1.004, y + 0.22, z * 1.004) for x, z in ring]], smooth=False)

    # Windows along each wall: main floor everywhere, lower floor where the ground drops away.
    n = len(ring)
    for i in range(n):
        x0, z0 = ring[i]
        x1, z1 = ring[(i + 1) % n]
        length = math.hypot(x1 - x0, z1 - z0)
        if length < 3.2:
            continue
        nx, nz = outward(ring, i)
        count = int(length // 3.4)
        for j in range(count):
            t = (j + 0.5) / count
            px, pz = x0 + (x1 - x0) * t, z0 + (z1 - z0) * t
            yaw = math.atan2(nx, nz)
            g = ground(px, pz)
            # Main floor: tall saloon windows with frames and a warm glow.
            k.box("trim", (1.5, 2.0, 0.12), (px + nx * 0.04, floor + 1.55, pz + nz * 0.04), (0, yaw, 0))
            k.box("glass_warm", (1.25, 1.75, 0.14), (px + nx * 0.06, floor + 1.55, pz + nz * 0.06), (0, yaw, 0))
            if floor - g > 2.6:
                k.box("trim", (1.3, 1.3, 0.12), (px + nx * 0.04, g + 1.4, pz + nz * 0.04), (0, yaw, 0))
                k.box("glass", (1.1, 1.1, 0.14), (px + nx * 0.06, g + 1.4, pz + nz * 0.06), (0, yaw, 0))

    # Main roof: a shallow gable over the footprint's long axis, with deep snow.
    roofs = Kit("gunbarrel_roof")
    half_w = (c1 - c0) / 2 + 1.2
    mid_c = (c0 + c1) / 2
    rise = half_w * math.tan(math.radians(22))
    ridge_len = (a1 - a0) + 2.4
    mid_a = (a0 + a1) / 2
    cx, cz = to_world(along, across, mid_a, mid_c)
    yaw = math.atan2(along[0], along[1])
    gable_roof(roofs, (cx, eaves, cz), yaw, ridge_len, half_w, rise)
    # Gable end walls (triangles) at each end of the ridge.
    for end in (-1, 1):
        ex, ez = to_world(along, across, mid_a + end * (ridge_len / 2 - 1.2), mid_c)
        tri = []
        for c in (-half_w + 1.2, half_w - 1.2):
            wx, wz = to_world(along, across, mid_a + end * (ridge_len / 2 - 1.2), mid_c + c)
            tri.append((wx, eaves, wz))
        tri.append((ex, eaves + rise * (half_w - 1.2) / half_w, ez))
        walls.add("batten_brown", tri, [(0, 1, 2), (0, 2, 1)])

    # Two big front gables on the slope side: log trusses and tall glass.
    for at in (mid_a - (a1 - a0) * 0.22, mid_a + (a1 - a0) * 0.2):
        front_gable(walls, k, roofs, along, across, at, mid_c + up_side * ((c1 - c0) / 2), up_side, eaves, rise)

    # Entrance porch with a snow-loaded shed roof, between the gables.
    px, pz = to_world(along, across, mid_a, mid_c + up_side * ((c1 - c0) / 2 + 1.6))
    porch_yaw = math.atan2(across[0] * up_side, across[1] * up_side)
    k.box("roof_metal", (5.0, 0.16, 3.4), (px, floor + 3.2, pz), (0.18, porch_yaw, 0))
    k.box("snow", (4.9, 0.45, 3.3), (px, floor + 3.55, pz), (0.18, porch_yaw, 0))
    for side in (-1, 1):
        lx, lz = to_world(along, across, mid_a + side * 2.2, mid_c + up_side * ((c1 - c0) / 2 + 3.0))
        k.cyl("log", (lx, ground(lx, lz) - 0.3, lz), (lx, floor + 3.1, lz), 0.16, seg=8)

    # Deck along the slope side at snow level: planks, log posts and two log rails.
    deck(k, along, across, ground, a0 + 3, a1 - 3, mid_c + up_side * ((c1 - c0) / 2 + 0.2), up_side, floor)

    # Stone chimney and string lights along the eaves.
    chx, chz = to_world(along, across, mid_a + (a1 - a0) * 0.3, mid_c - up_side * 1.5)
    k.box("stone", (1.3, eaves + rise + 1.6, 1.3), (chx, (eaves + rise + 1.6) / 2, chz), (0, yaw, 0))
    k.box("snow", (1.4, 0.3, 1.4), (chx, eaves + rise + 1.75, chz), (0, yaw, 0))
    string_lights(k, ring, eaves - 0.05)

    # The round GUNBARREL sign over the porch and a Canadian flag on a log pole.
    sx, sz = to_world(along, across, mid_a, mid_c + up_side * ((c1 - c0) / 2 + 3.2))
    sign(root, k, (sx, floor + 4.3, sz), porch_yaw)
    fx, fz = to_world(along, across, a1 - 2, mid_c + up_side * ((c1 - c0) / 2 + 5.0))
    flag(k, (fx, ground(fx, fz), fz), porch_yaw)

    for kit in (walls, roofs, k):
        obj = kit.build(root)
        if kit is walls:
            uv_project(obj, 2.4)
    return root


def gable_roof(k, centre, yaw, length, half_w, rise, snow=0.45, thickness=0.22):
    """A gable roof with its ridge along local Z (rotated by yaw), eaves at centre.y."""
    from mathutils import Matrix
    rot = Matrix.Rotation(yaw, 3, "Y")
    o = Vector(centre)
    hl = length / 2
    for side in (-1, 1):
        for mat, lift, depth in (("roof_metal", 0.0, thickness), ("snow", thickness, snow)):
            eave = Vector((side * half_w, lift, 0))
            ridge = Vector((0, rise + lift, 0))
            quad = [ridge + Vector((0, 0, -hl)), ridge + Vector((0, 0, hl)), eave + Vector((0, 0, hl)), eave + Vector((0, 0, -hl))]
            top = [p + Vector((0, depth, 0)) for p in quad]
            pts = [rot @ p + o for p in quad + top]
            faces = [(0, 1, 2, 3), (4, 7, 6, 5), (0, 4, 5, 1), (1, 5, 6, 2), (2, 6, 7, 3), (3, 7, 4, 0)]
            if side < 0:
                faces = [tuple(reversed(f)) for f in faces]
            k.add(mat, pts, faces)
    # A rounded snow lip hanging over each eave.
    for side in (-1, 1):
        a = rot @ Vector((side * half_w, thickness + snow * 0.3, -hl)) + o
        b = rot @ Vector((side * half_w, thickness + snow * 0.3, hl)) + o
        k.cyl("snow", a, b, snow * 0.55, seg=8)


def front_gable(walls, k, roofs, along, across, at, edge_c, up_side, eaves, rise):
    """A cross gable projecting toward the slope with a log truss and a tall glass triangle."""
    width = 9.0
    depth = 3.0
    peak = eaves + rise * 1.25
    face_c = edge_c + up_side * depth
    cx, cz = to_world(along, across, at, edge_c + up_side * depth / 2)
    yaw = math.atan2(across[0], across[1])
    # Cross roof (ridge across the building, toward the slope).
    gable_roof(roofs, (cx, eaves, cz), yaw, depth + 3.5, width / 2 + 0.8, peak - eaves)
    # Glass triangle and the truss on the gable face.
    left = to_world(along, across, at - width / 2, face_c)
    right = to_world(along, across, at + width / 2, face_c)
    top = to_world(along, across, at, face_c)
    tri = [(left[0], eaves, left[1]), (right[0], eaves, right[1]), (top[0], peak - 0.3, top[1])]
    k.add("glass_warm", tri, [(0, 2, 1), (0, 1, 2)])
    # Glass wall below the triangle.
    for t in np.linspace(-0.42, 0.42, 5):
        gx, gz = to_world(along, across, at + t * width, face_c)
        k.cyl("log_dark", (gx, eaves - 3.4, gz), (gx, eaves, gz), 0.07, seg=6)
    gx0, gz0 = to_world(along, across, at - width * 0.45, face_c - up_side * 0.05)
    gx1, gz1 = to_world(along, across, at + width * 0.45, face_c - up_side * 0.05)
    k.loft("glass_warm", [[(gx0, eaves - 3.4, gz0), (gx1, eaves - 3.4, gz1)], [(gx0, eaves, gz0), (gx1, eaves, gz1)]], closed=False, smooth=False)
    k.loft("glass_warm", [[(gx1, eaves - 3.4, gz1), (gx0, eaves - 3.4, gz0)], [(gx1, eaves, gz1), (gx0, eaves, gz0)]], closed=False, smooth=False)
    # Side walls of the projection.
    for side in (-1, 1):
        s0 = to_world(along, across, at + side * width / 2, edge_c)
        s1 = to_world(along, across, at + side * width / 2, face_c)
        quad = [(s0[0], eaves - 3.6, s0[1]), (s1[0], eaves - 3.6, s1[1]), (s1[0], eaves, s1[1]), (s0[0], eaves, s0[1])]
        walls.add("batten_brown", quad, [(0, 1, 2, 3), (3, 2, 1, 0)])
    # Log truss: tie beam, king post, two rafters and braces; heavy log posts at the corners.
    k.cyl("log", (left[0], eaves, left[1]), (right[0], eaves, right[1]), 0.2, seg=8)
    k.cyl("log", (top[0], eaves, top[1]), (top[0], peak - 0.2, top[1]), 0.16, seg=8)
    k.cyl("log", (left[0], eaves, left[1]), (top[0], peak - 0.2, top[1]), 0.18, seg=8)
    k.cyl("log", (right[0], eaves, right[1]), (top[0], peak - 0.2, top[1]), 0.18, seg=8)
    for side in (-1, 1):
        bx, bz = to_world(along, across, at + side * width * 0.22, face_c)
        k.cyl("log", (top[0], eaves + 0.8, top[1]), (bx, eaves, bz), 0.1, seg=6)
    for x, z in (left, right):
        k.cyl("log", (x, eaves - 4.2, z), (x, eaves, z), 0.24, seg=8)


def deck(k, along, across, ground, a_start, a_end, c_edge, up_side, floor):
    """Plank deck at snow level with log posts and two log rails, picnic tables on it."""
    depth = 5.0
    c_out = c_edge + up_side * depth
    corners = [to_world(along, across, a, c) for a, c in ((a_start, c_edge), (a_end, c_edge), (a_end, c_out), (a_start, c_out))]
    y = floor - 0.05
    k.add("plank_deck", [(x, y, z) for x, z in corners], [(0, 1, 2, 3), (3, 2, 1, 0)])
    k.loft("log_dark", [[(x, y - 0.35, z) for x, z in corners], [(x, y, z) for x, z in corners]], smooth=False)
    # Posts and rails round the open sides.
    rail_path = [(a_start, c_edge), (a_start, c_out), (a_end, c_out), (a_end, c_edge)]
    posts = []
    for (pa, pc), (qa, qc) in zip(rail_path, rail_path[1:]):
        steps = max(1, int(math.hypot(qa - pa, qc - pc) / 2.4))
        for s in range(steps + 1):
            t = s / steps
            posts.append(to_world(along, across, pa + (qa - pa) * t, pc + (qc - pc) * t))
    for x, z in posts:
        k.cyl("log", (x, ground(x, z) - 0.3, z), (x, y + 1.05, z), 0.1, seg=6)
    for h in (0.5, 1.0):
        for (x0, z0), (x1, z1) in zip(posts, posts[1:]):
            k.cyl("log", (x0, y + h, z0), (x1, y + h, z1), 0.07, seg=6, caps=False)
    # Picnic tables along the deck.
    yaw = math.atan2(along[0], along[1])
    for a in np.arange(a_start + 3, a_end - 2, 4.5):
        tx, tz = to_world(along, across, a, c_edge + up_side * depth * 0.5)
        k.box("table", (0.8, 0.06, 1.9), (tx, y + 0.75, tz), (0, yaw + math.pi / 2, 0))
        for off in (-0.65, 0.65):
            bx, bz = tx + along[0] * off, tz + along[1] * off
            k.box("table", (0.28, 0.05, 1.9), (bx, y + 0.45, bz), (0, yaw + math.pi / 2, 0))


def string_lights(k, ring, y):
    """Warm bulbs every 0.9 m along the eaves, on a dark wire."""
    n = len(ring)
    for i in range(n):
        x0, z0 = ring[i]
        x1, z1 = ring[(i + 1) % n]
        length = math.hypot(x1 - x0, z1 - z0)
        dx, dz = (x1 - x0) / max(length, 1e-6), (z1 - z0) / max(length, 1e-6)
        ox, oz = outward(ring, i)
        nx, nz = ox * 0.25, oz * 0.25
        k.cyl("trim", (x0 + nx, y, z0 + nz), (x1 + nx, y, z1 + nz), 0.012, seg=3, caps=False)
        for s in range(int(length / 0.9)):
            t = (s + 0.5) * 0.9 / length
            bx, bz = x0 + (x1 - x0) * t + nx, z0 + (z1 - z0) * t + nz
            k.box("bulb", (0.07, 0.1, 0.07), (bx, y - 0.08 - 0.06 * math.sin(math.pi * ((s * 0.9) % 2.7) / 2.7), bz))


def sign(root, k, at, yaw):
    """Round dark plaque with GUNBARREL in cream letters and a red band."""
    from mathutils import Matrix
    d = Vector((math.sin(yaw), 0, math.cos(yaw)))
    centre = Vector(at)
    k.disc("sign_board", centre, 1.25, d, seg=24, thickness=0.12)
    k.torus("sign_red", tuple(centre + d * 0.07), 1.05, 0.05, axis="z", seg=24, sides=4) if abs(d.z) > 0.7 else k.torus("sign_red", tuple(centre + d * 0.07), 1.05, 0.05, axis="x", seg=24, sides=4)
    # Lettering: a Blender text object turned into a mesh, laid on the plaque.
    curve = bpy.data.curves.new("gunbarrel_text", "FONT")
    curve.body = "GUNBARREL"
    curve.align_x = "CENTER"
    curve.align_y = "CENTER"
    curve.size = 0.32
    curve.extrude = 0.02
    text = bpy.data.objects.new("gunbarrel_text", curve)
    bpy.context.scene.collection.objects.link(text)
    deps = bpy.context.evaluated_depsgraph_get()
    me = bpy.data.meshes.new_from_object(text.evaluated_get(deps))
    bpy.data.objects.remove(text, do_unlink=True)
    # Text is built in Blender's XY plane facing +Z (Blender); orient it to face along d in game space.
    verts, faces = [], []
    rot = Matrix.Rotation(yaw, 3, "Y")
    for v in me.vertices:
        p = Vector((v.co.x, v.co.y + 0.35, v.co.z))  # game: x right, y up, z toward the viewer
        verts.append(tuple(rot @ p + centre + d * 0.1))
    for poly in me.polygons:
        faces.append(tuple(poly.vertices))
    bpy.data.meshes.remove(me)
    k.add("sign_cream", verts, faces)
    # Revolver and mug suggested by two small shapes under the lettering.
    k.box("sign_cream", (0.5, 0.12, 0.03), tuple(rot @ Vector((-0.25, -0.2, 0)) + centre + d * 0.1), (0, yaw, 0))
    k.box("sign_cream", (0.26, 0.34, 0.03), tuple(rot @ Vector((0.35, -0.3, 0)) + centre + d * 0.1), (0, yaw, 0))
    # Chains to the porch beam.
    for s in (-0.8, 0.8):
        p = rot @ Vector((s, 1.1, 0)) + centre
        k.cyl("trim", tuple(p), tuple(p + Vector((0, 0.9, 0))), 0.02, seg=4)


def flag(k, at, yaw):
    x, y, z = at
    k.cyl("log", (x, y - 0.3, z), (x, y + 8.5, z), 0.08, seg=8)
    from mathutils import Matrix
    rot = Matrix.Rotation(yaw + math.pi / 2, 3, "Y")
    o = Vector((x, y + 7.2, z))
    for i, (mat, w) in enumerate((("flag_red", 0.45), ("flag_white", 0.9), ("flag_red", 0.45))):
        x0 = 0.1 + sum(ww for _, ww in [("", 0.45), ("", 0.9), ("", 0.45)][:i])
        quad = [rot @ Vector((x0, -0.45, 0)) + o, rot @ Vector((x0 + w, -0.45, 0)) + o, rot @ Vector((x0 + w, 0.45, 0)) + o, rot @ Vector((x0, 0.45, 0)) + o]
        k.add(mat, [tuple(p) for p in quad], [(0, 1, 2, 3), (3, 2, 1, 0)])
    # Maple leaf: a small red diamond in the white field.
    leaf = [rot @ Vector((0.55 + dx, dy, 0.005)) + o for dx, dy in ((0, -0.25), (0.22, 0), (0, 0.28), (-0.22, 0))]
    k.add("flag_red", [tuple(p) for p in leaf], [(0, 1, 2, 3), (3, 2, 1, 0)])


# ---- Apex Mountain Inn -------------------------------------------------------------------------

def lap_texture(name, base, size=256, courses=10, seed=9):
    """Horizontal lap siding: courses with a shadow line under each board."""
    rng = np.random.default_rng(seed)
    b = np.array(srgb_to_linear(base))
    u = np.linspace(0, 1, size, endpoint=False)
    U, V = np.meshgrid(u, u)
    frac = (V * courses) % 1
    course = np.floor(V * courses).astype(int)
    tone = rng.uniform(0.92, 1.06, courses)[course]
    shade = tone * (0.72 + 0.28 * np.clip(frac / 0.18, 0, 1)) + 0.025 * rng.standard_normal((size, size))
    px = np.clip(b[None, None, :] * shade[..., None], 0, 1)
    rgba = np.concatenate([px, np.ones((size, size, 1))], axis=2).astype(np.float32)
    old = bpy.data.images.get(name)
    if old:
        bpy.data.images.remove(old)
    img = bpy.data.images.new(name, size, size, float_buffer=True)
    img.pixels = rgba.ravel()
    img.update()
    return img


def apex_inn():
    """Four-storey ochre lodge: lap siding, stone base, framed windows, staggered balconies, snowy gables."""
    fp = FOOTPRINTS["Apex Mountain Inn"]
    ring = [tuple(p) for p in fp["ring"]]
    ground = Ground(fp["terrain"])
    textured("lap_ochre", lap_texture("tex_lap_ochre", "#c99a3e"))
    root = asset_root("apex_inn")
    walls = Kit("apex_inn_walls")
    k = Kit("apex_inn_detail")
    roofs = Kit("apex_inn_roof")
    along, across, (a0, a1), (c0, c1) = principal_axes(ring)
    storey = 2.9
    # Typical ground, not the highest point: one corner of the outline sits on a bank.
    first = float(np.median(fp["ground"])) + 0.5
    eaves = first + 4 * storey
    walls.prism("lap_ochre", ring, -0.6, eaves, cap_top=False)
    k.fill("trim", [(x, eaves, z) for x, z in ring])
    k.fill("trim", [(x, eaves, z) for x, z in ring], reverse=True)
    # Stone base course and dark trim at each floor line and the corners.
    base_ring = [(x * 1.006, z * 1.006) for x, z in ring]
    k.prism("stone", base_ring, -0.6, first + 0.4, cap_top=False)
    for f in range(1, 5):
        y = first + f * storey - 0.12
        k.loft("trim", [[(x * 1.004, y, z * 1.004) for x, z in ring], [(x * 1.004, y + 0.18, z * 1.004) for x, z in ring]], smooth=False)
    for x, z in ring:
        k.box("trim", (0.28, eaves + 0.6, 0.28), (x, eaves / 2 - 0.3, z))
    # Windows on every storey; balconies on the long faces, staggered floor to floor.
    n = len(ring)
    for i in range(n):
        x0, z0 = ring[i]
        x1, z1 = ring[(i + 1) % n]
        length = math.hypot(x1 - x0, z1 - z0)
        if length < 3.0:
            continue
        nx, nz = outward(ring, i)
        yaw = math.atan2(nx, nz)
        long_face = length > 25
        count = int(length // 3.2)
        for j in range(count):
            t = (j + 0.5) / count
            px, pz = x0 + (x1 - x0) * t, z0 + (z1 - z0) * t
            for f in range(4):
                y = first + f * storey + 1.45
                k.box("trim", (1.3, 1.6, 0.12), (px + nx * 0.04, y, pz + nz * 0.04), (0, yaw, 0))
                k.box("glass", (1.08, 1.38, 0.14), (px + nx * 0.06, y, pz + nz * 0.06), (0, yaw, 0))
                if long_face and f > 0 and (j + f) % 3 == 0:
                    balcony(k, (px, pz), (nx, nz), yaw, first + f * storey - 0.05)
    # Long gable roof over the main block, cross gables over the end wings.
    mid_a, mid_c = (a0 + a1) / 2, (c0 + c1) / 2
    half_w = (c1 - c0) / 2 + 1.0
    rise = half_w * math.tan(math.radians(30))
    cx, cz = to_world(along, across, mid_a, mid_c)
    yaw_ridge = math.atan2(along[0], along[1])
    gable_roof(roofs, (cx, eaves, cz), yaw_ridge, (a1 - a0) - 4, half_w, rise, snow=0.55)
    for end in (-1, 1):
        wx, wz = to_world(along, across, mid_a + end * ((a1 - a0) / 2 - 3.5), mid_c)
        gable_roof(roofs, (wx, eaves, wz), yaw_ridge + math.pi / 2, (c1 - c0) + 3.0, 4.6, 4.6 * math.tan(math.radians(34)), snow=0.5)
        # Gable end triangles.
        for side in (-1, 1):
            tip = to_world(along, across, mid_a + end * ((a1 - a0) / 2 - 3.5), mid_c + side * ((c1 - c0) / 2 + 0.2))
            l = to_world(along, across, mid_a + end * ((a1 - a0) / 2 - 3.5) - 4.0, mid_c + side * ((c1 - c0) / 2 + 0.2))
            r = to_world(along, across, mid_a + end * ((a1 - a0) / 2 - 3.5) + 4.0, mid_c + side * ((c1 - c0) / 2 + 0.2))
            tri = [(l[0], eaves, l[1]), (r[0], eaves, r[1]), (tip[0], eaves + 4.0 * math.tan(math.radians(34)), tip[1])]
            walls.add("lap_ochre", tri, [(0, 1, 2), (0, 2, 1)])
    for at in (-0.25, 0.2):
        chx, chz = to_world(along, across, mid_a + (a1 - a0) * at, mid_c)
        k.box("stone", (1.2, 2.4, 1.2), (chx, eaves + rise + 0.6, chz), (0, yaw_ridge, 0))
        k.box("snow", (1.3, 0.3, 1.3), (chx, eaves + rise + 1.9, chz), (0, yaw_ridge, 0))
    for kit in (walls, roofs, k):
        obj = kit.build(root)
        if kit is walls:
            uv_project(obj, 3.0)
    return root


def balcony(k, at, normal, yaw, floor_y):
    """A small timber balcony: slab, posts and a railing with pickets."""
    px, pz = at
    nx, nz = normal
    depth = 1.4
    cx, cz = px + nx * (depth / 2 + 0.05), pz + nz * (depth / 2 + 0.05)
    k.box("plank_deck", (2.6, 0.16, depth), (cx, floor_y, cz), (0, yaw, 0))
    k.box("snow", (2.5, 0.12, depth - 0.1), (cx, floor_y + 0.12, cz), (0, yaw, 0))
    ox, oz = px + nx * (depth + 0.05), pz + nz * (depth + 0.05)
    tx, tz = -nz, nx  # along the wall
    k.box("log_dark", (2.6, 0.08, 0.08), (ox, floor_y + 1.0, oz), (0, yaw, 0))
    for s in np.linspace(-1.25, 1.25, 9):
        k.box("log_dark", (0.05, 0.9, 0.05), (ox + tx * s, floor_y + 0.55, oz + tz * s))
    for s in (-1.25, 1.25):
        for d in (0.35, 0.95):
            k.box("log_dark", (0.06, 0.06, 0.06), (px + nx * (d + 0.05) + tx * s, floor_y + 1.0, pz + nz * (d + 0.05) + tz * s))


# ---- Build and export ---------------------------------------------------------------------------

def fresh_scene():
    old = bpy.data.scenes.get(SCENE)
    if old:
        for obj in list(old.objects):
            bpy.data.objects.remove(obj, do_unlink=True)
        bpy.data.scenes.remove(old)
    for coll in (bpy.data.meshes, bpy.data.materials, bpy.data.curves):
        for block in list(coll):
            if block.users == 0:
                coll.remove(block)
    scene = bpy.data.scenes.new(SCENE)
    if bpy.context.window:
        bpy.context.window.scene = scene
    return scene


BUILDERS = {"gunbarrel": gunbarrel, "apex_inn": apex_inn}


def export(path):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    for o in bpy.context.scene.objects:
        o.select_set(True)
    bpy.ops.export_scene.gltf(
        filepath=path, export_format="GLB", use_selection=True, use_active_scene=True,
        export_animations=False, export_skins=False, export_morph=False, export_yup=True,
        export_extras=False, export_vertex_color="NONE", export_attributes=False,
        export_image_format="JPEG", export_jpeg_quality=85,
    )
    return path


def build_buildings(names=None, out=None):
    fresh_scene()
    materials()
    report = {}
    for name in names or BUILDERS:
        root = BUILDERS[name]()
        report[name] = sum(triangle_count(c) for c in root.children)
    path = export(out or os.path.join(REPO, "game", "public", "models", "scenery", "buildings.glb"))
    report["bytes"] = os.path.getsize(path)
    return report


if __name__ == "__main__" and bpy.app.background:
    print(build_buildings())
