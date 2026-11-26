# AI Clipper — first 10-moment prototype

A mobile-friendly Node.js + FFmpeg app for creating up to 10 short MP4 clips from a creator-authorized source video.

## Current workflow
1. Paste a YouTube video or Live URL as a reference.
2. Upload the original video file that you have permission to edit.
3. Paste at least 10 transcript lines with timestamps, for example `00:01:12 Dialogue`.
4. The app ranks transcript lines using simple hook-word and punctuation heuristics and selects 10 separated moments.
5. It creates 45-second MP4 clips starting 10 seconds before each selected timestamp.

## Important limitations
- This is a prototype, not a full AI model. Moment ranking uses simple text heuristics; clip duration is currently fixed at 45 seconds.
- A YouTube URL is stored only as a reference in the form; it is not downloaded. YouTube Data API does not provide a general MP4 download endpoint.
- Upload only videos you own or have explicit permission to edit. Use the creator-provided original file or another authorized source. Do not bypass DRM, login restrictions, or platform protections.
- Browser settings may ask permission for multiple automatic downloads.
- The current upload endpoint accepts files up to 200 MB and clips up to 600 seconds.
- Production use still needs authentication, storage limits, cleanup jobs, HTTPS, rate limiting, a job queue, and robust error handling.

## Requirements
- Node.js 18+
- FFmpeg installed on the server and available as `ffmpeg`

## Run locally
```bash
npm install
npm start
```
Open `http://localhost:3000`.

## Deploy
Deploy this Node.js app to a server that supports FFmpeg. A static-only host cannot run the video-processing backend. Set the start command to `npm start` and ensure FFmpeg is installed.
