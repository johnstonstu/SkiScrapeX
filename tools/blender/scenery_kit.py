"""
Geometry kit for the scenery build scripts: boxes, cylinders, tori, lofts and
extruded outlines, collected per material and turned into Blender objects.

Everything is authored in game space (+X east / the asset's right-hand side as
the game places it, +Y up, +Z along the asset's forward axis) and converted to
Blender space (Z up) when the object is made. The glTF exporter converts back.
"""
import bpy
import math
from mathutils import Matrix, Vector, Euler
from mathutils.geometry import tessellate_polygon


def g2b(p):
    return Vector((p[0], -p[2], p[1]))


def srgb_to_linear(hexcolour):
    h = hexcolour.lstrip("#")
    c = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    return tuple((x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4) for x in c)


MATERIALS = {}


def material(name, colour, roughness=0.6, metalness=0.0, emissive=None, emissive_strength=1.0):
    """A named Principled material, created once per build."""
    if name in MATERIALS:
        return MATERIALS[name]
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = (*srgb_to_linear(colour), 1.0)
    bsdf.inputs["Roughness"].default_value = roughness
    bsdf.inputs["Metallic"].default_value = metalness
    if emissive:
        bsdf.inputs["Emission Color"].default_value = (*srgb_to_linear(emissive), 1.0)
        bsdf.inputs["Emission Strength"].default_value = emissive_strength
    MATERIALS[name] = mat
    return mat


def basis_for(direction):
    """Two unit vectors perpendicular to `direction`."""
    d = Vector(direction).normalized()
    helper = Vector((0, 1, 0)) if abs(d.y) < 0.9 else Vector((1, 0, 0))
    u = d.cross(helper).normalized()
    v = d.cross(u).normalized()
    return u, v


