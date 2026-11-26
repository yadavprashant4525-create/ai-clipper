const express = require("express");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const os = require("os");
const dns = require("dns").promises;
const net = require("net");
const http = require("http");
const https = require("https");
const { spawn } = require("child_process");
const crypto = require("crypto");
const { Transform } = require("stream");
const { pipeline } = require("stream/promises");

const app = express();
const PORT = process.env.PORT || 3000;

const MAX_SIZE = 200 * 1024 * 1024;
const TEMP_DIR = path.join(os.tmpdir(), "ai-clipper-uploads");

fs.mkdirSync(TEMP_DIR, { recursive: true });

app.use(express.json({ limit: "10kb" }));
app.use(express.static(path.join(__dirname, "public")));

const upload = multer({
  dest: TEMP_DIR,
  limits: { fileSize: MAX_SIZE },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const allowed = [
      ".mp4", ".mov", ".m4v",
      ".webm", ".mkv", ".avi", ".3gp"
    ];

    if (
      (file.mimetype && file.mimetype.startsWith("video/")) ||
      allowed.includes(ext)
    ) {
      return cb(null, true);
    }

    cb(new Error("Please upload a supported video file."));
  }
});

function removeFile(filePath) {
  if (filePath) {
    fs.rm(filePath, { force: true }, () => {});
  }
}


function runProcess(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args);
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", chunk => { stdout += chunk.toString(); });
    child.stderr.on("data", chunk => { stderr += chunk.toString(); });
    child.on("error", reject);
    child.on("close", code => {
      if (code === 0) resolve(stdout.trim());
      else reject(new Error(stderr.trim() || command + " failed."));
    });
  });
}

async function transcribeAndSelectMoments(videoPath) {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("AI setup pending: Render me OPENAI_API_KEY environment variable add karein.");
  }

  const audioPath = path.join(TEMP_DIR, `audio-${crypto.randomBytes(10).toString("hex")}.mp3`);
  try {
    await runProcess("ffmpeg", [
      "-hide_banner", "-loglevel", "error", "-y", "-i", videoPath,
      "-vn", "-ac", "1", "-ar", "16000", "-b:a", "32k", "-f", "mp3", audioPath
    ]);

    const audio = await fs.promises.readFile(audioPath);
    if (!audio.length || audio.length > 24 * 1024 * 1024) {
      throw new Error("Audio 24 MB se bada hai. Chhota video upload karein (ya video ko chhote parts me baantein).");
    }

    const audioForm = new FormData();
    audioForm.append("file", new Blob([audio], { type: "audio/mpeg" }), "audio.mp3");
    audioForm.append("model", "whisper-1");
    audioForm.append("response_format", "verbose_json");
    const transcriptionResponse = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
      body: audioForm
    });
    const transcriptionBody = await transcriptionResponse.json().catch(() => ({}));
    if (!transcriptionResponse.ok) {
      throw new Error(transcriptionBody.error?.message || "Transcription API failed. API key/billing check karein.");
    }

    const segments = Array.isArray(transcriptionBody.segments) ? transcriptionBody.segments : [];
    if (!segments.length) throw new Error("Is video ki speech transcript nahi mil paayi.");

    const durationText = await runProcess("ffprobe", [
      "-v", "error", "-show_entries", "format=duration",
      "-of", "default=noprint_wrappers=1:nokey=1", videoPath
    ]);
    const videoDuration = Number(durationText);
    if (!Number.isFinite(videoDuration) || videoDuration < 20) {
      throw new Error("Video ki duration read nahi ho paayi ya video bahut chhota hai.");
    }

    const compactTranscript = segments.slice(0, 2200).map(segment => ({
      start: Number(segment.start),
      end: Number(segment.end),
      text: String(segment.text || "").slice(0, 500)
    }));

    const aiResponse = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        temperature: 0.3,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content: "You are an expert short-form video editor. Select exactly 10 distinct, high-retention moments from this transcript. Choose complete moments with a strong hook, payoff, emotion, surprise, humor, useful insight, or story. Do not invent events. Each clip must be 15 to 90 seconds, fit within video duration, and preferably not overlap. Return only JSON: {\"clips\":[{\"start\":number,\"end\":number,\"title\":string,\"reason\":string}]}. Times are seconds."
          },
          {
            role: "user",
            content: "Video duration seconds: " + videoDuration + "\nSelect exactly 10 clips from this timestamped transcript:\n" + JSON.stringify(compactTranscript)
          }
        ]
      })
    });
    const aiBody = await aiResponse.json().catch(() => ({}));
    if (!aiResponse.ok) {
      throw new Error(aiBody.error?.message || "AI moment selection failed.");
    }

    let result;
    try {
      result = JSON.parse(aiBody.choices?.[0]?.message?.content || "{}");
    } catch {
      throw new Error("AI ne valid clip list return nahi ki. Dobara try karein.");
    }

    const clips = Array.isArray(result.clips) ? result.clips : [];
    const valid = clips.map((clip, index) => {
      const start = Math.max(0, Number(clip.start));
      const end = Math.min(videoDuration, Number(clip.end));
      if (!Number.isFinite(start) || !Number.isFinite(end) || end - start < 15 || end - start > 90) return null;
      return {
        start: Math.round(start * 10) / 10,
        end: Math.round(end * 10) / 10,
        title: String(clip.title || `Moment ${index + 1}`).slice(0, 90),
        reason: String(clip.reason || "AI-selected moment").slice(0, 180)
      };
    }).filter(Boolean).slice(0, 10);

    if (valid.length !== 10) {
      throw new Error("AI ko 10 valid alag clips nahi mile. Thoda lamba ya speech wala video try karein.");
    }

    return { clips: valid, videoDuration: Math.round(videoDuration) };
  } finally {
    removeFile(audioPath);
  }
}

