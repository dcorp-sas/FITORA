import { build } from 'esbuild';
import { mkdir, copyFile } from 'node:fs/promises';

await build({
  entryPoints: ['native-health-entry.js'],
  outfile: 'native-health.js',
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: ['es2022'],
  minify: true
});

await mkdir('www', { recursive: true });
for (const file of ['index.html', 'app.css', 'app.js', 'enhancements.js', 'fitora-plus.js', 'fitora-full.js', 'sw.js', 'manifest.webmanifest', 'icon.svg', 'icon-192.png', 'icon-512.png', 'native-health.js', 'privacy-policy.html', 'privacypolicy.html']) {
  await copyFile(file, `www/${file}`);
}
