# AI Clipper — starter

A mobile-friendly starter app that trims an uploaded video by start/end time and downloads an MP4 clip.

## Important scope
This starter does **not** download arbitrary livestream links. YouTube, Twitch, Facebook and other services have different rules and official APIs; direct access to a stream is not guaranteed. Add platform integrations only through authorized APIs and content you have permission to edit. Do not bypass DRM, login restrictions, or platform protections.

## Requirements
- Node.js 18+
- FFmpeg installed on the server and available as `ffmpeg` in PATH

## Run locally
```bash
npm install
npm start
```
Open `http://localhost:3000`.

## Deploy
Deploy this Node.js app to a server that supports FFmpeg. A static-only host cannot run the video processing backend. Set the start command to `npm start` and ensure FFmpeg is installed. For production, add authentication, storage limits, cleanup jobs, HTTPS, rate limiting, and a proper job queue before accepting public traffic.

## GitHub
Create an empty repository named `ai-clipper`, upload the project files, and commit them to the `main` branch.
