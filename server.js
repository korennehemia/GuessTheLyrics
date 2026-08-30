// Zero-dependency static file server for the Guess Song Lyrics game.
// Run:  node server.js   then open  http://localhost:3000
const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = process.env.PORT || 3000;
const ROOT = __dirname;
const SCORES_FILE = path.join(ROOT, "data", "scores.json");
const SONGS_FILE = path.join(ROOT, "config", "songs.json");
const LYRICS_DIR = path.join(ROOT, "config", "lyrics");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

const server = http.createServer((req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const urlPath = decodeURIComponent(url.pathname);

    // ---------- API: leaderboard scores ----------
    if (urlPath === "/api/scores") {
      if (req.method === "GET") return sendScores(res);
      if (req.method === "POST") return saveScore(req, res);
      res
        .writeHead(405, { "Content-Type": "text/plain" })
        .end("Method not allowed");
      return;
    }

    // ---------- API: add a custom song ----------
    if (urlPath === "/api/songs") {
      if (req.method === "POST") return saveSong(req, res);
      res
        .writeHead(405, { "Content-Type": "text/plain" })
        .end("Method not allowed");
      return;
    }

    let filePath = path.normalize(path.join(ROOT, urlPath));

    // Prevent path traversal outside the project root.
    if (!filePath.startsWith(ROOT)) {
      res.writeHead(403).end("Forbidden");
      return;
    }

    // Never serve the raw scores file as a static asset (use the API instead).
    if (filePath === SCORES_FILE) {
      res.writeHead(404, { "Content-Type": "text/plain" }).end("Not found");
      return;
    }

    if (urlPath === "/" || urlPath === "") {
      filePath = path.join(ROOT, "index.html");
    }

    fs.stat(filePath, (err, stats) => {
      if (err || !stats.isFile()) {
        res.writeHead(404, { "Content-Type": "text/plain" }).end("Not found");
        return;
      }
      const ext = path.extname(filePath).toLowerCase();
      res.writeHead(200, {
        "Content-Type": MIME[ext] || "application/octet-stream",
      });
      fs.createReadStream(filePath).pipe(res);
    });
  } catch (e) {
    res.writeHead(500, { "Content-Type": "text/plain" }).end("Server error");
  }
});

function readScores() {
  try {
    const raw = fs.readFileSync(SCORES_FILE, "utf8");
    const data = JSON.parse(raw);
    return Array.isArray(data.scores) ? data.scores : [];
  } catch {
    return [];
  }
}

function sendScores(res) {
  const scores = readScores();
  res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify({ scores }));
}

function saveScore(req, res) {
  let body = "";
  let tooBig = false;
  req.on("data", (chunk) => {
    body += chunk;
    if (body.length > 10_000) {
      // guard against oversized payloads
      tooBig = true;
      req.destroy();
    }
  });
  req.on("end", () => {
    if (tooBig) {
      res
        .writeHead(413, { "Content-Type": "text/plain" })
        .end("Payload too large");
      return;
    }
    let entry;
    try {
      entry = JSON.parse(body);
    } catch {
      res.writeHead(400, { "Content-Type": "text/plain" }).end("Invalid JSON");
      return;
    }

    // Whitelist and sanitize the fields we persist.
    const record = {
      user: String(entry.user || "Guest").slice(0, 60),
      file: String(entry.file || "").slice(0, 200),
      title: String(entry.title || "").slice(0, 200),
      // "classic" races the clock; "mystery" hides the song and scores on how
      // few words were revealed before naming it.
      mode: entry.mode === "mystery" ? "mystery" : "classic",
      words: Number.isFinite(entry.words)
        ? Math.max(0, Math.floor(entry.words))
        : 0,
      total: Number.isFinite(entry.total)
        ? Math.max(0, Math.floor(entry.total))
        : 0,
      // Mystery only: distinct words the player had to reveal. Lower is better.
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

    if (!record.file) {
      res.writeHead(400, { "Content-Type": "text/plain" }).end("Missing song");
      return;
    }

    const scores = readScores();
    scores.push(record);
    try {
      fs.writeFileSync(SCORES_FILE, JSON.stringify({ scores }, null, 2));
    } catch (e) {
      res
        .writeHead(500, { "Content-Type": "text/plain" })
        .end("Could not save score");
      return;
    }
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ ok: true, record }));
  });
}

function saveSong(req, res) {
  let body = "";
  let tooBig = false;
  req.on("data", (chunk) => {
    body += chunk;
    if (body.length > 100_000) {
      // guard against oversized payloads
      tooBig = true;
      req.destroy();
    }
  });
  req.on("end", () => {
    if (tooBig) {
      res
        .writeHead(413, { "Content-Type": "text/plain" })
        .end("Payload too large");
      return;
    }
    let data;
    try {
      data = JSON.parse(body);
    } catch {
      res.writeHead(400, { "Content-Type": "text/plain" }).end("Invalid JSON");
      return;
    }

    const title = String(data.title || "")
      .trim()
      .slice(0, 200);
    const artist = String(data.artist || "")
      .trim()
      .slice(0, 200);
    const language = String(data.language || "en")
      .trim()
      .toLowerCase()
      .slice(0, 10);
    const lyrics = String(data.lyrics || "")
      .replace(/\r\n/g, "\n")
      .slice(0, 50_000);

    if (!title) {
      res.writeHead(400, { "Content-Type": "text/plain" }).end("Missing title");
      return;
    }
    if (!lyrics.trim()) {
      res
        .writeHead(400, { "Content-Type": "text/plain" })
        .end("Missing lyrics");
      return;
    }

    // Build a safe filename from the title. Strip path separators and any
    // characters that are illegal (or dangerous) in file names — the client
    // never gets to choose the path.
    let base = title
      .replace(/[\\/:*?"<>|\u0000-\u001f]/g, "")
      .replace(/\.+$/, "")
      .trim();
    if (!base) base = "song";

    let file = `${base}.txt`;
    let counter = 2;
    while (fs.existsSync(path.join(LYRICS_DIR, file))) {
      file = `${base} (${counter}).txt`;
      counter += 1;
    }

    // Final guard: make sure the resolved path stays inside the lyrics folder.
    const target = path.normalize(path.join(LYRICS_DIR, file));
    if (!target.startsWith(LYRICS_DIR)) {
      res.writeHead(400, { "Content-Type": "text/plain" }).end("Bad file name");
      return;
    }

    let songsData;
    try {
      songsData = JSON.parse(fs.readFileSync(SONGS_FILE, "utf8"));
    } catch {
      songsData = { songs: [] };
    }
    if (!Array.isArray(songsData.songs)) songsData.songs = [];

    const entry = { file, title, artist, language };
    try {
      fs.writeFileSync(target, lyrics, "utf8");
      songsData.songs.push(entry);
      fs.writeFileSync(SONGS_FILE, JSON.stringify(songsData, null, 2), "utf8");
    } catch (e) {
      res
        .writeHead(500, { "Content-Type": "text/plain" })
        .end("Could not save song");
      return;
    }

    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ ok: true, song: entry }));
  });
}

server.listen(PORT, () => {
  console.log(`\n🎵 Guess Song Lyrics running at  http://localhost:${PORT}\n`);
});
