# Apex Mountain Resort: Reference Material for SkiScrapex

Compiled 2026-11-21. Sources were read through web search and page fetches. No images were downloaded. Where a page could not be opened (apexresort.com trail map and road report pages, YouTube watch pages, Flickr search), this is noted. Figures that disagree between sources are listed side by side and marked.

Legend: **[verified]** read directly from the page. **[title only]** only title and channel confirmed (YouTube oEmbed); video content not viewed. **[uncertain]** inferred, conflicting, or not confirmed.

---

## 0. Key findings for the developer (read first)

1. **The OSM summit elevation is wrong for Beaconsfield.** The game's OSM peak node "Beaconsfield Mountain" (node 1859465627) carries `ele=2247` from NRCan CanVec. The game's own LidarBC grid tops out at 2176.2 m, and several sources put Beaconsfield at 2176 to 2180 m. 2247 m is the height of **Apex Mountain**, the separate, antenna-topped peak about 2 km south of the resort (outside the crop). Use roughly 2176 m (LiDAR) for any in-game summit sign. Sources: sonnybou.ca trip report (Beaconsfield 2176 m, Apex Mountain 2244 m), stevensong.com (Apex Mountain 2247 m), remontees-mecaniques.net (Quickdraw top 2180 m). See sections 3 and 5.
2. **The official grooming report lists about 30 run names that are not in the game's OSM data.** These include the whole Wildside run list, Mini-Colorado, Tooth Tusk, Sweet Sue, Toilet Bowl, Highway 97, Highway 97C, Essendale Ward 1 and 2, Chaser, Crusher, Fools Gold, Hidden Gold and Wildly Easy. The full list grouped by lift is in section 3.4.
3. **Webcams give fixed real-world viewpoints.** There are five webcams, three with known positions (Quickdraw summit, Old Mill Shack at the T-Bar top, Okanagan Run looking uphill). These make good camera-match targets. See section 2.
4. **Lift specs are available at engineering detail** from remontees-mecaniques.net: tower counts, speeds, ride times and station elevations. See section 3.3.

---

## 1. POV and video references

YouTube watch pages were blocked to the fetch tool, so descriptions, chapters and timestamps could **not** be read. Titles and channels below come from search results and YouTube oEmbed. Watch each video yourself to log timestamps. The "likely shows" notes are guesses based on the title and channel. **[uncertain]**

