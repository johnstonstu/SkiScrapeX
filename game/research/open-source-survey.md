# SkiScrapex: open-source survey for the ski game

*Compiled 2026-11-21 by ScrapexBot. Every repo below was opened during this survey: its licence, stars and last-push date come from the GitHub API on that day, and the "last push" column is a UTC date. "No licence" means GitHub found no licence file. Under copyright law that means **all rights reserved**, so we may read the code for ideas but must not copy it.*

Context: Three.js + TypeScript + Vite. The sim is separate from rendering, uses metres, has +X east, +Y up and +Z south, and runs on a fixed timestep. The ski sim talks to terrain only through `sampleTerrain(x, z) -> { height, normal } | null`, which samples a 5 m LiDAR heightfield.

---

## TL;DR: top recommendations

| Area | Build on | Why |
|---|---|---|
| **Ski physics** | **Write our own model on `sampleTerrain`**, using the *alpine-challenge* "skis rotate, grip rotates velocity" rule (reference only, no licence) and the carve maths from *ski-coach* `js/physics.js` (MIT). *SnowGlider*'s `docs/PHYSICS.md` (MIT) supplies tuning and brake ideas. | No published rigid-body engine models edge grip vs skid. Every good browser ski game we found uses its own kinematic model on a heightfield sampler, and that is our planned architecture already. |
| **Physics numbers** | Ski–snow µ ≈ 0.02–0.05 (0.07 used in carve simulations). Drag area CdA ≈ 0.17–0.24 m² tucked and ≈ 0.25–0.66 m² upright. Carved radius R = R_sidecut·cos(edge). | These come from the published papers in §4. |
| **Snow trails / deformation** | **Noniv/snowflow_demo** (MIT, 623★): a ping-pong RGBA16F world-aligned deformation buffer with berms, refill and toroidal scrolling. | Its technique matches what we need for ski tracks and spray marks. |
| **Spray / snowfall particles** | **three.quarks** (MIT, 1.2k★), with **three-nebula** (MIT) as the alternative. | Both are maintained three.js particle/VFX engines. |
| **Terrain rendering / LOD** | Start with a plain chunked `PlaneGeometry` built from the 5 m grid. Later, use **felixpalmer/lod-terrain** (MIT) or **tschie/geo-clipmap** (MIT) as the LOD reference. **THREE.Terrain** (MIT, 925★) is useful for texturing and scattering helpers. | Apex at 5 m is small enough that chunked meshes will probably do. Add clipmaps only if profiling says so. |
| **Camera** | A hand-written spring chase cam in our own code (alpine-challenge `ChaseCamera.ts` is reference only). Use **camera-controls** (MIT, 2.4k★) for the free/debug camera. | A chase cam is about 50 lines of code. camera-controls has good smooth transitions. |
| **Physics engine (collisions only)** | Optional later: **Rapier** (`@dimforge/rapier3d`, Apache-2.0) for trees, lift towers and buildings. Do **not** route ski motion through it. | Rapier has a heightfield collider, a kinematic character controller and a raycast vehicle controller. For skiing they all fight a custom grip model. |
| **Big real-terrain reference** | **SnowboardAnywhere** (TS + Three + Vite, LiDAR resorts): no licence, so **reference only**. **Soul Ride** (C++, GPL-2.0): real-world-terrain snowboard sim, **reference only** (GPL). | Both are very close to SkiScrapex in concept. |

---

## 1. Ski/snowboard games and demos in JS/TS (Three.js / WebGL)

