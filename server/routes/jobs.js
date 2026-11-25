const express = require('express');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const archiver = require('archiver');
const { v4: uuidv4 } = require('uuid');

const { JobRepo, ClipRepo, TranscriptRepo, STORAGE_DIR } = require('../db');
const { jobQueue } = require('../jobQueue');
const { pipelineEvents } = require('../pipeline/processVideo');

const router = express.Router();

// Multer storage for uploaded media
const uploadsDir = path.join(STORAGE_DIR, 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadsDir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase() || '.mp4';
    const safeName = `upload_${Date.now()}_${Math.random().toString(36).substring(2, 8)}${ext}`;
    cb(null, safeName);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 2 * 1024 * 1024 * 1024 }, // 2GB limit
  fileFilter: (req, file, cb) => {
    const allowed = ['.mp4', '.mov', '.mkv', '.webm', '.avi', '.m4v'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowed.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error(`Unsupported video format. Allowed formats: ${allowed.join(', ')}`));
    }
  }
});

/**
 * Validates YouTube URL.
 */
function isValidYouTubeUrl(url) {
  if (!url || typeof url !== 'string') return false;
  const ytRegex = /^(https?:\/\/)?(www\.)?(youtube\.com\/(watch\?v=|embed\/|shorts\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/;
  return ytRegex.test(url.trim());
}

// -------------------------------------------------------------
// Job Creation & Listing
// -------------------------------------------------------------

/**
 * GET /api/jobs - List recent jobs for dashboard
 */
router.get('/jobs', (req, res) => {
  try {
    const jobs = JobRepo.findAll(30);
    res.json({ jobs });
  } catch (err) {
    res.status(500).json({ error: `Failed to retrieve jobs: ${err.message}` });
  }
});

/**
 * POST /api/jobs/upload - Upload an authorized local video file
 */
router.post('/jobs/upload', upload.single('video'), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No video file provided in upload.' });
    }

    const minDuration = parseFloat(req.body.min_duration) || 60;
    const maxDuration = Math.min(180, parseFloat(req.body.max_duration) || 180);
    const isDemo = req.body.is_demo === true || req.body.is_demo === 'true' || req.body.is_demo === 1 || req.body.mode === 'demo';

    const jobId = `job_${uuidv4().substring(0, 8)}`;
    const job = JobRepo.create({
      id: jobId,
      source_type: 'upload',
      source_name: req.file.originalname,
      source_path: req.file.path,
      status: 'pending',
      stage: 'queued',
      progress: 0,
      stage_message: `Video uploaded. Queued for 60–90s Shorts extraction (max ${maxDuration}s).`,
      min_duration: minDuration,
      max_duration: maxDuration,
      is_demo: isDemo ? 1 : 0
    });

    res.status(201).json({
      message: 'Video uploaded and job created successfully.',
      job
    });
  } catch (err) {
    res.status(500).json({ error: `Upload failed: ${err.message}` });
  }
});

/**
 * POST /api/jobs - Create job via YouTube URL or local file path
 */
router.post('/jobs', (req, res) => {
  try {
    const { url, local_path, source_name, min_duration, max_duration, is_demo, mode } = req.body;

    const minDur = parseFloat(min_duration) || 60;
    const maxDur = Math.min(180, parseFloat(max_duration) || 180);
    const isDemoJob = is_demo === true || is_demo === 'true' || is_demo === 1 || mode === 'demo';

    // Workflow A: YouTube URL validation & authorization check
    if (url) {
      const trimmedUrl = url.trim();
      if (!isValidYouTubeUrl(trimmedUrl)) {
        return res.status(400).json({
          error: 'Invalid YouTube URL. Please provide a valid YouTube link (e.g., https://www.youtube.com/watch?v=...).'
        });
      }

      // Check media acquisition authorization:
      // Direct YouTube downloading without user-configured tools or explicit API authorization
      // must explain limitations and offer local file import.
      return res.status(403).json({
        authorized: false,
        error: 'Direct media extraction for this YouTube URL is restricted on this local host without configured licensing or authorized keys.',
        guidance: 'To process this video legally and locally, please download or supply your authorized video file (MP4, MKV, MOV, WebM) using the Upload workflow below.',
        requires_local_upload: true
      });
    }

    // Workflow B: Authorized local file path
    if (local_path) {
      const resolvedPath = path.resolve(local_path);
      if (!fs.existsSync(resolvedPath)) {
        return res.status(400).json({ error: `Local file does not exist at: ${local_path}` });
      }

      const jobId = `job_${uuidv4().substring(0, 8)}`;
      const job = JobRepo.create({
        id: jobId,
        source_type: 'local_file',
        source_name: source_name || path.basename(resolvedPath),
        source_path: resolvedPath,
        status: 'pending',
        stage: 'queued',
        progress: 0,
        stage_message: `Local video identified. Queued for 60–90s Shorts extraction (max ${maxDur}s).`,
        min_duration: minDur,
        max_duration: maxDur,
        is_demo: isDemoJob ? 1 : 0
      });

      return res.status(201).json({ job });
    }

    return res.status(400).json({ error: 'Please provide either a valid YouTube URL or upload a local video file.' });

  } catch (err) {
    res.status(500).json({ error: `Job creation failed: ${err.message}` });
  }
});

