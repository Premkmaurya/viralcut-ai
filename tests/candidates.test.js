const test = require('node:test');
const assert = require('node:assert');
const { findCandidates } = require('../server/pipeline/findCandidates');
const { scoreCandidates, scoreCandidateHeuristically, deduplicateCandidates } = require('../server/pipeline/scoreCandidates');

test('Candidates: returns empty array for null or empty segments', () => {
  assert.deepStrictEqual(findCandidates([], 120), []);
  assert.deepStrictEqual(findCandidates(null, 120), []);
});

test('Candidates: rejects source video shorter than minDuration (60s) without padding', () => {
  const shortSegments = [
    { start: 0, end: 15, text: 'This video is very short.' },
    { start: 16, end: 40, text: 'It ends way before 60 seconds.' }
  ];
  // 45 second source video
  const candidates = findCandidates(shortSegments, 45, { minDuration: 60 });
  assert.strictEqual(candidates.length, 0, 'Must return 0 candidates for videos < 60s instead of padding');
});

test('Candidates: generates 60-90s target candidates and extends past 60s for incomplete sentences', () => {
  const segments = [
    { start: 0, end: 20, text: 'Here is the critical insight you must understand.' },
    { start: 20, end: 40, text: 'Most people give up right before reaching breakthrough momentum.' },
    { start: 40, end: 60, text: 'and the reason why is because they lack' }, // No closing punctuation at 60s!
    { start: 60, end: 75, text: 'a structured daily feedback loop that guarantees progress.' }, // Clean ending at 75s
    { start: 75, end: 95, text: 'When you implement this loop, your conversion rate doubles.' },
    { start: 95, end: 110, text: 'Follow for more strategic breakdowns.' }
  ];

  const candidates = findCandidates(segments, 120, {
    minDuration: 60,
    maxDuration: 180,
    targetMinDuration: 60,
    targetMaxDuration: 90
  });

  assert.ok(candidates.length > 0, 'Should find candidate moments');

  // Verify that candidate does NOT cut off at 60s with incomplete sentence "and the reason why is because they lack"
  const candidateFromZero = candidates.find(c => c.start === 0);
  assert.ok(candidateFromZero, 'Should have candidate starting at 0s');
  assert.ok(candidateFromZero.duration >= 70, `Candidate should extend past 60s to natural sentence end (~75s), got duration: ${candidateFromZero.duration}`);
  assert.ok(candidateFromZero.text.endsWith('loop that guarantees progress.'), 'Candidate text should finish the sentence cleanly');
});

test('Candidates: supports configurable minDuration and maxDuration', () => {
  const segments = [
    { start: 0, end: 35, text: 'This is a quick 35-second insight.' },
    { start: 35, end: 70, text: 'Here is another 35 seconds of value.' }
  ];

  // Configured with custom minDuration: 30
  const customCandidates = findCandidates(segments, 80, { minDuration: 30, maxDuration: 60 });
  assert.ok(customCandidates.length > 0, 'Should return candidates when minDuration is set to 30');
  assert.ok(customCandidates[0].duration >= 30 && customCandidates[0].duration <= 60);
});

test('Candidates: filters timestamps strictly within source duration and bounds', async () => {
  const mockCandidates = [
    { start: -5, end: 65, text: 'Invalid negative start' },
    { start: 10, end: 80, text: 'Valid candidate of 70s duration within 120s source.' },
    { start: 80, end: 190, text: 'Exceeds duration of 120s' }
  ];

  const scored = await scoreCandidates(mockCandidates, 120, { minDuration: 60, maxDuration: 180 });
  assert.strictEqual(scored.length, 1);
  assert.strictEqual(scored[0].start, 10);
  assert.strictEqual(scored[0].end, 80);
});

test('Candidates: deduplicates heavily overlapping candidates', () => {
  const scoredList = [
    {
      start: 10,
      end: 75,
      score: 92,
      title: 'Top Highlight',
      hook: 'Why everyone fails at this.',
      reason: 'Strong hook',
      topic: 'Strategy',
      standalone: true
    },
    {
      start: 12, // starts within 2 seconds of previous
      end: 78,
      score: 75,
      title: 'Overlapping Version',
      hook: 'Everyone fails at this.',
      reason: 'Moderate hook',
      topic: 'Strategy',
      standalone: true
    },
    {
      start: 85, // distinct range
      end: 155,
      score: 88,
      title: 'Second Insight',
      hook: 'The single rule you need.',
      reason: 'Good value',
      topic: 'Growth',
      standalone: true
    }
  ];

  const deduped = deduplicateCandidates(scoredList);
  assert.strictEqual(deduped.length, 2, 'Should deduplicate the heavily overlapping candidate');
  assert.strictEqual(deduped[0].score, 92, 'Higher scoring candidate should be preserved');
  assert.strictEqual(deduped[1].score, 88);
});

test('Candidates: heuristic scorer accurately evaluates 60-90s viral indicators and penalizes sub-60s', () => {
  const strongCandidate = {
    start: 0,
    end: 72,
    duration: 72,
    text: "Did you know that 90% of creators make this fatal mistake? If you don't hook viewers in three seconds, your watch time drops immediately. First, analyze your audience. Next, eliminate all unnecessary preamble. Therefore, always open with high curiosity and deliver an immediate payoff."
  };

  const weakShortCandidate = {
    start: 40,
    end: 70,
    duration: 30, // Sub-60s incomplete
    text: "and like basically um we were sort of thinking about stuff and yeah maybe that was it i guess"
  };

  const strongResult = scoreCandidateHeuristically(strongCandidate, 0, 2);
  const weakResult = scoreCandidateHeuristically(weakShortCandidate, 1, 2);

  assert.ok(strongResult.score >= 80, `Strong candidate score should be >= 80, got ${strongResult.score}`);
  assert.ok(weakResult.score < 60, `Weak candidate score should be < 60, got ${weakResult.score}`);
  assert.ok(strongResult.standalone === true, 'Strong candidate should make standalone sense');
  assert.ok(strongResult.title.length > 0, 'Should generate a non-empty title');
});
