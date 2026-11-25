const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { resolveFfmpeg, resolveFfprobe } = require('../ffmpegResolver');
const { createAssCaptions } = require('./createCaptions');
const { probeVideo } = require('./probe');

/**
 * Trims and renders a vertical 1080x1920 MP4 clip with burned-in subtitles.
 * @param {object} params
 * @param {string} params.sourceVideoPath - Source video path
 * @param {number} params.startTime - Clip start time in seconds
 * @param {number} params.endTime - Clip end time in seconds
 * @param {string} params.outputPath - Output MP4 path
 * @param {Array} params.segments - Transcript segments
 * @param {object} params.captionStyle - Subtitle styling options
 * @param {string} params.renderMode - 'blur_fill' or 'center_crop' (default: 'blur_fill')
 * @param {function} params.onProgress - Progress callback (percentage)
 * @returns {Promise<{outputPath: string, size: number, duration: number}>}
 */
async function renderClip({
  sourceVideoPath,
  startTime,
  endTime,
  outputPath,
  segments = [],
  captionStyle = {},
  renderMode = 'blur_fill',
  onProgress = null,
  onProcess = null
}) {
  const resolvedSourcePath = path.resolve(sourceVideoPath);
  if (!fs.existsSync(resolvedSourcePath)) {
    throw new Error(`Source video not found: ${resolvedSourcePath}`);
  }

  const duration = endTime - startTime;
  if (duration <= 0) {
    throw new Error(`Invalid clip range: start (${startTime}) must be less than end (${endTime})`);
  }

  // Validate against YouTube Shorts platform requirements (up to 3 minutes / 180s)
  if (duration > 180.5) {
    throw new Error(`Clip duration (${duration.toFixed(1)}s) exceeds YouTube Shorts platform limit of 180 seconds (3 minutes).`);
  }

  const resolvedOutputPath = path.resolve(outputPath);
  const outputDir = path.dirname(resolvedOutputPath);
  fs.mkdirSync(outputDir, { recursive: true });

  const ffmpegPath = resolveFfmpeg();

  // Create temporary ASS subtitles file in the output directory
  const assFileName = `sub_${Date.now()}.ass`;
  const assPath = path.join(outputDir, assFileName);
  createAssCaptions(segments, startTime, endTime, assPath, captionStyle);

  // Probe source video dimensions to pick the ideal filter
  let sourceProbe;
  try {
    sourceProbe = await probeVideo(resolvedSourcePath);
  } catch (probeErr) {
    sourceProbe = { width: 1920, height: 1080, hasAudio: true };
  }

  const isAlreadyVertical = sourceProbe.width > 0 && sourceProbe.height > 0 && (sourceProbe.width / sourceProbe.height) <= (9 / 16 + 0.05);

  // Use relative ASS filename for FFmpeg filter so Windows path escaping is clean
  // Escape any special characters for the subtitles filter filename
  const escapedAssName = assFileName.replace(/['\\]/g, '\\$&');

  let filterComplex;

  if (isAlreadyVertical) {
    // Already 9:16 vertical video
    filterComplex = `[0:v]scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2,subtitles='${escapedAssName}'[v]`;
  } else if (renderMode === 'center_crop') {
    // Center crop to 9:16
    filterComplex = `[0:v]crop=ih*(9/16):ih,scale=1080:1920,subtitles='${escapedAssName}'[v]`;
  } else {
    // Blurred background fill (fast & smooth two-stage scaling for high performance)
    filterComplex = `[0:v]scale=270:480:force_original_aspect_ratio=increase,crop=270:480,boxblur=6:2,scale=1080:1920[bg];[0:v]scale=1080:1920:force_original_aspect_ratio=decrease[fg];[bg][fg]overlay=(W-w)/2:(H-h)/2,subtitles='${escapedAssName}'[v]`;
  }

  // Build FFmpeg argument array
  const args = [
    '-y',
    '-ss', String(startTime),
    '-to', String(endTime),
    '-i', resolvedSourcePath,
    '-filter_complex', filterComplex,
    '-map', '[v]',
    '-map', '0:a?',
    '-c:v', 'libx264',
    '-preset', 'veryfast',
    '-crf', '22',
    '-pix_fmt', 'yuv420p',
    '-c:a', 'aac',
    '-b:a', '192k',
    '-ac', '2',
    '-movflags', '+faststart',
    resolvedOutputPath
  ];

  if (onProgress) onProgress(20);

  return new Promise((resolve, reject) => {
    // Execute FFmpeg with cwd set to outputDir so relative subtitle filename works
    const child = execFile(ffmpegPath, args, { cwd: outputDir, maxBuffer: 15 * 1024 * 1024 }, async (error, stdout, stderr) => {
      // Clean up temporary ASS file
      try {
        if (fs.existsSync(assPath)) {
          fs.unlinkSync(assPath);
        }
      } catch (cleanErr) {
        // Ignore subtitle cleanup error
      }

      if (error) {
        try {
          if (fs.existsSync(resolvedOutputPath)) fs.unlinkSync(resolvedOutputPath);
        } catch (e) {}
        return reject(new Error(`FFmpeg rendering failed: ${stderr || error.message}`));
      }

      if (!fs.existsSync(resolvedOutputPath)) {
        return reject(new Error('Rendering completed but output file was not found on disk.'));
      }

      const stat = fs.statSync(resolvedOutputPath);
      if (stat.size < 10000) {
        try {
          if (fs.existsSync(resolvedOutputPath)) fs.unlinkSync(resolvedOutputPath);
        } catch (e) {}
        return reject(new Error(`Rendered clip is too small (${stat.size} bytes), rendering may be incomplete.`));
      }

      if (onProgress) onProgress(90);

      // Validate output with FFprobe
      try {
        const outputProbe = await probeVideo(resolvedOutputPath);
        if (!outputProbe || outputProbe.duration <= 0) {
          try {
            if (fs.existsSync(resolvedOutputPath)) fs.unlinkSync(resolvedOutputPath);
          } catch (e) {}
          return reject(new Error('Rendered video validation failed: Output video duration is zero.'));
        }

        if (onProgress) onProgress(100);

        resolve({
          outputPath: resolvedOutputPath,
          size: stat.size,
          duration: outputProbe.duration,
          width: outputProbe.width,
          height: outputProbe.height
        });
      } catch (validateErr) {
        try {
          if (fs.existsSync(resolvedOutputPath)) fs.unlinkSync(resolvedOutputPath);
        } catch (e) {}
        reject(new Error(`Rendered video output validation error: ${validateErr.message}`));
      }
    });

    if (onProcess && typeof onProcess === 'function') {
      try {
        onProcess(child);
      } catch (e) {}
    }
  });
}

module.exports = { renderClip };
