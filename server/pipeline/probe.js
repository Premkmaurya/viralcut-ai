const fs = require('fs');
const { execFile } = require('child_process');
const { resolveFfprobe } = require('../ffmpegResolver');

/**
 * Inspects a video file and returns duration, dimensions, frame rate, and audio details.
 * @param {string} videoPath - Absolute path to video file
 * @returns {Promise<{duration: number, width: number, height: number, fps: number, hasAudio: boolean, format: string, size: number}>}
 */
function probeVideo(videoPath) {
  return new Promise((resolve, reject) => {
    if (!videoPath || !fs.existsSync(videoPath)) {
      return reject(new Error(`Video file does not exist: ${videoPath}`));
    }

    let ffprobePath;
    try {
      ffprobePath = resolveFfprobe();
    } catch (err) {
      return reject(err);
    }

    const args = [
      '-v', 'error',
      '-show_entries', 'format=duration,size,bit_rate,format_name:stream=index,codec_name,codec_type,width,height,r_frame_rate,duration',
      '-of', 'json',
      videoPath
    ];

    execFile(ffprobePath, args, { maxBuffer: 10 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) {
        return reject(new Error(`FFprobe error inspecting media: ${stderr || error.message}`));
      }

      try {
        const data = JSON.parse(stdout);
        const format = data.format || {};
        const streams = data.streams || [];

        const videoStream = streams.find(s => s.codec_type === 'video');
        const audioStream = streams.find(s => s.codec_type === 'audio');

        if (!videoStream) {
          return reject(new Error('No video stream found in the provided media file.'));
        }

        // Calculate duration: try stream duration or format duration
        let duration = parseFloat(videoStream.duration || format.duration || 0);
        if (isNaN(duration) || duration <= 0) {
          if (format.duration) {
            duration = parseFloat(format.duration);
          }
        }

        if (isNaN(duration) || duration <= 0) {
          return reject(new Error('Invalid video duration: duration is zero or unreadable.'));
        }

        // Calculate FPS
        let fps = 30;
        if (videoStream.r_frame_rate) {
          const parts = videoStream.r_frame_rate.split('/');
          if (parts.length === 2 && parseFloat(parts[1]) > 0) {
            fps = Math.round((parseFloat(parts[0]) / parseFloat(parts[1])) * 100) / 100;
          } else {
            fps = parseFloat(videoStream.r_frame_rate) || 30;
          }
        }

        const width = parseInt(videoStream.width || 0, 10);
        const height = parseInt(videoStream.height || 0, 10);
        const hasAudio = !!audioStream;
        const size = parseInt(format.size || 0, 10) || fs.statSync(videoPath).size;

        resolve({
          duration,
          width,
          height,
          fps,
          hasAudio,
          format: format.format_name || 'mp4',
          size
        });
      } catch (parseErr) {
        reject(new Error(`Failed to parse FFprobe output: ${parseErr.message}`));
      }
    });
  });
}

module.exports = { probeVideo };
