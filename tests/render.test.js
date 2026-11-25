const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { createAssCaptions, secondsToAssTime, hexToAssColor } = require('../server/pipeline/createCaptions');
const { renderClip } = require('../server/pipeline/renderClip');
const { probeVideo } = require('../server/pipeline/probe');
const { ensureTestFixtures, FIXTURES_DIR } = require('./testHelper');

test('Captions: converts seconds to ASS time format correctly', () => {
  assert.strictEqual(secondsToAssTime(0), '0:00:00.00');
  assert.strictEqual(secondsToAssTime(65.25), '0:01:05.25');
  assert.strictEqual(secondsToAssTime(3661.5), '1:01:01.50');
});

test('Captions: converts hex colors to ASS color format', () => {
  assert.strictEqual(hexToAssColor('#FFFF00'), '&H0000FFFF'); // Yellow
  assert.strictEqual(hexToAssColor('#FFFFFF'), '&H00FFFFFF'); // White
  assert.strictEqual(hexToAssColor('#000000'), '&H00000000'); // Black
});

test('Captions: generates valid ASS file with script headers and dialogue', () => {
  const outputAss = path.join(FIXTURES_DIR, 'test_captions.ass');
  const mockSegments = [
    { start: 1.0, end: 3.5, text: 'This is an important lesson.' },
    { start: 3.8, end: 5.5, text: 'Remember to apply it every day.' }
  ];

  createAssCaptions(mockSegments, 0, 6, outputAss, {
    fontSize: 60,
    primaryColor: '#FFFF00',
    marginV: 300
  });

  assert.ok(fs.existsSync(outputAss));
  const content = fs.readFileSync(outputAss, 'utf8');
  assert.ok(content.includes('[Script Info]'));
  assert.ok(content.includes('[V4+ Styles]'));
  assert.ok(content.includes('Dialogue:'));
  assert.ok(content.includes('IMPORTANT'));
});

test('Render: trims and renders vertical 1080x1920 MP4 with output validation', async () => {
  const { sampleVideo } = ensureTestFixtures();
  const outputClip = path.join(FIXTURES_DIR, 'rendered_short_test.mp4');

  if (fs.existsSync(outputClip)) {
    fs.unlinkSync(outputClip);
  }

  const result = await renderClip({
    sourceVideoPath: sampleVideo,
    startTime: 1.0,
    endTime: 4.5, // 3.5s clip
    outputPath: outputClip,
    segments: [
      { start: 1.0, end: 4.5, text: 'Test vertical render with captions.' }
    ],
    captionStyle: {
      fontSize: 50,
      primaryColor: '#FFFF00',
      marginV: 280
    }
  });

  assert.ok(fs.existsSync(outputClip), 'Rendered output MP4 should exist');
  assert.ok(result.size > 20000, `Output size should be > 20KB, got ${result.size}`);

  // Probe output to verify dimensions and duration
  const probe = await probeVideo(outputClip);
  assert.strictEqual(probe.width, 1080, 'Output width must be 1080');
  assert.strictEqual(probe.height, 1920, 'Output height must be 1920 (9:16 vertical)');
  assert.ok(probe.duration >= 3.0 && probe.duration <= 4.0, `Expected ~3.5s, got ${probe.duration}`);
});

test('Render: rejects invalid clip time ranges', async () => {
  const { sampleVideo } = ensureTestFixtures();
  const outputClip = path.join(FIXTURES_DIR, 'invalid_range.mp4');

  await assert.rejects(
    async () => {
      await renderClip({
        sourceVideoPath: sampleVideo,
        startTime: 5.0,
        endTime: 2.0, // Invalid: end before start
        outputPath: outputClip
      });
    },
    /Invalid clip range/
  );
});

test('Render: rejects clips exceeding YouTube Shorts 180s platform limit', async () => {
  const { sampleVideo } = ensureTestFixtures();
  const outputClip = path.join(FIXTURES_DIR, 'exceed_platform_limit.mp4');

  await assert.rejects(
    async () => {
      await renderClip({
        sourceVideoPath: sampleVideo,
        startTime: 0,
        endTime: 190, // Exceeds 180s platform limit
        outputPath: outputClip
      });
    },
    /exceeds YouTube Shorts platform limit of 180 seconds/
  );
});
