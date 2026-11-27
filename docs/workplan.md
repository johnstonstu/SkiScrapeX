# Workplan: refine, polish, add content

Written 2026-11-23 at v0.8.7; refreshed 2026-11-24 at v0.9.0 for Stu and for any agent picking up work. `docs/roadmap.md` says where SkiScrapex is going (phases to 1.0). This file says how to get there: the next milestones in order, the work in each, how to tell when an item is done, and how to work without a GPU or without Stu in the loop. Open items link to GitHub issues; when an item gets an issue, link it here.

### Overnight ship log (0.8.13 → 0.9.0)

| Tag | Focus |
|---|---|
| 0.8.13 | Landing EFH leeway, hop/rail capture, plant-leads-steer |
| 0.8.14 | Powder float / plow / soft yaw (Steep-feel) |
| 0.8.15 | Map hover+click trip; rail entry/dismount/press; SFX tighten |
| 0.8.16 | Park approach aim + camera hint; multi-lane spacing |
| 0.8.17 | Crash recovery: directional tumble, visual gear gather, buildings/signs → beginCrash |
| 0.9.0 | Optional sample layers, idle hands, weather gusts, Low village lite, docs sync |

## How we work

### The loop

1. Pick the top unchecked item in the current milestone below (or the item Stu names).
2. Branch off `main` (or off the current milestone branch) with a short name: `turn-at-speed`, `stocks-terminals`.
3. Measure before changing anything: tuning bots, rider lab, `?perf`, screenshots. Put the before numbers or images in the PR.
4. Make the change, re-measure, add or update tests where behaviour can be pinned down.
5. `npm test` and `npm run build` in `game/`, then push and open a PR with before and after.
6. Stu plays it (live merge or local branch), gives notes, we fix. Only Stu decides when a branch merges to `main`; each merge bumps the version, dates the `CHANGELOG.md` entry and gets a tag.

Small, playable releases beat big ones: aim for a patch Stu can try every one or two sessions.

### Tools for judging work without a GPU or a player

| Question | Tool |
|---|---|
| Does skiing behave? | `npm run tune` bots on real runs, parks and powder; `tuning/feel.test.ts` for jumps, turn response and camera lag |
| Does the rider look right? | `rider.html?pose=...` for held poses, `rider.html?sim` for real turns frame by frame (`window.__step`) |
| What does a spot look like? | Headless Chromium screenshots (`?at=x,z,heading`, `?ride=`, `?park=`, `?test`), see `docs/handoff.md` |
| What does it cost? | `?perf` draw calls, triangles and load phases at the five standard spots; counts are valid headless, frame times are not |
| Does it run on real hardware? | Stu's machines, or a `claude --chrome` session that reads the console in his Chrome |

Anything that changes look or feel needs a screenshot or a number in the PR. "Looks better" is Stu's call, so show him.

### Graphics budget

Every visual feature must say what it costs and which quality levels get it. Rough budgets per frame at the start spot (to be confirmed by the 0.8.8 cost report):

| Level | Target hardware | Frame rate | Draw calls | Triangles (with shadows) |
|---|---|---|---|---|
| Low | Older Intel Macs and laptops, phones | 30 fps | under 250 | under 0.9 M |
| Medium | Iris Xe, older dedicated laptop GPUs | 45 fps | under 350 | under 1.5 M |
| High | Apple silicon, current NVIDIA and AMD | 60 fps | under 450 | under 2.5 M |
| Ultra (planned) | Strong desktops | 60 fps | as needed | as needed |

Expensive shader work goes behind a define (like `SNOW_DETAIL`). Expensive geometry gets a count or distance that scales with the level. Never make Low worse to make High better.

## Milestones

### Runs from the Apex research handoff (PR #101, `docs/review/apex-terrain-handoff.md`)

- [x] 0.9.18, pass A: south-face runs, Wildside names and Wildly Easy, Upper/Lower splits, Wishbone merge, Grandmother's blue, Chaser, neutral names for unknown traces.
- [x] Pass B (0.9.23): glades thinned into lanes and labelled; moguls on Sunbowl, Make My Day, Old Mill, Gunbarrel, K2; chop on Crusher and Hanks, packed Grandmother's; summit orange slat fence, Tooth/Tusk signpost, padded lift towers (already in `lifts.glb`, now tested); run widths and pitches tested against `run-profiles.json`.
  - [x] Glades: Any Which Way, Granny's, Fools Gold, Hidden Gold thinned (lanes down the fall line), on the map and HUD, with trail-head boards.
  - [x] Moguls on Sunbowl, Make My Day, Old Mill, Gunbarrel and K2.
  - [x] Crusher and Hanks ungroomed (chop, no corduroy); Grandmother's packed (no corduroy).
  - [x] Landmarks: summit slat fence, Tooth/Tusk signpost, padded towers.
  - [x] `tests/runProfiles.test.ts`: widths and pitches against `run-profiles.json`.
