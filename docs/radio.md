# Mountain radio: lineup

The Chair 9 FM songs, generated with ElevenLabs Music v2.5 through Higgsfield in November 2026 (shipped in 0.9.28). All lyrics are original to this project. The station and artist names are fictional, and nothing references the resort's logo or trail map. Timed lyrics are in `game/public/audio/music/radio/*.lyrics.json`; see `game/public/audio/music/README.md` for how they are made.

| # | Title | Kind | Style | Length | Credits |
| --- | --- | --- | --- | --- | --- |
| 1 | First Chair | Instrumental | Warm lo-fi electronic, felt piano, soft pads, 84 bpm | 90 s | 13.1 |
| 2 | Cold Smoke | Instrumental | Driving indie electronic, analog synths, live drums, 128 bpm | 90 s | 13.1 |
| 3 | T-Bar Blues | Joke song | Slow 12-bar Delta blues, slide guitar, gravelly baritone | 75 s | 10.9 |
| 4 | Singles Line | Joke song | 1980s power ballad, gated drums, big synth, soaring tenor | 75 s | 10.9 |
| 5 | Flat Light | Joke song | Fast pop punk, shouted gang vocals | 75 s | 10.9 |
| 6 | Yard Sale | Joke song | Sea shanty, stomps and claps, crew singalong | 75 s | 10.9 |
| 7 | Boots Still On | Joke song | Polka with a yodel break, accordion and tuba | 75 s | 10.9 |
| 8 | Igloo Party | Radio song | Melodic dubstep, 140 bpm, round playful wubs, icy plucks, sparse vocal chops | 75 s | 10.9 |

The instrumentals play in the adaptive Tracks source (1 for ambient and cruise, 2 for drive and freestyle). The joke songs go on the radio.

---

## 3. T-Bar Blues

```
[Verse 1]
Woke up this mornin', the chair was down
Only one way up this cold old town
They handed me a T-bar and a snowboard man
He don't know his left foot from his right hand

[Chorus]
I got the T-bar blues, oh Lord
Draggin' up the mountain with a stranger on board
He leans to the left and I lean to the right
We been fallin' off this T-bar since the morning light

[Verse 2]
Halfway up he says, "Is this thing supposed to pull?"
Then he sits right down like it's a chair, the fool
Now we're both in the snow and the bar swings on
Lord, the liftie's laughin' and my pride is gone

[Chorus]
I got the T-bar blues, oh Lord
Draggin' up the mountain with a stranger on board
```

## 4. Singles Line

```
[Verse 1]
I saw you in the singles line
Your goggles caught the light just fine
You said "Single?" and my heart said "Yes"
I didn't even see your face, I guess

[Pre-chorus]
Seven minutes on a fixed-grip chair
The longest love I'll ever share

[Chorus]
Oh, singles line, you brought me you
For one chair ride, our love was true
Then you went left and I went right
Goodbye, my stranger in the flat white light

[Verse 2]
You never told me your name
You had a pass clipped to your jacket all the same
I tried to read it as you skied away
It said "Season Pass" and that was all it'd say

[Chorus]
Oh, singles line, you brought me you
For one chair ride, our love was true
```

## 5. Flat Light

```
[Verse 1]
Woke up stoked, I'm first in line
Looked outside, the sky's a white sign
No horizon, no up, no down
Am I moving? Is that the ground?

[Chorus]
Flat light! I can't see a thing!
Flat light! Is that a tree or a liftie sign?
Flat light! Am I even moving?
Flat light! I just fell over standing still!

[Verse 2]
Pointed my skis at a little bump
Turned out to be a six-foot jump
Landed on my back, I'm fine, I'm fine
Somebody tell me which way's downhill

[Chorus]
Flat light! I can't see a thing!
Flat light! Flat light! Flat light!
```

## 6. Yard Sale

```
[Verse 1]
Oh, I caught an edge on the top of the hill
And I went for a ride I'm a-riding still
My left ski's here and my right ski's there
And my pole's in a tree and my hat's in the air

[Chorus]
Yard sale! Haul away, boys!
Gear all over the mountain, heave ho!
Yard sale! Pick it up, boys!
One more run and then home we go!

[Verse 2]
Now the chairlift above gave a mighty cheer
"Ten out of ten!" was the cry I'd hear
So I bowed real low with a face full of snow
And I walked back up for the ski below

[Chorus]
Yard sale! Haul away, boys!
Gear all over the mountain, heave ho!
```

## 7. Boots Still On

```
[Verse 1]
The lifts are closed, the sun is low
There's music down in the lodge below
I've got my jacket and my toque on tight
And I'm walkin' like a robot in the evening light

[Chorus]
Boots still on, boots still on!
Clomp clomp clomp till the night is gone!
I can't feel my toes but I'm dancin' strong
With my boots, boots, boots still on!

[Yodel break]

[Verse 2]
I tried the stairs, it did not go well
I tried to dance and then I fell
My buckles clack like a marching band
I've got a drink in my glove and a glove in my hand

[Chorus]
Boots still on, boots still on!
Clomp clomp clomp till the night is gone!
```

---

## Game changes (done in 0.9.28)

- `tracks.json` entries gain `kind` (`score` or `radio`) and an optional `moods` list, so instrumentals stay in the adaptive Tracks source and joke songs only play on the radio.
- A third music source, **Radio**: shuffled radio tracks, a short "Now playing" toast with the title, and the mood filter turned off so lyrics stay clear.
- Credits: each file gets `author` and `licence` set from the Higgsfield and ElevenLabs terms, and a line in `game/THIRD_PARTY_NOTICES.md`.

Optional later, if credits allow: short DJ bumpers between songs ("You're listening to Chair 9 FM, where the snow is cold and the coffee is colder") with a text-to-speech voice.
