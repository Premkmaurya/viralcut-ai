/**
 * scoreCandidates.js - Evaluates candidate clips using a configurable model adapter.
 * Optimized for 60-90s target YouTube Shorts (up to 180s maximum).
 */

const http = require('http');
const https = require('https');

/**
 * Heuristic NLP scorer analyzing hook strength, coherence, viewer value, payoff, and distinctiveness
 * across longer 60-90s (up to 180s) YouTube Shorts.
 */
function scoreCandidateHeuristically(candidate, index, totalCandidates) {
  const text = (candidate.text || '').trim();
  const sentences = text.match(/[^.!?]+[.!?]+|\S+/g) || [text];
  const firstSentence = sentences[0] || '';
  const lastSentence = sentences[sentences.length - 1] || '';
  const duration = candidate.duration || (candidate.end - candidate.start) || 60;

  // 1. Hook Strength (0 - 25 points)
  let hookScore = 8;
  const hookQuestions = /^(how|why|what|when|who|where|is it|can you|did you know|have you ever)\b/i;
  const hookCuriosityWords = /\b(secret|mistake|warning|truth|never|always|hack|trick|fastest|insane|crazy|shocking|revealed|stop doing|formula|framework)\b/i;
  const numbersOrStats = /\b(\d+%?|\$\d+|\d+\s*(tips|steps|reasons|ways|things|secrets|seconds|minutes))\b/i;

  if (hookQuestions.test(firstSentence)) hookScore += 8;
  if (hookCuriosityWords.test(firstSentence)) hookScore += 6;
  if (numbersOrStats.test(firstSentence)) hookScore += 4;
  if (firstSentence.length > 20 && firstSentence.length < 140) hookScore += 3;
  hookScore = Math.min(25, hookScore);

  // 2. Coherence & Narrative Progression (0 - 25 points)
  // For longer 60-90s clips, coherence requires sustained logical flow, complete thoughts,
  // and no sudden mid-sentence cutoffs.
  let coherenceScore = 12;
  const startsWithConjunction = /^(and|but|so|or|because|also|however|well|like|um|uh|then)\b/i;
  const endsWithCleanPunctuation = /[.!?]$/;

  if (!startsWithConjunction.test(firstSentence.trim())) coherenceScore += 4;
  if (endsWithCleanPunctuation.test(lastSentence.trim())) coherenceScore += 5;
  // Multi-sentence story arc (ideal for 60-90s is 4+ complete sentences)
  if (sentences.length >= 4) coherenceScore += 4;
  else if (sentences.length >= 2) coherenceScore += 2;
  coherenceScore = Math.min(25, coherenceScore);

  // 3. Viewer Value & Retention Potential (0 - 25 points)
  let valueScore = 10;
  const fillerWords = /\b(um|uh|you know|sort of|kind of|i guess|like i said|basically)\b/gi;
  const fillerCount = (text.match(fillerWords) || []).length;
  const words = text.split(/\s+/).filter(Boolean);
  const wordCount = words.length;

  // Penalize high filler ratio across the entire clip
  const fillerRatio = wordCount > 0 ? (fillerCount / wordCount) : 0;
  if (fillerRatio < 0.03) valueScore += 6;
  else if (fillerRatio > 0.08) valueScore -= 5;

  // Reward actionable / explanatory vocabulary that sustains viewer interest
  const valueTerms = /\b(because|strategy|technique|method|rule|result|benefit|action|principle|important|remember|crucial|example|specifically|step|breakdown)\b/gi;
  const valueMatchCount = (text.match(valueTerms) || []).length;
  valueScore += Math.min(8, valueMatchCount * 1.5);

  // Speech pace check (optimal 130-170 words per minute across full duration)
  const durationMinutes = duration / 60;
  const wpm = durationMinutes > 0 ? wordCount / durationMinutes : 140;
  if (wpm >= 115 && wpm <= 185) valueScore += 3;
  valueScore = Math.min(25, Math.max(5, valueScore));

  // 4. Payoff / Climax / Resolution (0 - 15 points)
  let payoffScore = 6;
  const payoffKeywords = /\b(in the end|finally|therefore|bottom line|the takeaway|as a result|which means|so next time|give this a try|remember this|key takeaway)\b/i;
  if (payoffKeywords.test(lastSentence) || payoffKeywords.test(text)) payoffScore += 6;
  if (endsWithCleanPunctuation.test(lastSentence)) payoffScore += 3;
  payoffScore = Math.min(15, payoffScore);

  // 5. Distinctiveness & Duration Sweet-Spot (0 - 15 points)
  let distinctScore = 6;
  const uniqueWords = new Set(words.map(w => w.toLowerCase()));
  const lexicalDiversity = wordCount > 0 ? (uniqueWords.size / wordCount) : 0.5;
  if (lexicalDiversity > 0.55) distinctScore += 4;

  // Reward 60-90s sweet spot for YouTube Shorts
  if (duration >= 60 && duration <= 90) {
    distinctScore += 5;
  } else if (duration > 90 && duration <= 180) {
    distinctScore += 3;
  } else if (duration < 60) {
    distinctScore -= 6; // Penalize sub-60s clips
  }

  if (candidate.structuralBonus) {
    distinctScore += Math.min(3, Math.round(candidate.structuralBonus / 10));
  }
  distinctScore = Math.min(15, Math.max(0, distinctScore));

  // Total raw score (0 - 100)
  const rawScore = hookScore + coherenceScore + valueScore + payoffScore + distinctScore;
  const score = Math.min(98, Math.max(40, Math.round(rawScore)));

  // Generate catchy title & topic
  let title = generateCatchyTitle(firstSentence, text);
  let topic = extractTopic(text);
  let hook = firstSentence.trim();
  let reason = generateRationale(hookScore, valueScore, payoffScore, duration);
  let standalone = coherenceScore >= 14 && !startsWithConjunction.test(firstSentence.trim()) && endsWithCleanPunctuation.test(lastSentence.trim());

  return {
    start: candidate.start,
    end: candidate.end,
    duration: Math.round(duration * 100) / 100,
    title,
    hook,
    reason,
    score,
    topic,
    standalone,
    score_breakdown: {
      hook_strength: hookScore,
      coherence: coherenceScore,
      viewer_value: valueScore,
      payoff: payoffScore,
      distinctiveness: distinctScore
    }
  };
}

