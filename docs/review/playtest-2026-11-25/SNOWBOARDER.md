# SkiScrapeX snowboarder playtest: live v0.9.29, 2026-11-25

Times are America/Vancouver (PST).

- **Build:** the live site https://johnstonstu.github.io/SkiScrapeX/ shows **v0.9.29** in the HUD.
- **Code references:** origin/main **28f409e** ("Merge pull request #113 from johnstonstu/rider-clipping", 2026-11-25 19:47 PST, `game/package.json` 0.9.29). The code was extracted with `git archive` to `/workspace/sx-main29`.
- No game code was changed, and nothing was committed from the local clone.

**How it was tested.** Everything below uses the real model, rig and sim; nothing was re-implemented.
1. **Live game:** Title → Rider → Snowboard, through the real menu. Then Shoot the Chute was ridden with real W/A/D/S/Space keys, and the Chute, Aerials and Moguls events were run with the snowboard (`snowboard/live/`, `shots/sb_*`).
2. **Rider lab, held poses** (`rider.html?model=snowboard&pose=…`): 9 poses × 5 camera angles, rendered from the live build (`snowboard/lab/`).
3. **Rider lab, real sim with the follow camera** (`rider.html?sim&model=snowboard`): linked turns on 18° and 20°, and an ollie, stepped frame by frame at 60 fps. Zoomed crops and clips are in `snowboard/sim/`.
4. **Offline rig measurement** (vitest, `/workspace/sx-main29/game/tests/zz_snowboard_rig.test.ts`):
   - The real `stepSkier` drives the real `createSkierView` with the snowboard selected.
   - Every joint is measured in board space, giving hip, knee and ankle positions, the knee-bend direction, flex, and which edge is down. The output is `snowboard/rig_*.json|csv`, `snowboard/sim_turns.csv` and `sim_switch.json`.
   - Joint positions are also plotted as stick figures from three angles (front/toe side, profile, top) in `snowboard/stick/*.png`.
   - The lab's held "Heel-side" and "Toe-side" poses have **no lateral g**, so the body barely leans while the board sits on a 41° edge. Those lab images look odd for that reason. **The real-sim numbers below are what you see in the game.**

## How to select it
- From the title screen, or from the pause menu with Esc: **Rider ("Outfit, skis or snowboard") → "Skis or board" → Snowboard** ("8 m sidecut, quick edge to edge, surfs powder").
- The choice is saved in `localStorage['skiscrapex.outfit'].model = 'snowboard'` and applies at once to free-ski and every event. Screenshots: `snowboard/live/01_rider_panel.jpg` and `02_snowboard_selected_preview.jpg`.
- **There is no regular/goofy option, no stance or binding-angle setting, and no way to ride switch on demand.** Switch only happens after landing a spin backwards (`sim/skier.ts:696`), and it ends when you stop (`:331`).

## The legs: what's wrong and why

### What you see
In a **toe-side turn** the rider is folded flat over the toe edge like someone crawling:
- Hips sit **0.22 m above the board**, below both knees (0.48–0.51 m).
- The torso is **77° off the slope normal**, nearly lying down.
- The head is 0.37 m above the board.
- The back hand is **18 cm below the board, inside the snow**.
- Both knees point **back toward the heel edge**: 109–130° off the boot toe (0° = over the toes, 180° = over the heels).

In a **heel-side turn** the rider sits on their heels:
- Hips at 0.47–0.55 m are level with the knees (0.51–0.56 m), so the thighs are horizontal.
- The upper body leans back about 60 cm behind the heel edge.

**Straight, standing or cruising**, it is a wide sumo or frog squat:
- Knee flex is **83–87°**; real cruising flex is about 25–40°.
- The knees bow outward along the board, past the bindings: front knee 25° off its boot toward the nose, back knee **54° toward the tail**.
- From the front, the legs make an O shape (`stick/board_linked_t0.9.png`, `lab/contact_2_toeside_front_camX-.jpg`).

Evidence:
- Measured numbers: `snowboard/sim_turns.csv`, `rig_heights.txt`, `rig_lab_poses.csv`.
- Frames:
  - `snowboard/sim/sb_turns_period2.4_18deg/zoom/` and its `zoom.mp4`. Frames f000 and f024 are toe-side (crawling); f012 and f013 are heel-side (sitting).
  - `snowboard/stick/board_linked_t1.7.png` (toe-side) and `board_linked_t3.1.png` (heel-side).
  - For comparison, the skis rig: `ski_linked_t1.7.png`.

