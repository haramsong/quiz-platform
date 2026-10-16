import { test, expect } from 'vitest';
import { colorHex, CHOICE_COLORS } from './constants.js';

test('colorHex: known color names map to hex', () => {
  expect(colorHex('red')).toBe(CHOICE_COLORS.red);
  expect(colorHex('purple')).toBe('#7c3aed');
});

test('colorHex: unknown name falls back to gray', () => {
  expect(colorHex('chartreuse')).toBe(CHOICE_COLORS.gray);
  expect(colorHex(undefined)).toBe(CHOICE_COLORS.gray);
  expect(colorHex('')).toBe(CHOICE_COLORS.gray);
});
