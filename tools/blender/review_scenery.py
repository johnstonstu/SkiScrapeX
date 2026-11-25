"""
Review renders for scenery assets built by build_lifts.py / build_buildings.py:
four views round one asset (named empty) on a snow plane, saved as one strip.

    exec(open(r"<repo>/tools/blender/review_scenery.py").read(), ns)
    ns["review_asset"]("qd_terminal_bottom", r"<out.png>", distance=22, height=6)
"""
import bpy
import math
import os
import numpy as np
from mathutils import Vector


def _stage(scene):
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x = 640
    scene.render.resolution_y = 480
    world = scene.world or bpy.data.worlds.new("ReviewWorld")
    scene.world = world
    world.use_nodes = True
    bg = world.node_tree.nodes.get("Background")
    bg.inputs["Color"].default_value = (0.62, 0.7, 0.8, 1)
    bg.inputs["Strength"].default_value = 1.0
    for name in ("ReviewSun", "ReviewCam", "ReviewSnow"):
        old = bpy.data.objects.get(name)
        if old:
            bpy.data.objects.remove(old, do_unlink=True)
    sun = bpy.data.objects.new("ReviewSun", bpy.data.lights.new("ReviewSun", "SUN"))
    sun.data.energy = 3.5
    sun.rotation_euler = (math.radians(48), 0, math.radians(30))
    cam = bpy.data.objects.new("ReviewCam", bpy.data.cameras.new("ReviewCam"))
    cam.data.lens = 35
    cam.data.clip_end = 2000
    snow_me = bpy.data.meshes.new("ReviewSnow")
    s = 200
    snow_me.from_pydata([(-s, -s, 0), (s, -s, 0), (s, s, 0), (-s, s, 0)], [], [(0, 1, 2, 3)])
    snow = bpy.data.objects.new("ReviewSnow", snow_me)
    mat = bpy.data.materials.get("ReviewSnowMat") or bpy.data.materials.new("ReviewSnowMat")
    mat.use_nodes = True
    mat.node_tree.nodes.get("Principled BSDF").inputs["Base Color"].default_value = (0.9, 0.93, 0.96, 1)
    snow_me.materials.append(mat)
    for obj in (sun, cam, snow):
        scene.collection.objects.link(obj)
    scene.camera = cam
    return cam


def review_asset(name, path, distance=8.0, height=2.0, target_height=None, angles=(30, 120, 210, 300), lens=35):
    scene = bpy.context.scene
    root = scene.objects[name]
    # Only this asset (and the stage) renders.
    keep = {root} | set(root.children_recursive)
    for obj in scene.objects:
        if obj.name.startswith("Review"):
            continue
        obj.hide_render = obj not in keep
    cam = _stage(scene)
    cam.data.lens = lens
    # three.js draws one side of each face; so should the review, or inward faces hide.
    for mat in bpy.data.materials:
        mat.use_backface_culling = True
    target = Vector((0, 0, target_height if target_height is not None else height * 0.6))
    frames = []
    for angle in angles:
        a = math.radians(angle)
        cam.location = (distance * math.sin(a), -distance * math.cos(a), height)
        cam.rotation_euler = (target - cam.location).to_track_quat("-Z", "Y").to_euler()
        tmp = os.path.join(os.path.dirname(path), f"_scn{angle}.png")
        scene.render.filepath = tmp
        bpy.ops.render.render(write_still=True)
        img = bpy.data.images.load(tmp)
        frames.append(np.array(img.pixels[:], dtype=np.float32).reshape(img.size[1], img.size[0], 4))
        bpy.data.images.remove(img)
        os.remove(tmp)
    strip = np.concatenate([np.concatenate(frames[:2], axis=1), np.concatenate(frames[2:], axis=1)], axis=0) if len(frames) == 4 else np.concatenate(frames, axis=1)
    out = bpy.data.images.new("scenery_strip", strip.shape[1], strip.shape[0], alpha=True)
    out.pixels = strip.ravel()
    out.filepath_raw = path
    out.file_format = "PNG"
    out.save()
    bpy.data.images.remove(out)
    for obj in scene.objects:
        obj.hide_render = False
    return path
