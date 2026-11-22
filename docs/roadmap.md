# Roadmap to 1.0

Written 2026-11-21 at v0.5.0. SkiScrapex is a browser skiing game of Apex Mountain Resort built from real LiDAR and map data. The goal for 1.0 is a game a stranger can open on a phone or a laptop, understand in a minute, and want to come back to: Apex that locals recognise, skiing that feels good on groomers, in powder and in the park, and enough to do to fill a few weeks of casual play.

There is no deadline. Milestones are ordered by what unblocks the most, and each one ends with a playtest, a merge to `main` and a version tag (see `CHANGELOG.md`).

## Where we are (v0.5.0)

Working: real terrain at 5 m with 2 m near the skier, canopy forest with six species, OSM plus LiDAR-traced runs, four lifts with rides, village with buildings, lots, decks and the summit hut, three snow types, carving and steep-slope physics tuned against measured skier data, freestyle with grabs, spins, flips, corks, rails and graded landings, five parks with six layouts, a styled rider with a small creator, follow, first-person and orbit cameras, touch controls, procedural audio.

Missing for a release: a front door (title screen, settings, onboarding), goals to play for, correct names for the traced runs, hosting, a tested mobile experience, and permission and licence checks for using Apex's name and data.

## Short term

### v0.6: Names, feel and settings
- Rename the 21 traced runs from local knowledge or the trail map (`world/runOverlay.ts`); add gladed areas the canopy test misses.
- Settings menu: graphics quality (low, medium, high, with the mobile path as low), shadows, view distance, steering sensitivity, invert pitch, sound and music volume, camera options. Saved locally.
- Playtest pass on carving, steeps and powder, then retune from notes. Add SnowGlider-style carve commitment if clean carving needs more reward.
- Gamepad support (left stick edge and tuck or brake, buttons for pop and grab, right stick for air tricks).
- Fix whatever the first proper playtests find.

### v0.7: A reason to ski
In progress on `v0.7-goals`: title screen, timed runs, slalom, park score attack, results, run checklist, nuggets and rewards are in. Still to come: a reward for more of the outfit, and tuning medal targets from playtests.

- Title screen with Continue, Free ski, Challenges and Rider.
- Challenges: timed runs on named runs with medal times, a slalom gate course on a groomer, park score attacks per layout, a "ski every run" checklist, hidden collectibles (gold nuggets, to fit the theme) across the mountain.
- Results screen after each run: time, top speed, distance, tricks, best comparison.
- Local profile: bests, medals, unlocks (ski graphics and outfit pieces as rewards).

### v0.8: Onboarding and mobile
- First-run tutorial on the bunny hill by the Magic Carpet: steering, stopping, carving, jumping, one grab. Skippable.
- Context hints (first powder, first park approach, first lift).
- Real-device mobile pass: frame rate on a mid-range Android phone and an older iPhone, touch layout options (size, opacity, left-handed), tilt steering as an option, battery and thermal checks.
- Progressive loading: show the mountain while the forest and village build; compress the data (Brotli) and keep first load under about 10 MB.

## Mid term

### v0.9: Beta
- Hosting: GitHub Pages on a public repo or another static host (Cloudflare Pages or Netlify work with a private repo). Custom domain if wanted.
- Installable as a PWA with offline play after the first load.
- Accessibility: remappable keys, colour-blind-safe run colours and hints, reduced motion option (camera shake, chatter), readable text sizes.
- Crash-free sessions on the test device list; error reporting to the console overlay.
- Public beta with a feedback link; at least five outside playtesters including Apex regulars.

### Content and world
- Time of day and weather: bluebird, overcast flat light, snowfall days with fresh powder depth, sunset. Snow conditions per day (fresh, packed, icy).
- Grooming: corduroy only on freshly groomed runs, moguls forming over a session on ungroomed blacks.
- Village life: lift lines and a few NPC skiers on runs, lights at night, smoke from chimneys.
- Landmarks checked against photos: Gunbarrel Saloon, day lodge, ticket office, Quickdraw terminals, patrol signage, run signs matching Apex's real boards.
- Full resort crop if useful (Wildside and the backside edges), and Apex Mountain's antenna peak on the horizon.

### Skiing depth
- Rider balance: a visible balance cue (lean too far and you wash out) instead of hidden numbers.
- Powder: face shots and spray that scale with depth, sluffs on steep faces.
- Park: halfpipe or quarter pipe if Apex ever had one, more rail shapes, butters and presses, spin direction stats, trick variety bonus.
- Crashes: ragdoll-style tumbles that depend on speed and angle, yard sales.
- Replay: a short instant replay after a run or a trick, shareable as a clip later.

## Release: v1.0

All of these must be true:
1. A new player can start, learn and finish a run without help, on desktop and phone.
2. 60 fps on a mid-range laptop at medium settings; 30 fps or better on the agreed mid-range phone at low.
3. No known crash or soft-lock; save data survives updates.
4. Every named run is correct, or labelled as approximate.
5. Credits and licences complete: LidarBC (OGL-BC), NRCan (OGL-Canada), OpenStreetMap (ODbL attribution, and share-alike for any database we publish derived from it), third-party code notices.
6. Permission from Apex Mountain Resort to use its name and likeness, or a rename (for example "Apex-inspired") if they decline. Avoid their logo and trail map artwork either way.
7. Privacy: no tracking without consent; if leaderboards exist, a simple privacy note.
8. A short trailer or GIF set and a landing page.

## Long term (after 1.0)

- Online leaderboards for challenges (needs a small backend and cheat checks, for example replaying the input log through the deterministic sim).
- Ghost racing against your best run or a friend's.
- Multiplayer free ski (a few riders sharing a mountain) if there is interest.
- Snowboarding as a second discipline (the physics already models edges; boards need their own stance and tricks).
- Other Okanagan or BC hills built the same way (Big White, Mount Baldy, Sun Peaks) once the pipeline is generalised: the data scripts already take a crop and an OSM area.
- Seasonal events tied to real Apex events (Shoot the Chute race).
- Desktop build (Tauri or Electron) and app-store builds if the web version does well.

## Engineering track (runs alongside)

- Keep `main` releasable: tests and build pass on every merge, a smoke test (load, ski, park, ride, dev slopes, rider lab) before tagging.
- Grow the test suite where bugs appear; keep the physics bots (`npm run tune`) as the regression net for feel.
- Performance budget per release: track draw calls, triangles, load time and memory with `?perf` at the five standard spots, and record them in `docs/status.md`.
- Split the ~700-line modules (`sim/skier.ts`, `render/rider/skierView.ts`) when they next change substantially.
- Move world building (forest, village, overlays) into a Web Worker if load time grows.
- Revisit the data pipeline: one script entry point, cached tiles, and documented steps to add a new resort.

## Open questions

- Which runs are W1 to W6 and the L-numbered cuts?
- Is a public repo acceptable (free Pages hosting), or should we use another static host?
- Who should we contact at Apex about using the name, and is that worth doing before a public beta?
- Which phones should be on the test list?
