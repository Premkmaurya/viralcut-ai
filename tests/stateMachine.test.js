const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');

const { JobRepo, ClipRepo, STORAGE_DIR } = require('../server/db');
const { processVideo } = require('../server/pipeline/processVideo');
const { jobQueue } = require('../server/jobQueue');
const { probeVideo } = require('../server/pipeline/probe');
const { checkDependencies } = require('../server/preflight');
const { ensureTestFixtures, FIXTURES_DIR } = require('./testHelper');

test('Task 1: Python preflight reports success with project-local virtual environment', () => {
  const deps = checkDependencies();
  assert.strictEqual(deps.python.available, true, 'Python executable must be available');
  assert.ok(deps.python.path.includes('.venv') || deps.python.path.includes('python'), 'Python path should resolve');
  assert.strictEqual(deps.faster_whisper.available, true, 'faster-whisper must be available in .venv');
  assert.strictEqual(deps.all_ready, true, 'All dependencies must be ready');
});

test('Task 1: Python preflight handles missing/incompatible Python gracefully', () => {
  const originalEnv = process.env.PYTHON_PATH;
  try {
    process.env.PYTHON_PATH = 'non_existent_python_binary_xyz';
    const deps = checkDependencies();
    assert.strictEqual(deps.python.available, false);
    assert.strictEqual(deps.all_ready, false);
    assert.ok(deps.python.error.includes('not found') || deps.python.error.includes('failed'));
  } finally {
    process.env.PYTHON_PATH = originalEnv;
  }
});

test('Task 2 & 3: Candidate generation ends in AWAITING_APPROVAL with 0% rendered progress', async () => {
  const { sampleVideo } = ensureTestFixtures();
  const testJobId = `job_test_awaiting_${Date.now()}`;

  JobRepo.create({
    id: testJobId,
    source_type: 'local_file',
    source_name: 'sample_with_audio.mp4',
    source_path: sampleVideo,
    status: 'pending',
    min_duration: 60,
    max_duration: 180,
    is_demo: 1
  });

  const res = await processVideo(testJobId, { isDemo: true, allowShortSource: true });
  assert.strictEqual(res.status, 'awaiting_approval');

  const job = JobRepo.findById(testJobId);
  assert.strictEqual(job.status, 'awaiting_approval', 'Job status must be awaiting_approval');
  assert.strictEqual(job.stage, 'awaiting_approval', 'Job stage must be awaiting_approval');
  assert.strictEqual(job.progress, 0, 'Progress must be 0% rendered before rendering begins');

  const clips = ClipRepo.findByJobId(testJobId);
  assert.ok(clips.length > 0, 'Candidate clips must be generated');
  for (const c of clips) {
    assert.strictEqual(c.render_status, 'pending');
    assert.strictEqual(c.output_path, null);
  }

  // Cleanup
  JobRepo.delete(testJobId);
});

test('Task 2 & 7: Duplicate render prevention rejects concurrent batch render calls', async () => {
  const testJobId = `job_test_mutex_${Date.now()}`;
  JobRepo.create({
    id: testJobId,
    source_type: 'local_file',
    source_name: 'test.mp4',
    source_path: 'fake.mp4',
    status: 'awaiting_approval',
    min_duration: 60,
    max_duration: 180,
    is_demo: 1
  });

  jobQueue.activeRenders.add(testJobId);
  try {
    const batchRes = await jobQueue.renderAllApprovedClips(testJobId);
    assert.strictEqual(batchRes.alreadyRunning, true, 'Must reject duplicate concurrent render request');
    assert.ok(batchRes.message.includes('already in progress'));
  } finally {
    jobQueue.activeRenders.delete(testJobId);
    JobRepo.delete(testJobId);
  }
});

