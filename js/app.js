// Guess Song Lyrics — game logic
// Editable content lives in /config (songs.json, users.json, lyrics/*.txt).
// Scores and user-added songs go through js/storage.js, which uses the server
// API when available and falls back to localStorage on static hosting.

import {
  getScores,
  saveScore,
  getCustomSongs,
  getLocalLyrics,
  saveSong,
} from "./storage.js";

const GAME_SECONDS = 10 * 60; // 10 minute timer
const SONGS_URL = "config/songs.json";
const USERS_URL = "config/users.json";
const LYRICS_DIR = "config/lyrics";
const USER_STORAGE_KEY = "guessLyrics.player";

const state = {
  songs: [], // [{ file, title, artist, language }]
  users: [], // active player names
  user: "Guest", // currently selected player
  current: null, // active song meta
  tokens: [], // parsed lyric tokens
  totalWords: 0, // non-unique word count
  foundWords: 0,
  timeLeft: GAME_SECONDS,
  timerId: null,
  running: false,
  paused: false,
};

// ---------- DOM ----------
const el = {
  appHeader: document.getElementById("appHeader"),
  selectScreen: document.getElementById("selectScreen"),
  detailScreen: document.getElementById("detailScreen"),
  challengeScreen: document.getElementById("challengeScreen"),
  userSelect: document.getElementById("userSelect"),
  songList: document.getElementById("songList"),
  songListEmpty: document.getElementById("songListEmpty"),
  songSearch: document.getElementById("songSearch"),
  addSongBtn: document.getElementById("addSongBtn"),
  addScreen: document.getElementById("addScreen"),
  addBackBtn: document.getElementById("addBackBtn"),
  addSongForm: document.getElementById("addSongForm"),
  addTitle: document.getElementById("addTitle"),
  addArtist: document.getElementById("addArtist"),
  addLanguage: document.getElementById("addLanguage"),
  addLyrics: document.getElementById("addLyrics"),
  addError: document.getElementById("addError"),
  addSubmitBtn: document.getElementById("addSubmitBtn"),
  addCancelBtn: document.getElementById("addCancelBtn"),
  detailBackBtn: document.getElementById("detailBackBtn"),
  detailTitle: document.getElementById("detailTitle"),
  detailArtist: document.getElementById("detailArtist"),
  detailLang: document.getElementById("detailLang"),
  detailWords: document.getElementById("detailWords"),
  detailLeaderboardList: document.getElementById("detailLeaderboardList"),
  detailLeaderboardEmpty: document.getElementById("detailLeaderboardEmpty"),
  startGameBtn: document.getElementById("startGameBtn"),
  challengeTitle: document.getElementById("challengeTitle"),
  challengeArtist: document.getElementById("challengeArtist"),
  timer: document.getElementById("timer"),
  wordsFound: document.getElementById("wordsFound"),
  progressFill: document.getElementById("progressFill"),
  guessInput: document.getElementById("guessInput"),
  pauseBtn: document.getElementById("pauseBtn"),
  giveUpBtn: document.getElementById("giveUpBtn"),
  showResultsBtn: document.getElementById("showResultsBtn"),
  lyrics: document.getElementById("lyrics"),
  resultOverlay: document.getElementById("resultOverlay"),
  resultTitle: document.getElementById("resultTitle"),
  resultText: document.getElementById("resultText"),
  leaderboardList: document.getElementById("leaderboardList"),
  leaderboardSong: document.getElementById("leaderboardSong"),
  leaderboardEmpty: document.getElementById("leaderboardEmpty"),
  playAgainBtn: document.getElementById("playAgainBtn"),
  viewLyricsBtn: document.getElementById("viewLyricsBtn"),
  chooseAnotherBtn: document.getElementById("chooseAnotherBtn"),
  pauseOverlay: document.getElementById("pauseOverlay"),
  continueBtn: document.getElementById("continueBtn"),
};

