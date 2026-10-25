// electron-builder afterSign hook (it runs after electron-builder edits the exe's icon and
// version info, which would break an earlier signature): VMP-sign the packed app with castLabs EVS (production
// signing, spec §4), then verify it. Either step failing fails the build, so an unsigned
// app is never wrapped into an installer. Needs `pip install castlabs-evs` and a signed-in
// EVS account (python -m castlabs_evs.account reauth).
const { spawn } = require('child_process');

// castLabs' upload (the whole 235 MB app) takes 25 s on a good day and nearly 2 minutes on a
// slow one, and now and then it
// stalls forever with no error. A fresh attempt usually goes straight through, so each
// attempt gets a time limit and signing is retried a few times before the build gives up.
const SIGN_ATTEMPTS = 4;
const SIGN_TIMEOUT_MS = 360_000;
const VERIFY_TIMEOUT_MS = 60_000;
const TIMED_OUT = -2;

function buildCommands(appOutDir) {
  return [
    ['python', ['-m', 'castlabs_evs.vmp', 'sign-pkg', appOutDir]],
    ['python', ['-m', 'castlabs_evs.vmp', 'verify-pkg', appOutDir]],
  ];
}

// Resolves with the exit code, -1 if it couldn't start, or TIMED_OUT after killing it.
function run(cmd, args, timeoutMs) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { stdio: 'inherit', windowsHide: true });
    let done = false;
    const finish = (code) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve(code);
    };
    const timer = setTimeout(() => {
      child.kill();
      finish(TIMED_OUT);
    }, timeoutMs);
    child.on('error', () => finish(-1));
    child.on('close', (code) => finish(code ?? -1));
  });
}

const describe = (code) => (code === TIMED_OUT ? 'timed out' : `exited ${code}`);

async function signAndVerify(appOutDir, runner = run, log = console.log) {
  const [[signCmd, signArgs], [verifyCmd, verifyArgs]] = buildCommands(appOutDir);
  let code;
  for (let attempt = 1; attempt <= SIGN_ATTEMPTS; attempt++) {
    code = await runner(signCmd, signArgs, SIGN_TIMEOUT_MS);
    if (code === 0) break;
    log(`[vmp] signing attempt ${attempt} of ${SIGN_ATTEMPTS} ${describe(code)}${attempt < SIGN_ATTEMPTS ? ', trying again' : ''}`);
  }
  if (code !== 0) throw new Error(`VMP signing failed: ${signCmd} ${signArgs.join(' ')} ${describe(code)} ${SIGN_ATTEMPTS} times`);
  code = await runner(verifyCmd, verifyArgs, VERIFY_TIMEOUT_MS);
  if (code !== 0) throw new Error(`VMP signing failed: ${verifyCmd} ${verifyArgs.join(' ')} ${describe(code)}`);
}

module.exports = async function afterSign(context) {
  await signAndVerify(context.appOutDir);
};
module.exports.default = module.exports;
module.exports.buildCommands = buildCommands;
module.exports.signAndVerify = signAndVerify;
module.exports.run = run;
module.exports.SIGN_ATTEMPTS = SIGN_ATTEMPTS;
module.exports.TIMED_OUT = TIMED_OUT;
