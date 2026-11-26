# AI Clipper — AI-assisted 10 clip prototype

## Current workflow
1. Paste the YouTube video / Live URL as a reference.
2. Upload the original video file supplied by the creator or otherwise authorized for editing.
3. The server extracts audio with FFmpeg and transcribes it with OpenAI Whisper.
4. An OpenAI language model selects exactly 10 moments, including start/end times and a suggested duration for each.
5. FFmpeg renders all 10 MP4 clips and returns one ZIP file.

## Required Render environment variable
Set `OPENAI_API_KEY` in Render → ai-clipper → Environment. Keep this key private; never paste it into the website or commit it to GitHub.

The API account needs billing/available API credits. Transcription and model selection incur API charges. See [OpenAI API pricing](https://platform.openai.com/pricing/).

## Limitations and safe use
- YouTube URLs are references only; this app does not download YouTube videos or livestreams. Use only a creator-provided original video or another authorized media source. Do not bypass DRM, login restrictions, or platform protections.
- Audio extraction is limited to 24 MB for the transcription request. Long videos may need to be split into shorter parts.
- This prototype handles uploaded, already-recorded video files. It does not yet capture an ongoing live stream.
- The model's clip choices are suggestions, not a guarantee of virality.
- The current upload limit is 200 MB. Production use still needs authentication, job queues, persistent storage, cleanup, rate limiting, and cost controls.

## Run
Requires Node.js 20+ and FFmpeg/ffprobe.
```bash
npm install
npm start
```
