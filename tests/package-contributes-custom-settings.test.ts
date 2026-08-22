import { readFileSync } from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

describe('Serial Agent custom command contributions', () => {
  it('registers serialagent.custom.* settings in package.json', () => {
    const manifest = JSON.parse(readFileSync(
      path.resolve(__dirname, '../packages/serialagent-vscode/package.json'),
      'utf8',
    )) as {
      contributes: {
        configuration: {
          properties: Record<string, {
            enum?: string[];
            enumDescriptions?: string[];
          }>;
        };
      };
    };

    const properties = manifest.contributes.configuration.properties;
    expect(properties['serialagent.custom.mode']).toMatchObject({
      type: 'string',
      default: 'python',
      enum: ['python', 'command'],
    });
    expect(properties['serialagent.custom.mode'].enumDescriptions).toEqual([
      'Run a selected .py file with a selected Python interpreter.',
      'Run a pasted command line or a selected executable.',
    ]);
    expect(properties['serialagent.custom.pythonPath']).toBeDefined();
    expect(properties['serialagent.custom.script']).toBeDefined();
    expect(properties['serialagent.custom.command']).toBeDefined();
  });
});
