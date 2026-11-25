"""
Review renders of the rider built by build_rider.py: one outfit in a skiing
stance, shaded the way the game shades it (mask colours, baked normal map,
AO), from the front, three-quarter, side and back, saved as one strip.

    ns = {"REPO": r"<repo>"}
    exec(open(r"<repo>/tools/blender/build_rider.py").read(), ns)
    ns["build_all"]()
    exec(open(r"<repo>/tools/blender/review_rider.py").read(), ns)
    ns["review"]({"jacket": "shell", ...}, r"<out.png>")

Run after build_all in the same namespace; it swaps the garments' materials
for preview ones, so export first.
"""
import bpy
import math
import os
import numpy as np
from mathutils import Matrix, Vector

STANCE = {
    # Game-space rotations (radians) about X (+ tips forward) and Z (+ toward the rider's left).
    "spine": (0.22, 0), "chest": (0.12, 0), "head": (-0.3, 0),
    "thigh_L": (-0.75, -0.06), "thigh_R": (-0.75, 0.06), "shin_L": (1.05, 0), "shin_R": (1.05, 0),
    "upperarm_L": (-0.75, -0.4), "upperarm_R": (-0.75, 0.4), "forearm_L": (-0.7, 0), "forearm_R": (-0.7, 0),
}

DEFAULT_COLOURS = {
    "jacket": ("#d42a2f", "#8f1c20", "#1b1f24"),
    "pants": ("#27313f", "#1c232d", "#1b1f24"),
    "gloves": ("#17191d", "#8f1c20", "#4b5058"),
    "gloves_pipe": ("#2b2f36", "#7a6450", "#1b1f24"),
    "head_face": ("#59606b", "#e2b08a", "#3b2a20"),
    "head_goggles": ("#15181c", "#15181c", "#8f1c20"),
    "head_helmet": ("#f2f5f8", "#f2f5f8", "#15181c"),
    "head_beanie": ("#f2f5f8", "#8f1c20", "#1b1f24"),
    "head_cap": ("#f2f5f8", "#8f1c20", "#8f1c20"),
}


def srgb(hexcolour):
    h = hexcolour.lstrip("#")
    c = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    return tuple((x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4) for x in c) + (1.0,)


def preview_material(name, colours, roughness=0.8):
    mask = bpy.data.images.get(name + "_mask")
    normal = bpy.data.images.get(name + "_n")
    mat = bpy.data.materials.new(name + "_preview")
    mat.use_nodes = True
    nt = mat.node_tree
    bsdf = nt.nodes.get("Principled BSDF")
    bsdf.inputs["Roughness"].default_value = roughness
    tex = nt.nodes.new("ShaderNodeTexImage")
    tex.image = mask
    sep = nt.nodes.new("ShaderNodeSeparateColor")
    nt.links.new(tex.outputs["Color"], sep.inputs["Color"])
    base, accent, trim = (nt.nodes.new("ShaderNodeRGB") for _ in range(3))
    for node, value in zip((base, accent, trim), colours):
        node.outputs[0].default_value = srgb(value)
    mix1 = nt.nodes.new("ShaderNodeMix")
    mix1.data_type = "RGBA"
    nt.links.new(sep.outputs["Red"], mix1.inputs["Factor"])
    nt.links.new(base.outputs[0], mix1.inputs["A"])
    nt.links.new(accent.outputs[0], mix1.inputs["B"])
    mix2 = nt.nodes.new("ShaderNodeMix")
    mix2.data_type = "RGBA"
    nt.links.new(sep.outputs["Green"], mix2.inputs["Factor"])
    nt.links.new(mix1.outputs["Result"], mix2.inputs["A"])
    nt.links.new(trim.outputs[0], mix2.inputs["B"])
    ao = nt.nodes.new("ShaderNodeMix")
    ao.data_type = "RGBA"
    ao.blend_type = "MULTIPLY"
    ao.inputs["Factor"].default_value = 1.0
    nt.links.new(mix2.outputs["Result"], ao.inputs["A"])
    nt.links.new(sep.outputs["Blue"], ao.inputs["B"])
    nt.links.new(ao.outputs["Result"], bsdf.inputs["Base Color"])
    if normal:
        ntex = nt.nodes.new("ShaderNodeTexImage")
        ntex.image = normal
        nmap = nt.nodes.new("ShaderNodeNormalMap")
        nt.links.new(ntex.outputs["Color"], nmap.inputs["Color"])
        nt.links.new(nmap.outputs["Normal"], bsdf.inputs["Normal"])
    return mat


