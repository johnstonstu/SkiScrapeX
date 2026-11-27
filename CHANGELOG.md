# Changelog

SkiScrapex uses [semantic versioning](https://semver.org/). Until 1.0 the minor number marks a milestone and the patch number a fix release; anything may change between minors. Each milestone is a merge to `main` with a `vX.Y.Z` tag. The version lives in `game/package.json` and shows in the pause menu.

## 0.9.35 (unreleased): Minimal screen on phones

First part of the mobile pass. On a phone the HUD, map, tips and buttons covered close to half the screen in portrait.

### Added

- **Settings, Screen while skiing: Auto, Minimal or Full.** Auto is Minimal on touch screens and Full elsewhere, so desktop is unchanged.
- **Minimal screen.** One slim row at the top: speed on the left and an icon-only pause on the right. The run name and clock show as a pill between them for a few seconds when the run changes (a new run, a restart, the top of a lift), and stay up for timed runs, parks and events.
- **Music player in the pause menu.** The ♪ button is hidden on the minimal screen; Pause, Music player opens it.

### Changed

- **Minimal screen:** the resort map starts off (Pause, Resort map turns it on, tucked under the pause button); Grab only shows in the air or on a rail; Jump and Grab are lighter and sized to the screen; tips, lessons and the park cue sit under the top row and are smaller; the trick feed is smaller; the controls hint sits low on the left; the data credits move from the bottom of the run to the title screen and the foot of the pause menu.

## 0.9.34 (2026-11-26): Softer snowboard lean

### Fixed

- **Snowboard lean.** Since 0.9.32 the board rider drew the full physics lean, and with the stance pivoting about the edge the legs peaked at 55° against 48° of physics lean, which read as too intense. The board now draws 80% of the physics lean on a slightly softer spring, so the legs peak just under the physics. The skier is unchanged.

## 0.9.33 (2026-11-26): Race starts, race gates, moguls and lift tops

From Stu's 2026-11-26 playtest notes.

### Changed

- **Race start.** Holding forward through 3, 2, 1 was called a false start, so you had to keep your hands off the keys. You can now hold forward through the count and go at GO. A push timed onto GO (up to 0.35 s before or 0.3 s after) is a fast start. There are no false starts.
- **Race gates.** The wide panel spanning every gate blocked the view down the course. Slalom gates are now single bare poles; GS and downhill gates have a pair of poles at each end with a small panel (0.75 by 0.5 m, as FIS sets them) between them. Nothing spans the gate.
- **Mogul comp.** The autopilot held the line with the brake, so the skier hockey-stopped down most of the comp with the skis sideways and the turns you tapped never showed. On each beat the skis now pivot about 30° across the fall line to the new side, the comp holds the target speed through the bumps without the brake, and the skier squares up to each air ramp so the take-off is straight.
- **Getting off at the top.** The unload picks a spot clear of the station, the lift line, buildings and trees, with open snow both ways across the hill. On gentle ground you stop facing down the fall line; on steeper ground, across it on your edges, standing still, so one turn takes you down either way. The T-bar used to leave you beside the return wheel facing uphill.

### Fixed

- **Floating lift shacks.** Stations stood at the ground under their centre, so on a slope a corner hung in the air (the Quickdraw top hut by 1.3 m). Their walls and legs now reach down to the snow.
- **Bump back when letting go of a turn.** On release the hips snapped back toward the middle of the stance in one frame while the body still leaned. The skis and hips now ease off the edge when the steer is let go; linked turns still show the physics edge as it is.

## 0.9.32 (2026-11-26): Riders lean like the physics

### Fixed

- **Full lean.** The rider drew about 20% less lean than the turn needs and caught up about 110 ms late, and the skis were drawn about 7° flatter than the edge the physics was carving on. The lean now follows the physics (a 5.5 Hz spring, about 20 ms behind) with no 49° cap, and the skis show the physics edge. At an edge change the body crosses over once the old edge lets go, not before, so the hips never swing out past a ski that is still biting.
- **Angulation builds with the edge.** On skis the hips, spine and chest tilt back toward the outside ski by 15% of the lean on a flat ski, building to 45% past about 25° of edge, so a hard carve is legs inclined and shoulders nearer level rather than one tilted stick. The head now stays level with the horizon on snow. The outside leg extends and the inside one folds, about 12 cm of difference at 45° of edge.
- **Chest down the fall line.** The chest is now aimed from the fall line (30% of the way to the skis) on a 3.5 Hz spring, so it stays down the hill in short turns too. It used to follow the skis 60% of the way, slowly.
- **Snowboard stance.** The board rider had borrowed the skier's legs: a frog squat when cruising (85° of knee bend), sitting on the heels on the heel edge, and folded flat over the toe edge with the knees bent back and a hand in the snow. The board now has its own stance: hips over the middle of the bindings at a height set by the knee bend (about 35° cruising), the lean taken about the edge in use, knees over the toes and a little in, the torso leaning across the board (upright over the toe edge, chest over the knees on the heel edge), and hands kept above the snow. The board's roll now follows the physics edge (up to 57°, was capped at 41°).

### Added

- **Turn tests** (development). The real sim drives the real rider through linked turns on skis and on a board, and the test checks the angulation, the drawn edge and lean, the chest against the fall line, and the board stance on both edges.
- **Close camera in the rider lab** (development). `rider.html?sim&cam=back` (or `front`, `side`, with `dist` in metres) follows the rider with a close camera fixed to the direction of travel.

## 0.9.31 (2026-11-25): Physics tuning

Physics fixes from the 2026-11-25 playtest, measured with the new lab in `game/tuning/physlab.test.ts`.

### Changed

- **Faster tuck.** The tuck had more drag than a real one, so a straight run topped out at 134 km/h on 25° and the Chute's 151 km/h Pehota benchmark was out of reach. It now tops out near 160 km/h on 25° (120 km/h on 15°).
- **Edging takes time.** The edge rolled from flat to 50° in about 0.19 s, so a 200 ms key tap reached the full edge and washed out. It now takes about 0.28 s.
- **Keyboard edge by speed.** Keys are all or nothing, so keyboard steering now asks for the full edge up to 60 km/h, easing to 32° at 110 km/h. A tap at speed holds an arc instead of washing out. A stick or touch can still ask for the full edge.
- **Real hockey stops.** Stops were about 1.5 to 1.9 g and the same on every slope. They are now 0.64 to 0.83 g and take longer on steeps: from 50 km/h, 1.8 s on 10° and 2.2 s on 30°.
- **Softer short landings.** The legs soak up the first 2.5 m/s of a short hop's impact, so a clean little air no longer costs a big chunk of speed.

### Fixed

- **Steering at low frame rates.** A key tap was read once per frame and held for the whole frame, so the same tap turned about 12 times as far at 5 fps as at 60 fps. Keys now ramp on their real press and release times, so a tap turns the same at any frame rate.
- **Moguls comp airs.** A straight air off the top or bottom kicker shorter than 0.5 s scored nothing. In the moguls comp and aerials, every air over 0.25 s is now judged.

## 0.9.30 (2026-11-25): Race day fixes

Fixes from the 2026-11-25 playtest of the events.

### Fixed

- **Finish run-out.** Shoot the Chute and the Downhill froze the racer mid-air at 100+ km/h when the results came up. Now the clock stops at the line, the racer brakes to a stop, and the results show below 10 km/h (or after 5 s).
- **Stuck forever.** A racer stopped in the start gate or stuck in powder beside a course kept the clock running with no end. With the clock running, less than 3 m of progress down the course in 20 s is now "No progress: DNF".
- **False start.** The "False start" message was replaced by the count on the very next frame. It now shows for 1.2 s before the count starts again from 3.
- **Quick taps.** A key pressed and released between two slow frames was missed. Every tap now counts for at least one frame.
- **Moguls on the race line.** The Gunbarrel moguls sat on the Downhill line (20 takeoffs in one run). While a race runs, its track is groomed: the mapped moguls on it go flat and the snow rides as groomed, including the park ground at the top of the slalom. Free skiing keeps every mogul field.

### Changed

- **Out of the gate.** A racer who has not pushed off by GO skates out for the first 1.5 s. Holding the brake stays put.
- **No trick cards in races.** Downhill, slalom, GS, Match Your Time and the Chute are timed, so trick pop-ups and combos are off on the course.

## 0.9.29 (2026-11-25): Crashes stay on the snow

### Fixed

- **Crash arms.** After a crash the arm underneath lay about 25 cm inside the snow, and the top hand floated in the air. Both hands now rest on the snow beside the body.
- **Crash tumble.** In a hard crash the body cartwheeled around hips held near the snow, so the head and chest went up to 66 cm into it. The body now rolls over the snow instead.
- **Legs keep their boots.** The yard-sale could throw a ski further from the hip than the leg is long, leaving the shin hanging up to 25 cm off its boot. Thrown skis now stay within reach.

### Added

- **Rider clipping check** (development). A test poses the real skinned outfit in every rider lab pose and measures any cloth cutting into another body part or the snow, and fails if a change makes it worse. Another test checks every shin ends at its boot. `rider.html?clip` marks the clipping in red.

## 0.9.28 (2026-11-25): Chair 9 FM

### Changed

- **Controller:** D-pad right no longer restarts the run (use Pause, Restart); D-pad left and right now skip songs.

### Added

- **Radio.** A new music source with six joke songs about skiing (a sea shanty about a yard sale, T-bar blues, a power ballad for the singles line, flat-light pop punk, an après polka and a dubstep igloo party) and two instrumentals, shuffled with no repeats. Play everything, only the sing-along songs, or only the instrumentals.
- **Pocket player.** Press P (or the ♪ button, or R3 on a controller) to pull out a little MP3 player with the song, artist, progress, previous, play/pause, next, the playlist, a Lyrics button and a song list to pick any song in the game. `[` and `]`, or D-pad left and right, skip songs with it closed. Songs pause while a menu is open.
- **Sing-along lyrics.** The words fill in time with the song, low on screen while skiing and in a bubble by the rider's head on lifts. Turn them off on the player or in Settings, Sound.
- **Free songs.** Three CC0 tracks from OpenGameArt on the radio: Black Diamond (drum and bass made for a snowboarding game) and Funked Up by Joth, and Happy Synths by 3xBlast.
- **Synth songs.** Four named songs from the procedural music (Corduroy, Tree Well, Bluebird, Night Groom), each its own key and tempo, in the song list and skipped through with next and previous when the synth plays.
- **Tracks** now has two instrumentals: a calm one for lifts and cruising, a driving one for steeps and the park.

## 0.9.27 (2026-11-25): Rider legs in turns and pushes

### Fixed

- **Legs lean into the turn.** In a carve the shins leaned into the turn with the edged skis, but the hips stayed out over the boots, so the thighs leaned back the other way and every knee made a sideways Z. The hips now sit where the legs can incline with the skis (about 40 to 50 cm inside the boots in a hard carve), so thigh and shin lean in together. Through the edge change the legs swing across under the body instead of kinking.
- **Skating push.** The pushing ski now goes well out to the side on an extending leg, instead of sliding about under a standing body.

## 0.9.26 (2026-11-25): Rider legs

### Fixed

- **Knees bend like knees.** The leg solver let the shin bend sideways off the thigh (up to about 45° in a carve or hockey stop), so the trousers folded across the knee. The thigh now turns so the kneecap faces the bend and the knee is a true hinge.
- **No more permanent squat.** The rider stood with the knees bent about 85° all the time, so driving the knees into a turn swung the thighs out flat. The stance is now about 55° standing and 60° cruising, deeper as you crouch, carve or tuck, and the shins follow the boot cuffs.
- **Double-poling** pushes from the waist on fairly straight legs, with a knee dip on each stroke, instead of sitting into a squat.

## 0.9.25 (2026-11-25): UI and UX pass

### Changed

- A new look across the whole interface: frosted glass menus, white type, large light numbers and one orange accent.
- **HUD.** The run name and clock sit top left without a box. Speed is a large readout at the bottom left with a bar that fills to 100 km/h. Pause is a round button, and the controls hint fades back after 10 s.
- **Title screen.** A text menu with a short line under each choice, plus tiles for medals, runs skied and gold nuggets.
- **Pause.** The game blurs behind the menu. Toggles show On or Off, and the controls guide sits beside the menu.
- **Menus.** Runs and parks, Rider, Challenges and Settings share one header with a Back button (Esc). Settings is grouped into Graphics, Mountain, Camera, Controls, Sound and Assists.
- **Results.** A big time or score, a medal that pops in, then the stats and buttons.
- **Feedback.** Trick pop-ups show the trick, a landing grade, the points and the combo multiplier. The run card, tutorial card (with a lesson progress bar), park speed cue, race countdown and touch buttons match the new style.

### Added

- Arrow keys move through every menu, like the D-pad.

## 0.9.24 (2026-11-25): Apex events and competition mechanics

### Added

- Apex events, a new section at the top of Challenges, each with a line of real history and its rules. The course, gates, crowd and props appear only while you race that event, never in free ski.
- **Racing.**
  - A start gate for every race: 3, 2, 1, GO. Push just after GO for a fast start; push before it and the count begins again.
  - Gate grades: a carved pass close to the turning pole is **Tight** and gives a little speed, a skidded one gives none. The results count tight, clean and skidded gates.
  - The **racing line assist** (Settings, on by default): steer toward the next gate and it pulls you onto the arc round the pole. Steering away gets no help.
  - A **ghost** of your best run in each single-run race to chase. The split pop-ups show the gap to your best split.
- **Shoot the Chute**: from the summit down the Chute to the old upper parking lot. No gates, a radar on the steep lower pitch, and a crash is a DNF. The crowd and parked cars line the finish, and Eric Pehota's 151 km/h is the benchmark.
- **Apex Downhill**: the FIS Gunbarrel downhill, from the summit start house to the old upper lot.
  - Downhill gates with orange safety netting on the Gunbarrel pitch.
  - Split clocks at the top and bottom of Gunbarrel, plus a speed trap.
  - A missed gate disqualifies and a crash is a DNF.
- **Apex Slalom**: a "slalom factory" on Okanagan Run with tight gates, two runs and a combined time.
- **Teck Open GS**: red and blue gates down Old Mill to the timing hut.
- **Kristi's Moguls**: a new mechanic on the real Nor-Am course, a straight 220 m lane on Kristi's steady pitch.
  - Tap left or right on each bump and your skier holds the line.
  - Hit the beat (shown on the beat strip) and the speed climbs, so the bumps come faster. A miss drops the speed back, and three in a row and you are out.
  - Trick off the top and bottom airs.
  - Judged out of 100: turns 60, air 20, speed 20.
  - The bumps are laid on Kristi's only while the comp runs.
- **Aerials** at the Aerial Site, switched to its aerial layout for the event only. Your two best jumps count, each scored as degree of difficulty (flips, spins, a grab) times form (the landing).
- **Match Your Time** (the 50th anniversary race): ski Maverick twice. The score is the difference between the two runs.

### Fixed

- Starting a challenge from a chair no longer leaves the camera at the lift.

## 0.9.23 (2026-11-25): Runs pass B (glades, moguls, grooming, summit landmarks)

From the Apex research handoff (`docs/review/apex-terrain-handoff.md`, `run-profiles.json`).

### Added

- Four glades from the 2025/26 trail map: Any Which Way Glades, Granny's Glades, Fools Gold and Hidden Gold (`world/glades.ts`, polygons from the handoff). Their trees are thinned into open lanes about 7 m wide down the fall line, with clumps between; about 40% of the trees stay. Each glade has a trail-head board at its top, shows its name in the HUD and on the map (hover and click inside it), and a map trip starts you at its top. The forest outside the glades is unchanged.
- Moguls on Sunbowl, Make My Day, Old Mill, Gunbarrel and K2, as seen in the footage; wide runs (Sunbowl, Old Mill, K2) get five to seven mogul lanes instead of three.
- Chop on Crusher and Hanks: ungroomed, lower and looser bumps (about 0.2 to 0.4 m) instead of corduroy.
- Grandmother's Trail is packed, skier-tracked snow: groomed underfoot, no fresh corduroy (a flag in the surface mask's spare blue channel).
- Orange slat snow fencing round the Quickdraw top where the plateau rolls over into steep ground, kept off every run, lift line and the Pit cliff; and the Tooth/Tusk wooden signpost at the top of Tooth Tusk, arrows left to Tooth and right to Tusk. Both are solid.
- Tests against the handoff's LiDAR run profiles: every profiled run is found on a line of the same length, pitches agree within 0.5°, run corridors stay inside the measured clearings, tree-lined runs keep at least half of theirs, and runs where the footage saw moguls have them (`tests/runProfiles.test.ts`). Pass B tests check glade density and lanes, mogul and chop heights, corduroy and the landmarks (`tests/runPassB.test.ts`).

