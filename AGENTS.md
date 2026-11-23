# SkiScrapex

Read [the README](README.md), [docs/status.md](docs/status.md), [docs/roadmap.md](docs/roadmap.md), [docs/workplan.md](docs/workplan.md) (the next milestones and how to work on them) and [docs/handoff.md](docs/handoff.md) (development notes) first.

- One app: `game/`. The ski simulation (`game/src/sim/`) does not import Three.js and only reads `sampleTerrain(x, z)`. World data parsing (`game/src/world/`) is also Three.js free and unit tested.
- Use metres, +X east, +Y up and +Z south. Keep the terrain manifest's origin and vertical datum when changing the crop.
- Never commit raw GeoTIFFs or generated exports to `main`. The data workflow publishes them to the `data` branch with source tile ids, checksums and attribution in `terrain.json`.
- Licences: MIT, Apache-2.0, BSD and Zlib code may be reused with a notice in `game/THIRD_PARTY_NOTICES.md`. Unlicensed and GPL projects (SnowboardAnywhere, MapPacker, alpine-challenge, Extreme Tux Racer, Soul Ride) are reference only.
- Work on a branch; merge to `main` only at milestones the maintainer has played. Each merge bumps `game/package.json`, adds a `CHANGELOG.md` entry and gets a `vX.Y.Z` tag.
- When the maintainer is testing a branch locally, sync changed files to their checkout after each batch of work; commit only at milestones.
- Run `npm test` and `npm run build` in `game/` before pushing. Fetch the data branch into `game/public/data` so the Apex run test runs too.
- Do not use em dashes in documentation.
