const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

let cachedFfmpegPath = null;
let cachedFfprobePath = null;

function resolveFfmpeg() {
  if (cachedFfmpegPath && fs.existsSync(cachedFfmpegPath)) {
    return cachedFfmpegPath;
  }

  // 1. Explicit environment variable
  if (process.env.FFMPEG_PATH && fs.existsSync(process.env.FFMPEG_PATH)) {
    cachedFfmpegPath = process.env.FFMPEG_PATH;
    return cachedFfmpegPath;
  }

  // 2. Bundled npm @ffmpeg-installer/ffmpeg
  try {
    const ffmpegInstaller = require('@ffmpeg-installer/ffmpeg');
    if (ffmpegInstaller.path && fs.existsSync(ffmpegInstaller.path)) {
      cachedFfmpegPath = ffmpegInstaller.path;
      return cachedFfmpegPath;
    }
  } catch (err) {
    // Ignore require error
  }

  // 3. System command
  try {
    execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' });
    cachedFfmpegPath = 'ffmpeg';
    return cachedFfmpegPath;
  } catch (err) {
    // Not found in PATH
  }

  // 4. Common Windows paths
  const commonPaths = [
    'C:\\ffmpeg\\bin\\ffmpeg.exe',
    'C:\\Program Files\\ffmpeg\\bin\\ffmpeg.exe',
    'C:\\ProgramData\\chocolatey\\bin\\ffmpeg.exe'
  ];
  for (const p of commonPaths) {
    if (fs.existsSync(p)) {
      cachedFfmpegPath = p;
      return cachedFfmpegPath;
    }
  }

  throw new Error('FFmpeg executable not found. Please install FFmpeg or set FFMPEG_PATH in .env');
}

function resolveFfprobe() {
  if (cachedFfprobePath && fs.existsSync(cachedFfprobePath)) {
    return cachedFfprobePath;
  }

  // 1. Explicit environment variable
  if (process.env.FFPROBE_PATH && fs.existsSync(process.env.FFPROBE_PATH)) {
    cachedFfprobePath = process.env.FFPROBE_PATH;
    return cachedFfprobePath;
  }

  // 2. Bundled npm @ffprobe-installer/ffprobe
  try {
    const ffprobeInstaller = require('@ffprobe-installer/ffprobe');
    if (ffprobeInstaller.path && fs.existsSync(ffprobeInstaller.path)) {
      cachedFfprobePath = ffprobeInstaller.path;
      return cachedFfprobePath;
    }
  } catch (err) {
    // Ignore require error
  }

  // 3. System command
  try {
    execFileSync('ffprobe', ['-version'], { stdio: 'ignore' });
    cachedFfprobePath = 'ffprobe';
    return cachedFfprobePath;
  } catch (err) {
    // Not found in PATH
  }

  // 4. Look alongside resolved ffmpeg
  try {
    const ffmpeg = resolveFfmpeg();
    if (ffmpeg.includes(path.sep)) {
      const probeCandidate = path.join(path.dirname(ffmpeg), 'ffprobe.exe');
      if (fs.existsSync(probeCandidate)) {
        cachedFfprobePath = probeCandidate;
        return cachedFfprobePath;
      }
    }
  } catch (err) {
    // Ignore
  }

  throw new Error('FFprobe executable not found. Please install FFprobe or set FFPROBE_PATH in .env');
}

function getMediaTools() {
  const ffmpeg = resolveFfmpeg();
  const ffprobe = resolveFfprobe();
  return { ffmpeg, ffprobe };
}

module.exports = {
  resolveFfmpeg,
  resolveFfprobe,
  getMediaTools
};
