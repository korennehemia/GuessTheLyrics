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
  getHiddenSongs,
  setSongHidden,
} from "./storage.js";

const GAME_SECONDS = 10 * 60; // 10 minute timer (classic mode only)
const SONGS_URL = "config/songs.json";
const USERS_URL = "config/users.json";
const LYRICS_DIR = "config/lyrics";
const USER_STORAGE_KEY = "guessLyrics.player";
const MYSTERY_LANG_KEY = "guessLyrics.mysteryLanguage";
// How many recent mystery songs to avoid repeating.
const MYSTERY_HISTORY = 8;

const state = {
  songs: [], // [{ file, title, artist, language }]
  users: [], // active player names
  user: "Guest", // currently selected player
  mode: "classic", // "classic" | "mystery"
  current: null, // active song meta
  tokens: [], // parsed lyric tokens
  totalWords: 0, // non-unique word count
  foundWords: 0,
  timeLeft: GAME_SECONDS,
  elapsed: 0, // counts up in mystery mode
  timerId: null,
  running: false,
  paused: false,
  // Mystery mode
  revealedKeys: null, // Set of distinct words the player uncovered = the score
  titleSolved: false,
  artistSolved: false,
  mysteryHistory: [], // recently played files, to avoid immediate repeats
};

// ---------- DOM ----------
const el = {
  appHeader: document.getElementById("appHeader"),
  homeScreen: document.getElementById("homeScreen"),
  modeClassicBtn: document.getElementById("modeClassicBtn"),
  modeMysteryBtn: document.getElementById("modeMysteryBtn"),
  selectScreen: document.getElementById("selectScreen"),
  selectBackBtn: document.getElementById("selectBackBtn"),
  detailScreen: document.getElementById("detailScreen"),
  mysteryScreen: document.getElementById("mysteryScreen"),
  mysteryBackBtn: document.getElementById("mysteryBackBtn"),
  mysteryPoolChip: document.getElementById("mysteryPoolChip"),
  mysteryUserSelect: document.getElementById("mysteryUserSelect"),
  mysteryLanguage: document.getElementById("mysteryLanguage"),
  mysteryLeaderboardList: document.getElementById("mysteryLeaderboardList"),
  mysteryLeaderboardEmpty: document.getElementById("mysteryLeaderboardEmpty"),
  mysteryStartBtn: document.getElementById("mysteryStartBtn"),
  mysteryPanel: document.getElementById("mysteryPanel"),
  mysteryTitleGuess: document.getElementById("mysteryTitleGuess"),
  mysteryArtistGuess: document.getElementById("mysteryArtistGuess"),
  mysteryGuessBtn: document.getElementById("mysteryGuessBtn"),
  mysteryFeedback: document.getElementById("mysteryFeedback"),
  mysteryReveal: document.getElementById("mysteryReveal"),
  mysteryRevealTitle: document.getElementById("mysteryRevealTitle"),
  mysteryRevealArtist: document.getElementById("mysteryRevealArtist"),
  challengeScreen: document.getElementById("challengeScreen"),
  userSelect: document.getElementById("userSelect"),
  songList: document.getElementById("songList"),
  songListEmpty: document.getElementById("songListEmpty"),
  songSearch: document.getElementById("songSearch"),
  modeLibraryBtn: document.getElementById("modeLibraryBtn"),
  libraryTag: document.getElementById("libraryTag"),
  libraryScreen: document.getElementById("libraryScreen"),
  libraryBackBtn: document.getElementById("libraryBackBtn"),
  libraryAddBtn: document.getElementById("libraryAddBtn"),
  librarySearch: document.getElementById("librarySearch"),
  libraryList: document.getElementById("libraryList"),
  libraryEmpty: document.getElementById("libraryEmpty"),
  libraryActiveChip: document.getElementById("libraryActiveChip"),
  libraryHiddenChip: document.getElementById("libraryHiddenChip"),
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
  timerLabel: document.getElementById("timerLabel"),
  wordCostStat: document.getElementById("wordCostStat"),
  wordCost: document.getElementById("wordCost"),
  wordsFound: document.getElementById("wordsFound"),
  progressFill: document.getElementById("progressFill"),
  guessInput: document.getElementById("guessInput"),
  pauseBtn: document.getElementById("pauseBtn"),
  giveUpBtn: document.getElementById("giveUpBtn"),
  showResultsBtn: document.getElementById("showResultsBtn"),
  lyrics: document.getElementById("lyrics"),
  resultOverlay: document.getElementById("resultOverlay"),
  confetti: document.getElementById("confetti"),
  resultTitle: document.getElementById("resultTitle"),
  resultText: document.getElementById("resultText"),
  leaderboardList: document.getElementById("leaderboardList"),
  leaderboardSong: document.getElementById("leaderboardSong"),
  leaderboardEmpty: document.getElementById("leaderboardEmpty"),
  exitHomeBtn: document.getElementById("exitHomeBtn"),
  viewLyricsBtn: document.getElementById("viewLyricsBtn"),
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

  // A song can be flagged hidden in songs.json (shared, server mode) or in
  // this browser's own list. Either way it sits out of games until unhidden.
  let hiddenLocally = new Set();
  try {
    hiddenLocally = getHiddenSongs();
  } catch (err) {
    console.error("Failed to load hidden songs:", err);
  }
  for (const song of state.songs) {
    song.hidden = Boolean(song.hidden) || hiddenLocally.has(song.file);
  }

  sortSongs();
  renderSongList();
  renderLibrary();
  updateLibraryTag();
}

