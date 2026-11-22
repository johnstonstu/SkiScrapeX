# Apex sources and what the game takes from them

Research pass of 2026-11-22. Each finding lists where it came from and where it lives in the code. Anything that changes the game goes through `game/src/world/corrections.ts` or `game/src/world/runOverlay.ts`, so it is easy to review or undo.

## Sources

| Source | What it has | Used for |
|---|---|---|
| Apex trail map 2023 (apexresort.com, web image via cdn.bfldr.com, 1280 px) | Run names and colours, lifts, parks, Billy Goat Hut, Beaconsfield Mountain 2180 m, Apex Mountain Peak 2247 m, Apex Village 1629 m, half pipe, race area, tube park, skating loop | Run order, difficulties, peaks |
| Apex trail map 2026/27 (skinorthamerica100.com review, 1320 px) | Adds Wildside label, Mini-Colorado, Crusher, Golden Eagle, Fools Gold and Hidden Gold glades | L12 and L15 names |
| Apex trail map PDFs (apexresort.com) | Same art; labels are vector outlines, art is tiled raster | Could not be rendered here |
| Apex grooming report (apexresort.com/weather) | Every current run by lift, sorted by difficulty then name | List of runs OSM is missing |
| Wikipedia, Apex Mountain Resort | Runs by lift and difficulty, base 1575 m, summit 2178 m, lift types | Difficulty check of every OSM run |
| zrankings.com Apex runs | 63 runs measured on 1 m LiDAR (vertical, length, pitch, aspect) | Cross-check of the game's lines: lengths and drops agree within a few percent |
| OpenStreetMap lift tags | Capacity, occupancy, ride time per lift | Lift speeds |
| Aerial photo of the village (apexresort.com, 2023) | Building colours and roofs | Wall palette, Apex Mountain Inn yellow |
| NRCan MRDEM horizon grid (already in the data) | Terrain around the crop | Apex Mountain's location (highest point, 2.4 km south of Beaconsfield) |
| Hiker trip report (stevensong.com) | Apex Mountain (2247 m) and Beaconsfield are separate summits | Peak labels |

Video could not be watched from here; transcripts and descriptions turned up nothing the maps and lists did not already have.

## Applied

- Run difficulties: every OSM run matches the official list except Upper Wishbone (green in OSM, blue officially and on both maps). Fixed.
- Traced runs: L8 is Highway 97C (blue, beside Highway 97), L12 is Mini-Colorado (double black, between Ridge Run and The Pit on the 2026/27 map), L15 is Crusher (between Toilet Bowl and Golden Eagle on that map; likely, not certain).
- Peaks: the summit label uses the LiDAR height (about 2173 m; trail map 2180 m, Wikipedia 2178 m). Apex Mountain, 2247 m, is labelled on the horizon.
- Buildings: names cleaned up (Gunbarrel Saloon, Apex Mountain Inn, The Edge Bistro, Apex Ski Club). Wall colours from the aerial photo; the Inn is yellow.
- Lifts: chair speeds already matched the official ride times (Quickdraw 5.2 min, Stock's 10.1 min). The T-Bar now runs at 2.4 m/s (668 m in 4.6 min) and the Magic Carpet at 0.8 m/s.

## Not applied (needs Stu or better sources)

- Sweet Sue, Tooth/Tusk, Essendale and Toilet Bowl sit left of Crusher on the map, between the ridge and the top of Stock's. The canopy scan found no cleared corridors there, so they are probably gladed; their lines would be guesses.
- W1 to W6 are the Wildside lines from Hang'em High down to Grandmother's. The candidates are ShootOut, Gun Slinger, Jackpot, Showdown, Panhandler and Gauntlet, but neither map labels them individually.
- L10, L13 and L14 lie between named runs where the maps show no run: probably unnamed cuts or glade lines.
- Glade areas from the 2026/27 map (Fools Gold beside Stock's Chair, Hidden Gold left of Whipsaw, and the Wildside glades) are not mapped as areas yet.
- Village extras on the 2023 map (tube park and tow, half pipe, race area on Okanagan Run, 1 km skating loop) are not placed.
