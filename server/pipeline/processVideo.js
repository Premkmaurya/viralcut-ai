const fs = require('fs');
const path = require('path');
const EventEmitter = require('events');
const { JobRepo, TranscriptRepo, ClipRepo, STORAGE_DIR } = require('../db');
const { probeVideo } = require('./probe');
const { extractAudio } = require('./extractAudio');
const { runTranscription } = require('./transcribeRunner');
const { findCandidates } = require('./findCandidates');
const { scoreCandidates } = require('./scoreCandidates');

// Global event bus for real-time progress and notifications
const pipelineEvents = new EventEmitter();

/**
 * Orchestrates the video analysis pipeline for a given job.
 * Transitions through:
 * QUEUED -> PROBING -> EXTRACTING_AUDIO -> TRANSCRIBING -> ANALYZING -> AWAITING_APPROVAL
 *
 * NOTE: The job does NOT transition to COMPLETED here. It transitions to AWAITING_APPROVAL.
 * COMPLETED status is reserved strictly for when rendered video files have been created
 * and verified with FFprobe.
 *
 * @param {string} jobId - Job ID to process
 * @param {object} options - Optional overrides
 * @returns {Promise<object>} Result summary
 */
async function processVideo(jobId, options = {}) {
  const job = JobRepo.findById(jobId);
  if (!job) {
    throw new Error(`Job not found: ${jobId}`);
  }

  // Create isolated job directory
  const jobDir = path.join(STORAGE_DIR, 'jobs', jobId);
  fs.mkdirSync(jobDir, { recursive: true });

  const emitUpdate = (fields) => {
    const updated = JobRepo.update(jobId, fields);
    pipelineEvents.emit(`job:${jobId}`, {
      type: 'progress',
      jobId,
      ...fields
    });
    return updated;
  };

  try {
    // 1. Initial State: Probing
    emitUpdate({
      status: 'processing',
      stage: 'probing',
      progress: 10,
      stage_message: 'Inspecting media properties with FFprobe...',
      error: null
    });

    const sourcePath = job.source_path;
    if (!sourcePath || !fs.existsSync(sourcePath)) {
      throw new Error(`Source video file not found at: ${sourcePath}`);
    }

    // 2. FFprobe Inspection
    const probeData = await probeVideo(sourcePath);
    if (!probeData.hasAudio) {
      throw new Error('The video file has no audio stream. ViralCut AI requires speech audio for highlight detection.');
    }

    const minDuration = options.minDuration || job.min_duration || parseInt(process.env.CLIP_MIN_DURATION, 10) || 60;
    const maxDuration = options.maxDuration || job.max_duration || parseInt(process.env.CLIP_MAX_DURATION, 10) || 180;
    const isExplicitDemo = Boolean(job.is_demo === 1 || options.isDemo === true || options.demoMode === true);

    // Validate source duration vs desired clip duration in production mode
    if (probeData.duration < minDuration && !isExplicitDemo && !options.allowShortSource) {
      throw new Error(
        `Source video duration (${Math.round(probeData.duration)}s) is shorter than the configured target duration (minimum ${minDuration}s) and does not contain enough material for a complete Short. ` +
        `ViralCut AI does not pad short videos with silence, repeated footage, or irrelevant content. ` +
        `To test short videos, use test/demo mode.`
      );
    }

    emitUpdate({
      duration: probeData.duration,
      width: probeData.width,
      height: probeData.height,
      fps: probeData.fps,
      has_audio: probeData.hasAudio ? 1 : 0,
      stage: 'extracting_audio',
      progress: 30,
      stage_message: `Media verified (${Math.round(probeData.duration)}s, ${probeData.width}x${probeData.height}). Extracting 16 kHz audio...`
    });

    // 3. Audio Extraction
    const audioPath = path.join(jobDir, 'audio_16k.wav');
    await extractAudio(sourcePath, audioPath);

    emitUpdate({
      stage: 'transcribing',
      progress: 50,
      stage_message: 'Extracting speech and generating timestamped transcript with Whisper...'
    });

    // Determine if demo mode is allowed or enabled
    const allowDemoFallback = options.allowDemo ?? (
      isExplicitDemo ||
      process.env.ALLOW_DEMO_TRANSCRIPT === 'true'
    );

    // 4. Speech Recognition
    const transcriptPath = path.join(jobDir, 'transcript.json');
    const transcriptData = await runTranscription(audioPath, transcriptPath, {
      duration: probeData.duration,
      model: options.whisperModel || process.env.WHISPER_MODEL || 'base',
      device: options.whisperDevice || process.env.WHISPER_DEVICE || 'cpu',
      allowDemo: allowDemoFallback,
      isDemo: isExplicitDemo
    });

    // If transcription returned demo fallback data, explicitly persist is_demo
    const isDemoJob = Boolean(transcriptData.is_demo || isExplicitDemo);
    if (isDemoJob) {
      emitUpdate({ is_demo: 1 });
    }

    // Save transcript to database
    TranscriptRepo.save(jobId, transcriptData, transcriptData.full_text || '');

    emitUpdate({
      stage: 'analyzing',
      progress: 75,
      stage_message: isDemoJob
        ? 'DEMO MODE: Analyzing transcript segments to detect moments and hooks...'
        : 'Analyzing transcript segments to detect viral moments and hooks...'
    });

    // 5. Candidate Detection and Scoring
    if (probeData.duration < minDuration && (isDemoJob || options.allowShortSource)) {
      emitUpdate({
        is_demo: 1,
        stage_message: `DEMO MODE: Short source video (${Math.round(probeData.duration)}s) processed within actual duration without padding.`
      });
    }

    const rawCandidates = findCandidates(transcriptData.segments, probeData.duration, {
      minDuration,
      maxDuration,
      targetMinDuration: 60,
      targetMaxDuration: 90,
      allowShortSource: isDemoJob || options.allowShortSource,
      isDemo: isDemoJob
    });

    if (rawCandidates.length === 0) {
      throw new Error(`No complete candidate moments could be identified from the transcript without cutting off incomplete thoughts.`);
    }

    emitUpdate({
      stage: 'analyzing',
      progress: 85,
      stage_message: `Found ${rawCandidates.length} candidate windows. Scoring hook strength, coherence, and retention...`
    });

    const scoredClips = await scoreCandidates(rawCandidates, probeData.duration, {
      minDuration,
      maxDuration,
      maxClips: 8,
      allowShortSource: isDemoJob || options.allowShortSource,
      isDemo: isDemoJob
    });

    // Prepare candidate clip records for database (unrendered)
    const clipRecords = scoredClips.map((c, index) => ({
      id: `clip_${jobId}_${index + 1}`,
      job_id: jobId,
      title: c.title,
      hook: c.hook,
      reason: c.reason,
      score: c.score,
      topic: c.topic,
      standalone: c.standalone ? 1 : 0,
      start_time: c.start,
      end_time: c.end,
      duration: c.duration,
      approved: 1, // Pre-approve suggestions for user review
      render_status: 'pending',
      render_progress: 0,
      output_path: null,
      output_size: 0,
      caption_style: {
        fontSize: parseInt(process.env.SUBTITLE_FONT_SIZE, 10) || 56,
        primaryColor: '#FFFF00',
        outlineColor: '#000000',
        outlineWidth: 3.5,
        marginV: 320
      }
    }));

    ClipRepo.createMany(clipRecords);

    // 6. Transition to AWAITING_APPROVAL (DO NOT MARK COMPLETED!)
    const demoPrefix = isDemoJob ? '[DEMO MODE] ' : '';
    emitUpdate({
      status: 'awaiting_approval',
      stage: 'awaiting_approval',
      progress: 0,
      is_demo: isDemoJob ? 1 : 0,
      stage_message: `${demoPrefix}Analysis complete: ${clipRecords.length} candidate Shorts identified. Ready for preview and rendering.`
    });

    pipelineEvents.emit(`job:${jobId}`, {
      type: 'candidates_ready',
      jobId,
      clipCount: clipRecords.length,
      is_demo: isDemoJob
    });

    return {
      jobId,
      status: 'awaiting_approval',
      clipCount: clipRecords.length,
      is_demo: isDemoJob
    };

  } catch (error) {
    const errorMsg = error.message || 'Unknown processing error';
    console.error(`[processVideo] Job ${jobId} failed:`, error);

    emitUpdate({
      status: 'failed',
      stage: 'failed',
      progress: 0,
      error: errorMsg,
      stage_message: `Processing failed: ${errorMsg}`
    });

    pipelineEvents.emit(`job:${jobId}`, {
      type: 'error',
      jobId,
      error: errorMsg
    });

    throw error;
  }
}

module.exports = {
  processVideo,
  pipelineEvents
};
