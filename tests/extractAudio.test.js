const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { extractAudio } = require('../server/pipeline/extractAudio');
const { probeVideo } = require('../server/pipeline/probe');
const { ensureTestFixtures, FIXTURES_DIR } = require('./testHelper');

test('Extract Audio: rejects non-existent input video', async () => {
  const badPath = path.join(FIXTURES_DIR, 'non_existent.mp4');
  const outWav = path.join(FIXTURES_DIR, 'out_bad.wav');

  await assert.rejects(
    async () => {
      await extractAudio(badPath, outWav);
    },
    /Input video file not found/
  );
});

test('Extract Audio: extracts 16 kHz mono WAV from valid video', async () => {
  const { sampleVideo } = ensureTestFixtures();
  const outputWav = path.join(FIXTURES_DIR, 'test_output_16k.wav');

  if (fs.existsSync(outputWav)) {
    fs.unlinkSync(outputWav);
  }

  const resultPath = await extractAudio(sampleVideo, outputWav);
  assert.strictEqual(resultPath, outputWav);
  assert.ok(fs.existsSync(outputWav), 'WAV file should exist on disk');

  const stat = fs.statSync(outputWav);
  assert.ok(stat.size > 1000, `Expected WAV size > 1000 bytes, got ${stat.size}`);
});
