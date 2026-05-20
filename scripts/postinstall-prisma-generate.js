const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const rootDir = path.resolve(__dirname, '..');
const schemaPath = path.join(rootDir, 'prisma', 'schema.prisma');
const generatedClientPath = path.join(rootDir, 'node_modules', '.prisma', 'client', 'index.js');
const puppeteerCachePath = path.join(rootDir, '.cache', 'puppeteer');
const maxAttempts = 5;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function hasGeneratedClient() {
  return fs.existsSync(generatedClientPath);
}

function runPrismaGenerate() {
  return new Promise((resolve, reject) => {
    let prismaEntrypoint;
    try {
      prismaEntrypoint = require.resolve('prisma/build/index.js', { paths: [rootDir] });
    } catch (error) {
      reject(error);
      return;
    }

    const child = spawn(process.execPath, [prismaEntrypoint, 'generate', '--schema', schemaPath], {
      cwd: rootDir,
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: false,
    });

    let combinedOutput = '';

    child.stdout.on('data', (chunk) => {
      const text = chunk.toString();
      combinedOutput += text;
      process.stdout.write(text);
    });

    child.stderr.on('data', (chunk) => {
      const text = chunk.toString();
      combinedOutput += text;
      process.stderr.write(text);
    });

    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      const error = new Error(combinedOutput || `prisma generate exited with code ${code}`);
      error.code = code;
      reject(error);
    });
  });
}

function runPuppeteerChromeInstall() {
  return new Promise((resolve, reject) => {
    let puppeteerCli;
    try {
      puppeteerCli = require.resolve('puppeteer/lib/cjs/puppeteer/node/cli.js', { paths: [rootDir] });
    } catch (error) {
      reject(error);
      return;
    }

    const child = spawn(process.execPath, [puppeteerCli, 'browsers', 'install', 'chrome'], {
      cwd: rootDir,
      env: {
        ...process.env,
        PUPPETEER_CACHE_DIR: process.env.PUPPETEER_CACHE_DIR || puppeteerCachePath,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: false,
    });

    let combinedOutput = '';

    child.stdout.on('data', (chunk) => {
      const text = chunk.toString();
      combinedOutput += text;
      process.stdout.write(text);
    });

    child.stderr.on('data', (chunk) => {
      const text = chunk.toString();
      combinedOutput += text;
      process.stderr.write(text);
    });

    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      const error = new Error(combinedOutput || `puppeteer browsers install chrome exited with code ${code}`);
      error.code = code;
      reject(error);
    });
  });
}

async function main() {
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      await runPrismaGenerate();
      console.log('Prisma client generated successfully.');
      break;
    } catch (error) {
      const message = error?.message || String(error);
      const retryable = /EPERM|EBUSY|operation not permitted|resource busy/i.test(message);
      const existingClientAvailable = hasGeneratedClient();

      if (!retryable || attempt === maxAttempts) {
        if (retryable && existingClientAvailable) {
          console.warn(
            `Prisma generate stayed locked after ${attempt} attempts, but an existing generated client is available. Continuing install.`,
          );
          break;
        }

        throw error;
      }

      console.warn(
        `Prisma generate attempt ${attempt} failed with a temporary file lock. Retrying shortly...`,
      );
      await sleep(attempt * 1500);
    }
  }

  if (process.env.PUPPETEER_INSTALL_CHROME !== 'true') {
    console.log('Skipping Puppeteer Chrome install. Set PUPPETEER_INSTALL_CHROME=true to enable WhatsApp Web browser install.');
    return;
  }

  await runPuppeteerChromeInstall();
  console.log('Puppeteer Chrome installed successfully.');
}

main().catch((error) => {
  console.error('Prisma postinstall failed:', error?.message || error);
  process.exit(1);
});
