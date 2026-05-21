const path = require('path');
const fs = require('fs');

const puppeteerCachePath = path.join(__dirname, '..', '.cache', 'puppeteer');
process.env.PUPPETEER_CACHE_DIR = process.env.PUPPETEER_CACHE_DIR || puppeteerCachePath;

const qrcode = require('qrcode');
const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const { ensureChromeExecutable } = require('../utils/puppeteerChrome');

const clients = new Map();
const authDataPath = process.env.WHATSAPP_WEB_AUTH_DATA_PATH || path.join(__dirname, '..', '.wwebjs_auth');
const minWhatsappMemoryMb = Number(process.env.WHATSAPP_WEB_MIN_MEMORY_MB || 768);
const whatsappInitTimeoutMs = Number(process.env.WHATSAPP_WEB_INIT_TIMEOUT_MS || 120000);
const sharedWhatsappClientId = safeClientId(process.env.WHATSAPP_WEB_CLIENT_ID || 'msfitos-shared');
const autoRestoreSavedSession = process.env.WHATSAPP_WEB_AUTO_RESTORE !== 'false';

function getPuppeteerConfig() {
  const executablePath = ensureChromeExecutable(process.env.PUPPETEER_CACHE_DIR || puppeteerCachePath)
    || process.env.PUPPETEER_EXECUTABLE_PATH
    || process.env.CHROME_BIN
    || undefined;
  return {
    ...(executablePath ? { executablePath } : {}),
    headless: true,
    protocolTimeout: whatsappInitTimeoutMs,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--disable-extensions',
      '--disable-background-networking',
      '--disable-background-timer-throttling',
      '--disable-breakpad',
      '--disable-crash-reporter',
      '--disable-dbus',
      '--disable-features=AudioServiceOutOfProcess,MediaRouter,OptimizationHints',
      '--disable-renderer-backgrounding',
      '--disable-software-rasterizer',
      '--disable-sync',
      '--metrics-recording-only',
      '--mute-audio',
      '--no-first-run',
      '--no-zygote',
      '--single-process',
    ],
  };
}

function readFirstExistingFile(paths) {
  for (const filePath of paths) {
    try {
      if (fs.existsSync(filePath)) return fs.readFileSync(filePath, 'utf8').trim();
    } catch {
      // ignore unavailable cgroup files
    }
  }
  return '';
}

function getContainerMemoryLimitMb() {
  const raw = readFirstExistingFile(['/sys/fs/cgroup/memory.max', '/sys/fs/cgroup/memory/memory.limit_in_bytes']);
  if (!raw || raw === 'max') return null;
  const bytes = Number(raw);
  if (!Number.isFinite(bytes) || bytes <= 0) return null;

  const mb = Math.floor(bytes / 1024 / 1024);
  if (mb > 1024 * 1024) return null;
  return mb;
}

function getWhatsAppStartupBlockReason() {
  if (process.env.WHATSAPP_WEB_ENABLED === 'false') {
    return 'WhatsApp Web is disabled on this server. Set WHATSAPP_WEB_ENABLED=true to enable it.';
  }

  if (process.env.WHATSAPP_WEB_FORCE_START === 'true') return null;

  const memoryLimitMb = getContainerMemoryLimitMb();
  if (memoryLimitMb && memoryLimitMb < minWhatsappMemoryMb) {
    return `WhatsApp Web needs at least ${minWhatsappMemoryMb}MB memory to launch Chrome safely. This server has about ${memoryLimitMb}MB. Upgrade the Render instance or set WHATSAPP_WEB_FORCE_START=true if you accept crash risk.`;
  }

  return null;
}

function safeClientId(gymId) {
  return String(gymId || 'default').replace(/[^a-zA-Z0-9_-]/g, '_');
}

function getWhatsappSessionKey() {
  return sharedWhatsappClientId;
}

function getSharedSessionPath() {
  return path.join(authDataPath, `session-${sharedWhatsappClientId}`);
}