// ---------- Text helpers ----------
// A "word" token is any run of letters/digits/apostrophes. Everything else
// (spaces, punctuation, newlines) is preserved so lyrics render naturally.
const WORD_RE = /[\p{L}\p{N}']+/u;

// Normalize a word for matching: lowercase and drop apostrophes so that
// "dont" matches "don't" and "its" matches "it's".
function normalize(word) {
  return word
    .toLowerCase()
    .replace(/[’‘`]/g, "'")
    .replace(/'/g, "") // ignore apostrophes entirely
    .trim();
}

// Split raw lyrics into an ordered list of tokens.
function tokenize(text) {
  const tokens = [];
  const lines = text.replace(/\r\n/g, "\n").split("\n");

  lines.forEach((line, lineIdx) => {
    if (lineIdx > 0) tokens.push({ type: "newline" });

    if (line.trim() === "") return; // blank line handled by newline spacing

    const parts = line.match(/[\p{L}\p{N}']+|[^\p{L}\p{N}']+/gu) || [];
    for (const part of parts) {
      const key = WORD_RE.test(part) ? normalize(part) : "";
      if (key) {
        tokens.push({
          type: "word",
          text: part,
          key,
          found: false,
        });
      } else {
        // Punctuation, whitespace, or a token with no letters/digits.
        tokens.push({ type: "text", text: part });
      }
    }
  });

  return tokens;
}

// ---------- Song loading ----------
async function loadSongs() {
  try {
    const res = await fetch(SONGS_URL, { cache: "no-store" });
    if (!res.ok) throw new Error(`songs ${res.status}`);
    const data = await res.json();
    state.songs = Array.isArray(data.songs) ? data.songs : [];
  } catch (err) {
    console.error("Failed to load song catalog:", err);
    el.songList.innerHTML = "";
    el.songListEmpty.textContent =
      "Could not load songs. Open the app over http (local server or GitHub Pages), not as a file:// page.";
    el.songListEmpty.classList.remove("hidden");
    return;
  }

  // Songs the player added in the browser (static hosting only).
  try {
    state.songs = state.songs.concat(await getCustomSongs());
  } catch (err) {
    console.error("Failed to load saved songs:", err);
  }

  renderSongList();
}

async function loadLyrics(file) {
  const local = getLocalLyrics(file);
  if (local != null) return local;

  const res = await fetch(`${LYRICS_DIR}/${encodeURIComponent(file)}`, {
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`lyrics ${res.status}`);
  return res.text();
}

// ---------- Players ----------
// The player list is read from config/users.json so it can be edited freely.
async function loadUsers() {
  try {
    const res = await fetch(USERS_URL, { cache: "no-store" });
    if (!res.ok) throw new Error(`users ${res.status}`);
    const data = await res.json();
    state.users = Array.isArray(data.users) ? data.users.filter(Boolean) : [];
  } catch (err) {
    console.error("Failed to load users:", err);
    state.users = [];
  }
  if (state.users.length === 0) state.users = ["Guest"];

  const saved = localStorage.getItem(USER_STORAGE_KEY);
  state.user = state.users.includes(saved) ? saved : state.users[0];

  el.userSelect.innerHTML = "";
  for (const name of state.users) {
    const opt = document.createElement("option");
    opt.value = name;
    opt.textContent = name;
    if (name === state.user) opt.selected = true;
    el.userSelect.appendChild(opt);
  }
}

// Is a song laid out right-to-left (e.g. Hebrew)?
function isRtl(song) {
  const lang = String(song && song.language ? song.language : "").toLowerCase();
  return lang === "he" || lang === "ar" || lang === "rtl";
}

// ---------- Rendering: song list ----------
function renderSongList() {
  const q = normalize(el.songSearch.value || "");
  const matches = state.songs.filter((s) => {
    if (!q) return true;
    return (
      normalize(s.title).includes(q) || normalize(s.artist || "").includes(q)
    );
  });

  el.songList.innerHTML = "";
  el.songListEmpty.classList.toggle("hidden", matches.length > 0);

  for (const song of matches) {
    const li = document.createElement("li");
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "song-card";
    btn.innerHTML = `
      <span class="title" dir="auto"></span>
      <span class="artist" dir="auto"></span>
    `;
    btn.querySelector(".title").textContent = song.title;
    btn.querySelector(".artist").textContent = song.artist || "";
    btn.addEventListener("click", () => openSongDetail(song));
    li.appendChild(btn);
    el.songList.appendChild(li);
  }
}

// ---------- Song detail / pre-game screen ----------
async function openSongDetail(song) {
  state.current = song;
  state.loadedText = null;
  state.loadedFile = null;

  el.detailTitle.textContent = song.title;
  el.detailArtist.textContent = song.artist ? `by ${song.artist}` : "";
  el.detailLang.textContent = isRtl(song)
    ? "\u{1F524} Hebrew · RTL"
    : `\u{1F524} ${(song.language || "en").toUpperCase()}`;
  el.detailWords.textContent = "… words";

  el.selectScreen.classList.add("hidden");
  el.challengeScreen.classList.add("hidden");
  el.detailScreen.classList.remove("hidden");
  el.appHeader.classList.remove("hidden");

  // Preload the lyrics once so we can show the word count and reuse the text
  // when the game starts (without ever displaying the lyrics here).
  try {
    const text = await loadLyrics(song.file);
    state.loadedText = text;
    state.loadedFile = song.file;
    const count = tokenize(text).filter((t) => t.type === "word").length;
    el.detailWords.textContent = `${count} words`;
  } catch (err) {
    console.error(err);
    el.detailWords.textContent = "";
  }

  renderDetailLeaderboard(song.file);
}

// ---------- Rendering: lyrics ----------
function renderLyrics() {
  el.lyrics.innerHTML = "";
  const frag = document.createDocumentFragment();

  for (const tk of state.tokens) {
    if (tk.type === "newline") {
      frag.appendChild(document.createElement("br"));
      continue;
    }
    const span = document.createElement("span");
    if (tk.type === "word") {
      span.className = tk.found ? "token word found" : "token word hidden-word";
      // Hidden words render as a block of the same length to hint word size.
      span.textContent = tk.found ? tk.text : "▁".repeat(tk.text.length);
      tk.node = span;
    } else {
      span.className = "token text";
      span.textContent = tk.text;
    }
    frag.appendChild(span);
  }
  el.lyrics.appendChild(frag);
}

// ---------- Game flow ----------
async function startChallenge(song) {
  state.current = song;
  let text;
  // Reuse the lyrics preloaded by the detail screen when available.
  if (state.loadedText != null && state.loadedFile === song.file) {
    text = state.loadedText;
  } else {
    try {
      text = await loadLyrics(song.file);
    } catch (err) {
      console.error(err);
      alert("Could not load the lyrics file for this song.");
      return;
    }
  }

  state.tokens = tokenize(text);
  state.totalWords = state.tokens.filter((t) => t.type === "word").length;
  state.foundWords = 0;
  state.timeLeft = GAME_SECONDS;
  state.running = true;
  state.paused = false;

  el.challengeTitle.textContent = song.title;
  el.challengeArtist.textContent = song.artist || "";
  el.challengeTitle.dir = "auto";
  el.challengeArtist.dir = "auto";

  // Lay out lyrics and the guess box right-to-left for RTL songs (e.g. Hebrew).
  const rtl = isRtl(song);
  el.lyrics.dir = rtl ? "rtl" : "ltr";
  el.lyrics.classList.toggle("rtl", rtl);
  el.guessInput.dir = rtl ? "rtl" : "ltr";

  el.guessInput.value = "";
  el.guessInput.disabled = false;
  el.giveUpBtn.disabled = false;
  el.giveUpBtn.classList.remove("hidden");
  el.pauseBtn.disabled = false;
  el.pauseBtn.classList.remove("hidden");
  el.pauseOverlay.classList.add("hidden");
  el.showResultsBtn.classList.add("hidden");

  renderLyrics();
  updateStats();

  el.appHeader.classList.add("hidden");
  el.selectScreen.classList.add("hidden");
  el.detailScreen.classList.add("hidden");
  el.challengeScreen.classList.remove("hidden");
  el.resultOverlay.classList.add("hidden");
  el.guessInput.focus();

  startTimer();
}

function startTimer() {
  stopTimer();
  updateTimerDisplay();
  state.timerId = setInterval(() => {
    state.timeLeft -= 1;
    updateTimerDisplay();
    if (state.timeLeft <= 0) endGame(false);
  }, 1000);
}

function stopTimer() {
  if (state.timerId) {
    clearInterval(state.timerId);
    state.timerId = null;
  }
}

// Pause freezes the countdown, blocks guessing, and hides the lyrics behind
// a blurred overlay until the player continues.
function pauseGame() {
  if (!state.running || state.paused) return;
  state.paused = true;
  stopTimer();
  el.guessInput.disabled = true;
  el.pauseOverlay.classList.remove("hidden");
}

function resumeGame() {
  if (!state.paused) return;
  state.paused = false;
  el.pauseOverlay.classList.add("hidden");
  el.guessInput.disabled = false;
  el.guessInput.focus();
  startTimer();
}

function updateTimerDisplay() {
  const m = Math.floor(state.timeLeft / 60);
  const s = state.timeLeft % 60;
  el.timer.textContent = `${m}:${String(s).padStart(2, "0")}`;
  el.timer.classList.toggle("warning", state.timeLeft <= 30);
}

function updateStats() {
  el.wordsFound.textContent = `${state.foundWords} / ${state.totalWords}`;
  const pct =
    state.totalWords === 0 ? 0 : (state.foundWords / state.totalWords) * 100;
  el.progressFill.style.width = `${pct}%`;
}

// Reveal every not-yet-found occurrence of the guessed word.
function handleGuess(raw) {
  if (!state.running || state.paused) return;
  const key = normalize(raw);
  if (!key) return;

  let newlyFound = 0;
  for (const tk of state.tokens) {
    if (tk.type === "word" && !tk.found && tk.key === key) {
      tk.found = true;
      newlyFound += 1;
      if (tk.node) {
        tk.node.className = "token word found just-found";
        tk.node.textContent = tk.text;
      }
    }
  }

  if (newlyFound > 0) {
    state.foundWords += newlyFound;
    updateStats();
    // Clear the input after a successful find so the next guess is clean.
    el.guessInput.value = "";
    if (state.foundWords >= state.totalWords) endGame(true);
  }
}

function endGame(won) {
  state.running = false;
  state.paused = false;
  stopTimer();
  el.pauseOverlay.classList.add("hidden");
  el.guessInput.disabled = true;
  el.giveUpBtn.disabled = true;
  el.pauseBtn.classList.add("hidden");
  // Swap "Give up" for a "Show results" button so the revealed lyrics
  // stay visible and the results overlay can be reopened at any time.
  el.giveUpBtn.classList.add("hidden");
  el.showResultsBtn.classList.remove("hidden");

  // Reveal any remaining hidden words.
  for (const tk of state.tokens) {
    if (tk.type === "word" && !tk.found && tk.node) {
      tk.node.className = "token word revealed-end";
      tk.node.textContent = tk.text;
    }
  }

  const found = state.foundWords;
  const total = state.totalWords;
  const finishedSeconds = won ? GAME_SECONDS - state.timeLeft : null;
  if (won) {
    el.resultTitle.textContent = "🎉 You found them all!";
    const m = Math.floor(finishedSeconds / 60);
    const s = finishedSeconds % 60;
    el.resultText.textContent = `You uncovered all ${total} words in ${m}:${String(s).padStart(2, "0")}.`;
  } else {
    el.resultTitle.textContent = "⏰ Time's up!";
    el.resultText.textContent = `You found ${found} of ${total} words. The rest are highlighted in red.`;
  }
  el.resultOverlay.classList.remove("hidden");

  // Persist this result, then refresh the leaderboard for the song.
  submitAndShowLeaderboard({
    user: state.user,
    file: state.current.file,
    title: state.current.title,
    words: found,
    total,
    finished: won,
    seconds: finishedSeconds,
  });
}

function goToSelect() {
  stopTimer();
  state.running = false;
  el.resultOverlay.classList.add("hidden");
  el.challengeScreen.classList.add("hidden");
  el.detailScreen.classList.add("hidden");
  el.addScreen.classList.add("hidden");
  el.appHeader.classList.remove("hidden");
  el.selectScreen.classList.remove("hidden");
}

// ---------- Add a custom song ----------
function openAddSong() {
  el.selectScreen.classList.add("hidden");
  el.detailScreen.classList.add("hidden");
  el.challengeScreen.classList.add("hidden");
  el.appHeader.classList.remove("hidden");
  el.addScreen.classList.remove("hidden");

  el.addSongForm.reset();
  el.addError.classList.add("hidden");
  el.addError.textContent = "";
  el.addTitle.focus();
}

async function submitNewSong(event) {
  event.preventDefault();

  const title = el.addTitle.value.trim();
  const artist = el.addArtist.value.trim();
  const language = el.addLanguage.value;
  const lyrics = el.addLyrics.value;

  if (!title) return showAddError("Please enter a song name.");
  if (!lyrics.trim()) return showAddError("Please paste the lyrics.");

  el.addSubmitBtn.disabled = true;
  try {
    await saveSong({ title, artist, language, lyrics });
    await loadSongs();
    goToSelect();
  } catch (err) {
    console.error("Failed to add song:", err);
    showAddError("Could not save the song. Please try again.");
  } finally {
    el.addSubmitBtn.disabled = false;
  }
}

function showAddError(message) {
  el.addError.textContent = message;
  el.addError.classList.remove("hidden");
}

// ---------- Leaderboard ----------
async function submitAndShowLeaderboard(result) {
  el.leaderboardSong.textContent = `· ${result.title}`;
  let savedRecord = null;
  try {
    savedRecord = await saveScore(result);
  } catch (err) {
    console.error("Failed to save score:", err);
  }
  await renderLeaderboard(result.file, savedRecord);
}

// Best score first: more words wins; ties broken by finishing, then faster time.
function compareScores(a, b) {
  if (b.words !== a.words) return b.words - a.words;
  if (a.finished !== b.finished) return a.finished ? -1 : 1;
  if (a.finished && b.finished)
    return (a.seconds ?? Infinity) - (b.seconds ?? Infinity);
  return new Date(b.date) - new Date(a.date);
}

function formatSeconds(sec) {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

async function renderLeaderboard(file, savedRecord) {
  const scores = await fetchSongScores(file);
  fillLeaderboard(el.leaderboardList, el.leaderboardEmpty, scores, {
    limit: 10,
    savedRecord,
  });
}

async function renderDetailLeaderboard(file) {
  const scores = await fetchSongScores(file);
  fillLeaderboard(el.detailLeaderboardList, el.detailLeaderboardEmpty, scores, {
    limit: 5,
  });
}

async function fetchSongScores(file) {
  try {
    const scores = await getScores();
    return scores.filter((s) => s.file === file);
  } catch (err) {
    console.error("Failed to load leaderboard:", err);
  }
  return [];
}

const MEDALS = ["\u{1F947}", "\u{1F948}", "\u{1F949}"]; // gold, silver, bronze

function fillLeaderboard(listEl, emptyEl, scores, { limit, savedRecord }) {
  scores.sort(compareScores);
  const top = scores.slice(0, limit);

  listEl.innerHTML = "";
  emptyEl.classList.toggle("hidden", top.length > 0);

  top.forEach((s, i) => {
    const li = document.createElement("li");
    const row = document.createElement("div");
    row.className = "leaderboard-row";
    // Highlight the row that matches the score we just saved.
    if (savedRecord && s.date === savedRecord.date) row.classList.add("you");

    const rank = document.createElement("span");
    rank.className = "lb-rank";
    rank.textContent = i < 3 ? MEDALS[i] : `${i + 1}`;
    row.appendChild(rank);

    const main = document.createElement("span");
    main.className = "lb-main";
    const who = document.createElement("span");
    who.className = "lb-user";
    who.textContent = s.user || "Guest";
    main.appendChild(who);
    const score = document.createElement("span");
    score.className = "lb-score";
    score.textContent = `${s.words}/${s.total}`;
    main.appendChild(score);
    if (s.finished && s.seconds != null) {
      const time = document.createElement("span");
      time.className = "lb-time lb-finished";
      time.textContent = `✓ ${formatSeconds(s.seconds)}`;
      main.appendChild(time);
    }

    const date = document.createElement("span");
    date.className = "lb-date";
    date.textContent = new Date(s.date).toLocaleDateString();

    row.appendChild(main);
    row.appendChild(date);
    li.appendChild(row);
    listEl.appendChild(li);
  });
}

// ---------- Events ----------
el.songSearch.addEventListener("input", renderSongList);
el.addSongBtn.addEventListener("click", openAddSong);
el.addBackBtn.addEventListener("click", goToSelect);
el.addCancelBtn.addEventListener("click", goToSelect);
el.addSongForm.addEventListener("submit", submitNewSong);
el.userSelect.addEventListener("change", (e) => {
  state.user = e.target.value;
  localStorage.setItem(USER_STORAGE_KEY, state.user);
});
el.guessInput.addEventListener("input", (e) => handleGuess(e.target.value));
el.pauseBtn.addEventListener("click", pauseGame);
el.continueBtn.addEventListener("click", resumeGame);
el.giveUpBtn.addEventListener("click", () => endGame(false));
el.detailBackBtn.addEventListener("click", goToSelect);
el.startGameBtn.addEventListener("click", () => {
  if (state.current) startChallenge(state.current);
});
el.playAgainBtn.addEventListener("click", () => {
  if (state.current) startChallenge(state.current);
});
// Close the overlay to reveal the finished lyrics behind it (missed words in red).
el.viewLyricsBtn.addEventListener("click", () => {
  el.resultOverlay.classList.add("hidden");
});
// Reopen the results overlay after reviewing the lyrics.
el.showResultsBtn.addEventListener("click", () => {
  el.resultOverlay.classList.remove("hidden");
});
el.chooseAnotherBtn.addEventListener("click", goToSelect);

// ---------- Init ----------
loadUsers();
loadSongs();
