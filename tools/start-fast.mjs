/**
 * Starts MediLink the fast way (Windows, Mac, Linux, Codespaces): build once (only what changed), then serve
 * the optimised app. Pages open instantly; nothing is compiled while you click around.
 * Developers who edit code and want live reload use "pnpm dev" instead.
 */
import { spawn, spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const win = process.platform === 'win32';
const pnpm = win ? 'pnpm.cmd' : 'pnpm';

console.log('== Preparing the fast version of MediLink (first time 1-2 minutes, after that a few seconds) ==');
const build = spawnSync(pnpm, ['exec', 'turbo', 'run', 'build', '--filter=@medilink/api', '--filter=@medilink/web', '--output-logs=errors-only'], {
  cwd: root,
  stdio: 'inherit',
  shell: win,
});
if (build.status !== 0) {
  console.error('\nThe build failed. Copy the text above and send it to Claude for a fix.');
  process.exit(build.status ?? 1);
}

const kids = [
  spawn(process.execPath, ['dist/main.js'], { cwd: path.join(root, 'apps/api'), stdio: 'inherit' }),
  spawn(pnpm, ['exec', 'next', 'start', '-p', '3000'], { cwd: path.join(root, 'apps/web'), stdio: ['ignore', 'ignore', 'inherit'], shell: win }),
];
const stop = () => {
  kids.forEach((k) => k.kill());
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
kids.forEach((k) => k.on('exit', (code) => code && code !== 0 && console.error(`A MediLink process stopped (code ${code}).`)));

const up = async (url) => {
  try {
    return (await fetch(url)).ok;
  } catch {
    return false;
  }
};
for (let i = 0; i < 90; i++) {
  if ((await up('http://localhost:4000/api/health')) && (await up('http://localhost:3000/login'))) break;
  await new Promise((r) => setTimeout(r, 1000));
}
console.log('\n== MediLink is ready: http://localhost:3000 (in Codespaces: the "Open in Browser" button for port 3000) ==');
console.log('Logins: shop 9848012345 · distributor 9876500001 · admin 9000000001');
console.log("The 6-digit OTP appears here: look for 'OTP for 98...'\n");
