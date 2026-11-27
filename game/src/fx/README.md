# Snow effects

Snow surface shader, spray, snowfall and ski tracks. The modules only need world-space inputs.

Coordinates match the rest of the project: metres, **+X east**, **+Y up**, **+Z south**.

## Modules

Import from `src/fx/index.ts`. These modules started as the standalone `labs/snow-fx` look-dev lab; the game is now where they are tuned.

### `SnowMaterial`

One `ShaderMaterial` for any heightfield mesh. Lighting (sun, sky, ground bounce, fog) is in the shader, so the mesh does not need scene lights. Mask and track textures are sampled in world XZ.

```ts
const material = new SnowMaterial({
  mask,                                 // optional, nearest, NoColorSpace
  maskOrigin: { x: 0, z: 0 },
  maskSize: { x: width, z: depth },
  groomDirection: { x: 0, z: 1 },       // used when the mask is off
  sunDirection,                         // points toward the sun
  slopeStartDeg: 36,
  slopeFullDeg: 52,
  corduroySpacing: 0.22,                // metres between ridges
  corduroyDepth: 0.012,                 // ridge height, metres
  sparkle: 0.45,
  fogDensity: 0.0032,
});
mesh.material = material;

material.setSun(direction, '#ffe6c2');
material.setSparkle(0.45);             // 0 hides glints
material.setCorduroy(0.22, 0.012);     // depth 0 hides ridges
material.setSlopeBlend(36, 52, true);
material.setMaskEnabled(true);
material.setMask(mask, originX, originZ, sizeX, sizeZ);
material.setGroomDirection(0, 1);
material.setFog(0.0032);
material.setTrackMap(stamp, originX, originZ, size, resolution); // or null
```

Mask texels are data, not colour. Build them with `writeMaskTexel` from `src/snow/mask.ts` and filter the texture with nearest:

| Channel | Meaning |
| --- | --- |
| R | Surface id / 4. `Surface.groomed` 0, `powder` 1, `ice` 2, `rock` 3, `underTree` 4. |
| G | Groom heading / 2π. Heading 0 points +X east, π/2 points +Z south. |
| B | Unused. |
| A | 255. |

`uv = ((x - originX) / sizeX, (z - originZ) / sizeZ)`. Row 0 of the buffer is the north edge (minimum Z). Corduroy follows that heading and fades out when the ridges are smaller than a pixel. Sparkle is a sparse, view-dependent glint around the sun’s half-vector. Slope rock blends in between the start and full angles using the mesh normal’s Y.

The track map is a separate single-channel-in-red stamp. Where it is non-zero the corduroy is flattened and the snow darkens. Pass `null` to `setTrackMap` to hide it. The material does not own that texture.

### `SnowSpray`

Ski kick-up. A fixed pool (default 2048) of camera-facing streaks. The CPU integrates them because the spawn rate, size and direction come from the ski inputs. Drawing is one instanced quad: each live flake is written once (it used to be six vertices per flake) and only the live range is uploaded. The pool never grows. `setLight(lit, shade)` tints flakes from the scene's sun and sky so spray does not glow at dusk.

```ts
const spray = new SnowSpray({ maxParticles: 2048, gravity: 7, drag: 1.7 });
scene.add(spray.object);
spray.amount = 1;                      // scales flakes per second
spray.setEnabled(true);
spray.update(dt, [
  { position, velocity, skid, carving, lateral: outward, grounded: true },
]);
spray.alive;                           // live count
spray.clear();
```

`skid` (0–1) is a sideways scrub: more flakes, bigger, thrown up and back. `carving` (0–1) is an edged turn: fewer, smaller, stretched streaks thrown along `lateral` (the outside of the turn, on the snow). `velocity` is metres per second. Pass one entry per ski. The vectors are read immediately and not retained.

### `SnowPuff`

Powder clouds: soft billows that bloom, drift and thin out after a landing, a crash, a deep-snow turn or a hard skidded stop. A small fixed pool (48 / 96 / 160 on Low / Medium / High) of camera-facing quads in one instanced draw, with a cheap value-noise edge and a top-lit gradient so they read as volume without scene lights. They are large and transparent, so the pool size is a fill-rate budget. When the pool is full the oldest cloud is reused.

