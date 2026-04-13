import { describe, expect, it } from 'vitest';
import { resolveKeilF7Command } from '../packages/serialagent-vscode/src/keil-f7-action';

describe('resolveKeilF7Command', () => {
  it('maps build to the keil build command', () => {
    expect(resolveKeilF7Command('build')).toBe('serialagent.keil.build');
  });

  it('maps flash to the keil flash command', () => {
    expect(resolveKeilF7Command('flash')).toBe('serialagent.keil.flash');
  });

  it('maps buildAndFlash to the keil build-and-flash command', () => {
    expect(resolveKeilF7Command('buildAndFlash')).toBe('serialagent.keil.buildAndFlash');
  });

  it('throws for unsupported f7 actions', () => {
    expect(() => resolveKeilF7Command('invalid')).toThrowError('Invalid serialagent.keil.f7Action: invalid');
  });
});
