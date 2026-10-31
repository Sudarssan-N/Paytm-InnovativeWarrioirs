import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';

// The API server reads the AI provider keys from its environment, so pass
// them through from .env (Node 20.11 has no --env-file loader on spawn).
// Only the AI keys are taken, and values already in the shell environment win.
const AI_KEYS = ['DEEPSEEK_API_KEY', 'SARVAM_API_KEY', 'VITE_DEEPSEEK_API_KEY', 'VITE_SARVAM_API_KEY', 'DEEPSEEK_MODEL'];
function loadEnvFile(file) {
  try {
    return Object.fromEntries(readFileSync(file, 'utf8').split(/\r?\n/)
      .map((line) => line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/))
      .filter((match) => match && AI_KEYS.includes(match[1]))
      .map(([, key, value]) => [key, value.replace(/^(['"])(.*)\1$/, '$2')]));
  } catch { return {}; }
}

const env = { ...loadEnvFile('.env'), ...process.env };

const children = [
  spawn(process.execPath, ['server/index.mjs'], { stdio: 'inherit', env }),
  spawn(process.platform === 'win32' ? 'node_modules\\.bin\\vite.cmd' : 'node_modules/.bin/vite', [], { stdio: 'inherit', env }),
];

let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  children.forEach((child) => child.kill('SIGTERM'));
  setTimeout(() => process.exit(code), 50);
}

children.forEach((child) => child.on('exit', (code) => { if (!stopping && code) stop(code); }));
process.on('SIGINT', () => stop(0));
process.on('SIGTERM', () => stop(0));
