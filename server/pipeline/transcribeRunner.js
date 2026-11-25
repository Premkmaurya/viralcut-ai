const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

/**
 * Runs speech-to-text transcription on a 16 kHz mono WAV file.
 * Invokes server/pipeline/transcribe.py.
 * @param {string} audioPath - Path to WAV file
 * @param {string} outputJsonPath - Path for JSON output
 * @param {object} options - { model, device, duration, allowDemo, isDemo }
 * @returns {Promise<object>} - Resolves with parsed transcript data
 */
function runTranscription(audioPath, outputJsonPath, options = {}) {
  return new Promise((resolve, reject) => {
    if (!audioPath || !fs.existsSync(audioPath)) {
      return reject(new Error(`Audio file not found: ${audioPath}`));
    }

    // If explicit demo mode is requested, generate structured demo transcript immediately
    if (options.isDemo === true || options.demoMode === true) {
      console.log('[Transcription] Generating DEMO fallback transcript segments because demo mode is explicitly active.');
      try {
        const audioDuration = typeof options.duration === 'number' && options.duration > 0 ? options.duration : 60;
        const fallbackData = generateFallbackTranscript(audioPath, audioDuration);
        fallbackData.is_demo = true;
        fallbackData.demo_mode = true;
        fallbackData.demo_reason = 'Job was created in DEMO mode.';

        fs.mkdirSync(path.dirname(outputJsonPath), { recursive: true });
        fs.writeFileSync(outputJsonPath, JSON.stringify(fallbackData, null, 2), 'utf8');
        return resolve(fallbackData);
      } catch (fbErr) {
        return reject(new Error(`Demo transcription fallback error: ${fbErr.message}`));
      }
    }

    let pythonPath = process.env.PYTHON_PATH;
    if (pythonPath) {
      const resolvedPy = path.resolve(pythonPath);
      if (fs.existsSync(resolvedPy)) {
        pythonPath = resolvedPy;
      }
    } else {
      const venvPy = path.resolve(__dirname, '..', '..', '.venv', 'Scripts', 'python.exe');
      if (fs.existsSync(venvPy)) {
        pythonPath = venvPy;
      } else {
        pythonPath = 'python';
      }
    }
    const scriptPath = path.join(__dirname, 'transcribe.py');
    const model = options.model || process.env.WHISPER_MODEL || 'base';
    const device = options.device || process.env.WHISPER_DEVICE || 'cpu';

    const args = [
      scriptPath,
      '--audio', audioPath,
      '--output', outputJsonPath,
      '--model', model,
      '--device', device
    ];

    execFile(pythonPath, args, { maxBuffer: 20 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (!error && fs.existsSync(outputJsonPath)) {
        try {
          const content = fs.readFileSync(outputJsonPath, 'utf8');
          const data = JSON.parse(content);
          data.is_demo = false;
          data.demo_mode = false;
          return resolve(data);
        } catch (parseErr) {
          return reject(new Error(`Failed to parse transcript output JSON: ${parseErr.message}`));
        }
      }

      const execErrorMsg = (stderr || (error ? error.message : 'Unknown execution error')).trim();
      console.warn(`[Transcription] faster-whisper execution note: ${execErrorMsg}`);

      // Check whether demo mode is explicitly permitted
      const isDemoAllowed =
        options.allowDemo === true ||
        options.isDemo === true ||
        options.demoMode === true ||
        process.env.ALLOW_DEMO_TRANSCRIPT === 'true' ||
        process.env.NODE_ENV === 'test';

      if (!isDemoAllowed) {
        return reject(new Error(
          `Speech recognition dependency error: faster-whisper failed to run in Python environment (${pythonPath}). ` +
          `Details: ${execErrorMsg.substring(0, 200)}. ` +
          `Windows setup instruction: Install Python 3.10-3.12 64-bit with AVX/x86-64-v2 CPU support and run "pip install faster-whisper", ` +
          `then set PYTHON_PATH in .env. To test without faster-whisper, enable demo mode.`
        ));
      }

      console.warn('[Transcription] Generating DEMO fallback transcript segments because faster-whisper is unavailable.');

      try {
        const audioDuration = typeof options.duration === 'number' && options.duration > 0 ? options.duration : 60;
        const fallbackData = generateFallbackTranscript(audioPath, audioDuration);
        fallbackData.is_demo = true;
        fallbackData.demo_mode = true;
        fallbackData.demo_reason = `faster-whisper is unavailable in ${pythonPath}: ${execErrorMsg.substring(0, 150)}`;

        fs.mkdirSync(path.dirname(outputJsonPath), { recursive: true });
        fs.writeFileSync(outputJsonPath, JSON.stringify(fallbackData, null, 2), 'utf8');
        return resolve(fallbackData);
      } catch (fbErr) {
        return reject(new Error(`Transcription failed and fallback error: ${fbErr.message}`));
      }
    });
  });
}

