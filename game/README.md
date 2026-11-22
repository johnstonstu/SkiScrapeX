# SkiScrapex game

Vite + TypeScript + Three.js 0.180. See the [root README](../README.md) for controls and setup, and [docs/status.md](../docs/status.md) for the layout of `src/` and open issues.

```bash
npm ci
npm run dev
npm test
npm run build
```

`public/data/` holds the generated Apex files (fetch the `data` branch into it). Without it the page falls back to the synthetic slopes, which are also available with `?dev`.

Tunable ski behaviour lives in `PHYSICS` in `src/sim/constants.ts`. The research behind the model is in `research/`.