### What is correct
- **The feet stay on the board.** The ankle-to-binding gap is 0.0 cm in every pose and every sim frame.
- **No leg passes through the deck**: 0 sampled points below it.
- **The legs never cross**: they stay at least 22 cm apart (16 cm in a crash).
- **The binding layout is sensible:**
  - Regular stance (left foot forward). Stance width 52 cm (`BOARD_BINDINGS` z = ±0.26).
  - Bindings at +15° front and 0° back.
  - Boots, highbacks and the board are oriented consistently.
- **The edge maps correctly in the sim and on the board.**
  - Steering right (D) gives a **toe-side** turn with the toe edge down; left (A) gives a **heel-side** turn with the heel edge down. Both have the turn centre on the matching side.
  - Riding switch reverses this correctly: the tail leads and D becomes heel-side (`sim_switch.json`).
  - Board roll follows the sim edge, capped at ±41° (`skierView.ts:750`).
- The front hand reaches over the nose and the back hand stays low; there are no poles.

### Causes (origin/main 28f409e)
The snowboarder **reuses the skier's leg and body pipeline**. Only a few board branches were added, and the ski fix that keeps the legs sensible in a lean was turned off for the board.

1. **The "hips over feet" solver is skipped for the board.**
   - `render/rider/skierView.ts:797-800` reads `if (!boarding) { … placeHipsOverSkis(edgeVisual, …) }`.
   - `placeHipsOverSkis` (`:290-309`) was written to stop exactly this kind of folded knee on skis (see its comment at `:282-288`). It moves the hips along the ankle-to-hip line so the leg keeps its length as the body leans.
   - On the board the hips just ride the body's lean (next item), the hip-to-ankle distance collapses, and the IK has to fold the knees.
2. **The whole body is tipped about the snow under the board's centre, not about the edge.**
   - `body.rotation.z = incline.x` (`:763`). The incline is the skier formula: up to 0.85 rad (49°), from the path's lateral g (`:558-561`).
   - The board itself is placed separately in root space, rolled about its own long axis (`placeBoard`, `:368-379`, called from `:746-758`).
   - So in a toe-side turn the hips swing out 49° over the toe edge while the feet stay on the board.
3. **The hip height formula assumes a skier's narrow, vertical-leg stance, and it collapses in a lean.**
   - `:765-768`: `kneeFold = 0.15 + flex*1.25`, `hipHeight = 0.97 − 0.85·(1 − cos(kneeFold·0.55))·1.05 − …`, clamped at 0.40 m.
   - The crouch target is raised by `|incline|·0.3` (`:647`), so in every carve the hips sit at the 0.40 m floor before the 49° tilt is even applied.
   - Even when cruising, the bindings sit 0.52 m apart while the hip sockets are 0.22 m apart (`skierModel.ts:372`). The legs are therefore splayed and short of reach, giving **83–87°** of knee flex.
4. **The knee direction comes from the ski-boot cuff, measured against the midpoint of the hip-to-ankle line.**
   - `fitLegs`, `:261-274`: `kneeHint = (ankle + BOOT_CUFF·SHIN) − midpoint(hip, ankle)`.
   - For skis, the hips are over the feet, so the hint points forward.
   - On the board, the hip sockets sit inboard of the bindings, so the hint picks up an **outward** (nose or tail) component: the bow legs.
   - When the hips swing past the cuff in a toe-side lean, the hint **flips toward the heel**: the backward knees.
5. **The skier's angulation terms work about the wrong axis on the board.**
   - The hips are turned −90°+0.25 (`:775`), and joint order is `YXZ` (`:385`).
   - So `hips.rotation.z = −incline·0.12`, `spine.rotation.z = −incline·0.2` and `chest.rotation.z = −incline·0.14` (`:776`, `:781-782`) tilt the torso **toward the nose or tail**, not back toward the heel or toe edge.
   - Up to about 22° of sideways tilt along the board ends up in every carve.
6. **Hands, crouch and absorption are the skier's.**
   - The crouch spring, the mogul fold-up (`:648-651`) and the landing kick all come from the skier, with only scale factors changed for the board (`:575`, `:596`, `:654`).
   - The hand targets are fixed in chest space (`:867-873`), so when the torso lies flat over the toe edge the back hand goes into the snow.

