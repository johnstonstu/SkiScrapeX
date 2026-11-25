# SkiScrapeX Dev Handoff: 16 Apex Event & Challenge Specs

Dev-facing event and challenge specifications for `johnstonstu/SkiScrapeX` (Three.js + TypeScript + Vite), derived from real Apex Mountain Resort history.
**Priority items #1 and #2** were specifically requested by Stu and are fully specified for immediate implementation.

---

## Priority Event #1: Shoot the Chute (Straight-Line Speed & Time Trial)

- **Real-Event Basis & Verification Status:**
  - *Verified:* "Shoot the Chute" is a classic Apex Mountain community downhill race on **Chute** (one of Apex's original 1961 runs ending at the old lodge / upper parking lot). Canadian ski-mountaineering pioneer Eric Pehota raced it on 225 cm Atomic skis and clocked **151 km/h**; Trevor Petersen famously raced it in a Stanfield one-piece underwear suit with mismatched boots (*Mountain Life*, Dec 2025; *Penticton Herald*, Feb 2025).
  - *Marked as Stu's Description / Unverified Details:* Exact years (circa 1980s), exact start/finish gate coordinates, radar trap placement, and bail disqualification rules are not documented in public archives and are designed here from Stu's straight-line speed brief + LiDAR run geometry.
- **Run / Course Polyline:**
  - Run: `Chute` (`index.csv`: `893 m` length, `327 m` vertical drop, `2154 m -> 1826 m`, `20.1 deg` avg, `29.5 deg` max, `84 m` wide, `way/374339379` + `way/374339380`).
  - `features.json` main fall-line (`Chute`, `members[0]`, 19 points):
    - Start node (`osmId: 3777164718`): `{ x: 1360.32, y: 553.63, z: 1361.68 }` (~2,154 m ASL)
    - Finish node (`osmId: 3777165607`): `{ x: 1479.08, y: 226.58, z: 506.18 }` (~1,826.6 m ASL, near upper lot / old lodge clearing)
    - *(Exclude `members[1]` side branch `454.26 -> 412.23` from the main race corridor.)*
- **Start Gate & Finish Line:**
  - **Start Gate:** Placed 15 m downslope of `Chute` point 0 (`x: 1360.32, y: 553.63, z: 1361.68`), width `14 m` perpendicular to tangent, 3-2-1 countdown launch with standing start (no skate-boost exploit past line before 0.0 s).
  - **Speed Trap Zone:** `20 m` radar gate positioned at the steepest sustained mid-lower pitch (approx. 65%–75% along polyline, where skier nears terminal velocity before runout). Displays live "RADAR" flash in HUD.
  - **Finish Line:** Placed `20 m` upslope of `Chute` point 18 (`x: 1479.08, y: 226.58, z: 506.18`), width `24 m` flanked by retro red/orange bamboo banners & an old-lodge silhouette checkpoint.
- **Timing & Speed-Trap Scoring:**
  - Dual record tracking: **Elapsed Time** (`ms` precision, start gate cross -> finish line cross) AND **Peak Speed Trap** (`km/h` max recorded inside the speed-trap zone, plus run-wide `peakSpeedKmh`).
  - Two leaderboard tabs / medals: *Fastest Time* (gold/silver/bronze thresholds, e.g. Gold `< 28.0 s`) and *Top Speed* (NPC ghost target: **Eric Pehota — 151.0 km/h**).
  - Optional "Outlaw Style" modifier/toggle (Stu/community nod): straight-lining bonus if player completes the entire run with `< 2` carves/brakes (`0` brakes = "Full Tuck / Stanfield Mode" badge).
- **Leaderboard Fields:**
  - `rank`, `playerName`, `elapsedMs`, `trapSpeedKmh`, `peakSpeedKmh`, `brakeCount`, `equipmentPreset` (`standard` | `225cm_straight`), `cleanRun` (`boolean`), `timestampUtc`.
- **Safety & Bail Rules:**
  - Corridor width enforcement: leaving the `42 m` half-width corridor around the `Chute` polyline triggers a `3.0 s` out-of-bounds warning, then `DNF (Out of Bounds)`.
  - Crash/Bail rule: any ragdoll/bail (`state === 'bailed'`) between Start and Finish immediately invalidates the run (`DNF - Bailed`), prevents cheese-sliding across the finish line, and offers one-tap `R` quick-restart at the Start Gate.
  - Braking in runout *after* Finish Line is free and encouraged (runout stops before tree line).
- **Data Needed in Repo:**
  - Event config JSON (`events/shoot-the-chute.json`) referencing `Chute` `members[0]` polyline, gate widths, trap `[tStart, tEnd]` normalized `[0.65, 0.72]`, NPC benchmark `151.0 km/h`, and localStorage/API leaderboard schema.

---

## Priority Event #2: Mars Downhill / Apex Speed Series (FIS Gunbarrel Downhill Track)

- **Real-Event Basis & Verification Status:**
  - *Verified:* "Mars" refers to **Mars Canadian Junior Championships (Mars J1 Nationals, Jan 2004 at Apex)** and the **Mars BC Cup – Apex Speed Series (Feb 2005 at Apex)**, alongside Apex's **FIS / Nor-Am / Pontiac GMC / Miele Cup** downhill & Super-G speed races (1998–2013).
  - *Verified Track Specs:* FIS Downhill homologation `9460/01/10` (and earlier `7414-001-04`, `4810-321-97`) is **2,002 m long**, **532 m vertical drop** (`Start 2175 m -> Finish 1643 m`), **36 gates**, with **2 jumps** and typical top speeds around **120 km/h** and winning times `1:19.52–1:21.65` (referred to in BC Alpine & Revelstoke reports as the **"Gunbarrel" downhill**).
  - *Marked as Stu's Description / Unverified Details:* Exact run-segment junctions connecting Quickdraw summit (`2175 m`) through Gunbarrel (`2119->1862 m`) down to the village base (`1643 m`), exact gate coordinates, and whether the 2004 Mars J1 event itself included Downhill or only Super-G + tech while 2005 Mars BC Cup ran Downhill, are not confirmed in public FIS tables. Course polyline below combines the verified `2175->1643 m` altitude endpoints with the game's `Grandfather's Trail` / `Ridge Run` -> `Gunbarrel` -> `Wild Bill` / lower base geometry (marked as reconstructed from Stu's brief + FIS homologation).
- **Run / Course Polyline:**
  - Composite 3-segment speed polyline (~2,000 m, `532 m` drop):
    1. **Summit Launch (`2174 m -> 2119 m`):** Upper `Ridge Run` / `Grandfather's Trail` from Quickdraw top (`{ x: 1553.67, y: 573.59, z: 1551.44 }`) traversing west to `Gunbarrel` top (`{ x: 1076.29, y: 518.92, z: 1182.34 }`).
    2. **The Gunbarrel Fall-Line (`2119 m -> 1862 m`, `514 m`):** `Gunbarrel` (`4064587952 -> 4064587970`, avg `26.6 deg`, max `40.7 deg`) — high-speed steep pitch with **2 downhill compression jumps**.
    3. **Lower Speed Runout (`1862 m -> 1643 m`):** Connector across to `Wild Bill` (`{ x: 2153.75, y: 236.18, z: 1277.07 }` -> `{ x: 2901.27, y: 23.87, z: 883.78 }`) or `Okanagan Run` finish corral (`y ~ 43`, `1643 m`) near the village/timing hut. *(Recommend smoothing an explicit `mars_downhill_course` polyline in `events/` using `Ridge Run -> Gunbarrel -> Wild Bill` or `Okanagan` finish so the total horizontal+slope path hits `2,002 m`.)*
- **Start Gate & Finish Line:**
  - **Start Gate (Summit Start House):** Positioned at `2175 m` summit (`{ x: 1553.67, y: 573.59, z: 1551.44 }`), with optional "High-Wind Backup Start" (`2 gates down`, referencing the 2004 Pontiac GMC Cup wind delay!).
  - **Gates (36 Red/Blue Downhill Panel Gates):** Double-pole safety-netted speed gates spaced `40–75 m` apart; wide-radius Super-G/DH turns on the upper ridge, straight fall-line speed gates down Gunbarrel, and two flagged mandatory **Jump Zones** (must pass between jump-crest markers).
  - **Speed Trap:** Placed at the bottom of the Gunbarrel steep pitch (`~1,870 m` ASL) targeting `115–130 km/h`.
  - **Finish Line (Timing Corral):** Positioned at `1643 m` base elevation (`y ~ 43`), `28 m` wide finish banner + red safety fencing.
- **Timing & Speed-Trap Scoring:**
  - Official Alpine timing (`0.01 s` precision) + **2 intermediate split clocks** (Split 1: entry to Gunbarrel; Split 2: exit of Gunbarrel) + **Speed Trap (`km/h`)**.
  - Target benchmarks from real FIS results: Gold `< 1:20.00` (matching Conrad Pridy `1:19.52` / Jeffrey Frisch `1:19.74`), Silver `< 1:25.00`, Bronze `< 1:32.00`.
  - Gate penalty rule: missing a DH panel gate (`wrong side of pole`) = immediate `DSQ` (classic FIS rule), with clear directional arrow HUD pointing to next gate!
- **Leaderboard Fields:**
  - `rank`, `playerName`, `totalTimeMs`, `split1Ms`, `split2Ms`, `trapSpeedKmh`, `maxSpeedKmh`, `gatesCleared` (`36/36`), `jumpsCleared` (`2/2`), `dqReason`, `windMode` (`standard` | `2004_wind_start`), `timestampUtc`.
- **Safety & Bail Rules:**
  - B-Net boundary walls along Gunbarrel steep section: hitting B-net at `> 70 km/h` triggers a high-speed catch/slowdown or bail (`DNF`), while grazing at low angle deflects skier back on course with speed loss (`-35%`).
  - Compression jump landings: landing off-axis (`> 35 deg` yaw or un-tucked nose-heavy) triggers bail (`DNF - Crashed on Jump`). (Also ties directly into fixing the known Gunbarrel big-drop brake-flip bug!)
- **Data Needed in Repo:**
  - Explicit 36-gate waypoint array `{ x, y, z, width, color: 'red'|'blue', isJump?: boolean }`, course polyline (`2,002 m`), split indices, and `B-net` spline offsets.

---

## 14 Additional Game Event & Challenge Ideas

### 3. Timber Tour Slopestyle (Claim Jumper)
- **Real-Event Basis:** BC Freestyle Timber Tour & Super Youth Challenge (hosted at Apex 2012–2017; 140–180+ youth athletes) & 2011 Shred Stock Slopestyle on **Claim Jumper**.
- **Run / Location:** `Claim Jumper` (`570 m`, `154 m` vert, `1860->1706 m`).
- **Mechanics:** 6-feature judged slopestyle line (3 rail/box features + 3 progressive 20–50 ft jumps including step-up). Single-run or best-of-2 format; FIS/BC Freestyle style scoring (Execution, Difficulty, Amplitude, Variety, Clean Landings, 0–100 scale). Must hit >= 4 of 6 features cleanly; bailing ends run score at last clean feature.
- **Game Data Needed:** Ordered feature hitboxes in `Claim Jumper` (`features.json`), takeoff/landing zones for Trick/Press engine, variety multiplier tracker (no repeat tricks).

### 4. Nor-Am Single & Dual Moguls (Kristi's Run)
- **Real-Event Basis:** FIS Freestyle Nor-Am Cup & Toyo Apex Classic Canada Cup (2008–2026) on **Kristi's Run** (220 m, 4-lane, constant 26° pitch, 2 jumps, 7 judges).
- **Run / Location:** `Kristi's Run` (`index.csv`: `422 m` total, event arena on the lower/middle `220 m` 26° pitch).
- **Mechanics:** Procedural mogul bump field + 2 aerial kickers (top air & bottom air). Dual Moguls mode spawns an AI ghost/opponent in the adjacent lane! Score = Turns (60% — rhythm & fall-line carving over bumps without popping out) + Air (20% — 2 distinct upright/inverted tricks) + Speed (20% — pace time).
- **Game Data Needed:** Bump-field heightmap displacement overlay on `Kristi's`, lane centerlines (Lane A / Lane B), 2 kicker meshes, pace-time constant.

### 5. FIS World Cup Aerials Site & Big Air
- **Real-Event Basis:** 2006 & 2007 FIS Freestyle World Cup Aerials (`7247.004.07` Aerial Site) & Timber Tour Big Air.
- **Run / Location:** `Aerial Site` adjacent to `Kristi's Run` / T-Bar base.
- **Mechanics:** Steep inrun -> vertical aerials kicker (double/triple flip + twist timing challenge) -> steep soft landing hill. Two-jump cumulative score (Degree of Difficulty `DD` × Judge Form `0–10` × Landing Cleanliness).
- **Game Data Needed:** Aerials kicker mesh (`4 m` vertical lip), landing apron steepness (`~37 deg`), DD lookup table for flips/twists.

### 6. 2006 World Cup Super-Pipe Revival (Okanagan Run)
- **Real-Event Basis:** 2005-built dirt-wall Super-Pipe on **Okanagan Run** (16° bottom pitch), which hosted Sarah Burke & Kalle Leinonen's 2006 World Cup Finals halfpipe and the 2007 World Cup.
- **Run / Location:** `Okanagan Run` (`577 m`, `192 m` vert, `1879->1687 m`).
- **Mechanics:** 18-ft halfpipe walls carved into lower Okanagan Run. 45-second / 6-hit run scoring Amplitude (height above lip) + Rotation/Grab variety + Clean re-entry angle.
- **Game Data Needed:** Halfpipe U-channel terrain modifier along lower `Okanagan Run`, lip-trigger planes for wall-to-wall transfer & air detection.

### 7. Teck Okanagan Zone "Slalom Factory" (Okanagan Run)
- **Real-Event Basis:** Teck Okanagan Zone & BC Winter Games makeup Slalom (2015–2026; 6-lane slalom factory off T-Bar, ~800 race runs/weekend; FIS `13111/02/19` `1911->1729 m`).
- **Run / Location:** `Okanagan Run` (T-Bar access for instant 45 s lap reset).
- **Mechanics:** Rapid 2-run Slalom (`40–60` tight single/hairpin/flush gates). Combined 2-run time wins; straddling/missing a gate = `DNF`. Features optional "Random Start Order" (2025 Teck trial) where snow ruts degrade slightly with start bib number!
- **Game Data Needed:** Compact slalom gate generator along `Okanagan Run`, rut/wear surface friction state per bib wave.

### 8. Old Mill Giant Slalom & Timing Hut Time Attack
- **Real-Event Basis:** Teck Open U16 / Can-Am Giant Slalom on **Old Mill** (2014–2025) & Apex Ski Club's 2015 state-of-the-art timing hut.
- **Run / Location:** `Old Mill` (`888 m`, `228 m` drop, `1883->1654 m`, avg `14.4 deg`).
- **Mechanics:** 25–30 GS panel gates down full length of Old Mill finishing at the Ski Club Timing Hut. Rewards clean carving (carve-angle retention) and penalizes skidding/braking with time loss.
- **Game Data Needed:** GS gate layout on `Old Mill`, Timing Hut landmark prop at finish (`~1654 m`), carve-efficiency telemetry.

### 9. Skier & Boardercross Sprint (Spruce Hollow)
- **Real-Event Basis:** Apex Skier/Boardercross track (2013–2018, 5 m / 15 ft banked walls) located skier's right off T-Bar above **Spruce Hollow** — plus Reece Howden's Apex roots.
- **Run / Location:** `Boarder Cross` (`features.json`: `2047,245,1014 -> 2427,134,990`) feeding into `Upper Spruce Hollow`.
- **Mechanics:** 4-racer heat format (player vs 3 AI racers). Start gate drop -> rollers (pump for speed boost) -> 5 m banked berms -> step-up -> finish. Contact/drafting physics; top 2 advance to final heat.
- **Game Data Needed:** Bermed track heightmap/spline along `Boarder Cross`, pump-timing bonus on rollers, 3 AI spline followers.

### 10. Freaky Friday Night Park Jam (Okanagan Park)
- **Real-Event Basis:** Freaky Friday Night Skiing & Night Park (`4–9 pm`, `$7.50` promo; `Okanagan Park` `lit=yes` in OSM; 2026 ElleBoard/GROM cannon jam).
- **Run / Location:** `Okanagan Park` + `Okanagan Run` under night lighting.
- **Mechanics:** Night-sky + floodlight shader mode; 10-minute timed jam session hitting 5–15 ft roll-overs, rails, and the bottom **Cannon Box/Rail**. Combo multiplier increases if you chain the cannon hit cleanly at the end of a park lap.
- **Game Data Needed:** Night lighting preset (`emissive` floodlight poles along `Okanagan Run` & `Okanagan Park`), Cannon feature mesh, session timer (`10:00` countdown).

### 11. Shredstock / Brewski Village Rail Jam
- **Real-Event Basis:** 2011 Shredstock & 2025–2026 Brewski Village Rail Jams near Gunbarrel Saloon (custom 20-ft round down bar & roller-coaster rails).
- **Run / Location:** Village base plaza outside Gunbarrel Saloon (`~1640 m`).
- **Mechanics:** Short hike-and-jam arena (fast respawn at top of village drop-in): 3 features (20-ft round down bar, roller-coaster rail, snow-step bonk). "Best Trick" & "Best Bail" (2017 Pentagon Rail Jam nod!) side-awards.
- **Game Data Needed:** Temporary village jam arena prop set near Gunbarrel building in `features.json`, quick-hike teleport loop.

### 12. Dummy Downhill (Aerial Site Closing Day)
- **Real-Event Basis:** Annual closing-weekend **Dummy Downhill** (2022–2025, ~500 spectators): homemade dummies launched off the Aerial Site kicker flying **60–70 vertical ft** before crash landing.
- **Run / Location:** `Aerial Site` / lower `Kristi's Run` outrun.
- **Mechanics:** Comedy physics mini-game! Pick a dummy build (lighter/aerodynamic vs heavy/chaotic, e.g. "Couch on Skis", "Barrel Rocket", "Vintage 200 cm"), point straight down the Aerial Site inrun, trigger launch timing at lip, and score **Flight Distance (m)** + **Peak Height (ft)** + **Crash Impact Chaos (ragdoll parts scatter)**.
- **Game Data Needed:** Dummy vehicle/ragdoll prefab variants, Aerial Site kicker launch ramp, distance tape & crowd spectator cluster at village apron.

### 13. 50th Anniversary "Match Your Time" & Retro Day
- **Real-Event Basis:** Dec 10, 2011 Apex 50th Anniversary *Match Your Time* race (bonus points for 200+ cm skis) & Mar 16, 2024 Retro Day.
- **Run / Location:** `Maverick` or `Old Mill` (`888 m` cruiser).
- **Mechanics:** Two-run consistency challenge! Run 1 sets your personal benchmark time; Run 2 challenges you to match Run 1 as closely as possible (`|t2 - t1|` minimized, e.g. `< 0.25 s` delta = Gold), with a score bonus for equipping **220 cm Straight Skis** (slower turn radius, higher top speed) & neon 80s suit.
- **Game Data Needed:** Straight-ski physics preset (wider turn radius, low edge grip), two-run delta clock, retro skin toggle.

### 14. Penticton Ramada Elevator Race (Final Ski Descent)
- **Real-Event Basis:** 2014–2015 Elevator Race (lake-to-peak 7-stage endurance race finishing past downhill ski gates at Apex village).
- **Run / Location:** `Grandfather's Trail` (`4,460 m`, `492 m` vert) or summit-to-village sprint finishing through village gates.
- **Mechanics:** Stamina-constrained summit-to-village descent! Skier begins with low stamina ("after 6 endurance legs from Okanagan Lake") — tucking & smooth GS turns conserve stamina, while sharp hockey-stops or bumps drain it; cross the village finish gate before stamina hits zero.
- **Game Data Needed:** Full `Grandfather's Trail` polyline, stamina meter drain/regen mechanic, village finish arch.

### 15. Christmas Eve Torchlight Parade (Night Formation)
- **Real-Event Basis:** Annual Dec 24 Torchlight Parade & Dec 31 NYE Fireworks on **Okanagan Run**.
- **Run / Location:** `Okanagan Run` (`577 m`, `192 m` vert).
- **Mechanics:** Night formation challenge! Lead or follow a snake of 12 AI skiers holding glowing red flares down Okanagan Run. Stay inside the formation corridor at steady pace (`25–35 km/h`) without overtaking the lead patrol skier or dropping flares; triggers village fireworks show at the bottom!
- **Game Data Needed:** Night lighting preset, particle flare emitter attached to ski poles, AI snake-leader path + fireworks particle burst at finish.

### 16. Easter Egg Hunt & Prospector Progression Circuit
- **Real-Event Basis:** Mar 31, 2024 Apex Easter Egg Hunt (mountain-wide hidden items) + Little Nuggets -> Prospector -> Claim Jumper park progression.
- **Run / Location:** `Easy Rider / Little Nuggets` -> `Prospector` -> `Claim Jumper` + Quickdraw/Stock's hidden stashes.
- **Mechanics:** Open-mountain scavenger & progression circuit: collect 12 hidden golden eggs tucked along tree-line entrances, cat tracks, and park lips (Little Nuggets box, Prospector 20-ft jump, Claim Jumper hip, Chute entrance) within one lift-day timer.
- **Game Data Needed:** 12 collectible trigger spheres with world coords, persistent collection HUD, progression badge unlock.

## Stu's local knowledge: Shoot the Chute finish (added 2026-11-24)
Source: Stuart Johnston (Apex freestyle coach). He says it was before his time and is passing on local lore.
- The upper parking lot used to be the bottom of the old Gunbarrel. Racers straight-lined from the top of the mountain down through the Chute and stopped in front of the upper parking lot, where the cars parked and the crowd hung out.
- Game design implication: put the start near the summit, set the finish line and speed trap just above the upper lot, and add a run-out and stopping zone in front of the lot. Line the finish area with spectators and parked cars for atmosphere.
