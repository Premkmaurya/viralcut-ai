const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { resolveFfmpeg } = require('../ffmpegResolver');

/**
 * Extracts 16 kHz mono WAV audio from a video file.
 * @param {string} videoPath - Source video path
 * @param {string} outputWavPath - Destination WAV path
 * @returns {Promise<string>} - Resolves with outputWavPath
 */
function extractAudio(videoPath, outputWavPath) {
  return new Promise((resolve, reject) => {
    if (!videoPath || !fs.existsSync(videoPath)) {
      return reject(new Error(`Input video file not found: ${videoPath}`));
    }

    let ffmpegPath;
    try {
      ffmpegPath = resolveFfmpeg();
    } catch (err) {
      return reject(err);
    }

    const outputDir = path.dirname(outputWavPath);
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    // Arguments:
    // -y: overwrite
    // -i: input
    // -vn: no video
    // -acodec pcm_s16le: standard 16-bit PCM for speech recognition
    // -ar 16000: 16 kHz sample rate required by Whisper
    // -ac 1: mono channel
    const args = [
      '-y',
      '-i', videoPath,
      '-vn',
      '-acodec', 'pcm_s16le',
      '-ar', '16000',
      '-ac', '1',
      outputWavPath
    ];

    execFile(ffmpegPath, args, { maxBuffer: 10 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) {
        return reject(new Error(`FFmpeg audio extraction failed: ${stderr || error.message}`));
      }

      if (!fs.existsSync(outputWavPath)) {
        return reject(new Error('Audio extraction failed: Output WAV file was not created.'));
      }

      const stat = fs.statSync(outputWavPath);
      if (stat.size < 100) {
        return reject(new Error('Audio extraction failed: Extracted audio file is empty or corrupted.'));
      }

      resolve(outputWavPath);
    });
  });
}

module.exports = { extractAudio };
