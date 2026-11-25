const fs = require('fs');
const path = require('path');
const { JobRepo, ClipRepo, STORAGE_DIR } = require('./db');
const { processVideo, pipelineEvents } = require('./pipeline/processVideo');
const { renderClip } = require('./pipeline/renderClip');
const { probeVideo } = require('./pipeline/probe');

class JobQueue {
  constructor() {
    this.maxConcurrency = parseInt(process.env.MAX_CONCURRENT_JOBS, 10) || 1;
    this.activeJobs = new Set();
    this.activeRenders = new Set();
    this.activeRenderProcesses = new Map();
    this.cancelledJobs = new Set();
    this.isWorkerRunning = false;

    // Recover stuck jobs from previous server crash/shutdown
    this.recoverStuckJobs();

    // Start background queue poller (disabled in automated test suites to avoid concurrency races)
    const isRunningInTest =
      process.env.NODE_ENV === 'test' ||
      process.execArgv.includes('--test') ||
      process.argv.some(arg => typeof arg === 'string' && (arg.includes('test') || arg.includes('--test')));

    if (!isRunningInTest) {
      this.startWorker();
    }
  }

  recoverStuckJobs() {
    try {
      const stuckJobs = JobRepo.findStuckJobs();
      for (const job of stuckJobs) {
        if (job.status === 'processing') {
          console.warn(`[JobQueue] Recovering interrupted processing job ${job.id} from previous server session.`);
          JobRepo.update(job.id, {
            status: 'failed',
            stage: 'failed',
            error: 'Processing interrupted by server restart. You can retry this job.',
            stage_message: 'Job interrupted by server restart.'
          });
        } else if (job.status === 'rendering') {
          console.warn(`[JobQueue] Recovering interrupted rendering job ${job.id} from previous server session.`);
          const clips = ClipRepo.findByJobId(job.id);
          const approvedClips = clips.filter(c => c.approved === 1);
          let completedCount = 0;

          for (const clip of clips) {
            let isValid = false;
            if (clip.output_path && fs.existsSync(clip.output_path)) {
              try {
                const stat = fs.statSync(clip.output_path);
                if (stat.size >= 10000) {
                  isValid = true;
                }
              } catch (e) {}
            }

            if (isValid) {
              ClipRepo.update(clip.id, {
                render_status: 'completed',
                render_progress: 100
              });
              if (clip.approved === 1) completedCount++;
            } else {
              // Delete incomplete/corrupt file if any
              if (clip.output_path) {
                try {
                  if (fs.existsSync(clip.output_path)) fs.unlinkSync(clip.output_path);
                } catch (e) {}
              }
              ClipRepo.update(clip.id, {
                render_status: 'pending',
                render_progress: 0,
                output_path: null
              });
            }
          }

          if (approvedClips.length > 0 && completedCount === approvedClips.length) {
            JobRepo.update(job.id, {
              status: 'completed',
              stage: 'completed',
              progress: 100,
              stage_message: `All ${approvedClips.length} Shorts rendered and verified! Ready for download.`
            });
          } else {
            const pct = approvedClips.length > 0 ? Math.round((completedCount / approvedClips.length) * 100) : 0;
            JobRepo.update(job.id, {
              status: 'awaiting_approval',
              stage: 'awaiting_approval',
              progress: pct,
              stage_message: completedCount > 0
                ? `Rendering interrupted. ${completedCount} of ${approvedClips.length} Shorts rendered. You can render remaining Shorts.`
                : 'Rendering interrupted. You can resume rendering approved Shorts.'
            });
          }
        }
      }
    } catch (err) {
      console.error('[JobQueue] Error during stuck job recovery:', err);
    }
  }

  startWorker() {
    if (this.isWorkerRunning) return;
    this.isWorkerRunning = true;

    // Check queue every 2 seconds
    this.interval = setInterval(() => {
      this.tick();
    }, 2000);
    if (this.interval && this.interval.unref) {
      this.interval.unref();
    }
  }

  stopWorker() {
    this.isWorkerRunning = false;
    if (this.interval) clearInterval(this.interval);
  }