/**
 * GET /api/jobs/:jobId - Get job status and details
 */
router.get('/jobs/:jobId', (req, res) => {
  try {
    const job = JobRepo.findById(req.params.jobId);
    if (!job) {
      return res.status(404).json({ error: `Job not found: ${req.params.jobId}` });
    }
    const clips = ClipRepo.findByJobId(req.params.jobId);
    const transcript = TranscriptRepo.findByJobId(req.params.jobId);

    res.json({
      job,
      clips,
      transcript: transcript ? { full_text: transcript.full_text, segmentCount: transcript.parsed.segments?.length || 0 } : null
    });
  } catch (err) {
    res.status(500).json({ error: `Failed to fetch job: ${err.message}` });
  }
});

/**
 * GET /api/jobs/:jobId/events - Server-Sent Events (SSE) live progress stream
 */
router.get('/jobs/:jobId/events', (req, res) => {
  const { jobId } = req.params;
  const job = JobRepo.findById(jobId);
  if (!job) {
    return res.status(404).json({ error: `Job not found: ${jobId}` });
  }

  // Set SSE headers
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no'
  });
  res.flushHeaders();

  // Send initial state snapshot
  res.write(`data: ${JSON.stringify({ type: 'initial', job, clips: ClipRepo.findByJobId(jobId) })}\n\n`);

  // Event listener for this job
  const eventHandler = (eventData) => {
    try {
      res.write(`data: ${JSON.stringify(eventData)}\n\n`);
    } catch (e) {
      // Socket may be closed
    }
  };

  pipelineEvents.on(`job:${jobId}`, eventHandler);

  // Heartbeat every 15s to keep connection alive
  const heartbeat = setInterval(() => {
    try {
      res.write(': heartbeat\n\n');
    } catch (e) {
      clearInterval(heartbeat);
    }
  }, 15000);

  req.on('close', () => {
    clearInterval(heartbeat);
    pipelineEvents.removeListener(`job:${jobId}`, eventHandler);
  });
});

/**
 * GET /api/jobs/:jobId/clips - Get all candidate and rendered clips for a job
 */
router.get('/jobs/:jobId/clips', (req, res) => {
  try {
    const job = JobRepo.findById(req.params.jobId);
    if (!job) {
      return res.status(404).json({ error: `Job not found: ${req.params.jobId}` });
    }

    const clips = ClipRepo.findByJobId(req.params.jobId);
    res.json({ clips });
  } catch (err) {
    res.status(500).json({ error: `Failed to fetch clips: ${err.message}` });
  }
});

/**
 * GET /api/jobs/:jobId/transcript - Get full transcript with segments
 */
router.get('/jobs/:jobId/transcript', (req, res) => {
  try {
    const transcript = TranscriptRepo.findByJobId(req.params.jobId);
    if (!transcript) {
      return res.status(404).json({ error: 'Transcript not available for this job yet.' });
    }
    res.json({ transcript: transcript.parsed });
  } catch (err) {
    res.status(500).json({ error: `Failed to fetch transcript: ${err.message}` });
  }
});

/**
 * GET /api/jobs/:jobId/video - Stream source video with range support for preview player
 */
