# SkiScrapeX playtest log, 2026-11-25 (times are America/Vancouver, PST)

**Build:** the live site https://johnstonstu.github.io/SkiScrapeX/?test.
- Testing started on **v0.9.27**. The site deployed **v0.9.28** at about 19:27, during the session. Runs from 19:27 onward show v0.9.28 in the HUD.
- 0.9.28 adds only the radio and pocket player and changes the D-pad. `git diff f6f46cc c99f73d` shows no change to `sim/`, `render/rider/`, `world/events.ts` or `app/race*`, so the physics and event findings hold for both versions.
- Code line references are to origin/main **c99f73d (v0.9.28)**.

**Rig:**
- Playwright with headless Chromium and SwiftShader (software WebGL) on the box.
- Settings: quality low, shadows off, view distance 0.6, no NPCs, music off.
- Events start through the live `window.__game.startEvent(id)` hook, and once through the real Title → Challenges menu. Inputs are keyboard events (W/A/S/D/Space/J), sent by an in-page autopilot or by Playwright.
- No game code was changed. No commits were made from the clone (`/workspace/skiscrapex-live/repo`; its only change is the earlier uncommitted getter edit).

**Big caveat: the frame rate.** The headless box renders the game at **2–5 fps**.
- A CPU profile puts 82% of the time in WebGL `getParameter`, which is where the software GPU flushes. That is a limit of this box, not a game hang.
- Even with every heavy scene group hidden, the game reached only 5.7 fps.
- Physics runs at a fixed 120 Hz, so speeds and times are real. Keyboard control, however, is quantised to steps of 200–400 ms.
- To separate the game from the test rig, I also ran the real sim offline in Node (`tests/zz_playtest_physlab.test.ts` in an extracted copy of main, using the live `data/` files) with a keyboard emulator at 60 fps and at 5 fps. I also ran `rider.html?sim` (the real rider model, sim and follow camera, stepped deterministically at 60 fps) for the animation frame sequences.

## Chronological log
- **18:56** Read the code: `world/events.ts` (7 events), `app/race.ts`, `raceDirector.ts`, `session.ts`, `compDirector.ts`, `moguls.ts`, `sim/skier.ts`, `sim/constants.ts`, `sim/carve.ts`, `render/rider/skierView.ts` and `player/camera.ts`. The local clone was at 0.8.10, so I extracted origin/main to `/workspace/sx-main` instead of pulling.
- **18:57** Probe: live v0.9.27. The `__game` hooks are present, including `startEvent`, and all 7 event ids resolve. Load took about 2.2 s; the title screen ran at 11.7 fps. Console showed only the AudioContext autoplay warning and the KHR_parallel_shader_compile warning (both benign; the same through the whole session, with no page errors).
- **18:59** First Shoot the Chute run. The pilot started too late because the screenshot stalled the page through the countdown, so the skier never pushed. Finding: the start faces across the summit cat track (heading 129°, 7.5° pitch), so **a racer who does not push never moves**. The clock ran to 3:33 with the skier at 0 km/h.
- **19:06** **Shoot the Chute: PASS.**
  - Result 1:14.0 (first finish; gold needs 1:06.5). Radar 123 km/h, top speed 127 km/h. Distance 1108 m, vertical 344 m, Pehota benchmark 151 km/h shown.
  - The first 35 s cover only 222 m of summit cat track at 12–50 km/h, with a 5° flat where speed fell to 12 km/h. The Chute proper runs from 40 to 74 s, with pitch 24–29° and 100–127 km/h.
  - The skier crosses the finish at **101 km/h**. The results panel opens and freezes the sim mid-run. There is no run-out or stop in front of the lot.
  - Retry (R) works: back to the start, countdown again.
- **19:08** **Apex Downhill: PASS.**
  - 2:46.4, 10/10 gates, split 1 at 1:31.7, split 2 at 2:12.5, radar 71 km/h, top speed 85 km/h.
  - A fast start gave +7 km/h.
  - **20 takeoffs, 5 of them scored airs** (clean, perfect, sketchy, sketchy, sketchy) **on the Gunbarrel pitch**. The moguls from pass B (`world/corrections.ts:113`, Gunbarrel `moguls: true`) stay on the race course during the FIS downhill.
  - The offline bare-terrain sim (no moguls) gives **139 km/h top and 138 km/h at the radar** on the same course, against 85/71 in game.
  - Split 1 comes at 92 s, so more than half the race is the summit cat-track traverse.
  - Results UI: gates, splits, trap, benchmark (Pridy 1:19.5), trick points, and tight/clean/skidded gates (0/10/0).
- **19:08** Apex Slalom run 1 (sl1): DQ at gate 4 (pilot at 5 fps and 43 km/h; not a game bug).
- **19:14** **Apex Slalom (sl2): run 1 PASS.**
  - 35/35 gates in 1:18.2, with "Tight" and "Skidded" gate pop-ups and split 1 at 0:40.2.
  - The run 1 → run 2 transition card and the new countdown work.
  - Run 2 DQ at gate 1 was my pilot keeping a stale route index; I fixed the pilot afterwards.
  - The snow under the slalom start reads as surface `park` (Okanagan Park overlaps Okanagan Run).