  async tick() {
    if (this.activeJobs.size >= this.maxConcurrency) {
      return; // Queue is at max capacity
    }

    try {
      // Find pending jobs ordered by created_at
      const allJobs = JobRepo.findAll(20);
      const nextJob = allJobs.find(j => j.status === 'pending' && !this.activeJobs.has(j.id));

      if (nextJob) {
        this.runJob(nextJob.id);
      }
    } catch (err) {
      console.error('[JobQueue] Error in tick cycle:', err);
    }
  }

  async runJob(jobId) {
    if (this.activeJobs.has(jobId)) return;
    this.activeJobs.add(jobId);

    console.log(`[JobQueue] Starting background processing for job ${jobId}...`);

    try {
      if (this.cancelledJobs.has(jobId)) {
        console.log(`[JobQueue] Job ${jobId} was cancelled before starting.`);
        JobRepo.update(jobId, {
          status: 'cancelled',
          stage: 'cancelled',
          stage_message: 'Job cancelled by user.'
        });
        this.cancelledJobs.delete(jobId);
        return;
      }

      await processVideo(jobId);
      console.log(`[JobQueue] Candidate generation for job ${jobId} completed (awaiting user approval).`);
    } catch (err) {
      console.error(`[JobQueue] Job ${jobId} processing error:`, err.message);
      // Status update is already handled inside processVideo
    } finally {
      this.activeJobs.delete(jobId);
      this.cancelledJobs.delete(jobId);
    }
  }

  cancelJob(jobId) {
    this.cancelledJobs.add(jobId);
    this.activeRenders.delete(jobId);
    this.activeJobs.delete(jobId);

    // If an FFmpeg process is running for this job, terminate it
    if (this.activeRenderProcesses && this.activeRenderProcesses.has(jobId)) {
      try {
        const proc = this.activeRenderProcesses.get(jobId);
        proc.kill('SIGTERM');
      } catch (e) {}
      this.activeRenderProcesses.delete(jobId);
    }

    const job = JobRepo.findById(jobId);
    if (!job) return false;

    JobRepo.update(jobId, {
      status: 'cancelled',
      stage: 'cancelled',
      stage_message: 'Job cancelled by user.'
    });

    pipelineEvents.emit(`job:${jobId}`, {
      type: 'cancelled',
      jobId,
      message: 'Job cancelled by user.'
    });

    return true;
  }

  /**
   * Evaluates whether all approved clips for a job are rendered and validated.
   * Only transitions job to COMPLETED when every approved clip has a verified MP4 on disk.
   */
  async checkJobCompletion(jobId) {
    const job = JobRepo.findById(jobId);
    if (!job) return;

    const clips = ClipRepo.findByJobId(jobId);
    const approvedClips = clips.filter(c => c.approved === 1);

    if (approvedClips.length === 0) return;

    // Check if every approved clip has an existing, non-zero file
    let allCompleted = true;
    let completedCount = 0;
    for (const clip of approvedClips) {
      if (clip.render_status !== 'completed' || !clip.output_path || !fs.existsSync(clip.output_path)) {
        allCompleted = false;
        continue;
      }
      try {
        const stat = fs.statSync(clip.output_path);
        if (stat.size < 10000) {
          allCompleted = false;
          continue;
        }
        completedCount++;
      } catch (e) {
        allCompleted = false;
      }
    }

    if (allCompleted) {
      JobRepo.update(jobId, {
        status: 'completed',
        stage: 'completed',
        progress: 100,
        stage_message: `All ${approvedClips.length} Shorts rendered and verified! Ready for download.`
      });

      pipelineEvents.emit(`job:${jobId}`, {
        type: 'completed',
        jobId,
        status: 'completed',
        stage: 'completed',
        progress: 100,
        clipCount: approvedClips.length
      });
    } else {
      const isStillRendering = this.activeRenders.has(jobId);
      const renderProgress = Math.round((completedCount / approvedClips.length) * 100);
      const newStatus = isStillRendering ? 'rendering' : 'awaiting_approval';
      const newStage = isStillRendering ? 'rendering' : 'awaiting_approval';
      const stage_message = isStillRendering
        ? `Rendered ${completedCount} of ${approvedClips.length} Shorts...`
        : (completedCount > 0
            ? `${completedCount} of ${approvedClips.length} Shorts rendered. You can download ready clips or render remaining.`
            : `Analysis complete: ${approvedClips.length} candidate Shorts identified. Ready for preview and rendering.`);

      JobRepo.update(jobId, {
        status: newStatus,
        stage: newStage,
        progress: renderProgress,
        stage_message
      });

      pipelineEvents.emit(`job:${jobId}`, {
        type: 'progress',
        jobId,
        status: newStatus,
        stage: newStage,
        progress: renderProgress,
        stage_message
      });
    }
  }

