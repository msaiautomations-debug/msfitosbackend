const fs = require('fs');
const path = require('path');

const pino = require('pino');
const qrcode = require('qrcode');

const clients = new Map();
const authDataPath =
  process.env.BAILEYS_AUTH_DATA_PATH ||
  process.env.WHATSAPP_BAILEYS_AUTH_DATA_PATH ||
  path.join(__dirname, '..', '.baileys_auth');
const whatsappInitTimeoutMs = Number(
  process.env.BAILEYS_INIT_TIMEOUT_MS || process.env.WHATSAPP_WEB_INIT_TIMEOUT_MS || 120000,
);
const whatsappStartupStaleMs = Number(
  process.env.BAILEYS_STARTUP_STALE_MS || Math.max(whatsappInitTimeoutMs * 2, 5 * 60 * 1000),
);
const reconnectDelayMs = Number(process.env.BAILEYS_RECONNECT_DELAY_MS || 5000);
const autoRestoreSavedSession = process.env.BAILEYS_AUTO_RESTORE !== 'false';
const adminWhatsappClientId = safeClientId(process.env.BAILEYS_ADMIN_CLIENT_ID || 'admin-shared');
const logger = pino({ level: process.env.BAILEYS_LOG_LEVEL || 'silent' });

let baileysModulePromise = null;

function loadBaileys() {
  if (!baileysModulePromise) {
    baileysModulePromise = import('@whiskeysockets/baileys');
  }
  return baileysModulePromise;
}

function safeClientId(gymId) {
  return String(gymId || 'default').replace(/[^a-zA-Z0-9_-]/g, '_');
}

function getWhatsappSessionKey(gymId) {
  return gymId ? safeClientId(gymId) : adminWhatsappClientId;
}

function getSessionPath(gymId) {
  return path.join(authDataPath, `session-${getWhatsappSessionKey(gymId)}`);
}

function hasSavedAuthSession(gymId) {
  const sessionPath = getSessionPath(gymId);
  return fs.existsSync(path.join(sessionPath, 'creds.json')) || fs.existsSync(sessionPath);
}

function createState(gymId) {
  return {
    gymId,
    status: 'idle',
    qr: null,
    phone: null,
    message: null,
    updatedAt: new Date().toISOString(),
    sock: null,
    startPromise: null,
    reconnectTimer: null,
  };
}

function serializeState(state) {
  return {
    status: state.status,
    qr: state.qr,
    phone: state.phone,
    message: state.message,
    updated_at: state.updatedAt,
    saved: hasSavedAuthSession(state.gymId),
    provider: 'baileys',
  };
}

function touch(state, patch) {
  Object.assign(state, patch, { updatedAt: new Date().toISOString() });
}

function isStartupStatus(status) {
  return ['initializing', 'qr', 'starting'].includes(status);
}

function isStartupStale(state) {
  if (!isStartupStatus(state.status)) return false;
  const updatedAtMs = Date.parse(state.updatedAt || '');
  return Number.isFinite(updatedAtMs) && Date.now() - updatedAtMs > whatsappStartupStaleMs;
}

function getState(gymId) {
  const key = getWhatsappSessionKey(gymId);
  if (!clients.has(key)) clients.set(key, createState(gymId || null));
  return clients.get(key);
}

function clearReconnectTimer(state) {
  if (!state.reconnectTimer) return;
  clearTimeout(state.reconnectTimer);
  state.reconnectTimer = null;
}

async function destroySocketSafely(sock) {
  if (!sock) return;
  try {
    sock.ev?.removeAllListeners?.('connection.update');
    sock.ev?.removeAllListeners?.('creds.update');
  } catch {
    // best effort cleanup
  }

  try {
    sock.ws?.close?.();
  } catch {
    // best effort cleanup
  }

  try {
    sock.end?.(new Error('Socket closed by MS FitOS'));
  } catch {
    // best effort cleanup
  }
}

function getDisconnectCode(error) {
  return error?.output?.statusCode || error?.statusCode || error?.data?.statusCode || null;
}

function getDisconnectMessage(error) {
  return error?.output?.payload?.message || error?.message || 'WhatsApp disconnected';
}

function shouldReconnectAfterClose({ error, DisconnectReason }) {
  const code = getDisconnectCode(error);
  return code !== DisconnectReason?.loggedOut;
}

function getConnectedPhone(sock) {
  const raw =
    sock?.user?.id ||
    sock?.user?.jid ||
    sock?.authState?.creds?.me?.id ||
    sock?.authState?.creds?.me?.jid ||
    '';
  return String(raw).split(':')[0].split('@')[0] || null;
}

