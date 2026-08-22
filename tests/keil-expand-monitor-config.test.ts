import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from 'vitest';
import packageJson from '../packages/serialagent-vscode/package.json';

describe('keil.expandMonitorOnBuildFlash setting', () => {
  it('is contributed with default true', () => {
    const properties = packageJson.contributes?.configuration?.properties as Record<string, {
      type?: string;
      default?: unknown;
    }>;
    const setting = properties['serialagent.keil.expandMonitorOnBuildFlash'];

    expect(setting).toBeDefined();
    expect(setting?.type).toBe('boolean');
    expect(setting?.default).toBe(true);
  });

  it('expands Serial Monitor for flash, build-and-flash, and custom command', () => {
    const source = readFileSync(
      join(__dirname, '../packages/serialagent-vscode/src/extension.ts'),
      'utf8',
    );

    expect(source).toContain("registerCommand('serialagent.keil.flash'");
    expect(source).toMatch(/registerCommand\('serialagent\.keil\.flash'[\s\S]*?await expandMonitorIfEnabled\(\);/);
    expect(source).toMatch(/registerCommand\('serialagent\.keil\.buildAndFlash'[\s\S]*?await expandMonitorIfEnabled\(\);/);
    expect(source).toMatch(/registerCommand\('serialagent\.custom\.run'[\s\S]*?await expandMonitorIfEnabled\(\);/);
    expect(source).toMatch(/activePanel:\s*'monitor'/);
  });
});
