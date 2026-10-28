import { spawnSync } from 'node:child_process';

const command = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const result = spawnSync(command, ['cap', 'sync'], {
  stdio: 'inherit',
  env: { ...process.env, FITORA_NATIVE_REMOTE: '1' },
  shell: process.platform === 'win32'
});
process.exit(result.status ?? 1);
