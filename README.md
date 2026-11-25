# ViralCut AI

**ViralCut AI** is a local full-stack AI video-processing application that analyzes long-form videos, detects high-retention viral moments, trims them into vertical 9:16 YouTube Shorts / TikToks / Reels with burned-in captions, and enables individual MP4 and batch ZIP downloads.

It runs locally on Windows without paying for external APIs or cloud infrastructure.

---

## Features

- **Local Media Pipeline**:
  - **FFprobe Inspection**: Inspects duration, width, height, aspect ratio, frame rate, and audio streams.
  - **FFmpeg 16 kHz Mono WAV Audio Extraction**: Prepares audio for speech recognition.
  - **faster-whisper AI Transcription**: Transcribes speech locally into timestamped segments and words with fallback capability.
  - **AI Clip Selection & Scoring**: Scores candidate moments based on 5 dimensions: hook strength, coherence, viewer value, payoff, and distinctiveness (0–100 scale).
  - **Deduplication Engine**: Filters out duplicate and heavily overlapping moments (IoU > 0.35 or start proximity < 8s).
  - **Vertical 9:16 Rendering (1080x1920)**: Automatically formats horizontal video into vertical video using two-stage blurred background fill or center crop.
  - **Burned-In Captions**: Generates styled Advanced SubStation Alpha (`.ass`) subtitles with adjustable font sizes, colors, and vertical positioning.
  - **Live Progress Updates**: Server-Sent Events (SSE) stream pipeline progress across all stages.
  - **Persistent SQLite Queue**: Manages concurrency, retries, and cancellation safely across restarts.
  - **Batch Export**: Downloads individual MP4s or a compressed `.zip` archive containing all rendered Shorts.

---

## Tech Stack

- **Frontend**: React 18, Vite, Tailwind CSS, Lucide Icons.
- **Backend**: Node.js v20+ (Node v24 with native `DatabaseSync` SQLite), Express.
- **Media Processing**: FFmpeg and FFprobe (bundled via `@ffmpeg-installer` with system PATH detection).
- **Speech Recognition**: faster-whisper running locally via Python (`server/pipeline/transcribe.py`).
- **Database**: SQLite (`viralcut.db` in `storage/`).
- **Live Updates**: Server-Sent Events (SSE) on `/api/jobs/:jobId/events`.

---

## Project Structure

```
viralcut-ai/
├── client/                     # React + Vite + Tailwind CSS frontend
│   ├── src/
│   │   ├── components/         # Header, VideoInput, JobProgress, ClipCard, ClipEditorModal, etc.
│   │   ├── App.jsx             # Main dashboard and state management
│   │   ├── index.css           # Styling and animations
│   │   └── main.jsx
│   ├── index.html
│   ├── package.json
│   ├── tailwind.config.js
│   └── vite.config.js
├── server/                     # Node.js Express backend
│   ├── pipeline/
│   │   ├── probe.js            # FFprobe metadata inspection
│   │   ├── extractAudio.js     # FFmpeg 16 kHz mono WAV extractor
│   │   ├── transcribe.py       # faster-whisper Python runner
│   │   ├── transcribeRunner.js # Node.js subprocess invoker with fallback
│   │   ├── findCandidates.js   # 20-60s candidate window segmentation
│   │   ├── scoreCandidates.js  # Heuristic & local LLM scoring engine
│   │   ├── createCaptions.js   # ASS subtitle generator with styling
│   │   ├── renderClip.js       # 1080x1920 vertical MP4 rendering
│   │   └── processVideo.js     # End-to-end pipeline orchestrator
│   ├── routes/
│   │   └── jobs.js             # REST API and SSE endpoints
│   ├── db.js                   # SQLite database models & migrations
│   ├── ffmpegResolver.js       # Auto-resolver for FFmpeg/FFprobe binaries
│   ├── jobQueue.js             # SQLite-backed persistent queue & concurrency
│   └── index.js                # Express app entrypoint
├── storage/                    # Local file storage for uploads, jobs, and renders
├── tests/                      # Automated test suite (27 unit & integration tests)
├── .env.example                # Example environment variables
├── package.json                # Project dependencies and npm scripts
└── README.md
```