| Name | URL | Stack | Licence | Last push | ★ | Useful bits | Port effort | Verdict |
|---|---|---|---|---|---|---|---|---|
| SnowGlider | https://github.com/den-run-ai/snowglider | Three.js, JS→TS | **MIT** (source + original assets; bundled third-party assets excluded, see THIRD_PARTY_NOTICES.md) | 2026-11-15 | 4 | A 938-line `docs/PHYSICS.md` covering gravity along the slope, coast friction, skidded parallel vs carve via a `carveCharge` commitment value, a snowplow "hold ramp" with a decel cap tied to slope tiers (stop <18°, slow 18–30°, can't stop >30°), hop turn, tuck drag, jumps, landing grading, deterministic test seam, camera FOV "juice", and a constants table. Has tests and CI. | Low–medium. The model is arcade-style (turning adds lateral velocity, friction is a per-frame multiplier), so treat it as a design and tuning reference, not a drop-in. | **Port ideas / borrow snippets** |
| alpine-challenge (Alpine Downhill) | https://github.com/mikaelguillin/alpine-challenge | Three.js + TypeScript + Vite | **No licence** | 2026-07-29 | 0 | The cleanest carving rule we found: *steering rotates the skis, and edge grip rotates the velocity toward the skis at a bounded rate (`gripAccel / speed · dt`)*. The leftover misalignment becomes skid, spray and speed loss. Fixed 120 Hz accumulator. Takes off when the centripetal acceleration needed to follow the surface exceeds g·n.y. Has `ChaseCamera.ts` and `SnowSpray.ts`. Architecture is close to ours. | n/a | **Reference only** (re-implement the idea, don't copy code) |
| hush | https://github.com/reidwcoleman/hush | Three.js + Vite, JS | **No licence** | 2026-10-26 | 0 | README describes `src/skier.js`: sidecut carving, skids, powder drag, airs "when gravity can't follow the ground", soft landings. Also a procedurally skinned skier with IK legs and arms. | n/a | **Reference only** |
| ski-together | https://github.com/JerzySukiennik/ski-together | Three.js, JS | **No licence** | 2026-08-28 | 0 | Custom (non-rigid-body) ski physics: gravity on the fall line, edge grip capped by the snow, base drag by surface, and a tuck that cuts air drag by a third. Ski stats are turn radius / top speed / edge grip. README has a measured speed table, e.g. 61 km/h straight vs 48 km/h linked turns on a 27.5% pitch, and snowplough from 37 km/h to a stop in 4 s. Also has chairlift and drag lift, and ragdoll. | n/a | **Reference only** (good tuning targets) |
| SnowboardAnywhere | https://github.com/drewkeriazes-personal/SnowboardAnywhere | Three.js + TypeScript + Vite | **No licence** | 2026-11-21 | 0 | Very close to our concept: real resorts rebuilt from USGS 1 m LiDAR, OSM, OpenSkiData, with lifts, trees, carve-and-skid physics, snow conditions (ice, powder, moguls), deforming snow trenches, a `?pack=synth` synthetic test mountain, and a documented pack format (`docs/pack-format.md`). | n/a | **Reference only** (study the design and the pack format) |
| Alpine Descent | https://github.com/santiiturriaga/alpine | Three.js, JS | **No licence** | 2026-11-21 | 0 | Real-mountain (Whistler Blackcomb) sandbox with carve, parallel hockey stop, tuck, walk mode, snowboard sideslip, graphics presets. | n/a | **Reference only** |
| steep | https://github.com/ruslanfridenli/steep | Three.js, JS | **MIT** | 2026-11-10 | 0 | A small 110-line `src/physics.js` with heading-based ski/board, lateral velocity bleed, brake and jump; also a follow cam, carved tracks and spray. | Trivial, but very arcade (magic constants, not physically based). | **Reference only / skip for physics.** Possibly borrow VFX ideas. |
| POWDER LINE | https://github.com/jeiel85/powder-line | Three.js r160, vanilla ES modules (no build) | **MIT** | 2026-11-02 | 0 | Snowboard tricks (spins, flips, grabs), slalom gates, checkpoint respawn, board types with different physics values, WebAudio-synthesised wind/carve sounds, touch controls. Has tests and a live demo at jeiel85.github.io/powder-line. | Low | **Port pieces** (audio synthesis, trick/landing logic) if needed later |
| ski-coach (carving lab) | https://github.com/clarajzt/ski-coach | JS | **MIT** (vendored MediaPipe is Apache-2.0) | 2026-11-10 | 0 | `js/physics.js` (53 lines, pure and tested) holds the carved-turn maths: `r = R_sidecut·cos(edge)`, balance `tan(lean) = v²/(g·r)`, `edge = lean + angulation`, and the critical speed `v = √(g·R_sidecut)` above which a pure carve with no angulation can't balance. | Trivial | **Use directly** (copy with attribution) |
| ski-carving explainer | https://github.com/vladz8/ski-carving | HTML | **No licence** | 2026-10-24 | 0 | Interactive explainer of why a tipped ski turns tighter (home experiment). | n/a | Reference only |
| skitastic | https://github.com/nguest/skitastic | three.js + a physics engine | **MIT** | 2020-03-03 | 4 | Early three.js skiing-with-physics-engine experiment (README is one line). | n/a | Skip (stale, undocumented) |
| Davehello/downhill-v1 | https://github.com/Davehello/downhill-v1 | Three.js, HTML | **MIT** | 2026-11-19 | 0 | A single-file descent game; README is just a title. | n/a | Skip |
| ski-simulator (snowplough trainer) | https://github.com/nickvibes/ski-simulator | Three.js, TS | README says "MIT" but the **repo has no LICENSE file** | 2026-01-11 | 0 | Snowplough mechanics driven per leg by gamepad (knee bend sets edge angle, wedge width sets speed). An interesting input design for the wedge/brake. | n/a | Reference only (licence unclear) |
| digitizdat/ski ("Ski!") | https://github.com/digitizdat/ski | Three.js, JS | **GPL-3.0** (GitHub). The README only says "open source". | 2025-09-15 | 2 | First-person alpine racing, FIS ICR course generation, `physics.js`. | n/a | **Reference only. GPL-3.0 would force SkiScrapex to be GPL if we copied code.** |
| powder-rush | https://github.com/z1302065902-cloud/powder-rush | Three.js + Rapier3D, TS | **No licence** | 2026-09-11 | 0 | Endless downhill game that uses Rapier, if we want to see Rapier used for skiing. | n/a | Reference only |
| skifree.js | https://github.com/basicallydan/skifree.js | JS (2D canvas) | **MIT** | 2026-06-01 | 552 | SkiFree clone, useful for fun/obstacle ideas only. | n/a | Skip (2D) |
| Versant (Three.js forum showcase) | https://discourse.threejs.org/t/versant-skiing-in-the-alpine-procedural-terrain-hand-solved-kinematics-no-authored-animations/93995 | Three.js | No source link found | 2026-09-02 (post) | n/a | Write-up of the key tricks: sample each ski along its length and seat it on the highest contact, closed-form two-bone IK for the legs, physics substeps, swept collision, a carve sound driven by actual edge bite, and cheap analytic shadows. | n/a | Reference only (ideas) |
| Summit Rush (Three.js forum) | https://discourse.threejs.org/t/summit-rush-endless-downhill-skiing-in-vanilla-three-js-procedural-biomes-weather-gtao-on-phones/93051 | Three.js 0.171 + TS + Vite | No source link found | 2026-07-22 (post) | n/a | Same stack as ours. Powder rooster tails off hard carves, and a server-side leaderboard that checks physics samples. | n/a | Reference only (ideas) |

