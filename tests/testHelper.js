const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { resolveFfmpeg } = require('../server/ffmpegResolver');

const FIXTURES_DIR = path.join(__dirname, 'fixtures');

function ensureTestFixtures() {
  if (!fs.existsSync(FIXTURES_DIR)) {
    fs.mkdirSync(FIXTURES_DIR, { recursive: true });
  }

  const ffmpeg = resolveFfmpeg();

  const sampleVideo = path.join(FIXTURES_DIR, 'sample_with_audio.mp4');
  const noAudioVideo = path.join(FIXTURES_DIR, 'sample_no_audio.mp4');

  // Generate 8-second test video with 440 Hz audio tone if not already present
  if (!fs.existsSync(sampleVideo)) {
    execFileSync(ffmpeg, [
      '-y',
      '-f', 'lavfi', '-i', 'testsrc=duration=8:size=640x360:rate=30',
      '-f', 'lavfi', '-i', 'sine=frequency=440:duration=8',
      '-c:v', 'libx264',
      '-c:a', 'aac',
      '-pix_fmt', 'yuv420p',
      sampleVideo
    ], { stdio: 'ignore' });
  }

  // Generate 4-second test video WITHOUT audio
  if (!fs.existsSync(noAudioVideo)) {
    execFileSync(ffmpeg, [
      '-y',
      '-f', 'lavfi', '-i', 'testsrc=duration=4:size=640x360:rate=30',
      '-c:v', 'libx264',
      '-pix_fmt', 'yuv420p',
      noAudioVideo
    ], { stdio: 'ignore' });
  }

  return { sampleVideo, noAudioVideo, fixturesDir: FIXTURES_DIR };
}

module.exports = {
  FIXTURES_DIR,
  ensureTestFixtures
};
