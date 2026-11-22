# SkiScrapex: carving, powder, terrain park and controls

*Compiled 2026-11-21. This is a follow-up to `game/research/open-source-survey.md` and `game/research/snowboard-anywhere.md`. Projects and papers already covered there (ski-coach, alpine-challenge, SnowGlider, snowboard-physics, the drag and friction papers, Mössner, Heinrich) are only referenced here, not re-surveyed. Everything is written in our own words. Where a project has no licence or a GPL licence, it is marked reference only.*

Frame and units throughout: metres, seconds, kilograms, radians unless degrees are stated. +X east, +Y up, +Z south. Fixed step dt = 1/120 s. g = 9.81 m/s².

---

## 1. Carving on groomed runs (experience A)

### 1.1 What the literature gives us

**Carved radius.** R = R_sc · cos Ψ, where R_sc is the ski's sidecut radius and Ψ the edge angle. Already in our `carve.ts` (ski-coach port). Komissarov states the same relation in [Modelling of carving turns in alpine skiing (arXiv 1812.02539)](https://ar5iv.labs.arxiv.org/html/1812.02539).

**Balance on a slope (the Ideal Carving Equation).** Komissarov extends the level-ground balance in ski-coach to a slope. With slope angle α and traverse angle β (β = 0 when heading straight across, so cos β tells you how far you are from the fall line), the inclination Φ needed for balance is:

```
tan Φ = (v² / (g R)) / cos α  −  tan α · cos β
```

Pure carving needs Φ to match the ski's edge angle Ψ (or Ψ − angulation, if we let the body angulate). The second term is why the top half of a turn (heading across or up the hill) needs less lean than the bottom half. Our current `carve()` uses the level form `tan(lean) = v²/(gR)`, so swapping in this slope form is a small, well-sourced upgrade.

**Speed limits on a pure carve** (same paper):
- Critical speed `V_sc = sqrt(g · R_sc · cos α)`. Above it the lower part of the turn cannot be carved cleanly; the skier must skid or angulate harder. For R_sc = 14 m on a 15° slope this is about 11.5 m/s (41 km/h).
- A fully rounded carve needs `v > sqrt(g · R_sc · sin α)`. Below that, carving is confined near the fall line. The window between the two closes on slopes of about 45° and steeper.
- Practical inclination limit: about 3 g load (Φ around 70°). Our `LOAD_MAX = 3` already matches this.
- Along-turn speed (dimensionless in the paper): gravity along the slope minus friction scaled by the turn's g-load minus air drag. The useful point for us: **friction should scale with total load (gravity normal plus centripetal), not just g·cos α.** That is what makes a hard, high-load carve cost a little speed even without skidding.
- Angulation decouples ski and body inclination and gives trajectory control, but the paper shows it narrows the slopes where a pure carve is possible.