function createClipFile(inputPath, start, duration, outputPath) {
  return runProcess("ffmpeg", [
    "-hide_banner", "-loglevel", "error", "-y", "-threads", "1",
    "-filter_threads", "1", "-ss", String(start), "-i", inputPath,
    "-t", String(duration), "-map", "0:v:0", "-map", "0:a?",
    "-vf", "scale=w='min(1280,iw)':h='min(720,ih)':force_original_aspect_ratio=decrease:force_divisible_by=2",
    "-c:v", "libx264", "-preset", "ultrafast", "-crf", "28",
    "-pix_fmt", "yuv420p", "-threads", "1", "-c:a", "aac",
    "-b:a", "96k", "-movflags", "+faststart", outputPath
  ]);
}

app.post("/api/analyze-video", upload.single("video"), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: "Pehle creator ki permission wala original video upload karein." });
  }
  try {
    const result = await transcribeAndSelectMoments(req.file.path);
    res.json(result);
  } catch (error) {
    console.error("AI analysis error:", error.message);
    res.status(400).json({ error: error.message || "AI analysis failed." });
  } finally {
    removeFile(req.file.path);
  }
});

app.post("/api/create-clips", upload.single("video"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "Video file missing." });
  let workDir;
  try {
    let clips;
    try { clips = JSON.parse(req.body.clips || "[]"); } catch { clips = []; }
    if (!Array.isArray(clips) || clips.length !== 10) {
      throw new Error("Exactly 10 AI-selected clips required.");
    }
    workDir = path.join(TEMP_DIR, `batch-${crypto.randomBytes(10).toString("hex")}`);
    fs.mkdirSync(workDir, { recursive: true });
    const outputs = [];
    for (let i = 0; i < clips.length; i++) {
      const start = Number(clips[i].start);
      const end = Number(clips[i].end);
      if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start || end - start > 90) {
        throw new Error("AI clip timing invalid hai.");
      }
      const output = path.join(workDir, `ai-clip-${String(i + 1).padStart(2, "0")}.mp4`);
      await createClipFile(req.file.path, start, end - start, output);
      outputs.push(output);
    }

    const archiver = require("archiver");
    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Disposition", 'attachment; filename="ai-clips-10.zip"');
    const archive = archiver("zip", { zlib: { level: 1 } });
    archive.on("error", error => {
      console.error("ZIP error:", error.message);
      if (!res.headersSent) res.status(500).end("Could not package clips.");
      else res.destroy(error);
    });
    res.on("close", () => {
      removeFile(req.file.path);
      fs.rm(workDir, { recursive: true, force: true }, () => {});
    });
    archive.pipe(res);
    outputs.forEach(file => archive.file(file, { name: path.basename(file) }));
    await archive.finalize();
  } catch (error) {
    removeFile(req.file.path);
    if (workDir) fs.rm(workDir, { recursive: true, force: true }, () => {});
    console.error("Batch clip error:", error.message);
    if (!res.headersSent) res.status(400).json({ error: error.message || "Could not create clips." });
  }
});

