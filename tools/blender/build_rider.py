"""
Builds the SkiScrapeX rider: an armature on the game's bind pose and every
garment style as a skinned mesh, bakes its maps, and exports
game/public/models/rider.glb.

Run inside Blender (the Blender MCP or the Text editor):
    ns = {"REPO": r"<repo>"}
    exec(open(r"<repo>/tools/blender/build_rider.py").read(), ns)
    ns["build_all"]()
or from a shell:
    blender --background --python tools/blender/build_rider.py -- <repo>

The joints come from tools/blender/rig_rest.json, which a game test keeps in
step with skierModel.ts. Game space is +X the rider's left, +Y up, +Z
forward; Blender space is Z up with the rider facing -Y, so game (x, y, z)
is Blender (x, -z, y). The glTF exporter converts back. All shape code below
works in game space.

Each garment is one mesh with one material. Its colours are picked in the
game from three slots (base, accent, trim) using a baked mask texture:
R = accent, G = trim, B = ambient occlusion. A tangent-space normal map,
baked from a displaced high-detail copy, carries folds, seams, zips,
stitching, quilting and knit.

Everything lives in its own scene ("RiderBuild"), rebuilt on each run.
"""
import bpy
import bmesh
import json
import math
import os
import sys
import numpy as np
from mathutils import Vector, Matrix, noise

if "REPO" not in globals():
    REPO = sys.argv[sys.argv.index("--") + 1] if "--" in sys.argv else os.getcwd()

HERE = os.path.join(REPO, "tools", "blender")
OUT_DIR = os.path.join(REPO, "game", "public", "models")
SCENE = "RiderBuild"


def g2b(p):
    """Game space to Blender space."""
    return Vector((p[0], -p[2], p[1]))


def b2g(p):
    return Vector((p[0], p[2], -p[1]))


def smoothstep(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0.0, 1.0)
    return t * t * (3 - 2 * t)


def sstep(e0, e1, x):
    t = max(0.0, min(1.0, (x - e0) / (e1 - e0)))
    return t * t * (3 - 2 * t)


# ---- Joints ---------------------------------------------------------------------

JOINTS = json.load(open(os.path.join(HERE, "rig_rest.json")))
J = {j["name"]: Vector(j["head"]) for j in JOINTS}
PARENT = {j["name"]: j["parent"] for j in JOINTS}
SHIN_LENGTH = 0.42
HAND_LENGTH = 0.1
ARM_SPREAD = 0.6  # REST_ARM_SPREAD in skierModel.ts


def tail(name):
    """Bone tail in game space: the next joint down the chain, or a short stub."""
    s = name[-1]
    chain = {"hips": "spine", "spine": "chest", "chest": "head"}
    if name in chain:
        return J[chain[name]]
    if name.startswith("thigh"):
        return J["shin_" + s]
    if name.startswith("upperarm"):
        return J["forearm_" + s]
    if name.startswith("forearm"):
        return J["hand_" + s]
    if name.startswith("shin"):
        return J[name] + (J[name] - J["thigh_" + s]).normalized() * SHIN_LENGTH
    if name.startswith("hand"):
        return J[name] + (J[name] - J["forearm_" + s]).normalized() * HAND_LENGTH
    stub = {"head": (0, 0.25, 0), "hood": (0, -0.05, -0.08), "pack": (0, -0.2, 0), "pom": (0, 0.06, 0)}
    return J[name] + Vector(stub.get(name, (0, -0.08, 0)))


# Segments used for distance-based skin weights. The pelvis reaches the crotch.
SEG = {n: (J[n], tail(n)) for n in J}
SEG["hips"] = (Vector((0, 0.98, 0)), J["spine"])


def ankle(side):
    return tail("shin_" + side)


def wrist(side):
    return J["hand_" + side]


def seg_param(p, name):
    a, b = SEG[name]
    ab = b - a
    t = max(0.0, min(1.0, (p - a).dot(ab) / max(ab.length_squared, 1e-9)))
    foot = a + ab * t
    return (p - foot).length, t, foot


def hand_matrix(side):
    """Rest-pose world transform of a hand bone, game space (rotated about Z by the A-pose)."""
    sgn = 1 if side == "L" else -1
    return Matrix.Translation(J["hand_" + side]) @ Matrix.Rotation(sgn * ARM_SPREAD, 4, "Z")


def head_matrix():
    return Matrix.Translation(J["head"])


# ---- Scene ----------------------------------------------------------------------

def fresh_scene():
    old = bpy.data.scenes.get(SCENE)
    if old:
        for obj in list(old.objects):
            bpy.data.objects.remove(obj, do_unlink=True)
        bpy.data.scenes.remove(old)
    for coll in (bpy.data.meshes, bpy.data.materials, bpy.data.images, bpy.data.armatures):
        for block in list(coll):
            if block.users == 0:
                coll.remove(block)
    scene = bpy.data.scenes.new(SCENE)
    if bpy.context.window:
        bpy.context.window.scene = scene
    scene.render.engine = "CYCLES"
    scene.cycles.samples = 16
    scene.cycles.device = "CPU"
    return scene


def link(obj):
    bpy.context.scene.collection.objects.link(obj)
    return obj


def select_only(*objs, active=None):
    for o in bpy.context.scene.objects:
        o.select_set(False)
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = active or objs[0]


def build_armature():
    data = bpy.data.armatures.new("RiderRig")
    arm = link(bpy.data.objects.new("RiderRig", data))
    select_only(arm)
    bpy.ops.object.mode_set(mode="EDIT")
    for j in JOINTS:
        b = data.edit_bones.new(j["name"])
        b.head = g2b(J[j["name"]])
        b.tail = g2b(tail(j["name"]))
    for j in JOINTS:
        if j["parent"]:
            data.edit_bones[j["name"]].parent = data.edit_bones[j["parent"]]
    bpy.ops.object.mode_set(mode="OBJECT")
    return arm


# ---- Geometry builders (game space) ------------------------------------------------

class Parts:
    """Collects pieces of a garment as one bmesh, each tagged with the bones it may follow."""

    def __init__(self):
        self.bm = bmesh.new()
        self.tag = self.bm.verts.layers.int.new("piece")
        self.pieces = []

    def add_mesh(self, me, piece):
        """Append a Blender mesh (already in Blender space)."""
        index = len(self.pieces)
        self.pieces.append(piece)
        temp = bmesh.new()
        temp.from_mesh(me)
        layer = temp.verts.layers.int.new("piece")
        for v in temp.verts:
            v[layer] = index
        temp.to_mesh(me)
        temp.free()
        self.bm.from_mesh(me)
        bpy.data.meshes.remove(me)
        # from_mesh drops our layer handle; re-fetch it.
        self.tag = self.bm.verts.layers.int.get("piece")

    def add_bm(self, bm, piece, fn=None):
        """Append a bmesh built at the origin in game space, mapped through fn(game Vector)."""
        if fn:
            for v in bm.verts:
                v.co = g2b(fn(Vector(v.co)))
        else:
            for v in bm.verts:
                v.co = g2b(v.co)
        # Solidify and the axis swaps can leave faces pointing inward; AO and normals need them out.
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
        me = bpy.data.meshes.new("piece")
        bm.to_mesh(me)
        bm.free()
        for poly in me.polygons:
            poly.use_smooth = True
        self.add_mesh(me, piece)

    def to_object(self, name):
        me = bpy.data.meshes.new(name)
        self.bm.to_mesh(me)
        self.bm.free()
        obj = link(bpy.data.objects.new(name, me))
        obj["pieces"] = json.dumps(self.pieces)
        return obj