function scheduleReconnect(state) {
  if (!autoRestoreSavedSession || !hasSavedAuthSession(state.gymId) || state.reconnectTimer) return;

  state.reconnectTimer = setTimeout(() => {
    state.reconnectTimer = null;
    startClient(state.gymId).catch((error) => {
      touch(state, {
        status: 'error',
        qr: null,
        message: error?.message || 'Failed to restore WhatsApp session',
      });
      state.sock = null;
      state.startPromise = null;
    });
  }, reconnectDelayMs);
}

async function createSocket(state) {
  const {
    Browsers,
    DisconnectReason,
    default: makeWASocket,
    useMultiFileAuthState,
  } = await loadBaileys();

  const sessionPath = getSessionPath(state.gymId);
  fs.mkdirSync(sessionPath, { recursive: true });

  const { state: authState, saveCreds } = await useMultiFileAuthState(sessionPath);
  const sock = makeWASocket({
    auth: authState,
    browser: Browsers.ubuntu('MS FitOS'),
    logger,
    markOnlineOnConnect: false,
    printQRInTerminal: false,
    syncFullHistory: false,
  });

  sock.ev.on('creds.update', saveCreds);

  return { sock, DisconnectReason };
}

async function startClient(gymId) {
  const state = getState(gymId);

  if (state.sock && isStartupStale(state)) {
    await destroySocketSafely(state.sock);
    state.sock = null;
    state.startPromise = null;
    touch(state, { status: 'idle', qr: null, message: 'Restarting stale WhatsApp session' });
  }

  if (state.sock && ['initializing', 'starting', 'qr', 'ready'].includes(state.status)) {
    return serializeState(state);
  }

  if (state.startPromise) {
    await state.startPromise.catch(() => null);
    return serializeState(state);
  }

  clearReconnectTimer(state);
  touch(state, { status: 'initializing', qr: null, message: 'Starting WhatsApp session' });

  state.startPromise = (async () => {
    const { sock, DisconnectReason } = await createSocket(state);
    state.sock = sock;

    const startupPromise = new Promise((resolve, reject) => {
      let settled = false;

      const finish = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve();
      };

      const fail = (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(error);
      };

      const timer = setTimeout(() => {
        fail(new Error(`WhatsApp startup timed out after ${Math.round(whatsappInitTimeoutMs / 1000)} seconds.`));
      }, whatsappInitTimeoutMs);

      sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
          try {
            const dataUrl = await qrcode.toDataURL(qr, { margin: 1, width: 320 });
            touch(state, {
              status: 'qr',
              qr: dataUrl,
              message: 'Scan this QR from WhatsApp linked devices',
            });
            finish();
          } catch (error) {
            touch(state, { status: 'error', message: error?.message || 'Failed to generate QR code' });
            fail(error);
          }
        }

        if (connection === 'connecting' && state.status !== 'qr') {
          touch(state, { status: 'initializing', message: 'Connecting to WhatsApp' });
        }

        if (connection === 'open') {
          touch(state, {
            status: 'ready',
            qr: null,
            phone: getConnectedPhone(sock),
            message: 'WhatsApp is ready',
          });
          finish();
        }

        if (connection === 'close') {
          const error = lastDisconnect?.error;
          const shouldReconnect = shouldReconnectAfterClose({ error, DisconnectReason });
          state.sock = null;

          if (!shouldReconnect) {
            touch(state, {
              status: 'logged_out',
              qr: null,
              phone: null,
              message: 'WhatsApp was logged out from the phone. Please connect again.',
            });
            fail(new Error('WhatsApp was logged out. Please scan the QR code again.'));
            return;
          }

          touch(state, {
            status: 'disconnected',
            qr: null,
            message: `${getDisconnectMessage(error)}. Reconnecting saved session...`,
          });
          scheduleReconnect(state);
          fail(new Error(getDisconnectMessage(error)));
        }
      });
    });

    try {
      await startupPromise;
    } catch (error) {
      throw error;
    }
  })();

  try {
    await state.startPromise;
  } catch (error) {
    if (state.status !== 'qr' && state.status !== 'logged_out') {
      touch(state, { status: 'error', qr: null, message: error?.message || 'Failed to start WhatsApp' });
      await destroySocketSafely(state.sock);
      state.sock = null;
    }
  } finally {
    state.startPromise = null;
  }

  return serializeState(state);
}

