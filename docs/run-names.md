# Naming the traced runs

The 21 runs in `game/src/world/runOverlay.ts` were traced from LidarBC canopy gaps because OpenStreetMap does not map them. Their refs match `docs/runs-overlay.png`. Rename a run by editing its `name` there.

## Whole-mountain pass (2026-11-28)

Checked against the 2023 trail map PDF (read on Stu's desktop browser; the cloud proxy blocks apexresort.com). Looking up from the village it shows, left to right: Sweet Sue, Tooth/Tusk, Essendale, Toilet Bowl, Crusher, Golden Eagle and The Great Wall dropping off the ridge south of the summit into the bowl and meeting at the top of Stock's, with Sunbowl below them; Ridge Run traversing from the summit down to the top of Stock's; Mini-Colorado, The Pit and Westbank between Ridge Run and the chair; Grouse Gulch on the chair's other side. The Wild Side inset hangs Granny's Glades, Any Which Way Glades, Jackpot, Wildly Easy, Gun Slinger, Shootout, Showdown, Bob's Run and Hang 'em High off the Hang 'em High ridge down to Grandmother's Trail, which leads to Stock's. Chaser is not on the 2023 map; it stays in the bowl where Stu places it.

The game matched that except at the lift line: OSM starts West Bank 270 m out on Ridge Run, so the fall line under the chair was unnamed off-piste. `RUN_LINE_FIXES` in `game/src/world/corrections.ts` gives West Bank and Grouse Gulch tops at the unload and links runs that stopped short. `game/tests/mountainNetwork.test.ts` checks the network.

## Bowl pass (2026-11-27)

Stu: the bowl runs (Toilet Bowl, Chaser, Crusher, Tooth, Tusk) were hard to reach from the top of the chair. The bowl is the north-east-facing horseshoe under the Grandmother's ridge that drains to the top of Stock's, so it faces back toward Beaconsfield. The research drafts started Toilet Bowl and both Essendales 530 to 620 m from the chair, past a 300 m stretch of ridge that drops about 5 m. They now drop off the lip where Grandmother's reaches it (Chaser, Toilet Bowl), and the Essendales start a little way down the headwall, reached by short falling traverses from the Toilet Bowl entrance. Chaser moved from the L3 trace by the Poma into the bowl, between Crusher and Toilet Bowl, because Stu places it there; L3 is "Unnamed cut L3" again. The exact Chaser line is a guess. Tooth Tusk and Sweet Sue are unchanged. `game/tests/bowlAccess.test.ts` skis a bot from the Quickdraw top into each bowl run without poling.

## Status (0.9.18)

Applied from the research handoff (`docs/review/apex-terrain/overlay-ref-mapping.json`), with the Wildside and south-face orders confirmed by Stu: W1 and W2 Any Which Way Glades, W3 Jackpot, W4 Gun Slinger, W5 ShootOut, W6 Showdown, L2 Prospector (Stu), L3 Chaser (moved to the bowl in the 2026-11-27 pass), L8 Highway 97C, L12 Mini-Colorado, L15 Crusher. The research found L7, L9, L10, L11, L13 and L14 are not the runs guessed below; they and L1, L4, L5, L6 are "Unnamed cut L…" until someone identifies them. The table below is the earlier reasoning, kept for history.

## What we know

Apex's grooming report (apexresort.com/weather, read 2026-11-22) lists these runs that OpenStreetMap does not have, by lift:

- **Quickdraw:** Chaser, Crusher, Essendale Ward 1, Essendale Ward 2, Highway 97C, Toilet Bowl (advanced); Mini-Colorado, Sweet Sue, Tooth Tusk (expert).
- **Wildside:** Gun Slinger, Jackpot, ShootOut, Showdown, Panhandler, Gauntlet, Lower Hang 'em High, Upper Hang 'em High, Wildly Easy, and the glades Any Which Way Glades, Glade-iator, Granny's Glades.
- **Stock's:** Fools Gold, Hidden Gold, Upper Gambit, Lower Gambit.
- **T-Bar:** Upper and Lower Spruce Hollow (OpenStreetMap has one Spruce Hollow).

The report sorts runs by difficulty and then alphabetically, so it does not say where each one is. An older (2018) report listed Quickdraw runs in what looks like map order: Grandfathers, Ridge Run, Sun Bowl, West Bank, The Pit, Wild Bill, The Great Wall, Toilet Bowl, Essendale, Tooth Tusk, Sweet Sue, Grouse Gulch, Tongue, Hanks, Showboat, Juniper, Highway 97, Highway 97C, Face, Poma, Chute, K, K2, Magnum, Gromit, Gunbarrel, Twenty Two. That order is the basis for the L8 name.

Update 2026-11-22: both trail maps were read (see `docs/apex-sources.md`). On the 2026/27 map the upper Quickdraw runs read, left to right: Sweet Sue, Tooth/Tusk, Essendale, Toilet Bowl, Crusher, Golden Eagle, The Great Wall, Sunbowl, Ridge Run, Mini-Colorado, The Pit, Westbank. The remaining refs still need someone who knows the hill.

## Candidates per ref

"Near" is the mapped run whose line passes closest to the trace (start, end, middle).

| Ref | Pitch | Near | Candidates | Applied |
|---|---|---|---|---|
| W1 | 23.5° | Grandmother's start, Glades end | Wildside runs: Gun Slinger, Jackpot, ShootOut, Showdown, Panhandler, Gauntlet, Lower Hang 'em High, or a glade | |
| W2 | 30.7° | Glades, Hang'em High | as W1 | |
| W3 | 26.0° | from Hang'em High to Grandmother's | as W1 | |
| W4 | 22.6° | from Hang'em High to Grandmother's | as W1 | |
| W5 | 25.8° | from Hang'em High to Grandmother's | as W1 | |
| W6 | 23.7° | from Hang'em High to Grandmother's | as W1 | |
| L1 | 16.6° | Upper Wishbone to Grandfather's | Wishbone link, Upper Gambit? | |
| L2 | 16.5° | Rookie's Trail to Upper Wishbone | T-Bar area link | |
| L3 | 23.6° | Chute, Poma | Chaser? | |
| L4 | 19.1° | along Okanagan Run | Okanagan Run variant | |
| L5 | 17.8° | Kristi's to Village Traverse | Lower Spruce Hollow? | |
| L6 | 15.6° | Adrian's Alley | Adrian's Alley variant | |
| L7 | 24.0° | Hanks, Old Mill, Kristi's | Essendale Ward 1 or 2? | |
| L8 | 24.5° | Juniper, Highway 97 | **Highway 97C** (blue on both maps) | yes |
| L9 | 28.0° | Tongue, Hanks | Essendale Ward 1 or 2? | |
| L10 | 36.8° | The Pit, West Bank | Tooth Tusk, Sweet Sue or Mini-Colorado | |
| L11 | 27.3° | Tongue, Grouse Gulch | Toilet Bowl? | |
| L12 | 34.6° | between Ridge Run and The Pit | **Mini-Colorado** (double black, 2026/27 map) | yes |
| L13 | 33.4° | The Great Wall, Ridge Run | Tooth Tusk, Sweet Sue or Mini-Colorado | |
| L14 | 32.5° | Sunbowl, Ridge Run | Tooth Tusk, Sweet Sue or Mini-Colorado | |
| L15 | 24.7° | left of Golden Eagle | **Crusher** (likely; the map's next run left of Golden Eagle) | yes |

Question marks are guesses from neighbours and pitch only. Slalom courses skip runs whose name starts with "Unmapped"; naming them makes them eligible.
