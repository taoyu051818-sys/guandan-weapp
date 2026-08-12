export type RandomSource = () => number;

export type SeededRandomCheckpoint = {
  algorithm: 'mulberry32-v1';
  state: number;
};

export type CheckpointableRandomSource = RandomSource & {
  checkpoint: () => SeededRandomCheckpoint;
  restore: (checkpoint: SeededRandomCheckpoint) => void;
};

export const isCheckpointableRandomSource = (
  random: RandomSource,
): random is CheckpointableRandomSource => {
  const candidate = random as Partial<CheckpointableRandomSource>;
  return typeof candidate.checkpoint === 'function' && typeof candidate.restore === 'function';
};

const assertCheckpoint = (checkpoint: SeededRandomCheckpoint): void => {
  if (
    checkpoint.algorithm !== 'mulberry32-v1'
    || !Number.isInteger(checkpoint.state)
    || checkpoint.state < 0
    || checkpoint.state > 0xffff_ffff
  ) {
    throw new Error('Invalid seeded random checkpoint');
  }
};

export const createSeededRandom = (seed: number): CheckpointableRandomSource => {
  let state = seed >>> 0;

  const random = (() => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  }) as CheckpointableRandomSource;

  random.checkpoint = () => ({ algorithm: 'mulberry32-v1', state });
  random.restore = (checkpoint) => {
    assertCheckpoint(checkpoint);
    state = checkpoint.state >>> 0;
  };

  return random;
};
