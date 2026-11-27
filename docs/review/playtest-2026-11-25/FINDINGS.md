# SkiScrapeX playtest findings: live v0.9.27 → v0.9.28 (2026-11-25)

The live site went from v0.9.27 to v0.9.28 mid-session. There is no sim or event code difference between the two. Code references are to origin/main c99f73d. All evidence paths are relative to this folder. For how much the 2–5 fps headless rig affects these results, see the caveat in PLAYTEST-LOG.md.

## Event pass/fail
| Event | Starts | Course/gates | Timing/splits | Finish | Results UI | Retry | Verdict |
|---|---|---|---|---|---|---|---|
| Shoot the Chute | yes (hook and menu) | no gates; trap works (123 km/h) | ok | ok: 1:14.0 (sim 1:05.9) | ok, Pehota benchmark | ok | **PASS**, with issues 1, 2, 5 |
| Apex Downhill | yes | 10/10 gates, 2 splits, trap | ok | 2:46.4 | ok | ok | **PASS**, with issues 3 and 4 |
| Apex Slalom (2 runs) | yes | run 1: 35/35 gates, Tight/Skidded grading | ok | run 1 1:18.2 → run 2 card and countdown ok | ok | ok | **PASS for run 1 and the transition**. My browser pilot never completed run 2 because of the 5 fps rig. The offline sim finishes both (48.3 s, 35/35). |
| Teck Open GS | yes | gates 1–4 ok, with Tight grading | n/a | not reached in the browser (2 tries, both stuck in powder after gate 4); offline sim 55.5 s, 23/23 | n/a | n/a | **FAIL in the browser** (issue 7, reproduced twice). The course itself is valid offline. |
| Match Your Time | yes | n/a | ok | 1:33.3 / 1:32.1, Δ1.1 s → bronze | ok | ok | **PASS** |
| Kristi's Moguls | yes | beat strip and timing grading work | ok | "Out of the line: 3 misses", correct per the rules | ok | ok | **PASS as a mechanic** (issue 8) |
| Aerials | yes | 3 jumps judged | ok | 18 pts | ok | ok | **PASS** (issue 9) |
| UI: restart R / pause Esc / false start / DNF | | | | | | | R ✅, pause ✅, off-course DNF ✅, false-start message ❌ (issue 6), crash-DNF not reachable (issue 2) |

There were no page errors, crashes or hangs during the session, so no reloads were needed. The only console output was two benign warnings: AudioContext autoplay and KHR_parallel_shader_compile.

## Top 10 issues (by severity)

1. **HIGH: Shoot the Chute and the Downhill finish at 100+ km/h, then the result panel freezes the skier mid-flight. There is no run-out or stop.**
   - Repro: run Shoot the Chute in a tuck. The skier crosses the line in front of the upper lot at about 101 km/h (`csv/chute1.csv`, last rows).
   - Stu's real event ends with racers *stopping in front of the upper parking lot*.
   - Fix ideas:
     - Make the finish a speed-trap line, then run a "stop in the box" phase. Either the stop is scored, or `session` keeps the sim running with auto-brake (`app/session.ts` finish handling).
     - Keep the overlay off until the skier is below about 10 km/h.

2. **HIGH: You cannot crash from over-steering. Any full-lock input at any speed turns into a clean skid that bleeds off all speed.**
   - Repro: Chute at 96 km/h, hold A. The skis go to 85° off the travel direction and speed drops 96 → 0 in 3.1 s with no fall (`csv/chute_bail.csv`, `shots/chute_bail_*`).
   - The lab shows the same thing: at 110 km/h with full edge, the reported carveLoad peaks at **9.2 g**, washout is 100% of the time, and there is no crash (`csv/lab_B_turn_110kmh.csv`).
   - Real skiing: a 50° edge snapped on at 110 km/h either holds a big arc at about 2.5–3 g or blows the skier out. It never drops 40 km/h of speed in 1.5 s with no consequence.
   - Code:
     - `sim/skier.ts:447` (`maxDelta` is limited by spare grip, then everything else becomes skid).
     - `sim/skier.ts:915` (`LOAD_MAX` caps the rate but never triggers a crash).
   - Fix: when the carveLoad or skid angle stays above a threshold (for example load > 3.5 g for 0.25 s, or slip > 45° above 60 km/h), go to `crash` or a scrub-and-wobble state. The DNF-on-crash path in `main.ts` is never exercised by steering.