## 2. Ski/snowboard physics in other engines and languages

| Name | URL | Stack | Licence | Last push | ★ | Useful bits | Port effort | Verdict |
|---|---|---|---|---|---|---|---|---|
| snowboard-physics (VR project) | https://github.com/vadym-vorotilin/snowboard-physics | Unity C# | **MIT** | 2020-10-19 | 1 | `Core/SnowboardPhysicsModel.cs` (~600 lines) is a non-rigid-body snowboard model. It tracks slope angle α, tilt φ and turn radius from tan φ, with separate edge and snow friction coefficients, air resistance, skidding target/source angles, carving angular velocity, contact loss/landing, and normals averaged over several sample radii (good for a 5 m heightfield). Also has trail mesh generation (`SnowboardTrail.cs`) and a trail shader. | Medium. Straight C#→TS, swapping Unity raycasts for `sampleTerrain`. | **Port** (strongest licence-clean "real" model we found) |
| Soul Ride | https://github.com/Echelon9/soulride | C++ / OpenGL | **GPL-2.0** | 2019-02-19 | 9 | Commercial snowboarding sim, later relicensed to GPL, built on real-world survey terrain with a "meticulous" physics sim and a terrain engine. | High | **Reference only (GPL).** Read for ideas, don't copy code into SkiScrapex. |
| Extreme Tux Racer | https://sourceforge.net/projects/extremetuxracer/ | C++ / OpenGL / SFML | **GPL-2.0** | 0.8.4 released 2024-05-09 | n/a | Classic heightfield downhill racer with track marks, snow particles and friction by terrain type. | High | **Reference only (GPL)** |
| Ski or Perish | https://github.com/SleepingColossus/ski-or-perish-godot | Godot 4, GDScript | **BSD-3-Clause** | 2023-12-01 | 3 | Small Godot skiing game (itch.io: sleepingcolossus.itch.io/ski). | Low value | Skip |
| KinematicBoarder | https://github.com/DeerTears/KinematicBoarder | Godot, GDScript | **No licence** | 2021-06-22 | 6 | An early arcade snowboard racer. The author calls it an early attempt. | n/a | Skip |
| Skii | https://github.com/Piripant/skii | Rust (ggez), 2D | **No licence** | 2018-01-04 | 72 | Data-driven tiles with separate `forward_friction` and `sideway_friction` per snow type. A neat idea for our snow-surface table. | n/a | Reference only (idea) |
| UllrSkiAndSnowboard | https://github.com/drewv-labs/UllrSkiAndSnowboard | C# (Valheim mod) | **No licence** | 2026-11-12 | 0 | Skis and snowboard with carving physics, ramps, gates, rope tows. | n/a | Reference only |

