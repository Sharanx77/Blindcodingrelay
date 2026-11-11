import type { RoundNumber } from "./types.js";

export const ROUND_CONFIG: Record<RoundNumber, { title: string; duration: number; points: number }> = {
  1: { title: "Type Before Time Runs Out", duration: 30, points: 10 },
  2: { title: "Blind Code Master", duration: 45, points: 20 },
  3: { title: "Decode, Type & Win", duration: 60, points: 30 }
};

export const CHALLENGE_SEEDS: Array<{ round: RoundNumber; referenceText: string }> = [
  { round: 1, referenceText: "console.log(\"Hello, world!\");\nconst total = 7 + 5;" },
  { round: 2, referenceText: "function square(value) {\n  return value * value;\n}\n\nconsole.log(square(8));" },
  { round: 3, referenceText: "const counts = items.reduce((map, item) => {\n  map[item] = (map[item] ?? 0) + 1;\n  return map;\n}, {});\n\nconsole.log(Object.entries(counts));" }
];