// Everything a game is allowed to pick from.
function playableSongs() {
  return state.songs.filter((s) => !s.hidden);
}

// Alphabetical by title. A locale-aware collator keeps Hebrew and English in a
// sensible order, and `numeric` stops "45" from sorting before "26".
const songCollator = new Intl.Collator(["he", "en"], {
  numeric: true,
  sensitivity: "base",
});

function sortSongs() {
  state.songs.sort((a, b) =>
    songCollator.compare(a.title || "", b.title || ""),
  );
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
// Both pre-game screens carry a picker, so they are kept in sync.
function userSelects() {
  return [el.userSelect, el.mysteryUserSelect].filter(Boolean);
}

function renderUserSelects() {
  for (const select of userSelects()) {
    select.innerHTML = "";
    for (const name of state.users) {
      const opt = document.createElement("option");
      opt.value = name;
      opt.textContent = name;
      if (name === state.user) opt.selected = true;
      select.appendChild(opt);
    }
  }
}

function setUser(name) {
  state.user = name;
  localStorage.setItem(USER_STORAGE_KEY, name);
  for (const select of userSelects()) select.value = name;
}

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

  renderUserSelects();
}

// Is a song laid out right-to-left (e.g. Hebrew)?
function isRtl(song) {
  const lang = String(song && song.language ? song.language : "").toLowerCase();
  return lang === "he" || lang === "ar" || lang === "rtl";
}

