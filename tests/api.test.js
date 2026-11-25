const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');
const { app, server } = require('../server/index');
const { JobRepo, ClipRepo } = require('../server/db');
const { jobQueue } = require('../server/jobQueue');
const { ensureTestFixtures } = require('./testHelper');

// Helper to make local HTTP requests to the running express server
function request(method, path, body = null, headers = {}) {
  return new Promise((resolve, reject) => {
    const http = require('http');
    const options = {
      hostname: '127.0.0.1',
      port: 3001,
      path,
      method,
      headers: {
        'Content-Type': 'application/json',
        ...headers
      }
    };

    const req = http.request(options, (res) => {
      const chunks = [];
      res.on('data', chunk => { chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)); });
      res.on('end', () => {
        const fullBuffer = Buffer.concat(chunks);
        let json = null;
        try {
          json = JSON.parse(fullBuffer.toString('utf8'));
        } catch (e) {
          json = fullBuffer.toString('utf8');
        }
        resolve({
          status: res.statusCode,
          headers: res.headers,
          data: json,
          rawBuffer: fullBuffer
        });
      });
    });

    req.on('error', reject);

    if (body) {
      req.write(typeof body === 'string' ? body : JSON.stringify(body));
    }
    req.end();
  });
}

test('API: GET /api/health returns ok status and media tool paths', async () => {
  const res = await request('GET', '/api/health');
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.data.status, 'ok');
  assert.ok(res.data.media_tools.ffmpeg, 'FFmpeg path should be resolved');
  assert.ok(res.data.media_tools.ffprobe, 'FFprobe path should be resolved');
});

test('API: POST /api/jobs rejects invalid or unsupported URLs', async () => {
  const res = await request('POST', '/api/jobs', { url: 'https://not-a-youtube-url.com/video' });
  assert.strictEqual(res.status, 400);
  assert.ok(res.data.error.includes('Invalid YouTube URL'));
});

