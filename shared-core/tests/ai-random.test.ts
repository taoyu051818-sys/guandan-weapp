import { describe, expect, it } from 'vitest';
import { createSeededRandom } from '../src/ai/random';

describe('createSeededRandom', () => {
  it('replays the same sequence for the same seed', () => {
    const first = createSeededRandom(20260811);
    const second = createSeededRandom(20260811);

    expect(Array.from({ length: 8 }, first)).toEqual(Array.from({ length: 8 }, second));
  });

  it('produces values in the Math.random range', () => {
    const random = createSeededRandom(1);
    const values = Array.from({ length: 100 }, random);

    expect(values.every((value) => value >= 0 && value < 1)).toBe(true);
    expect(new Set(values).size).toBeGreaterThan(90);
  });

  it('restores a serialized generator checkpoint', () => {
    const random = createSeededRandom(20260811);
    Array.from({ length: 5 }, random);
    const checkpoint = JSON.parse(JSON.stringify(random.checkpoint()));
    const expected = Array.from({ length: 8 }, random);

    random.restore(checkpoint);

    expect(Array.from({ length: 8 }, random)).toEqual(expected);
  });
});