// ---------- Rendering: song list ----------
function renderSongList() {
  const q = normalize(el.songSearch.value || "");
  const matches = playableSongs().filter((s) => {
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
  state.mode = "classic";
  state.current = song;
  state.loadedText = null;
  state.loadedFile = null;

  el.detailTitle.textContent = song.title;
  el.detailArtist.textContent = song.artist ? `by ${song.artist}` : "";
  el.detailLang.textContent = isRtl(song)
    ? "\u{1F524} Hebrew · RTL"
    : `\u{1F524} ${(song.language || "en").toUpperCase()}`;
  el.detailWords.textContent = "… words";

  hideAllScreens();
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

  const mystery = state.mode === "mystery";

  state.tokens = tokenize(text);
  state.totalWords = state.tokens.filter((t) => t.type === "word").length;
  state.foundWords = 0;
  state.timeLeft = GAME_SECONDS;
  state.elapsed = 0;
  state.running = true;
  state.paused = false;
  state.revealedKeys = new Set();
  state.titleSolved = false;
  state.artistSolved = false;
  stopConfetti();

  // In mystery mode the identity of the song is the whole puzzle, so the
  // header shows placeholders instead of the real title and artist.
  el.challengeTitle.textContent = mystery ? "❔ Mystery Song" : song.title;
  el.challengeArtist.textContent = mystery
    ? "Title and artist hidden"
    : song.artist || "";
  el.challengeTitle.dir = mystery ? "ltr" : "auto";
  el.challengeArtist.dir = mystery ? "ltr" : "auto";
  el.challengeTitle.classList.toggle("mystery-hidden", mystery);

  // Lay out lyrics and the guess box right-to-left for RTL songs (e.g. Hebrew).
  const rtl = isRtl(song);
  el.lyrics.dir = rtl ? "rtl" : "ltr";
  el.lyrics.classList.toggle("rtl", rtl);
  el.guessInput.dir = rtl ? "rtl" : "ltr";

  el.guessInput.value = "";
  el.guessInput.disabled = false;
  el.giveUpBtn.disabled = false;
  el.giveUpBtn.textContent = "Give up";
  el.giveUpBtn.classList.remove("hidden");
  // Pausing only matters when a clock is running.
  el.pauseBtn.disabled = false;
  el.pauseBtn.classList.toggle("hidden", mystery);
  el.pauseOverlay.classList.add("hidden");
  el.showResultsBtn.classList.add("hidden");

  // Mystery-only chrome.
  el.mysteryPanel.classList.toggle("hidden", !mystery);
  el.wordCostStat.classList.toggle("hidden", !mystery);
  el.timerLabel.textContent = mystery ? "Elapsed" : "Time";
  el.mysteryTitleGuess.value = "";
  el.mysteryArtistGuess.value = "";
  el.mysteryTitleGuess.disabled = false;
  el.mysteryArtistGuess.disabled = false;
  el.mysteryGuessBtn.disabled = false;
  setMysteryFeedback("");

  renderLyrics();
  updateStats();

  el.appHeader.classList.add("hidden");
  el.homeScreen.classList.add("hidden");
  el.selectScreen.classList.add("hidden");
  el.detailScreen.classList.add("hidden");
  el.mysteryScreen.classList.add("hidden");
  el.challengeScreen.classList.remove("hidden");
  el.resultOverlay.classList.add("hidden");
  // Always begin at the top of the song, even after a previous playthrough
  // left the lyric box scrolled down.
  el.lyrics.scrollTop = 0;
  window.scrollTo(0, 0);
  el.guessInput.focus();

  startTimer();
}

function startTimer() {
  stopTimer();
  updateTimerDisplay();
  state.timerId = setInterval(() => {
    // Mystery mode counts up (no limit); classic counts down to zero.
    if (state.mode === "mystery") {
      state.elapsed += 1;
    } else {
      state.timeLeft -= 1;
    }
    updateTimerDisplay();
    if (state.mode === "classic" && state.timeLeft <= 0) endGame(false);
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
  const mystery = state.mode === "mystery";
  const seconds = mystery ? state.elapsed : state.timeLeft;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  el.timer.textContent = `${m}:${String(s).padStart(2, "0")}`;
  // Nothing to warn about when there is no deadline.
  el.timer.classList.toggle("warning", !mystery && state.timeLeft <= 30);
}

function updateStats() {
  el.wordsFound.textContent = `${state.foundWords} / ${state.totalWords}`;
  const pct =
    state.totalWords === 0 ? 0 : (state.foundWords / state.totalWords) * 100;
  el.progressFill.style.width = `${pct}%`;
  if (state.revealedKeys) el.wordCost.textContent = state.revealedKeys.size;
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
    // In mystery mode the score is the number of distinct words uncovered,
    // so a word only ever costs once no matter how often it repeats.
    state.revealedKeys.add(key);
    updateStats();
    // Clear the input after a successful find so the next guess is clean.
    el.guessInput.value = "";
    // Running out of lyrics ends the round, but in mystery mode it is only a
    // win if the song was actually named along the way.
    if (state.foundWords >= state.totalWords) {
      endGame(state.mode === "mystery" ? state.titleSolved : true);
    }
  }
}

function endGame(won) {
  state.running = false;
  state.paused = false;
  stopTimer();
  el.pauseOverlay.classList.add("hidden");
  el.guessInput.disabled = true;
  el.pauseBtn.classList.add("hidden");
  // The round is over, so "Give up" becomes the way out, and a "Show results"
  // button sits next to it so the overlay can be reopened at any time.
  el.giveUpBtn.textContent = "\u{1F3E0} Exit to home";
  el.giveUpBtn.disabled = false;
  el.giveUpBtn.classList.remove("hidden");
  el.showResultsBtn.classList.remove("hidden");

  // Reveal any remaining hidden words.
  for (const tk of state.tokens) {
    if (tk.type === "word" && !tk.found && tk.node) {
      tk.node.className = "token word revealed-end";
      tk.node.textContent = tk.text;
    }
  }

  if (state.mode === "mystery") return endMysteryGame(won);

  const found = state.foundWords;
  const total = state.totalWords;
  const finishedSeconds = won ? GAME_SECONDS - state.timeLeft : null;
  el.mysteryReveal.classList.add("hidden");
  if (won) {
    el.resultTitle.textContent = "🎉 You found them all!";
    const m = Math.floor(finishedSeconds / 60);
    const s = finishedSeconds % 60;
    el.resultText.textContent = `You uncovered all ${total} words in ${m}:${String(s).padStart(2, "0")}.`;
    launchConfetti();
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
    mode: "classic",
    words: found,
    total,
    finished: won,
    seconds: finishedSeconds,
  });
}

// Mystery rounds end when the title is named (a win) or the player gives up.
// The score is the number of distinct words that had to be uncovered.
function endMysteryGame(solved) {
  const song = state.current;
  const cost = state.revealedKeys.size;

  el.mysteryTitleGuess.disabled = true;
  el.mysteryArtistGuess.disabled = true;
  el.mysteryGuessBtn.disabled = true;

  el.mysteryRevealTitle.textContent = song.title;
  el.mysteryRevealArtist.textContent = song.artist ? `— ${song.artist}` : "";
  el.mysteryReveal.classList.remove("hidden");

  if (solved) {
    el.resultTitle.textContent = "🕵️ Solved it!";
    const wordText = cost === 1 ? "1 word" : `${cost} words`;
    el.resultText.textContent = state.artistSolved
      ? `Title and artist, off just ${wordText}. Outstanding.`
      : `You named the song off just ${wordText}.`;
    launchConfetti();
  } else {
    el.resultTitle.textContent = "🙈 Not this time";
    el.resultText.textContent = `You uncovered ${cost} different words but never landed the title.`;
  }
  el.resultOverlay.classList.remove("hidden");

  submitAndShowLeaderboard({
    user: state.user,
    file: song.file,
    title: song.title,
    mode: "mystery",
    words: state.foundWords,
    total: state.totalWords,
    guesses: cost,
    artistGuessed: state.artistSolved,
    finished: solved,
    seconds: state.elapsed,
  });
}

// ---------- Win confetti ----------
// Small self-contained canvas burst — no library, stops itself when done.
const CONFETTI_COLORS = [
  "#7c5cff",
  "#22d3ee",
  "#34d399",
  "#f472b6",
  "#fbbf24",
  "#f87171",
];
let confettiFrame = null;

function launchConfetti() {
  const canvas = el.confetti;
  if (!canvas || !canvas.getContext) return;
  // Respect the OS "reduce motion" setting.
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

  const ctx = canvas.getContext("2d");
  const dpr = window.devicePixelRatio || 1;
  const width = window.innerWidth;
  const height = window.innerHeight;
  canvas.width = width * dpr;
  canvas.height = height * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  canvas.classList.add("active");

  // Two side cannons plus a centre burst.
  const pieces = [];
  const origins = [
    { x: width * 0.1, y: height * 0.45, spread: 1 },
    { x: width * 0.9, y: height * 0.45, spread: -1 },
    { x: width * 0.5, y: height * 0.25, spread: 0 },
  ];
  for (const origin of origins) {
    for (let i = 0; i < 55; i += 1) {
      const angle =
        origin.spread === 0
          ? Math.random() * Math.PI * 2
          : -Math.PI / 2 + origin.spread * (Math.random() * 1.1 - 0.15);
      const speed = 7 + Math.random() * 9;
      pieces.push({
        x: origin.x,
        y: origin.y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - Math.random() * 4,
        size: 5 + Math.random() * 6,
        color: CONFETTI_COLORS[(Math.random() * CONFETTI_COLORS.length) | 0],
        rotation: Math.random() * Math.PI,
        spin: (Math.random() - 0.5) * 0.35,
        life: 1,
        decay: 0.006 + Math.random() * 0.007,
      });
    }
  }

  cancelAnimationFrame(confettiFrame);
  const step = () => {
    ctx.clearRect(0, 0, width, height);
    let alive = false;

    for (const p of pieces) {
      if (p.life <= 0) continue;
      alive = true;
      p.vy += 0.28; // gravity
      p.vx *= 0.99; // drag
      p.x += p.vx;
      p.y += p.vy;
      p.rotation += p.spin;
      p.life -= p.decay;

      ctx.save();
      ctx.globalAlpha = Math.max(0, p.life);
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rotation);
      ctx.fillStyle = p.color;
      // Flatten vertically as it spins so it reads as a tumbling ribbon.
      ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
      ctx.restore();
    }

    if (alive) {
      confettiFrame = requestAnimationFrame(step);
    } else {
      stopConfetti();
    }
  };
  confettiFrame = requestAnimationFrame(step);
}

function stopConfetti() {
  cancelAnimationFrame(confettiFrame);
  confettiFrame = null;
  const canvas = el.confetti;
  if (!canvas || !canvas.getContext) return;
  canvas.getContext("2d").clearRect(0, 0, canvas.width, canvas.height);
  canvas.classList.remove("active");
}

function hideAllScreens() {
  el.homeScreen.classList.add("hidden");
  el.selectScreen.classList.add("hidden");
  el.detailScreen.classList.add("hidden");
  el.mysteryScreen.classList.add("hidden");
  el.challengeScreen.classList.add("hidden");
  el.addScreen.classList.add("hidden");
  el.libraryScreen.classList.add("hidden");
}

function leaveGame() {
  stopTimer();
  stopConfetti();
  state.running = false;
  el.resultOverlay.classList.add("hidden");
  el.pauseOverlay.classList.add("hidden");
}

function goHome() {
  leaveGame();
  hideAllScreens();
  el.appHeader.classList.remove("hidden");
  el.homeScreen.classList.remove("hidden");
}

function goToSelect() {
  leaveGame();
  hideAllScreens();
  el.appHeader.classList.remove("hidden");
  el.selectScreen.classList.remove("hidden");
}

// ---------- My Library ----------
function goToLibrary() {
  leaveGame();
  hideAllScreens();
  el.appHeader.classList.remove("hidden");
  el.libraryScreen.classList.remove("hidden");
  renderLibrary();
}

function updateLibraryTag() {
  const total = state.songs.length;
  el.libraryTag.textContent =
    total === 1 ? "\u{1F3B6} 1 song" : `\u{1F3B6} ${total} songs`;
}

// The library lists everything, hidden songs included — that is the whole
// point of it, since hiding is reversible.
function renderLibrary() {
  const q = normalize(el.librarySearch.value || "");
  const matches = state.songs.filter((s) => {
    if (!q) return true;
    return (
      normalize(s.title).includes(q) || normalize(s.artist || "").includes(q)
    );
  });

  const hiddenCount = state.songs.filter((s) => s.hidden).length;
  const activeCount = state.songs.length - hiddenCount;
  el.libraryActiveChip.textContent = `\u{1F3A4} ${activeCount} in play`;
  el.libraryHiddenChip.textContent = `\u{1F648} ${hiddenCount} hidden`;

  el.libraryList.innerHTML = "";
  el.libraryEmpty.classList.toggle("hidden", matches.length > 0);
  el.libraryEmpty.textContent = state.songs.length
    ? "No songs match your search."
    : "Your library is empty — add the first song.";

  for (const song of matches) {
    const li = document.createElement("li");
    li.className = song.hidden ? "library-item is-hidden" : "library-item";

    const info = document.createElement("div");
    info.className = "library-info";

    const title = document.createElement("span");
    title.className = "title";
    title.dir = "auto";
    title.textContent = song.title;

    const artist = document.createElement("span");
    artist.className = "artist";
    artist.dir = "auto";
    artist.textContent = song.artist || "";

    info.append(title, artist);

    if (song.hidden) {
      const badge = document.createElement("span");
      badge.className = "library-badge";
      badge.textContent = "Hidden from games";
      info.appendChild(badge);
    }

    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = song.hidden ? "btn btn-secondary" : "btn btn-ghost";
    toggle.textContent = song.hidden ? "\u{1F441} Unhide" : "\u{1F648} Hide";
    toggle.addEventListener("click", () => toggleSongHidden(song, toggle));

    li.append(info, toggle);
    el.libraryList.appendChild(li);
  }
}

async function toggleSongHidden(song, button) {
  const next = !song.hidden;
  button.disabled = true;
  try {
    await setSongHidden(song.file, next, { local: Boolean(song.local) });
    song.hidden = next;
  } catch (err) {
    console.error("Failed to update the song:", err);
    button.disabled = false;
    return;
  }
  renderLibrary();
  renderSongList();
  updateMysteryPool();
}

// ---------- Mystery Song mode ----------
function openMysteryScreen() {
  state.mode = "mystery";
  leaveGame();
  hideAllScreens();
  el.appHeader.classList.remove("hidden");
  el.mysteryScreen.classList.remove("hidden");

  updateMysteryPool();
  renderMysteryLeaderboard();
}

// Songs eligible for a mystery round, honouring the language filter.
function mysteryPool() {
  const lang = el.mysteryLanguage.value;
  const pool = playableSongs();
  if (lang === "any") return pool;
  return pool.filter((s) => String(s.language || "en").toLowerCase() === lang);
}

function updateMysteryPool() {
  const count = mysteryPool().length;
  el.mysteryPoolChip.textContent =
    count === 1 ? "🎲 1 song in the pot" : `🎲 ${count} songs in the pot`;
  el.mysteryStartBtn.disabled = count === 0;
}

function pickMysterySong() {
  const pool = mysteryPool();
  if (pool.length === 0) return null;
  // Avoid the last few songs so back-to-back rounds stay fresh, unless the
  // pool is too small to allow it.
  const fresh = pool.filter((s) => !state.mysteryHistory.includes(s.file));
  const from = fresh.length > 0 ? fresh : pool;
  return from[Math.floor(Math.random() * from.length)];
}

async function startMysteryRound() {
  const song = pickMysterySong();
  if (!song) return;

  state.mode = "mystery";
  state.mysteryHistory.push(song.file);
  if (state.mysteryHistory.length > MYSTERY_HISTORY) {
    state.mysteryHistory.shift();
  }
  // Nothing is preloaded for a mystery round — force a fresh read.
  state.loadedText = null;
  state.loadedFile = null;
  await startChallenge(song);
}

function setMysteryFeedback(message, tone = "info") {
  el.mysteryFeedback.textContent = message;
  el.mysteryFeedback.dataset.tone = tone;
  el.mysteryFeedback.classList.toggle("hidden", !message);
}

// Loose comparison for titles and artist names: case, accents, Hebrew niqqud,
// punctuation and bracketed extras like "(Remastered)" are all ignored.
function normalizeName(text) {
  return String(text || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // latin accents
    .replace(/[\u0591-\u05C7]/g, "") // hebrew niqqud / cantillation
    .replace(/[’‘`]/g, "'")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Every spelling of the answer we are willing to accept.
function acceptedForms(name) {
  const forms = new Set();
  const raw = String(name || "");
  const add = (value) => {
    const norm = normalizeName(value);
    if (norm) forms.add(norm);
  };
  add(raw);
  add(raw.replace(/[([{].*?[)\]}]/g, " ")); // without "(Live)", "[Remix]", …
  add(raw.replace(/\s*-\s*.*$/, "")); // without a " - Radio Edit" suffix
  for (const form of [...forms]) {
    if (form.startsWith("the ")) forms.add(form.slice(4));
  }
  return [...forms];
}

// Standard Levenshtein, capped so a long wrong answer bails out early.
function editDistance(a, b, max) {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    const row = [i];
    let best = i;
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      row[j] = Math.min(row[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
      if (row[j] < best) best = row[j];
    }
    if (best > max) return max + 1;
    prev = row;
  }
  return prev[b.length];
}

// A guess counts if it matches any accepted form outright, or is within a
// typo or two of one — nobody should lose on a missing letter.
function namesMatch(guess, answer) {
  const g = normalizeName(guess);
  if (!g) return false;
  for (const form of acceptedForms(answer)) {
    if (g === form) return true;
    const tolerance = form.length >= 12 ? 2 : form.length >= 6 ? 1 : 0;
    if (tolerance && editDistance(g, form, tolerance) <= tolerance) return true;
  }
  return false;
}

// Artists are matched more leniently: featured-artist lists and band prefixes
// mean a containment check is usually the fair call.
function artistMatches(guess, answer) {
  if (namesMatch(guess, answer)) return true;
  const g = normalizeName(guess);
  const a = normalizeName(answer);
  if (g.length < 3 || a.length < 3) return false;
  return a.includes(g) || g.includes(a);
}

function submitMysteryGuess() {
  if (!state.running || state.mode !== "mystery") return;

  const titleGuess = el.mysteryTitleGuess.value.trim();
  const artistGuess = el.mysteryArtistGuess.value.trim();
  if (!titleGuess && !artistGuess) {
    setMysteryFeedback(
      "Type a song name (and the artist, if you can).",
      "warn",
    );
    return;
  }

  const song = state.current;
  // The artist is a bonus — it never ends the round on its own, but a correct
  // one sticks so it can be credited when the title lands.
  if (artistGuess && artistMatches(artistGuess, song.artist)) {
    state.artistSolved = true;
  }

  if (titleGuess && namesMatch(titleGuess, song.title)) {
    state.titleSolved = true;
    endGame(true);
    return;
  }

  if (!titleGuess) {
    setMysteryFeedback(
      state.artistSolved
        ? "Right artist! Now name the song."
        : "That artist isn't it — keep digging.",
      state.artistSolved ? "ok" : "warn",
    );
    return;
  }

  setMysteryFeedback(
    state.artistSolved
      ? "Artist is right, but that's not the title. Try again."
      : "Not it. Uncover another word and have another go.",
    "warn",
  );
}

// ---------- Add a custom song ----------
function openAddSong() {
  hideAllScreens();
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
    goToLibrary();
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
  await renderLeaderboard(result.file, result.mode, savedRecord);
}

// Records saved before mystery mode existed have no `mode` field.
function scoreMode(score) {
  return score.mode === "mystery" ? "mystery" : "classic";
}

// Best score first: more words wins; ties broken by finishing, then faster time.
function compareScores(a, b) {
  if (b.words !== a.words) return b.words - a.words;
  if (a.finished !== b.finished) return a.finished ? -1 : 1;
  if (a.finished && b.finished)
    return (a.seconds ?? Infinity) - (b.seconds ?? Infinity);
  return new Date(b.date) - new Date(a.date);
}

// Mystery ranks the other way round: solving the song at all comes first, then
// the fewest words revealed, then naming the artist too, then the quicker run.
function compareMysteryScores(a, b) {
  if (a.finished !== b.finished) return a.finished ? -1 : 1;
  const aCost = a.guesses ?? Infinity;
  const bCost = b.guesses ?? Infinity;
  if (aCost !== bCost) return aCost - bCost;
  if (a.artistGuessed !== b.artistGuessed) return a.artistGuessed ? -1 : 1;
  return (a.seconds ?? Infinity) - (b.seconds ?? Infinity);
}

function formatSeconds(sec) {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

async function renderLeaderboard(file, mode, savedRecord) {
  const scores = await fetchSongScores(file, mode);
  fillLeaderboard(el.leaderboardList, el.leaderboardEmpty, scores, {
    limit: 10,
    mode,
    savedRecord,
  });
}

async function renderDetailLeaderboard(file) {
  const scores = await fetchSongScores(file, "classic");
  fillLeaderboard(el.detailLeaderboardList, el.detailLeaderboardEmpty, scores, {
    limit: 5,
    mode: "classic",
  });
}

// The mystery board spans every song — the challenge is the same regardless of
// which track came up, so one global ranking is the fair comparison.
async function renderMysteryLeaderboard() {
  let scores = [];
  try {
    scores = (await getScores()).filter((s) => scoreMode(s) === "mystery");
  } catch (err) {
    console.error("Failed to load leaderboard:", err);
  }
  fillLeaderboard(
    el.mysteryLeaderboardList,
    el.mysteryLeaderboardEmpty,
    scores,
    { limit: 10, mode: "mystery", showSong: true },
  );
}

async function fetchSongScores(file, mode) {
  try {
    const scores = await getScores();
    return scores.filter((s) => s.file === file && scoreMode(s) === mode);
  } catch (err) {
    console.error("Failed to load leaderboard:", err);
  }
  return [];
}

const MEDALS = ["\u{1F947}", "\u{1F948}", "\u{1F949}"]; // gold, silver, bronze

function fillLeaderboard(
  listEl,
  emptyEl,
  scores,
  { limit, mode = "classic", savedRecord, showSong = false },
) {
  const mystery = mode === "mystery";
  scores.sort(mystery ? compareMysteryScores : compareScores);
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
    if (mystery) {
      const cost = s.guesses ?? 0;
      score.textContent = s.finished
        ? `${cost} ${cost === 1 ? "word" : "words"}`
        : "unsolved";
      if (!s.finished) score.classList.add("lb-unsolved");
    } else {
      score.textContent = `${s.words}/${s.total}`;
    }
    main.appendChild(score);

    if (mystery && s.finished && s.artistGuessed) {
      const bonus = document.createElement("span");
      bonus.className = "lb-time lb-finished";
      bonus.textContent = "+ artist";
      main.appendChild(bonus);
    }
    if (mystery && showSong && s.title) {
      const songName = document.createElement("span");
      songName.className = "lb-song";
      songName.dir = "auto";
      songName.textContent = s.title;
      main.appendChild(songName);
    }
    if (!mystery && s.finished && s.seconds != null) {
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
el.modeClassicBtn.addEventListener("click", () => {
  state.mode = "classic";
  goToSelect();
});
el.modeMysteryBtn.addEventListener("click", openMysteryScreen);
el.modeLibraryBtn.addEventListener("click", goToLibrary);
el.selectBackBtn.addEventListener("click", goHome);
el.songSearch.addEventListener("input", renderSongList);
el.libraryBackBtn.addEventListener("click", goHome);
el.librarySearch.addEventListener("input", renderLibrary);
el.libraryAddBtn.addEventListener("click", openAddSong);
el.addBackBtn.addEventListener("click", goToLibrary);
el.addCancelBtn.addEventListener("click", goToLibrary);
el.addSongForm.addEventListener("submit", submitNewSong);
for (const select of userSelects()) {
  select.addEventListener("change", (e) => setUser(e.target.value));
}
el.guessInput.addEventListener("input", (e) => handleGuess(e.target.value));
el.pauseBtn.addEventListener("click", pauseGame);
el.continueBtn.addEventListener("click", resumeGame);
// Mid-round this is "Give up"; once the round is over it is the way home.
el.giveUpBtn.addEventListener("click", () => {
  if (state.running) endGame(false);
  else goHome();
});
el.detailBackBtn.addEventListener("click", goToSelect);
el.startGameBtn.addEventListener("click", () => {
  if (state.current) {
    state.mode = "classic";
    startChallenge(state.current);
  }
});

// ---------- Events: Mystery Song ----------
el.mysteryBackBtn.addEventListener("click", goHome);
el.mysteryStartBtn.addEventListener("click", startMysteryRound);
el.mysteryLanguage.addEventListener("change", () => {
  localStorage.setItem(MYSTERY_LANG_KEY, el.mysteryLanguage.value);
  updateMysteryPool();
});
el.mysteryGuessBtn.addEventListener("click", submitMysteryGuess);
for (const input of [el.mysteryTitleGuess, el.mysteryArtistGuess]) {
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      submitMysteryGuess();
    }
  });
}

el.exitHomeBtn.addEventListener("click", goHome);
// Close the overlay to reveal the finished lyrics behind it (missed words in red).
el.viewLyricsBtn.addEventListener("click", () => {
  el.resultOverlay.classList.add("hidden");
});
// Reopen the results overlay after reviewing the lyrics.
el.showResultsBtn.addEventListener("click", () => {
  el.resultOverlay.classList.remove("hidden");
});

// ---------- Init ----------
el.mysteryLanguage.value =
  localStorage.getItem(MYSTERY_LANG_KEY) || el.mysteryLanguage.value;

loadUsers();
loadSongs().then(updateMysteryPool);
