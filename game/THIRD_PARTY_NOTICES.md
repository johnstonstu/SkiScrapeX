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