function generateCatchyTitle(firstSentence, fullText) {
  const clean = firstSentence.replace(/[^\w\s]/g, '').trim();
  const words = clean.split(/\s+/).filter(Boolean);

  if (words.length >= 3 && words.length <= 7) {
    return capitalizeWords(words.join(' '));
  }

  const titleWords = words.slice(0, 5);
  if (titleWords.length >= 2) {
    return capitalizeWords(titleWords.join(' '));
  }

  return "Essential Insight & Story";
}

function capitalizeWords(str) {
  return str
    .toLowerCase()
    .split(' ')
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

function extractTopic(text) {
  const topics = [
    { name: "Strategy & Tactics", pattern: /\b(strategy|plan|tactic|technique|method|system)\b/i },
    { name: "Mindset & Psychology", pattern: /\b(mindset|belief|think|psychology|focus|attitude)\b/i },
    { name: "Story & Journey", pattern: /\b(happened|started|story|journey|experience|day)\b/i },
    { name: "Productivity & Growth", pattern: /\b(productive|grow|scale|fast|efficiency|result)\b/i },
    { name: "Mistakes & Pitfalls", pattern: /\b(mistake|wrong|error|avoid|fail|problem|warning)\b/i },
    { name: "Tech & Science", pattern: /\b(tech|code|ai|algorithm|data|science|engineering)\b/i }
  ];

  for (const t of topics) {
    if (t.pattern.test(text)) return t.name;
  }
  return "General Knowledge";
}

function generateRationale(hook, value, payoff, duration) {
  const durLabel = duration >= 60 && duration <= 90 ? "Optimal 60-90s Short" : `${Math.round(duration)}s Short`;
  if (hook >= 20 && payoff >= 12) {
    return `${durLabel} with a compelling opening hook and a satisfying narrative resolution that maintains engagement.`;
  }
  if (value >= 20) {
    return `${durLabel} packed with comprehensive, high-retention insights and structured explanation.`;
  }
  if (hook >= 20) {
    return `${durLabel} opening with an irresistible curiosity gap that sustains attention throughout the explanation.`;
  }
  return `${durLabel} featuring coherent dialogue progression and a complete standalone story arc.`;
}

/**
 * Deduplicates overlapping candidates using Intersection over Union (IoU) and start proximity.
 */
function deduplicateCandidates(scoredCandidates, maxResults = 8) {
  // Sort descending by score
  const sorted = [...scoredCandidates].sort((a, b) => b.score - a.score);
  const selected = [];

  for (const candidate of sorted) {
    let hasHeavyOverlap = false;

    for (const existing of selected) {
      // Proximity check: starts within 12 seconds for longer clips
      if (Math.abs(candidate.start - existing.start) < 12) {
        hasHeavyOverlap = true;
        break;
      }

      // IoU overlap check
      const overlapStart = Math.max(candidate.start, existing.start);
      const overlapEnd = Math.min(candidate.end, existing.end);
      const overlap = Math.max(0, overlapEnd - overlapStart);

      if (overlap > 0) {
        const union = (candidate.end - candidate.start) + (existing.end - existing.start) - overlap;
        const iou = overlap / union;
        if (iou > 0.35) {
          hasHeavyOverlap = true;
          break;
        }
      }
    }

    if (!hasHeavyOverlap) {
      selected.push(candidate);
    }

    if (selected.length >= maxResults) {
      break;
    }
  }

  // Sort chronologically for intuitive timeline review
  return selected.sort((a, b) => a.start - b.start);
}

/**
 * Scores and ranks candidate windows.
 * @param {Array} rawCandidates - List from findCandidates
 * @param {number} sourceDuration - Total video duration
 * @param {object} options - Configuration options
 * @returns {Promise<Array>} Scored and deduplicated candidates
 */
async function scoreCandidates(rawCandidates, sourceDuration, options = {}) {
  if (!rawCandidates || rawCandidates.length === 0) {
    return [];
  }

  const validDuration = typeof sourceDuration === 'number' && sourceDuration > 0
    ? sourceDuration
    : Infinity;

  const opts = options || {};
  const isDemoOrShortAllowed = opts.allowShortSource || opts.isDemo || opts.demoMode;

  const rawMin = opts.minDuration !== undefined
    ? opts.minDuration
    : (parseInt(process.env.CLIP_MIN_DURATION, 10) || 60);

  const minDuration = (validDuration < rawMin && isDemoOrShortAllowed)
    ? Math.min(rawMin, Math.max(1, Math.round(validDuration * 0.4 * 10) / 10))
    : rawMin;

  const maxDuration = opts.maxDuration !== undefined
    ? opts.maxDuration
    : (parseInt(process.env.CLIP_MAX_DURATION, 10) || 180);

  // Filter candidates that fit valid boundaries and duration limits
  const validCandidates = rawCandidates.filter(c =>
    typeof c.start === 'number' &&
    typeof c.end === 'number' &&
    c.start >= 0 &&
    c.end > c.start &&
    c.start < validDuration &&
    c.end <= validDuration + 1.5 &&
    (c.end - c.start) >= (minDuration - 0.5) &&
    (c.end - c.start) <= (maxDuration + 0.5)
  );

  if (validCandidates.length === 0) {
    return [];
  }

  // Local model adapter: heuristic or local LLM (Ollama)
  const mode = process.env.AI_SCORER_MODE || 'heuristic';

  if (mode === 'ollama') {
    try {
      const ollamaCandidates = await scoreWithOllama(validCandidates, validDuration);
      if (ollamaCandidates && ollamaCandidates.length > 0) {
        return deduplicateCandidates(ollamaCandidates, options.maxClips || 8);
      }
    } catch (llmErr) {
      console.warn(`[scoreCandidates] Ollama scoring failed: ${llmErr.message}. Falling back to heuristic scorer.`);
    }
  }

  // Default heuristic scoring
  const scored = validCandidates.map((c, i) => scoreCandidateHeuristically(c, i, validCandidates.length));
  return deduplicateCandidates(scored, options.maxClips || 8);
}

/**
 * Optional Ollama local model integration for longer shorts.
 */
function scoreWithOllama(candidates, sourceDuration) {
  return new Promise((resolve, reject) => {
    const baseUrl = process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
    const model = process.env.OLLAMA_MODEL || 'llama3.2';

    const excerpts = candidates.slice(0, 12).map((c, idx) => ({
      index: idx,
      start: c.start,
      end: c.end,
      duration: c.duration,
      text: c.text.slice(0, 360)
    }));

    const prompt = `You are a viral YouTube Shorts editor.
Evaluate these candidate moments (target 60-90s, up to 180s) from a video transcript.
Return ONLY a valid JSON array of objects with keys:
- index: number
- title: string (punchy 3-6 words)
- hook: string (opening 1-2 sentences)
- reason: string (why this moment sustains engagement across the full clip)
- score: integer 0-100
- topic: string
- standalone: boolean

Candidates:
${JSON.stringify(excerpts, null, 2)}
`;

    const postData = JSON.stringify({
      model,
      prompt,
      stream: false,
      format: "json"
    });

    const parsedUrl = new URL(`${baseUrl}/api/generate`);
    const req = http.request({
      hostname: parsedUrl.hostname,
      port: parsedUrl.port || 11434,
      path: parsedUrl.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData)
      },
      timeout: 15000
    }, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          const responseJson = JSON.parse(parsed.response);
          if (Array.isArray(responseJson)) {
            const mapped = responseJson.map(item => {
              const orig = candidates[item.index] || candidates[0];
              return {
                start: orig.start,
                end: orig.end,
                duration: orig.duration,
                title: item.title || orig.title || "Key Highlight",
                hook: item.hook || orig.text.slice(0, 80),
                reason: item.reason || "High engagement potential across 60-90s",
                score: Math.min(100, Math.max(0, parseInt(item.score, 10) || 75)),
                topic: item.topic || "General",
                standalone: item.standalone !== false
              };
            });
            return resolve(mapped);
          }
          resolve(null);
        } catch (e) {
          reject(e);
        }
      });
    });

    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Ollama request timed out'));
    });
    req.write(postData);
    req.end();
  });
}

module.exports = {
  scoreCandidates,
  scoreCandidateHeuristically,
  deduplicateCandidates
};
