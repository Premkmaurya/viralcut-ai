const fs = require('fs');
const path = require('path');
const { execSync, execFileSync } = require('child_process');
const { resolveFfmpeg, resolveFfprobe } = require('./ffmpegResolver');

/**
 * Checks system dependencies required for ViralCut AI:
 * - FFmpeg & FFprobe
 * - Python executable
 * - faster-whisper Python package
 */
function checkDependencies() {
  const result = {
    ffmpeg: { available: false, path: null, error: null },
    ffprobe: { available: false, path: null, error: null },
    python: { available: false, path: null, version: null, error: null },
    faster_whisper: { available: false, version: null, error: null, guidance: null },
    all_ready: false
  };

  // 1. Check FFmpeg
  try {
    const ffmpegPath = resolveFfmpeg();
    result.ffmpeg.available = true;
    result.ffmpeg.path = ffmpegPath;
  } catch (err) {
    result.ffmpeg.error = err.message;
  }

  // 2. Check FFprobe
  try {
    const ffprobePath = resolveFfprobe();
    result.ffprobe.available = true;
    result.ffprobe.path = ffprobePath;
  } catch (err) {
    result.ffprobe.error = err.message;
  }

  // 3. Check Python
  let pythonBin = process.env.PYTHON_PATH;
  if (pythonBin) {
    const resolvedPy = path.resolve(pythonBin);
    if (fs.existsSync(resolvedPy)) {
      pythonBin = resolvedPy;
    }
  } else {
    const venvPy = path.resolve(__dirname, '..', '.venv', 'Scripts', 'python.exe');
    if (fs.existsSync(venvPy)) {
      pythonBin = venvPy;
    } else {
      pythonBin = 'python';
    }
  }
  try {
    const pyVersionOutput = execFileSync(pythonBin, ['--version'], { encoding: 'utf8', timeout: 10000 });
    result.python.available = true;
    result.python.path = pythonBin;
    result.python.version = pyVersionOutput.trim();
  } catch (err) {
    result.python.error = `Python executable not found or failed: ${err.message}. Set PYTHON_PATH in .env.`;
  }

  // 4. Check faster-whisper
  if (result.python.available) {
    try {
      const checkCode = 'import faster_whisper; print(faster_whisper.__version__)';
      const fwVersion = execFileSync(pythonBin, ['-c', checkCode], { encoding: 'utf8', timeout: 25000 });
      result.faster_whisper.available = true;
      result.faster_whisper.version = fwVersion.trim();
    } catch (err) {
      const stderr = err.stderr ? err.stderr.toString('utf8').trim() : err.message;
      result.faster_whisper.available = false;
      result.faster_whisper.error = stderr;
      result.faster_whisper.guidance =
        'To enable real speech recognition, install faster-whisper in your Python environment: ' +
        'run "pip install faster-whisper" (requires Python 3.10-3.12 64-bit on Windows with x86-64-v2 support) ' +
        'and ensure PYTHON_PATH in .env points to that Python executable.';
    }
  } else {
    result.faster_whisper.error = 'Python is not available.';
    result.faster_whisper.guidance = 'Please install Python 3.10-3.12 64-bit and set PYTHON_PATH in .env.';
  }

  result.all_ready =
    result.ffmpeg.available &&
    result.ffprobe.available &&
    result.python.available &&
    result.faster_whisper.available;

  return result;
}

module.exports = {
  checkDependencies
};
