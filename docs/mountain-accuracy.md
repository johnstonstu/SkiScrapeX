# Mountain accuracy pass (0.9.54, 2026-11-28)

Stu: "the accuracy of the mountain to real life, and still keeping some fun in the game. We need to double check the runs." This pass checked every run and lift against the sources below. It builds on the whole-mountain pass (0.9.50, `docs/run-names.md`).

## Sources

| Source | Used for | Reached |
|---|---|---|
| LidarBC 2025 1 m bare earth and canopy (the game's own terrain) | Pitch, direction, fall lines, real clearing widths, tree cover on every line | Local data |
| `docs/review/apex-terrain/run-profiles.json` (independent 1 m profiles of 90 runs) | Length, drop, pitch, open width per run | Repo |
| `docs/review/apex-video/` (full watch of Rise & Alpine's Apex video and 44 other clips) | What each run looks like: width, grooming, moguls, trees | Repo |
| remontees-mecaniques.net lift reports, skiresort.info lift list | Lift length, vertical, towers, speed | Web, read 2026-11-28 |
| Wikipedia run list by lift and difficulty | Names and difficulty of every run | Web |
| peakrankings.com, powderhounds.com, Mountain Life (December 2025) | Terrain character, aspect, what is under the quad | Web |
| Apex trail map 2023 (apexresort.com PDF) | Run positions and order, glades, parks | Read at 300 to 600% through the browser on Stu's computer (the cloud cannot reach apexresort.com). Not copied into the repo |

## Lifts

| Lift | Game (LiDAR along the OSM line) | Published | Verdict |
|---|---|---|---|
| Quickdraw | 1,623 to 2,174 m, 551 m vertical, 1,604 m slope length, 14 towers, 5.2 min | 1,602 to 2,180 m, 578 m, 1,547 m (remontees) or 1,615 m (skiresort), 18 towers, 5 min 10 s | Line, length and ride time match. The published base is 21 m lower than the LiDAR at the mapped station, as is the resort's published base (1,575 m against 1,605 m at Stock's). Four towers short |
| Stock's | 1,605 to 1,956 m, 352 m, 1,381 m, 15 towers, 10.1 min | 1,575 to 1,924 m, 349 m, 1,392 m, 17 towers, 10 min 10 s | Vertical and length match within 1%. Two towers short |
| T-Bar | 1,682 to 1,883 m, 201 m, 668 m, 6 towers, 4.6 min | about 1,630 to 1,890 m, 689 m, 7 towers, 5 min | Length matches within 3%. The published elevations are rounded guesses (the same page gives both 260 m and 600 m of vertical). One tower short |
| Magic Carpet | 163 m | 163 m | Match |

Published elevations sit about 20 to 30 m below the LiDAR everywhere while verticals agree, so the game keeps the LiDAR. Tower counts come from OpenStreetMap; the missing towers are not placed because their real positions are unknown.

## Runs

- **Pitch, length and drop:** every mapped run matches its independent 1 m LiDAR profile within 0.5 degrees and 4 m (`tests/runProfiles.test.ts`). Nothing to fix.
- **Direction:** the front face falls north-east, as powderhounds describes ("many of the runs have a north-easterly aspect"), and the Wild Side faces south-east ("south-facing", peakrankings). Grandfather's and Grandmother's are the two flat border runs from the summit, as reviewed.
- **Under the quad:** Mountain Life's locals name the run "directly below the quad chair" as the favourite, where you unload and "drop right into your run, no traverse". That is the West Bank line 0.9.50 built from the unload.
- **Difficulty:** every run matches the official list. Wikipedia rates Grandmother's Trail advanced; the grooming report and both trail maps say blue, which the game keeps.
- **Moguls and grooming:** Gromit, Gunbarrel, Twenty Two and Peashooter are mogul runs in the game, as peakrankings describes them ("standout bump lines"). Chute is groomed ("groomed intermittently", powderhounds).
- **Width (changed):** nine groomers were 30 to 40 m of corduroy inside clearings 60 to 150 m wide. See the table.

| Run | Real clearing (LiDAR median) | Groomed before | Groomed now | Evidence that the width is groomed |
|---|---|---|---|---|
| Okanagan Run | 108 m | about 35 m | about 75 m | "Wide groomed slope above the village" |
| Juniper | 90 to 97 m | 35 m | 64 m | "Wide groomed open upper slope" |
| Ridge Run | 93 m | 28 m | 64 m | "Wide groomed slope", "wide corduroy cruiser" |
| Golden Eagle | 90 m | 20 m | 52 m | "Wide groomed corduroy" |
| Village Traverse | 79 m | 28 m | 56 m | "Groomed, wide gentle traverse" |
| Wild Bill | 63 m | 28 m | 50 m | "Groomed, wide, consistent pitch" |
| Sluice Box | 58 m | 33 m | 46 m | "Wide groomed run" under Stock's |
| Easy Rider | 151 m | 35 m | 80 m | LiDAR only: the Magic Carpet learning slope |
| Adrian's Alley | 112 m | 28 m | 64 m | LiDAR only: the open T-Bar face |
| West Bank (moguls) | 49 m | 30 m | 40 m | "Wide-open bumps such as those under the quad chair" |

## Trail map check (2023 map)

Read zone by zone and compared with the game's lines:

- **Front face, right of the chair looking up:** Grouse Gulch (hard against the chair), Tongue, Hanks, Showboat (short, low), Juniper (two branches), 97 and 97C, Chute (two branches), Poma, Face, then K with K2 below it, Magnum, Gromit, Gunbarrel, Twenty Two and Peashooter hanging off Grandfather's Trail. The game has the same runs in the same order.
- **Left of the chair:** Westbank against the chair from the top, The Pit beside it off Ridge Run, Mini-Colorado further down Ridge Run. Match.
- **The bowl:** Sweet Sue, Tooth/Tusk, Essendale, Toilet Bowl, Crusher, Golden Eagle, The Great Wall and Sunbowl fan down from the ridge and all meet at the top of Stock's. Match, in that order. The map draws one Essendale line; the game has Ward 1 and Ward 2 from the grooming report. Chaser is not on this map.
- **T-Bar side:** Old Mill, Adrian's Alley, Kristi's, the T-Bar with Okanagan Park beside it, Okanagan Run, Claim Jumper and Prospector parks, Wishbone, Chicken Finger, Rookie's Trail. Match. Andi's Alley is not on this map (placed from Stu's description, see below).
- **Wild Side inset:** Any Which Way glades, Jackpot, Wildly Easy (running down and left under Jackpot), Gun Slinger, Shootout, Showdown, Bob's Run and Hang 'em High along the ridge, all down to Grandmother's Trail and on to Stock's. Match.
- **Hidden Gold (changed):** the map paints it as a purple wedge with its point at the Stock's top station, Whipsaw above and Finger below, marked with a black diamond. The game had it on the other side of Whipsaw, west of the top station, in the run-out of the bowl runs. It is now the wedge of trees below the top station between Sluice Box, Finger and Maverick, and OpenStreetMap's unnamed black run from the top station through that wedge is named Hidden Gold and keeps its trees (it was a groomed 30 m corridor with no name). Confidence: medium. The map art is not to scale, so the wedge could also take in the trees south of Maverick.

## Where the game chooses fun over accuracy

1. **The bowl runs are cut lanes.** The LiDAR puts trees over about half of the drawn Essendale Ward 1 and 2, Tooth Tusk and Sweet Sue lines and a quarter of Toilet Bowl. The real runs are a tight tree traverse into an open bowl with saplings (Essendale) and a rock choke into a gully that ends in "steep tight trees" (Tooth, powderhounds). The game clears a 12 to 20 m lane down each so they ski cleanly at speed.
2. **Tooth Tusk has no rock choke.** The real entrance is a scraped chute with exposed rock where skiers side-slip. The game's is steep (36 degrees) but clean.
3. **Blacks are groomed wall to wall where OSM says groomed.** Chute, Tongue, K and Grouse Gulch are groomed "intermittently" in real life. The game always grooms them, which keeps them fast.
4. **No poling.** The 0.9.43 and 0.9.50 passes moved run tops onto the lip so nothing needs a push. The real ridge to the far bowl runs is a flat traverse.
5. **Stock's Traverse and the other cat tracks** stay at cat-track width even where the LiDAR clearing is wider, because that is how they are groomed and filmed. This one is accuracy over fun.

## Open questions (need Stu or a newer map)

- **Chaser** shares Crusher's lane in the game (the two lines are 10 to 20 m apart below the lip). It is on the grooming report as a Quickdraw black and not on the 2023 map. Where does it really start and end? Stu (2026-11-28): leave it as it is for now.
- **Andi's Alley** (answered by Stu, 2026-11-28): "beside Kristi's run. When you get off the T-Bar, it'll be to the skier's right." It is the LiDAR cut between the T-Bar's tree strip and Kristi's Run (trace L5), now named, rated advanced as on the official list, and started from the T-Bar unload instead of 150 m down.
- **Gauntlet, Panhandler and Glade-iator** (Wild Side) are not on the 2023 inset and are still unplaced.
- **Three unnamed OpenStreetMap runs** remain (a blue above Dawdler 1, a green east of Stagecoach and the short link into Gunbarrel).
- **The bowl lines** follow the map's order, but the map is a painting: which gully each one takes is still a LiDAR fall-line draft.
