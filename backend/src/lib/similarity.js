// Text normalization + Levenshtein-based similarity for subjective answers.

export function normalize(s) {
  return String(s ?? '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

export function levenshtein(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  let curr = new Array(b.length + 1);
  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[b.length];
}

export function similarity(a, b) {
  const na = normalize(a);
  const nb = normalize(b);
  if (!na.length && !nb.length) return 1;
  const dist = levenshtein(na, nb);
  return 1 - dist / Math.max(na.length, nb.length);
}

// Judge a subjective answer against correctText + acceptedAnswers with threshold.
export function isTextCorrect(submitted, question) {
  const candidates = [question.correctText, ...(question.acceptedAnswers || [])]
    .filter(Boolean)
    .map(normalize);
  const sub = normalize(submitted);
  if (candidates.includes(sub)) return true;
  const threshold = question.similarityThreshold ?? 0.8;
  return candidates.some((c) => similarity(sub, c) >= threshold);
}