def lens_material():
    mat = bpy.data.materials.new("lens_preview")
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = srgb("#ff7a1a")
    bsdf.inputs["Roughness"].default_value = 0.1
    bsdf.inputs["Metallic"].default_value = 0.6
    return mat


def pose_stance(arm, stance=STANCE):
    for pb in arm.pose.bones:
        pb.rotation_mode = "QUATERNION"
        pb.rotation_quaternion = (1, 0, 0, 0)
    for name, (rx, rz) in stance.items():
        pb = arm.pose.bones[name]
        # Game X is Blender X; game Z is Blender -Y.
        r = Matrix.Rotation(rx, 3, "X") @ Matrix.Rotation(-rz, 3, "Y")
        rest = pb.bone.matrix_local.to_3x3()
        pb.rotation_quaternion = (rest.inverted() @ r @ rest).to_quaternion()
    bpy.context.view_layer.update()


def setup_stage():
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x = 520
    scene.render.resolution_y = 800
    scene.render.film_transparent = False
    world = scene.world or bpy.data.worlds.new("RiderWorld")
    scene.world = world
    world.use_nodes = True
    bg = world.node_tree.nodes.get("Background")
    bg.inputs["Color"].default_value = (0.55, 0.62, 0.7, 1)
    bg.inputs["Strength"].default_value = 0.9
    for name in ("ReviewSun", "ReviewFill", "ReviewCam"):
        old = bpy.data.objects.get(name)
        if old:
            bpy.data.objects.remove(old, do_unlink=True)
    sun = bpy.data.objects.new("ReviewSun", bpy.data.lights.new("ReviewSun", "SUN"))
    sun.data.energy = 3.2
    sun.rotation_euler = (math.radians(50), 0, math.radians(35))
    fill = bpy.data.objects.new("ReviewFill", bpy.data.lights.new("ReviewFill", "SUN"))
    fill.data.energy = 0.8
    fill.rotation_euler = (math.radians(70), 0, math.radians(200))
    cam = bpy.data.objects.new("ReviewCam", bpy.data.cameras.new("ReviewCam"))
    cam.data.lens = 70
    for obj in (sun, fill, cam):
        scene.collection.objects.link(obj)
    scene.camera = cam
    return cam


def look_at(cam, eye, target):
    cam.location = eye
    cam.rotation_euler = (Vector(target) - Vector(eye)).to_track_quat("-Z", "Y").to_euler()


def review(outfit, path, colours=None, closeup=False):
    """outfit: {"jacket": style, "pants": style, "gloves": style, "headwear": style}."""
    colours = {**DEFAULT_COLOURS, **(colours or {})}
    scene = bpy.context.scene
    arm = scene.objects["RiderRig"]
    shown = {f"jacket_{outfit['jacket']}", f"pants_{outfit['pants']}", f"gloves_{outfit['gloves']}",
             "head_face", "head_goggles", f"head_{outfit['headwear']}"}
    rough = {"jacket_racer": 0.45, "jacket_puffer": 0.5, "jacket_shell": 0.65, "head_helmet": 0.3, "head_goggles": 0.5}
    for obj in scene.objects:
        if obj.type != "MESH" or obj.parent != arm:
            continue
        obj.hide_render = obj.name not in shown
        if obj.hide_render:
            continue
        key = obj.name if obj.name in colours else obj.name.split("_")[0]
        mats = [preview_material(obj.name, colours[key], rough.get(obj.name, 0.82))]
        if len(obj.data.materials) > 1:
            mats.append(lens_material())
        for i, m in enumerate(mats):
            obj.data.materials[i] = m
    pose_stance(arm)
    cam = setup_stage()
    target = (0, 0, 1.75) if closeup else (0, 0, 1.25)
    dist = 1.5 if closeup else 3.6
    frames = []
    for angle in (0, 35, 90, 180):
        a = math.radians(angle)
        eye = (dist * math.sin(a), -dist * math.cos(a), target[2] + (0.1 if closeup else 0.35))
        look_at(cam, eye, target)
        tmp = os.path.join(os.path.dirname(path), f"_view{angle}.png")
        scene.render.filepath = tmp
        bpy.ops.render.render(write_still=True)
        img = bpy.data.images.load(tmp)
        frames.append(np.array(img.pixels[:], dtype=np.float32).reshape(img.size[1], img.size[0], 4))
        bpy.data.images.remove(img)
        os.remove(tmp)
    strip = np.concatenate(frames, axis=1)
    out = bpy.data.images.new("review_strip", strip.shape[1], strip.shape[0], alpha=True)
    out.pixels = strip.ravel()
    out.filepath_raw = path
    out.file_format = "PNG"
    out.save()
    bpy.data.images.remove(out)
    return path