app.get("/api/health", (_req, res) => {
  res.json({ status: "ok" });
});

function validateTiming(startValue, endValue) {
  const start = Number(startValue);
  const end = Number(endValue);

  if (
    !Number.isFinite(start) ||
    !Number.isFinite(end) ||
    start < 0 ||
    end <= start ||
    end - start > 600
  ) {
    return null;
  }

  return { start, duration: end - start };
}

// Only allow public IPv4 addresses.
function isPublicIPv4(address) {
  const parts = address.split(".").map(Number);

  if (
    parts.length !== 4 ||
    parts.some(n => !Number.isInteger(n) || n < 0 || n > 255)
  ) return false;

  const [a, b] = parts;

  if (
    a === 0 || a === 10 || a === 127 ||
    a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && (b === 168 || b === 0)) ||
    (a === 198 && (b === 18 || b === 19 || b === 51)) ||
    (a === 203 && b === 0)
  ) return false;

  return true;
}

async function getPublicIPv4(hostname) {
  if (net.isIP(hostname)) {
    if (!isPublicIPv4(hostname)) {
      throw new Error("This video address is not allowed.");
    }
    return hostname;
  }

  const records = await dns.lookup(hostname, {
    family: 4,
    all: true,
    verbatim: true
  });

  if (!records.length || records.some(r => !isPublicIPv4(r.address))) {
    throw new Error("This video address is not allowed.");
  }

  return records[0].address;
}

async function downloadRemoteVideo(rawUrl, outputPath, redirects = 0) {
  if (redirects > 3) {
    throw new Error("Too many video link redirects.");
  }

  let url;

  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error("Please enter a valid MP4 video link.");
  }

  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    !url.hostname ||
    ![80, 443].includes(Number(url.port || (url.protocol === "https:" ? 443 : 80)))
  ) {
    throw new Error("Only public HTTP/HTTPS video links are supported.");
  }

  const ip = await getPublicIPv4(url.hostname);
  const client = url.protocol === "https:" ? https : http;

  const result = await new Promise((resolve, reject) => {
    const request = client.get({
      hostname: url.hostname,
      port: url.port || undefined,
      path: url.pathname + url.search,
      servername: net.isIP(url.hostname) ? undefined : url.hostname,
      lookup: (_host, _options, callback) => callback(null, ip, 4),
      headers: {
        "User-Agent": "AI-Clipper/1.0",
        "Accept": "video/mp4,video/*,application/octet-stream"
      }
    }, async response => {
      const status = response.statusCode || 0;

      if ([301, 302, 303, 307, 308].includes(status)) {
        const location = response.headers.location;
        response.resume();

        if (!location) {
          return resolve({ error: "Invalid redirect from video server." });
        }

        return resolve({
          redirect: new URL(location, url).toString()
        });
      }

      if (status !== 200) {
        response.resume();
        return resolve({
          error: `Video link returned status ${status}.`
        });
      }

      const contentType = String(
        response.headers["content-type"] || ""
      ).toLowerCase();

      const isMp4Path = url.pathname.toLowerCase().endsWith(".mp4");
      const isVideo = contentType.startsWith("video/");
      const isBinary = contentType.includes("application/octet-stream");

      if (!isMp4Path && !isVideo && !isBinary) {
        response.resume();
        return resolve({
          error: "The link does not appear to be a direct video file."
        });
      }

      const length = Number(response.headers["content-length"] || 0);

      if (length > MAX_SIZE) {
        response.resume();
        return resolve({
          error: "Video is too large. Maximum size is 200 MB."
        });
      }

      let total = 0;

      const limiter = new Transform({
        transform(chunk, encoding, callback) {
          total += chunk.length;

          if (total > MAX_SIZE) {
            callback(new Error("Video is too large. Maximum size is 200 MB."));
          } else {
            callback(null, chunk);
          }
        }
      });

      try {
        await pipeline(
          response,
          limiter,
          fs.createWriteStream(outputPath, { flags: "w" })
        );

        resolve({ success: true, size: total });
      } catch (error) {
        resolve({ error: error.message });
      }
    });

    request.setTimeout(30000, () => {
      request.destroy(new Error("Video download timed out."));
    });

    request.on("error", error => {
      reject(error);
    });
  });

  if (result.redirect) {
    return downloadRemoteVideo(result.redirect, outputPath, redirects + 1);
  }

  if (result.error) {
    throw new Error(result.error);
  }

  if (!result.size) {
    throw new Error("The video file is empty.");
  }
}

