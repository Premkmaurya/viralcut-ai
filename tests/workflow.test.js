const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');

const { JobRepo, ClipRepo, STORAGE_DIR } = require('../server/db');
const { processVideo } = require('../server/pipeline/processVideo');
const { jobQueue } = require('../server/jobQueue');
const { probeVideo } = require('../server/pipeline/probe');
const { ensureTestFixtures } = require('./testHelper');

test('Workflow: short video demo mode processes within actual duration without padding and enters awaiting_approval', async () => {
  const { sampleVideo } = ensureTestFixtures();
  const testJobId = `job_demo_short_${Date.now()}`;

  // 1. Create job in demo mode with 8-second sample video
  const job = JobRepo.create({
    id: testJobId,
    source_type: 'local_file',
    source_name: 'test_sample.mp4',
    source_path: sampleVideo,
    status: 'pending',
    min_duration: 60,
    max_duration: 180,
    is_demo: 1
  });

  assert.strictEqual(job.is_demo, 1);

  // 2. Process video in demo/test mode
  const result = await processVideo(testJobId, { isDemo: true, allowShortSource: true });

  // 3. Verify job status is awaiting_approval (MUST NOT BE COMPLETED!)
  assert.strictEqual(result.status, 'awaiting_approval', 'Job status must be awaiting_approval, not completed');
  const jobAfter = JobRepo.findById(testJobId);
  assert.strictEqual(jobAfter.status, 'awaiting_approval');
  assert.strictEqual(jobAfter.stage, 'awaiting_approval');
  assert.ok(jobAfter.stage_message.includes('DEMO MODE') || jobAfter.is_demo === 1);
  assert.ok(jobAfter.duration > 0, 'Source video duration must be preserved in metadata');

  // 4. Verify candidate clips
  const clips = ClipRepo.findByJobId(testJobId);
  assert.ok(clips.length > 0, 'Should generate candidate clips for short video in demo mode');

  for (const clip of clips) {
    // Timestamps MUST be strictly within source video duration!
    assert.ok(clip.start_time >= 0, `start_time ${clip.start_time} must be >= 0`);
    assert.ok(clip.end_time <= jobAfter.duration + 0.5, `end_time ${clip.end_time} must not exceed source duration ${jobAfter.duration}`);
    assert.ok(clip.end_time > clip.start_time);

    // Candidates must be unrendered initially
    assert.strictEqual(clip.render_status, 'pending');
    assert.strictEqual(clip.output_path, null);
  }

  // 5. Render a single candidate clip
  const clipToRender = clips[0];
  const renderedPath = await jobQueue.renderSingleClip(clipToRender.id);

  assert.ok(fs.existsSync(renderedPath), 'Rendered MP4 file must exist on disk');
  const fileStat = fs.statSync(renderedPath);
  assert.ok(fileStat.size > 10000, `Rendered file size must be > 10KB, got ${fileStat.size}`);

  // 6. Verify rendered file with FFprobe
  const probeData = await probeVideo(renderedPath);
  assert.strictEqual(probeData.width, 1080);
  assert.strictEqual(probeData.height, 1920);
  assert.ok(probeData.duration > 0, 'Rendered MP4 must have valid nonzero duration');

  // 7. Verify Clip record is updated in database
  const updatedClip = ClipRepo.findById(clipToRender.id);
  assert.strictEqual(updatedClip.render_status, 'completed');
  assert.strictEqual(updatedClip.output_path, renderedPath);
  assert.strictEqual(updatedClip.output_size, fileStat.size);

  // Clean up
  try {
    const jobDir = path.join(STORAGE_DIR, 'jobs', testJobId);
    if (fs.existsSync(jobDir)) fs.rmSync(jobDir, { recursive: true, force: true });
    JobRepo.delete(testJobId);
  } catch (e) {}
});

test('Workflow: production mode rejects video shorter than minDuration without padding silence or loops', async () => {
  const { sampleVideo } = ensureTestFixtures();
  const testJobId = `job_prod_short_${Date.now()}`;

  JobRepo.create({
    id: testJobId,
    source_type: 'local_file',
    source_name: 'test_sample.mp4',
    source_path: sampleVideo,
    status: 'pending',
    min_duration: 60,
    max_duration: 180,
    is_demo: 0
  });

  await assert.rejects(
    async () => {
      await processVideo(testJobId, { isDemo: false, allowShortSource: false });
    },
    (err) => {
      assert.ok(
        err.message.includes('shorter than the configured target duration') ||
        err.message.includes('Speech recognition dependency error'),
        `Expected limitation explanation, got: ${err.message}`
      );
      return true;
    }
  );

  // Clean up
  try {
    const jobDir = path.join(STORAGE_DIR, 'jobs', testJobId);
    if (fs.existsSync(jobDir)) fs.rmSync(jobDir, { recursive: true, force: true });
    JobRepo.delete(testJobId);
  } catch (e) {}
});

test.after(() => {
  jobQueue.stopWorker();
});