| # | Title / channel | URL | Likely shows | Status |
|---|---|---|---|---|
| 1 | "The Most Underrated Ski Resort in Canada - APEX Mountain" / Rise & Alpine (2024-02-04, 18:38 per skiresort.info) | https://www.youtube.com/watch?v=An8kSTvZv_k | A long-form resort tour; the best candidate for run-by-run footage, the Quickdraw ride and village shots. | [title only] |
| 2 | "Skiing Apex Mountain Resort!!!" / Downhill Jake (2023-03-26, 15:32) | Video ID not found. The skiresort.info video page embeds it: https://www.skiresort.com/en/ski-resort/apex-mountain-resort/video/ | A long POV-style ski day. | [uncertain: URL not resolved] |
| 3 | "Apex Mountain Resort - Part 1 of my BC Ski Road Trip" / Adventure with Renee | https://www.youtube.com/watch?v=pVY38aSUTjg | A vlog-style ski day, probably with village and lift footage. | [title only] |
| 4 | "Apex Ski Resort - What makes it unique?" / BCFieldReporterIvan | https://www.youtube.com/watch?v=aJpNEDOjZS8 | A resort overview. | [title only] |
| 5 | "Skiing Lifestyle at Apex Mountain" / SnowSeekers | https://www.youtube.com/watch?v=AeAQVU5ffzI | A promotional edit: village, Gunbarrel, groomers. | [title only] |
| 6 | "Skiing at Apex Mountain Resort in British Columbia" / Preserved Light (2017, 1:31) | https://www.youtube.com/watch?v=FMO5JhwxuiI | A short cinematic clip. | [title only] |
| 7 | "Winter skiing at Apex Mountain Resort, British Columbia, Canada" / Preserved Light | https://www.youtube.com/watch?v=55Spwst3_18 | A short cinematic clip. | [title only] |
| 8 | "Powder Days Snowboarding at Apex Mountain Resort" / Preserved Light (2017-01-30, 1:52) | Listed on https://www.skiresort.com/en/ski-resort/apex-mountain-resort/video/ (ID not resolved) | Powder snowboarding. | [uncertain] |
| 9 | "Apex Mountain Resort / Winter Slopes and Mountain Views" / Lifelong Trail | https://www.youtube.com/watch?v=JQN6lDrrf-4 | Scenery and views, possibly from the summit toward the Okanagan. | [title only] |
| 10 | "Apex Mountain Resort" (another upload) | https://www.youtube.com/watch?v=0NxurNElxAQ | Unknown. | [uncertain] |
| 11 | "Ski at Apex Mountain Resort in BC" | https://www.youtube.com/watch?v=APXwTbK3lSQ | Unknown. | [uncertain] |
| 12 | "SKIING IN THE OKANAGAN! (Skiing at Apex BC and Baldy Mountain Resort)" | https://www.youtube.com/watch?v=7QSaCxAoF3Y | A two-resort vlog; only the Apex part applies. | [uncertain] |
| 13 | "Apex Mountain opens slopes for winter season" (news) | https://www.youtube.com/watch?v=I0axa2mgvm8 | News footage: base area, lifts, opening day. | [uncertain] |
| 14 | "Why do visitors love visit Apex Mountain Resort? #visitpenticton" | https://www.youtube.com/watch?v=-W74HaiD6Pg | A tourism short. | [uncertain] |
| 15 | "3 Ski Destinations near Penticton, BC #visitpenticton" | https://www.youtube.com/watch?v=FLOUE_HNy6M | A tourism short. | [uncertain] |
| 16 | "Apres at Gunbarrel Saloon in Apex, BC" | https://www.youtube.com/watch?v=4--L7-5Ks7w | The Gunbarrel Saloon exterior and interior, for modelling that building. | [uncertain] |
| 17 | "Tubing at Apex Mountain Resort" | https://www.youtube.com/watch?v=dT0XJiYQ5no | The tube park. | [uncertain] |
| 18 | "The Longest Forest Skating Loop in BC" | https://www.youtube.com/watch?v=H3i2bs-RRFk | The 1 km Adventure Skating Loop through the trees. | [uncertain] |
| 19 | "Skating the Outdoor Loop at Apex Ski Resort" | https://www.youtube.com/watch?v=awbfoBLme_s | The skating loop. | [uncertain] |
| 20 | "WINTER IN THE OKANAGAN: Skating at Apex Mountain in Penticton" | https://www.youtube.com/watch?v=abQ8LHpj2TA | The skating loop and rink. | [uncertain] |
| 21 | "Penticton to Apex Mountain Resort - Scenic Drive BC Canada!" | https://www.youtube.com/watch?v=uQglLL9STPU | A dashcam drive up Green Mountain Road and Apex Mountain Road into the village. Useful for the road and the village arrival. | [uncertain] |
| 22 | "Apex Mountain Backcountry (BC, Okanagan)" / LifeIsAdventure | https://www.youtube.com/watch?v=4WX5UCTpBpU | Backcountry outside the resort boundary. | [title only] |
| 23 | "Dividend + Apex Mountain Tour (BC, Okanagan)" | https://www.youtube.com/watch?v=tgTNxXHRWCQ | A backcountry tour on the nearby peaks. | [uncertain] |
| 24 | "Apex Mountain NE slopes" and "Apex Mountain NE Arete" / Andy Traslin | https://www.youtube.com/watch?v=LtiM0hV4PYc and https://www.youtube.com/watch?v=-U50qv3lPcg | Probably the separate Apex Mountain peak south of the resort, not the in-bounds runs. | [title only] |
| 25 | Global News: "Okanagan winter wonderland: playing in the snow at Apex Mountain Ski Resort" (2020-01-07, 1:50) | https://globalnews.ca/video/6379821/okanagan-winter-wonderland-playing-in-the-snow-at-apex-mountain-ski-resort/amp | A news segment; the article mentions the skating loop through the trees and the village rink. | [verified article; video not viewed] |
| 26 | SnowSeekers "Apex SnowSeekers TELUS TV" | https://www.snowseekers.ca/story/apex-snowseekers-telus-tv | A TV segment page. The text features Gunbarrel bartender "Gordie" and notes that the old saloon once had rooftop hot tubs and sat right on a run. | [verified text] |

Not Apex (excluded): "The Alpine Quickdraw" (DMM Wales, a climbing gear video); "Exploring British Columbia" on Vimeo (no Apex footage); "Apex Mount Feb 5" (Duhamel Manu, location unclear) at https://www.youtube.com/watch?v=Tww4cpTukN0 **[uncertain]**.

Social accounts that likely hold reels of specific runs (not browsable here): https://www.instagram.com/apexmtnresort/ , https://www.instagram.com/stayatapex/ , https://www.instagram.com/visitpenticton/ .

---

## 2. Webcams, photo galleries, and geotagged photos

### 2.1 Webcams (best fixed viewpoints)

The official names are listed on https://apexresort.com/weather/ : Top of the Quad, Old Mill Shack, Okanagan Run, Easy Rider and Ridge Run. Positions come from SnowStash and liveworldwebcams.