---

## Installation & Setup on Windows

### 1. Prerequisites
- **Node.js**: v20 or v24 (recommended: v24).
- **Python**: 3.10, 3.11, or 3.12 (recommended for faster-whisper wheels).
- **FFmpeg**: Bundled automatically by `@ffmpeg-installer/ffmpeg` and `@ffprobe-installer/ffprobe`. Alternatively, you can use system FFmpeg by installing via winget:
  ```powershell
  winget install Gyan.FFmpeg --accept-source-agreements --accept-package-agreements
  ```

### 2. Install Node Dependencies
From the repository root:
```powershell
npm.cmd install
npm.cmd --prefix client install
```

### 3. Install faster-whisper (Optional for Speech Recognition)
To enable local transcription via faster-whisper:
```powershell
python -m pip install faster-whisper
```
- Note on Python Versions: Python 3.10, 3.11, or 3.12 (64-bit) with CPU support for x86-64-v2 instructions is recommended.
- If faster-whisper is not installed or CPU instructions are unsupported, ViralCut AI will display a clear dependency alert in preflight `/api/health` and run in explicit **DEMO MODE**, generating synthetic transcript segments bounded by the actual video duration.
- You can configure `PYTHON_PATH` in `.env` if your Python installation is in a custom path (e.g. `PYTHON_PATH=C:\Python311\python.exe`).

### 4. Configure Environment
Copy `.env.example` to `.env`:
```powershell
Copy-Item .env.example .env
```
Key configuration settings in `.env`:
- `PORT`: Server port (default `3001`).
- `STORAGE_DIR`: Directory where uploads, audio files, transcripts, and renders are saved (default `./storage`).
- `WHISPER_MODEL`: Model size (`tiny`, `base`, `small`, `medium`) (default `base`).
- `AI_SCORER_MODE`: `heuristic` (default, zero-latency local rules) or `ollama` (local LLM).
- `MAX_CONCURRENT_JOBS`: Maximum concurrent video processing jobs (default `1`).
- `CLIP_MIN_DURATION`: Minimum clip length in seconds (default `60`).
- `CLIP_MAX_DURATION`: Maximum clip length in seconds up to 180s platform limit (default `180`).
- `CLIP_TARGET_MIN_DURATION`: Target sweet spot minimum duration (default `60`).
- `CLIP_TARGET_MAX_DURATION`: Target sweet spot maximum duration (default `90`).

---

## Clip Duration & Platform Requirements

- **YouTube Shorts Platform Limit:** Vertical/square videos up to **180 seconds (3 minutes)** are eligible as YouTube Shorts.
- **Target Duration:** **60–90 seconds** per Short for optimal viewer retention and narrative payoff.
- **Minimum Duration:** **60 seconds** by default (configurable down to 30s in the UI/API).
- **Maximum Duration:** **180 seconds**, configurable in the UI/API.
- **Sentence-Aware Extension:** The AI never cuts off a clip at exactly 60 seconds if the explanation, sentence, story, or payoff is incomplete. It automatically extends to the next natural sentence-ending punctuation (`[.!?]`).
- **No Artificial Padding:** If a source video is shorter than the configured minimum duration (60s), the pipeline clearly reports that limitation rather than padding with silence, repeated footage, or irrelevant content.

---

## Running the Application

### Development Mode (Concurrent Server & Client)
1. Start the backend:
   ```powershell
   npm.cmd run server
   ```
2. Start the frontend development server:
   ```powershell
   npm.cmd run client
   ```
   Open `http://localhost:5173` in your browser.

### Production Mode
1. Build the frontend:
   ```powershell
   npm.cmd run client:build
   ```
2. Start the unified production server:
   ```powershell
   npm.cmd start
   ```
   Open `http://127.0.0.1:3001` in your browser.

---

## Running Automated Tests

Run the complete 27-test suite:
```powershell
npm.cmd test
```