router.get('/jobs/:jobId/video', (req, res) => {
  const job = JobRepo.findById(req.params.jobId);
  if (!job || !job.source_path || !fs.existsSync(job.source_path)) {
    return res.status(404).json({ error: 'Source video file not found.' });
  }

  const videoPath = job.source_path;
  const stat = fs.statSync(videoPath);
  const fileSize = stat.size;
  const range = req.headers.range;

  if (range) {
    const parts = range.replace(/bytes=/, '').split('-');
    const start = parseInt(parts[0], 10);
    const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
    const chunksize = (end - start) + 1;
    const file = fs.createReadStream(videoPath, { start, end });
    const head = {
      'Content-Range': `bytes ${start}-${end}/${fileSize}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': chunksize,
      'Content-Type': 'video/mp4'
    };
    res.writeHead(206, head);
    file.pipe(res);
  } else {
    const head = {
      'Content-Length': fileSize,
      'Content-Type': 'video/mp4'
    };
    res.writeHead(200, head);
    fs.createReadStream(videoPath).pipe(res);
  }
});

/**
 * POST /api/jobs/:jobId/retry - Retry failed job
 */
router.post('/jobs/:jobId/retry', (req, res) => {
  try {
    const job = JobRepo.findById(req.params.jobId);
    if (!job) {
      return res.status(404).json({ error: `Job not found: ${req.params.jobId}` });
    }

    JobRepo.update(job.id, {
      status: 'pending',
      stage: 'queued',
      progress: 0,
      stage_message: 'Job re-queued for processing.',
      error: null
    });

    res.json({ message: 'Job re-queued successfully.', jobId: job.id });
  } catch (err) {
    res.status(500).json({ error: `Retry failed: ${err.message}` });
  }
});

/**
 * DELETE /api/jobs/:jobId - Cancel and delete a job and cleanup files
 */
router.delete('/jobs/:jobId', (req, res) => {
  try {
    const { jobId } = req.params;
    const job = JobRepo.findById(jobId);
    if (!job) {
      return res.status(404).json({ error: `Job not found: ${jobId}` });
    }

    // Cancel running queue job if active
    jobQueue.cancelJob(jobId);

    // Clean up job directory
    const jobDir = path.join(STORAGE_DIR, 'jobs', jobId);
    if (fs.existsSync(jobDir)) {
      try {
        fs.rmSync(jobDir, { recursive: true, force: true });
      } catch (rmErr) {
        console.warn(`[Cleanup] Could not delete jobDir ${jobDir}:`, rmErr.message);
      }
    }

    // Delete database records
    JobRepo.delete(jobId);

    res.json({ message: 'Job and associated temporary files deleted successfully.' });
  } catch (err) {
    res.status(500).json({ error: `Failed to delete job: ${err.message}` });
  }
});

// -------------------------------------------------------------
// Clip Editing, Rendering & Export
// -------------------------------------------------------------

/**
 * PATCH /api/clips/:clipId - Update clip timestamps, title, captions, approval
 */
router.patch('/clips/:clipId', (req, res) => {
  try {
    const { clipId } = req.params;
    const clip = ClipRepo.findById(clipId);
    if (!clip) {
      return res.status(404).json({ error: `Clip not found: ${clipId}` });
    }

    const job = JobRepo.findById(clip.job_id);
    const { title, start_time, end_time, approved, caption_style } = req.body;
    const updates = {};

    if (title !== undefined) updates.title = String(title).trim();
    if (approved !== undefined) updates.approved = approved ? 1 : 0;

    let newStart = clip.start_time;
    let newEnd = clip.end_time;

    if (start_time !== undefined) {
      const s = parseFloat(start_time);
      if (isNaN(s) || s < 0) {
        return res.status(400).json({ error: 'start_time must be a positive number.' });
      }
      newStart = s;
      updates.start_time = s;
    }

    if (end_time !== undefined) {
      const e = parseFloat(end_time);
      if (isNaN(e) || e <= 0) {
        return res.status(400).json({ error: 'end_time must be greater than zero.' });
      }
      if (job && job.duration > 0 && e > job.duration + 0.5) {
        return res.status(400).json({ error: `end_time (${e}s) cannot exceed source video duration (${job.duration}s).` });
      }
      newEnd = e;
      updates.end_time = e;
    }

    if (newEnd <= newStart) {
      return res.status(400).json({ error: `end_time (${newEnd}s) must be strictly greater than start_time (${newStart}s).` });
    }

    const duration = newEnd - newStart;
    if (duration > 180) {
      return res.status(400).json({ error: `Clip duration (${duration.toFixed(1)}s) exceeds YouTube Shorts platform limit of 180 seconds (3 minutes).` });
    }
    updates.duration = duration;

    if (caption_style !== undefined) {
      updates.caption_style = typeof caption_style === 'string'
        ? caption_style
        : JSON.stringify(caption_style);
    }

    // If timestamps changed, reset render_status so it can be re-rendered
    if (start_time !== undefined || end_time !== undefined) {
      updates.render_status = 'pending';
      updates.render_progress = 0;
      updates.output_path = null;
    }

    const updated = ClipRepo.update(clipId, updates);
    res.json({ clip: updated });

  } catch (err) {
    res.status(500).json({ error: `Failed to update clip: ${err.message}` });
  }
});

/**
 * POST /api/clips/:clipId/render - Trigger vertical rendering for a single clip
 */
router.post('/clips/:clipId/render', async (req, res) => {
  try {
    const { clipId } = req.params;
    const clip = ClipRepo.findById(clipId);
    if (!clip) {
      return res.status(404).json({ error: `Clip not found: ${clipId}` });
    }

    // Trigger background render
    jobQueue.renderSingleClip(clipId).catch(err => {
      console.error(`[API] Async render failed for ${clipId}:`, err.message);
    });

    res.json({
      message: 'Clip rendering initiated in background.',
      clipId,
      status: 'rendering'
    });
  } catch (err) {
    res.status(500).json({ error: `Failed to initiate rendering: ${err.message}` });
  }
});

/**
 * POST /api/jobs/:jobId/render-all - Render all approved clips
 */
router.post('/jobs/:jobId/render-all', async (req, res) => {
  try {
    const { jobId } = req.params;
    const job = JobRepo.findById(jobId);
    if (!job) {
      return res.status(404).json({ error: `Job not found: ${jobId}` });
    }

    const result = await jobQueue.renderAllApprovedClips(jobId);
    res.json({
      message: 'Batch rendering started for approved clips.',
      details: result
    });
  } catch (err) {
    res.status(500).json({ error: `Failed to start batch render: ${err.message}` });
  }
});

/**
 * GET /api/clips/:clipId/download - Download individual rendered MP4 clip
 */
router.get('/clips/:clipId/download', (req, res) => {
  try {
    const { clipId } = req.params;
    const clip = ClipRepo.findById(clipId);
    if (!clip) {
      return res.status(404).json({ error: `Clip not found: ${clipId}` });
    }

    if (clip.render_status !== 'completed' || !clip.output_path || !fs.existsSync(clip.output_path)) {
      return res.status(404).json({
        error: 'Video file is not available for this clip yet. Please render the Short first.'
      });
    }

    const safeFilename = `${(clip.title || clipId).replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '_') || clipId}.mp4`;
    res.setHeader('Content-Type', 'video/mp4');
    res.download(clip.output_path, safeFilename, (err) => {
      if (err && !res.headersSent) {
        res.status(500).json({ error: `Download error: ${err.message}` });
      }
    });
  } catch (err) {
    res.status(500).json({ error: `Download failed: ${err.message}` });
  }
});

/**
 * GET /api/jobs/:jobId/export.zip - Download all completed rendered clips as a ZIP archive
 */
router.get('/jobs/:jobId/export.zip', (req, res) => {
  try {
    const { jobId } = req.params;
    const job = JobRepo.findById(jobId);
    if (!job) {
      return res.status(404).json({ error: `Job not found: ${jobId}` });
    }

    const clips = ClipRepo.findByJobId(jobId);
    const completedClips = clips.filter(c => c.render_status === 'completed' && c.output_path && fs.existsSync(c.output_path));

    if (completedClips.length === 0) {
      return res.status(400).json({
        error: 'No rendered clips available to export. Please render one or more clips first.'
      });
    }

    const zipFilename = `ViralCut_${jobId}_Shorts.zip`;
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${zipFilename}"`);

    const archive = archiver('zip', {
      zlib: { level: 6 }
    });

    archive.on('error', (err) => {
      console.error('[Archive Error]', err);
      if (!res.headersSent) {
        res.status(500).json({ error: `ZIP creation failed: ${err.message}` });
      }
    });

    archive.pipe(res);

    completedClips.forEach((clip, index) => {
      const cleanTitle = clip.title.replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '_');
      const entryName = `${String(index + 1).padStart(2, '0')}_${cleanTitle || clip.id}.mp4`;
      archive.file(clip.output_path, { name: entryName });
    });

    archive.finalize();

  } catch (err) {
    res.status(500).json({ error: `ZIP export failed: ${err.message}` });
  }
});

module.exports = router;