def skin_graph(nodes, edges, subdiv=2, branch=0.6):
    """
    Continuous tube mesh from (game position, (rx, rz)) nodes through Skin and
    Subdivision Surface; returns a Blender mesh in Blender space.
    rx is across the body, rz front to back.
    """
    me = bpy.data.meshes.new("skin")
    me.from_pydata([g2b(p) for p, _ in nodes], edges, [])
    obj = link(bpy.data.objects.new("skin", me))
    mod = obj.modifiers.new("Skin", "SKIN")
    mod.use_smooth_shade = True
    mod.branch_smoothing = branch
    layer = me.skin_vertices[0].data
    for i, (_, r) in enumerate(nodes):
        layer[i].radius = r
        layer[i].use_root = i == 0
    if subdiv:
        sub = obj.modifiers.new("Sub", "SUBSURF")
        sub.levels = subdiv
        sub.render_levels = subdiv
    deps = bpy.context.evaluated_depsgraph_get()
    out = bpy.data.meshes.new_from_object(obj.evaluated_get(deps))
    bpy.data.objects.remove(obj, do_unlink=True)
    bpy.data.meshes.remove(me)
    return out


class Graph:
    def __init__(self):
        self.nodes = []
        self.edges = []

    def add(self, p, r, parent=None):
        self.nodes.append((Vector(p), r))
        i = len(self.nodes) - 1
        if parent is not None:
            self.edges.append((parent, i))
        return i

    def chain(self, points, parent=None):
        ids = []
        for p, r in points:
            parent = self.add(p, r, parent)
            ids.append(parent)
        return ids

    def mesh(self, subdiv=2, branch=0.6):
        return skin_graph(self.nodes, self.edges, subdiv, branch)


def lerp(a, b, t):
    return a + (b - a) * t


def sphere(r, seg=16, rings=10):
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=seg, v_segments=rings, radius=r)
    # Poles on game Y, like cylinder().
    for v in bm.verts:
        x, y, z = v.co
        v.co = Vector((x, z, -y))
    return bm


def cylinder(r0, r1, h, seg=16, caps=True):
    """Along +Y (game up), centred."""
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=caps, segments=seg, radius1=r1, radius2=r0, depth=h)
    # create_cone builds along Blender Z with radius1 at -Z; we treat bm coords as game coords,
    # so swap Z (axis) into Y.
    for v in bm.verts:
        x, y, z = v.co
        v.co = Vector((x, z, -y))
    return bm