### Recommended fixes
Do these in order. Each one should be checked in the rider lab and against the measurements in `zz_snowboard_rig.test.ts`.

1. **Lean the board rider about the engaged edge, with a separate pose for the board.**
   - Skip `body.rotation.z = incline` for the board, or rotate about the engaged edge line instead of the board centre.
   - Then put the hips explicitly in **board space**:
     - Across the board: `hipAcross = sin(lean)·reach + toeSide·0.10`.
     - Height: `hipUp = cos(lean)·reach`.
     - Along the board: the stance centre plus a small fore/aft weight shift.
     - Reach: `reach = legLen·(0.88 − 0.2·flex)`, measured from the binding midpoint.
   - This is the board version of `placeHipsOverSkis`. It could be generalised by passing the two binding ankles instead of the ski ankles, and turned on for `boarding` at `:797`.
2. **Hip height from the real stance geometry.**
   - Compute `hipY = ankleY + sqrt((L·k)² − (halfStance − hipSocket)²)`, with `k` set from flex: about 0.93 cruising and about 0.75 deep.
   - This replaces the vertical-leg formula at `:765-766`.
   - Lower the board's base crouch (about 0.2) so cruising sits at **25–40°** of knee flex, not 85°.
   - Remove the 0.40 m floor, or move it to board space.
3. **Board knee hint.**
   - For the board, use the boot's toe direction in the board's up plane plus a small inward pull toward the stance centre, not `cuff − midpoint`. For example:
     - `hint = toeDir + 0.25·(−sign(binding.z))·boardAxis`
   - This gives knees over the toes, slightly knock-kneed, the way a real rider stands.
   - Clamp the hint so it can never point toward the heel. Real knees can't, even on heel-side: the rider sits back by bending the hips, not by bending the knees backwards.
4. **Board heel-side and toe-side shapes**, for comparison:
   - **Toe-side:** hips over or slightly inside the toe edge; shins driven forward about 20–30° into the highbacks; torso fairly upright (about 20–30° forward); hands low over the toe edge, never below the snow.
   - **Heel-side:** hips back and low over the heel edge; shins **upright or slightly forward** against the highbacks (never behind them); chest over the knees; front arm leading.
   - Store these as board targets, rather than deriving them from the ski incline.
5. **Rotate the angulation terms into board axes.**
   - For the board, apply the counter-tilt about the hip's local **X**, the toe-heel axis (`:776`, `:781-782`), not Z.
   - Use small values: about 10–15° of counter at a full edge.
6. **Clamp the hands above the snow** in board carves: lift the hand targets by `max(0, floor − y)`, as `placeArm`'s `floor` argument already does for crashes.
7. **Add options:**
   - Regular or goofy (mirror `BOARD_BINDINGS`, or flip the board yaw by π and swap the legs).
   - Binding angles: forward +15/0 or duck +15/−15.
   - A fakie toggle.
8. **Add a regression test**, next to `tests/riderBoots.test.ts`:
   - In real-sim heel-side and toe-side turns, the hips stay above both knees.
   - The knee-bend direction is less than 60° from the boot toe.
   - The hands stay above the snow.
   - The current build fails all three in toe-side turns (`sim_turns.csv`).

## Other snowboard issues (physics and gameplay)
The physics only knows the board through `{ sidecutRadius: 8, floatScale: 1.35 }` (`ui/riderPanel.ts:31`, used at `sim/skier.ts:363` and `:478`). Everything else is the ski model.

