# Music tracks (optional)

Settings, Music source, Tracks plays the files listed in `tracks.json` in this folder, in order, looping. Until the list has entries, Tracks plays the procedural music instead. Nothing here is downloaded unless a player picks Tracks: the list and the files load only then.

The music still follows the player with tracks: a low-pass filter and a lower level on lifts and when standing still, opening up when cruising and fully open on steeps, at speed and in the park. Tracks also duck under crashes and hard landings.

## Adding a track

1. Use only CC0 or CC-BY music, and read the licence on the track's own page (not a collection or search page).
2. Prefer OGG Vorbis or MP3 at 96 to 128 kbps, about 1 to 2 MB per track. Keep the folder under about 6 MB in total.
3. Put the file here and add an entry to `tracks.json`:

```json
{
  "tracks": [
    {
      "file": "example.ogg",
      "title": "Example Title",
      "author": "Author Name",
      "licence": "CC0 1.0",
      "url": "https://example.org/track-page"
    }
  ]
}
```

4. Credit it in `game/THIRD_PARTY_NOTICES.md` under "Music" with the title, author, page URL and licence (and the licence URL for CC-BY).
