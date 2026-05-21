const fs = require('fs');
const path = require('path');

const executableNames = new Set([
  'chrome',
  'chrome_crashpad_handler',
  'chrome-wrapper',
]);

function findChromeExecutable(cacheDir) {
  const explicitPath = process.env.PUPPETEER_EXECUTABLE_PATH || process.env.CHROME_BIN;
  if (explicitPath && fs.existsSync(explicitPath)) return explicitPath;

  if (process.platform === 'win32') {
    const windowsCandidates = [
      process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Google', 'Chrome', 'Application', 'chrome.exe'),
      process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, 'Google', 'Chrome', 'Application', 'chrome.exe'),
      process.env['PROGRAMFILES(X86)'] && path.join(process.env['PROGRAMFILES(X86)'], 'Google', 'Chrome', 'Application', 'chrome.exe'),
      process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
      process.env['PROGRAMFILES(X86)'] && path.join(process.env['PROGRAMFILES(X86)'], 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    ].filter(Boolean);

    for (const candidate of windowsCandidates) {
      if (fs.existsSync(candidate)) return candidate;
    }
  }

  const chromeRoot = path.join(cacheDir, 'chrome');
  if (!fs.existsSync(chromeRoot)) return null;

  const platforms = fs.readdirSync(chromeRoot).sort().reverse();
  for (const platformDir of platforms) {
    const candidate = path.join(chromeRoot, platformDir, 'chrome-linux64', 'chrome');
    if (fs.existsSync(candidate)) return candidate;
  }

  return null;
}

function makeChromeTreeExecutable(chromeDir) {
  if (!chromeDir || process.platform === 'win32') return;

  const entries = fs.readdirSync(chromeDir, { withFileTypes: true });
  fs.chmodSync(chromeDir, 0o755);

  for (const entry of entries) {
    const entryPath = path.join(chromeDir, entry.name);
    if (entry.isDirectory()) {
      makeChromeTreeExecutable(entryPath);
      continue;
    }

    if (entry.isFile() && executableNames.has(entry.name)) {
      fs.chmodSync(entryPath, 0o755);
    }
  }
}

function ensureChromeExecutable(cacheDir) {
  const executablePath = findChromeExecutable(cacheDir);
  if (!executablePath) return null;

  if (process.platform !== 'win32') {
    try {
      makeChromeTreeExecutable(path.dirname(executablePath));
    } catch (error) {
      console.warn(`Could not update Chrome executable permissions: ${error?.message || error}`);
    }
  }

  return executablePath;
}

module.exports = {
  ensureChromeExecutable,
  findChromeExecutable,
};