| Cam | Position / direction | Snapshot URL | Notes |
|---|---|---|---|
| Quickdraw Summit / "Top of the Quad" | At the Quickdraw top station, about 2193 m per SnowStash. Faces skiers arriving at the summit; the liveworldwebcams description mentions lift towers dropping into trees and forested ridges to the horizon. | https://ipcamlive.com/player/snapshot.php?alias=5f91b68c1adc4 (live player: https://g1.ipcamlive.com/player/player.php?alias=5f91b68c1adc4) | The best match for the game's summit scene. A news report says this cam showed 2022 Keremeos Creek fire smoke behind the resort. |
| Old Mill Shack | At the upper terminal of the T-Bar, about 1850 m per SnowStash. Looks down toward the village core. | https://ipcamlive.com/player/snapshot.php?alias=612e49da1bfc2 | A good reference for village massing seen from above. OSM has an "Old Mill" run near here. |
| Okanagan Run | In the village, about 1629 m. Looks uphill at Okanagan Run and the T-Bar; a snow gun is visible. | https://ipcamlive.com/player/snapshot.php?alias=615b9d87abd51 | Night-skiing run; the Gunbarrel sits at its bottom. |
| Easy Rider | At the base, facing uphill over the Magic Carpet beginner slope. | URL not found **[uncertain]** | |
| Ridge Run | Upper mountain, open slopes with peaks in view. | URL not found **[uncertain]** | |

Aggregator pages: https://snowstash.com/canada/british-columbia/apex-mountain/snow-cams and https://liveworldwebcams.com/apex-mountain-resort-webcam-british-columbia-canada/

### 2.2 Photo galleries

- **remontees-mecaniques.net lift photo reports.** These are the best photo references for lift hardware.
  - Quickdraw: https://remontees-mecaniques.net/bdd/reportage-tsd4-quickdraw-doppelmayr-3652.html. About 50 photos dated 10 Dec 2010 covering the bottom station, every tower P1 to P18 with sheave configurations, the top station, the unload area, the chairs and the detachable grip.
  - Stock's: https://remontees-mecaniques.net/bdd/reportage-tsf3-stock-s-gmd-muller-7492.html. The bottom station, towers P2 to P18, the top station and control booth, and line views from the runs.
  - T-Bar: https://remontees-mecaniques.net/bdd/reportage-tke2-t-bar-gmd-muller-3653.html. The bottom drive station with its counterweight column, towers, the top return station and lookout post, and the short-handled bails.
- **sonnybou.ca ski-tour trip report (28 Dec 2016):** https://sonnybou.ca/ssbou2016/beaconsfieldapex.html. 23 captioned photos: the upper parking lot at sunrise, skinning up Grandfather's Trail (wide and easy), the Beaconsfield summit, the **Billy Goat Hut** on the summit (now a ski patrol cabin, formerly a café), the descent on Grandmother's Trail, the ridge to Apex Mountain, and the telecom towers on Apex Mountain. A GPX download is included. The best reference for the summit hut and the top-of-mountain feel.
- **OnTheSnow resort photos:** https://www.onthesnow.com/british-columbia/apex-mountain/resort-photos.html. Resort brochure images (powder skiing, a Christmas torch parade, "Powder Morning" series), with CDN links listed on the page. Content not verified.
- **Tripadvisor "Top of Grandfather's Trail":** https://www.tripadvisor.com/LocationPhotoDirectLink-g154937-d266822-i249277892-Apex_Mountain_Resort-Penticton_Okanagan_Valley_British_Columbia.html. A user photo; the image description was not readable. Other captions on the page include "skating the loop."
- **First Tracks!! trip report, 16 Jan 2025:** https://www.firsttracksonline.com/boards/threads/apex-b-c-jan-16-2025.15239/. Photos of a public groomer with slalom poles beside the prepared **mogul course**, the roped-off Wildside with the **Ridge Run warning sign**, the Chute, the Buckshot moguls, lodge wall decor (an antique kids' ski), and an access-road sign.
- **SnowSeekers "Then and now: Apex":** https://www.snowseekers.ca/story/then-and-now-apex. Historic photos credited to OldPhotos.ca (the original Poma, the early T-bar, a full parking lot) and modern resort photos.

### 2.3 Wikimedia Commons / Flickr / Street View

- No Apex category exists on Wikimedia Commons, and the geosearch API was not reachable. Flickr search is blocked to the fetch tool. **Nothing geotagged was confirmed.** Worth checking by hand: Flickr map search around 49.39 N, 119.91 W, and Google Maps photo spheres at the village, the Quickdraw top and the Beaconsfield summit.
- Coordinates: BC Geographical Names puts "Apex Mountain" (the recreational community, meaning the village) at **49°23'35"N, 119°55'07"W** (https://apps.gov.bc.ca/pub/bcgnws/names/57200.html). Wikipedia gives the resort at 49.39 N, 119.90 W.

---

## 3. Trail maps, terrain parks, grooming, lifts and stats

### 3.1 Trail maps

