# Playtest telemetry

A recorder for private test builds, so a playtest can be read back afterwards: how the controller was used, where the rider stalled or crashed, what the camera did. It is not part of the live game.

## Off by default

The recorder is only built in when the build is made with `VITE_TELEMETRY=1`:

```
cd game
VITE_TELEMETRY=1 npm run build     # private test build: records
npm run build                      # the live game: no recorder
```

`vite.config.ts` turns that into the constant `__TELEMETRY__`. When it is false, `loadTelemetry` (`src/telemetry/index.ts`) returns null and the bundler drops the recorder chunk, so the live bundle has no recording code in it at all. The GitHub Pages workflow never sets the variable. Check a build with `grep -l telemetry-pill -r dist` (no match means no recorder).

For local play with the recorder: `VITE_TELEMETRY=1 npm run dev`.

## What is recorded

`src/telemetry/analyze.ts` holds the format (column lists and flag bits) with a comment on every column. In short, three tracks, all timed in milliseconds since the page loaded:

- **State, 10 times a second**: position, speed, ski heading and travel direction, the fall line and slope underfoot, sim mode, flags (on the snow, switch, tuck, poling, crashed, on a rail, on a lift, in a menu, in the opening film, in the air), snow type, edge angle, skid and grip, the input the sim was given, and the camera: view mode, distance and height from the rider, how far it looks off the direction of travel, pitch, field of view, where the rider's chest is on screen, whether the snow hides the rider, the camera's height above the ground, how bumpy the snow is along the line of travel, frame time (mean and worst), and the run or area underfoot.
- **Raw input, the frame it changes**: both sticks, both triggers, every controller button, and the play keys. This keeps stick and button timing.
- **Events**: menus and screens opened, clicks on buttons (by label), actions (pause, restart, camera, map...), lift rides and skips, the opening film, spawns, takeoffs (speed, pop charge, switch) and landings (air time, spin, flip, grab), tricks with their grade, crashes with what came before, trick cards and control prompts as they appear, results cards, input device changes, settings changes, long frames, script errors, and marked moments.

**Marking a moment**: press F, or click the left stick, when something feels wrong. The report lists every mark with where it was and what had just happened.

Not recorded: anything typed into a field, anything outside the game page, audio or video.

## Where it goes

- In a claude.ai artifact published with the `db` capability, chunks are saved to the artifact's database every 15 seconds, when a menu opens and when the tab is hidden: `tele/<session id>` (header) and `tele/<session id>/chunks/<0000>` (gzipped JSON, base64). Nothing for the player to do.
- Everywhere else (local dev, or if the database refuses), the recording stays in the page and the pill's **Download** button saves it as `skiscrapex-playtest-<id>.json`.

A pill at the bottom of the menus says which of the two is happening. It is hidden while skiing.

The preview artifact needs `capabilities: { db: {}, downloads: true }` when it is published.

## Reading a session

```
cd game
node scripts/telemetry-report.mjs <download file, or folder of database documents> --out report.md --json analysis.json
```

The report opens with findings (stalls and their causes, the skis coming round, switch riding that ended early, crashes by cause, jumps and bails, camera trouble by terrain, controller habits such as an unused stick being pushed or the brake catching in turns, restarts, frame rate, marked moments) and follows with a table for each. `--tracks tracks.json` writes the decoded samples and events for looking at one moment by hand.

The thresholds in `findingsFor` are first guesses. Tune them against real sessions.

## Code

- `src/telemetry/index.ts`: the switch and the small interface `main.ts` calls once a frame.
- `src/telemetry/recorder.ts`: watches the game from outside. Its one touch on the game is wrapping `controls.takeActions` to see actions.
- `src/telemetry/sink.ts`: memory, artifact database, download.
- `src/telemetry/analyze.ts`: format and analysis, no imports, shared with the tests and the report script.
- `tests/telemetry.test.ts`: the analysis on made-up sessions.
