# Third-party notices

## ski-coach

`src/sim/carve.ts` is a TypeScript port of `js/physics.js` from
[clarajzt/ski-coach](https://github.com/clarajzt/ski-coach).

```
MIT License

Copyright (c) 2026 clarajzt

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## meshoptimizer

The game bundles three.js's copy of the meshoptimizer decoder
(`three/addons/libs/meshopt_decoder.module.js`) to read the compressed rider
model, and `scripts/pack-rider.mjs` uses the `meshoptimizer` npm package to
write it. Both are [meshoptimizer](https://github.com/zeux/meshoptimizer) by
Arseny Kapoulkine, MIT License, Copyright (c) 2016-2025 Arseny Kapoulkine.
The full MIT text is the same as the ski-coach notice above.

## Not copied

[alpine-challenge](https://github.com/mikaelguillin/alpine-challenge) and
[SnowboardAnywhere](https://github.com/drewkeriazes-personal/SnowboardAnywhere)
have no licence. The grip-versus-skid behaviour and the resort-pack notes in
`research/` are original write-ups of those ideas. No code from either project
is in this folder.

[vadym-vorotilin/snowboard-physics](https://github.com/vadym-vorotilin/snowboard-physics)
is MIT and was read while choosing the model. None of its source is copied here.
The kinematic stepper in `src/sim/skier.ts` is original.

## Snow effects: ideas consulted, not copied

- **SNOWFLOW** by Noniv (`Noniv/snowflow_demo`, MIT) is a WebGPU / Babylon.js snow demo. The track module uses the same kind of bounded trail window: a trench that follows the skier and is forgotten outside a fixed area. No WGSL, Babylon source, or ported shader is included.
- **three.quarks** (MIT, Forrest Sun) was considered as the particle runtime and was not used. See the README for why.
- SnowboardAnywhere and Extreme Tux Racer were not used. None of their source is included.

## Music

The procedural music (`src/player/music*.ts`) is original and generated in the browser.

The bundled songs in `public/audio/music/` (First Chair, Cold Smoke and the six Chair 9 FM radio songs: Yard Sale, T-Bar Blues, Singles Line, Flat Light, Boots Still On, Igloo Party) were generated for this project with ElevenLabs Music v2.5 through Higgsfield in November 2026. The lyrics and prompts are original to SkiScrapex. The artist names are made up for the in-game radio.

**Licence:** checked by the maintainer on 2026-11-25 against Higgsfield's help center ("Who owns my generations and can I use them commercially?"): the user owns the outputs and may use them commercially. Higgsfield keeps a broad licence to them under its terms, and outputs are not exclusive. These audio files are not covered by the MIT licence of the code: reuse them under Higgsfield's terms, not as open-licensed music. Other recorded tracks added later must be CC0 or CC-BY, verified on their own page, and credited here. See `public/audio/music/README.md`.

CC0 tracks from OpenGameArt, each licence checked on its own page on 2026-11-25 and re-encoded to 112 kbps MP3 in `public/audio/music/cc0/`. CC0 needs no credit; it is given anyway.

- "Black Diamond" by Joth, CC0 1.0, https://opengameart.org/content/black-diamond
- "Happy synths loop with slight christmas feeling" (shown as "Happy Synths") by 3xBlast, CC0 1.0, https://opengameart.org/content/happy-synths-loop-with-slight-christmas-feeling
- "Funked Up" by Joth, CC0 1.0, https://opengameart.org/content/funked-up