- **19:14** Teck Open GS (gs1): gates 1–4 passed, then the pilot drove into powder beside Old Mill and stalled.
  - The clock ran past 2:46 with no off-course end, because the skier was inside the 30 m corridor.
  - A skier stopped in deep snow (sink 0.32 m) on a 10° pitch, facing across or up the hill, could not skate out.
- **19:19–19:22** Perf investigation.
  - fps was 2.3 at 800×450 and 4.5 at 400×225.
  - The scene holds 1.19 M triangles: terrain 279k, moguls 146k, lifts 138k.
  - The CPU profile shows `getParameter(UNPACK_ROW_LENGTH/SKIP_*)` once per frame from texSubImage row uploads, which is where SwiftShader blocks. No shader recompiles happen during play. This is box-specific, not a game bug.
- **19:22** Downloaded the live `data/` files and ran the repo tests: events, ski, moguls and race all passed (53 tests).
- **19:25** Ran the physics lab (offline real sim, keyboard emulator). Results are in `csv/lab_*` and `raw/physlab-summary.json`.
- **19:26** Rider lab frame sequences (`frames/lab_*`): linked turns on 12°/20°/25°, a tuck and an ollie. The ollie capture missed the jump window; it shows only straight running.
- **19:27** **Kristi's Moguls: works, but my pilot went out.**
  - Countdown, beat strip, and a tap-to-turn autopilot holding the line all work.
  - 14 Perfect/Good turns up to 37 km/h, then three misses → "Out of the line: three misses in a row", which is correct per the rules.
  - The misses came from my 0.3–0.48 s frame interval against a 0.33 s beat; a real 60 fps player would not have this problem.
  - The **top air gave 0.46 s of air and no scored trick**. A straight air under 0.5 s is not "tricky" (`sim/skier.ts:709`), so it gets 0 air points. The landing also dropped speed from 39 to 21 km/h.
- **19:27** **Aerials: PASS.**
  - 18 pts (silver needs 22). Jumps: Air 9.5 and Air 8.0; a 180 Mute scored 6.0 (sketchy).
  - Takeoffs were about 45 km/h with vy 2.4 m/s on the aerial-layout tables. These are small tables, not aerial kickers: the most air was about 0.5–1 s.
  - The HUD also shows park "Banked 482 TOTAL" pop-ups during aerials, a second scoring system that is confusing next to the judged score.
- **19:30** **UI flow (v0.9.28):**
  - Title → Challenges lists "Apex events" first: 7 events with their locations and targets ("setting times…" until the pace bot finishes).
  - Clicking Shoot the Chute starts it with the countdown.
  - R mid-run restarts at the start gate (clock reset, count "2").
  - Pressing Esc right after start pauses and holds the countdown (count frozen at "3", clock at 0.0).
- **19:34** **False start:** holding W for 700 ms on "3" reset the count (3 stayed for about 1.5 s, then 2, 1). **"False start" never appeared:** the HUD overwrites it with the digit on the next frame (`app/raceDirector.ts:71` then `:78`). A 120 ms tap at 3 fps was missed entirely, because input is level-sampled per frame.
- **19:34** **Crash/DNF test on the Chute:** at 96 km/h I held A (full left) to throw a hard turn.
  - Result: no crash. The skis swung 33° → 85° across the travel and the skier skidded **from 96 to 0 km/h in 3.1 s** with no fall.
  - Holding A after that, the skier **carved continuous 360° circles on a 19° slope**: through uphill, back down, about 4.5 s a loop at 6–18 km/h, in "carving" mode with skid 0.016.
  - Eventually "Left the course" ended it (DNF screen correct).
  - The crash-DNF path itself could not be triggered by steering, and the attempt to drive into the trees did not produce a crash.
- **19:39** **Match Your Time: PASS.** Run 1 1:33.3, run 2 1:32.1, difference 0:01.1 → bronze (silver needs 1.0). The run 2 HUD "match 1:33.3" works.
- **19:39** Slalom 2-run retry (sl3): DQ at gate 1 on run 1, caused by my pilot's route-reset bug, not the game. I fixed the pilot.
- **19:46** Session interrupted. I resumed and relaunched slalom (sl4) and GS (gs2) in background shells with timeouts.
- **19:46** Slalom retry sl4 (run alongside gs2): DQ at gate 1 again. With two browsers sharing the CPU, fps dropped and the pilot could not make the first slalom gate. This is a rig limit, so I stopped retrying slalom in the browser. The offline sim completes both slalom runs at 35/35 (48.3 s, `csv/lab_G_course_apex-slalom_60fps.csv`).
- **19:51** **Teck GS retry gs2: the issue-7 stall reproduced at the same spot.** Gates 2 and 4 were graded "Tight". After gate 4, the skier is in **powder at (2027, 249, 1006)**, pitch 11.8°, sink 0.35 m, and stopped. The clock reached **4:30 with no DNF** before the 7-minute harness timeout. Both runs ended at the same place, which suggests the gate 4→5 line runs into or right beside an unprepared powder zone.
- **19:55** Wrote FINDINGS.md and built the tarball.