function createClip(inputPath, start, duration, res) {
  const outputName =
    `clip-${crypto.randomBytes(8).toString("hex")}.mp4`;

  const outputPath = path.join(os.tmpdir(), outputName);

  const args = [
    "-hide_banner",
    "-loglevel", "error",
    "-y",
    "-threads", "1",
    "-filter_threads", "1",
    "-ss", String(start),
    "-i", inputPath,
    "-t", String(duration),
    "-map", "0:v:0",
    "-map", "0:a?",
    "-vf",
    "scale=w='min(1280,iw)':h='min(720,ih)':force_original_aspect_ratio=decrease:force_divisible_by=2",
    "-c:v", "libx264",
    "-preset", "ultrafast",
    "-crf", "28",
    "-pix_fmt", "yuv420p",
    "-threads", "1",
    "-c:a", "aac",
    "-b:a", "96k",
    "-movflags", "+faststart",
    outputPath
  ];

  let finished = false;
  let errorText = "";

  const cleanup = () => {
    removeFile(inputPath);
    removeFile(outputPath);
  };

  const ffmpeg = spawn("ffmpeg", args);

  ffmpeg.stderr.on("data", chunk => {
    errorText += chunk.toString();
  });

  ffmpeg.on("error", error => {
    if (finished) return;
    finished = true;

    console.error("FFmpeg could not start:", error);
    cleanup();

    if (!res.headersSent) {
      res.status(500).json({
        error: "FFmpeg could not start. Please check server setup."
      });
    }
  });

  ffmpeg.on("close", code => {
    if (finished) return;
    finished = true;

    removeFile(inputPath);

    if (code !== 0 || !fs.existsSync(outputPath)) {
      console.error("FFmpeg failed:", errorText);
      removeFile(outputPath);

      if (!res.headersSent) {
        res.status(500).json({
          error: "Video processing failed. Try another video or timing."
        });
      }
      return;
    }

    res.download(outputPath, "my-clip.mp4", error => {
      removeFile(outputPath);

      if (error) {
        console.error("Download failed:", error.message);
      }
    });
  });
}

// Gallery upload
app.post("/api/clip", upload.single("video"), (req, res) => {
  if (!req.file) {
    return res.status(400).json({
      error: "Please choose a video first."
    });
  }

  const timing = validateTiming(req.body.start, req.body.end);

  if (!timing) {
    removeFile(req.file.path);
    return res.status(400).json({
      error: "Invalid timing. Clip must be 1 to 600 seconds."
    });
  }

  createClip(req.file.path, timing.start, timing.duration, res);
});

// Direct MP4 URL
app.post("/api/clip-from-url", async (req, res) => {
  const timing = validateTiming(req.body.start, req.body.end);

  if (!timing) {
    return res.status(400).json({
      error: "Invalid timing. Clip must be 1 to 600 seconds."
    });
  }

  const inputPath = path.join(
    TEMP_DIR,
    `remote-${crypto.randomBytes(12).toString("hex")}.mp4`
  );

  try {
    if (typeof req.body.url !== "string" || req.body.url.length > 2048) {
      throw new Error("Please enter a valid video link.");
    }

    await downloadRemoteVideo(req.body.url, inputPath);

    createClip(inputPath, timing.start, timing.duration, res);
  } catch (error) {
    removeFile(inputPath);
    console.error("URL video error:", error.message);

    if (!res.headersSent) {
      res.status(400).json({
        error: error.message || "Could not download this video."
      });
    }
  }
});

app.use((err, _req, res, _next) => {
  console.error("Server error:", err);

  if (err instanceof multer.MulterError) {
    if (err.code === "LIMIT_FILE_SIZE") {
      return res.status(413).json({
        error: "Video is too large. Maximum size is 200 MB."
      });
    }
  }

  if (!res.headersSent) {
    res.status(400).json({
      error: err.message || "Something went wrong."
    });
  }
});

app.listen(PORT, () => {
  console.log(`AI Clipper running on port ${PORT}`);
});
