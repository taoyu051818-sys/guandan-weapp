import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const settingsPath = resolve(projectRoot, 'build/web-desktop/src/settings.json');
const applicationPath = resolve(projectRoot, 'build/web-desktop/application.js');
const indexPath = resolve(projectRoot, 'build/web-desktop/index.html');
const checkOnly = process.argv.includes('--check');

const settings = JSON.parse(await readFile(settingsPath, 'utf8'));
const splash = settings.splashScreen;

if (!splash) {
  throw new Error(`Missing splashScreen settings in ${settingsPath}`);
}

if (settings.screen?.designResolution?.width !== 1280 || settings.screen?.designResolution?.height !== 720) {
  throw new Error('Web build design resolution must be 1280x720.');
}

if (checkOnly) {
  if (splash.displayRatio !== 0 || splash.totalTime !== 0) {
    throw new Error('Web build still enables the Cocos startup splash screen.');
  }
} else {
  splash.displayRatio = 0;
  splash.totalTime = 0;
  await writeFile(settingsPath, `${JSON.stringify(settings)}\n`, 'utf8');
}

const applicationSource = await readFile(applicationPath, 'utf8');
if (/showFPS\s*:\s*true/.test(applicationSource)) {
  throw new Error('Web build still enables the FPS debug overlay. Rebuild with debug=false.');
}

const indexSource = await readFile(indexPath, 'utf8');
if (!/name="screen-orientation" content="landscape"/.test(indexSource)) {
  throw new Error('Web build must advertise landscape orientation.');
}
if (!/id="GameDiv"[^>]*width: 1280px; height: 720px;/.test(indexSource)
  || !/id="GameCanvas" width="1280" height="720"/.test(indexSource)) {
  throw new Error('Web build shell must start at 1280x720.');
}

console.log(
  checkOnly
    ? 'Web build presentation settings verified.'
    : 'Cocos startup splash disabled; FPS overlay verified off.',
);
