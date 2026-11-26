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