The test suite covers:
- Probe metadata extraction and audio stream detection
- Audio extraction to 16 kHz mono WAV
- Rejection of source videos shorter than 60s without padding
- Candidate windowing with 60–90s target duration and sentence extension past 60s
- Support for configurable min (30–90s) and max (60–180s) durations
- Heuristic scoring across 60–90s narrative arcs and penalization of incomplete sub-60s clips
- Deduplication of overlapping and proximity candidates
- ASS subtitle generation and styling
- Vertical 1080x1920 MP4 video rendering with burned-in subtitles
- Enforcement of YouTube Shorts 180-second platform maximum limit on clip rendering and updates
- Output file validation (size, probe duration)
- API endpoints (`GET /api/health`, `POST /api/jobs`, `PATCH /api/clips/:id`, `GET /api/jobs/:id/export.zip`)
- Download Short endpoint (`GET /api/clips/:id/download`) with `video/mp4` and `Content-Disposition: attachment` headers
- Error handling for unrendered clips without fake downloads
- YouTube URL authorization enforcement and error guidance
- Job queue cancellation and cleanup

---

## API Reference

| Endpoint | Method | Description |
|---|---|---|
| `/api/health` | `GET` | Server health check and FFmpeg diagnostic paths |
| `/api/jobs` | `GET` | List recent video processing jobs |
| `/api/jobs` | `POST` | Create a job from an authorized local file path or validate a YouTube URL |
| `/api/jobs/upload` | `POST` | Multipart upload for authorized local video files (MP4, MKV, MOV, WebM) |
| `/api/jobs/:jobId` | `GET` | Retrieve job details, stage progress, and generated clips |
| `/api/jobs/:jobId/events` | `GET` | Server-Sent Events (SSE) live progress and status stream |
| `/api/jobs/:jobId/video` | `GET` | Stream source video for the preview player with byte-range seeking |
| `/api/jobs/:jobId/transcript` | `GET` | Full timestamped transcript segments and text |
| `/api/jobs/:jobId/clips` | `GET` | List candidate and rendered clips for a job |
| `/api/clips/:clipId` | `PATCH` | Update clip start/end timestamps, title, captions, or approval |
| `/api/clips/:clipId/render` | `POST` | Trigger vertical 9:16 rendering for a specific clip |
| `/api/jobs/:jobId/render-all` | `POST` | Batch render all approved clips sequentially |
| `/api/clips/:clipId/download` | `GET` | Download rendered MP4 short |
| `/api/jobs/:jobId/export.zip` | `GET` | Stream all rendered clips as a single ZIP archive |
| `/api/jobs/:jobId/retry` | `POST` | Re-queue a failed or interrupted job |
| `/api/jobs/:jobId` | `DELETE` | Cancel running job, remove database record, and delete disk assets |

---

## Media Authorization & Safety

ViralCut AI is designed for processing media that you own or have explicit rights to edit.
- **YouTube URL Ingestion**: Validates YouTube URLs. If direct media extraction is restricted or unauthorized on the host machine, the app explains the limitation and prompts the user to supply their authorized local video file.
- **Local Isolation**: All files, transcripts, and renders remain strictly on your local disk in `storage/`.
- **Process Safety**: All FFmpeg, FFprobe, and Python invocations use parameterized argument arrays with `execFile`, eliminating shell injection risks.
- **Security Notice**: This local MVP does not include user authentication and must not be exposed publicly to the internet.

---

## Hardware & Performance Considerations

- **Concurrency**: Default concurrency is set to `1` concurrent processing job (`MAX_CONCURRENT_JOBS=1`) to prevent CPU/GPU saturation.
- **Video Rendering**: Two-stage background blur scaling is utilized for the 1080x1920 layout, yielding 10x-15x faster rendering speeds than naive single-pass blur on CPU.
- **Storage Cleanup**: Deleting a job through the UI or `DELETE /api/jobs/:jobId` automatically deletes all extracted audio, transcripts, and rendered clips for that job.
