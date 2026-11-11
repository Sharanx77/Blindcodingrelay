import assert from "node:assert/strict";
import test from "node:test";
import { evaluateSubmission, levenshteinDistance } from "./scoring.js";

test("Levenshtein distance counts exact character edits", () => {
  assert.equal(levenshteinDistance("code", "code"), 0);
  assert.equal(levenshteinDistance("code", "c0de"), 1);
  assert.equal(levenshteinDistance("code", "cod"), 1);
  assert.equal(levenshteinDistance("cod", "code"), 1);
  assert.equal(levenshteinDistance("a😀", "a"), 1);
});

test("spaces, line breaks, and symbols affect accuracy", () => {
  assert.equal(levenshteinDistance("let x=1;", "let x = 1;"), 2);
  assert.equal(levenshteinDistance("a\nb", "a b"), 1);
  assert.equal(levenshteinDistance("[]{}", "[]()"), 2);
});

test("round scoring scales by accuracy and awards no speed bonus", () => {
  assert.deepEqual(evaluateSubmission("hello", "hello", 10), {
    accuracy: 100,
    points: 10,
    errors: 0
  });
  assert.deepEqual(evaluateSubmission("hell0", "hello", 20), {
    accuracy: 80,
    points: 16,
    errors: 1
  });
  assert.equal(evaluateSubmission("", "hello", 30).points, 0);
});