| # | Issue | Numbers | Where |
|---|---|---|---|
| B1 | **Same speed as skis**: same drag, same tuck. | Shoot the Chute on the board: **1:12.8, trap 126, top 129 km/h**; on skis 1:14.0 / 123 / 127. On 18°, 72 km/h after 8 s, same as skis. | `sim/skier.ts:517`, `constants.ts:19` |
| B2 | **Invisible skating and pole-pushing.** W at low speed skates or pole-pushes a snowboard. | From a stop on the 7.5° start: 0 → 8 km/h in 1.2 s with no visible stroke, because the board view skips the skate and pole poses (`skierView.ts:530`, `:534`). | `sim/skier.ts:269`, `:429` |
| B3 | **Hockey stop too strong**, same as skis. | 52 → 0 km/h in **0.87 s and 7.4 m (1.75 g)**. A real heel-side or toe-side skid stop from 50 km/h takes about 2–3 s and 15–20 m. Every brake in our runs rolled onto the toe edge (lab "Edge stop" and the sim brake). I found no heel-side stop. | `constants.ts:43`, `:52` |
| B4 | **Edge and lean don't add up.** | Held carve: radius **5.1 m** (8 m × cos 50°) at 34–39 km/h, **about 2.0–2.2 g** on a 50° edge. Holding 2.2 g needs about 65° of inclination. The view caps lean at 49° and board roll at 41°, so the rider looks under-leaned for the g it is pulling. | `sim/carve.ts`, `skierView.ts:559`, `:750` |
| B5 | **The turn stops while the board stays on edge.** Holding a key, the turn finishes in about 1.2 s and the rider then traverses with latG 0 while the board stays at 50° "carving". | Speed 39 → 22 km/h over 2 s. | `maxTraverseDeg` in `constants.ts:31`, `skier.ts` turn cap |
| B6 | **No crash from overload**, same as skis. | At the Chute finish: 95 km/h, edge 50°, carveLoad **13.9 g**, washout 1, still no crash. | `sim/skier.ts:447`, `:915` |
| B7 | **Switch can't be chosen.** It only follows a spin landed backwards. | — | `sim/skier.ts:696`, `:331` |
| B8 | **Ollie/pop is the ski pop.** The nose lifts for 0.27 s; there is no tail-press load-up before the pop, so the back leg just tucks up. | — | `skierView.ts:751` |

### Events with the snowboarder (live v0.9.29)
- **Shoot the Chute: PASS.** 1:12.8, radar 126 km/h, top 129 km/h, results card and retry all fine (`shots/sb_chute_*`, `csv/sb_chute.csv`). It behaves the same as on skis, including crossing the finish at about 95 km/h.
- **Aerials: PASS.** 14 pts (silver needs 22): "Air" DD 1.0 × form 8.0 and "Mute" DD 1.1 × form 5.5. Takeoffs were 44 km/h with vy 2.8 m/s and 42 km/h. The park "Combo ×2 1,214 TOTAL" pop-up shows up in the judged event here too (`snowboard/live/sb_aer.csv`, `shots/sb_aer_*`).
- **Kristi's Moguls: PASS, scoring 82 pts (gold needs 80).** 33 perfect and 7 good turns, 0 missed, both airs, top speed 50 km/h. A snowboarder is judged on the skiers' mogul beat and turns with no change. That is fine as a game, but it is not a snowboard format (`snowboard/live/sb_mog.csv`).
- All events accept the snowboard with no warnings. The trick names are ski names (Mute, Japan, Truck driver, Safety), with no board-specific names or scoring.

## Files (under `snowboard/`)
- `live/`:
  - Rider panel and snowboard selection: `01`, `02`.
  - Hand-keyed Chute ride with D, A, S and Space: shots `03`–`13` and `live_chute_board.csv`.
  - Event runs: `sb_chute`, `sb_aer`, `sb_mog` (shots, CSV and stdout).
- `lab/`: 9 held poses × 5 cameras, as `<pose>_<view>.jpg`, plus one contact sheet per view (`contact_*.jpg`).
  - Camera X+ is behind the rider (heel side); X− is the front (toe side).
  - Nose and tail views show the rider in profile; the three-quarter view is from high up.
- `sim/sb_turns_period2.4_18deg`, `sim/sb_turns_period1.4_20deg`, `sim/sb_ollie_15deg`: frames from the real sim and follow camera, with `notes.txt` (time, speed, steer, edge, skid per frame), zoomed crops (`zoom/`), `zoom.mp4` and `contact_zoom.jpg`.
- `stick/*.png`: stick figures of the real rig from the sim, from three angles: linked turns, brake, pop, and skis for comparison.
- Measurements:
  - `rig_lab_poses.csv|json`: lab poses in board space.
  - `sim_turns.csv`: real-sim time series with edge, the side the turn is on, knee directions and hip offsets.
  - `sim_summary.json`.
  - `sim_switch.json`.
  - `rig_heights.txt`: hip, knee, head and hand heights above the board.
  - `rig_sim_joints.json`.
- `tools/`: the vitest rig probe (`zz_snowboard_rig.test.ts`; copy it into `game/tests/` and run `npx vitest run tests/zz_snowboard_rig.test.ts`), the Playwright scripts, and the plot and crop scripts.