We found no notable open-source Unreal or Bevy 3D ski physics projects. Searches mostly returned AI "skills" repos or 2D games.

## 3. Supporting pieces for Three.js

| Name | URL | Language | Licence | Last push | ★ | Fit for SkiScrapex | Verdict |
|---|---|---|---|---|---|---|---|
| three.js | https://github.com/mrdoob/three.js | JS | MIT | 2026-11-21 | 119k | Core. Examples include `webgl_geometry_terrain` and `GPUComputationRenderer` (useful for ping-pong snow buffers). | **Use directly** |
| Noniv/snowflow_demo | https://github.com/Noniv/snowflow_demo | JS | **MIT** | 2026-07-28 | 623 | Snow deformation: two 2048² RGBA16F ping-pong targets over 80 m (3.9 cm texels), toroidal scrolling that follows the player, channels for depth/berm/compression/ice, refill/slump/wind infill, and displacement in both the beauty and shadow passes. Ideal for ski tracks. | **Port / use** |
| three.quarks | https://github.com/Alchemist0823/three.quarks | TS | **MIT** | 2026-11-18 | 1.2k | Particle/VFX engine for spray, powder clouds and snowfall. | **Use directly** |
| three-nebula | https://github.com/creativelifeform/three-nebula | JS | **MIT** | 2026-10-22 | 1.2k | The alternative particle engine. | Use if quarks doesn't fit |
| THREE.Terrain | https://github.com/IceCreamYou/THREE.Terrain | JS | **MIT** | 2026-11-19 | 925 | Heightmap terrain helpers: height-based texture blending, scattering (trees), smoothing. | Use pieces |
| lod-terrain | https://github.com/felixpalmer/lod-terrain | JS | **MIT** | 2018-06-14 | 473 | WebGL terrain with seamless LOD changes. Old three.js, so it is a technique reference. | Port technique if needed |
| geo-clipmap | https://github.com/tschie/geo-clipmap | JS | **MIT** | 2021-12-26 | 21 | Geometry clipmap terrain LOD demo. | Reference / port if needed |
| terrain-kit | https://github.com/vibegameengine/terrain-kit | TS (three WebGPU) | **MIT** | 2026-11-08 | 0 | GPU quadtree heightfield terrain on WebGPU. New and unproven. | Watch |
| emerald-bayou | https://github.com/Vheissu/emerald-bayou | JS, three.js + Vite | **MIT** | 2026-09-08 | 14 | Full browser game with a 25.6 km streamed world and quadtree LOD terrain. A good real-world example of streaming terrain on our stack. | Reference / port pieces |
| HeightField | https://github.com/shootTheLuck/HeightField | JS | **MIT** | 2023-08-16 | 6 | Small `THREE.Mesh` heightfield with getHeight. | Skip (we have `sampleTerrain`) |
| 3DTilesRendererJS | https://github.com/NASA-AMMOS/3DTilesRendererJS | JS | **Apache-2.0** | 2026-11-11 | 2.5k | Streaming 3D Tiles. Only relevant for distant scenery or photogrammetry around Apex. | Later / optional |
| three-geospatial | https://github.com/takram-design-engineering/three-geospatial | TS | **MIT** | 2026-05-27 | 1.8k | Physically based atmosphere, sky and clouds for three.js. Good for the sky and horizon look. | Use later for sky |
| postprocessing | https://github.com/pmndrs/postprocessing | JS | **Zlib** | 2026-11-01 | 3.0k | Bloom (snow sparkle highlights), SMAA, tone mapping. | **Use directly** |
| camera-controls | https://github.com/yomotsu/camera-controls | TS | **MIT** | 2026-10-21 | 2.5k | Debug/free camera and smooth transitions. The gameplay chase cam should be our own. | Use for debug cam |
| THREE.MeshLine | https://github.com/spite/THREE.MeshLine | JS | **MIT** | 2026-10-20 | 2.4k | Thick lines. A cheap way to draw ski tracks before the deformation buffer exists. | Optional |
| TrailRendererJS | https://github.com/mkkellogg/TrailRendererJS | JS | **No licence file** | 2024-06-10 | 191 | Trail ribbons. | Reference only |
| Rapier (`@dimforge/rapier3d`) | https://github.com/dimforge/rapier (JS bindings migrated from https://github.com/dimforge/rapier.js) | Rust→WASM | **Apache-2.0** | 2026-11-01 | 6.1k | Heightfield collider (`ColliderDesc.heightfield`), Kinematic Character Controller (snap-to-ground, max slope angle), `ray_cast_vehicle_controller`. Good for collisions with trees, towers and buildings. The ski grip model should stay custom. | **Use later for collisions only** |
| cannon-es | https://github.com/pmndrs/cannon-es | TS | **MIT** | 2024-01-06 | 2.1k | Pure-JS engine with heightfield and RaycastVehicle. Last push was 2024 (low activity). | Fallback only |
| ammo.js | https://github.com/kripken/ammo.js | C++→JS (Bullet) | **zlib** (LICENSE file; GitHub shows NOASSERTION) | 2026-09-22 | 4.6k | Bullet port with a heightfield shape. Heavy and awkward API. | Skip |
| JoltPhysics.js | https://github.com/jrouwe/JoltPhysics.js | C++→WASM | **MIT** | 2026-11-21 | 591 | Fast and maintained, with heightfield shape, character and vehicle support. | Alternative to Rapier |
| ecctrl | https://github.com/pmndrs/ecctrl | TS (React Three Fiber + Rapier) | **MIT** | 2026-09-06 | 820 | Floating-capsule character controller, but tied to R3F. | Reference only (we're not using React) |