test('API: POST /api/jobs enforces authorization check on YouTube URL', async () => {
  const res = await request('POST', '/api/jobs', { url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' });
  assert.strictEqual(res.status, 403);
  assert.strictEqual(res.data.authorized, false);
  assert.strictEqual(res.data.requires_local_upload, true);
  assert.ok(res.data.guidance.includes('authorized video file'));
});

test('API: POST /api/jobs creates job from authorized local video file with configured durations', async () => {
  const { sampleVideo } = ensureTestFixtures();
  const res = await request('POST', '/api/jobs', {
    local_path: sampleVideo,
    min_duration: 60,
    max_duration: 150
  });

  assert.strictEqual(res.status, 201);
  assert.ok(res.data.job.id);
  assert.strictEqual(res.data.job.status, 'pending');
  assert.strictEqual(res.data.job.min_duration, 60);
  assert.strictEqual(res.data.job.max_duration, 150);
});

test('API: PATCH /api/clips/:clipId updates timestamps and caption style', async () => {
  const testJobId = `job_test_${Date.now()}`;
  JobRepo.create({
    id: testJobId,
    source_type: 'local_file',
    status: 'completed',
    duration: 190
  });

  const testClipId = `clip_${testJobId}_1`;
  ClipRepo.createMany([{
    id: testClipId,
    job_id: testJobId,
    title: 'Original Title',
    start_time: 10,
    end_time: 75,
    duration: 65
  }]);

  const patchRes = await request('PATCH', `/api/clips/${testClipId}`, {
    title: 'Updated Viral Short Title',
    start_time: 10,
    end_time: 85,
    caption_style: { fontSize: 64, primaryColor: '#00FFFF' }
  });

  assert.strictEqual(patchRes.status, 200);
  assert.strictEqual(patchRes.data.clip.title, 'Updated Viral Short Title');
  assert.strictEqual(patchRes.data.clip.start_time, 10);
  assert.strictEqual(patchRes.data.clip.end_time, 85);
  assert.strictEqual(patchRes.data.clip.duration, 75);

  // Test YouTube Shorts 180s platform limit enforcement
  const exceedRes = await request('PATCH', `/api/clips/${testClipId}`, {
    start_time: 0,
    end_time: 185
  });
  assert.strictEqual(exceedRes.status, 400);
  assert.ok(exceedRes.data.error.includes('180 seconds'));

  // Clean up test job
  await request('DELETE', `/api/jobs/${testJobId}`);
});

test('API: GET /api/jobs/:jobId/export.zip returns 400 when no clips have been rendered', async () => {
  const testJobId = `job_no_renders_${Date.now()}`;
  JobRepo.create({
    id: testJobId,
    source_type: 'local_file',
    status: 'completed',
    duration: 60
  });

  const res = await request('GET', `/api/jobs/${testJobId}/export.zip`);
  assert.strictEqual(res.status, 400);
  assert.ok(res.data.error.includes('No rendered clips available'));

  // Clean up
  await request('DELETE', `/api/jobs/${testJobId}`);
});

test('API: Job Queue cancellation and cleanup', async () => {
  const testJobId = `job_cancel_${Date.now()}`;
  JobRepo.create({
    id: testJobId,
    source_type: 'local_file',
    status: 'pending',
    duration: 60
  });

  const cancelled = jobQueue.cancelJob(testJobId);
  assert.strictEqual(cancelled, true);

  const updated = JobRepo.findById(testJobId);
  assert.strictEqual(updated.status, 'cancelled');

  // Delete job
  const deleteRes = await request('DELETE', `/api/jobs/${testJobId}`);
  assert.strictEqual(deleteRes.status, 200);
  assert.ok(!JobRepo.findById(testJobId));
});

test('API: GET /api/clips/:clipId/download returns 404 when clip has not been generated yet', async () => {
  const testJobId = `job_dl_unrendered_${Date.now()}`;
  JobRepo.create({
    id: testJobId,
    source_type: 'local_file',
    status: 'awaiting_approval',
    duration: 60
  });

  const testClipId = `clip_dl_pending_${Date.now()}`;
  ClipRepo.createMany([{
    id: testClipId,
    job_id: testJobId,
    title: 'Pending Video Clip',
    start_time: 10,
    end_time: 40,
    duration: 30,
    render_status: 'pending',
    output_path: null
  }]);

  const res = await request('GET', `/api/clips/${testClipId}/download`);
  assert.strictEqual(res.status, 404, 'Must return 404 when clip file is not available');
  assert.ok(res.data.error.includes('not available'), 'Error must explain video file is not available');

  // Verify that calling download did NOT trigger rendering or change render_status
  const clipAfter = ClipRepo.findById(testClipId);
  assert.strictEqual(clipAfter.render_status, 'pending', 'Render status must remain unchanged; no rendering triggered');

  // Clean up
  await request('DELETE', `/api/jobs/${testJobId}`);
});

test('API: GET /api/clips/:clipId/download downloads actual MP4 file with correct Content-Type and Content-Disposition headers', async () => {
  const { sampleVideo } = ensureTestFixtures();
  const testJobId = `job_dl_success_${Date.now()}`;
  JobRepo.create({
    id: testJobId,
    source_type: 'local_file',
    status: 'completed',
    duration: 60
  });

  const testClipId = `clip_dl_ready_${Date.now()}`;
  ClipRepo.createMany([{
    id: testClipId,
    job_id: testJobId,
    title: 'Viral Breakthrough Moment',
    start_time: 0,
    end_time: 8,
    duration: 8,
    render_status: 'completed',
    output_path: sampleVideo // Valid existing MP4 test file
  }]);

  const res = await request('GET', `/api/clips/${testClipId}/download`);
  assert.strictEqual(res.status, 200, 'Must return 200 OK for completed clip');

  // Verify headers
  assert.strictEqual(res.headers['content-type'], 'video/mp4', 'Content-Type header must be video/mp4');
  assert.ok(
    res.headers['content-disposition'] && res.headers['content-disposition'].includes('attachment'),
    'Content-Disposition must be attachment'
  );
  assert.ok(
    res.headers['content-disposition'].includes('Viral_Breakthrough_Moment.mp4') ||
    res.headers['content-disposition'].includes('.mp4'),
    'Content-Disposition must contain MP4 filename'
  );

  // Verify actual file content (not empty, not HTML, not JSON)
  assert.ok(res.rawBuffer.length > 5000, `Downloaded MP4 file size must be > 5KB, got ${res.rawBuffer.length}`);

  // Verify MP4 file signature: bytes 4-8 are 'ftyp'
  const ftypMagic = res.rawBuffer.subarray(4, 8).toString('ascii');
  assert.strictEqual(ftypMagic, 'ftyp', 'Downloaded content must be a valid MP4 binary file');

  // Verify that downloading did NOT trigger any new rendering job
  const clipAfter = ClipRepo.findById(testClipId);
  assert.strictEqual(clipAfter.render_status, 'completed');
  assert.strictEqual(clipAfter.output_path, sampleVideo);

  // Clean up
  await request('DELETE', `/api/jobs/${testJobId}`);
});

// Close server after tests finish
test.after(() => {
  jobQueue.stopWorker();
  server.close();
});