3. **HIGH: The Gunbarrel moguls sit on the FIS downhill line.**
   - Effect: 20 takeoffs and 5 scored "airs" during a downhill run. Top speed was 85 km/h in game against **139 km/h** on the same line on bare terrain (`csv/dh1.csv` vs `csv/lab_G_course_apex-downhill_60fps.csv`).
   - The Mars-era downhill, and any race, runs on a prepared track.
   - Code: `world/corrections.ts:113` (Gunbarrel `moguls: true`) together with `world/moguls.ts`.
   - Fix: carve a groomed corridor along the `apex-downhill` course line (`world/events.ts:113`) when that event is active, or always.
   - Also: trick scoring should be suppressed during race formats.

4. **MED: The Downhill and the Chute spend 30–50% of their time on the summit cat track.**
   - The Downhill reaches split 1 at 70.8–92 s. The Chute's first 222 m take 35 s at 12–50 km/h, including a 5° flat where speed falls to 12 km/h.
   - The start gate faces across the track (heading 129°, 7.5° pitch), so **a skier who doesn't push never moves**. In my first Chute run the clock ran 3:33 at 0 km/h with no timeout.
   - Fix:
     - Move the Chute start to the top of the Chute pitch.
     - Add a skate/pole "push" key, or auto-push for the first 2 s.
     - Add a no-movement timeout DNF.

5. **MED: Terminal speed is too low for a straight-line tuck, so the event's own benchmark can't be reached.**
   - Tuck terminal speed: 25° → 134 km/h, 30° → 147 km/h (`csv/lab_A_straight_speed_vs_pitch.csv`). A real race tuck (CdA about 0.20) gives about 195 km/h at 25°; a recreational tuck (about 0.30) gives about 159 km/h.
   - On the Chute, top speed is 125–127 km/h against a 151 km/h "Pehota" benchmark shown on the results card.
   - Code: `sim/constants.ts:19` `dragAreaTuck: 0.42`.
   - Fix: about 0.28–0.30 for a tuck. Keep the upright value, which gives a sensible tuck/upright ratio.

6. **MED: The "False start" message never shows.**
   - Repro: hold W during "3". The count resets correctly, but the HUD shows the digit on the very next frame.
   - Code: `app/raceDirector.ts:71` is overwritten by `:78`.
   - Fix: hold the warn text for about 1.2 s (a timer) before the countdown digits resume.
   - Also: a quick tap can fall between frames and be missed, because input is level-sampled (`player/input.ts`). Latch keydown edges.

7. **MED: You can get permanently stuck in powder beside a race course, with no DNF and no timeout.**
   - Repro: Teck GS. Leave the line near Old Mill (pitch about 10°, sink 0.32 m) and stop across the hill. Skating can't escape, and the clock runs forever because you are still inside the 30 m corridor (`csv/gs1.csv`, `shots/gs1_03_end.jpg`).
   - Reproduced twice (gs1 and gs2, both after gate 4 at about (2027, 1006); clock reached 4:30 with no DNF). Fix: add a no-progress timeout (for example under 3 m of progress in 20 s → DNF), give more skate force in powder, and check that the gate 4→5 line isn't routed through or right beside powder (groom the course corridor).

8. **MED: Moguls event, straight airs off the top or bottom air shorter than 0.5 s score 0 and cost a lot of speed.**
   - The top air gave 0.46 s of airtime and no trick, and speed fell 39 → 21 km/h on landing (`csv/mog1.csv`).
   - Code: the `tricky` threshold at `sim/skier.ts:709`.
   - Fix: comp air features should always register an air, and the landing should keep speed on a clean, flat-ski landing.

