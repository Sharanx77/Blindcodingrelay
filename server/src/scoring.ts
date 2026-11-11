export function levenshteinDistance(left: string, right: string): number {
  if (left === right) return 0;
  let leftCharacters = Array.from(left);
  let rightCharacters = Array.from(right);
  if (leftCharacters.length === 0) return rightCharacters.length;
  if (rightCharacters.length === 0) return leftCharacters.length;

  if (leftCharacters.length > rightCharacters.length) {
    [leftCharacters, rightCharacters] = [rightCharacters, leftCharacters];
  }
  let previous = Array.from({ length: leftCharacters.length + 1 }, (_, index) => index);

  for (let row = 1; row <= rightCharacters.length; row += 1) {
    const current = [row];
    for (let column = 1; column <= leftCharacters.length; column += 1) {
      const substitutionCost = leftCharacters[column - 1] === rightCharacters[row - 1] ? 0 : 1;
      current[column] = Math.min(
        current[column - 1] + 1,
        previous[column] + 1,
        previous[column - 1] + substitutionCost
      );
    }
    previous = current;
  }
  return previous[leftCharacters.length];
}

export function evaluateSubmission(typed: string, reference: string, maxPoints: number): {
  accuracy: number;
  points: number;
  errors: number;
} {
  const errors = levenshteinDistance(typed, reference);
  const denominator = Math.max(Array.from(typed).length, Array.from(reference).length, 1);
  const accuracy = Math.max(0, Math.round((1 - errors / denominator) * 10000) / 100);
  return {
    accuracy,
    points: Math.round(maxPoints * accuracy) / 100,
    errors
  };
}