- **Current official map (2025/26), via skiresort.com:** full image https://www.skiresort.com/fileadmin/_processed_/77/7e/ea/a2/b65f5a2394.jpg (page: https://www.skiresort.com/en/ski-resort/apex-mountain-resort/trail-map/).
- **OnTheSnow copy, undated, 2048 px:** https://cdn.bfldr.com/WIENNW6Q/as/rfw65rkshf3x9237w7j6hxt/Apex_Mountain_Resort?auto=webp&width=2048
- **piste-maps.co.uk 2023 map:** PDF https://piste-maps.co.uk/pistemaps/Canada/Apex-Piste-Ski-Map-2023.pdf and JPG https://piste-maps.co.uk/pistemaps/Canada/Apex-Piste-Ski-Map-2023.jpg (the JPG failed to load for analysis). Page: https://piste-maps.co.uk/canada/apex
- **Other mirrors:** https://www.snow-online.com/ski-resort/apex-mountain-resort_trailmap.html , https://www.snow-forecast.com/resorts/Apex/pistemap , https://www.freeride.com/ski-resorts/apex/map/ , https://snowstash.com/canada/british-columbia/apex-mountain/trail-map
- **Historic maps:** The Whyte Museum archive holds the original Murray Hay hand-painted Apex ski maps (about 1976 to 2000): a mylar base map with four overlays. Catalogue entry only, no scan online: https://archives.whyte.org/en/permalink/descriptions54875 . Older scans may exist on skimap.org, but the right page was not found **[uncertain]**.
- **BC government resort boundary map (2023-12-14, 1:20,000):** https://www2.gov.bc.ca/assets/gov/farming-natural-resources-and-industry/natural-resource-use/all-seasons-resorts/short-term-rentals-accommodation-act-maps/str_skiresortmaps_tabloid_portrait_apex_mountain_resort.pdf . Shows the resort boundary, private parcels, buildings, all four lifts, Apex Mountain Rd, Hedley-Nickelplate Rd, the **Burn Perimeter Trail**, the **Okanagan Vista Trail**, the Nickel Plate cross-country ski trail and Nickel Plate Park. Useful for checking the village footprint against OSM.
- Note: the official site's /mountain/trail-map path failed to load; apexresort.com subpages load only intermittently.

### 3.2 Terrain parks (official: https://apexresort.com/terrain-parks/)

| Park | Level | Where | Features |
|---|---|---|---|
| Little Nuggets | Beginner | Right side of the Magic Carpet | Two 5 ft roll-overs, a few boxes, a small rail |
| Okanagan | Intermediate | Next to the T-Bar (on or beside Okanagan Run) | Roll-overs 5 to 15 ft, harder rails, jumps. **The only park open Friday and Saturday nights.** |
| Prospector | Intermediate to advanced | T-Bar area per the grooming report | A full-size progression park: jumps, roll-overs to 20 ft, boxes, rails, small gaps |
| Claim Jumper | Advanced | T-Bar area per the grooming report | The largest park: step-ups, jump gaps of 20 to 50 ft, longer rails |

Helmets are mandatory in all parks. Wikipedia also lists a **Skier/Boarder Cross** course (OSM has "Boarder Cross"). History: the resort says it has a World Cup aerial site and a World Cup mogul course and is a National Training Centre for aerials. Ty Spence (freestyle, halfpipe, big air) is named in Mountain Life. A halfpipe history was not confirmed **[uncertain]**. The theme names (Nuggets, Prospector, Claim Jumper, Motherlode, Sluice Box, Fools Gold, Hidden Gold, Panhandler, Jackpot) follow a gold-rush and Wild West naming scheme, not documented mine sites (see section 5).

### 3.3 Lifts

| Lift | Type, year, maker | Length | Vertical | Stations | Speed / ride | Other |
|---|---|---|---|---|---|---|
| **Quickdraw** | Detachable quad, 1994, Doppelmayr-CTEC | 1547 m (remontees) / 1615 m (skiresort) | 578 m | Bottom 1602 m, top 2180 m | 5 m/s, 5 min 10 s | 79 chairs, 18 towers, 2400 pph, drive at top, hydraulic tension at bottom, straight line. Replaced the Old Mill Chair and the Alpine Shuttle Poma in 1994. |
| **Stock's** | Fixed-grip triple, 1981, GMD Müller | 1392 m | 349 m | Bottom 1575 m, top 1924 m | 2.28 m/s, 10 min 10 s | 138 chairs, 17 towers (P2 to P18), 1800 pph, **diesel drive at the top** (no grid power), counterweight at bottom. |
| **T-Bar** | T-bar, 1968, GMD Müller | 689 m (skiresort). Remontees lists "260 m length / 600 m vertical", which looks swapped and garbled. With stations at about 1630 m and 1890 m, the real vertical is about 260 m. **[uncertain]** | about 260 m | Bottom about 1630 m, top about 1890 m | About 2 m/s, about 5 min | 7 portal-style towers on the **left side of the run** going up; drive and counterweight at the bottom. Serves the lit night-skiing blue run (Okanagan Run), the race-training hill and the parks. Oldest lift at Apex. |
| **Magic Carpet** | Conveyor | 163 m | | | | 1500 pph. Serves Easy Rider and Little Nuggets. |