- [x] Events: Shoot the Chute and the Mars downhill (`docs/review/apex-events/game-event-ideas.md`), plus the Apex Slalom, Teck Open GS, Kristi's Moguls (tap-to-turn rhythm), Aerials and Match Your Time, with a shared race system (start gate, gate grades, line assist, ghosts). Next candidates from the same doc: dual moguls against a ghost, Torchlight Parade (needs night), Dummy Downhill, Boardercross heats against AI.
- [ ] Distant forest: apron tree density (the LiDAR ring is sparser than our cover already), with the performance pass.

### Mobile pass (2026-11-26)

Audit at iPhone SE and iPhone 15 (portrait and landscape) and iPad portrait. `?touch` forces the touch layout on desktop.

- [x] 0.9.35: minimal in-run screen (Settings, Screen while skiing; Auto is minimal on touch).
- [x] 0.9.36, menus: Runs as Map / List on portrait phones and side by side in landscape; Rider preview beside the swatches in landscape; Challenges descriptions collapse; compact pause menu with the controls guide behind a button; touch wording ("Tap", not "Hover" or "Click"); 44 px tap targets.
- [x] 0.9.37, sizing and platform: layouts for phone portrait, short landscape and tablet (iPad gets the desktop menus with touch controls); `dvh`/`svh` instead of `100vh`; re-detect touch when the input changes; fullscreen and wake lock on Android; a web app manifest for iOS home screen.

### Queued (from Stu's scenery-blender playtest, 2026-11-25)

- [x] Groomer tracks: two clean carve lines, one per ski, instead of the single track drawn now. Deep snow trenches are behaving well, leave them.
- [x] Blender rider: ankles look broken when turning. Fix ankle and boot weighting or the turn pose so the shin angulates into the boot instead of the joint folding.

### Next up (from Stu's 0.9.16 playtest, 2026-11-24)

- [x] 0.9.17: instant deep-snow trenches, chair arrival on free ski, arrival camera, T-bar and carpet unloads, carpet on the ground, window flicker, Aerial Site, Prospector park on L2, Claim Jumper XL line, pole push vs tuck, gravity-relative lean.
- [x] 0.9.18, music (PR pending, `claude/adaptive-music-1dc879`): a music player whose tracks react to what you are doing (cruising, steeps, freestyle). Both sources: procedural layers generated in the browser by default, plus a few open-licence tracks as an option (credits in `game/THIRD_PARTY_NOTICES.md`). Done: procedural music and the Tracks source with an empty track list; picking and adding the actual CC0 or CC-BY tracks is left for Stu (see `game/public/audio/music/README.md`).
- [ ] More animation and VFX polish from play: landing and takeoff spray, powder plumes off berms, the rider's turn shape from behind.

### Next up (from Stu's 0.9.13 playtest, 2026-11-24)

