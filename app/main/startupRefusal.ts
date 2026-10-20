// Switches Atlas refuses at start. It never runs without Chromium's sandbox, and a released build
// never accepts a debugger: --remote-debugging-port/-pipe would expose the window (and its
// window.atlas bridge) to any local program, and --inspect the main process. Only the separate
// end-to-end build (package.json "atlasEndToEndBuild", set when it is packaged) accepts the
// debugging switches Playwright needs; development runs are not packaged.

export const debuggingSwitches = ['remote-debugging-port', 'remote-debugging-pipe', 'inspect', 'inspect-brk', 'inspect-port', 'inspect-publish-uid'] as const;

export interface Refusal { reason: 'sandbox' | 'debugging'; switches: string[] }

export function startupRefusal(options: {
  hasSwitch(name: string): boolean;
  environment: NodeJS.ProcessEnv;
  packaged: boolean;
  endToEndBuild: boolean;
}): Refusal | null {
  const sandbox = ['no-sandbox'].filter(name => options.hasSwitch(name));
  if (options.environment.ELECTRON_DISABLE_SANDBOX) sandbox.push('ELECTRON_DISABLE_SANDBOX');
  if (sandbox.length) return { reason: 'sandbox', switches: sandbox };
  if (!options.packaged || options.endToEndBuild) return null;
  const debugging = debuggingSwitches.filter(name => options.hasSwitch(name));
  return debugging.length ? { reason: 'debugging', switches: debugging } : null;
}

export function refusalMessage(refusal: Refusal): { message: string; detail: string } {
  if (refusal.reason === 'sandbox') return {
    message: 'Atlas does not run without its sandbox.',
    detail: [
      'Atlas was started with its security sandbox turned off (' + refusal.switches.join(', ') + '). An AppImage launcher does this when the system does not allow unprivileged user namespaces.',
      '',
      'Allow them, then start Atlas again: run "sudo sysctl -w kernel.apparmor_restrict_unprivileged_userns=0", or give the AppImage an AppArmor profile. The Atlas README explains both under "Linux sandbox".',
    ].join('\n'),
  };
  return {
    message: 'Atlas does not run with a debugger attached.',
    detail: 'Atlas was started with debugging switches (' + refusal.switches.map(name => '--' + name).join(', ') + '), which would let other programs on this computer control it. Start Atlas without them.',
  };
}
