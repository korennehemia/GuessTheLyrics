// Storage layer for scores and user-added songs.
//
// When the Node server (server.js) is running, the /api endpoints are used so
// data is shared between everyone on that machine. On static hosting such as
// GitHub Pages there is no backend, so everything falls back to the browser's
// localStorage (per-device data).

const SCORES_KEY = "guessLyrics.scores";
const SONGS_KEY = "guessLyrics.customSongs";
const LYRICS_KEY = "guessLyrics.lyrics:";

// Relative URLs so the app also works when served from a sub-path
// (e.g. https://user.github.io/repo/).
const SCORES_API = "api/scores";
const SONGS_API = "api/songs";

let apiProbe = null;

// Detect once whether the backend API is reachable. On GitHub Pages the
// request 404s (or returns HTML), which means "static mode".
function hasApi() {
  if (!apiProbe) {
    apiProbe = (async () => {
      try {
        const res = await fetch(SCORES_API, { cache: "no-store" });
        if (!res.ok) return false;
        const type = res.headers.get("content-type") || "";
        return type.includes("application/json");
      } catch {
        return false;
      }
    })();
  }
  return apiProbe;
}

function readLocal(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    const data = JSON.parse(raw);
    return Array.isArray(data) ? data : fallback;
  } catch {
    return fallback;
  }
}

function writeLocal(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

// Mirror the server's whitelist so locally stored records have the same shape.
function sanitizeScore(entry) {
  return {
    user: String(entry.user || "Guest").slice(0, 60),
    file: String(entry.file || "").slice(0, 200),
    title: String(entry.title || "").slice(0, 200),
    mode: entry.mode === "mystery" ? "mystery" : "classic",
    words: Number.isFinite(entry.words)
      ? Math.max(0, Math.floor(entry.words))
      : 0,
    total: Number.isFinite(entry.total)
      ? Math.max(0, Math.floor(entry.total))
      : 0,
    guesses: Number.isFinite(entry.guesses)
      ? Math.max(0, Math.floor(entry.guesses))
      : null,
    artistGuessed: Boolean(entry.artistGuessed),
    finished: Boolean(entry.finished),
    seconds: Number.isFinite(entry.seconds)
      ? Math.max(0, Math.floor(entry.seconds))
      : null,
    date: new Date().toISOString(),
  };
}

// ---------- Scores ----------
export async function getScores() {
  if (await hasApi()) {
    try {
      const res = await fetch(SCORES_API, { cache: "no-store" });
      if (res.ok) {
        const data = await res.json();
        return Array.isArray(data.scores) ? data.scores : [];
      }
    } catch (err) {
      console.error("Failed to load leaderboard:", err);
    }
    return [];
  }
  return readLocal(SCORES_KEY, []);
}

// Returns the stored record (used to highlight the player's own row).
export async function saveScore(result) {
  if (await hasApi()) {
    try {
      const res = await fetch(SCORES_API, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(result),
      });
      if (res.ok) {
        const data = await res.json();
        return data.record || null;
      }
    } catch (err) {
      console.error("Failed to save score:", err);
    }
    return null;
  }

  const record = sanitizeScore(result);
  if (!record.file) return null;
  const scores = readLocal(SCORES_KEY, []);
  scores.push(record);
  return writeLocal(SCORES_KEY, scores) ? record : null;
}

// ---------- Custom songs ----------
// Songs added in static mode live in localStorage, with their lyrics stored
// under a separate key so loadLyrics() can find them by "file" name.
export async function getCustomSongs() {
  if (await hasApi()) return []; // the server already wrote them into songs.json
  return readLocal(SONGS_KEY, []);
}

export function getLocalLyrics(file) {
  try {
    return localStorage.getItem(LYRICS_KEY + file);
  } catch {
    return null;
  }
}

export async function saveSong({ title, artist, language, lyrics }) {
  if (await hasApi()) {
    const res = await fetch(SONGS_API, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title, artist, language, lyrics }),
    });
    if (!res.ok) {
      const msg = await res.text();
      throw new Error(msg || `Request failed (${res.status})`);
    }
    const data = await res.json();
    return data.song;
  }

  const song = {
    file: `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.txt`,
    title: String(title).slice(0, 200),
    artist: String(artist || "").slice(0, 200),
    language: String(language || "en")
      .toLowerCase()
      .slice(0, 10),
    local: true,
  };
  const text = String(lyrics).replace(/\r\n/g, "\n").slice(0, 50_000);

  try {
    localStorage.setItem(LYRICS_KEY + song.file, text);
  } catch {
    throw new Error("Not enough browser storage to save this song.");
  }

  const songs = readLocal(SONGS_KEY, []);
  songs.push(song);
  if (!writeLocal(SONGS_KEY, songs)) {
    localStorage.removeItem(LYRICS_KEY + song.file);
    throw new Error("Not enough browser storage to save this song.");
  }
  return song;
}