  /**
   * Renders a specific clip in the background.
   */
  async renderSingleClip(clipId, options = {}) {
    const clip = ClipRepo.findById(clipId);
    if (!clip) throw new Error(`Clip not found: ${clipId}`);

    const job = JobRepo.findById(clip.job_id);
    if (!job) throw new Error(`Job not found for clip: ${clipId}`);

    const jobDir = path.join(STORAGE_DIR, 'jobs', job.id);
    const outputDir = path.join(jobDir, 'renders');
    const outputPath = path.resolve(outputDir, `${clipId}.mp4`);

    // Check if clip is already rendered and file exists on disk with valid size and probe
    if (clip.render_status === 'completed' && clip.output_path && fs.existsSync(clip.output_path)) {
      try {
        const stat = fs.statSync(clip.output_path);
        if (stat.size > 10000) {
          const probe = await probeVideo(clip.output_path);
          if (probe && probe.duration > 0) {
            console.log(`[JobQueue] Clip ${clipId} already rendered and verified at ${clip.output_path}. Reusing existing file.`);
            if (!options.isBatch) {
              await this.checkJobCompletion(job.id);
            }
            return clip.output_path;
          }
        }
      } catch (e) {
        // Re-render if probe or stat fails
      }
    }

    // Set job state to rendering if not in a batch render
    if (!options.isBatch) {
      JobRepo.update(job.id, {
        status: 'rendering',
        stage: 'rendering',
        stage_message: `Rendering short: "${clip.title}"...`
      });

      pipelineEvents.emit(`job:${job.id}`, {
        type: 'progress',
        jobId: job.id,
        status: 'rendering',
        stage: 'rendering',
        stage_message: `Rendering short: "${clip.title}"...`
      });
    }

    ClipRepo.update(clipId, {
      render_status: 'rendering',
      render_progress: 10,
      error: null
    });

    pipelineEvents.emit(`job:${job.id}`, {
      type: 'clip_progress',
      clipId,
      status: 'rendering',
      progress: 10
    });

    // Load transcript segments
    let segments = [];
    const transcriptFile = path.join(jobDir, 'transcript.json');
    if (fs.existsSync(transcriptFile)) {
      try {
        const transcriptData = JSON.parse(fs.readFileSync(transcriptFile, 'utf8'));
        segments = transcriptData.segments || [];
      } catch (e) {
        // Ignore transcript parse error
      }
    }

    let captionStyle = {};
    if (clip.caption_style) {
      try {
        captionStyle = typeof clip.caption_style === 'string'
          ? JSON.parse(clip.caption_style)
          : clip.caption_style;
      } catch (e) {
        // Fallback to default
      }
    }

    try {
      const renderResult = await renderClip({
        sourceVideoPath: job.source_path,
        startTime: clip.start_time,
        endTime: clip.end_time,
        outputPath,
        segments,
        captionStyle,
        onProgress: (pct) => {
          ClipRepo.update(clipId, { render_progress: pct });
          pipelineEvents.emit(`job:${job.id}`, {
            type: 'clip_progress',
            clipId,
            status: 'rendering',
            progress: pct
          });
        },
        onProcess: (childProcess) => {
          if (!this.activeRenderProcesses) this.activeRenderProcesses = new Map();
          this.activeRenderProcesses.set(job.id, childProcess);
        }
      });

      // Verify rendered file with FFprobe
      const validatedProbe = await probeVideo(outputPath);
      if (!validatedProbe || validatedProbe.duration <= 0) {
        throw new Error('Rendered video file failed FFprobe media validation (duration is 0).');
      }

      ClipRepo.update(clipId, {
        render_status: 'completed',
        render_progress: 100,
        output_path: outputPath,
        output_size: renderResult.size,
        duration: validatedProbe.duration || renderResult.duration
      });

      pipelineEvents.emit(`job:${job.id}`, {
        type: 'clip_completed',
        clipId,
        outputPath,
        size: renderResult.size
      });

      // Check whether this completed render updates the overall job status
      if (!options.isBatch) {
        await this.checkJobCompletion(job.id);
      }

      return outputPath;

    } catch (err) {
      console.error(`[JobQueue] Rendering clip ${clipId} failed:`, err.message);
      ClipRepo.update(clipId, {
        render_status: 'failed',
        render_progress: 0,
        error: err.message
      });

      pipelineEvents.emit(`job:${job.id}`, {
        type: 'clip_error',
        clipId,
        error: err.message
      });

      if (!options.isBatch) {
        await this.checkJobCompletion(job.id);
      }

      throw err;
    } finally {
      if (this.activeRenderProcesses) {
        this.activeRenderProcesses.delete(job.id);
      }
    }
  }