Sources: https://www.skiresort.com/en/ski-resort/apex-mountain-resort/ski-lifts/ and the three remontees-mecaniques.net reports above. SnowStash's lift page lists a double chair, which is out of date. Game data check: OSM puts the Quickdraw top at about 2173.6 m in the LiDAR grid, matching the published 2180 m.

### 3.4 Grooming report and full official run list

Grooming report: https://apexresort.com/weather/ (the checkmarks did not come through, but the run names are grouped by lift). Snapshot of 2026-03-27:

- **Quickdraw:** Grandfathers, Ben's Run, Highway 97C, Juniper, Ridge Run, Wild Bill, Buckshot, Chaser, Chute, Crusher, Essendale Ward 1, Essendale Ward 2, Face, Golden Eagle, Grouse Gulch, Hanks, Highway 97, K, K2, Magnum, Poma, Showboat, Sunbowl, The Great Wall, The Pit, Toilet Bowl, Tongue, West Bank, Winchester, Dirty Harry, Gromit, Gunbarrel, Make My Day, Mini-Colorado, Peashooter, Sweet Sue, Tooth Tusk, Twenty Two.
- **Stock's:** Dude-Ney Trail, Easy Out, Finger, Greenhorn Traverse, Stock's Traverse, Village Traverse, Whipsaw, Dawdler 1, Dawdler 2, Fools Gold, Lower Gambit, Little Joe, Lucky Strike, Maverick, Motherlode, Sluice Box, Stagecoach, Sweet Louise, Upper Gambit, Hidden Gold, Window.
- **Wildside:** The Cut, Grandmothers, Wildly Easy, Any Which Way Glades, Bob's Run, Gauntlet, Glade-iator, Granny's Glades, Gun Slinger, Jackpot, Lower Hang 'em High, Upper Hang 'em High, Panhandler, ShootOut, Showdown.
- **T-Bar:** Chicken Finger, Rookies Trail, Adrian's Alley, Okanagan Run, Old Mill, Lower Spruce Hollow, Upper Spruce Hollow, Wishbone, Kristi's Run, Claim Jumper, Okanagan Park, Prospector.
- **Magic Carpet:** Easy Rider, Little Nuggets. **Tube Park:** Tube Park.

**Not found in the game's OSM run names** (compared against game/public/data/features.json): Highway 97, Highway 97C, Chaser, Crusher, Essendale Ward 1 and 2, Toilet Bowl, Mini-Colorado, Sweet Sue, Tooth Tusk, Fools Gold, Hidden Gold, Wildly Easy, Any Which Way Glades, Gauntlet, Glade-iator, Granny's Glades, Gun Slinger, Jackpot, Panhandler, ShootOut, Showdown. OSM has "Glades", "Hang'em High", "97" and "Westbank", which may partly cover these. OSM-only names that may be outdated or informal: Spruce Hollow, Strayhorse Trail, The Pit.

### 3.5 Mountain stats (sources disagree)

