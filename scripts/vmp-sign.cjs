// electron-builder afterSign hook (it runs after electron-builder edits the exe's icon and
// version info, which would break an earlier signature): VMP-sign the packed app with castLabs EVS (production
// signing, spec §4), then verify it. Either step failing fails the build, so an unsigned
// app is never wrapped into an installer. Needs `pip install castlabs-evs` and a signed-in
// EVS account (python -m castlabs_evs.account reauth).
const { spawn } = require('child_process');

function buildCommands(appOutDir) {
  return [
    ['python', ['-m', 'castlabs_evs.vmp', 'sign-pkg', appOutDir]],
    ['python', ['-m', 'castlabs_evs.vmp', 'verify-pkg', appOutDir]],
  ];
}

function run(cmd, args) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { stdio: 'inherit', windowsHide: true });
    child.on('error', () => resolve(-1));
    child.on('close', (code) => resolve(code ?? -1));
  });
}

async function signAndVerify(appOutDir, runner = run) {
  for (const [cmd, args] of buildCommands(appOutDir)) {
    const code = await runner(cmd, args);
    if (code !== 0) throw new Error(`VMP signing failed: ${cmd} ${args.join(' ')} exited ${code}`);
  }
}

module.exports = async function afterSign(context) {
  await signAndVerify(context.appOutDir);
};
module.exports.default = module.exports;
module.exports.buildCommands = buildCommands;
module.exports.signAndVerify = signAndVerify;
