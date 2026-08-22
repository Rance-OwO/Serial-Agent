export type KeilF7Action = 'build' | 'flash' | 'buildAndFlash' | 'custom';

const F7_ACTION_COMMANDS: Record<KeilF7Action, string> = {
  build: 'serialagent.keil.build',
  flash: 'serialagent.keil.flash',
  buildAndFlash: 'serialagent.keil.buildAndFlash',
  custom: 'serialagent.custom.run',
};

export function resolveKeilF7Command(action: string): string {
  if (action === 'build' || action === 'flash' || action === 'buildAndFlash' || action === 'custom') {
    return F7_ACTION_COMMANDS[action];
  }

  throw new Error(`Invalid serialagent.keil.f7Action: ${action}`);
}
