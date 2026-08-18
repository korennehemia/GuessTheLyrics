# 🎵 Guess Song Lyrics

A browser game: pick a player and a song, then race a 10-minute timer to uncover
its hidden lyrics by typing words. Each word you type reveals **every** matching
(hidden) occurrence in the song, so you're literally "finding" all the lyrics. A
counter shows how many words are still left to find (non-unique).

## Run it

The game loads content from the `config/` folder using `fetch`, so it needs a web
server (opening `index.html` directly with `file://` will not work).

Using Node (no dependencies to install):

```powershell
node server.js
```

Then open http://localhost:3000

Alternatively, any static server works, e.g. `python -m http.server 3000`.

## Publish on GitHub Pages

The game is plain HTML/CSS/JS with no build step and no dependencies, so you can
push the repo and enable **Settings → Pages → Deploy from a branch** (branch
`main`, folder `/root`). No `package.json` is needed.

`server.js` is optional — it only adds the shared leaderboard and song storage.
When it isn't running (as on GitHub Pages), the app automatically falls back to
the browser's `localStorage`, so scores and songs you add are saved per device
instead of being shared.

## How to play

1. Pick who's playing from the **Playing as** dropdown (top of the page).
2. Choose a song from the list (search by title or artist).
3. The lyrics appear as blanks (`▁▁▁`) sized to each hidden word.
4. Type a word in the input. On every change it's checked against the lyrics.
   - If it matches, all hidden copies of that word are revealed in green.
   - The "Words left" counter drops and the progress bar fills.
5. Find every word before the 10-minute timer runs out.
6. **Give up** ends the round; **View lyrics** lets you review the missed words
   (highlighted in red) and **Show results** reopens the leaderboard.

## Everything you can edit lives in `config/`

- **config/songs.json** — the song catalog. Each entry:
  ```json
  {
    "file": "my-song.txt",
    "title": "My Song",
    "artist": "Artist",
    "language": "en"
  }
  ```
  `language` is `"en"` (left-to-right) or `"he"` for Hebrew (right-to-left layout).
- **config/users.json** — the list of players in the dropdown:
  ```json
  { "users": ["Guest", "Koren", "Dana"] }
  ```
- **config/lyrics/\*.txt** — one plain-text file per song.

Edit any of these and refresh the page. See `config/README.md` for details.

> The included English songs are traditional / public-domain works. Only add
> lyrics you have the right to use.

## Project structure

```
index.html            # markup / screens
css/styles.css        # styling
js/app.js             # game logic (tokenizing, matching, timer, scoring, RTL)
server.js             # tiny zero-dependency static server + scores API
config/               # everything you edit
  songs.json          #   song catalog (title, artist, language)
  users.json          #   active players
  lyrics/*.txt        #   lyric files
data/                 # generated data (written by the game)
  scores.json         #   leaderboard
```
