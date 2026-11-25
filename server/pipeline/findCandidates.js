/**
 * findCandidates.js - Creates candidate time ranges from timestamped transcript segments.
 * Default target: 60-90 seconds, minimum: 60s, maximum: 180s (configurable).
 */

/**
 * Segments a transcript into coherent candidate windows respecting natural sentence boundaries
 * and dialogue order. Extends past 60s to avoid cutting off incomplete thoughts.
 *
 * @param {Array} segments - Array of { id, start, end, text, words }
 * @param {number} sourceDuration - Total video duration in seconds
 * @param {object} options - { minDuration: 60, maxDuration: 180, targetMinDuration: 60, targetMaxDuration: 90, allowShortSource, isDemo }
 * @returns {Array} List of candidate windows
 */
function findCandidates(segments, sourceDuration, options = {}) {
  if (!segments || !Array.isArray(segments) || segments.length === 0) {
    return [];
  }

  const requestedMin = options.minDuration !== undefined
    ? options.minDuration
    : (parseInt(process.env.CLIP_MIN_DURATION, 10) || 60);

  const requestedMax = options.maxDuration !== undefined
    ? options.maxDuration
    : (parseInt(process.env.CLIP_MAX_DURATION, 10) || 180);

  const validDuration = typeof sourceDuration === 'number' && sourceDuration > 0
    ? sourceDuration
    : (segments[segments.length - 1].end || 0);

  const isDemoOrShortAllowed = options.allowShortSource || options.isDemo || options.demoMode;

  // If source video duration is strictly less than minDuration:
  // In normal production mode, do NOT pad clips with silence or loops - return empty list so caller explains limitation.
  // In demo/test mode, allow candidates bounded by the actual source duration.
  if (validDuration < requestedMin && !isDemoOrShortAllowed) {
    return [];
  }

  const minDuration = (validDuration < requestedMin && isDemoOrShortAllowed)
    ? Math.min(requestedMin, Math.max(1, Math.round(validDuration * 0.4 * 10) / 10))
    : requestedMin;

  const maxDuration = Math.min(requestedMax, validDuration);
  const targetMin = Math.min(options.targetMinDuration || 60, validDuration);
  const targetMax = Math.min(options.targetMaxDuration || 90, validDuration);

  const candidates = [];
  const conjunctions = /^(and|but|so|or|because|also|however|well|like|um|uh|then)\b/i;

  for (let i = 0; i < segments.length; i++) {
    const startSeg = segments[i];
    const startTime = Math.max(0, startSeg.start);

    // Filter out start segments that begin with lowercase or conversational filler / conjunctions
    const firstWord = (startSeg.text || '').trim();
    const startsMidSentence = conjunctions.test(firstWord) || /^[a-z]/.test(firstWord);

    // Look ahead to find natural endpoints between minDuration and maxDuration
    for (let j = i; j < segments.length; j++) {
      const endSeg = segments[j];
      const endTime = Math.min(validDuration, endSeg.end);
      const duration = endTime - startTime;

      if (duration < minDuration) {
        // Less than minimum duration - continue accumulating context
        continue;
      }

      if (duration > maxDuration) {
        break; // Exceeded maximum duration
      }

      const lastText = (endSeg.text || '').trim();
      const hasClosingPunctuation = /[.!?]$/.test(lastText);

      // Check if next segment exists and continues the sentence
      const nextSeg = segments[j + 1];
      const nextStartsContinuity = nextSeg && (
        /^[a-z]/.test(nextSeg.text.trim()) ||
        conjunctions.test(nextSeg.text.trim())
      );

      // Rule: Do NOT cut at exact minimum if the sentence or explanation is incomplete
      if (!hasClosingPunctuation && duration < targetMax && j < segments.length - 1 && duration >= targetMin) {
        continue; // Keep extending to find the natural ending
      }

      const candidateSegments = segments.slice(i, j + 1);
      const combinedText = candidateSegments.map(s => s.text.trim()).join(' ');

      // Preference weight:
      let structuralBonus = 0;
      if (hasClosingPunctuation) structuralBonus += 25;
      if (!startsMidSentence) structuralBonus += 15;

      // Sweet spot bonus: 60 - 90 seconds (target retention for YouTube Shorts)
      if (duration >= targetMin && duration <= targetMax) {
        structuralBonus += 30;
      } else if (duration > targetMax && duration <= 120) {
        // Extended engaged moment (90 - 120s)
        structuralBonus += 20;
      } else if (duration > 120 && duration <= maxDuration) {
        // Deep-dive short (120 - 180s)
        structuralBonus += 10;
      }

      candidates.push({
        start: Math.round(startTime * 100) / 100,
        end: Math.round(endTime * 100) / 100,
        duration: Math.round(duration * 100) / 100,
        text: combinedText,
        structuralBonus,
        segments: candidateSegments
      });

      // If we found a clean ending in the sweet spot, move to next start window
      if (hasClosingPunctuation && duration >= targetMin && duration <= targetMax) {
        if (!nextStartsContinuity || duration >= targetMax - 5) {
          break;
        }
      }
    }
  }

  // Fallback if no candidate met punctuation criteria in demo/short mode: create single candidate for whole span
  if (candidates.length === 0 && isDemoOrShortAllowed && validDuration > 0) {
    candidates.push({
      start: 0,
      end: Math.round(validDuration * 100) / 100,
      duration: Math.round(validDuration * 100) / 100,
      text: segments.map(s => s.text.trim()).join(' '),
      structuralBonus: 10,
      segments
    });
  }

  return candidates;
}

module.exports = { findCandidates };
