const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { probeVideo } = require('../server/pipeline/probe');
const { ensureTestFixtures } = require('./testHelper');

test('Probe: should throw an error for non-existent video', async () => {
  await assert.rejects(
    async () => {
      await probeVideo(path.join(__dirname, 'fixtures', 'does_not_exist.mp4'));
    },
    /Video file does not exist/
  );
});

test('Probe: inspects valid video with audio stream', async () => {
  const { sampleVideo } = ensureTestFixtures();
  const info = await probeVideo(sampleVideo);

  assert.ok(info.duration >= 7.8, `Expected duration ~8s, got ${info.duration}`);
  assert.strictEqual(info.width, 640);
  assert.strictEqual(info.height, 360);
  assert.strictEqual(info.hasAudio, true);
  assert.ok(info.size > 0);
});

test('Probe: identifies video without audio stream', async () => {
  const { noAudioVideo } = ensureTestFixtures();
  const info = await probeVideo(noAudioVideo);

  assert.strictEqual(info.hasAudio, false, 'Expected hasAudio to be false');
  assert.strictEqual(info.width, 640);
  assert.strictEqual(info.height, 360);
});
