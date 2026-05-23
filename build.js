const { execSync } = require('child_process');
const { version } = require('./package.json');
const name = `番茄钟-v${version}`;
const cmd = [
  'npx electron-packager .', name,
  '--app-version=' + version,
  '--platform=win32',
  '--arch=x64',
  '--out=dist',
  '--overwrite'
].join(' ');

console.log(`Building ${name} ...`);
execSync(cmd, {
  env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined },
  stdio: 'inherit'
});
console.log(`Done → dist/${name}-win32-x64/`);