class Kit:
    """Collects faces per material, then builds one object with material slots."""

    def __init__(self, name):
        self.name = name
        self.parts = {}  # material name -> [verts, faces, smooth flags]

    def _part(self, mat):
        return self.parts.setdefault(mat, [[], [], []])

    def add(self, mat, verts, faces, smooth=False):
        part = self._part(mat)
        base = len(part[0])
        part[0].extend(Vector(v) for v in verts)
        part[1].extend(tuple(base + i for i in f) for f in faces)
        part[2].extend([smooth] * len(faces))

    # ---- Primitives (game space) ---------------------------------------------------

    def box(self, mat, size, at, rot=(0, 0, 0)):
        sx, sy, sz = (s / 2 for s in size)
        m = Euler(rot, "XYZ").to_matrix()
        corners = [m @ Vector((x * sx, y * sy, z * sz)) + Vector(at) for x in (-1, 1) for y in (-1, 1) for z in (-1, 1)]
        faces = [(0, 1, 3, 2), (4, 6, 7, 5), (0, 4, 5, 1), (2, 3, 7, 6), (0, 2, 6, 4), (1, 5, 7, 3)]
        self.add(mat, corners, faces)

    def cyl(self, mat, a, b, r0, r1=None, seg=8, caps=True, smooth=True):
        """A (tapered) cylinder from point a to point b."""
        r1 = r0 if r1 is None else r1
        a, b = Vector(a), Vector(b)
        u, v = basis_for(b - a)
        verts = []
        for centre, r in ((a, r0), (b, r1)):
            for k in range(seg):
                t = 2 * math.pi * k / seg
                verts.append(centre + (u * math.cos(t) + v * math.sin(t)) * r)
        faces = [(k, (k + 1) % seg, seg + (k + 1) % seg, seg + k) for k in range(seg)]
        self.add(mat, verts, faces, smooth)
        if caps:
            self.add(mat, verts[:seg], [tuple(reversed(range(seg)))])
            self.add(mat, verts[seg:], [tuple(range(seg))])

    def tube(self, mat, points, r, seg=6):
        """Round bar along a polyline, a cylinder per segment."""
        for p, q in zip(points, points[1:]):
            self.cyl(mat, p, q, r, seg=seg, caps=False)

    def torus(self, mat, centre, R, r, axis="y", seg=28, sides=6):
        rot = {"y": Matrix.Identity(3), "x": Matrix.Rotation(math.pi / 2, 3, "Z"), "z": Matrix.Rotation(math.pi / 2, 3, "X")}[axis]
        verts = []
        for i in range(seg):
            a = 2 * math.pi * i / seg
            for k in range(sides):
                b = 2 * math.pi * k / sides
                p = Vector(((R + r * math.cos(b)) * math.cos(a), r * math.sin(b), (R + r * math.cos(b)) * math.sin(a)))
                verts.append(rot @ p + Vector(centre))
        faces = []
        for i in range(seg):
            for k in range(sides):
                faces.append((i * sides + k, ((i + 1) % seg) * sides + k, ((i + 1) % seg) * sides + (k + 1) % sides, i * sides + (k + 1) % sides))
        self.add(mat, verts, faces, smooth=True)

    def disc(self, mat, centre, r, axis_dir, seg=16, thickness=0.05):
        c = Vector(centre)
        d = Vector(axis_dir).normalized()
        self.cyl(mat, c - d * thickness / 2, c + d * thickness / 2, r, seg=seg)

    def loft(self, mat, rings, cap_start=False, cap_end=False, smooth=True, closed=True):
        """Quads between rings of equal length (closed loops unless closed=False)."""
        n = len(rings[0])
        verts = [Vector(p) for ring in rings for p in ring]
        faces = []
        span = n if closed else n - 1
        for j in range(len(rings) - 1):
            for k in range(span):
                a, b = j * n + k, j * n + (k + 1) % n
                faces.append((a, b, b + n, a + n))
        self.add(mat, verts, faces, smooth)
        if cap_start:
            self.fill(mat, rings[0], reverse=True)
        if cap_end:
            self.fill(mat, rings[-1])

    def fill(self, mat, ring, reverse=False):
        """Cap a planar-ish loop (triangulated, works for concave outlines)."""
        pts = [Vector(p) for p in ring]
        # Project onto the loop's best plane for triangulation.
        normal = Vector((0, 0, 0))
        for i in range(len(pts)):
            a, b = pts[i], pts[(i + 1) % len(pts)]
            normal += Vector(((a.y - b.y) * (a.z + b.z), (a.z - b.z) * (a.x + b.x), (a.x - b.x) * (a.y + b.y)))
        u, v = basis_for(normal if normal.length > 1e-9 else Vector((0, 1, 0)))
        flat = [Vector((p.dot(u), p.dot(v), 0)) for p in pts]
        tris = tessellate_polygon([flat])
        faces = []
        for t in tris:
            f = tuple(t)
            # Keep the winding consistent with the loop's normal.
            a, b, c = (pts[i] for i in f)
            if (b - a).cross(c - a).dot(normal) < 0:
                f = (f[0], f[2], f[1])
            faces.append(tuple(reversed(f)) if reverse else f)
        self.add(mat, pts, faces)

    def prism(self, mat, outline, y0, y1, cap_top=True, cap_bottom=False, wall_mat=None):
        """Extrude a (x, z) outline from y0 to y1."""
        low = [(x, y0, z) for x, z in outline]
        high = [(x, y1, z) for x, z in outline]
        self.loft(wall_mat or mat, [low, high], smooth=False)
        if cap_top:
            self.fill(mat, high)
        if cap_bottom:
            self.fill(mat, low, reverse=True)

    def gable(self, mat, length, width, rise, at, axis_rot=0.0, overhang=0.4, thickness=0.18, snow=None, snow_depth=0.35):
        """A gable roof (ridge along local Z) with optional snow on top."""
        m = Matrix.Rotation(axis_rot, 3, "Y")
        o = Vector(at)
        hw = width / 2 + overhang
        hl = length / 2 + overhang
        for side in (-1, 1):
            for layer, (m_name, lift) in enumerate(((mat, 0.0), (snow, thickness))):
                if m_name is None:
                    continue
                depth = thickness if layer == 0 else snow_depth
                eave = Vector((side * hw, -rise * (overhang / (width / 2)) + lift, 0))
                ridge = Vector((0, rise + lift, 0))
                quad = [ridge + Vector((0, 0, -hl)), ridge + Vector((0, 0, hl)), eave + Vector((0, 0, hl)), eave + Vector((0, 0, -hl))]
                top = [p + Vector((0, depth, 0)) for p in quad]
                verts = [m @ p + o for p in quad + top]
                faces = [(0, 1, 2, 3), (4, 7, 6, 5), (0, 4, 5, 1), (1, 5, 6, 2), (2, 6, 7, 3), (3, 7, 4, 0)]
                if side > 0:
                    faces = [tuple(reversed(f)) for f in faces]
                self.add(m_name, verts, faces)

    # ---- Output -------------------------------------------------------------------

    def build(self, parent=None, name=None):
        """One mesh object with a slot per material; returns it (or None if empty)."""
        if not self.parts:
            return None
        verts, faces, smooth, mats = [], [], [], []
        for index, (mat, (v, f, s)) in enumerate(self.parts.items()):
            base = len(verts)
            verts.extend(g2b(p) for p in v)
            faces.extend(tuple(base + i for i in face) for face in f)
            smooth.extend(s)
            mats.extend([index] * len(f))
        me = bpy.data.meshes.new(name or self.name)
        me.from_pydata(verts, [], faces)
        me.validate(clean_customdata=False)
        for poly, sm, mi in zip(me.polygons, smooth, mats):
            poly.use_smooth = sm
            poly.material_index = mi
        for mat in self.parts:
            me.materials.append(MATERIALS[mat])
        obj = bpy.data.objects.new(name or self.name, me)
        bpy.context.scene.collection.objects.link(obj)
        if parent is not None:
            obj.parent = parent
        return obj


def asset_root(name):
    """An empty at the origin that names an asset; its children are the asset's meshes."""
    root = bpy.data.objects.new(name, None)
    root.empty_display_size = 0.5
    bpy.context.scene.collection.objects.link(root)
    return root


def triangle_count(obj):
    return sum(len(p.vertices) - 2 for p in obj.data.polygons)
