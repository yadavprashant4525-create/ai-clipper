
const express = require("express");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const os = require("os");
const { spawn } = require("child_process");
const crypto = require("crypto");

const app = express();
const PORT = process.env.PORT || 3000;

const upload = multer({
  dest: path.join(os.tmpdir(), "ai-clipper-uploads"),
  limits: {
    fileSize: 200 * 1024 * 1024
  },
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

app.use(express.static(path.join(__dirname, "public")));

function removeFile(filePath) {
  if (filePath) {
    fs.rm(filePath, { force: true }, () => {});
  }
}

app.get("/api/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.post("/api/clip", upload.single("video"), (req, res) => {
  if (!req.file) {
    return res.status(400).json({
      error: "Please choose a video first."
    });
  }

  const inputPath = req.file.path;
  const start = Number(req.body.start);
  const end = Number(req.body.end);
  const duration = end - start;

  if (
    !Number.isFinite(start) ||
    !Number.isFinite(end) ||
    start < 0 ||
    duration <= 0 ||
    duration > 600
  ) {
    removeFile(inputPath);

    return res.status(400).json({
      error: "Invalid timing. Clip must be 1 to 600 seconds."
    });
  }

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

  console.log("Starting FFmpeg clip processing");

  let errorText = "";
  let finished = false;

  const cleanup = () => {
    removeFile(inputPath);
    removeFile(outputPath);
  };

  const ffmpeg = spawn("ffmpeg", args);

  ffmpeg.stderr.on("data", chunk => {
    errorText += chunk.toString();
  });

  ffmpeg.on("error", err => {
    if (finished) return;
    finished = true;

    console.error("FFmpeg could not start:", err);
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
          error: "Video processing failed. Try a smaller video."
        });
      }
      return;
    }

    console.log("Clip created successfully");

    res.download(outputPath, "my-clip.mp4", err => {
      removeFile(outputPath);

      if (err) {
        console.error("Download failed:", err.message);
      }
    });
  });
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
