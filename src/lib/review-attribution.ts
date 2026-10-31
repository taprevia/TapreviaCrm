/**
 * Conservative, deterministic attribution for AI review drafts.
 *
 * A copied template is consumed only when the final text remains close to the
 * rendered suggestion. Whitespace/case differences and minor edits are
 * allowed; substantial rewrites are treated as the customer's own text.
 *
 * Rule (deterministic, no AI similarity):
 *   1. normalized equality → attributable;
 *   2. length gap must be <= 20% of the longer text;
 *   3. Levenshtein similarity (1 - distance / longer length) must be >= 0.8.
 */
function normalize(value: string): string {
  return value.replace(/\s+/g, ' ').trim().toLowerCase();
}

function editDistance(a: string, b: string): number {
  const rows = a.length + 1;
  const cols = b.length + 1;
  const dp = new Uint32Array(cols);
  for (let j = 0; j < cols; j += 1) dp[j] = j;
  for (let i = 1; i < rows; i += 1) {
    let previous = dp[0];
    dp[0] = i;
    for (let j = 1; j < cols; j += 1) {
      const current = dp[j];
      dp[j] = Math.min(
        dp[j] + 1,
        dp[j - 1] + 1,
        previous + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
      previous = current;
    }
  }
  return dp[cols - 1];
}

export function isAiDraftAttributable(original: string, finalText: string): boolean {
  const source = normalize(original);
  const next = normalize(finalText);
  if (!source || !next) return false;
  if (source === next) return true;
  // A large length gap makes the 0.8 threshold mathematically unreachable;
  // reject before the O(n·m) distance pass (also bounds work for pasted text).
  const longest = Math.max(source.length, next.length);
  if (Math.abs(source.length - next.length) / longest > 0.2) return false;
  if (next.length < source.length * 0.6) return false;
  const distance = editDistance(source, next);
  const similarity = 1 - distance / longest;
  return similarity >= 0.8;
}