```ts
const puffs = new SnowPuff({ maxPuffs: 96 });
scene.add(puffs.object);
puffs.burst(position, velocity, { count: 8, size: 0.6, spread: 3, rise: 1.2, life: 1.6, opacity: 0.6 });
puffs.trail(dt, position, velocity, ratePerSecond, size, opacity); // a plume behind the rider
puffs.update(dt);
```

### `SpeedStreaks`

Sense of speed: faint snow streaks that fly past toward the edges of the view from about 50 km/h, full by about 90 km/h. Seeds are fixed in the world and wrap in a box around the camera; each is a short line smeared along the rider's velocity. Motion is in the vertex shader, the buffer is fixed, and it is one additive line draw. The middle of the screen stays clear for the rider. Off with `prefers-reduced-motion`.

```ts
const streaks = new SpeedStreaks({ count: 360, boxMetres: 26 });
streaks.update(dt, camera.position, riderVelocity, strength01);
```

### `Snowfall`

Ambient flakes. Motion is in the vertex shader: a fixed set of seeds falls in world space and wraps inside a box around the focus point. Memory is one point buffer.

```ts
const snow = new Snowfall({ count: 4200, boxMetres: 52, pixelRatio });
scene.add(snow.object);
snow.setDensity(0.75);                 // draws a prefix of the pool
snow.setWind(eastMetresPerSecond, southMetresPerSecond);
snow.setEnabled(true);
snow.update(dt, camera.position);
```

### `SkiTracks`

Two things, both bounded:

- A ribbon of the two ski grooves. At most `maxSamples` (default 800) poses, spaced `spacing` metres (default 0.4), fading over `lifetime` seconds. Older samples are dropped. A jump longer than 4 m breaks the ribbon instead of stretching it across the gap.
- A 512² RGBA stamp covering a square window (`windowMetres`, default 112). The red channel is “skied-out” snow for `SnowMaterial.setTrackMap`. The window recentres on the skier; texels that slide out are discarded. A teleport clears the window.

```ts
const tracks = new SkiTracks({
  maxSamples: 800,
  spacing: 0.4,
  lifetime: 12,
  stance: 0.28,                        // metres between ski centrelines
  skiWidth: 0.11,
  windowMetres: 112,
  resolution: 512,
});
scene.add(tracks.object);
tracks.lifetime = 12;
tracks.stampEnabled = true;
tracks.setRibbonEnabled(true);
tracks.setSun(directionTowardSun, linearSunRgb, linearSkyRgb);
tracks.setFog(0.0032, linearFogRgb);
tracks.update(dt, { position, direction, normal, skid, carving, grounded: true });
material.setTrackMap(
  tracks.stampTexture,
  tracks.originX,
  tracks.originZ,
  tracks.windowMetres,
  tracks.resolution,
);
tracks.clear();
```

`position` is the point between the skis, on the snow. `direction` is travel and does not need to be normalised. `normal` points out of the surface. High `skid` widens and softens the groove; high `carving` keeps it narrow.

Nothing in the tracks module grows with how long the run has been skied. The ribbon is capped by the sample count. The stamp is one fixed texture.

## Why not three.quarks

three.quarks is MIT and would be a reasonable general particle engine. It is not used here, for two practical reasons:

- The current release wants `three` >= 0.182. This lab stays on 0.180, the same version the terrain viewer loads, so the modules can move into the game without a renderer upgrade.
- Spray and snowfall are not a behavior graph. Spray is a capped pool spawned from ski inputs. Snowfall is a wrapping field in a vertex shader. Both have fixed buffers and no per-frame allocation. Pulling in a batched VFX runtime would add a second scene graph for two effects whose motion is already fully determined.

## Performance

The snow surface is one draw and one shader. Corduroy, sparkle, slope rock, the mask and the track stamp are extra arithmetic and a few texture taps in that same pass, not extra geometry. Particle and track buffers are allocated once.

Measured in headless Chrome with SwiftShader at 1440×900, the follow view sat around **42–44 fps** (**23 ms** average frame interval). The meter showed **16 draws**, about **64k triangles** (the 1 m hill is ~62k of those; a coarser game mesh would be less), and **3150** snowfall points at the default density. A heavier moment, with a long track and a full spray, was still the same 16 draws and about 65k triangles. The simulation delta is clamped at 50 ms so a stalled frame does not throw the skier. A desktop GPU should be limited by the display refresh rather than this shader; the expensive part of a full mountain is still filling the screen with that one material, plus the single terrain draw.