- [x] 0.9.15: windows on all buildings, one summit hut, telecom towers on both peaks.
- [x] 0.9.16, runs: trace real cleared run edges from LiDAR canopy so no trees stand in runs (bottom of Quickdraw first); groomer corduroy leans to the fall line on wide runs, traverses keep their heading.
- [x] 0.9.16, West Bank and The Pit (Stu: "awesome runs, need to be accurate"). West Bank is a fun mogul run right under Quickdraw with some steep sections; one of the lift towers has a small cliff beside it you can jump off. The Pit has a big cliff at the top and a rock band in the middle to jump off; a big-mountain run people watch from the chair. Needs cliff and rock-band overlays on the terrain, moguls on West Bank, and real widths.
- [x] Building windows pass (0.9.16). A full photo-matched rebuild of the hero buildings is still open (#32).
- [ ] Run names: later, with Stu.
- [~] Performance: 0.9.16 fixed the likely hitches found by reading the code (track uploads, forest LOD flapping, shader warm-up, streaming churn). Still to do: profile on Stu's GPU (Claude in Chrome) and move chunk builds off the main thread if hitches remain.
- [x] Deep snow (0.9.16): trenches and berms around the player, drawn on Medium and High, read by the sim. Next: sluffs and face-shot spray tied to the berms, persistent coarse tracks beyond the patch.


Ordered by what unblocks the most. Each is one or more patch releases.

### 0.8.8: Graphics that fit the machine (in progress, PR #71)

Goal: the game runs on Stu's older MacBook and makes good use of his desktop.

- [x] Auto picks a level from the graphics chip; per-machine limit after a GPU reset or slow frames; messages instead of a blank screen; close-up snow detail off on Low.
- [ ] Cost report: draw calls, triangles and programs at the five spots, at each level, 0.8.6 against 0.8.7, recorded in `docs/status.md`.
- [ ] Gate whatever 0.8.7 added that is heavy (boundary rope and signs, tower and chair detail, sign boards, summit flags, the forest sight-line fade) by level.
- [ ] `?quality=low|medium|high` for one load without touching saved settings; the `?perf` overlay shows the level, its reason and the renderer string.
- [ ] Played on the MacBook (Auto should be Low) and the desktop (Auto should be High). Then merge.

### 0.8.9: Skiing that feels right (#70)

Goal: turning, speed and stopping feel natural on keyboard, pad and touch at every speed. This is the core of the game; it gets polished before more content.

- [ ] Turn radius grows with speed. Today holding a key pivots the skis at about 95°/s even at 37 km/h: 6 to 8 m turns over 2 g. Target: short swings when slow, 15 to 25 m carves at 40 km/h, about 1 to 1.5 g in a hard recreational carve. Prototype behind `?turns=wide`, A/B with Stu, record radius and g against speed for both.
- [ ] Analogue feel: half a stick gives a half-committed turn; keyboard gets a quick ramp so taps make small corrections.
- [ ] Speed control: a skidded turn should scrub speed predictably; hockey stops at speed should feel strong but not instant.
- [x] Sense of speed: field of view widens slightly with speed, wind audio scales into tuck top speed and brightens in the air, gamepad rumble on chatter and impacts (0.8.11). Spray already scaled with sink/skid; camera chatter shake was already in.
- [ ] Terrain response: moguls absorb through the legs (crouch and extend) rather than launching you; rollers and lips feel like weight shifts.
- [x] Tuck: top speed and how much tucking matters (0.8.11 raised tuck drag 0.30→0.42 m²; still verify on Gunbarrel / Grandfather's in a playtest).
- [ ] Steady camera tuned from play: how much it swings, how high, how far back at speed.
- [ ] Bots and tests updated so the new feel is the regression baseline.

### 0.8.10: Rider polish and the snowboard

Goal: the rider looks like a good skier in every state, and the snowboarder gets the same care.

- [x] Pole plant timing: plant fires on steer flip so the hand leads the turn (0.8.13); tip/wrist polish still open.
- [x] Idle / soft-cruise hand and pole sway (0.9.0).
- [ ] Turn shape from behind: outside leg long, inside leg short, hips inside the feet, hands quiet; check in `rider.html?sim` at 12°, 18° and 25° and at three speeds.
- [ ] Air: compression before a pop, extension at the lip, tuck up in the air, spot the landing, absorb and rebound.
- [ ] Rails: entry hop, sliding stance, balance arms, exit; presses already pose.
- [ ] Secondary motion: jacket hem and hood flutter with speed, pole swing, slight head bob on bumps.
- [~] Crashes with tumbles and yard sales (#61): 0.8.11–0.8.17 tumble, directional slide, visual ski scatter and gather on get-up; buildings/signs share beginCrash. World-space pickups still open.
- [ ] Snowboard pass: heel and toe turns with the right lean, rotated stance, crouched carve, ollie and grabs, its own tuck, a `rider.html?sim&model=snowboard` view.
- [ ] Other skiers (#43) use a lighter rider (fewer meshes, no poles past 60 m) so ten of them cost little. Soft collisions with the player landed in 0.8.11.

### 0.9.x: Looks like Apex (phase 2, visual review)

Goal: a local recognises Apex at a glance. Ship this in batches of four to eight issues, each a patch release, so Stu sees progress every few sessions. Suggested order (most visible first):

1. **Runs and terrain**
   - [ ] Ragged, natural run edges (#12), cat tracks and traverses (#15), summit plateau (#14).
   - [x] Glades with real gaps (#17), bigger moguls on the right runs (#16) (run pass B).
   - [ ] Name the remaining traced runs (#18, #52; needs Stu or the trail map).
2. **Trees**
   - [ ] Denser forest (#21), clumping (#23), variety (#22).
   - [ ] Heavier snow on branches below the summit (#20), snow ghosts at the summit (#19).
   - [ ] Keep trees off terminals and buildings (#24), fix the spire tree (#25).
3. **Snow and light**
   - [ ] Snow surfaces (#41), corduroy (#42), finish snow detail and blending (#69).
   - [ ] Longer shadow range on High and Ultra (#40).
   - [ ] Better sky, sun and haze; clouds that move.
4. **Lifts**
   - [ ] Stock's terminals (#28), T-bar (#29, #9), Magic Carpet (#30), lift-maze details (#31).
   - [ ] Riders on chairs and in lift lines.
5. **Village**
   - [ ] Hand-modelled hero buildings: day lodge, Gunbarrel Saloon, ticket office (#32).
   - [ ] Roofs (#33), wall materials (#34), Billy Goat Hut (#35), on-building signs (#36), missing amenities (#37), village details (#38).
   - [ ] Chimney smoke, people in the village, lights at dusk.

### 0.10: Beta (phase 3)

Goal: strangers can play it and tell us what is wrong.

- [ ] Real phones (#50): frame rate on a mid-range Android and an older iPhone, touch layout size, opacity and a left-handed option, tilt steering as an option.
- [ ] Smaller download (#51): heights as differences from a plane, about 3.9 MB to 1.4 MB for the 2 m grid; first load under about 10 MB; show the mountain while the forest and village build.
- [ ] Installable with offline play (#54).
- [ ] Accessibility (#55): remappable keys, colour-blind-safe run colours and hints, reduced motion, readable text.
- [ ] Feedback link and error capture (#56); CONTRIBUTING and issue templates (#57); CI on pull requests (#49).
- [ ] Outside playtest round (#58): five or more players including Apex regulars, a short survey, notes filed as issues.

### 0.11 to 0.12: A living mountain (phase 4)

Goal: reasons to come back. Content that changes how a session plays.

- [~] Weather and time of day (#39): presets + gust pulses (0.8.11 / 0.9.0); still need day cycle, fresh powder depth, sunset, per-day snow conditions.
- [ ] Night skiing under the lights (#59); snowcats grooming in the evening and corduroy only where groomed (#60, #44).
- [ ] Instant replay and a photo mode (#62).
- [ ] Skiing depth (#63): visible balance cue, powder face shots and sluffs, butters, more rail shapes, trick variety bonus.
- [ ] More to do: see Content below.

### 1.0 (phase 5)

Apex's permission or a rename (#64), complete credits and licences (#65), performance targets met on the test devices (#66), trailer, GIFs and a landing page (#67). Release checklist in `docs/roadmap.md`.

## Content: things to do on the mountain

Content is added between the polish milestones above, a little at a time, once the skiing it relies on feels right. Candidates, roughly in order of value for effort:

- **Run medals everywhere**: every named run gets a timed run with medal times from the bots, shown on the trail map, so the run checklist becomes a set of goals.
- **Daily challenge**: one run, slalom or park layout picked by the date, with a local best.
- **Race courses**: a GS course on Grandfather's or Juniper, a dual slalom, Shoot the Chute as an event (Apex's real race).
- **Park content**: more layouts from the feature library, a slopestyle line with judged runs, a big-air jump, rail gardens; the demo park as a sandbox.
- **Collectibles with stories**: nuggets plus a few landmarks to find (old mine relics, the summit cairn), each with a line of real Apex history.
- **Free-ride goals**: drop the steeps, ski every glade, find the hidden lines; badges rather than timers.
- **Unlocks**: outfits, ski graphics, boards and poles earned from medals and finds; a rider profile showing them.
- **Companions**: other skiers who follow a run with you or race you (ghost of your best run first, since it needs no AI).

## Cross-cutting polish

Ongoing, a few items per release:

- **Audio**: carve and skid layers by surface, wind by speed, lift and village ambience, crowd at the base, a music option, UI clicks. Optional plant/landing/latch WAV hooks landed in 0.9.0 (procedural fallback).
- **Effects**: spray sized by speed and edge, powder plumes, tracks that persist for the session, breath in the cold.
- **UI**: HUD that shows the run you are on (not the course you picked), lift names on lifts, cleaner menus and transitions, a better loading screen, controller-first navigation.
- **Camera**: speed field-of-view kick, landing camera, a cinematic lift-ride camera option, camera never inside geometry.
- **Engineering**: split `sim/skier.ts`; `main.ts` / rider update partially split in 0.9.5 (autoCap, graphicsFail, crash/sit/Spring modules — deeper ski-pose/tick still deferred). Keep the tuning bots as the feel baseline, a smoke test before each tag, performance numbers in `docs/status.md` every release. Low village lite (cars/decks) in 0.9.0.

## Open decisions for Stu

- Turn feel: wider turns at speed (0.8.9), or keep the quick pivot?
- Which phones go on the test list (#50)?
- Who to contact at Apex about the name (#64), and before or after a public beta?
- Names for W1 to W6 and the L-numbered traced runs (#18, #52).
- Content priorities: which three items from the Content list matter most to you?