test('Task 2 & 4: Job cancellation terminates active rendering state', () => {
  const testJobId = `job_test_cancel_${Date.now()}`;
  JobRepo.create({
    id: testJobId,
    source_type: 'local_file',
    source_name: 'test.mp4',
    source_path: 'fake.mp4',
    status: 'rendering',
    stage: 'rendering',
    min_duration: 60,
    max_duration: 180,
    is_demo: 1
  });

  jobQueue.activeRenders.add(testJobId);
  const cancelled = jobQueue.cancelJob(testJobId);
  assert.strictEqual(cancelled, true);

  const job = JobRepo.findById(testJobId);
  assert.strictEqual(job.status, 'cancelled');
  assert.strictEqual(job.stage, 'cancelled');
  assert.strictEqual(jobQueue.activeRenders.has(testJobId), false, 'Active renders set must clear cancelled job');

  JobRepo.delete(testJobId);
});

test('Task 4: FFmpeg rendering fails cleanly with FAILED status on non-existent input video', async () => {
  const testJobId = `job_test_err_${Date.now()}`;
  const clipId = `clip_test_err_${Date.now()}`;

  JobRepo.create({
    id: testJobId,
    source_type: 'local_file',
    source_name: 'missing.mp4',
    source_path: 'C:\\non_existent_path\\missing_video_123.mp4',
    status: 'awaiting_approval',
    min_duration: 60,
    max_duration: 180,
    is_demo: 1
  });

  ClipRepo.createMany([{
    id: clipId,
    job_id: testJobId,
    title: 'Error Test Clip',
    start_time: 0,
    end_time: 10,
    approved: 1,
    render_status: 'pending'
  }]);

  await assert.rejects(
    async () => {
      await jobQueue.renderSingleClip(clipId);
    },
    (err) => {
      assert.ok(err.message.includes('not found') || err.message.includes('failed'));
      return true;
    }
  );

  const clipAfter = ClipRepo.findById(clipId);
  assert.strictEqual(clipAfter.render_status, 'failed', 'Clip status must transition to failed');
  assert.ok(clipAfter.error !== null, 'Clip error message must be recorded');

  // Job should be in awaiting_approval (not hung at rendering 100%)
  const jobAfter = JobRepo.findById(testJobId);
  assert.strictEqual(jobAfter.status, 'awaiting_approval');

  // Cleanup
  ClipRepo.delete(clipId);
  JobRepo.delete(testJobId);
});

test('Task 2, 4 & 5: Successful rendering transitions to COMPLETED only after FFprobe verification', async () => {
  const { sampleVideo } = ensureTestFixtures();
  const testJobId = `job_test_complete_${Date.now()}`;
  const clipId = `clip_test_complete_${Date.now()}`;

  JobRepo.create({
    id: testJobId,
    source_type: 'local_file',
    source_name: 'sample_with_audio.mp4',
    source_path: sampleVideo,
    status: 'awaiting_approval',
    stage: 'awaiting_approval',
    min_duration: 60,
    max_duration: 180,
    is_demo: 1
  });

  ClipRepo.createMany([{
    id: clipId,
    job_id: testJobId,
    title: 'Completed Test Short',
    start_time: 0,
    end_time: 3.5,
    approved: 1,
    render_status: 'pending'
  }]);

  // Render the single approved clip
  const outputPath = await jobQueue.renderSingleClip(clipId);
  assert.ok(fs.existsSync(outputPath), 'Output MP4 must exist');

  // FFprobe check
  const probe = await probeVideo(outputPath);
  assert.strictEqual(probe.width, 1080);
  assert.strictEqual(probe.height, 1920);
  assert.ok(probe.duration > 0);

  // Check job status is now completed and 100%
  const completedJob = JobRepo.findById(testJobId);
  assert.strictEqual(completedJob.status, 'completed', 'Job must transition to completed when all approved clips finish');
  assert.strictEqual(completedJob.stage, 'completed');
  assert.strictEqual(completedJob.progress, 100);

  // Cleanup rendered files and records
  try {
    const jobDir = path.join(STORAGE_DIR, 'jobs', testJobId);
    if (fs.existsSync(jobDir)) fs.rmSync(jobDir, { recursive: true, force: true });
    ClipRepo.delete(clipId);
    JobRepo.delete(testJobId);
  } catch (e) {}
});

test.after(() => {
  jobQueue.stopWorker();
});