def surface_grid(nu, nv, fn, thickness=0.0):
    """A surface from fn(u in -1..1, v in -1..1) -> game point, optionally solidified."""
    bm = bmesh.new()
    rows = [[bm.verts.new(fn(-1 + 2 * i / nu, -1 + 2 * j / nv)) for j in range(nv + 1)] for i in range(nu + 1)]
    for i in range(nu):
        for j in range(nv):
            bm.faces.new((rows[i][j], rows[i + 1][j], rows[i + 1][j + 1], rows[i][j + 1]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    if thickness:
        bmesh.ops.solidify(bm, geom=list(bm.faces), thickness=thickness)
    return bm


def lathe(profile, seg=16, sx=1.0, sz=1.0):
    """Surface of revolution about game Y from (radius, y) pairs, bottom to top."""
    bm = bmesh.new()
    rings = []
    for r, y in profile:
        ring = [bm.verts.new((r * sx * math.sin(2 * math.pi * k / seg), y, r * sz * math.cos(2 * math.pi * k / seg))) for k in range(seg)]
        rings.append(ring)
    for a, b in zip(rings, rings[1:]):
        for k in range(seg):
            bm.faces.new((a[k], a[(k + 1) % seg], b[(k + 1) % seg], b[k]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    return bm


def box(w, h, d, bevel=0.0):
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    for v in bm.verts:
        v.co = Vector((v.co.x * w, v.co.y * h, v.co.z * d))
    if bevel > 0:
        bmesh.ops.bevel(bm, geom=list(bm.edges), offset=bevel, segments=2, affect="EDGES")
    return bm


def torus(R, r, seg=24, sides=8):
    bm = bmesh.new()
    verts = []
    for i in range(seg):
        a = 2 * math.pi * i / seg
        ring = []
        for k in range(sides):
            b = 2 * math.pi * k / sides
            ring.append(bm.verts.new(((R + r * math.cos(b)) * math.cos(a), r * math.sin(b), (R + r * math.cos(b)) * math.sin(a))))
        verts.append(ring)
    for i in range(seg):
        for k in range(sides):
            a, b = verts[i][k], verts[(i + 1) % seg][k]
            c, d = verts[(i + 1) % seg][(k + 1) % sides], verts[i][(k + 1) % sides]
            bm.faces.new((a, b, c, d))
    return bm


def shell(bm, keep):
    """Delete faces whose centre fails keep(game point)."""
    dead = [f for f in bm.faces if not keep(f.calc_center_median())]
    bmesh.ops.delete(bm, geom=dead, context="FACES")
    return bm


def subdivide(bm, cuts=1, smooth=1.0):
    bmesh.ops.subdivide_edges(bm, edges=list(bm.edges), cuts=cuts, use_grid_fill=True, smooth=smooth)
    return bm


def radial(me, fn):
    """
    Push each vertex of a mesh (Blender space) out from the nearest bone axis
    by fn(game point, bone, t, outward unit vector) metres.
    """
    for v in me.vertices:
        p = b2g(v.co)
        best = None
        for name in ("hips", "spine", "chest", "thigh_L", "thigh_R", "shin_L", "shin_R", "upperarm_L", "upperarm_R", "forearm_L", "forearm_R"):
            d, t, foot = seg_param(p, name)
            if best is None or d < best[0]:
                best = (d, name, t, foot)
        d, name, t, foot = best
        out = (p - foot).normalized() if d > 1e-6 else Vector((0, 0, 1))
        p2 = p + out * fn(p, name, t, out)
        v.co = g2b(p2)


# ---- Garments -----------------------------------------------------------------------
#
# Each builder returns (Parts, shape) where Parts holds the low-poly pieces. A piece is
# {"bones": [...], "role": optional fixed bone weights}. Bones not listed are never used.

TORSO_BONES = ["hips", "spine", "chest", "upperarm_L", "upperarm_R", "forearm_L", "forearm_R"]
LEG_BONES = ["hips", "thigh_L", "thigh_R", "shin_L", "shin_R"]


def arm_points(side, cuff_back=0.02, sizes=(0.085, 0.075, 0.068, 0.064)):
    sh = J["upperarm_" + side]
    el = J["forearm_" + side]
    wr = wrist(side)
    d = (wr - el).normalized()
    inset = Vector((-0.02 if side == "L" else 0.02, 0, 0))
    return [
        (sh + inset, (sizes[0], sizes[0])),
        (lerp(sh, el, 0.5), (sizes[1] * 1.04, sizes[1])),
        (el, (sizes[1], sizes[1])),
        (lerp(el, wr, 0.55), (sizes[2], sizes[2])),
        (wr - d * cuff_back, (sizes[3], sizes[3])),
    ]


def jacket(spec):
    """
    A torso tube from the hem to the collar with sleeves branching at the shoulders.
    spec: hem, waist (rx, rz), chest (rx, rz), shoulder, sleeve sizes, collar, hood.
    """
    g = Graph()
    hem = spec["hem"]
    wx, wz = spec["waist"]
    cx, cz = spec["chest"]
    rows = [
        (hem, (wx * spec.get("hem_k", 1.0), wz * spec.get("hem_k", 1.0))),
        (hem + 0.05, (wx, wz)),
    ]
    for y in (0.94, 1.06, 1.18, 1.3, 1.42, 1.52):
        if y > hem + 0.09:
            t = sstep(1.18, 1.5, y)
            rows.append((y, (lerp(wx, cx, t), lerp(wz, cz, t))))
    rows += [
        (1.6, (cx * 0.98, cz * 0.98)),
        (1.68, (cx * 0.78, cz * 0.86)),
        (1.74, (spec["collar"][0], spec["collar"][0])),
        # Subdivision rounds the end of the tube down by a few centimetres; aim above the top.
        (spec["collar"][1] + 0.045, (spec["collar"][0] * 0.97, spec["collar"][0] * 0.97)),
    ]
    ids = g.chain([((0, y, -0.005), r) for y, r in rows])
    branch = ids[[r[0] for r in rows].index(1.6)]
    for side in ("L", "R"):
        g.chain(arm_points(side, sizes=spec["sleeve"]), branch)
    parts = Parts()
    me = g.mesh(subdiv=2)
    radial(me, torso_sculpt(spec))
    if spec.get("shape"):
        radial(me, spec["shape"])
    open_collar(me, spec["collar"][1])
    dip_hem(me, hem, spec.get("hem_dip", 0.035))
    parts.add_mesh(me, {"bones": TORSO_BONES + ["hem_F", "hem_B"], "hem": hem})
    if spec.get("hood"):
        add_hood(parts, *spec["hood"])
    if spec.get("cords"):
        for s in ("L", "R"):
            base = J["cord_" + s]
            # Kept out of the bake source, or the chest bakes the cords' shadow.
            piece = {"bones": ["cord_" + s], "rigid": "cord_" + s, "nobake": True}
            parts.add_bm(cylinder(0.006, 0.006, 0.17, seg=6), piece, lambda p, b=base: b + Vector((0, -0.085, 0.012)) + p)
            parts.add_bm(sphere(0.011, 8, 6), piece, lambda p, b=base: b + Vector((0, -0.172, 0.012)) + p)
    return parts


def gauss(x, mu, sigma):
    return math.exp(-(((x - mu) / sigma) ** 2))


def torso_sculpt(spec):
    """Chest, shoulder blades and a waist on the torso tube, so it stops reading as a can."""
    pinch = spec.get("pinch", 0.008)

    def fn(p, bone, t, out):
        if bone not in ("hips", "spine", "chest"):
            # Sleeves: a little extra at the deltoid and the elbow, slimmer at the wrist.
            if bone.startswith("upperarm"):
                return 0.008 * gauss(t, 0.15, 0.2)
            return -0.004 * sstep(0.5, 1.0, t)
        h = 0.0
        h += 0.014 * gauss(p.y, 1.47, 0.09) * max(0.0, out.z) ** 1.5      # chest
        h += 0.012 * gauss(p.y, 1.55, 0.08) * max(0.0, -out.z)             # shoulder blades
        h -= pinch * gauss(p.y, 1.2, 0.09) * abs(out.x)                    # waist
        h += 0.006 * gauss(p.y, 1.06, 0.06) * max(0.0, -out.z)             # seat drape
        # Sloping shoulders: pull the top of the torso in toward the neck at the sides.
        h -= 0.025 * sstep(1.62, 1.7, p.y) * sstep(1.79, 1.73, p.y) * abs(out.x) * sstep(0.05, 0.16, abs(p.x))
        return h
    return fn


def pants_sculpt(p, bone, t, out):
    """Seat, a fuller front thigh, a kneecap and a slimmer ankle."""
    h = 0.0
    if bone in ("hips", "spine"):
        h += 0.016 * gauss(p.y, 1.04, 0.07) * max(0.0, -out.z)
    elif bone.startswith("thigh"):
        h += 0.012 * gauss(t, 0.05, 0.2) * max(0.0, -out.z)    # seat carries onto the thigh
        h += 0.008 * gauss(t, 0.45, 0.25) * max(0.0, out.z)    # quads
        h += 0.008 * gauss(t, 0.97, 0.08) * max(0.0, out.z)    # kneecap
    elif bone.startswith("shin"):
        h += 0.006 * gauss(t, 0.35, 0.2) * max(0.0, -out.z)    # calf
    return h


def open_collar(me, top):
    """
    The Skin modifier caps the collar. Open it and turn the edge in, so the collar
    is a funnel with a lip the gaiter sits in, not a lid around the neck.
    """
    bm = bmesh.new()
    bm.from_mesh(me)
    bm.normal_update()
    # The real top after subdivision, rather than the node height.
    top = max(b2g(v.co).y for v in bm.verts if abs(b2g(v.co).x) < 0.2)
    cap = [f for f in bm.faces if b2g(f.calc_center_median()).y > top - 0.02 and b2g(f.normal).y > 0.5 and abs(b2g(f.calc_center_median()).x) < 0.2]
    bmesh.ops.delete(bm, geom=cap, context="FACES")
    rim = [e for e in bm.edges if e.is_boundary and b2g(e.verts[0].co).y > top - 0.05]
    if rim:
        made = bmesh.ops.extrude_edge_only(bm, edges=rim)
        centre = Vector((0, 0, 0))
        new = [v for v in made["geom"] if isinstance(v, bmesh.types.BMVert)]
        for v in new:
            centre += v.co
        centre /= max(1, len(new))
        for v in new:
            g = b2g(v.co)
            c = b2g(centre)
            inward = Vector((c.x - g.x, 0, c.z - g.z))
            if inward.length > 1e-6:
                inward.normalize()
            v.co = g2b(g + inward * 0.012 + Vector((0, -0.05, 0)))
    bm.normal_update()
    bm.to_mesh(me)
    bm.free()


def dip_hem(me, hem, dip):
    """Jackets hang lower at the back than the front."""
    for v in me.vertices:
        p = b2g(v.co)
        if p.y > hem + 0.12 or abs(p.x) > 0.3:
            continue
        k = sstep(hem + 0.12, hem, p.y)
        back = sstep(0.04, -0.1, p.z)
        front = sstep(-0.02, 0.12, p.z)
        p.y += k * (-dip * back + dip * 0.3 * front)
        v.co = g2b(p)


def add_hood(parts, size, depth, pitch):
    """
    A hood folded down: a thick flap that wraps the back of the neck and lies on
    the upper back, longest at the centre, with a rolled top edge. `size` scales
    its spread, `depth` how far it sits off the back, `pitch` is unused (kept for
    the style table).
    """
    k = size / 0.12
    neck = J["hood"] + Vector((0, 0.0, 0.1))  # the hood bone sits behind the neck; wrap round the neck axis

    def point(u, v):
        t = (v + 1) / 2                      # 0 at the rolled top edge, 1 at the bottom of the flap
        phi = math.pi + u * 1.35             # round the back of the neck
        top = 1.83
        bottom = 1.63 + 0.09 * u * u          # shorter at the sides
        y = top + (bottom - top) * t
        r = 0.122 + 0.05 * t * k + 0.018 * math.sin(math.pi * min(1.0, t * 1.6)) * depth - 0.03 * sstep(0.55, 1.0, t)
        return Vector((neck.x + r * 1.05 * math.sin(phi), y, neck.z + r * math.cos(phi) - 0.01))

    parts.add_bm(surface_grid(18, 6, point, thickness=-0.02), {"bones": ["hood", "chest"], "rigid": "hood"})


def pants(spec):
    g = Graph()
    wx, wz = spec["waist"]
    top = g.chain([((0, 1.2, 0), (wx * 0.95, wz * 0.95)), ((0, 1.1, 0), (wx, wz)), ((0, 1.0, 0), (wx * 0.92, wz * 0.95))])
    crotch = top[-1]
    for side in ("L", "R"):
        th = J["thigh_" + side]
        kn = J["shin_" + side]
        an = ankle(side)
        d = (an - kn).normalized()
        t0, t1, k, c, h = spec["leg"]
        g.chain([
            (lerp(th, kn, 0.18) + Vector((0, -0.04, 0)), (t0, t0)),
            (lerp(th, kn, 0.6), (t1, t1)),
            (kn, (k, k * 1.04)),
            (lerp(kn, an, 0.5), (c, c)),
            (an - d * spec.get("hem_up", 0.05), (h, h)),
        ], crotch)
    parts = Parts()
    me = g.mesh(subdiv=2)
    radial(me, pants_sculpt)
    if spec.get("shape"):
        radial(me, spec["shape"])
    parts.add_mesh(me, {"bones": LEG_BONES})
    return parts


def gloves(kind):
    parts = Parts()
    for side, sgn in (("L", 1), ("R", -1)):
        m = hand_matrix(side)
        piece = {"bones": ["hand_" + side], "rigid": "hand_" + side}
        place = lambda p, m=m: m @ p
        if kind == "pipe":
            cuff = cylinder(0.05, 0.046, 0.05, seg=14)
            for v in cuff.verts:
                v.co.y += 0.035
        else:
            cuff = cylinder(0.062 if kind == "mitt" else 0.058, 0.052, 0.085, seg=16)
            for v in cuff.verts:
                v.co.y += 0.035
        parts.add_bm(cuff, piece, place)
        # Palm and knuckles: a rounded fist around the pole grip.
        palm = sphere(1.0, 16, 10)
        w, h, d = (0.048, 0.06, 0.05) if kind == "mitt" else (0.043, 0.055, 0.045) if kind == "glove" else (0.038, 0.05, 0.04)
        for v in palm.verts:
            v.co = Vector((v.co.x * w, v.co.y * h - 0.035, v.co.z * d))
        parts.add_bm(palm, piece, place)
        # Fingers wrapped around the grip: one mitten pad or four rolls.
        if kind == "mitt":
            pad = sphere(1.0, 14, 8)
            for v in pad.verts:
                v.co = Vector((v.co.x * 0.046 + sgn * 0.012, v.co.y * 0.05 - 0.045, v.co.z * 0.03 + 0.04))
            parts.add_bm(pad, piece, place)
        else:
            r = 0.012 if kind == "glove" else 0.0105
            for k in range(4):
                f = cylinder(r, r * 0.92, 0.07, seg=8)
                y = -0.012 - k * 0.019
                for v in f.verts:
                    # Lie the finger across the palm (along X), curled toward +Z.
                    x, yy, z = v.co
                    v.co = Vector((yy + sgn * 0.004, x + y, z + 0.038))
                parts.add_bm(f, piece, place)
        thumb = cylinder(0.017 if kind == "mitt" else 0.014, 0.013, 0.055, seg=8)
        for v in thumb.verts:
            x, y, z = v.co
            a = -sgn * 0.8
            v.co = Vector((x * math.cos(a) - y * math.sin(a) - sgn * 0.035, x * math.sin(a) + y * math.cos(a) - 0.01, z + 0.03))
        parts.add_bm(thumb, piece, place)
    return parts


def head_part(kind):
    parts = Parts()
    hm = head_matrix()
    rigid = {"bones": ["head"], "rigid": "head"}
    place = lambda p: hm @ p
    if kind == "face":
        skull = sphere(0.105, 20, 14)
        for v in skull.verts:
            v.co = Vector((v.co.x * 0.92, v.co.y * 1.08 + 0.135, v.co.z))
        parts.add_bm(skull, rigid, place)
        # Neck gaiter pulled up over the nose to just under the goggles.
        # Wide where it tucks into the collar, slack folds round the neck, snug over the chin and nose.
        # Slim below the chin so high collars sit outside it.
        profile = [(0.084, -0.08), (0.082, -0.05), (0.08, -0.015), (0.084, 0.02), (0.084, 0.04), (0.095, 0.07), (0.1, 0.095), (0.094, 0.108), (0.05, 0.113), (0.001, 0.114)]
        gaiter = lathe(profile, 24, sx=0.97, sz=1.04)
        for v in gaiter.verts:
            # The chin pushes the front forward; the back of the neck stays slim.
            front = max(0.0, v.co.z) / 0.1
            v.co.z += 0.012 * front * sstep(0.0, 0.06, v.co.y) * sstep(0.11, 0.07, v.co.y)
        parts.add_bm(gaiter, {"bones": ["head", "chest"], "neck": True}, place)
        nose = sphere(0.022, 10, 8)
        for v in nose.verts:
            v.co = Vector((v.co.x * 0.75, v.co.y * 1.1 + 0.115, v.co.z * 0.9 + 0.1))
        parts.add_bm(nose, rigid, place)
    elif kind == "helmet":
        dome = sphere(0.134, 28, 16)
        # Brim level with the top of the goggles at the front, sweeping down over the ears.
        shell(dome, lambda c: c.y > lerp(0.032, -0.045, sstep(0.75, 1.4, math.atan2(abs(c.x), c.z))))
        for v in dome.verts:
            v.co = Vector((v.co.x, v.co.y * 1.0, v.co.z * 1.1))
        for v in dome.verts:
            v.co.y += 0.165
        # Shell thickness: solidify.
        bmesh.ops.solidify(dome, geom=list(dome.faces), thickness=-0.012)
        parts.add_bm(dome, rigid, place)
        for s in (1, -1):
            ear = sphere(1.0, 12, 8)
            for v in ear.verts:
                v.co = Vector((v.co.x * 0.012 + s * 0.127, v.co.y * 0.045 + 0.12, v.co.z * 0.043 - 0.012))
            parts.add_bm(ear, rigid, place)
    elif kind == "beanie":
        cap = sphere(0.124, 24, 14)
        shell(cap, lambda c: c.y > -0.02)
        for v in cap.verts:
            v.co = Vector((v.co.x * 1.02, v.co.y * 1.0 + 0.15, v.co.z * 1.07))
        bmesh.ops.solidify(cap, geom=list(cap.faces), thickness=-0.01)
        parts.add_bm(cap, rigid, place)
        cuff = cylinder(0.129, 0.131, 0.055, seg=24, caps=False)
        for v in cuff.verts:
            v.co = Vector((v.co.x, v.co.y + 0.155, v.co.z * 1.07))
        bmesh.ops.solidify(cuff, geom=list(cuff.faces), thickness=0.008)
        parts.add_bm(cuff, rigid, place)
        pom = sphere(0.045, 14, 10)
        pb = J["pom"] - J["head"]
        for v in pom.verts:
            v.co = Vector((v.co.x, v.co.y, v.co.z)) + pb + Vector((0, 0.005, 0))
        parts.add_bm(pom, {"bones": ["pom"], "rigid": "pom"}, place)
    elif kind == "cap":
        crown = sphere(0.122, 24, 14)
        shell(crown, lambda c: c.y > -0.01)
        for v in crown.verts:
            v.co = Vector((v.co.x, v.co.y * 0.95 + 0.17, v.co.z * 1.07))
        bmesh.ops.solidify(crown, geom=list(crown.faces), thickness=-0.008)
        parts.add_bm(crown, rigid, place)
        brim = cylinder(0.11, 0.11, 0.008, seg=20)
        for v in brim.verts:
            v.co = Vector((v.co.x * 0.95, v.co.y + 0.175 - v.co.z * 0.03, v.co.z * 0.75 + 0.15))
        shell(brim, lambda c: True)
        parts.add_bm(brim, rigid, place)
        button = sphere(0.012, 8, 6)
        for v in button.verts:
            v.co.y += 0.29
        parts.add_bm(button, rigid, place)
    elif kind == "goggles":
        # A frame wrapped round the face: tall at the middle with a nose cut-out,
        # tapering to rounded ends at the temples; lens set into it; strap round the back.
        reach = 1.22

        def goggle_point(a, v, grow=0.0, inset=1.0):
            a *= inset
            t = abs(a) / reach
            half = 0.037 * (1 - 0.3 * t * t) * math.sqrt(max(0.0, 1 - t ** 8)) * inset
            bottom = -half + 0.024 * math.exp(-((a / 0.2) ** 2))
            y = 0.157 + bottom + (half - bottom) * (v + 1) / 2
            r = 0.128 + grow
            return Vector((r * math.sin(a), y, r * 1.1 * math.cos(a) - 0.004))

        parts.add_bm(surface_grid(30, 4, lambda u, v: goggle_point(u * reach, v), thickness=-0.013), rigid, place)
        lens = surface_grid(26, 3, lambda u, v: goggle_point(u * reach, v * 0.8, grow=0.016, inset=0.92))
        parts.add_bm(lens, {"bones": ["head"], "rigid": "head", "material": "lens"}, place)
        end_a = reach * 0.97
        strap = surface_grid(22, 1, lambda u, v: Vector((0.137 * math.sin(math.pi + (math.pi - end_a) * u), 0.158 + v * 0.017, 0.152 * math.cos(math.pi + (math.pi - end_a) * u))), thickness=0.003)
        parts.add_bm(strap, rigid, place)
    return parts


# ---- Styles -------------------------------------------------------------------------

def puff(step, depth):
    """Quilted baffles: bulge between stitch lines every `step` metres along the bone."""
    def fn(p, bone, t, out):
        s = p.y if bone in ("hips", "spine", "chest") else (t * (SEG[bone][1] - SEG[bone][0]).length)
        phase = (s / step) % 1.0
        return depth * (math.sin(math.pi * phase) ** 0.6 - 0.6)
    return fn


def flare_hem(amount):
    def fn(p, bone, t, out):
        return amount * sstep(1.1, 0.85, p.y) if bone in ("hips", "spine") else 0.0
    return fn


def baggy_pants(p, bone, t, out):
    # Loose fabric pooling over the boot and bagging at the knee.
    if bone.startswith("shin"):
        return 0.018 * sstep(0.55, 1.0, t)
    if bone.startswith("thigh"):
        return 0.008 * math.sin(math.pi * t)
    return 0.0


GARMENTS = {
    # Jackets
    "jacket_shell": dict(kind="jacket", tex=1024, spec=dict(hem=1.0, waist=(0.205, 0.15), chest=(0.215, 0.158), collar=(0.118, 1.875), sleeve=(0.088, 0.077, 0.07, 0.066), hood=(0.115, 1.0, -0.4))),
    "jacket_parkrat": dict(kind="jacket", tex=1024, spec=dict(hem=0.8, hem_k=1.05, waist=(0.235, 0.172), chest=(0.235, 0.17), collar=(0.112, 1.79), sleeve=(0.098, 0.09, 0.085, 0.08), hood=(0.13, 1.15, -0.25), shape=flare_hem(0.02))),
    "jacket_racer": dict(kind="jacket", tex=1024, spec=dict(hem=1.06, waist=(0.182, 0.13), chest=(0.198, 0.142), collar=(0.118, 1.88), sleeve=(0.074, 0.064, 0.058, 0.055))),
    "jacket_hoodie": dict(kind="jacket", tex=1024, spec=dict(hem=0.98, hem_k=0.94, waist=(0.212, 0.155), chest=(0.218, 0.158), collar=(0.105, 1.78), sleeve=(0.09, 0.082, 0.075, 0.062), hood=(0.128, 1.1, -0.3), cords=True)),
    "jacket_puffer": dict(kind="jacket", tex=1024, spec=dict(hem=1.02, waist=(0.215, 0.16), chest=(0.225, 0.168), collar=(0.122, 1.865), sleeve=(0.094, 0.084, 0.078, 0.07), shape=puff(0.085, 0.012))),
    # Pants
    "pants_baggy": dict(kind="pants", tex=1024, spec=dict(waist=(0.19, 0.145), leg=(0.118, 0.108, 0.1, 0.098, 0.106), shape=baggy_pants)),
    "pants_slim": dict(kind="pants", tex=1024, spec=dict(waist=(0.175, 0.13), leg=(0.1, 0.09, 0.083, 0.08, 0.084))),
    "pants_race": dict(kind="pants", tex=1024, spec=dict(waist=(0.165, 0.122), leg=(0.093, 0.083, 0.076, 0.072, 0.074), hem_up=0.09)),
    # Hands
    "gloves_mitt": dict(kind="gloves", tex=512, spec="mitt"),
    "gloves_glove": dict(kind="gloves", tex=512, spec="glove"),
    "gloves_pipe": dict(kind="gloves", tex=512, spec="pipe"),
    # Head
    "head_face": dict(kind="head", tex=512, spec="face"),
    "head_goggles": dict(kind="head", tex=512, spec="goggles"),
    "head_helmet": dict(kind="head", tex=512, spec="helmet"),
    "head_beanie": dict(kind="head", tex=512, spec="beanie"),
    "head_cap": dict(kind="head", tex=512, spec="cap"),
}


def make_low(name):
    g = GARMENTS[name]
    builder = {"jacket": jacket, "pants": pants, "gloves": gloves, "head": head_part}[g["kind"]]
    parts = builder(g["spec"])
    obj = parts.to_object(name)
    obj["kind"] = g["kind"]
    # Triangulate now so the baked tangent space matches the exported tangents.
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    bmesh.ops.triangulate(bm, faces=bm.faces[:], quad_method="BEAUTY", ngon_method="BEAUTY")
    bm.to_mesh(obj.data)
    bm.free()
    for p in obj.data.polygons:
        p.use_smooth = True
    return obj


# ---- Detail (normal map) -----------------------------------------------------------------

def fbm(p, scale, octaves=3):
    total, amp, freq = 0.0, 1.0, scale
    for _ in range(octaves):
        total += amp * noise.noise(p * freq)
        amp *= 0.5
        freq *= 2.0
    return total


def groove(d, width, depth):
    """A stitched seam: a groove `width` wide at distance d from the seam line."""
    return -depth * math.exp(-((d / width) ** 2))


def fabric_detail(name, p, n, piece):
    """Height offset (metres) for the displaced bake source."""
    kind = GARMENTS[name]["kind"]
    h = 0.0
    if kind in ("jacket", "pants"):
        # Soft draping folds and fine creases.
        h += 0.0032 * fbm(p, 8.0, 2) + 0.0007 * noise.noise(p * 70.0)
        # Concertina rings at elbows and knees, deepest on the inside of the bend.
        for joint, reach, freq, inside in (("forearm_L", 0.1, 75, 1), ("forearm_R", 0.1, 75, 1), ("shin_L", 0.11, 62, -1), ("shin_R", 0.11, 62, -1)):
            d = (p - J[joint]).length
            if d < reach * 1.7:
                m = math.exp(-((d / reach) ** 2))
                bend = 0.6 + 0.6 * max(0.0, inside * n.z)
                h += 0.005 * m * bend * math.sin(d * freq + 3 * noise.noise(p * 12.0))
        # Fabric hangs: long vertical folds that wander with noise.
        if kind == "jacket" and p.y < 1.4:
            a = math.atan2(p.x, p.z)
            hang = sstep(1.4, 1.1, p.y)
            h += 0.0022 * hang * math.sin(a * 9 + 2.5 * noise.noise(p * 6.0))
        if kind == "jacket":
            # Compression creases where the jacket bunches over the hips.
            h += 0.003 * gauss(p.y, 1.18, 0.05) * math.sin(p.y * 140 + 3 * noise.noise(p * 10.0)) * min(1.0, abs(n.x) * 1.5 + 0.3)
        if kind == "pants":
            # Bunched fabric over the boots.
            for s in ("L", "R"):
                d = (p - ankle(s)).length
                if d < 0.25:
                    h += 0.004 * sstep(0.25, 0.08, d) * math.sin(p.y * 90 + 4 * noise.noise(p * 15.0))
            # Inseam and outseam, knee panels and a waistband.
            h += groove(abs(p.y - 1.15), 0.002, 0.0012)
            if name in ("pants_baggy", "pants_slim"):
                w, hh = (0.07, 0.12) if name == "pants_baggy" else (0.06, 0.1)
                for s in ("L", "R"):
                    k = J["shin_" + s]
                    if p.z > k.z + 0.03:
                        d = math.sqrt(((p.x - k.x) / w) ** 2 + ((p.y - k.y - 0.02) / hh) ** 2)
                        h += groove(abs(d - 1.0) * w, 0.0018, 0.0016) + 0.0012 * sstep(1.0, 0.9, d)
            # Long folds down the legs, deeper on baggy pants.
            for s in ("L", "R"):
                if p.y < 1.0 and (p.x > 0) == (s == "L"):
                    d, t, foot = seg_param(p, "thigh_" + s) if p.y > J["shin_" + s].y else seg_param(p, "shin_" + s)
                    a = math.atan2(p.x - foot.x, p.z - foot.z)
                    h += (0.0025 if name == "pants_baggy" else 0.0012) * math.sin(a * 6 + 2 * noise.noise(p * 5.0))
            for s, sx in (("L", 1), ("R", -1)):
                if p.y < 1.0:
                    d, t, foot = seg_param(p, "thigh_" + s) if p.y > J["shin_" + s].y else seg_param(p, "shin_" + s)
                    side_dir = (p - foot)
                    side_dir.y = 0
                    if side_dir.length > 1e-6:
                        side_dir.normalize()
                        h += groove(abs(side_dir.z), 0.05, 0.0012)
            if name == "pants_baggy":
                # Cargo pockets on the outside of the thighs.
                for s, sx in (("L", 1), ("R", -1)):
                    c = lerp(J["thigh_" + s], J["shin_" + s], 0.45)
                    if sx * p.x > abs(c.x):
                        dy = abs(p.y - c.y) - 0.07
                        dz = abs(p.z - c.z) - 0.06
                        edge = max(dy, dz)
                        if edge < 0.01:
                            h += 0.003 * sstep(0.0, -0.01, edge) + groove(edge, 0.0015, 0.0015)
                        flap = abs(p.y - (c.y + 0.07))
                        if abs(p.z - c.z) < 0.065:
                            h += groove(flap - 0.025, 0.0015, 0.0012)
            if name == "pants_race":
                for s in ("L", "R"):
                    d, t, foot = seg_param(p, "shin_" + s)
                    if p.z > foot.z + 0.03 and t < 0.8:
                        h += 0.004
        if kind == "jacket":
            # Zip down the front.
            if p.z > 0 and p.y > GARMENTS[name]["spec"]["hem"] + 0.02 and name not in ("jacket_hoodie", "jacket_parkrat"):
                d = abs(p.x)
                h += 0.0016 * math.exp(-((d / 0.004) ** 2)) * (0.75 + 0.25 * math.sin(p.y * 900))
                h += groove(d - 0.012, 0.002, 0.0012)
            if name == "jacket_parkrat" and p.z > 0 and p.y > 1.45:
                # Half zip at the neck.
                d = abs(p.x)
                h += 0.0016 * math.exp(-((d / 0.004) ** 2))
            # Armhole and side seams.
            for s, sx in (("L", 1), ("R", -1)):
                d = (p - (J["upperarm_" + s] + Vector((-sx * 0.02, 0, 0)))).length
                h += groove(abs(d - 0.1), 0.002, 0.0014)
            if abs(p.y - 1.6) < 0.01 and abs(p.x) < 0.2:
                h += groove(abs(p.y - 1.6), 0.002, 0.0012)
            hem = GARMENTS[name]["spec"]["hem"]
            h += groove(abs(p.y - (hem + 0.04)), 0.002, 0.0012)
            if name == "jacket_puffer":
                # Box stitching between the baffles.
                phase = (p.y / 0.085) % 1.0
                h += groove(min(phase, 1 - phase) * 0.085, 0.0018, 0.003)
                h += 0.0008 * noise.noise(p * 40.0)
            if name == "jacket_hoodie":
                # Rib cuffs and hem, and a kangaroo pocket.
                if p.y < hem + 0.07:
                    h += 0.0012 * math.sin(math.atan2(p.x, p.z) * 90)
                for s in ("L", "R"):
                    d = (p - wrist(s)).length
                    if d < 0.07:
                        a = math.atan2(p.x - wrist(s).x, p.z - wrist(s).z)
                        h += 0.0012 * math.sin(a * 40)
                if p.z > 0.05 and 1.04 < p.y < 1.26 and abs(p.x) < 0.15:
                    edge = max(abs(p.x) - 0.15 + (1.26 - p.y) * 0.0, abs(p.y - 1.15) - 0.11)
                    h += 0.003 + groove(edge, 0.002, 0.002)
            if name == "jacket_racer":
                # Panel seams curving down the flanks.
                for sx in (1, -1):
                    line = 0.13 + 0.05 * math.sin((p.y - 1.0) * 4)
                    h += groove(abs(sx * p.x - line), 0.002, 0.0014) if sx * p.x > 0 else 0
            if name in ("jacket_shell", "jacket_parkrat") and p.z > 0.08:
                # Hand pocket zips and a chest pocket.
                for sx in (1, -1):
                    c = Vector((sx * 0.11, hem + 0.14 if name == "jacket_shell" else 1.12, 0))
                    du = abs((p.x - c.x) * 0.5 - sx * (p.y - c.y)) / 1.1
                    if abs(p.y - c.y) < 0.07:
                        h += groove(du, 0.0025, 0.0016)
                if name == "jacket_shell" and 1.4 < p.y < 1.48 and -0.16 < p.x < -0.05:
                    h += groove(abs(p.y - 1.46), 0.0018, 0.0015)
    elif kind == "gloves":
        h += 0.0008 * fbm(p, 60.0, 2)
        if GARMENTS[name]["spec"] != "pipe":
            for s in ("L", "R"):
                d = (p - J["hand_" + s]).length
                h += groove(abs(d - 0.05), 0.0015, 0.0012)
    elif kind == "head":
        part = GARMENTS[name]["spec"]
        if part == "beanie":
            a = math.atan2(p.x - J["head"].x, p.z)
            h += 0.0012 * math.sin(a * 40) * (1 if p.y < J["head"].y + 0.19 else 0.5)
        elif part == "face":
            if p.y < J["head"].y + 0.11:
                # Knit and a few slack rings where the gaiter bunches at the neck.
                h += 0.0005 * math.sin(math.atan2(p.x, p.z) * 70) + 0.0012 * fbm(p, 25.0, 2)
                h += 0.0025 * sstep(0.04, -0.02, p.y - J["head"].y) * math.sin((p.y - J["head"].y) * 160 + 2 * noise.noise(p * 20.0))
        elif part == "helmet":
            for x in (-0.045, 0.0, 0.045):
                if p.y > J["head"].y + 0.25 and abs(p.x - x) < 0.01:
                    h -= 0.004 * (1 if -0.06 < p.z < 0.06 else 0)
        elif part == "cap":
            a = math.atan2(p.x, p.z)
            for k in range(6):
                h += groove(abs(math.sin(a - k * math.pi / 3)) * 0.12, 0.0015, 0.001) if p.y > J["head"].y + 0.19 else 0
    return h


# ---- Masks (R accent, G trim) in game space, vectorised over texels -----------------------

def knee_panels(P, w, h):
    """Articulated knee panels: tall rounded patches on the front of each knee."""
    out = np.zeros(len(P))
    for s in ("L", "R"):
        k = J["shin_" + s]
        d = np.sqrt(((P[:, 0] - k.x) / w) ** 2 + ((P[:, 1] - k.y - 0.02) / h) ** 2)
        out = np.maximum(out, smoothstep(1.03, 0.97, d) * (P[:, 2] > k.z + 0.03))
    return out


def masks(name, P):
    """P: (N, 3) game-space positions. Returns accent, trim in 0..1."""
    x, y, z = P[:, 0], P[:, 1], P[:, 2]
    zero = np.zeros(len(P))
    accent, trim = zero.copy(), zero.copy()
    kind = GARMENTS[name]["kind"]
    e = 0.002  # edge softness

    def near(point, r):
        d = np.linalg.norm(P - np.array(point), axis=1)
        return smoothstep(r + e, r - e, d)

    sleeve = smoothstep(0.235, 0.245, np.abs(x))
    torso = 1 - sleeve
    if kind == "jacket":
        spec = GARMENTS[name]["spec"]
        hem = spec["hem"]
        cuffs = np.maximum(near(wrist("L"), 0.055), near(wrist("R"), 0.055))
        collar = smoothstep(1.73 - e, 1.73 + e, y) * torso
        hemband = smoothstep(hem + 0.035 + e, hem + 0.035 - e, y)
        if name == "jacket_shell":
            yoke = smoothstep(1.6 - e, 1.6 + e, y) * torso
            shoulders = np.maximum(near(J["upperarm_L"], 0.1), near(J["upperarm_R"], 0.1)) * sleeve
            accent = np.maximum.reduce([yoke, shoulders, collar, hemband, cuffs])
            trim = smoothstep(0.006, 0.004, np.abs(x)) * (z > 0) * (y > hem + 0.035) * (y < 1.8)
        elif name == "jacket_parkrat":
            # Tall-tee: contrast hood, cuffs and a small chest patch.
            hood = near(J["hood"] + Vector((0, 0.0, -0.03)), 0.15) * (z < -0.04) * (y > 1.71) * smoothstep(0.17, 0.15, np.abs(x))
            patch = (z > 0.05) * smoothstep(0.035 + e, 0.035 - e, np.abs(x + 0.09)) * smoothstep(0.022 + e, 0.022 - e, np.abs(y - 1.5))
            accent = np.maximum.reduce([hood, cuffs, collar, patch])
            trim = smoothstep(0.005, 0.003, np.abs(x)) * (z > 0) * (y > 1.5) * (y < 1.8)
        elif name == "jacket_racer":
            side_panel = smoothstep(0.0, 0.004, np.abs(x) - (0.13 + 0.05 * np.sin((y - 1.0) * 4))) * torso
            sleeve_stripe = sleeve * smoothstep(0.03 + e, 0.03 - e, np.abs(z - 0.0 + 0.0 * x)) * (y > 1.25)
            accent = np.maximum.reduce([side_panel, sleeve_stripe, collar, cuffs])
            trim = smoothstep(0.006, 0.004, np.abs(x)) * (z > 0) * (y > hem) * (y < 1.85)
        elif name == "jacket_hoodie":
            # Rib hem and cuffs in the accent colour, cord tips in trim.
            accent = np.maximum(smoothstep(hem + 0.07 + e, hem + 0.07 - e, y), cuffs)
            trim = np.maximum(near(J["cord_L"] + Vector((0, -0.172, 0.012)), 0.014), near(J["cord_R"] + Vector((0, -0.172, 0.012)), 0.014))
        elif name == "jacket_puffer":
            accent = np.maximum.reduce([collar, cuffs, hemband])
            trim = smoothstep(0.006, 0.004, np.abs(x)) * (z > 0) * (y > hem) * (y < 1.82)
    elif kind == "pants":
        if name == "pants_baggy":
            for side in ("L", "R"):
                th, kn = J["thigh_" + side], J["shin_" + side]
                c = lerp(th, kn, 0.45)
                sx = 1 if side == "L" else -1
                pocket = (sx * x > abs(c.x)) * smoothstep(0.075, 0.07, np.abs(y - c.y)) * smoothstep(0.065, 0.06, np.abs(z - c.z))
                accent = np.maximum(accent, pocket)
            accent = np.maximum(accent, 0.55 * knee_panels(P, 0.07, 0.12))
        elif name == "pants_slim":
            accent = 0.5 * knee_panels(P, 0.06, 0.1)
            accent = np.maximum(accent, smoothstep(0.24, 0.2, y) * 1.0)  # cuff guards
        elif name == "pants_race":
            # Contrast outer stripe and padded shins.
            for side in ("L", "R"):
                sx = 1 if side == "L" else -1
                accent = np.maximum(accent, (sx * x > 0) * smoothstep(0.02, 0.015, np.abs(z)) * (y < 1.1))
            trim = np.maximum(near(lerp(J["shin_L"], ankle("L"), 0.4) + Vector((0, 0, 0.07)), 0.09), near(lerp(J["shin_R"], ankle("R"), 0.4) + Vector((0, 0, 0.07)), 0.09))
        trim = np.maximum(trim, smoothstep(1.17, 1.19, y))  # belt line
    elif kind == "gloves":
        # Cuff accent and a palm patch facing back toward the body.
        for side in ("L", "R"):
            hm = hand_matrix(side)
            local = (np.array(hm.inverted().to_3x3()) @ (P - np.array(J["hand_" + side])).T).T
            near_hand = np.linalg.norm(P - np.array(J["hand_" + side]), axis=1) < 0.15
            cuff = (local[:, 1] > 0.0) * near_hand
            palm = (local[:, 2] < -0.01) * (local[:, 1] < 0.0) * near_hand
            if GARMENTS[name]["spec"] == "pipe":
                accent = np.maximum(accent, palm * 1.0)
            else:
                accent = np.maximum(accent, cuff * 1.0)
                trim = np.maximum(trim, palm * 1.0)
    elif kind == "head":
        part = GARMENTS[name]["spec"]
        hy = J["head"].y
        if part == "face":
            # Skin above the gaiter at the front, hair round the back; gaiter colour below.
            above = smoothstep(hy + 0.111, hy + 0.115, y)
            front = smoothstep(0.02, 0.05, z)
            accent = np.maximum(above * front, near(J["head"] + Vector((0, 0.115, 0.1)), 0.028))
            trim = above * (1 - front)
        elif part == "helmet":
            trim = np.maximum(smoothstep(0.03, 0.02, np.abs(y - (hy + 0.125))) * (np.abs(x) > 0.11), smoothstep(hy + 0.125, hy + 0.12, y))
            trim = np.maximum(trim, ((y > hy + 0.28) * (np.abs(z) < 0.06) * (np.minimum.reduce([np.abs(x + 0.045), np.abs(x), np.abs(x - 0.045)]) < 0.008)) * 1.0)
        elif part == "beanie":
            band = smoothstep(0.012, 0.008, np.abs(y - (hy + 0.165)))
            accent = np.maximum(band, near(J["pom"], 0.06))
        elif part == "cap":
            accent = (z > 0.1) * (y < hy + 0.2) * 1.0
            trim = near(J["head"] + Vector((0, 0.29, 0)), 0.02)
        elif part == "goggles":
            trim = smoothstep(0.02, -0.01, z)  # the strap round the back takes the trim (accent) colour
    return np.clip(accent, 0, 1), np.clip(trim, 0, 1)


# ---- Pipeline steps ----------------------------------------------------------------------

def uv_unwrap(obj):
    select_only(obj)
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.smart_project(angle_limit=math.radians(60), island_margin=0.01, scale_to_bounds=False)
    bpy.ops.uv.pack_islands(margin=0.01, rotate=True)
    bpy.ops.object.mode_set(mode="OBJECT")


def make_high(obj):
    """A denser copy of the low mesh with the fabric detail pushed out along the normals."""
    hi = obj.copy()
    hi.data = obj.data.copy()
    hi.name = obj.name + "_hi"
    link(hi)
    bm = bmesh.new()
    bm.from_mesh(hi.data)
    levels = 2 if len(bm.verts) < 6000 else 1
    for _ in range(levels):
        # Smooth cuts follow the curved surface, so the bake does not pick up facets.
        bmesh.ops.subdivide_edges(bm, edges=list(bm.edges), cuts=1, use_grid_fill=True, smooth=1.0)
        bm.normal_update()
    bm.normal_update()
    tag = bm.verts.layers.int.get("piece")
    pieces = json.loads(obj["pieces"])
    for v in bm.verts:
        p = b2g(v.co)
        n = b2g(v.normal)
        piece = pieces[v[tag]] if tag else {}
        v.co = v.co + v.normal * fabric_detail(obj.name, p, n, piece)
    if tag:
        bmesh.ops.delete(bm, geom=[v for v in bm.verts if pieces[v[tag]].get("nobake")], context="VERTS")
    bm.to_mesh(hi.data)
    bm.free()
    return hi


def without_nobake(obj):
    """A copy of the low mesh minus the pieces flagged nobake."""
    copy = obj.copy()
    copy.data = obj.data.copy()
    copy.name = obj.name + "_occ"
    link(copy)
    bm = bmesh.new()
    bm.from_mesh(copy.data)
    tag = bm.verts.layers.int.get("piece")
    pieces = json.loads(obj["pieces"])
    if tag:
        bmesh.ops.delete(bm, geom=[v for v in bm.verts if pieces[v[tag]].get("nobake")], context="VERTS")
    bm.to_mesh(copy.data)
    bm.free()
    copy.hide_render = False
    return copy


def bake_image(name, size, float_buffer=False):
    img = bpy.data.images.get(name)
    if img:
        bpy.data.images.remove(img)
    img = bpy.data.images.new(name, size, size, alpha=False, float_buffer=float_buffer)
    if not float_buffer:
        img.colorspace_settings.name = "Non-Color"
    return img


def bake_material(obj, image, emit=None):
    """Temporary material whose active image node receives the bake."""
    mat = bpy.data.materials.new(obj.name + "_bake")
    mat.use_nodes = True
    nt = mat.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    if emit == "position":
        geo = nt.nodes.new("ShaderNodeNewGeometry")
        em = nt.nodes.new("ShaderNodeEmission")
        nt.links.new(geo.outputs["Position"], em.inputs["Color"])
        nt.links.new(em.outputs["Emission"], out.inputs["Surface"])
    else:
        bsdf = nt.nodes.new("ShaderNodeBsdfDiffuse")
        nt.links.new(bsdf.outputs[0], out.inputs["Surface"])
    tex = nt.nodes.new("ShaderNodeTexImage")
    tex.image = image
    nt.nodes.active = tex
    obj.data.materials.clear()
    obj.data.materials.append(mat)
    return mat


def bake(obj, name, size):
    """Bakes normal, AO and position; builds the mask image. Returns (normal, mask) images."""
    scene = bpy.context.scene
    for o in scene.objects:
        o.hide_render = o is not obj
    # Normal from the displaced copy.
    hi = make_high(obj)
    hi.hide_render = False
    normal = bake_image(name + "_n", size)
    bake_material(obj, normal)
    bake_material(hi, bake_image(name + "_tmp", 8))
    select_only(hi, obj, active=obj)
    scene.render.bake.margin = 8
    bpy.ops.object.bake(type="NORMAL", use_selected_to_active=True, cage_extrusion=0.006, max_ray_distance=0.012, normal_space="TANGENT", margin=8)
    mesh = hi.data
    bpy.data.objects.remove(hi, do_unlink=True)
    bpy.data.meshes.remove(mesh)
    # Ambient occlusion from an undetailed copy without the nobake pieces, so the
    # drawstrings cast no shadow on the chest. (Baking it from the displaced copy
    # starts rays inside the folds and blots the map.)
    occluder = without_nobake(obj)
    ao = bake_image(name + "_ao", size)
    bake_material(obj, ao)
    bake_material(occluder, bake_image(name + "_tmp", 8))
    select_only(occluder, obj, active=obj)
    scene.cycles.samples = 96
    scene.world = scene.world or bpy.data.worlds.new("RiderWorld")
    scene.world.light_settings.distance = 0.2
    bpy.ops.object.bake(type="AO", use_selected_to_active=True, cage_extrusion=0.002, max_ray_distance=0.004, margin=8)
    mesh = occluder.data
    bpy.data.objects.remove(occluder, do_unlink=True)
    bpy.data.meshes.remove(mesh)
    # Position, to evaluate the colour masks per texel.
    pos = bake_image(name + "_pos", size, float_buffer=True)
    bake_material(obj, pos, emit="position")
    scene.cycles.samples = 1
    bpy.ops.object.bake(type="EMIT", margin=8)
    P = np.array(pos.pixels[:], dtype=np.float32).reshape(-1, 4)[:, :3]
    P = np.stack([P[:, 0], P[:, 2], -P[:, 1]], axis=1)  # to game space
    accent, trim = masks(name, P)
    A = np.array(ao.pixels[:], dtype=np.float32).reshape(-1, 4)[:, 0]
    A = 0.35 + 0.65 * A  # keep creases dark but not black
    mask = bake_image(name + "_mask", size)
    px = np.ones((size * size, 4), dtype=np.float32)
    px[:, 0], px[:, 1], px[:, 2] = accent, trim, A
    mask.pixels = px.ravel()
    for img in (pos, ao):
        bpy.data.images.remove(img)
    for o in scene.objects:
        o.hide_render = False
    return normal, mask


def export_material(obj, name, normal, mask):
    """Base colour carries the mask (read as data in the game), plus the baked normal map."""
    for m in list(obj.data.materials):
        obj.data.materials.clear()
        if m.users == 0:
            bpy.data.materials.remove(m)
    mats = {}
    for slot in ("cloth", "lens"):
        mat = bpy.data.materials.new(f"{name}|{slot}")
        mat.use_nodes = True
        nt = mat.node_tree
        bsdf = nt.nodes.get("Principled BSDF")
        if slot == "cloth":
            tex = nt.nodes.new("ShaderNodeTexImage")
            tex.image = mask
            nt.links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
            ntex = nt.nodes.new("ShaderNodeTexImage")
            ntex.image = normal
            nmap = nt.nodes.new("ShaderNodeNormalMap")
            nt.links.new(ntex.outputs["Color"], nmap.inputs["Color"])
            nt.links.new(nmap.outputs["Normal"], bsdf.inputs["Normal"])
        mats[slot] = mat
    obj.data.materials.append(mats["cloth"])
    pieces = json.loads(obj["pieces"])
    if any(p.get("material") == "lens" for p in pieces):
        obj.data.materials.append(mats["lens"])
        tag = obj.data.attributes.get("piece")
        for poly in obj.data.polygons:
            piece = pieces[tag.data[poly.vertices[0]].value]
            poly.material_index = 1 if piece.get("material") == "lens" else 0


def skin_weights(obj, arm):
    """Distance-based weights to the bones each piece may follow, at most four per vertex."""
    pieces = json.loads(obj["pieces"])
    tag = obj.data.attributes.get("piece")
    groups = {b.name: obj.vertex_groups.new(name=b.name) for b in arm.data.bones}
    for v in obj.data.vertices:
        piece = pieces[tag.data[v.index].value]
        p = b2g(v.co)
        if piece.get("rigid"):
            groups[piece["rigid"]].add([v.index], 1.0, "REPLACE")
            continue
        w = {}
        for bone in piece["bones"]:
            if bone in ("hem_F", "hem_B"):
                continue
            d, t, foot = seg_param(p, bone)
            w[bone] = 1.0 / max(d, 0.03) ** 6
        if piece.get("neck"):
            w = {"head": sstep(J["head"].y - 0.04, J["head"].y + 0.04, p.y) + 1e-4, "chest": 1 - sstep(J["head"].y - 0.04, J["head"].y + 0.04, p.y) + 1e-4}
        total = sum(w.values())
        w = {k: val / total for k, val in w.items()}
        # Jacket hem follows the hem bones; a long hem also follows the thighs.
        if "hem" in piece:
            hem = piece["hem"]
            f = sstep(hem + 0.16, hem, p.y) * 0.85
            if f > 0:
                front = sstep(-0.06, 0.06, p.z)
                w = {k: val * (1 - f) for k, val in w.items()}
                w["hem_F"] = f * front
                w["hem_B"] = f * (1 - front)
            if p.y < 1.0:
                k = sstep(1.0, 0.82, p.y) * 0.5
                side = "thigh_L" if p.x > 0 else "thigh_R"
                w = {b: val * (1 - k) for b, val in w.items()}
                w[side] = w.get(side, 0) + k
        top = sorted(w.items(), key=lambda kv: -kv[1])[:4]
        total = sum(val for _, val in top) or 1.0
        for bone, val in top:
            if val / total > 1e-3:
                groups[bone].add([v.index], val / total, "REPLACE")
    obj.parent = arm
    mod = obj.modifiers.new("Armature", "ARMATURE")
    mod.object = arm


def build_garment(name, arm):
    obj = make_low(name)
    uv_unwrap(obj)
    normal, mask = bake(obj, name, GARMENTS[name]["tex"])
    export_material(obj, name, normal, mask)
    skin_weights(obj, arm)
    return {"name": name, "verts": len(obj.data.vertices), "tris": sum(len(p.vertices) - 2 for p in obj.data.polygons)}


def export(path=None):
    path = path or os.path.join(OUT_DIR, "rider.glb")
    os.makedirs(os.path.dirname(path), exist_ok=True)
    objs = [o for o in bpy.context.scene.objects if o.type in ("MESH", "ARMATURE")]
    select_only(*objs, active=bpy.context.scene.objects["RiderRig"])
    bpy.ops.export_scene.gltf(
        filepath=path, export_format="GLB", use_selection=True, use_active_scene=True, export_skins=True, export_tangents=True,
        export_image_format="JPEG", export_jpeg_quality=88, export_animations=False, export_morph=False,
        export_yup=True, export_def_bones=False, export_influence_nb=4, export_vertex_color="NONE",
        export_attributes=False, export_extras=False,
    )
    return path


def build_all(names=None):
    fresh_scene()
    arm = build_armature()
    report = [build_garment(n, arm) for n in (names or GARMENTS)]
    return {"garments": report, "file": export()}


if __name__ == "__main__" and bpy.app.background:
    print(build_all())