/**
 * Generates structured fallback transcript segments for testing and offline environments.
 * Preserves actual video duration so timestamps never exceed source media.
 */
function generateFallbackTranscript(audioPath, actualDuration = 60) {
  const duration = Math.max(1, typeof actualDuration === 'number' && !isNaN(actualDuration) ? actualDuration : 60);

  // For short videos, scale segment duration so segments fit nicely within bounds
  let segmentDuration = 4.5;
  if (duration <= 10) {
    segmentDuration = Math.max(1, duration / 2);
  } else if (duration <= 30) {
    segmentDuration = 3.0;
  }

  const numSegments = Math.max(1, Math.floor(duration / segmentDuration));

  const sampleSentences = [
    "Here is the single most important storytelling secret that top creators never talk about.",
    "When you analyze high retention videos, they all have one structural element in common.",
    "The opening three seconds decide whether a viewer stays or swipes away into the feed.",
    "If you don't establish curiosity immediately, your audience retention plummets before the first point.",
    "Notice how this technique introduces a complication right in the middle of the explanation.",
    "This is why most people fail to sustain viewer attention beyond the thirty second mark.",
    "Let me show you the exact breakdown of how this multi-part insight was crafted.",
    "By delivering an unexpected revelation every ten seconds, you maintain an active dopamine loop for viewers.",
    "Pay close attention to what happens when you combine narrative contrast with tight pacing.",
    "The key is to answer the initial curiosity gap with concrete evidence and actionable advice.",
    "The final payoff must fulfill the exact promise made in the very first sentence of the short.",
    "Once you master this sixty to ninety second formula, producing viral shorts becomes completely repeatable.",
    "Remember to always structure your explanation with a clear beginning, middle evidence, and closing resolution.",
    "Save this insight and apply it to your very next video project."
  ];

  const segments = [];
  const fullTextParts = [];

  for (let i = 0; i < numSegments; i++) {
    const start = Math.round(i * segmentDuration * 100) / 100;
    const end = Math.round(Math.min((i + 1) * segmentDuration, duration) * 100) / 100;
    const sentence = sampleSentences[i % sampleSentences.length];
    fullTextParts.push(sentence);

    const words = sentence.split(' ');
    const wordStep = (end - start) / Math.max(1, words.length);
    const wordsData = words.map((w, idx) => ({
      word: w,
      start: Math.round((start + idx * wordStep) * 100) / 100,
      end: Math.round((start + (idx + 1) * wordStep) * 100) / 100,
      probability: 0.95
    }));

    segments.push({
      id: i,
      start,
      end,
      text: sentence,
      words: wordsData
    });
  }

  return {
    language: 'en',
    language_probability: 0.99,
    duration: duration,
    is_demo: true,
    demo_mode: true,
    full_text: fullTextParts.join(' '),
    segments
  };
}

module.exports = {
  runTranscription,
  generateFallbackTranscript
};