### Changed

- Dawdler 1 is narrower (23 m open in the LiDAR; the blue-run default cut 39 m into its trees).
- Mogul meshes are split into chunks (384 m on Low, 256 m above) drawn only near the camera (170 m on Low, 260 m Medium, 340 m High), and use 40 instead of 84 triangles a bump on Low. The physics keeps every bump.
- The padded lift towers were already in `lifts.glb` (orange pads on Quickdraw, yellow on Stock's); a test now keeps them there.

## 0.9.22 (2026-11-25): Adaptive music

### Added

- Adaptive music, on by default and made in the browser. It follows how you ski: ambient pads on lifts, in menus and standing still; a mellow beat when cruising; four-on-the-floor drive with 16th hats and tom fills on steeps and at speed; a broken beat with chord stabs and a shaker in the park, in the air, on rails and after tricks. One key and tempo per session, changes land on bar lines, and speed opens up the sound inside each mood.
- Settings: Music on or off, Music source (Procedural or Tracks) and Music volume, saved with the other settings. The music ducks under crashes and hard landings and pauses while the tab is hidden.
- The Tracks source plays open-licence tracks listed in `game/public/audio/music/tracks.json`, loaded only when picked. No tracks are bundled yet, so it plays the procedural music until some are added.

## 0.9.21 (2026-11-25): Lifts and the Gunbarrel modelled from photos

### Added

- The lifts are modelled in Blender from Liftblog photos (`tools/blender/build_lifts.py`, `game/research/scenery-references.md`):
  - Quickdraw: open galvanized quads with slatted benches, bars and footrests; grey tube towers with orange base pads, walkways and sheave trains; early Doppelmayr Uni terminals with the rounded white housing and tinted glass band, operator huts, signs, rope fencing and the antenna mast.
  - Stock's: Müller triples with the loop back, the A-frame drive cabin on splayed legs at the top, the green portal return with its counterweight at the bottom.
  - T-Bar: the blue counterweight column painted with snowflakes, the yellow bullwheel, yellow lattice portal towers, the top portal and lookout hut with the run board.
- The Gunbarrel Saloon is modelled on its OSM footprint: brown board-and-batten walls, two glazed front gables with log trusses, a porch, the log-railed deck with picnic tables facing the slope, string lights, the round GUNBARREL sign, a flag and a stone chimney (`tools/blender/build_buildings.py`).
- The Apex Mountain Inn is modelled too: ochre lap siding over a stone base, framed windows on four storeys, staggered timber balconies, cross gables over the wings, chimneys.

### Fixed

- Groomer tracks are two clean carve lines, one per ski, instead of one wide track: the snow stamp paints a groove under each ski (a skid still smears them into one scrape), and on Medium and High the crisp ribbons now show on firm snow, fading only where the deep-snow trenches are (Stu's playtest).
- The Blender rider's ankles no longer fold sideways in turns: each knee aims up its boot cuff, so the shin rolls onto the edge with the boot and the knee angulates into the turn (Stu's playtest).

### Changed

- Scenery models load alongside the world data; the code-built lifts and building shells stay as the fallback.
- Lift and building models are reviewed in Blender from four sides (`tools/blender/review_scenery.py`), drawn one-sided as the game draws them.

## 0.9.20 (2026-11-24): A rider built in Blender, with jacket styles

### Added

- The rider's body is a skinned model built in Blender (`tools/blender/build_rider.py`, exported to `game/public/models/rider.glb`), bound to the same joints the animation already drives, so carving, tucks, grabs, rails, crashes and lift poses all carry over. Fabric has baked folds, seams, zips, stitching, quilting and knit, plus soft ambient occlusion; every palette colour still works through a colour mask.
- Styles in Rider & gear: jackets (shell, park rat tall-tee, racer, hoodie, puffer), pants (baggy, slim, race), gloves (mitts, gloves, pipe gloves) and headwear (helmet, beanie, cap). Other skiers on the hill pick random styles.
- Cloth physics: the jacket hem, folded hood, hoodie drawstrings and beanie pom swing toward the apparent gravity the rider feels plus the airflow, so they hang straight down in a tuck, stream back at speed, swing forward on a hard stop and float up in the air. Loose fabric (hems, cuffs, baggy legs) ripples in the wind at speed. The backpack bounces. Wrists bend toward the poles.
- Snow sticks to the clothes: a crash packs it on in patches on the side that hit (more for a harder fall), and skiing deep powder cakes the legs from the boots up, higher in deeper snow. Crash snow fades over about a minute, faster at speed; leg snow clears about 25 seconds after leaving the powder. `rider.html?snow` shows it.
- Two look passes on the model, reviewed from all sides in Blender renders (`tools/blender/review_rider.py`): high funnel collars on the shell, racer and puffer; chest, shoulder blades, sloping shoulders and a waist on the torso; a back hem that hangs lower; seat, thighs and kneecaps on the pants with stitched knee panels; framed goggles with a nose cut-out and a strap; a smoother helmet brim; a folded hood lying on the back; a snugger gaiter; hair under beanies and caps; deeper folds at the elbows, knees and hips; a soft fabric sheen and shinier zips.

### Changed

- Each rider draws 31 meshes and about 15k triangles instead of 75 and 21.3k. The old code-built rider stays as a fallback while the model loads, if it fails to load, and with `?noskin`.
- The Fit choice (baggy or slim) became the Pants style; saved outfits carry over.

## 0.9.19 (2026-11-24): Deep snow that keeps up, quieter poles

### Fixed

- Deep snow lagged and appeared in chunks behind the skier: the 0.9.16 partial texture uploads passed multi-row ranges, which three.js uploads as one row, so WebGL rejected them and the trenches only reached the GPU when the whole texture refreshed. Uploads are now one range per changed row (`fx/rowUpload.ts`, tested). The ski-track stamp had the same bug and the same fix.
- Trench walls no longer render as jagged grey rock: steep-rock and scour rules read the ground's own slope, not the trench walls.
- The white ribbon tracks no longer float over the trenches; they hide where the deep-snow patch draws (Medium and High) and stay on Low.

### Changed

- Trenches sit in a soft blue shade and berms catch a little more light, so tracks read in flat light.
- The pole plant is a soft low tick, nearly silent in powder, and the edge-change thump under it is gentler (Stu: far too loud).

## 0.9.18 (2026-11-24): Run pass A, names and layout from the Apex research

### Added

- Five upper Quickdraw south-face runs from the research handoff (`docs/review/apex-terrain`): Toilet Bowl, Essendale Ward 1 and 2 (blacks), Tooth Tusk and Sweet Sue (double blacks). Ungroomed. Lines are LiDAR fall-line drafts placed in the trail-map order Stu confirmed, so each may be off by a gully.
- Wildly Easy, a blue on the Wildside.

### Changed

- Wildside traces named: Jackpot, Gun Slinger, ShootOut, Showdown (order confirmed by Stu); the two westmost are Any Which Way Glades. L3 is Chaser.
- Gambit, Spruce Hollow and Hang 'em High split into Upper and Lower runs at their junctions, as the grooming report names them. Upper and Lower Wishbone are one blue Wishbone. Grandmother's Trail is blue.
- Traces with no known name are "Unnamed cut L…" and stay out of run challenges.
- Saved medals, bests and the run checklist follow every rename; results for a whole split run carry to its upper part.

## 0.9.17 (2026-11-24): Arrivals, unloads, parks and rider feel

### Changed

- Free ski starts on the Quickdraw chair, a few seconds from the top: you ride in, stand up and ski off. A chair is lined up for you, so you always arrive seated.
- Lift arrivals hold a camera shot beside the top station's exit instead of following you through the terminal (which used to hide its roof and walls), then ease back to the follow camera without a cut.
- T-bar and Magic Carpet unloads: hold on to the top, let the bar go round the bullwheel, drift aside away from the lift line and stop, then pick your own way. Every unload turns toward open ground, so the carpet no longer drops you facing an apartment block.
- Deep snow: trenches appear under the skis at once (the sim still packs its own copy a moment later), with smoother walls (8 cm field, finer patch: 0.12 m on Medium, 0.1 m on High) and wider, more natural ski tracks.
- Rider: a forward tap at cruising speed (18 to 40 km/h) is a double-pole push that adds speed; holding forward settles into a tuck after a third of a second, and the tuck deepens with speed. The body now leans against gravity rather than the slope, so it stays plumb on traverses and no longer over-leans into banked turns.
- Parks: the old "Prospector" OSM park is the Aerial Site. Prospector is the blue run beside Claim Jumper (trace L2) with its own park: rails, boxes, a quarter-pipe step-over and jump lines. Claim Jumper is the XL line: a straight shot through ever bigger tables up to a new Pro gap. Every station in the named parks offers two or three features.

### Fixed

- The Magic Carpet follows the ground in 2 m pieces; it was one level box floating over half its length.
- Distant windows no longer flicker: antialiased edges, fading to the average wall and glass colour when a window is a few pixels wide.

## 0.9.16 (2026-11-24): Deep snow, West Bank and The Pit, runs that fit

### Added

- Deep snow: skis cut trenches as deep as they sink and push the snow into berms beside them; skids plough a wide swath and a crash leaves a crater. Medium and High draw it as real geometry in a fine patch around the player (`world/snowDeform.ts`, `render/terrain/snowPatchView.ts`). On every level the sim reads it back, so your own tracks are packed, shallower and a little faster.
- West Bank is an ungroomed mogul run under Quickdraw, wider, with a rock drop beside the Quickdraw tower closest to the run.
- The Pit is an ungroomed big-mountain face: a big cliff where it rolls over at the top and a rock band with chutes through the steep middle. Drops are solid rock you ski onto and launch off (`world/cliffs.ts`); trees stay off them and their landings.

### Changed

- Run corridors follow the real LiDAR clearings: runs widen into open ground beside them and give standing forest at their outer edge back to the trees (`world/runEdges.ts`).
- Edge saplings only grow at a true run edge, so no more small trees in the middle of runs where runs merge (the Quickdraw base and elsewhere).
- Corduroy leans toward the fall line on runs that head downhill; traverses keep their heading.
- Windows have light trim, a centre mullion, sky reflections and some blank bays instead of one uniform grid.

### Performance

- Ski-track stamp uploads only the rows painted each frame (a few KB instead of 1 MB).
- Forest chunks switch detail with 30 m of hysteresis, so a camera at the boundary no longer refills every near tree each frame.
- Terrain detail streaming skips its per-frame bookkeeping when nothing changed.
- Shaders compile at load (`compileAsync`), not on first sight mid-run.
- three.js ships as its own cached chunk.

## 0.9.15 (2026-11-24): Summit, towers and windows

### Fixed

- Windows on every building again. Since 0.9.4 the far level of detail had none, and it was picked by distance to the village centre, so the summit hut and outlying buildings never showed windows.
- One building on the summit: the Billy Goat Hut now sits on its OSM footprint, and the duplicate shells around it are gone.
- Peak names no longer hang overhead behind the HUD when you stand on the summit (hidden within 150 m).

### Added

- Telecom towers on both peaks: a lattice tower and a monopole with equipment cabinets on the south side of the Beaconsfield summit (solid), and an antenna farm (two lattice towers, a monopole, cabinets) on Apex Mountain to the south. One merged draw call.

## 0.9.14 (2026-11-24): Terrain blending

### Changed

- Summit wind-scour follows the terrain instead of a noise pattern above 2100 m: a wind-exposure field (`world/exposure.ts`) from ridge shape, slope, aspect to the prevailing wind, elevation (fading in from 2040 to 2150 m) and tree cover. Ridges and windward faces scour; plateaus, hollows and lee slopes keep their snow.
- Crust and rock blend per pixel with warped, rotated noise, so patches have organic edges instead of 2.5 m square texels. Rock breaks through as boulder clusters on gentle ground and as slabs on steeper ground, dusted with snow on ledges and in cracks.
- Wind crust replaces the flat blue ice: grey-white with sastrugi ridges, glazed patches and grit near outcrops.
- Steep-slope rock shows as ragged outcrops instead of a smooth fade.
- Corduroy cross-fades where runs with different grooming directions meet, instead of switching in 2.5 m steps.
- Skiing: the sim reads the same exposure field, so crust skis like ice and exposed rock is a new slow, chattery `rock` surface. New coach tips for both.

## 0.9.13 (2026-11-24): Edge saplings and summit wind-scour

### Changed

- Short edge saplings (<4 m, no trunk collision) plant just inside clear run corridors on Medium+ density.
- Summit powder above ~2100 m ASL scours to ice/rock patches for wind-blown look (groomed runs left alone).

## 0.9.12 (2026-11-24): Modest Saloon and lodge hero pass

### Changed

- Gunbarrel Saloon and Apex Mountain Inn get preferred gables, barn-red / yellow walls, thicker eave snow, near porch lips, wall boards, and chimneys (existing shells — not a photo rebuild).

## 0.9.11 (2026-11-24): Ragged run edges and deeper moguls

### Changed

- Run edges use a stronger wobble band and a third noise octave so corridors read less ruled.
- Mogul fields: taller crests (~0.5–0.94 m), slightly wider spacing, mesh casts shadows (no-op on Low).

## 0.9.10 (2026-11-24): T-bar, Magic Carpet, and maze hint

### Changed

- T-bar: blue drive house at the bottom, yellow return + lookout at the top, portal towers, shorter yellow hangers.
- Magic Carpet: wider belt, side rails, end ramps, light clear cover over mid-span.
- Quickdraw bottom: short orange load corral (maze hint).

## 0.9.9 (2026-11-24): Thicker village roofs and place boards

### Changed

- Gable roofs: deeper overhang, lifted snow load, near-only soft snow cap and chimneys.
- Flat roofs: snow slab 0.35 → 0.55 m; fascia still under the load.
- Named village places get timber trail-style boards at ground (floating labels kept for distance).

## 0.9.8 (2026-11-24): Stock's terminals and lift polish

### Changed

- Stock's Chair falls back to a triple when OSM omits occupancy; Quickdraw to a quad.
- Stock's gets open green bottom returns and a grey-green top drive cabin (not Uni hoods).
- Quickdraw Uni hood a touch rounder; galvanized chair/tower metal slightly brighter.

## 0.9.7 (2026-11-24): Heavier tree snow and summit ghosts

### Changed

- Summit species mix leans harder into snow ghosts (short and tall stands above ~2080 m).
- Near spruce / fir / krummholz carry thicker branch snow; compact LODs match.
- Far stand-in needles and frost tint read whiter from the air (no extra draw calls).

## 0.9.6 (2026-11-24): Wider groomers and lift clearings

### Changed

- Groomed half-widths: easy 22 m, intermediate 20 m, advanced 15 m (ungroomed / expert unchanged).
- Lift-line clearance half-width 12 → 14 m; terminal clear 18 → 20 m (ragged edges kept).

## 0.9.5 (2026-11-24): Safer main / rider module split

### Changed

- Pulled Auto graphics cap helpers and graphics-fail UI out of `main.ts`.
- Rider update: Spring, double-pole, crash yard-sale pose, and chair sit pose live in their own modules (behavior unchanged). Deeper ski-pose split deferred as too risky for a silent refactor.

## 0.9.4 (2026-11-24): Building LOD and longer High shadows

### Changed

- Buildings swap to a cheaper far shell (no window shader / fascia) past ~340 m from the village cluster.
- `findLots` stamps a near-building mask instead of scanning every cell against every footprint centre.
- High quality shadow box half-extent 110 → 160 m (map size unchanged; 0.9.1 village/forest budgets kept).

## 0.9.3 (2026-11-24): World gear pickups

### Added

- Hard crashes (about 12 m/s+) leave skis/poles (or board) on the snow; ski over them to re-attach. Soft crashes keep the visual gather only.
- Coach tip while gear is still out; awkward glide until skis are back; failsafe auto-collect after ~14 s.

## 0.9.2 (2026-11-24): Sample layers and near-miss feel

### Added

- Bundled plant / landing / latch WAV ticks under `public/audio/` (replaceable recorded takes).
- Flat-light HUD cue when that weather preset is selected.
- Near-miss NPC whoosh + soft rumble; bump contacts share a lighter cue.
- Rail nose/tail press counterbalance arm poses.

## 0.9.1 (2026-11-24): High LOD and village draw budgets

### Changed

- Village props: Low hut-only, Medium thinned cars (no patio/spindles, no prop shadows), High full; cars/decks distance-cull past ~420 m.
- Texture anisotropy follows quality (2 / 4 / 8, capped by the GPU).
- Crop forest plant density scales with quality; Medium apron forest reach trimmed; High terrain detail ring widened.

## 0.9.0 (2026-11-24): Feel depth and High load cuts

### Added

- Optional one-shot WAVs (`public/audio/plant.wav`, `landing.wav`, `latch.wav`) layer on procedural plant/landing/latch ticks; missing files keep procedural-only audio.
- Weather gust pulses: wind and fog breathe on top of the selected preset (stronger in storm).
- Idle / cruise hand and pole sway when standing still or soft-gliding.

### Changed

- Low quality skips village cars and decks (hut shells stay); Medium/High keep full village draws.
- Workplan and status aligned through the 0.8.13–0.8.17 overnight patches and this 0.9.0 feel pass.

### Still open

- Full world-space gear pickups (#61); heavy `main.ts` / rider update split; deeper High LOD beyond village lite; recorded sample files themselves (infra only until WAVs land).

## 0.8.17 (2026-11-24): Crash recovery

### Changed

- Crashes tumble along the impact heading; yard-sale gear gathers back in the last half-second before get-up.
- Building and trail-sign hits use the same `beginCrash` path as trees (washout tip-in crash still rejected).

## 0.8.16 (2026-11-24): Park approach assist

### Added

- Soft camera look hint toward the next jump or rail ahead; HUD cue for approaching rails/boxes.

### Changed

- Multi-lane parks: wider lane spacing (9 m) and Claim/Okanagan/Prospector half-width 28 m.

## 0.8.15 (2026-11-24): Map trips and rail language

### Added

- Trail map and HUD minimap: hover tip shows the run/park name near the pointer; click trips (teleports) onto that run or park.

### Changed

- Rail entry crouch→hop-extend; softer step-off dismounts; nose/tail press click + rumble.
- Plant/edge SFX tightened; washout tip-in crash stays rejected.

## 0.8.14 (2026-11-24): Powder float and plow

### Changed

- Deep snow planes into a float at speed, plows when sunk, and softens yaw until a bounce unweight opens the turn (Steep-style).
- Light pops in powder bounce instead of jumping out; hard edge load in powder no longer washes into a tip-in crash (0.8.12 rule kept).
- Powder landings cushion imperfect touchdowns; face-shot spray, thicker contact audio, soft rumble, and a bounce bob on the rider.

## 0.8.13 (2026-11-24): Landing leeway

### Changed

- Upright, lined-up landings get more equivalent-fall-height headroom before a bail; big stomps scrub speed as sketchy instead of wiping out.
- Short hop / bump landings stay soft a little longer; big graded landings absorb more through the legs.
- Rail hop-on capture is wider (reach, height window, align).
- Pole plant fires on steer flip so the hand leads the turn; edge flip still unweights the legs.
- NPC mutual wipeouts need a harder closing hit; light brushes still bump.

## 0.8.12 (2026-11-23): Washout no longer crashes

### Fixed

- Hard turns on steeps no longer tip into a crash from a short washout. Washout only softens grip and chatters again (0.8.11 catch-an-edge tip-in removed).

## 0.8.11 (2026-11-23): Sense of speed and crash feel

### Added

- Gamepad dual-rumble from edge chatter, landings, rail latch and crashes (Settings → Camera shake & rumble; respects reduced motion).
- Follow-camera field of view widens with speed (more in a tuck); off with camera shake or reduced motion.
- Pole-plant tick and edge-set scrape when the edge flips at speed; stereo pan on contact/plant; lift tower clunks while riding; low wind ambience bed.
- Crash entry speed scales how long you stay down, how far you slide, and how sprawled the pose is. Fast crashes tumble then yard-sale the skis.
- Weather presets in Settings: Bluebird, Light snow, Storm, Flat light (snowfall, fog, sun and sky).
- Pole plant loads the planting shoulder; landings flare the arms; deep carves drop the inside hand.
- Soft collisions with other skiers (bump or mutual wipeout at high closing speed).

### Changed

- Wind and snow contact keep rising through tuck top speed instead of flattening at ~80 km/h; wind brightens in the air and tightens in a tuck.
- Tuck drag area raised (0.30 → 0.42 m²) to bring recreational top speed down.
- Tree wipeouts use the same crash path as failed landings.

### Still open

- Full yard-sale collect / get-up, stereo village/lift ambience samples, High load-time profile, splitting `main.ts` / rider update.

## 0.8.10 (2026-11-23): Fullscreen menus and park lines

### Added

- Runs, parks, rider, settings and challenges open as fullscreen menus on large screens, with a tighter stacked layout on phones.
- The Runs & parks screen has an interactive trail map: click a run or park on the map, see it highlighted, and ski it from the detail card.
- Rider & gear shows a live 3D standee of the current outfit beside the colour and kit controls.
- Terrain park layouts can place side-by-side feature rows so you choose a lane.
- Park-specific lineups for Claim Jumper, Prospector, Okanagan Park and Little Nuggets.

### Changed

- Claim Jumper keeps its OSM centreline (peels skier's right off Okanagan); spawn still starts a little way down the park line.
- Unnamed OSM park ways are named by way id: longer T-Bar-side line is Okanagan Park, the other is Prospector.
- Park score targets count every feature in a lane row.
- Official spellings: West Bank, Kristi's Run, Greenhorn Traverse. Billy Goat Hut now has a place label at the Quickdraw summit.

## 0.8.9 (2026-11-23): Terrain park and mountain polish

### Added

- Standard gamepad support for skiing, freestyle and menu navigation. The Escape menu now includes keyboard, controller and touch guides with explanations for jumps, grabs, presses and slides.
- Terrain parks have signs at entrances and features, a distance-to-lip and speed gauge on approach, and a balance meter on boxes and rails. Score attack results show landing grades, slide distance and best trick. Box contact, rail contact and landings have distinct sounds.

### Changed

- The title screen, HUD, pause menu, side panels and results share a new visual design. The compact HUD keeps readouts clear beside the minimap on narrow phones.
- Powder varies in depth across the mountain. Deep snow slows and sinks the rider more, throws more spray and leaves deeper tracks. Irregular moguls have distinct uphill and downhill faces and shallower snow on their crests.
- Trees leave more room between trunks. Glancing hits can slide past, and recovery after a hard hit looks for a clear downhill route. Graphics tiers share the same collision trunks, with simpler nearby trees on Low.
- Ski and snowboard boots and bindings have separate shapes. The rider's jacket has fabric texture, a reshaped hood and a hem that follows the body through jumps and grabs.
- Lower-angle sunlight helps define the snow surface, and the rider has a soft ground shadow when the shadow map is off.

## 0.8.8 (2026-11-23): Graphics that fit the machine

From 0.8.7 failing to draw on Stu's older Intel MacBook: Chrome lost the WebGL context and then switched WebGL off for the browser, leaving menus and sound over a blank screen.

### Added
- Auto graphics read the graphics chip and start at a level it can run: Low for older Intel graphics, software rendering and phones; Medium for Iris Xe, older dedicated laptop chips and anything unrecognised; High for Apple silicon and current NVIDIA, AMD and Intel Arc cards. Settings shows the reason next to Auto.
- If Auto still runs under 24 fps while skiing, it lowers the resolution and turns shadows off straight away, and starts a level lighter next time on that machine.
- A graphics chip reset (WebGL context lost) shows a message and a Reload button and steps Auto down a level. If the browser has switched WebGL off, the game says so and explains that restarting the browser clears it.
- `?turns=wide` offers wider turns at speed for playtesting. Classic steering remains the default.
- Pull requests to `main` now run the game tests with Apex data, build the game, and validate the OpenStreetMap export.

### Changed
- The close-up snow detail added in 0.8.7 (fine relief, worn groomer patches, wandering run edges, forest debris) is off on Low.
- Apex height grids support lossless packed downloads. The browser can also load the original grids.
- Snowboard poses now show distinct toe-side and heel-side turns, an updated tuck and ollie, and grabs that release with the input. The rider lab can replay these moves.

### Fixed
- The keyboard tip for skipping the Quickdraw lift ride now shows Enter.

## 0.8.7 (2026-11-23): Review fixes

From the visual review of 0.8.6 (`docs/review/apex-visual-improvements.md`).

### Fixed
- Trees no longer ghost in front of the camera. Trees fade only where they block the line from the camera to the skier, so the forest around you stays solid. The last 1.6 m in front of the lens still clears.
- The landing ring no longer floats in the first-person view.
- Official run spellings from the Apex trail map: Dude-Ney Trail, Gromit, Dawdler 1 and 2, Highway 97, Peashooter. Saved medals, bests and checklist progress carry over to the new names.

- The orbit view's minimap names the place the camera is looking at and draws a sight line from the camera to it (#48).

### Added
- Demo park: a 2.6 km, 12° practice run off the Apex map with 24 features in a progression line, from rollers and small tabletops through boxes, flat, down and flat-down rails and a step-down to two XL jumps. Open it from the runs menu (T) under Terrain parks, or with `?demo`. Picking any Apex run, park, challenge or the tutorial takes you back.

- Out-of-bounds line: orange bamboo poles and a sagging rope along the OSM ski-area boundary, open where roads cross, with "Area boundary / Closed beyond" signs every 220 m facing into the resort. Like the real rope, it does not stop you (#68).

- Trail-head signs are timber boards on two posts with a cap rail, painted with the run's difficulty symbol and name, facing skiers coming from above. The floating name label now only shows from 60 to 260 m away to help you find runs; up close you read the board (part of #36).

- Snow detail: fine wind-pressed relief within about 70 m of the camera (stronger in powder), run edges warped by noise so the border between groomed and powder wanders, worn patches on groomers where the corduroy fades and faint skier streaks show, needle and twig debris under the trees, and a broad brightness drift so far slopes are not one flat tone (part of #69).

- Summit windsock (red and white, as on the summit webcam) and three flag poles behind the Quickdraw top terminal, swinging in a slow gusting wind (#45).

### Quickdraw
- Chairlift hardware modelled on Quickdraw, a 1994 Doppelmayr-CTEC detachable quad. Towers are galvanized tapered tubes with a crossarm, a four-wheel sheave train under each rope, a ladder and a railed walkway. Chairs are galvanized quads with a hanger that bends back over the seat, four seat and back pads, and a lowered safety bar with a footrest. Terminals are long detach housings under a rounded light hood, open underneath, with an operator hut by the loading area, each facing down the line. The housing hides while the camera is inside it, so boarding and unloading stay clear (#26, #27). Stock's uses the same towers and chairs as a triple for now.

### Rider
- Head: an open-faced helmet with vents and a back shell that drops over the ears, cylindrical goggles at eye level wrapping the face, a goggle strap round the back in the jacket accent colour, and the gaiter pulled up to the nose so the nose and cheeks show. Before, the face was a grey cylinder with the goggles floating above it.
- Boots: a light shell with a toe box, an instep and a forward-leaning cuff, a dark spine and heel, four buckles with levers on the outside, and a power strap.
- Pants: a flat, shaped knee panel instead of a lump, and cargo pockets on the thighs.

### World
- Wider groomers: run width now depends on grooming as well as difficulty. Groomed greens are about 40 m across, groomed blues 36 m, and ungroomed runs and the steeps 18 to 22 m (#11).
- Lift lines are cut 24 m wide with a ragged edge, up from 18 m, and an 18 m circle round each terminal is clear of trees (#13, part of #24).
- Trees are capped at 35 m (LiDAR picks up towers and roofs as canopy), and trees above 2060 m at 11 m, which should remove the spire behind the summit hut (#25).

### Changed
- Shadows are now Auto, On or Off (Settings → Shadows). Auto turns them off on Low graphics, which phones use, because the shadow pass is the largest single cost there. Saved settings move over: On becomes Auto.
- README, status and roadmap brought up to date for 0.8.6, with the next five phases.

## 0.8.6 (2026-11-22): Turns that read right

From Stu's playtest of 0.8.5: turning still felt off, and the rider looked wrong both mid-turn and between turns.

### Fixed
- Steering from a full traverse: with the skis across the hill (100° off the fall line), steering the other way could do nothing. The sim measured the shortest way round to the opposite traverse, which goes uphill, and refused to turn against the stick. It now works in angles from the fall line, so the skis come back down through it. A regression test covers this.

### Changed
- The body leans for the turn you are really making: the path's curvature times speed is the sideways acceleration to balance. The carve model's load missed pivoted and skidded turns, so at 34 km/h on a 50° edge the rider stood nearly upright over tilted skis. Lean is capped at 49° and tracks the turn about twice as fast as before, but the edge change still takes about 0.3 s, not a flick.
- Less counter-tilt at the hips and back (about half), so the upper body leans into the turn instead of staying level over the legs.
- The ski tilt is the body lean plus a little knee angulation. Skis no longer sit at 45° under an upright body.
- In a turn the inside hand reaches forward and down toward the next plant, and the outside hand stays wide.
- Rider lab: `rider.html?sim` runs the real ski sim through linked turns behind the follow camera, with `pitch`, `period`, `cap`, `fov` and `style` options and `window.__step(frames)` for frame-by-frame review.

## 0.8.5 (2026-11-22): Steady camera, poles and lift unloading

From Stu's playtest of 0.8.4: turns still felt laggy with the camera swinging, the arms and poles and the flat push needed work, and skipping a lift should show you getting off at the top.

### Added
- Camera follow setting (Settings → Camera follow). **Steady** is the new default: it looks down the hill and lets the skier swing across the view, like a follow-cam filmer, and only turns quickly when you traverse well away from the fall line. **Tight** is the previous camera, which turns with the skis. In simulated linked turns on a 15° slope the steady view swings 24° while your path swings 77° (the tight camera swings the full 77°).
- Getting off the lift: at the top you stand up off the chair (or let go of the T-bar) and glide down the unload ramp, then you have control at a standstill, facing on from the lift, with the HUD reading "Top of Quickdraw". Skip now jumps to about two seconds before the top so you see the arrival; press it again to step straight off.
- Double-pole push: below about 8 km/h with forward held, the rider reaches both poles forward, plants them, drives the hands down past the hips with a crunch of the back, and swings through. Skating takes over as speed builds.

### Changed
- Pole plants: the tip reaches ahead of the boots at the edge change, stays where it struck the snow while you ski past it, and lets go once it is behind you.
- Arms carry a little higher and wider, and the pole tips ride just off the snow behind the boots instead of up in the air.
- Poles shorten slightly when planted close in, so the tips no longer push through the snow.
- Chairlift terminals are a slim column with the bull-wheel housing above the rope, so arriving riders and the camera pass underneath instead of into a low roof.
- Skipping keeps you on a chair: the jump is a whole number of chair spacings.

## 0.8.4 (2026-11-22): Rider model and animation pass

### Added
- The version number shows in the corner of the in-game HUD, so a tester can see which build is live.
- Skating: below 18 km/h with forward held, the rider skates in a V. The pushing ski angles out on its inside edge and recovers, the weight moves over the gliding ski, and the arms and poles swing in time.
- Snowplough: braking below about 22 km/h brings the tips together and the tails out on their inside edges. Faster braking is still a hockey stop.
- Idle: standing still, the rider shifts their weight, breathes and looks around.
- Rider lab: `rider.html?pose=tuck,carve-left` shows only those poses, for close-ups. Snowplough and Skating poses were added.

### Changed
- The rider is split into `skierModel.ts` (meshes and rig) and `skierView.ts` (animation), as the roadmap's engineering track asked.
- Two-part back: the spine and chest bend separately. A deep crouch or a tuck rounds the back, and the racing tuck now has a near-flat back, hips back, fists in front of the chin and poles under the arms.
- Turns: the hips, spine and chest angle back against the inclination, so the legs lean into the turn while the shoulders stay near level. The head turns toward where you steer. At each edge change the legs extend to release the old edges, then flex into the new turn.
- Motion uses damped springs instead of plain easing. A landing sinks past the absorb and comes back up, a takeoff extends, and turn transitions swing through and settle.
- Crashing, getting up, rail entry and getting on or off a lift crossfade from the previous pose instead of snapping. Going down takes 0.16 s and getting up 0.55 s.
- Model:
  - Rounded shoulders, elbows and knees, so the joints don't show gaps.
  - A cinched jacket hem, where it was a flat bell.
  - A collar, a chest pocket and glove gauntlets.
  - A pole strap and a second boot buckle.

## 0.8.3 (2026-11-22): Fixes from the 0.8.2 playtest

From the headless playtest in PR #3 (`docs/review/playtest-0.8.2.md`).

### Fixed
- Braking over moguls no longer backflips you. Leaving the snow without a pop (a mogul, a lip, a drop) with pitch already held, usually Down as the brake, does nothing in the air until you let go and press it again. This is the same rule as rails. Popping with pitch held still flips as before (B1).
- Combo farming: only a trick that is new to the combo and scores at least 100 points raises the multiplier. A string of small ollies or the same trick again adds its points but no extra multiplier. The playtest's ×5 for flat ollies is now ×1 (B2).
- `?at=` spawns title the HUD with the run underfoot instead of "Grandfather's Trail · from Quickdraw" (B3).
- T-bar: the base terminal is now a post with the bull wheel and a small hut to one side, so the follow camera no longer starts inside a box and under a roof. Moving hangers pull the rider, who stands under the up rope beside a hanger. Towers are 7 m (were 11 m, like the chairs). While riding, the HUD reads "Riding T-Bar" (B4, B5).
- Running into a building moves you back outside the wall, so getting up is no longer another crash. Below 15 km/h into the wall you slide along it instead of crashing (B6).
- A rail you come off early reads "(slipped off)" instead of "(fell)", since you are still on your feet (B8).

## 0.8.2 (2026-11-22): Smaller jumps, quicker turns

From Stu's first playtest of 0.8.1: jumps launched far too big and turning felt laggy. Measured with `tuning/feel.test.ts` (now part of `npm run tune`) before changing anything.

### Changed
- Pop: 1.0 to 2.4 m/s (was 1.2 to 3.0), and popping while a kicker is already lifting you adds less (scaled by 1 − rise / 5 m/s, at least 0.35). A timed pop on the medium kicker at its sign speed used to quadruple the height above the lip (0.35 to 1.39 m); with the new lips it now peaks at about 0.55 m. A full pop on the flat is about a 0.3 m ollie.
- Kickers: lips 6° lower (small 10°, medium 16°, large 20°, XL 23°) and landings 2° gentler. With a pop at the sign speeds, flights peak 0.4 to 1.1 m above the lip (were 1.4 to 2.1 m), and the speeds you can land cleanly are wider. The signs now read small 20 to 30, medium 20 to 35, large 20 to 40 and XL 25 to 50 km/h. Coming in well above those still overshoots the landing.
- Follow camera turns with the skis instead of the path: it aims 30 percent toward the travel direction (was 60) and catches up about twice as fast. In a held turn it now trails the skis by 0.13 to 0.19 s at 30° (was 0.27 to 0.39 s).
- Keyboard steering ramps to full edge in 0.09 s (was 0.125 s).

## 0.8.1 (2026-11-22): Rail presses and the missing resort on the live page

### Added
- Rail presses: on a rail or box, hold forward (<kbd>W</kbd>, Up, or the stick up) for a nose press or back for a tail press. A press shows in the rider pose, is harder to balance (the balance pendulum's unstable term is 1.3 times stronger on rails, 1.15 on boxes) and scores 40 points per metre pressed. The trick name takes the press held longest, such as "Nose Press 50-50 Rail". Pitch already held when you land on the rail (Down is also the brake) does nothing until you let go, and holding a press off the end does not start a flip. Values are provisional until playtested.

### Fixed
- The live page was missing most of the resort (no buildings, no Stock's, T-Bar or Magic Carpet) because the data build published without `features.json` when Overpass timed out. The OSM export now tries four Overpass mirrors and then the main OSM map API; if all fail, the data job stops and the last good build stays published. The Pages build refuses a `features.json` without buildings and four lifts.

### Changed
- The first-rail tip explains presses and slides. It used to say grab gives a slide bonus, which the sim never did.
- `docs/review/apex-visual-improvements.md`: visual gaps from comparing 0.8.0 with real Apex footage, for triage.
- `game/research/ski-physics-and-freestyle.md`: Jibbin freestyle and park audit (static analysis only) and the rail press design.

## 0.8.0 (2026-11-22): Tutorial, tips, snowboarding and a public home

### Added
- Tutorial ("Learn to ski" on the title screen the first time, "Tutorial" after): six lessons on Easy Rider by the Magic Carpet. Get moving, turn both ways, stop, carve, jump, grab. Each lesson finishes when you do it. A Next button appears after 20 s, the carve lesson starts from the top, the bottom of the hill sends you back up, and the tutorial can be skipped. Wording follows keyboard, touch or gamepad.
- One-time tips the first time you crash, hit deep snow, ski the trees, find ice, ride a steep pitch, approach a park jump, get on a rail or ride a lift.
- Snowboarding: pick Snowboard under "Skis or board" in the Rider panel. 8 m sidecut, more float in powder, sideways stance, one board and one wide track, no poles. Board on the chairlift, toe and heel lean in turns.
- Other skiers on the hill (4, 7 or 10 by graphics quality; Settings to switch off). They ski named runs in S-turns at their own pace, about a quarter ride boards, they respawn near you, and they pass through you. They keep skiing behind the title screen.
- Title screen backdrop: a slow pan around the view from the top of Quickdraw.
- `docs/run-names.md`: the official Apex runs OpenStreetMap is missing and the candidates for each traced run.

### Changed
- Apex accuracy pass from the 2023 and 2026/27 trail maps, the grooming report, Wikipedia and an aerial photo (`docs/apex-sources.md`):
  - Traced runs named: Highway 97C (blue), Mini-Colorado (double black), Crusher. Upper Wishbone is blue.
  - Apex Mountain (2247 m) labelled on the horizon; the summit label uses the LiDAR height.
  - Building names cleaned up; village wall colours from the photo, with the Apex Mountain Inn yellow.
  - T-Bar and Magic Carpet run at their real speeds.
  - All fixes live in `world/corrections.ts`.
- Faster load: parking lot search 269 to 52 ms and forest planting 240 to 127 ms with the same output; about 30 percent off the build phase in the browser.
- The tutorial and tip card lets touches through and sits below the minimap on phones.
- Ready for a public repository: MIT `LICENSE`, data licences spelled out in the README, `SECURITY.md`, development notes in place of the internal handoff log, and `.gitignore` entries for local secrets.
- Moved to the public repository johnstonstu/SkiScrapeX; the game is live on GitHub Pages at https://johnstonstu.github.io/SkiScrapeX/.
- Vitest 3 to 5 (fixes dev-only advisories in tinypool and @vitest/mocker; `npm audit` is clean).

## 0.7.0 (2026-11-21): Settings, gamepad and a reason to ski

### Added
- Title screen with Free ski (Continue once you have runs), Challenges, Rider and Settings, plus a medal, run and nugget summary. The pause menu has a Main menu button. Review links (`?dev`, `?park`, `?ride`, `?at`, `?perf`) skip it.
- Challenges (pause menu, title screen or `H`):
  - Timed runs on every named run over 180 m. Gold, silver and bronze times come from a pace bot that skis each run on the real terrain (22 m/s cap). Silver is 20 percent slower than the bot and bronze 50 percent. Times are worked out in the background and cached per version; a run's times are computed on the spot if you start it first.
  - Three slalom courses on groomed greens and blues, with red and blue gates that turn green or grey as you pass or miss them. A missed gate adds 3 s.
  - Park score attack for each park and its current layout. Point targets come from the features in the layout and are provisional until playtested.
  - Courses start at the first clear spot past the top of the run (not inside the lift terminal), and an attempt ends after 4 s far off the course.
- Results card after each challenge: time or score, medal, best and next medal target, top speed, distance, vertical, gates and trick points. Retry (`R`), Keep skiing (`Esc`) or Challenges.
- Free-ski run card during the lift ride: time, best, top speed, distance, vertical and trick points.
- Ski every run: a run counts once half its length has been skied. The checklist is in the challenge list.
- 12 hidden gold nuggets just off the edges of runs, the same on every load. They glint and bob; ski into one to pick it up.
- Rewards in the rider panel, shown locked with their hint until earned: Gold colour (3 golds), Chrome colour (10 medals), Topo ski graphic (20 runs skied), Nugget ski graphic (6 nuggets).
- Local profile (`skiscrapex.progress`): medals, bests, runs covered, nuggets and lifetime totals.
- `npm run tune` with `MEDALS=1` prints the pace bot's times for every run at three speed caps.
- Settings panel (pause menu or `G`), saved in the browser:
  - Graphics quality: Auto, Low, Medium or High. Auto picks Low on touch devices and High elsewhere. Changing it asks for a reload.
  - Shadows on or off, view distance (60 to 140 percent tree reach), steering sensitivity, flipped up and down controls, camera field of view, camera shake, volume, landing marker and landing assist.
  - Everything except quality applies live.
- Gamepad support (standard mapping):
  - Left stick skis and spins, LT brakes, A jumps, X or RB grabs, Y does the second grab.
  - B skips the lift, LB changes camera, Start pauses, View/Back opens runs.
  - D-pad: down for the map, up for the rider, right to restart.
  - The help text switches to pad buttons once a pad is used.

### Changed
- Slalom gates are race-sized (2.3 m poles, 0.9 m banners) and fade as the follow camera passes through them. The HUD counts gates and misses.
- Gates and nuggets sit on the 2 m detail surface, not the 5 m grid.
- Medal-time cache keyed by course shape, so moved gates or retraced runs get new times.
- Quality profiles (`app/settings.ts`) replace the scattered touch checks for pixel ratio, antialiasing, shadow map size, terrain tiles, forest density and reach, and particle counts.

## 0.5.0 (2026-11-21): Housekeeping and performance

### Changed
- Source reorganized: `app/` (entry wiring, Apex stage assembly, menus, trick feed, storage), `player/` (input, camera, audio, effects), `ui/` (minimap, rider panel), `render/terrain`, `render/scenery`, `render/rider`, `tools/` (rider lab). `main.ts` went from 790 to 500 lines.
- Version shown in the pause menu and the info overlay.
- 2 m terrain tiles build about 2.5 times faster and run under a per-frame time budget, removing 10 to 35 ms hitches while skiing.
- Lift towers, terminals and the summit hut merge into a few meshes (lifts 93 to 10 meshes, village 47 to 8).
- Far forest past the mid range draws a 4-triangle stand-in (forest triangles 926k to 548k).
- Touch devices draw the coarse terrain at 10 m, about half the scene triangles.
- The info overlay text is only built while it is open.

### Added
- `?perf` probe for load phases, frame CPU split and renderer counts.
- CHANGELOG, version tags, roadmap (`docs/roadmap.md`).

### Fixed
- Test slopes (`?dev`) no longer leave "Loading…" on screen.

## 0.4.0 (2026-11-21): Runs, trees, village, creator, corks

### Added
- 21 runs that OpenStreetMap lacks, traced from LiDAR canopy gaps (`scripts/detect-runs.py`, `world/runOverlay.ts`); names provisional, key in `docs/runs-overlay.png`.
- Tree species by elevation: Engelmann spruce, subalpine fir, lodgepole pine, snags, krummholz and snow ghosts.
- Village props: parking lots found in the LiDAR with parked cars, decks with patio tables, the Billy Goat Hut by the Quickdraw top.
- Character creator: six ski top-sheet graphics with an accent colour, jacket accent colour, backpack.
- Corks and double corks (pitch during a spin), rail entry pop.

## 0.3.0 (2026-11-21): Steeps, rider and freestyle

### Changed
- Ski physics on steeps: sidecut-driven yaw, edge grip in g, attack-angle skid split so skids scrub speed, uphill traverse edge. See `game/research/controls-physics-review.md`.
- New rider model (baggy or slim kit, helmet or beanie, gaiter) and riding style: carve lean from physics, angulation, counter-rotation, pole plants, tuck, landing absorb, grab IK, grind pose.

### Added
- Landing marker, truck driver and nose grabs, rider lab page (`rider.html`), steep-slope tuning probe.

## 0.2.0 (2026-11-21): 2 m terrain

### Added
- 2 m detail terrain from the 1 m LiDAR near the camera, morphing to the 5 m surface; physics and object placement use it.
- Branch data builds publish to `data-<branch>`; the Pages deploy is skipped unless `PAGES_ENABLED=true`.

### Changed
- Controls and feel pass recovered from the first handoff: steadier steering on steep faces, switch riding, pole push on flats, softer deep powder, mogul bumps, procedural audio, Esc pause.

## 0.1.0 (2026-11-21): First playable

### Added
- Apex terrain (LidarBC 5 m), canopy forest, OSM runs, lifts and buildings, horizon from NRCan MRDEM.
- Ski model with carving, powder and freestyle; terrain parks with swappable layouts; lift rides; run picker; first-person camera.