Snow *look*: we found no dedicated open-source "snow sparkle/glitter" shader repo for three.js. The usual approach is a fragment-shader term: high-frequency hashed normals or a noise texture, with sparkle where `pow(dot(reflect, view), N)` crosses a threshold, then bloom from `postprocessing`. Expect to write this ourselves (~30 lines). Useful technique write-ups: https://www.shardsofstone.com/blog/snow-that-remembers-where-you-walked (MIN-blend trail buffer in three.js) and https://www.fromscratchlab.com/GLSL/snow (height texture → stamp → displace → light).

## 4. Reference physics (papers and articles)

| Source | URL | What we take from it |
|---|---|---|
| Balanced carving turns in alpine skiing (Sports Biomechanics, 2020) | https://doi.org/10.1080/14763141.2020.1795236 | Carved radius **R_e = R_sc · cos Ψ** (sidecut radius, edge angle). Pure carving means no side-slip and the ski is transported along its edge. Also the balance and angulation conditions. |
| Physics of skiing: the ideal-carving equation (Can. J. Phys., 2004) | https://cdnsciencepub.com/doi/full/10.1139/p04-010 | Ideal-carving equation that links speed, slope inclination, edge angle and sidecut. Shows when a pure carve is possible. |
| Mössner et al. 2006, Modeling of the ski–snow contact for a carved turn | http://sport1.uibk.ac.at/mm/publ/182--Moessner--2006--Modeling_of_the_Ski_Snow_Contact_for_a_Carved_Turn.pdf | Coulomb friction **µ = 0.07** in carve simulations. Penetration and shear forces, and a small allowed skid velocity. |
| Heinrich et al. 2006, Ski bending stiffness vs turning radius | http://sport1.uibk.ac.at/mm/publ/181--Heinrich--2006--Influence_of_Ski_Bending_Stiffness_on_the_Turning_Radius_of_Alpine_Skis_at_Different_Edging_Angles_and_Velocities.pdf | A higher edge angle reduces skidding. A higher speed raises centrifugal load and skidding. Example: 170 cm ski with 12.5 m sidecut, 75 kg skier. |
| The kinetic friction of polyethylene on snow (Cold Regions Sci. Tech.) | https://winterwildlands.org/wp-content/uploads/2023/05/Report-The-kinetic-friction-of-polyethylen-on-snow.pdf | µ is about 0.02 at its minimum, about 0.05 near 0 °C, and up to about 0.18 on very cold snow, so it varies with snow type and temperature. |
| Colbeck, A review of the processes that control snow friction | http://hdl.handle.net/11681/2667 | Overview of friction mechanisms (meltwater, temperature, speed). |
| Field investigation of cross-country ski–snow friction (arXiv 2212.08524) | https://arxiv.org/html/2212.08524v1 | Full-ski field µ of about 0.0145–0.033, typically 0.02–0.03 on prepared snow. |
| Factors affecting the aerodynamic drag of alpine skiers | https://www.researchgate.net/publication/222205764_Factors_affecting_the_aerodynamic_drag_of_alpine_skiers | Tuck CdA is 0.17–0.23 m² (Cd 0.51–0.60) and upright CdA is 0.25–0.33 m². Drag at 100 km/h is 89 N in the best tuck and 290 N standing (+226%). |
| Wind-tunnel drag model for SL/GS skiers (Applied Sciences 12(2):902, 2022) | https://www.mdpi.com/2076-3417/12/2/902 | Cd·S ranges from **0.23 m² (tuck) to 0.66 m² (high)**. Cd is 0.75–0.80 in a tuck, 0.94–1.00 mid and 1.09–1.17 high. |
| Aerodynamic investigation of tucked positions (J. Biomech. 2021) | https://www.sciencedirect.com/science/article/pii/S002192902100107X | Drag area rises by about 0.8% per degree of torso angle and about 1.2% per degree of thigh angle. Lower legs give 40–50% of tuck drag. |

