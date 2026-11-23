# Roadmap to 1.0

Written 2026-11-21 at v0.5.0, phases revised 2026-11-22 at v0.8.6. SkiScrapex is a browser skiing game of Apex Mountain Resort built from real LiDAR and map data. The goal for 1.0 is a game a stranger can open on a phone or a laptop, understand in a minute, and want to come back to: Apex that locals recognise, skiing that feels good on groomers, in powder and in the park, and enough to do to fill a few weeks of casual play.

There is no deadline. Milestones are ordered by what unblocks the most, and each one ends with a playtest, a merge to `main` and a version tag (see `CHANGELOG.md`).

## Where we are (v0.8.6)

Live at https://johnstonstu.github.io/SkiScrapeX/ from the public repo, deployed from `main` on every merge.

Working: everything in the 0.5 list (real terrain, canopy forest, OSM and traced runs, lifts, village, physics, freestyle, parks, rider, cameras, touch, audio) plus a title screen, settings, gamepad, timed runs, slalom, park score attacks, the run checklist, gold nuggets, results and unlocks (0.7), a first-run tutorial and tips, snowboarding, other skiers, official run names from the trail map, faster loading, and the turn and camera feel passes from Stu's playtests (0.8.x).

The near-term order of work, with checklists, is in `docs/workplan.md`. The visual review of 0.8.6 (`docs/review/apex-visual-improvements.md`, 47 items) drives most of the next two phases. Each item is a GitHub issue with a phase label.

## Phase 1: 0.8.x wrap-up

Small, safe fixes that do not need new art or data.

- P0 leftovers from the review: trees fading out of the sight line to the skier instead of ghosting near the camera (0.8.7), the landing ring hidden in first person (0.8.7), the "Dude ney Trail" spelling and the other official spellings, with saves carried over (0.8.7).
- Low graphics that saves real work: shadows Auto, On or Off, with Auto off on Low (0.8.7).
- Real-device phone pass: frame rate on a mid-range Android phone and an older iPhone, touch layout size and opacity, left-handed layout.
- Compressed data: store heights as differences from a plane through their neighbours (2 m grid 3.9 MB to about 1.4 MB gzipped, 5 m grid 1.1 to 0.36 MB), with an escape code for cells that overflow 16 bits. Changes `scripts/build-terrain.py`, the loader and the data branch together.
- Cleanup: delete merged and stale branches, resolve PR #3, name the Wildside cuts W1 to W6.

## Phase 2: 0.9 "looks like Apex"

The P1 items of the visual review: the things a local would notice first.

- Runs: wider groomers where the trail map shows them, cleared lift lines, the summit area, mogul fields on the right runs, real glades with thinned trees.
- Trees: species mix and density checked against photos, snow load on branches.
- Lifts: tower and terminal hardware closer to Quickdraw and Stock's, chairs with the right seat count.
- Village: hero buildings (day lodge, Gunbarrel Saloon, ticket office) modelled from photos, roof shapes and snow, amenities and signage.
- Light and life: better sky and sun, chimney smoke, people in the village, lift lines.

## Phase 3: 0.10 beta

- Installable as a PWA with offline play after the first load.
- Accessibility: remappable keys, colour-blind-safe run colours and hints, reduced motion, readable text sizes.
- An in-game feedback link and error capture to a visible console overlay.
- CONTRIBUTING notes and issue templates for the public repo.
- At least five outside playtesters, including Apex regulars.

## Phase 4: 0.11 to 0.12, a living mountain

- Weather and time of day: bluebird, flat light, snowfall days with fresh powder, sunset, night skiing under the lights.
- Riders on the chairs, ski patrol, snowcats grooming in the evening, corduroy only on fresh grooming, moguls forming over a session.
- Crashes with tumbles and yard sales, and a short instant replay.
- Skiing depth: visible balance cue, face shots and sluffs in powder, butters, presses and more rail shapes.

## Phase 5: 1.0

The release checklist below, plus Apex's permission (or a rename), complete credits, a trailer or GIF set and the performance targets met on the test devices.

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
- Other Okanagan or BC hills built the same way (Big White, Mount Baldy, Sun Peaks) once the pipeline is generalised: the data scripts already take a crop and an OSM area.
- Seasonal events tied to real Apex events (Shoot the Chute race).
- Desktop build (Tauri or Electron) and app-store builds if the web version does well.

## Engineering track (runs alongside)

- Keep `main` releasable: tests and build pass on every merge, a smoke test (load, ski, park, ride, dev slopes, rider lab) before tagging.
- Grow the test suite where bugs appear; keep the physics bots (`npm run tune`) as the regression net for feel.
- Performance budget per release: track draw calls, triangles, load time and memory with `?perf` at the five standard spots, and record them in `docs/status.md`.
- Split the ~700-line modules when they next change substantially. The rider was split in 0.8.4 (`skierModel.ts` and `skierView.ts`); `sim/skier.ts` is still to do.
- Move world building (forest, village, overlays) into a Web Worker if load time grows.
- Revisit the data pipeline: one script entry point, cached tiles, and documented steps to add a new resort.

## Open questions

- Which runs are W1 to W6 and the L-numbered cuts?
- Who should we contact at Apex about using the name, and is that worth doing before a public beta?
- Which phones should be on the test list?
