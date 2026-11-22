# Controls and ski physics review (steeps)

Written 2026-11-21 after the first local playtest: "the ski physics on steep doesn't feel quite right". This compares our model with published ski mechanics, commercial ski games and open-source projects, and records what changed. Probe numbers come from `tuning/steep.test.ts` (`npm run tune`), which runs bots on planar groomed slopes from 20° to 45°.

## What was wrong

The old ground model rotated the skis no faster than edge grip could turn the travel direction (`yaw ≤ grip / v`), and the commanded yaw also fell as `1 / (1 + v / 10)`. Both shrink with speed, so the faster you went the less you could turn, and the less you turned the faster you went.

| 30° groomed, old model | Result |
| --- | --- |
| Linked turns, fixed rhythm | Settled at 95 to 112 km/h, or flipped into a 170° spin and stalled near 0. No middle ground. |
| Player-style turns, switching once 70° off the fall line | 75 km/h (38°: 83, 45°: 106) |
| Effective turn radius at 54 km/h | About 36 m |
| Traverse with the stick released at 45° | Side-slipped 16° below the skis' line |

Real numbers: advanced recreational skiers average about 44 km/h on groomed runs, intermediates about 32 km/h (Stepan, Scher, Ruedl and Shealy, [JSAMS Plus 2023](https://doaj.org/article/2b935686ece744eca0efec1d27afabe2)). On 16° to 20° blue runs the average is 43 km/h (Shealy, [ASTM STP 1553](https://store.astm.org/stp12212s.html)). Measured recreational turn radii are 6 to 9 m ([Schmitt, ASTM STP 49265](https://store.astm.org/stp49265s.html)). On steep terrain skiers control speed by finishing turns across the hill and by skidding the top of the turn ([NC State skiing text, ch. 9](https://ncstate.pressbooks.pub/skiingandsnowboarding/chapter/turning-2/); [Fall-Line, dynamic carving](https://fall-line.co.uk/ski-skills-dynamic-carving)).

So the model could neither carve a tight turn at speed nor scrub speed with a skid, which are exactly the two tools a skier uses on a steep.

## What the references say

**Mechanics.**
- A carving ski turns on its sidecut: radius `R = R_sc cos(edge)`, so its yaw rate `v / R` grows with speed until the load passes about 3 g (Komissarov, [Modelling of carving turns, arXiv 1812.02539](https://arxiv.org/abs/1812.02539)). Pure carving on slopes near 45° is essentially impossible at controlled speeds; the skier must skid.
- A skidding ski is a cutting tool. Cutting resistance is about `N (tan(edge) + 0.2)`, and it splits by the attack angle γ between ski and travel: `cos γ` turns the path, `sin γ` brakes it (Komissarov, [Mechanics of side-slipping, Sports Engineering 2021](https://link.springer.com/article/10.1007/s12283-021-00340-7)). A speed check is a large γ: mostly braking.
- Flat skis side-slip; edged skis hold. A traverse is held on the uphill edges without conscious effort.

**Commercial games** (no source; design lessons from reviews and interviews).
- *Lonely Mountains: Snow Riders* is praised for tight, predictable control on top of real physics. *SNØ* reviews describe carving as fluid and its rules as simple. Both reward choosing a line and managing speed by turning.
- *Steep* was repeatedly marked down for "inconsistent", "floaty" or "cartoonish" physics and unresponsive controls ([PC Gamer](https://pcgamer.com/steep-review), [Destructoid](https://www.destructoid.com/reviews/review-steep/)). Its successor *Riders Republic* was judged better for snow sports, largely because it is more responsive.
- *SNOW* (Poppermost): "manage your speed by turning and braking" on physics that change with powder, piste and ice ([Red Bull interview](https://www.redbull.com/us-en/snow-ps4-beta-release-tutorial-guide)).
- *Grand Mountain Adventure*: tried making steering less precise at speed and letting external forces cause crashes; players found it random, so they pulled back ([80.lv](https://80.lv/articles/developing-a-ski-open-world-game-for-mobile)). Lesson: lost control must be earned and readable.

**Open source.**
- *alpine-challenge* (no licence, idea only): "steering rotates the skis; grip rotates the velocity toward the skis; the leftover is skid and speed loss". Our model had the second half but capped the first half by grip, which removed the skid.
- *SnowGlider* (MIT, [docs/PHYSICS.md](https://raw.githubusercontent.com/den-run-ai/snowglider/main/docs/PHYSICS.md)): turn authority comes from carve commitment, not speed (one 0.85 factor above a threshold). A clean carve beats chatter-skidding, and a snowplow cannot stop you above 30°, only slow you.
- *ski-together* (no licence): measured 61 km/h straight versus 48 km/h with linked turns on a 15° pitch, a useful sanity ratio.

## Right and wrong in our model

| Area | Before | Verdict |
| --- | --- | --- |
| Position control (stick sets a traverse angle from the fall line) | In | Right. Matches the order-of-control research and makes "turn to stop" natural. Kept. |
| Edge rolls on at a finite rate | In | Right. Kept. |
| Sidecut carve maths (ski-coach port) | Used only for HUD, chatter and washout | Half right. Now also drives yaw. |
| Ski yaw limited by grip / v and by 1 / (1 + v/10) | In | **Wrong.** Caused the runaway on steeps. |
| Skid braking only on the part of the slip left after grip turned the path | In | **Wrong.** Rotation preserves speed, so skids never scrubbed much. |
| Lateral grip as Coulomb friction on g cos(slope) | In | Wrong for carving: an inclined edge holds up to about 3 g. |
| Side-slip resistance independent of edge | In | Wrong: flat skis should slide, edged skis bite. |
| Flat skis on a released traverse | Side-slipped on steeps | Wrong: skiers stand on their uphill edges. |
| Friction independent of turn load | In | Minor. Komissarov scales it with total load. |
| Hand-tuned "steep pivot" and "turn support" boosts | In | Symptoms of the above. Removed. |

## What changed (`src/sim/skier.ts`, `constants.ts`, `surface.ts`)

1. **Ski yaw** is the faster of the sidecut rate `v / (R_sc cos edge)` (capped where the carve would exceed 3 g) and a leg pivot of `2.2 / (1 + v / 30)` rad/s. It is not limited by grip.
2. **Grip** is the edge's holding capacity `g cos(slope) · min(tan(edge + angulation) + 0.2, latMax)`, with up to 15° of angulation once the edge is committed. `latMax` is now in g: groomed 2.6, park 2.3, powder 1.4, forest 1.2, ice 1.0.
3. **Skid split**: grip turns the path by `cos γ` and the cutting force brakes it by `0.8 sin γ`. Throwing the skis across the travel now scrubs speed; a clean carve keeps it.
4. **Traverse edge**: with the stick centred and the skis more than 30° off the fall line, the uphill edge rolls to 22°.
5. **Load friction**: base friction uses the total of normal and turning load.
6. On a real pitch the stick aims at a traverse even when stopped; it only spins freely on gentle ground (under about 8°) at walking pace, for turning around on cat tracks.

## Results

Player-style bot (full stick, switching once the skis pass the given angle off the fall line), average km/h after 10 s:

| Pitch | Finish 30° | 50° | 70° | 85° |
| --- | --- | --- | --- | --- |
| 20° old / new | 87 / 41 | 82 / 42 | 75 / 44 | n/a / 15 |
| 30° old / new | 100 / 85 | 88 / 56 | 75 / 52 | n/a / 24 |
| 38° old / new | 116 / 108 | 102 / 90 | 83 / 59 | n/a / 29 |
| 45° old / new | 130 / 124 | 120 / 108 | 106 / 87 | n/a / 33 |

Speed now depends on how far across the hill you finish your turns, continuously, from carving fast to skiing a 45° face at about 30 km/h. A full turn from the fall line at 54 km/h reaches 45° off in 0.5 s (was 1.0 to 1.5 s). The hockey stop from 54 km/h takes 1.0 to 1.5 s. A released traverse at 45° no longer side-slips. On the real Apex runs (`tuning/tune.test.ts`) groomer speeds are unchanged and still match the real averages (Grandfather's 35 to 43 km/h, blues 40 to 60), chatter on Grandfather's dropped from 17 s to 4 s, and park landing grades are unchanged.

## Not done yet, worth trying after the next playtest

- **Carve commitment** (SnowGlider): build a short "locked" bonus while one direction is held, to make clean carving more rewarding than wiggling.
- **Slope-form balance** (Komissarov): the top half of a turn needs less lean than the bottom half. Could drive the rider's lean and a small speed difference.
- **Rebound** at the edge change after a high-load turn.
- **Gamepad**: analog sticks get partial edge (carve) versus full stick (skidded speed check) for free; keyboard gets it from tap versus hold. Watch whether keyboard players want a dedicated "slarve" key.
- **Ice**: `latMax` 1.0 makes chatter and washouts show up mostly on ice. Check that it reads as ice, not as a bug.