---

## Recommended approach for SkiScrapex ski physics

**Decision: a custom kinematic ski model on `sampleTerrain`, at a fixed 120 Hz timestep, with no rigid-body engine in the ski loop.** Every serious browser ski game we found converged on this (alpine-challenge, ski-together, hush, SnowGlider, SnowboardAnywhere). Engine contact friction is isotropic, so making it produce anisotropic ski grip (low along the ski, high across it) and carve-vs-skid behaviour means fighting the solver.

Sketch (all in metres and SI units, in the +X east / +Y up / +Z south frame):

1. **Contact.** Sample `sampleTerrain` at the ski tip, mid and tail, or average normals over a small radius as snowboard-physics does. Use the highest contact for height and a blended normal. `null` means off the map, so reset. At a 5 m grid, smooth the normals (bilinear or Catmull-Rom), otherwise 5 m facets read as kinks.
2. **Gravity along the slope.** `a_g = g − (g·n)n`, the tangential component.
3. **Skis vs velocity (the carve rule).** Steering input turns the *ski heading* (rate scales down with speed) and sets the edge angle Ψ. Carved radius is `R = R_sc·cosΨ` (ski-coach and Howe/Lind & Sanders). Grip rotates the velocity toward the ski heading at up to `a_grip/|v|` rad/s, where `a_grip = µ_edge(snow)·g·n_y·f(Ψ)`. Any leftover misalignment is **skid**: it gives lateral friction (speed loss), spray intensity and track width. This one rule produces carving, skidded turns and the hockey stop (skis 90° to travel means a large skid that bleeds speed).
4. **Snowplow.** A wedge angle term that adds along-track deceleration, capped (as in SnowGlider) so it can't stop you on steep pitches. Clamp it so it never reverses velocity.
5. **Friction and drag.** Base friction `µ·N` with µ about 0.03–0.05 groomed (table per snow surface, as in Skii's forward/sideways friction idea). Air drag `½ρ·CdA·v²` with CdA about 0.6 standing/high, 0.4 mid and 0.2 tuck (from the MDPI and ResearchGate papers).
6. **Air.** Leave the ground when the centripetal acceleration needed to follow the surface exceeds `g·n_y` (alpine-challenge), or when height above the terrain is greater than ε. Ballistic flight, then a landing grade from the impact speed along the normal.
7. **Reset.** Fall-over and off-map trigger a respawn at the last safe pose.
8. **Tests.** Deterministic sim with seed and fixed dt. Target numbers to check against (ski-together and SnowGlider style): straight-run terminal speed on a known pitch, snowplough stopping distance, and a carve holding speed better than a skid.

**What to port first:** carve maths from ski-coach (MIT, copy with attribution), then the structure of snowboard-physics `SnowboardPhysicsModel.cs` (MIT, port C#→TS), with SnowGlider's `PHYSICS.md` (MIT) as the tuning and design checklist. Re-implement the alpine-challenge grip-rotation rule from its README description rather than copying its code (it has no licence).

**Rendering stack later:** chunked terrain mesh from the 5 m grid → a snow material with sparkle term + `postprocessing` bloom → three.quarks spray driven by the skid value → snowflow-style deformation buffer for ski tracks → Rapier only for static obstacle collisions.

## Licence notes

- **OK to copy with attribution:** MIT, Apache-2.0, BSD-3-Clause, Zlib. Keep the original copyright notice in any copied file or in `THIRD_PARTY_NOTICES.md`. Apache-2.0 also needs its NOTICE file carried along if one exists.
- **GPL-2.0 / GPL-3.0** (Soul Ride, Extreme Tux Racer, digitizdat/ski): copying any code would make SkiScrapex a GPL derivative. Read them for ideas only, and don't paste code.
- **No licence** (SnowboardAnywhere, alpine-challenge, hush, ski-together, santiiturriaga/alpine, powder-rush, TrailRendererJS, etc.): all rights reserved. Use them as **reference only**: study and re-implement ideas, never copy code or assets.
- **SnowGlider:** its MIT grant covers its own code and assets only. Its bundled third-party assets carry their own licences.
