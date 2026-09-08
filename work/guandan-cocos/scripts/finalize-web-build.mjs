import { readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  extractRuntimeConfig,
  injectWebRuntimeConfig,
  runtimeConfigFromEnv,
  verifyBareIpTestRuntimeConfig,
  verifyReleaseRuntimeConfig,
} from './runtime-client-config.mjs';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const settingsPath = resolve(projectRoot, 'build/web-desktop/src/settings.json');
const applicationPath = resolve(projectRoot, 'build/web-desktop/application.js');
const indexPath = resolve(projectRoot, 'build/web-desktop/index.html');
const stylePath = resolve(projectRoot, 'build/web-desktop/style.css');
const checkOnly = process.argv.includes('--check');
const release = process.argv.includes('--release');
const bareIpTest = process.argv.includes('--bare-ip-test');
const buildRoot = resolve(projectRoot, 'build/web-desktop');
const forbiddenBundleMarkers = [
  '53e52062-b47e-43f8-b184-fb566cd720bd',
  '0cedd476-e4cd-4e92-a6d1-b85a9143167c',
  '0bdc3382-5148-4ac5-9e27-7cdbf08c1968',
  '1c24bc85-bf61-42fa-a125-c66267f3ee79',
  'pair_a_phrase',
  'licensed/straight_flush',
  'MerchantPageDomain',
];

const listFiles = async directory => (await Promise.all((await readdir(directory, { withFileTypes: true })).map(async entry => {
  const path = resolve(directory, entry.name);
  return entry.isDirectory() ? listFiles(path) : [path];
}))).flat();

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

let indexSource = await readFile(indexPath, 'utf8');
const styleSource = await readFile(stylePath, 'utf8');
if (!/name="screen-orientation" content="landscape"/.test(indexSource)) {
  throw new Error('Web build must advertise landscape orientation.');
}
if (!/id="GameDiv"[^>]*width: 1280px; height: 720px;/.test(indexSource)
  || !/id="GameCanvas" width="1280" height="720"/.test(indexSource)) {
  throw new Error('Web build shell must start at 1280x720.');
}
if (!/id="MobileStage"/.test(indexSource)
  || !/--simulated-mobile-width:\s*874px/.test(styleSource)
  || !/--simulated-mobile-height:\s*402px/.test(styleSource)
  || /width:\s*100vw\s*!important|height:\s*100vh\s*!important/.test(styleSource)) {
  throw new Error('Web build must use the fixed 874x402 desktop mobile simulator shell.');
}
const requestedRuntimeConfig = runtimeConfigFromEnv(process.env, { release, bareIpTest });
if (!checkOnly && requestedRuntimeConfig) {
  indexSource = injectWebRuntimeConfig(indexSource, requestedRuntimeConfig);
  await writeFile(indexPath, indexSource, 'utf8');
}
const embeddedRuntimeConfig = extractRuntimeConfig(indexSource);
if (release) verifyReleaseRuntimeConfig(embeddedRuntimeConfig);
if (bareIpTest) verifyBareIpTestRuntimeConfig(embeddedRuntimeConfig);
if (requestedRuntimeConfig && JSON.stringify(embeddedRuntimeConfig) !== JSON.stringify(requestedRuntimeConfig)) {
  throw new Error('Web build runtime config does not match the requested environment.');
}

for (const filePath of await listFiles(buildRoot)) {
  const contents = await readFile(filePath);
  const marker = forbiddenBundleMarkers.find(candidate => contents.includes(Buffer.from(candidate)));
  if (marker) throw new Error(`Archived or migration-only marker leaked into Web build: ${marker} (${filePath})`);
}

console.log(
  checkOnly
    ? 'Web build presentation settings verified.'
    : 'Cocos startup splash disabled; FPS overlay verified off.',
);
