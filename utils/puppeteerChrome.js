const fs = require('fs');
const path = require('path');

function findChromeExecutable(cacheDir) {
  const explicitPath = process.env.PUPPETEER_EXECUTABLE_PATH || process.env.CHROME_BIN;
  if (explicitPath && fs.existsSync(explicitPath)) return explicitPath;

  const chromeRoot = path.join(cacheDir, 'chrome');
  if (!fs.existsSync(chromeRoot)) return null;

  const platforms = fs.readdirSync(chromeRoot).sort().reverse();
  for (const platformDir of platforms) {
    const candidate = path.join(chromeRoot, platformDir, 'chrome-linux64', 'chrome');
    if (fs.existsSync(candidate)) return candidate;
  }

  return null;
}

function ensureChromeExecutable(cacheDir) {
  const executablePath = findChromeExecutable(cacheDir);
  if (!executablePath) return null;

  if (process.platform !== 'win32') {
    try {
      fs.chmodSync(executablePath, 0o755);
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