**Side-slip (skid) resistance.** Komissarov's [Mechanics of side-slipping in alpine skiing (Sports Engineering 24, 2021)](https://link.springer.com/article/10.1007/s12283-021-00340-7) models a skidding ski as a cutting tool machining the snow:
- Cutting force is about `N · tan Ψ`, with a suggested `+0.2` correction, so the effective lateral friction is `µ_lat ≈ tan Ψ + 0.2`. At Ψ = 45° this reaches about 1, which is the hockey-stop regime.
- Split by the attack angle γ (angle between ski and velocity): braking component `F_c · sin γ`, turning component `F_c · cos γ`. At typical attack angles of 10° to 20° the turning part dominates, which is why a slightly skidded turn still turns well.
- Cutting depth on hard snow is a few millimetres, and spray width is roughly equal to cutting depth. Good for spray VFX scaling.
- A snow shear limit caps the edge angle a surface can hold (about 81° in the paper's example). On ice this cap should be much lower in game terms.

### 1.2 What games and projects do

- **SnowGlider** (MIT, already surveyed) adds a commitment value: holding one steer direction for about 0.4 s locks in a carve, and a reversal resets it. Their test gate requires a clean carve to beat rapid skidding by more than 12% on the same line, and they measure about 40%. That is a good acceptance test for us. Source: [docs/PHYSICS.md](https://raw.githubusercontent.com/den-run-ai/snowglider/main/docs/PHYSICS.md).
- **POWDER LINE** (MIT): sideways speed is reduced by board grip, and while carving 60% of the cancelled lateral speed is returned as forward speed. Steering rate is scaled by `1/(1 + v/38)`. Source: [src/game.js](https://raw.githubusercontent.com/jeiel85/powder-line/main/src/game.js).
- **Grand Mountain Adventure** devs tried making steering less precise at speed and letting external forces cause crashes; players found it random and annoying, so they pulled back to a middle ground. Lesson: washout and chatter should be **readable and earned**, never random. Source: [80.lv interview](https://80.lv/articles/developing-a-ski-open-world-game-for-mobile).
- **Versant** (three.js forum, no source) drives the carve sound from actual edge bite. We should do the same with chatter audio.

### 1.3 Techniques worth reimplementing

1. **Edge angle as the primary input.** Steering sets a target edge Ψ_target; Ψ slews toward it at a finite rate. The ski's own yaw rate while carving is `v / R` with `R = R_sc cos Ψ`. Heading then follows the edge rather than the stick, which is what makes carving feel "locked in".
2. **Grip budget.** Required lateral acceleration `a_req = v² / R`. Available grip `a_grip = µ_lat(Ψ, surface) · N/m`, with `µ_lat = min(tan Ψ + 0.2, µ_lat,max(surface))`. If `a_req ≤ a_grip` the turn carves. Otherwise the excess becomes skid (the existing grip-rotates-velocity rule handles this).
3. **Washout.** When the slope-form balance needs more angulation than `ANG_MAX`, or load exceeds `LOAD_MAX`, the edge releases: drop grip by 40% to 60% for 0.15 to 0.3 s and let the skis drift. Visible, audible, recoverable.
4. **Chatter** (game design, not from a paper). When the grip ratio `a_req / a_grip` sits in a narrow band just above 1 (for example 0.95 to 1.25) on hard snow, modulate grip with a 10 to 15 Hz oscillation plus noise. At 120 Hz that is 8 to 12 samples per cycle, so it is representable. Mean grip loss about 15%. Feed the same signal to audio, camera shake and gamepad or phone haptics. On ice the band is wider.
5. **Transitions.** Edge crossing through |Ψ| < 6° is a flat-ski moment with low grip. If the previous turn ended with load above about 1.5 g and the edge change takes under 0.25 s, grant a short rebound unweight (reduce normal load 30% for 0.1 s) so a quick crossover is snappy and a slow one is mushy.
6. **Friction scales with load.** `F_fric = µ_base · m · |a_normal_total|`, where the normal includes the centripetal part. A 2 g carve then costs twice the base friction, as in Komissarov's speed equation.

---

## 2. Powder off-piste (experience B)

### 2.1 What the literature gives us

- **Compaction (plunger) law.** Lind and Sanders, *The Physics of Skiing* (Springer 2004), chapter [Ski Flexure in Uncompacted Snow](https://rd.springer.com/chapter/10.1007/978-1-4757-4345-6_22): the pressure needed to compact snow to depth y follows `p = k · yⁿ`, with k and n depending on initial density. Because the ski also moves forward, a plowing force resists it. Compaction loading also bends the ski into reverse camber, which is why sidecut matters less in deep snow.
- **Lift from trapped air and crystals.** Wu et al., [Lift mechanics of downhill skiing and snowboarding (APS DFD 2005)](https://meetings-archive.aps.org/dfd/2005/am/11), later revised in [A modified lift mechanics theory](https://sponet.de/sponet/Record/3042208?lng=en): lift comes partly from air trapped and pressurised under the ski and partly from compressed snow crystals. Trapped air gives about 40% of lift for skis in wind-packed snow, but under 20% in highly permeable fresh powder. Lift depends on permeability, speed, friction and planform. For us: **lift grows with speed (planing), and the speed benefit is smaller in light, dry powder.**
- **Games:** Shredders reviewers note that soft fresh snow makes wipeouts more likely ([Windows Central review](https://www.windowscentral.com/shredders-xbox-review); [Wikipedia](https://en.wikipedia.org/wiki/Shredders_(video_game))). Grand Mountain Adventure records all tracks into one large texture used as both a bump map and a material lookup ([80.lv](https://80.lv/articles/developing-a-ski-open-world-game-for-mobile)), the same idea as snowflow_demo from the first survey.

### 2.2 A game model derived from the plunger law

These are our own derivations from the plunger relation, not formulas quoted from a paper. Take n = 1 (linear) for simplicity.

- **Static sink.** Two skis with total base area A carry the weight: `k · y_s · A = m g cos α`, so `y_s = m g cos α / (k A)`.
- **Planing.** Dynamic lift reduces sink with speed. A simple form: `y_eq = min(depth, y_s / (1 + (v / v_plane)²))`. Lower `v_plane` for denser or wind-packed snow (more trapped-air lift, per Wu), higher for blower powder.
- **Sink dynamics.** `dy/dt = (y_eq − y) / τ_sink`, with τ_sink around 0.2 to 0.3 s, so you settle into the snow when you slow down and rise as you gain speed.
- **Compaction drag.** The work to compact a channel of width w to depth y is `w ∫ k y' dy' = w k y² / 2` per metre travelled, so the resisting force is `F_compact = w_total · k · y² / 2`. This is speed-independent and makes slow powder feel like wading.
- **Plow and spray drag.** Add a speed term for throwing snow aside: `F_plow = c_plow · ρ_snow · w_total · y · v²`.
- **Worked numbers** (80 kg skier, two 1.75 m × 0.11 m powder skis, A = 0.385 m², w_total = 0.22 m, tuned so standing sink is 0.30 m): k ≈ 6800 Pa/m. With v_plane = 7 m/s, sink is about 0.20 m at 5 m/s and 0.10 m at 10 m/s. Compaction drag is about 67 N at 0.30 m sink (an equivalent µ of about 0.09) and about 7 N at 0.10 m. With ρ_snow = 100 kg/m³ and c_plow = 0.1, plow drag is about 11 N at 5 m/s and 22 N at 10 m/s. So there is a clear "get on top and stay fast" incentive, without a wall.

### 2.3 Turning, spray and face shots

- **Slower turning.** Scale ski yaw rate by `1 / (1 + y / y_turn)` with y_turn ≈ 0.15 m. Sidecut contributes less (reverse camber), so use `R = max(R_sc cos Ψ, R_min,powder)` with R_min,powder ≈ 8 m.
- **Skidding is expensive in powder.** Swinging skis sideways compacts extra snow, so multiply compaction drag by `1 + 2·skid`. Smooth, round turns are then fastest, as in real powder.
- **Bounce / unweight.** A pop input in powder sets y_eq to 30% of normal for 0.25 s and doubles yaw rate during that window. This is the rhythmic up-unweight-turn of powder skiing and doubles as the escape from getting bogged down.
- **Stuck rule.** If v < 1.5 m/s and y > 0.25 m, skate push is reduced to 30%; a hop is the way out.
- **Tip dive.** On landing in powder, set y to min(depth, 1.5·y_s). If the skis land nose-down by more than 25° with y > 0.3 m, it is a crash (tomahawk). Otherwise apply a hard deceleration from the compaction drag.
- **Spray.** Emit rate proportional to `y · v · (0.3 + skid)`. Plume height scales with v and y. On groomers use Komissarov's rough estimate that spray width is about the cutting depth (a few mm), so it is a thin sheet, not a cloud.
- **Face shots.** When y > 0.45 m and the skier is in the compression phase (load rising past 1.3 g at the bottom of a turn), trigger a short screen-space snow burst and a muffled audio filter.

---

## 3. Terrain park freestyle (experience C)

### 3.1 Jump physics from the safety literature

- **Equivalent fall height (EFH).** McNeil, Hubbard and colleagues measure landing severity as the drop height that would produce the same impact on the legs. From [Designing, Building, Measuring and Testing a Constant EFH Terrain Park Jump (arXiv 1611.04448)](https://ar5iv.labs.arxiv.org/html/1611.04448): `h = Δv⊥² / (2g)`, where Δv⊥ is the change in velocity normal to the landing surface. The Sports Engineering paper [s12283-015-0182-6](https://link.springer.com/article/10.1007/s12283-015-0182-6) writes it as `h = v_J² sin²(θ_J − θ_L) / (2g)` (landing speed v_J, jumper's flight angle θ_J, landing slope θ_L).
- **Limits.** The US Terrain Park Council recommends EFH below 1.5 m, from the leg absorption limit reported by Minetti et al. EFH of 3 to 10 m has been found where severe spinal injuries occurred. The test jump was built for a gentle 0.5 m EFH.
- **Design speed.** Terminal speed on an approach is `v_T = sqrt(g (sin θ_A − µ cos θ_A) / η)` with η the drag term (`ρ C_d A / 2m`). The paper suggests designing for 80% of v_T where riders can reach it.
- **Transitions.** Minimum curve radius `r_min = v² / a_max`. Non-elite riders tolerate about 1.5 g normal acceleration (FIS elite standards use about 0.7 g). Clothoid transitions keep jerk bounded.
- **Takeoff shape.** Keep the last 2 m of a kicker straight, avoid inverting curvature at the lip, and keep landings under about 30° (grooming limit). Test jump: 10° takeoff on a 17° parent slope, about 14 m long.
- **Constant-EFH landing.** The paper gives an ODE for a landing surface with the same EFH everywhere; notably the solution does not depend on takeoff speed. We do not need to solve it at runtime, but our park authoring tool can, to generate landings that feel consistent.

**Takeaway for us:** compute EFH on every landing and use it directly as the impact metric for grading. It is a cited, physical number, and the 1.5 m and 3 m thresholds map neatly onto clean, sketchy and crash.

### 3.2 Takeoff, pop and air

- **Takeoff detection.** Keep the existing rule (leave the ground when the curvature-following acceleration exceeds g·n_y). POWDER LINE also leaves the ground if the rider is more than 0.35 m above terrain or the gap opens faster than 2.2 m/s. Both are good fallbacks.
- **Kickers must not come from the 1 m heightfield.** A 3 m kicker is only three cells; the lip will be mush. Author park features (kickers, rollers, rails, boxes) as analytic height overlays added inside `sampleTerrain` (the same way SnowboardAnywhere adds moguls on top of base height), with normals from the overlay's own derivative.
- **Pop / ollie.** Hold to crouch and charge, release to pop along the surface normal. A real ski ollie of 0.3 to 0.5 m needs `v = sqrt(2 g h)` ≈ 2.4 to 3.1 m/s. POWDER LINE uses a much more arcade 3.4 to 7.0 m/s scaled by board, charging at 1.6 per second.
- **Lip timing.** Pop released within about 0.12 s before leaving the lip adds a bonus; later is lost. This gives skill expression on every jump.
- **Landing prediction.** POWDER LINE steps the ballistic path at 0.04 s up to 4 s ahead, refreshing each 1/60 s. Use it for the auto-rotation assist, the camera and the landing marker.
- **Spins and flips.** POWDER LINE (classic mode) drives spin and flip rates toward input times a board rate, with damping 6 to 9 per second. Its easy mode adds 360° per tap and, in the last 0.45 s, snaps the targets to the nearest landable angle (multiples of 180° for spins, 360° for flips).
- **Pre-wind** (common in modern snowboard games such as Shredders; not documented in detail in the sources we read): holding the spin direction on the ground before takeoff stores windup and sets the initial spin rate. This makes spins physical (you commit at takeoff) while still allowing some air control.

### 3.3 Landing evaluation

| Source | Rule |
|---|---|
| POWDER LINE (MIT) | Spin error is the distance to the nearest 180° multiple, flip error to the nearest 360°. Crash if spin error exceeds about 52° or flip error about 54° (classic), or normal impact speed exceeds 22 m/s. Perfect below about 10° spin and 13° flip error. A good landing still loses up to 45% speed scaled by errors. |
| SnowGlider (MIT) | Clean needs travel aligned with the fall line (dot > 0.85) and impact below a threshold. Sketchy scrubs speed. Clean gives up to 6% speed boost. Landing mid-rotation (spin over 60°, flip over 75°) halves trick points and forces sketchy. |
| Bord (MIT) | Grades perfect, clean, sloppy or bail by comparing the board's real angle and the surface with the direction of travel. Flips must be at least 82% complete at touchdown. |
| McNeil and Hubbard | EFH under 1.5 m is what legs can absorb; 3 m and up is injury territory. |

### 3.4 Rails and boxes

- **Bord** (MIT, Godot 4): rail, ledge and coping grinds with a left/right balance, manuals that carry a combo through a landing, reverts within about 0.4 s of touchdown. Spins are counted from the body's actual rotation. Source: [codeberg.org/alimiracle/bord](https://codeberg.org/alimiracle/bord).
- **Mathematics of grinding** ([alexdiru, Substack](https://alexdiru.substack.com/p/mathematics-of-grinding-part-1)): rails as polylines of straight segments; on contact, attach to a follower on the path; choose direction by projecting `midpoint + velocity` and taking the closer endpoint. (For us the simpler `sign(v · t)` does the same.) The prototype used constant grind speed; we should keep momentum instead.
- **RailGrind** ([SGTADMAN/RailGrind](https://github.com/SGTADMAN/RailGrind)): Unity Splines demo, no licence found, reference only.
- **SSX 3** scoring ([GameSpot](https://www.gamespot.com/articles/ssx3-big-air-big-scores-big-combos/1100-6074830/)): rail points for getting on, sliding length and jumping off; rail points kept even if you crash the landing; combos chain airs, rails and presses; repeating the same trick significantly reduces its points.

### 3.5 Scoring references

- POWDER LINE: airtime × 120, plus 280 per 180°, plus 900 per flip, plus 320 per second of grab (cap 2 s); perfect ×1.25; combo +1 per trick landed within 5 s, max ×5; crash resets.
- SnowGlider: airtime × 100 plus bonuses; clean +50.
- SSX 3: grab hold time raises value; spins by degrees, flips by count; off-axis and variety bonuses; repetition penalty.

---

## 4. Controls

### 4.1 Evidence on mobile input

- **Teather and MacKenzie, [Comparing Order of Control for Tilt and Touch Games (IE 2014)](https://www.yorku.ca/mack/ie2014.html):** order of control mattered more than input device. Position control (input maps to a position/state) beat velocity control (input maps to a rate) for both tilt and touch. Touch with position control was almost unanimously preferred; tilt with velocity control was rated worst. Recommendations: offer both tilt and touch, prefer position control, let players rescale and reposition virtual controls. Their tilt used a 10° to 60° range around a 35° neutral.
- **Suhaib 2018, [Tilt or Touch](https://www.slideshare.net/msuhaibkhan/tilt-or-touch-an-evaluation-of-steering-control-of-racing-game-on-tablet-or-smartphone):** no significant difference in racing completion time or collisions; small sample. Players split on preference.
- **Descenders mobile ([Game Developer deep dive](https://www.gamedeveloper.com/game-platforms/deep-dive-creating-the-touch-controls-for-descenders-on-mobile)):** final layout is a left stick for steer and lean, a right stick for sliding, pumping and hops, plus right-side accelerate and brake zones. Tricks are flicks of the right stick while airborne, which they called the hardest part. Quadrant or slice schemes and many separate buttons were rejected as too complex or cluttered. Goal: two sticks, minimal on-screen elements.
- **Grand Mountain Adventure ([80.lv](https://80.lv/articles/developing-a-ski-open-world-game-for-mobile)):** skiing needs no forward button, which simplifies touch. Portrait was too narrow; landscape with the player moving at about 15° to the screen showed more of the track.
- **Alto's Adventure ([fandom wiki](https://altosadventure.fandom.com/wiki/Alto%27s_Adventure)):** one-button scheme, tap to jump and perform tricks, chain tricks for points and speed. Proof that a single well-timed input can carry a whole freestyle loop.
- **VertiBoard** (MIT, three.js, [Jack-IDE/VertiBoard](https://github.com/Jack-IDE/VertiBoard)): left lower lane drag to carve, swipe up to push; right pad tap to ollie; in the air, pairs of quick flicks map to flip tricks; adjustable control opacity.
- **SnowGlider:** on touch, a manual pop needs a steer-free tap in the screen centre, so on touch most air comes from kickers. Avoid making pop depend on releasing steering.

### 4.2 Recommended mapping

**Desktop keyboard**

| Action | Keys | Notes |
|---|---|---|
| Steer (edge) | A/D or Left/Right | Digital keys ramp an analog value: rise 4/s, release 6/s, so a tap gives a light edge and a hold commits. Value maps to Ψ_target (position control). |
| Tuck | W / Up | |
| Brake (wedge or hockey stop) | S / Down | Existing behaviour. |
| Crouch and pop | Space (hold, release) | Hold charges 0 to 1 over 0.4 s. In powder: bounce/unweight. |
| Grab | Shift or J (hold) | Grab type from the air direction held. |
| Air: spin | Left/Right in the air | Sets target spin rate. Held on the ground before a lip: pre-wind. |
| Air: flip | Up/Down in the air | |
| Gamepad | Left stick X edge, Y tuck/brake; A pop; triggers grab; right stick flick for air tricks | Mirrors the Descenders layout. |

**Mobile touch (default)**

- **Left half: floating thumb stick, position control.** Horizontal offset from the touch-down point maps directly to Ψ_target (full edge at about 60 px). Drag down past 30 px = brake, up = tuck. Releasing centres the edge. This follows the position-control finding.
- **Right half: action pad.** Press and hold = crouch charge; release = pop. In the air: a swipe = spin (left/right) or flip (up/down); swipe distance or repeat swipes add 180°/360°; press and hold = grab. On a rail: left/right drag = balance.
- **Assists (default on, toggle in settings):** auto-snap rotation to landable angles in the last 0.45 s (POWDER LINE easy mode), widened landing tolerances, auto-grab after 0.35 s of air.
- **Tilt (opt-in).** Map device roll to Ψ_target, again as position control: 2° deadzone, full edge at 22° of roll, calibrate neutral when the run starts. Use `screen.orientation.angle` to pick the right axis in landscape. iOS Safari needs `DeviceOrientationEvent.requestPermission()` from a user tap.
- **Layout.** Landscape, controls resizable and movable, adjustable opacity (Teather and MacKenzie; VertiBoard).
- **Haptics.** `navigator.vibrate` for chatter and landings works on Android browsers; iOS Safari does not support the Vibration API, so pair it with audio and camera shake.

---

## 5. Projects and sources

Licences were checked from the LICENSE file where it could be fetched. The GitHub API was not reachable from this session, so star counts and push dates are not repeated here. Items marked "see survey" are documented in `game/research/open-source-survey.md`.

| Name | URL | Licence | Language / engine | Relevance | Reuse status |
|---|---|---|---|---|---|
| POWDER LINE | https://github.com/jeiel85/powder-line | **MIT** (LICENSE fetched, © 2026 jeiel85) | JS, three.js r160 | C: takeoff rules, pop charge, spin/flip rate control, landing error thresholds, auto-snap assist, scoring and combo, grab typing. A: grip with forward-speed return. Controls: easy vs pro mode. | **Port ideas or snippets with attribution** |
| Bord: Skate Challenge | https://codeberg.org/alimiracle/bord | **MIT** per README (code); assets mixed CC0/CC BY per `assets/CREDITS.md`. LICENSE file could not be fetched (robots block) | Godot 4, GDScript | C: rail/ledge grinds with balance, landing grades from board vs travel vs surface, flip completion threshold, reverts, manuals in combos, touch controls with custom layout. | **Port ideas** (verify LICENSE before copying code) |
| VertiBoard | https://github.com/Jack-IDE/VertiBoard | **MIT** (LICENSE fetched, © 2026 JackIDE) | three.js, single `index.html` | Controls: touch lanes, flick-pair trick gestures, control opacity. C: big air, combos. | **Port ideas** (code is one large file, hard to read) |
| SnowGlider | https://github.com/den-run-ai/snowglider | MIT (see survey) | three.js | A: carve commitment and skid-vs-carve test gate. C: clean/OK/sketchy grading, lip-curvature launch. | Port ideas (see survey) |
| snowboard-physics | https://github.com/vadym-vorotilin/snowboard-physics | MIT (see survey) | Unity C# | A: edge vs snow friction, carving angular velocity. README has nothing on powder or jumps. | Port (see survey) |
| ski-coach | https://github.com/clarajzt/ski-coach | MIT (see survey) | JS | A: carve radius and balance; already ported to `sim/carve.ts`. | In use |
| RailGrind | https://github.com/SGTADMAN/RailGrind | **None found** | Unity C#, Splines | C: spline rail grinding demo. | Reference only |
| Ski.js | https://github.com/OancaAndrei/Ski.js | **Unknown** (LICENSE not found) | three.js | Heightmap with jump layer in a separate colour channel; webcam pose steering. | Reference only |
| Mathematics of grinding (article) | https://alexdiru.substack.com/p/mathematics-of-grinding-part-1 | Article | Godot | C: rail as segment path, attach, direction choice. | Technique reference |
| Descenders mobile touch controls (article) | https://www.gamedeveloper.com/game-platforms/deep-dive-creating-the-touch-controls-for-descenders-on-mobile | Article | Unity | Controls: two-stick layout, flick tricks, rejected schemes. | Design reference |
| Grand Mountain Adventure (interview) | https://80.lv/articles/developing-a-ski-open-world-game-for-mobile | Article (commercial game) | Custom C++/OpenGL | A/B: realism vs fun, track texture; controls: landscape at 15°. | Design reference |
| SSX 3 scoring (article) | https://www.gamespot.com/articles/ssx3-big-air-big-scores-big-combos/1100-6074830/ | Article | n/a | C: combo lines, rail scoring, repetition penalty. | Design reference |
| Shredders | https://en.wikipedia.org/wiki/Shredders_(video_game) | Commercial | n/a | B/C: soft snow raises wipeouts, rewind after bad landings. | Design reference |
| Alto's Adventure | https://altosadventure.fandom.com/wiki/Alto%27s_Adventure | Commercial | n/a | Controls: one-button tricks and combos. | Design reference |
| Komissarov 2018, carving turns | https://ar5iv.labs.arxiv.org/html/1812.02539 | arXiv preprint | Paper | A: slope-form balance, V_sc, carve windows, load-scaled friction. | Implement equations |
| Komissarov 2021, side-slipping | https://link.springer.com/article/10.1007/s12283-021-00340-7 | Journal | Paper | A: µ_lat ≈ tan Ψ + 0.2, braking vs turning split, spray width. | Implement equations |
| McNeil, Hubbard et al., constant-EFH jump | https://ar5iv.labs.arxiv.org/html/1611.04448 | arXiv preprint | Paper | C: EFH definition, landing ODE, test jump numbers. | Implement equations |
| McNeil, Hubbard et al., jump design | https://link.springer.com/article/10.1007/s12283-015-0182-6 | Journal | Paper | C: EFH formula, 1.5 m limit, terminal speed, transition radius and jerk, 1.5 g. | Implement equations |
| Wu et al., lift mechanics | https://meetings-archive.aps.org/dfd/2005/am/11 | Abstract | Paper | B: trapped-air vs crystal lift, fresh vs wind-packed. | Qualitative basis |
| Lind and Sanders, ski flexure in uncompacted snow | https://rd.springer.com/chapter/10.1007/978-1-4757-4345-6_22 | Book chapter (paywalled) | Book | B: plunger law p = k yⁿ, plowing force, reverse camber. | Basis for powder model |
| Teather and MacKenzie 2014 | https://www.yorku.ca/mack/ie2014.html | Paper | Study | Controls: position control beats velocity control; offer tilt and touch. | Design basis |
| Suhaib 2018, Tilt or Touch | https://www.slideshare.net/msuhaibkhan/tilt-or-touch-an-evaluation-of-steering-control-of-racing-game-on-tablet-or-smartphone | Paper | Study | Controls: no significant tilt vs touch difference. | Weak evidence |
| OSM `piste:type=snow_park` | https://wiki.openstreetmap.org/wiki/Key:piste:type | ODbL data | Data | Surface detection: terrain parks are tagged; Apex `features.json` already has 5 `terrainParks` (including "Claim Jumper", "Boarder Cross" and "Park"). | Use |

Searched but nothing useful or open found: Steep and SSX GDC material (no technical write-ups surfaced), Snowboard Kids and Amped (no technical sources), Lonely Mountains: Downhill (interviews only, no physics detail), Godot freestyle snowboard repos (only small or unlicensed projects).

---

## 6. Recommended model for SkiScrapex

The current stepper stays. This adds a surface-parameter layer, an edge-first carve path, a powder sink state, and a freestyle state machine (ground, air, rail). All new physics stays in `src/sim` with no Three.js import.

### 6.1 State variables (additions to `SkiState`)

| Variable | Unit | Meaning |
|---|---|---|
| `surface` | params struct | Smoothed surface parameters (6.6) |
| `edgeTarget`, `edgeAngle` | rad | Input target and slewed actual edge (edgeAngle exists) |
| `angulation` | rad | edgeAngle minus required inclination Φ |
| `gripRatio` | – | a_req / a_grip, drives skid, chatter and washout |
| `washoutT` | s | Remaining washout time |
| `chatter` | 0..1 | Chatter intensity (audio, shake, haptics) |
| `flatT` | s | Time spent near-flat in a transition |
| `rebound` | s | Remaining rebound unweight |
| `sink` | m | Powder penetration y |
| `unweightT` | s | Remaining powder bounce window |
| `phase` | `ground \| air \| rail \| crashed` | Freestyle state |
| `popCharge` | 0..1 | Crouch charge |
| `windup` | -1..1 | Pre-wind stored on the ground |
| `spin`, `flip` | rad | Accumulated rotations since takeoff |
| `spinRate`, `flipRate` | rad/s | Air rotation rates |
| `grab` | id + seconds | Current grab and hold time |
| `airTime` | s | Since takeoff |
| `predictedLand` | {t, point, normal} | From the ballistic predictor |
| `rail` | {id, s, balance, balanceRate, slideStyle} | While grinding |
| `combo` | {tricks[], multiplier, groundT, score} | Scoring |
| `lastLanding` | {grade, efh, spinErr, flipErr} | For HUD and tests |

### 6.2 Carving per-step (ground, any surface)

1. `edgeTarget = steer · maxEdge(surface)`; `edgeAngle` moves toward it at `edgeRate`.
2. `R = R_sc · cos Ψ` (cap at a large value near flat).
3. Required inclination from the slope form: `tan Φ = v² / (g R cos α) − tan α cos β`. `angulation = Ψ − Φ`.
4. Load: `n = sqrt((g cos α)² + (v²/R)²) / g` (in g).
5. Lateral grip: `µ_lat = min(tan Ψ + 0.2, µ_lat,max)`, blended with `flatGrip` near zero edge. `a_grip = µ_lat · n · g · chatterFactor · washoutFactor`.
6. `a_req = v² / R`. `gripRatio = a_req / a_grip`.
7. Ski yaw while carving: `ω = v / R` toward the edge side, plus a pivot term (existing steer-yaw slew) weighted by `(1 − carveCommit)` so skidded turns still work at low speed.
8. Grip rotates velocity toward the skis by up to `a_grip / v · dt` (existing rule). The remainder is skid.
9. Washout: if `|angulation| > ANG_MAX` or `n > LOAD_MAX` or `gripRatio > 1.4`, start `washoutT = 0.2 s` with `washoutFactor = 0.5`.
10. Chatter: if `0.95 < gripRatio < 1.25` and v > 8 m/s, `chatter = susceptibility · smoothstep(...)`, `chatterFactor = 1 − 0.15·chatter·(0.5 + 0.5 sin(2π f t + noise))`.
11. Transition: `|Ψ| < 6°` accumulates `flatT`. On crossing, if previous load > 1.5 g and `flatT < 0.25 s`, set `rebound = 0.1 s` (normal load × 0.7).
12. Friction: `F = µ_base · m · n · g` along −v, plus snow drag from powder (6.3), plus air drag `½ ρ CdA v²` (existing).

### 6.3 Powder per-step (only when `surface.depth > 0.05`)

1. `y_s = m g cos α / (k A)`; `y_eq = min(depth, y_s / (1 + (v / v_plane)²))`; if `unweightT > 0`, `y_eq *= 0.3`.
2. `sink += (y_eq − sink) · dt / τ_sink`.
3. `F_snow = w_total · k · sink² / 2 · (1 + 2·skid) + c_plow · ρ_snow · w_total · sink · v²`, applied along −v.
4. Yaw rate scale `1 / (1 + sink / y_turn)`; `R = max(R, R_min,powder)`; `µ_lat,max = surface value` (snow wall).
5. Stuck rule and bounce as in 2.3. Render the skier `sink` metres lower so boots disappear.
6. Spray emission `∝ sink · v · (0.3 + skid)`; face shot when `sink > 0.45` and load rising past 1.3 g.

### 6.4 Freestyle state machine

**Ground → air:** existing curvature rule, or more than 0.35 m above terrain. On takeoff: apply pop `v_pop = lerp(1.2, 3.0, popCharge) · (1 + 0.25 · lipTiming)` along the normal; `spinRate = windup · ω_spin,max`; reset spin, flip, airTime.

**Air:** ballistic plus drag. `spinRate → input · ω_spin,max` at `α_spin` (30% authority if there was no pre-wind), same for flips. Grab adds hold time. Predict landing every 1/60 s. With assists on, in the last 0.45 s snap targets to the nearest multiple of π (spin) and 2π (flip).

**Air → ground (landing):** with surface normal n and velocity v:
- `efh = (v · n)² / (2g)`
- `spinErr` = angle between ski forward and the tangential velocity, folded to [0, π/2] (twin tips allow switch)
- `flipErr` = angle between ski up and n
- Grade:
  - **Perfect:** spinErr < 8°, flipErr < 10°, efh < 0.8 m, no grab held
  - **Clean:** spinErr < 15°, flipErr < 20°, efh < 1.5 m
  - **Sketchy:** spinErr < 45°, flipErr < 50°, efh < 3.0 m. Scrub `15% + 20%·(efh/3)` of speed, wobble animation, 0.5× trick points
  - **Crash:** anything worse, or grab still held with flipErr > 30°
- Keep the tangential velocity on perfect and clean (perfect gives +3% speed); remove the normal part.

**Ground → rail:** rails and boxes are authored polylines {points, topHeight, width, kind}. Snap when all hold:
- horizontal distance to the centreline < 0.35 m
- ski base within −0.10 to +0.30 m of the rail top
- vertical velocity relative to the rail ≤ +0.5 m/s
- velocity within 30° of the rail tangent
- ski heading within 30° of the tangent (50-50 style) or within 90° ± 35° (slide style)

**Rail:** `s' = v_s`; `v_s' = g · t_y − µ_rail · g · sign(v_s) − drag`; balance is an unstable pendulum: `b'' = λ² b − c b' + K·input + noise`, fail when |b| > 1 (fall to the side, small sideways velocity). At the end of the rail, leave with tangent velocity (pop allowed). Score per metre and per style.

**Scoring:** trick base = `120·airTime + 280·(|spin|/π) + 900·flips + 320·min(grab, 2)` (POWDER LINE structure, to retune) plus rail `60 per metre + 150 entry + 150 exit pop`; × landing factor (perfect 1.25, clean 1.0, sketchy 0.5, crash 0); repeated identical trick in a combo × 0.5 per repeat (SSX-style). Combo multiplier +1 per trick within a 3 s ground window, max ×5; crash clears the combo; rail points are banked when the rail ends (SSX 3 keeps them through a crash, which is kinder).

### 6.5 Tunable parameters and starting values

| Parameter | Start | Unit | Notes |
|---|---|---|---|
| `sidecutRadius` | 14 | m | Existing. Park skis 18, powder skis 22. |
| `maxEdge` (groomed / ice / powder / park) | 60 / 45 / 40 / 50 | deg | Existing `maxEdgeDeg` is 50. |
| `edgeRate` | 140 | deg/s | Slew to target. |
| `ANG_MAX`, `LOAD_MAX` | 20, 3 | deg, g | Existing; matches the 3 g practical limit. |
| `µ_lat` form | tan Ψ + 0.2 | – | Komissarov 2021. |
| `µ_lat,max` (groomed / ice / powder / park) | 1.2 / 0.6 / 0.8 / 1.1 | – | Existing `edgeFriction` 1.15. |
| `µ_base` (groomed / ice / powder / park / underTree) | 0.035 / 0.025 / 0.04 / 0.03 / 0.05 | – | Survey ranges 0.02 to 0.07. |
| washout trigger, duration, factor | ratio 1.4, 0.2, 0.5 | –, s, – | |
| chatter band, freq, depth | 0.95 to 1.25, 12, 0.15 | –, Hz, – | Susceptibility ice 1.0, groomed 0.4, park 0.3, powder 0. |
| flat threshold, rebound | 6, 0.1 s at 0.7 load | deg | |
| powder `depth` (fresh / underTree) | 0.35 / 0.2 | m | × a global conditions knob. |
| `k` (n = 1) | 6800 | Pa/m | Gives 0.30 m standing sink. |
| ski base area A, `w_total` | 0.385, 0.22 | m², m | Two 1.75 × 0.11 m skis. |
| `v_plane` (fresh / wind-packed) | 7 / 5 | m/s | |
| `τ_sink` | 0.25 | s | |
| `c_plow`, `ρ_snow` | 0.1, 100 | –, kg/m³ | |
| `y_turn`, `R_min,powder` | 0.15, 8 | m | |
| pop range, full charge time | 1.2 to 3.0, 0.4 | m/s, s | 3.0 m/s ≈ 0.46 m ollie. |
| lip timing window, bonus | 0.12, +25% | s | |
| `ω_spin,max`, `α_spin` | 7.9 (450°/s), 14 | rad/s, rad/s² | |
| `ω_flip,max`, `α_flip` | 5.7 (325°/s), 10 | rad/s, rad/s² | |
| no-prewind air authority | 0.3 | – | |
| snap assist window | 0.45 | s | POWDER LINE. |
| EFH thresholds | 0.8 / 1.5 / 3.0 | m | Perfect / clean / sketchy limits. |
| rail capture radius, vertical window | 0.35, −0.10 to +0.30 | m | |
| `µ_rail` (metal / box) | 0.06 / 0.04 | – | Design values, not measured. |
| balance λ, damping c, input gain K | 2.5, 1.0, 8 | 1/s, 1/s, 1/s² | |
| combo window, max multiplier | 3, 5 | s, × | |

Acceptance tests to add (deterministic, fixed dt): carve beats skid on the same line by more than 12% (SnowGlider gate); V_sc ≈ 11.5 m/s for R_sc 14 m on 15° (status flips to `over` above it); straight-run terminal speed on 15° ≈ 22.6 m/s upright and ≈ 33.5 m/s tucked (from `v_T = sqrt(g(sin θ − µ cos θ)/η)` with the current CdA and µ); powder sink 0.30 m at rest and about 0.10 m at 10 m/s; a 10° kicker at the design speed lands with EFH under 1.5 m; a 90° under-rotated landing is a crash.

### 6.6 Detecting surface type from the mask

`src/world/surface.ts` already rasterises runs into a 2.5 m mask with `SurfaceId = { groomed 0, powder 1, ice 2, rock 3, underTree 4 }`. Off-run texels default to powder, and ungroomed runs (mogul, backcountry, freeride) are powder.

1. **Add `park: 5`.** The red channel stores `id / 4`, which cannot hold 5. Switch to storing `id · 32` (room for 8 ids) in both `world/surface.ts` and `fx/snow/mask.ts`.
2. **Rasterise parks.** `public/data/features.json` already lists 5 `terrainParks` ways tagged `piste:type=snow_park` (including "Claim Jumper", "Boarder Cross" and "Park"). Rasterise them after runs so they override groomed. Park features (kickers, rails, boxes) go in a separate authored JSON keyed to these ways, used both as height overlays in `sampleTerrain` and as rail polylines.
3. **Derived ids.** `underTree` where canopy cover > 0.4 (the canopy grids already exist); `rock` where slope > 45° off-run; `ice` on groomed runs steeper than about 30° or under a global "icy" condition.
4. **Inject into the sim** as `sampleSurface(x, z) → SurfaceParams`, alongside `sampleTerrain`, so `sim` keeps no world or Three.js dependency.
5. **Blend, do not switch.** Bilinearly weight the parameter vectors (not the ids) of the four nearest texels, then smooth over time with τ ≈ 0.15 s. At 30 m/s the skier crosses about 12 texels a second, so hard switching would pop.
6. **Later:** reduce powder `depth` where the snowflow-style track buffer shows the snow has been skied, so powder gets tracked out.

## Jibbin reference

Status: static analysis only. Nothing below has been checked against the running game. Read each row as a lead to verify in a playtest, not as measured behaviour, and do not copy Jibbin's timings or values into `FREESTYLE` until they have been measured.

Static analysis of the recovered `Jibbin.exe`, its accompanying `Controls.dat`, and 36 models under `Level Data`. Code addresses below are offsets in the extracted Blitz3D module. The executable stores that module in PE resource 1111 (RCDATA). Its symbol and relocation tables identify the relevant functions and calls. [Blitz3D runtime loader](https://github.com/blitz-research/blitz3d/blob/master/bbruntime_dll/bbruntime_dll.cpp#L195)

| Mechanic | What the recovered files show | How it could fit SkiScrapex |
| --- | --- | --- |
| Grabs | Ten named actions with up to two simultaneous key bindings. The animation routine starts a pose in the air and has shorter animation segments it can reverse on early release. The main skier file has 500 frames at a nominal 30 fps. | Add Blunt, Liu-Kang and Uncrossed Mute using the existing rider IK. Let players release a partial pose smoothly and keep the current grab controls and scoring as the baseline. |
| Rail presses | The straight-rail routine requires a grind input on entry. The tail and nose inputs also assert that grind input and set separate backward and forward stance flags. | Keep the existing rail path, alignment checks and balance simulation. Test an explicit nose or tail press as a choice within a slide. Give the stance a distinct pose and trick name. |
| Butters | The main loop enables a butter while the configured key is held, the skier has contact and no rail is being contacted. The butter routine changes rider pitch and yaw. The two separate butter files each have 40 frames at 30 fps. | Prototype a grounded press that can pivot into a switch takeoff. Gate it to snow contact, and use the current pop and landing systems. |
| Air rotation | `InAirTricks` applies separate directional pitch and yaw increments, starting at up to 10° per simulation step after the directional divisors reset on contact. Each divisor increases during the air phase, faster while its direction is released, and caps at 8. The main loop is configured for 30 updates per second. | Test front-loaded rotation as an optional tuning change. Holding direction early should carry more authority than a last-moment correction. Compare it with the existing pre-wind and landing assist on one ramp. |
| Jump | The jump routine charges a value while the jump key is held and applies lift on release. A level naming marker for normal jumps changes the charge cap and release behavior. The raw lift values describe movement in Blitz3D units per update. | Keep the current metre-based pop model and test per-feature tuning only after comparing repeatable jumps. |
| Feature types | The loader recognizes named jump, straight-rail, halfpipe and quarterpipe nodes. The executable has separate routines for pipes, hips and several rail orientations. Halfpipe nodes appeared in 19 instances and quarterpipe nodes in 10 across the 36-model sample. These are node counts. | Use feature metadata alongside geometry. For an Apex test park, start with two independent practice lanes and add an original hip or quarterpipe once takeoff and re-entry are testable. |
| Practice | The manual documents nine saved positions per level. | Not in SkiScrapeX yet. Candidate for the park mode: Shift + 1 through 9 to save a spot and 1 through 9 to return to it at rest. |

### Recovered keyboard profile

This is the profile shipped in this copy of `Controls.dat`. The loader reads 30 little-endian integers. The file maps arrows to direction, Space to jump, W to regular grind, Q to tailpress grind, E to nosepress grind, Left Shift to butter and P to camera. The included manual lists a different nose-grind binding. The table follows the file and the executable's read order. [Blitz3D scan codes](https://github.com/aminrouslan/blitz3d-docs/blob/main/scancodes.md)

| Grab | Saved binding | Source animation frame range |
| --- | --- | --- |
| Phil | Z + X | 0–20 |
| Safety | A | 32–52 |
| Mute | D | 288–307 |
| Uncrossed mute | F | 308–327 |
| Tail | S | 328–347 |
| Blunt | C + V | 348–367 |
| Liu-Kang | V | 368–387 |
| Nose | C | 388–407 |
| Critical | Z | 408–427 |
| Japan | X | 428–447 |

Frame ranges are the full sequences passed to the engine. Early-release segments for the first grab end at frames 5, 10 and 15 and play backward after release. The nominal 30 fps and frame ranges establish authored timing. Runtime time spent in a pose depends on the animation path and player input. [Blitz3D model format](https://docs.luanti.org/for-creators/models/b3d-spec/)

Verification points in the module include control loading at `0x00a4e5`, clip registration around `0x01f424`, the park node scan at `0x021091`, butter entry at `0x02aa4f`, jump at `0x044e20`, air rotation at `0x045c10`, grabs at `0x0460c0` and straight-rail handling at `0x055520`.

The original game has yet to be run for a side-by-side comparison. Airborne and rail behavior in the table comes from the executable and assets. Real-world speed, airtime and landing tolerances still need measurement or further analysis.

### Whole-build audit

The audit covers the playable `Jibbin.exe` from `jibbin.rar` (SHA-256 `74fae78118d02e935dcd7fabc41745fe6f1edc1a22199484cc97a8918008cc27`). The 488,304-byte game module contains 5,351 symbols, 13,425 relative relocations and 11,784 absolute relocations. I inventoried 168 named entry points, including three menu, setup and game-loop labels and 94 Blitz3D scene-extension functions. The inventory uses symbol ranges, their call targets, and references from the main loop. The implementation details below come from inspecting the relevant instructions and checking them against the recovered files.

| System | Confirmed in this build | What matters for SkiScrapex |
| --- | --- | --- |
| Ground movement and surfaces | Separate slope, brake and movement-update routines. Slope probes read collision geometry and the picked surface normal. The loader recognizes groomed and powder setup, and braking can generate snow spray. Runtime call sites include `Slope` (`0x051810`), `Brake` (`0x04b540`) and the main loop (`0x029795`). | Keep the existing terrain sampler and measured surface model. Test how much speed can be scrubbed in the park without making the approach hard to repeat. |
| Air and landing | Charged pop, feature-sensitive jump behavior, directional air rotation, animation timing, left/right landing correction, and tumble states. The running game also counts rotations for the trick display. See `Jump`, `InAirTricks`, `UpdateGame` (`0x043bc0`), `Land` (`0x05d930`) and `CountRotations` (`0x069e70`). | Compare spin timing and recovery on repeatable jumps. Keep the current grading thresholds until there are measurements. |
| Jibs and park geometry | Ground butters, three grind inputs, multiple rail handlers, rail approach orientation markers, and a wood material branch. Dedicated paths handle ramps, hips, halfpipes, quarterpipes, and wall interaction. The level scanner and game loop also call warp handlers. See `SRail` (`0x04c100`), `HipFunc` (`0x058270`), `HalfPipeFunc` (`0x059700`), `QuarterPipeFunc` (`0x05c4f0`), `WarpWorld` (`0x067af0`) and `Wall` (`0x072190`). | Prioritize rail presses and butters. Then try a wall feature or hip with its own entry and exit rules. Use original park layouts. |
| Scoring and feedback | `Score` (`0x073690`) adds points during grinding, applies a tumble deduction, and awards different points by grab sequence and animation progress. Directional rotation state affects the award. The HUD includes an optional trick display, and numeric rotation labels from 180 to 1440 are authored. | Show which stance or grab earned points and preserve the existing landing grade and combo banking. Jibbin's per-step awards are useful evidence about feedback and timing. |
| Practice and replays | Position save/recall is distinct from replay. Replay save/load handles initial session data and a stream of input records, and playback feeds the game loop. The recording list and preview image have separate paths. See `SaveSessionPoints` (`0x05e1d0`), `PlayReplay` (`0x06dba0`), `SaveRecordFile` (`0x070be0`) and `ReadLoadedRecording` (`0x071bd0`). | Later add a short local replay of a practiced line. An input log plus an initial state fits the fixed-step sim, provided terrain and settings are included in replay identity. |
| Rider and modding | Character save/load, outfit textures, ski topsheets, replacement grab-model packs, a lodge, level selection, and a custom-level scanner. `FindLevels` (`0x042ab0`) enumerates the directory. `ChangeCharacter` (`0x040810`) applies mesh visibility, colors and textures. | Keep the original SkiScrapex rider. A typed feature schema can support user-made park layouts without depending on legacy mesh names. |
| Controls, settings and presentation | Rebindable keys, joystick input, camera controls, graphics modes, sound levels, camera range, optional HUD elements, visible reaction-time settings, snow particles, ski tracks and screenshots. The executable distinguishes rail entry, loop and exit audio. The exact effect of each reaction-time setting still needs verification. | Material and contact-specific audio can make rail entry, balance and pop-off easier to read. Review camera and input response during gameplay. |

Across all 170 loose `.b3d` files in the extracted RAR, 119 distinct byte contents remained after deduplication. The scan found 67 distinct valid scenes containing a `Start` node. Of those, 65 contain `jump`, 60 contain `straight rail`, 18 contain `halfpipe`, 14 contain `quarterpipe`, 10 contain `hip`, 11 contain `wall`, and 19 contain `warp out`. These counts describe scene markers. They can include collision helpers and should not be used as counts of skiable features. One legacy grab file is zero bytes in both loose and nested form. The five nested RAR listings contained asset packs. The separate ZIP likewise contains gear and grab packs.

No network call targets appeared in the game module's relocation tables. That check covers the loader-linked application calls found in this build. A running Windows reference is still needed for the feel of each state transition, consistent unit calibration, input timing under different settings, and replay behavior across sessions. The separate Inno Setup copy has not been unpacked and compared with the RAR build.

### First candidate: nose and tail rail presses

Presses are the smallest Jibbin idea that adds a real choice on every rail without new geometry. They can sit on top of the rail model we already have.

Implemented as proposed below (`stepPress`, `mainPress` and `railTrickName` in `sim/freestyle.ts`, the press blend in `render/rider/skierView.ts`, Nose press and Tail press poses in `rider.html`, tests in `tests/presses.test.ts`). The numbers are still provisional.

**What we have now** (`sim/freestyle.ts`, `sim/skier.ts`):

- Capture is automatic (`tryCaptureRail`): reach, height window, rise limit and 35° travel alignment. The style is fixed at entry from the ski heading: `5050` when the skis point along the rail, `slide` when they are across it.
- `stepRail` keeps momentum along the tangent with Coulomb friction (0.06 rail, 0.04 box) and air drag. Balance is one lateral unstable pendulum, `b'' = λ²·w·b − c·b' + K·steer + noise`, with λ 1.9, c 1.0, K 8 and w 0.55 on boxes. The skier falls past |b| > 1 and leaves at the end, below 0.3 m/s or on a pop.
- On the rail only `steer` and `jump` are read. `pitch` and `grab` are ignored. The first-rail tip in `main.ts` ("Hold grab for a slide style bonus") therefore promises something the sim does not do. The tip now explains presses and slides.
- Points are 150 + 60 per metre + 100 for a slide, named "50-50 Rail", "Slide Box" and so on. `app/tricks.ts` halves repeats by name, so a new name is a new trick for combos.

**Proposal:**

1. **Input.** Use the existing pitch axis (W or Up, S or Down, touch stick vertical, left stick Y): forward for nose, back for tail. Jibbin uses separate keys that also assert a grind button, but we have no grind button and auto-capture works. Pitch is relative to the rider, so it stays correct when riding switch (`headingOffset` π).
2. **State.** Add `press: 'none' | 'nose' | 'tail'` and `pressTime` to `RailState`. A press starts after the pitch has been held past 0.5 for 0.15 s and ends when it is released. Pitch that was already held at capture is ignored until it is released once, because Down is also the brake and skiers often brake into a box.
3. **Balance.** Keep the single lateral pendulum. A press narrows the support, so scale the unstable term by a new `FREESTYLE.pressInstability` (start at 1.3 on rails, 1.15 on boxes) and leave friction alone. Do not add a fore-and-aft pendulum in the first cut. Pitch is already the input that holds the press, and a second balance axis on a touch stick is a lot to ask before anyone has played it. Revisit after a playtest.
4. **Exit.** Popping out of a press with pitch still held would start a flip in `stepAir`. Suppress pitch for flips until it is released after the pop.
5. **Scoring and names.** Name from the press held longest: "Nose Press 50-50 Rail", "Tail Press Slide Box". Add about 40 points per pressed metre, counting only presses held at least 0.3 s, and keep the 0.3 fell factor. All of these numbers are provisional.
6. **Rider.** Add a `pressBlend` beside `railBlend` in `render/rider/skierView.ts`: skis pitched like the nose and tail grab poses (about 0.4 rad), hips shifted over the pressed end and the other knee bent through the existing IK. `rider.html` has Nose press and Tail press poses for review.

**Tests before tuning** (fixed dt, in `tests/presses.test.ts`, plus a box run-in braking into the press):

- Pitch held from before capture does not press until it is released and held again.
- A scripted counter-steer holds a nose press across a 6 m rail, and the trick is named "Nose Press".
- With idle steer and the same noise, a press falls sooner than a 50-50 on the same rail, and a box press lasts longer than a rail press.
- Popping out of a press with pitch held lands with no flip.
- Riding switch, forward pitch still gives a nose press.

**Open until playtested:** the instability factor and point values, and whether presses should also scrub speed. Also whether a fore-and-aft balance makes presses more fun or only harder. Jibbin's frame ranges and per-step awards are evidence about feel, not values to copy.