function getSavedSessionDirs() {
  try {
    if (!fs.existsSync(authDataPath)) return [];
    return fs
      .readdirSync(authDataPath, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && entry.name.startsWith('session-'))
      .map((entry) => {
        const sessionPath = path.join(authDataPath, entry.name);
        const stats = fs.statSync(sessionPath);
        return { name: entry.name, path: sessionPath, mtimeMs: stats.mtimeMs };
      })
      .sort((a, b) => b.mtimeMs - a.mtimeMs);
  } catch {
    return [];
  }
}

function hasSavedAuthSession() {
  return getSavedSessionDirs().length > 0;
}

function ensureSharedSessionFromSavedAuth() {
  const sharedSessionPath = getSharedSessionPath();
  if (fs.existsSync(sharedSessionPath) || process.env.WHATSAPP_WEB_ADOPT_LEGACY_SESSION === 'false') return;

  const legacySession = getSavedSessionDirs().find((session) => session.path !== sharedSessionPath);
  if (!legacySession) return;

  try {
    fs.cpSync(legacySession.path, sharedSessionPath, { recursive: true });
    console.info(`Adopted WhatsApp auth session ${legacySession.name} as session-${sharedWhatsappClientId}`);
  } catch (error) {
    console.warn(`Could not adopt WhatsApp auth session ${legacySession.name}: ${error?.message || error}`);
  }
}

function createState(gymId) {
  return {
    gymId,
    status: 'idle',
    qr: null,
    phone: null,
    message: null,
    updatedAt: new Date().toISOString(),
    client: null,
    startPromise: null,
  };
}

function serializeState(state) {
  return {
    status: state.status,
    qr: state.qr,
    phone: state.phone,
    message: state.message,
    updated_at: state.updatedAt,
  };
}

function touch(state, patch) {
  Object.assign(state, patch, { updatedAt: new Date().toISOString() });
}

function getState(gymId) {
  const key = getWhatsappSessionKey(gymId);
  if (!clients.has(key)) clients.set(key, createState('shared'));
  return clients.get(key);
}

function waitForWhatsappStartup(client, state) {
  return new Promise((resolve, reject) => {
    let settled = false;

    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };

    const fail = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    };

    const timer = setTimeout(() => {
      fail(new Error(`WhatsApp startup timed out after ${Math.round(whatsappInitTimeoutMs / 1000)} seconds. Chrome is likely blocked or too slow on this host.`));
    }, whatsappInitTimeoutMs);

    client.once('qr', () => finish('qr'));
    client.once('ready', () => finish('ready'));
    client.once('auth_failure', (message) => fail(new Error(message || 'WhatsApp authentication failed')));
    client.once('disconnected', (reason) => fail(new Error(reason || 'WhatsApp disconnected during startup')));

    client.initialize().catch(fail);
  });
}