| Stat | Values found |
|---|---|
| Summit | 2178 m / 7146 ft (Wikipedia, Mountain Life 1962 figure); 7136 ft (PeakRankings); 7198 ft (OnTheSnow); 2193 m (SnowStash cam); **LiDAR in the game: 2176.2 m** |
| Base | 1575 m / 5167 ft (Wikipedia; matches the Stock's bottom station); 5197 ft (OnTheSnow); 5269 ft (PeakRankings) |
| Vertical | "2,000 ft" (official homepage); 603 m / 1978 ft (Wikipedia); 2001 ft (OnTheSnow); 1867 ft (PeakRankings). Quickdraw alone covers about 578 m. The full vertical needs Quickdraw plus a run to the Stock's base (for example Great Wall, then Motherlode or Gambit). |
| Skiable area | 1112 acres (Wikipedia, OnTheSnow, SnowSeekers); 944 acres skiable footprint (PeakRankings) |
| Longest run | 5 km / 3.1 mi (likely Grandfather's Trail or Grandmother's Trail **[uncertain]**) |
| Runs | 67 to 85 depending on source; the official homepage says 73; grooming report lists about 90 entries including parks |
| Split | Official: 16% novice, 48% intermediate, 36% advanced/expert |
| Snowfall | 600 cm average (official); 146 in (OnTheSnow); 228 in actual (SkiNorthAmerica100) |
| Night skiing | Okanagan Run and the bunny hill, Friday and Saturday 4 to 9 pm (https://apexresort.com/night-activities/); 40 acres (OnTheSnow) |
| Snowmaking | 12 guns; covers the base area only, not top to bottom despite older claims |
| Backcountry | 5000+ ha. Uphill route: the "Good, The Bad, The Ugly" trail to the "secondary saddle". One-ride backcountry ticket (https://apexresort.com/the-mountain-backcountry/) |

Stats sources: https://www.apexresort.com/ , https://en.wikipedia.org/wiki/Apex_Mountain_Resort , https://www.onthesnow.com/british-columbia/apex-mountain/ski-resort , https://www.peakrankings.com/content/apex

---

## 4. Village buildings and landmarks

Game OSM check: the named buildings in features.json are Apex Mtn Inn, Apex ski club, Fire Hall, Freestyle ski shack (bottom), Freestyle ski shack (top), The Gunbarell Saloon (misspelled in OSM), The edge bistro, Ticket Office, and top of the carpet lift shack. Named roads are Apex Mountain Road, Beaconsfield Crescent, Clearview Crescent and Road, Creekview Road, Strayhorse Road, Whitetail Road, Grandfather's Trail (track), Powerline Trail and a forestry road.

| Landmark | Facts | In OSM (game data)? |
|---|---|---|
| **Gunbarrel Saloon** | Opened 1981 by Glen Spence and partners. The original stood upslope from the main base lodge with swinging saloon doors and a hot-tub building (rooftop hot tubs per SnowSeekers). The current building sits **at the bottom of Okanagan Run**, keeps the original signs, and has a liquor store and grocery below it. Rental skates go back to a drop box at the Gunbarrel. Sources: Mountain Life (https://www.mountainlifemedia.ca/2025/12/apex-mountain-steep-sometimes-deep-ski-culture-seeped/), https://apexresort.com/night-activities/ , PowderHounds | Yes ("The Gunbarell Saloon", amenity=restaurant likely) |
| **Day lodge / main base lodge** | Holds the Longshot cafeteria (now "Longshot Wine & Tapas" per freeride.com) and a brown-bag area; lodge walls show antique ski decor (First Tracks report). | Not named in OSM. Probably one of the unnamed `building=yes` footprints **[uncertain]** |
| **The Edge Bistro** | Coffee and breakfast café, ski-in/ski-out | Yes (amenity=cafe) |
| **Apex Mountain Inn** | Fully ski-in/ski-out suites (apexmountaininn.com) | Yes ("Apex Mtn Inn") |
| **Apex Mountain Lodge / Apex Lodge** | Hotel rooms and suites (apexmountainlodge.ca) | Not named |
| **Stay at Apex** | Rental management for hotel rooms and chalets (stayatapex.com) | n/a |
| **Saddleback Lodge** | A B&B that burned to the ground (Castanet, date not given): https://www.castanet.net/news/Penticton/58461/Apex-lodge-burns-to-the-ground | Should not be modelled, or check the OSM date |
| **Rental shop, Mountain Shop, General Store** | Rental shop has about 400 pairs; retail shop; small grocery. https://apexresort.com/rentals/ | Not named |
| **Snow school** | https://apexresort.com/snow-school/ | Not named ("Apex ski club" is the race club) |
| **Ticket office** | | Yes |
| **Tube park (Tim Hortons Tube Park)** | Lift-accessed, lit for night tubing | Not found as a named feature |
| **Adventure Skating Loop** | About 1 km loop through the forest. The **Skate Shack** is at the start, near the road entering the village. Zamboni-groomed. https://apexresort.com/adventure-skating-loop/ | Not named |
| **Hockey rink / "Shinny Pond"** | Outdoor regulation-size rink in the village | Not named |
| **Fire Hall** | | Yes |
| **Freestyle shacks** | Top and bottom shacks for the aerials and mogul site | Yes |
| **Parking** | An unpaved main base lot plus a smaller, higher ski-in/ski-out "upper lot" (PeakRankings; sonnybou trip starts at the upper lot) | Check parking polygons |
| **Billy Goat Hut** | A small cabin on the Beaconsfield summit beside the Quickdraw top. Formerly sold baked goods and hot drinks; now a ski patrol cabin (sonnybou.ca) | Not named |
| **Nickel Plate Nordic Centre** | 56 km of groomed classic and skate trails (27 trails) plus 22 km of snowshoe trails, at about 1850 m, **6.5 km past the resort on Hedley-Nickel Plate Road**. https://www.snow-online.com/cross-country/nickel-plate-nordic-centre.html | Outside crop **[likely]** |
| **The road up** | From Penticton: Green Mountain Road for 18.5 km (gentle), then right onto **Apex Mountain Road** for 10.1 km at about 8% with hairpins, ending around 1751 m in the village. 28.6 km total, about 35 min. https://pjammcycling.com/climb/254.Apex%20from%20Penticton . The first single-lane road was cut along **Shatford Creek** in 1960 and widened to two lanes in the 1970s (SnowSeekers). | Apex Mountain Road yes |

---

## 5. Distinctive terrain and local knowledge

- **Beaconsfield Mountain summit.** The ski area sits on Beaconsfield, not on Apex Mountain. The real **Apex Mountain** (2244 to 2247 m, covered in telecom antennas and buildings, with a service road to the top) is about 2 km south, with a "northern outlier" at about 2234 m that is popular with out-of-bounds skiers. The summit is wind-exposed and scoured. Locals in the valley joke the resort is "**Scrapex**" (PowderHounds), which happens to match the game's name. The unload area is often hardpacked and windswept (First Tracks). There is very little skiing above treeline, just a few turns on the upper front face (PeakRankings). Sources: https://sonnybou.ca/ssbou2016/beaconsfieldapex.html , https://stevensong.com/apex-mountain/ , https://www.powderhounds.com/Canada/Apex.aspx
- **The Quickdraw lift-line face.** Steep bump runs drop straight down under the quad with no traverse (Gunbarrel, Twenty Two, Peashooter, Gromit, Make My Day, Dirty Harry). Mountain Life calls the run under the chair a local favourite. SkiNorthAmerica100 notes "steep blacks directly under the Quickdraw lift line." Dirty Harry's top entry looked risky in thin snow (First Tracks).
- **The Great Wall and Mini-Colorado.** Expert zones with "cliffs, chutes, and hidden drops" (PeakRankings). The Great Wall starts at the Quickdraw top and links to Motherlode or Gambit for the full vertical down to Stock's (SkiNorthAmerica100).
- **Tooth and Tusk** (listed as "Tooth Tusk" in the grooming report). Experts only. Tooth has a double-black entry that narrows into steep, tight trees (PowderHounds).
- **Chute.** The steepest regularly groomed run; a black that is groomed only some of the time. "Shoot the Chute" is an annual community downhill race (Mountain Life).
- **Poma.** A groomed black that follows the line of the original 1961 Poma (named for it **[likely]**).
- **Ridge Run.** A blue with a pitch warning sign at the top (First Tracks photo).
- **Wildside (backside).** South-facing glades reached by a long traverse; snowboarders need speed for the exit. It is roped off when conditions are poor and turns icy when warm. Named glades: Any Which Way Glades, Glade-iator, Granny's Glades, Gauntlet. Opened in recent years (SnowSeekers).
- **Ridge west of Quickdraw.** Ungroomed moguls and trees along the main ridge (SkiNorthAmerica100).
- **Grandfather's and Grandmother's trails.** Flat, easy top-to-bottom runs along the two edges of the ski area, and the easy way off the summit (PeakRankings). Grandfather's is wide enough to skin up (sonnybou). Grandmother's is grouped under Wildside in the grooming report. OSM also tags Grandfather's Trail as a `highway=track`, which suggests a summer service road. That is consistent with its cat-track character and its westward bend **[inferred]**.
- **Race and freestyle areas.** A race-training hill by the T-Bar, a prepared mogul course and the World Cup aerials site.
- **Traverses.** Greenhorn, Stock's and Village traverses link the Stock's pod to the village. Long traverses are a common complaint.
- **Aspect.** Most of the front side faces north to northeast, which keeps snow cold. Wildside faces south.
- **Mining history.** No source documents a mine on Beaconsfield itself. The real mining history is regional: the **Nickel Plate gold mine** above Hedley (the Hedley-Nickel Plate Road continues past the resort to Nickel Plate Provincial Park and Hedley). The resort leans into a gold-rush naming theme (Motherlode, Sluice Box, Fools Gold, Hidden Gold, Claim Jumper, Prospector, Little Nuggets, Panhandler, Jackpot) and a spaghetti-western and Clint Eastwood theme (Quickdraw, Gunbarrel, Dirty Harry, Make My Day, Hang 'em High, Showdown, Gun Slinger, Winchester, Magnum, Stagecoach, Maverick). "Old Mill" (the run and the Old Mill Shack cam) recalls the removed Old Mill Chair, not a known ore mill **[uncertain]**. References: https://en.wikipedia.org/wiki/Nickel_Plate_Mine , https://suncruisermedia.com/Home/rv-travel/three-mines-hedley-bc/
- **Lift history for "ghost" features.** The 1961 3800 ft Poma (the longest in Canada at the time), a T-bar on wooden towers around 1963 or 1964, the current T-bar in 1968, a double chair in 1971, the Old Mill Chair, the Alpine Shuttle Poma serving the south bowls, Stock's in 1981, and Quickdraw in 1994 (SnowSeekers "Then and now", Mountain Life).
- **Okanagan views.** From the top: forested ridges and distant Okanagan peaks and lakes; Okanagan Lake and Naramata are named in Mountain Life. PeakRankings mentions visible logging and mining scars. The 2022 Keremeos Creek wildfire (7042 ha) burned in the hills behind the resort without reaching the runs (https://infotel.ca/newsitem/apex-resort-emerges-from-fire-season-ready-for-ski-season/it94830). Burned slopes may appear in distant views from the summit. The "Burn Perimeter Trail" on the BC map may refer to an older burn **[uncertain]**.

---

## 6. Forest, snow, weather and light

- **Trees.** No Apex-specific species list was found. BC biogeoclimatic zoning puts the high Okanagan ridges and plateaus at this elevation (about 1600 to 2180 m) in the **Engelmann Spruce-Subalpine Fir (ESSF)** zone. Engelmann spruce and subalpine fir dominate, with **lodgepole pine** common on drier and disturbed sites. Near treeline the spruce and fir are stunted and "twisted by cold mountain winds" (BC Okanagan ecosystem atlas: https://www.env.gov.bc.ca/okanagan/esd/atlas/forest.html ; ESSF overview: https://pressbooks.bccampus.ca/ecosystemsbc/?p=47). **Whitebark pine** is plausible on the windswept summit ridge. **Western larch** grows at mid elevations in the Okanagan, mostly below the resort, so it is unlikely in-bounds **[inferred]**. Glades are described as short, steep and tight (PeakRankings, PowderHounds). Practical takeaway: a dense mix of narrow, spire-shaped fir and spruce, thinning and stunting toward the wind-scoured summit. The game's canopy-height raster from LiDAR already captures the density.
- **Snow.** Dry Okanagan powder: "light, chalky" (PeakRankings), "champagne" powder (freeride.com, spelled "champaign"). Snowfall is modest by BC standards, about 6 m a year. Cold temperatures stay steady top to bottom, and the northeast aspect preserves snow quality. The summit is often wind-scoured or hardpacked. Wildside turns icy in warm spells. Mogul runs get packed powder because few skiers use them.
- **Weather and light.** Average temperature about -4 °C (official homepage). Days are often clear and blue (Mountain Life visit), and sometimes overcast with flurries and strong ridge-top wind (First Tracks, 16 Jan 2025). The resort sits in the rain shadow, away from coastal storms. Lighting ideas: bright sun on north-facing groomers with long shadows in midwinter, flat light under overcast skies, and lit night skiing on Okanagan Run and the bunny hill (Friday and Saturday 4 to 9 pm).

---

## 7. History quick reference (for signage and flavour)

- Locals skied the powder on Mount Beaconsfield after WWII. In 1960 a road was cut along Shatford Creek. In December 1961 Apex Alpine opened with a rope tow and the 3800 ft Poma (vertical about 370 m, summit 2178 m, $3 day tickets).
- T-bar 1968, double chair 1971, road upgrade 1979, Stock's triple and the Gunbarrel Saloon 1981, Quickdraw 1994 (replacing the Old Mill Chair and Alpine Shuttle).
- Early 2000s: tube park, rink and skating loop. Later: Wildside opened.
- Has hosted FIS Freestyle World Cup, NorAm and Mars Cup events, and is the National Training Centre for aerials.
- Sources: https://www.snowseekers.ca/story/then-and-now-apex , https://www.mountainlifemedia.ca/2025/12/apex-mountain-steep-sometimes-deep-ski-culture-seeped/

---

## Top 10 references to use first

1. **Official grooming report run list** (https://apexresort.com/weather/). The authoritative current run names grouped by lift. It shows the OSM gaps, including the whole Wildside pod.
2. **Current trail map, 2025/26** (https://www.skiresort.com/fileadmin/_processed_/77/7e/ea/a2/b65f5a2394.jpg). The artist's view for placing named runs, parks and Wildside against the LiDAR terrain.
3. **Quickdraw lift report** (https://remontees-mecaniques.net/bdd/reportage-tsd4-quickdraw-doppelmayr-3652.html). Exact specs and photos of every tower and both terminals for modelling the signature lift.
4. **Quickdraw summit webcam** (https://ipcamlive.com/player/snapshot.php?alias=5f91b68c1adc4). A live, fixed real-world view to match the game's summit camera against.
5. **Old Mill Shack and Okanagan Run webcams** (alias 612e49da1bfc2 and 615b9d87abd51). Real views of the village from above and from below, for building placement and night-lighting checks.
6. **sonnybou.ca Beaconsfield to Apex trip report** (https://sonnybou.ca/ssbou2016/beaconsfieldapex.html). Confirms the Billy Goat Hut, the upper lot, Grandfather's and Grandmother's trails, and the Beaconsfield versus Apex Mountain elevations behind the 2247 m fix.
7. **Rise & Alpine "Most Underrated Ski Resort in Canada"** (https://www.youtube.com/watch?v=An8kSTvZv_k). The longest available ski-day video (18 min), most likely to show identifiable runs and the lift ride.
8. **Stock's and T-Bar lift reports** (remontees-mecaniques.net, IDs 7492 and 3653). Fixed-grip speeds, the diesel top drive, and the T-bar tower side and count.
9. **PeakRankings review** (https://www.peakrankings.com/content/apex) together with **Mountain Life feature** (https://www.mountainlifemedia.ca/2025/12/apex-mountain-steep-sometimes-deep-ski-culture-seeped/). The best written descriptions of terrain character, village layout, Gunbarrel history and local culture.
10. **BC Short-Term Rental resort boundary map** (gov.bc.ca PDF in section 3.1). An official 1:20,000 map of the resort boundary, buildings, lifts and roads for checking the village footprint against OSM.
