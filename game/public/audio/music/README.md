# Music tracks and the radio

`tracks.json` lists every bundled song. Each entry has a `kind`:

- `score`: plays in the adaptive **Tracks** source. `moods` (ambient, cruise, drive, freestyle) say which moods it suits; when a song ends, the next one that suits the current mood plays. The mood also sets a low-pass filter and level, as before.
- `radio`: plays on **Radio** (Chair 9 FM), shuffled with no repeats until every song has played, flat (no mood filter) so the vocals stay clear. `lyrics` points at the song's timed lyrics.

Nothing here downloads unless a player picks Tracks or Radio, and each song loads only when it plays. All sources duck under crashes and hard landings.

## Lyrics

`radio/<song>.lyrics.json` holds `{ "lines": [{ "t": start, "end": end, "text": "..." }] }` in seconds. Words fill across a line by syllable count, so only lines are timed.

To time a new song:

1. Put its lyrics, one shown line per row, in `tools/lyrics/text/<song>.txt`.
2. Transcribe it with ffmpeg's whisper filter (whisper.cpp) from the folder holding `ggml-base.en.bin`:
   `ffmpeg -i <song>.mp3 -vn -af "whisper=model=ggml-base.en.bin:language=en:queue=3:destination=<song>.srt:format=srt" -f null -`
3. `node tools/lyrics/align.mjs <song>.srt tools/lyrics/text/<song>.txt game/public/audio/music/radio/<song>.lyrics.json`
4. Check and fix it by ear on the dev server at `lyrics.html?song=<song>`: tap Space at each line in tap mode, nudge with `,` and `.`, then Copy JSON.

## Adding a recorded track

1. Use only CC0 or CC-BY music (or audio whose licence has been checked, see `game/THIRD_PARTY_NOTICES.md`), and read the licence on the track's own page.
2. Prefer MP3 or OGG at 96 to 128 kbps, about 1 to 2 MB per track.
3. Add an entry to `tracks.json` with `file`, `title`, `artist`, `author`, `licence`, `url` and `kind`.
4. Credit it in `game/THIRD_PARTY_NOTICES.md` under "Music".