async function startClient(gymId) {
  const state = getState(gymId);

  if (state.client && ['initializing', 'qr', 'ready', 'authenticated'].includes(state.status)) {
    return serializeState(state);
  }

  if (state.startPromise) {
    await state.startPromise.catch(() => null);
    return serializeState(state);
  }

  const blockReason = getWhatsAppStartupBlockReason();
  if (blockReason) {
    touch(state, { status: 'error', qr: null, message: blockReason });
    return serializeState(state);
  }

  ensureSharedSessionFromSavedAuth();

  const client = new Client({
    authStrategy: new LocalAuth({
      clientId: sharedWhatsappClientId,
      dataPath: authDataPath,
    }),
    puppeteer: getPuppeteerConfig(),
  });

  state.client = client;
  touch(state, { status: 'initializing', qr: null, message: 'Starting WhatsApp session' });

  client.on('qr', async (qr) => {
    try {
      const dataUrl = await qrcode.toDataURL(qr, { margin: 1, width: 320 });
      touch(state, { status: 'qr', qr: dataUrl, message: 'Scan the QR code from WhatsApp linked devices' });
    } catch (error) {
      touch(state, { status: 'error', message: error?.message || 'Failed to generate QR code' });
    }
  });

  client.on('loading_screen', (percent, message) => {
    touch(state, {
      status: 'initializing',
      qr: null,
      message: `Loading WhatsApp Web ${percent || 0}%${message ? ` - ${message}` : ''}`,
    });
  });

  client.on('authenticated', () => {
    touch(state, { status: 'authenticated', qr: null, message: 'WhatsApp authenticated' });
  });

  client.on('ready', () => {
    const phone = client.info?.wid?.user || client.info?.me?.user || null;
    touch(state, { status: 'ready', qr: null, phone, message: 'WhatsApp is ready' });
  });

  client.on('disconnected', (reason) => {
    touch(state, { status: 'disconnected', qr: null, message: reason || 'WhatsApp disconnected' });
    state.client = null;
  });

  client.on('auth_failure', (message) => {
    touch(state, { status: 'auth_failure', qr: null, message: message || 'WhatsApp authentication failed' });
  });

  try {
    state.startPromise = waitForWhatsappStartup(client, state);
    await state.startPromise;
  } catch (error) {
    touch(state, { status: 'error', qr: null, message: error?.message || 'Failed to start WhatsApp' });
    try {
      await client.destroy();
    } catch {
      // best effort cleanup
    }
    state.client = null;
  } finally {
    state.startPromise = null;
  }

  return serializeState(state);
}

async function getStatus(gymId) {
  const state = getState(gymId);
  const canRestore =
    autoRestoreSavedSession &&
    !state.client &&
    !state.startPromise &&
    ['idle', 'disconnected', 'error'].includes(state.status) &&
    hasSavedAuthSession();

  if (canRestore) {
    touch(state, { status: 'initializing', qr: null, message: 'Restoring saved WhatsApp session' });
    startClient(gymId).catch((error) => {
      touch(state, { status: 'error', qr: null, message: error?.message || 'Failed to restore WhatsApp session' });
      state.client = null;
      state.startPromise = null;
    });
  }

  return serializeState(state);
}

function normalizePhoneForWhatsapp(phone) {
  let digits = String(phone || '').replace(/\D/g, '');
  if (digits.startsWith('0')) digits = digits.replace(/^0+/, '');
  if (digits.length === 10) digits = `91${digits}`;
  if (!digits || digits.length < 10) return null;
  return digits;
}

async function sendWhatsappMessage({ gymId, phone, message, mediaUrl }) {
  const state = getState(gymId);
  if (!state.client || state.status !== 'ready') {
    if (autoRestoreSavedSession && hasSavedAuthSession()) {
      await startClient(gymId);
    }
  }

  if (!state.client || state.status !== 'ready') {
    throw new Error('WhatsApp is not connected. Open Admin WhatsApp and scan the QR code once.');
  }

  const digits = normalizePhoneForWhatsapp(phone);
  if (!digits) throw new Error('Invalid WhatsApp phone number');

  const text = String(message || '').trim();
  if (!text) throw new Error('Message is empty');

  const chatId = `${digits}@c.us`;
  const safeMediaUrl = String(mediaUrl || '').trim();

  if (safeMediaUrl) {
    const media = await MessageMedia.fromUrl(safeMediaUrl, { unsafeMime: true });
    await state.client.sendMessage(chatId, media, { caption: text });
    return { phone: digits };
  }

  await state.client.sendMessage(chatId, text);
  return { phone: digits };
}

async function logoutClient(gymId) {
  const state = getState(gymId);
  if (state.client) {
    try {
      await state.client.logout();
    } catch (error) {
      if (process.env.NODE_ENV !== 'production') {
        console.warn('WhatsApp logout failed', error?.message || error);
      }
    }
    try {
      await state.client.destroy();
    } catch {
      // best effort cleanup
    }
  }

  touch(state, { status: 'idle', qr: null, phone: null, message: 'Logged out' });
  state.client = null;
  return serializeState(state);
}

module.exports = {
  getStatus,
  startClient,
  logoutClient,
  sendWhatsappMessage,
  normalizePhoneForWhatsapp,
};