9. **LOW–MED: The aerials "jumps" are small park tables, and park "Banked/TOTAL" pop-ups mix into the judged aerial score.**
   - Takeoffs were about 45 km/h with vy 2.4 m/s, for 0.5–1 s of air. A single backflip is barely possible.
   - The 180 Mute scored 6.0 (sketchy).
   - Fix: use kicker geometry for aerials (about 60° lip, 3–4 s of air) and hide the park trick HUD during `aerials`.

10. **LOW: The slalom start area is classified as surface `park`.** Okanagan Park's polygon overlaps the top of the Okanagan slalom course (`csv/sl2.csv`, `csv/sl4.csv`, column `surf`=park). That means park grip and snow apply, and trick pop-ups can fire on a race start. Fix: exclude the event course corridors from park surface classification.

Also noted:
- At 2–5 fps a keyboard tap lasts a whole frame (200–400 ms). That is a rig limit, but it shows how strongly the game depends on frame time; see physics item P3.

## Physics and animation diagnosis ("feels a bit off")
Measured with the real sim at 60 fps (`tests/zz_playtest_physlab.test.ts`, results in `csv/lab_*` and `raw/physlab-summary.json`). Frames are in `frames/lab_*/clip.mp4`.

**P1. The turn radius barely depends on speed or edge the way real skis do: low speed turns on a dime, and high speed always washes out.**

Held full-edge turn (edge 50°):

| v0 | mean radius | peak lat-g | slip | washout |
|---|---|---|---|---|
| 15 km/h | 2.9 m | 1.1 | 0° | 0% |
| 30 km/h | 5.2 m | 2.1 | 4° | 0% |
| 50 km/h | 8.6 m | 2.1 | 13° | 0% |
| 70 km/h | 15 m | 2.0 | 52° | 15% |
| 90 km/h | 39 m | 1.4 | 67° | 79% |
| 110 km/h | 57 m | 1.4 | 58° | 100% |

- Real ski: a carved radius is about sidecut × cos(edge), roughly 15 m × 0.64 ≈ 10 m for a slalom ski at 50°. **It cannot carve a 3 m radius at 15 km/h**, but the game labels that "carving" with 0.02 skid. That is why the skier can **loop full 360° circles on a 19° slope at 6–18 km/h** (chute_bail).
- At speed, the turn is grip-capped and slides out. There is no regime where a big edge at 90+ km/h holds a clean, high-g, 25–35 m arc, which is what a GS/DH racer does.
- Cause: the yaw is limited by `maxYawRate: 2.2` (`constants.ts:37`) and the `classic = max(pivot, min(sidecutRate, LOAD_MAX·g/v))` blend (`skier.ts:915`), not by the sidecut geometry. At low v, `LOAD_MAX·g/v` is huge and pivot dominates. At high v, spare grip (`skier.ts:447`) runs out.
- Fix:
  - Carved yaw rate = v / (R_sc·cos θ_edge), clamped by grip, so radius grows with less edge and is speed-independent while it carves.
  - Below about 20 km/h, anything tighter than that radius must be a pivot/skid (mode `skidding`, with snow spray and speed loss).
  - Raise high-speed grip on groomed snow so 2.5–3 g arcs hold, with a crash past that (issue 2).

**P2. Keyboard = 0 or 50° of edge almost instantly. There is no progressive edging.**
- `edgeRateDeg: 260` (`constants.ts:66`) takes the edge from 0 to 50° in about 0.19 s. A 200 ms tap at 70 km/h already reaches the full 50° edge and washes out 11 samples (`csv/lab_C_taps.csv`).
- Real edging builds over about 0.4–0.8 s through the turn, with the edge peaking in the fall line.
- Fix:
  - Lower the edge rate to about 100–120°/s.
  - Ramp the edge target with hold time.
  - Scale the max edge by speed for keyboard input (for example 30° at 100 km/h unless the player holds a "commit" modifier).