async function getStatus(gymId) {
  const state = getState(gymId);

  if (state.sock && isStartupStale(state)) {
    const staleMessage =
      state.status === 'qr'
        ? 'WhatsApp QR expired. Starting a fresh QR session.'
        : 'WhatsApp session was stuck while starting. Restarting it now.';
    await destroySocketSafely(state.sock);
    state.sock = null;
    state.startPromise = null;
    touch(state, { status: 'idle', qr: null, message: staleMessage });
  }

  const canRestore =
    autoRestoreSavedSession &&
    !state.sock &&
    !state.startPromise &&
    ['idle', 'disconnected', 'error'].includes(state.status) &&
    hasSavedAuthSession(gymId);

  if (canRestore) {
    touch(state, { status: 'initializing', qr: null, message: 'Restoring saved WhatsApp session' });
    startClient(gymId).catch((error) => {
      touch(state, { status: 'error', qr: null, message: error?.message || 'Failed to restore WhatsApp session' });
      state.sock = null;
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

async function ensureReadyClient(gymId) {
  const state = getState(gymId);
  if ((!state.sock || state.status !== 'ready') && autoRestoreSavedSession && hasSavedAuthSession(gymId)) {
    await startClient(gymId);
  }

  if (!state.sock || state.status !== 'ready') {
    throw new Error('WhatsApp is not connected. Open Connect WhatsApp and scan the QR code once.');
  }

  return state.sock;
}

function getUrlPathname(value) {
  try {
    return new URL(value).pathname;
  } catch {
    return value;
  }
}

function getFileExtension(value) {
  const pathname = getUrlPathname(String(value || '').trim()).toLowerCase();
  const ext = path.extname(pathname).replace('.', '');
  return ext;
}

function getFileName(value, fallback) {
  const pathname = getUrlPathname(String(value || '').trim());
  const name = path.basename(pathname);
  return name && name !== '.' ? name : fallback;
}

function buildMediaMessage(mediaUrl, caption = '') {
  const safeMediaUrl = String(mediaUrl || '').trim();
  const safeCaption = String(caption || '').trim();
  const extension = getFileExtension(safeMediaUrl);

  if (['jpg', 'jpeg', 'png', 'webp'].includes(extension)) {
    return { image: { url: safeMediaUrl }, caption: safeCaption };
  }

  if (['mp4', 'mov', 'm4v', 'webm'].includes(extension)) {
    return { video: { url: safeMediaUrl }, caption: safeCaption };
  }

  if (extension === 'pdf') {
    return {
      document: { url: safeMediaUrl },
      mimetype: 'application/pdf',
      fileName: getFileName(safeMediaUrl, 'document.pdf'),
      caption: safeCaption,
    };
  }

  return {
    document: { url: safeMediaUrl },
    fileName: getFileName(safeMediaUrl, 'attachment'),
    caption: safeCaption,
  };
}

async function sendWhatsappMessage({ gymId, phone, message, mediaUrl }) {
  const sock = await ensureReadyClient(gymId);
  const digits = normalizePhoneForWhatsapp(phone);
  if (!digits) throw new Error('Invalid WhatsApp phone number');

  const text = String(message || '').trim();
  if (!text) throw new Error('Message is empty');

  const jid = `${digits}@s.whatsapp.net`;
  const safeMediaUrl = String(mediaUrl || '').trim();

  if (safeMediaUrl) {
    await sock.sendMessage(jid, buildMediaMessage(safeMediaUrl, text));
    return { phone: digits };
  }

  await sock.sendMessage(jid, { text });
  return { phone: digits };
}

async function sendWhatsappMedia({ gymId, phone, mediaUrl, caption = '' }) {
  const sock = await ensureReadyClient(gymId);
  const digits = normalizePhoneForWhatsapp(phone);
  if (!digits) throw new Error('Invalid WhatsApp phone number');

  const safeMediaUrl = String(mediaUrl || '').trim();
  if (!safeMediaUrl) throw new Error('Media URL is required');

  const jid = `${digits}@s.whatsapp.net`;
  await sock.sendMessage(jid, buildMediaMessage(safeMediaUrl, caption));
  return { phone: digits };
}

async function logoutClient(gymId) {
  const state = getState(gymId);
  clearReconnectTimer(state);

  if (state.sock) {
    try {
      await state.sock.logout();
    } catch (error) {
      if (process.env.NODE_ENV !== 'production') {
        console.warn('WhatsApp logout failed', error?.message || error);
      }
    }
    await destroySocketSafely(state.sock);
  }

  try {
    fs.rmSync(getSessionPath(gymId), { recursive: true, force: true });
  } catch (error) {
    if (process.env.NODE_ENV !== 'production') {
      console.warn('WhatsApp auth cleanup failed', error?.message || error);
    }
  }

  touch(state, { status: 'idle', qr: null, phone: null, message: 'Logged out' });
  state.sock = null;
  state.startPromise = null;
  return serializeState(state);
}

module.exports = {
  getStatus,
  startClient,
  logoutClient,
  sendWhatsappMessage,
  sendWhatsappMedia,
  normalizePhoneForWhatsapp,
};


