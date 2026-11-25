const fs = require('fs');
const path = require('path');

/**
 * Converts seconds to ASS timecode format: H:MM:SS.CC (centiseconds).
 */
function secondsToAssTime(seconds) {
  const s = Math.max(0, seconds);
  const hours = Math.floor(s / 3600);
  const minutes = Math.floor((s % 3600) / 60);
  const secs = Math.floor(s % 60);
  const centis = Math.floor((s - Math.floor(s)) * 100);

  const pad = (n, width = 2) => String(n).padStart(width, '0');
  return `${hours}:${pad(minutes)}:${pad(secs)}.${pad(centis)}`;
}

/**
 * Converts CSS hex color (e.g. #FFFF00 or #FFFFFF) to ASS color format (&HAABBGGRR).
 */
function hexToAssColor(hex, alpha = '00') {
  if (!hex) return `&H${alpha}FFFFFF`;
  const clean = hex.replace('#', '').trim();
  if (clean.length === 6) {
    const r = clean.substring(0, 2);
    const g = clean.substring(2, 4);
    const b = clean.substring(4, 6);
    return `&H${alpha}${b}${g}${r}`.toUpperCase();
  }
  return `&H${alpha}FFFFFF`;
}

/**
 * Generates an ASS subtitle file for a specific clip range.
 * @param {Array} segments - Transcript segments
 * @param {number} clipStart - Start time in seconds relative to video
 * @param {number} clipEnd - End time in seconds relative to video
 * @param {string} outputAssPath - Path to save the .ass file
 * @param {object} style - Styling overrides
 * @returns {string} Path to written .ass file
 */
function createAssCaptions(segments, clipStart, clipEnd, outputAssPath, style = {}) {
  const fontSize = style.fontSize || parseInt(process.env.SUBTITLE_FONT_SIZE, 10) || 56;
  const primaryColor = style.primaryColor ? hexToAssColor(style.primaryColor) : (process.env.SUBTITLE_PRIMARY_COLOR || '&H0000FFFF');
  const outlineColor = style.outlineColor ? hexToAssColor(style.outlineColor) : (process.env.SUBTITLE_OUTLINE_COLOR || '&H00000000');
  const outlineWidth = style.outlineWidth !== undefined ? style.outlineWidth : 3.5;
  const marginV = style.marginV !== undefined ? style.marginV : 320; // 320px from bottom avoids YouTube Shorts UI overlays
  const fontName = style.fontName || 'Arial';

  const assHeader = `[Script Info]
ScriptType: v4.00+
PlayResX: 1080
PlayResY: 1920
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: ViralShorts,${fontName},${fontSize},${primaryColor},&H000000FF,${outlineColor},&H80000000,-1,0,0,0,100,100,1,0,1,${outlineWidth},2,2,40,40,${marginV},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;

  const dialogueLines = [];

  // Filter segments that overlap with clip
  const clipSegments = (segments || []).filter(s => s.end > clipStart && s.start < clipEnd);

  // Group words into punchy lines (3 to 6 words each)
  let wordList = [];
  for (const seg of clipSegments) {
    if (seg.words && Array.isArray(seg.words) && seg.words.length > 0) {
      for (const w of seg.words) {
        if (w.end > clipStart && w.start < clipEnd) {
          wordList.push({
            word: w.word,
            start: Math.max(0, w.start - clipStart),
            end: Math.max(0, w.end - clipStart)
          });
        }
      }
    } else {
      // If word-level timestamps aren't present, split segment text evenly
      const segStartRel = Math.max(0, seg.start - clipStart);
      const segEndRel = Math.min(clipEnd - clipStart, seg.end - clipStart);
      const words = (seg.text || '').trim().split(/\s+/).filter(Boolean);
      const wordStep = words.length > 0 ? (segEndRel - segStartRel) / words.length : 1;

      words.forEach((w, idx) => {
        wordList.push({
          word: w,
          start: segStartRel + idx * wordStep,
          end: segStartRel + (idx + 1) * wordStep
        });
      });
    }
  }

  // Chunk words into small caption groups
  const CHUNK_SIZE = 4;
  for (let i = 0; i < wordList.length; i += CHUNK_SIZE) {
    const chunk = wordList.slice(i, i + CHUNK_SIZE);
    if (chunk.length === 0) continue;

    const startSec = chunk[0].start;
    const endSec = chunk[chunk.length - 1].end;
    const text = chunk.map(c => c.word).join(' ').toUpperCase();

    const startAss = secondsToAssTime(startSec);
    const endAss = secondsToAssTime(endSec);

    dialogueLines.push(`Dialogue: 0,${startAss},${endAss},ViralShorts,,0,0,0,,${text}`);
  }

  const fullContent = assHeader + dialogueLines.join('\n') + '\n';

  fs.mkdirSync(path.dirname(outputAssPath), { recursive: true });
  fs.writeFileSync(outputAssPath, fullContent, 'utf8');

  return outputAssPath;
}

module.exports = {
  createAssCaptions,
  secondsToAssTime,
  hexToAssColor
};