**P3. Turning depends on frame rate for keyboard players.** In the C_taps lab, the same 17 ms tap gives 1.5° of heading change at 60 fps and 18.4° at 5 fps, because input is sampled per render frame and held for the whole frame. Fix: send key edge times to the fixed-step sim, or integrate keyboard steer per physics step (`player/input.ts`).

**P4. Hockey stops are about 2–3× too strong.**
- The stop lab (`csv/lab_E_stops.csv`, `lab_E_hockey_*`):

  | Speed | Stop time | Stop distance | Mean decel |
  |---|---|---|---|
  | 50 km/h | 0.8 s | 6 m | 1.42 g |
  | 80 km/h | 1.15 s | 12–15 m | 1.9 g |

- The numbers are the same on 10°, 20° and 30° slopes, meaning **the slope has no effect on stopping**.
- Real hockey stop: 0.5–0.8 g, about 15–20 m from 50 km/h, and clearly longer on steeps.
- Code: `brakeDecel: 5.2` and `hockeyYawRate: 2.4` (`constants.ts:43,52`). The skid friction also ignores the slope component of gravity.
- Fix: decel ≈ μ_skid·g·cosθ − g·sinθ·(cos of the skis-to-fall-line angle), with μ about 0.6–0.8.

**P5. Straight-line speed: a bit slow and too fast to settle (issue 5).**
- From a standstill at 25°: 67 km/h at 5 s, 105 km/h at 10 s, 130 km/h at 20 s.
- The build-up curve shape is plausible; only the drag constant is high.

**P6. Pop and air.**
- An ollie gives 0.11–0.32 m of height and 0.3–0.5 s of air (`csv/lab_F_pop*.csv`), which is realistic.
- Straight airs under 0.5 s are unscored (issue 8). In the browser, landings cost a lot of speed even when graded "clean".

**P7. Animation: the skier banks like a motorbike. The body is one inclined stick, with no angulation.**
- Frames (`frames/lab_turns_period2.4_20deg/`, `clip.mp4`): through the turn, the whole body (legs, hips, spine, head) tilts into the turn as one line.
- Code: `render/rider/skierView.ts:733-739`. These lines rotate `hips.z = -incline·0.12`, `spine.z = -incline·0.2` and `chest.z = -incline·0.14`, all **in the same direction as the incline**. So the upper body adds to the lean instead of counter-balancing.
- Real carving: the legs and hips incline, while the spine and chest tilt *back toward the outside ski* (angulation), keeping the shoulders roughly level with the slope and the weight over the outside ski.
- Fix:
  - Flip the sign on the spine and chest so the upper body counter-tilts about 35–50% of the incline above about 25° of edge.
  - Add outside-leg extension and inside-leg flex (the leg length difference, which should scale with edge).
  - Keep the head level with the horizon.

**P8. Animation: the lean is under-drawn and lags the physics. The ski edge in the view is capped below the physics edge.**
- Linked turns:

  | Turns | View incline | Physics lean |
  |---|---|---|
  | short | 31.9° | 40.1° |
  | medium | 38.0° | 48.4° |

  That is about **20% less lean than the physics**, with a **100–117 ms lag**. The cause is the incline spring at `skierView.ts:518` (`step(…, 2.6, 0.92)`): 2.6 Hz, nearly critically damped.
- The physics edge is 49.9° but the view's ski edge stays at about 44.5° (a clamp at `skierView.ts:516` of 0.85 rad together with `-slopeRoll·0.8`). The skis look flatter than the carve they are making.
- Fix: raise the spring to about 5–6 Hz (or drive it from the physics edge directly with a 30–50 ms smooth), and remove the extra clamp.

