# ⚙️ Config folder

Everything you edit lives here. Change these files and refresh the page.

- **songs.json** — the song catalog. Each entry:
  ```json
  {
    "file": "my-song.txt",
    "title": "My Song",
    "artist": "Artist",
    "language": "en"
  }
  ```

  - `file` — the lyric file inside `config/lyrics/`.
  - `language` — `"en"` (left-to-right) or `"he"` for Hebrew (right-to-left layout).
- **users.json** — the list of players shown in the picker:
  ```json
  { "users": ["Guest", "Koren", "Dana"] }
  ```
- **lyrics/** — one plain-text `.txt` file per song. Drop a new file here and add a
  matching entry in `songs.json`.

> Generated data (the leaderboard) is stored separately in `../data/scores.json`
> and is written by the game — you normally don't edit it by hand.
