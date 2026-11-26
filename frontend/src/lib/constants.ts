export const HSK_LEVELS = ['HSK 1', 'HSK 2', 'HSK 3', 'HSK 4', 'Giao tiếp'] as const;
export const CEFR_LEVELS = ['CEFR A1', 'CEFR A2', 'CEFR B1', 'CEFR B2', 'Giao tiếp'] as const;

export type HskLevelOption = (typeof HSK_LEVELS)[number];

/** Fisher-Yates shuffle returning a new array without mutating the input. */
export function shuffleArray<T>(items: readonly T[]): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}