**P9. Counter-rotation is set by the travel offset, not by the turn phase.**
- `wantCounter = off·0.4` (`skierView.ts:589`) with a 1.7 Hz spring (`:592`).
- In long turns, the chest is 36° off the fall line against 57° for the skis, which is good. In short turns the chest follows the skis more (17° against 26°), when it should stay nearly in the fall line.
- When a turn is held too long, the skis go 141° off the fall line (uphill), the chest follows to 92°, and the counter spring is too slow to show "upper body facing down the hill".
- Fix: compute the chest target from the fall line (for example chest yaw = fall line + 0.3·(ski − fall line)) and use a faster spring (3–4 Hz).

**P10. No skid visuals or feel for the low-speed "carve" loops.** The mode stays `carving` while the skis pivot through 2–3 m radii, so there is no spray or scrape audio and no flattening of the skis. This is the same root cause as P1.

## Evidence index
- `shots/`: start, mid-run and end screenshots for every event run (chute1, dh1, sl1–sl4, gs1–gs2, match1, mog1, aer1, chute_bail, plus UI and title shots).
- `csv/<run>.csv`: in-game telemetry at about 0.25–0.4 s intervals. Columns: position, speed, heading, travel, edge, skid, pitch, radius, load, grip, mode, ground, tuck, sink, surface, crash, HUD.
- `csv/lab_*.csv`: the physics lab at 60 fps (straight-line, held turns, taps, linked turns, stops, pop, full courses at 60 and 5 fps).
- `frames/lab_*/`: deterministic rider-lab frame sequences and a clip.mp4 for each (turns at 12°/20°/25°, tuck, ollie attempt).
- `raw/`: per-run JSON, run stdout, browser console log, CPU profile (`cpu-profile.cpuprofile`), probe, UI-flow JSON.
- Scripts: `/workspace/skiscrapex-live/pw/p25_*.mjs` and `/workspace/sx-main/game/tests/zz_playtest_physlab.test.ts`. The lab test lives in the extracted main copy, not in the repo clone.

## Snowboarder (added 20:45 PST, live v0.9.29, origin/main 28f409e)
Full report: **[SNOWBOARDER.md](SNOWBOARDER.md)**. Evidence is in `snowboard/`.

- **How to select it:** Rider → "Skis or board" → Snowboard. It works in free-ski and in every event. There is no regular/goofy choice, no binding-angle setting and no fakie toggle.
- **HIGH: the legs.** The board reuses the skier's leg and body pipeline with the ski "hips over feet" solver turned off (`render/rider/skierView.ts:797`).
  - In real-sim **toe-side** turns the rider folds flat over the toe edge: hips 0.22 m above the board and below the knees, torso 77° off the slope normal, knees bent back toward the heel (109–130° off the boot toe), and the back hand 18 cm into the snow.
  - In **heel-side** turns the rider sits on their heels, with hips level with the knees.
  - **When cruising** it is a frog squat: 83–87° of knee flex, knees bowed out past the bindings.
  - Causes:
    - the whole-body incline pivots at the board centre (`:763`);
    - the hip height formula assumes a vertical-leg stance and is clamped at 0.40 m (`:765-768`);
    - the knee hint comes from the ski-boot cuff relative to the hip–ankle midpoint (`:261-274`);
    - the angulation terms act about the wrong axis once the hips are turned 90° (`:775-782`).
  - The feet stay attached (0 cm gap), nothing passes through the deck, and the heel/toe edge mapping is correct, including riding switch.
- **MED, physics:** the board is the ski model with an 8 m sidecut and more float.
  - Same speeds: Chute 1:12.8 and 129 km/h on the board, against 1:14.0 and 127 km/h on skis.
  - Invisible skating and pole-pushing on a board (`sim/skier.ts:269`, `:429`).
  - Stops are too strong: 52 → 0 km/h in 0.87 s over 7.4 m.
  - The board looks under-leaned for the g it pulls: about 2.1 g on a 5.1 m arc, with the view capped at 49° of lean and 41° of roll.
  - No crash at 13.9 g of load.
  - Switch only happens after landing a spin backwards.
- **Events on the snowboard:** Shoot the Chute PASS (1:12.8), Aerials PASS (14 pts), Kristi's Moguls PASS (82 pts, gold).