  /**
   * Renders all approved clips for a job sequentially.
   */
  async renderAllApprovedClips(jobId) {
    if (this.activeRenders.has(jobId)) {
      console.log(`[JobQueue] Batch render already in progress for job ${jobId}`);
      return { alreadyRunning: true, message: 'Rendering is already in progress for this job.' };
    }

    const clips = ClipRepo.findByJobId(jobId);
    const approvedClips = clips.filter(c => c.approved === 1);

    if (approvedClips.length === 0) {
      return { renderedCount: 0, message: 'No approved clips found to render.' };
    }

    // Find clips that still need rendering
    const unrenderedClips = approvedClips.filter(c => {
      if (c.render_status === 'completed' && c.output_path && fs.existsSync(c.output_path)) {
        try {
          const stat = fs.statSync(c.output_path);
          if (stat.size >= 10000) return false;
        } catch (e) {}
      }
      return true;
    });

    if (unrenderedClips.length === 0) {
      await this.checkJobCompletion(jobId);
      return { renderedCount: 0, message: 'All approved clips are already rendered.' };
    }

    this.activeRenders.add(jobId);

    const totalApproved = approvedClips.length;
    let completedCount = totalApproved - unrenderedClips.length;
    let initialProgress = Math.round((completedCount / totalApproved) * 100);

    JobRepo.update(jobId, {
      status: 'rendering',
      stage: 'rendering',
      progress: initialProgress,
      stage_message: `Rendering ${unrenderedClips.length} approved Shorts in background...`
    });

    pipelineEvents.emit(`job:${jobId}`, {
      type: 'progress',
      jobId,
      status: 'rendering',
      stage: 'rendering',
      progress: initialProgress,
      stage_message: `Rendering ${unrenderedClips.length} approved Shorts...`
    });

    // Render approved clips sequentially in background
    (async () => {
      try {
        for (const clip of unrenderedClips) {
          if (this.cancelledJobs.has(jobId)) {
            console.log(`[JobQueue] Job ${jobId} rendering cancelled.`);
            break;
          }

          try {
            await this.renderSingleClip(clip.id, { isBatch: true });
            completedCount++;
          } catch (clipErr) {
            console.warn(`[JobQueue] Error rendering clip ${clip.id} in batch:`, clipErr.message);
          }

          const currentProgress = Math.round((completedCount / totalApproved) * 100);
          JobRepo.update(jobId, {
            status: 'rendering',
            stage: 'rendering',
            progress: currentProgress,
            stage_message: `Rendered ${completedCount} of ${totalApproved} Shorts...`
          });

          pipelineEvents.emit(`job:${jobId}`, {
            type: 'progress',
            jobId,
            status: 'rendering',
            stage: 'rendering',
            progress: currentProgress,
            stage_message: `Rendered ${completedCount} of ${totalApproved} Shorts...`
          });
        }
      } finally {
        this.activeRenders.delete(jobId);
        await this.checkJobCompletion(jobId);
      }
    })();

    return {
      started: true,
      count: unrenderedClips.length
    };
  }
}

// Singleton queue instance
const jobQueue = new JobQueue();

module.exports = { jobQueue };
