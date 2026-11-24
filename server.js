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
  limits: { fileSize: 500 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype && file.mimetype.startsWith("video/")) return cb(null, true);
    cb(new Error("Please upload a video file."));
  }
});

app.use(express.static(path.join(__dirname, "public")));

app.post("/api/clip", upload.single("video"), (req, res) => {
  if (!req.file) return res.status(400).json({ error: "Choose a video first." });

  const start = Number(req.body.start);
  const end = Number(req.body.end);
  const duration = end - start;

  if (!Number.isFinite(start) || !Number.isFinite(end) ||
      start < 0 || duration <= 0 || duration > 600) {
    fs.rm(req.file.path, { force: true }, () => {});
    return res.status(400).json({ error: "Use valid times. Clip length must be 1–600 seconds." });
  }

  const outputName = `clip-${crypto.randomBytes(8).toString("hex")}.mp4`;
  const outputPath = path.join(os.tmpdir(), outputName);

  // Re-encode for broad compatibility. FFmpeg must be installed on the server.
  const ffmpeg = spawn("ffmpeg", [
    "-hide_banner", "-loglevel", "error", "-y",
    "-ss", String(start), "-i", req.file.path,
    "-t", String(duration),
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "23",
    "-c:a", "aac", "-movflags", "+faststart",
    outputPath
  ]);

  let errorText = "";
  ffmpeg.stderr.on("data", chunk => { errorText += chunk.toString(); });

  ffmpeg.on("close", code => {
    fs.rm(req.file.path, { force: true }, () => {});
    if (code !== 0 || !fs.existsSync(outputPath)) {
      console.error("FFmpeg failed:", errorText);
      return res.status(500).json({ error: "Could not create clip. Check that the file is a supported video." });
    }
    res.download(outputPath, "my-clip.mp4", () => {
      fs.rm(outputPath, { force: true }, () => {});
    });
  });
});

app.use((err, _req, res, _next) => {
  if (err instanceof multer.MulterError && err.code === "LIMIT_FILE_SIZE") {
    return res.status(413).json({ error: "Video is too large. Maximum size is 500 MB." });
  }
  res.status(400).json({ error: err.message || "Something went wrong." });
});

app.listen(PORT, () => console.log(`AI Clipper running on port ${PORT}`));
