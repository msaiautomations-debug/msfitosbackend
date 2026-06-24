const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

function getConfig() {
  const baseUrl = String(process.env.EVOLUTION_API_URL || '').replace(/\/+$/, '');
  const apiKey = process.env.EVOLUTION_API_KEY;

  if (!baseUrl) throw new Error('EVOLUTION_API_URL is not configured');
  if (!apiKey) throw new Error('EVOLUTION_API_KEY is not configured');

  return { baseUrl, apiKey };
}

function getInstanceName(gymId) {
  return `gym-${gymId}`;
}

function getHeaders(apiKey, includeJson = false) {
  return {
    apikey: apiKey,
    ...(includeJson ? { 'Content-Type': 'application/json' } : {}),
  };
}

async function readJsonResponse(response) {
  const text = await response.text();
  if (!text) return {};

  try {
    return JSON.parse(text);
  } catch (err) {
    return { raw: text };
  }
}

function getErrorMessage(data, fallback) {
  if (!data) return fallback;
  if (typeof data === 'string') return data;
  if (typeof data.message === 'string') return data.message;
  if (typeof data.error === 'string') return data.error;
  if (Array.isArray(data.message)) return data.message.join(', ');
  return fallback;
}

function isInstanceAlreadyExistsError(error) {
  const message = String(error?.message || '').toLowerCase();
  return error?.status === 403 || message.includes('already') || message.includes('exist');
}

function extractQrCode(data) {
  return (
    data?.base64 ||
    data?.qrcode?.base64 ||
    data?.qrcode?.code ||
    data?.qrcode ||
    data?.code ||
    data?.qr ||
    null
  );
}

function extractPairingCode(data) {
  return data?.pairingCode || data?.pairing_code || data?.qrcode?.pairingCode || null;
}

async function request(url, options = {}) {
  const response = await fetch(url, options);
  const data = await readJsonResponse(response);

  if (!response.ok) {
    const message = getErrorMessage(data, `Evolution API request failed with status ${response.status}`);
    const error = new Error(message);
    error.status = response.status;
    error.data = data;
    throw error;
  }

  return data;
}

function cleanPhoneNumber(phone) {
  const digits = String(phone || '').replace(/\D/g, '');
  if (digits.length === 10) return `91${digits}`;
  return digits;
}

async function createInstance(baseUrl, apiKey, instanceName) {
  return request(`${baseUrl}/instance/create`, {
    method: 'POST',
    headers: getHeaders(apiKey, true),
    body: JSON.stringify({
      instanceName,
      qrcode: true,
      integration: 'WHATSAPP-BAILEYS',
    }),
  });
}

async function connectInstance(baseUrl, apiKey, instanceName, phone) {
  const numberQuery = phone ? `?number=${encodeURIComponent(cleanPhoneNumber(phone))}` : '';
  return request(`${baseUrl}/instance/connect/${instanceName}${numberQuery}`, {
    method: 'GET',
    headers: getHeaders(apiKey),
  });
}

async function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function pollConnectForQr(baseUrl, apiKey, instanceName) {
  let lastResult = null;

  for (let attempt = 0; attempt < 5; attempt += 1) {
    if (attempt > 0) await wait(2000);
    const data = await connectInstance(baseUrl, apiKey, instanceName);
    lastResult = buildStartResult(data);
    if (lastResult.qrCode || lastResult.pairingCode) return lastResult;
  }

  return lastResult;
}

function buildStartResult(data, fallbackState = 'qr_pending') {
  return {
    qrCode: extractQrCode(data),
    pairingCode: extractPairingCode(data),
    state: fallbackState,
    response: data,
  };
}

async function getStatus(gymId) {
  try {
    const { baseUrl, apiKey } = getConfig();
    const instanceName = getInstanceName(gymId);
    const data = await request(`${baseUrl}/instance/connectionState/${instanceName}`, {
      method: 'GET',
      headers: getHeaders(apiKey),
    });

    return { state: data?.instance?.state || data?.state || 'unknown', response: data };
  } catch (err) {
    if (err?.status === 404 || err?.status === 400 || err?.status === 403) {
      return { state: 'not_created', error: err.message };
    }
    return { error: err.message };
  }
}

async function startClient(gymId) {
  try {
    const { baseUrl, apiKey } = getConfig();
    const instanceName = getInstanceName(gymId);
    let createData = null;

    try {
      createData = await createInstance(baseUrl, apiKey, instanceName);
      const createResult = buildStartResult(createData);
      if (createResult.qrCode || createResult.pairingCode) return createResult;
    } catch (err) {
      if (!isInstanceAlreadyExistsError(err)) throw err;
    }

    const connectResult = await pollConnectForQr(baseUrl, apiKey, instanceName);
    if (connectResult.qrCode || connectResult.pairingCode) return connectResult;

    return {
      ...connectResult,
      error: 'Evolution API did not return a QR code. /instance/connect returned count: 0 instead of base64.',
    };
  } catch (err) {
    return { error: err.message };
  }
}

async function logoutClient(gymId) {
  try {
    const { baseUrl, apiKey } = getConfig();
    const instanceName = getInstanceName(gymId);

    await request(`${baseUrl}/instance/logout/${instanceName}`, {
      method: 'DELETE',
      headers: getHeaders(apiKey),
    });

    return { success: true };
  } catch (err) {
    return { error: err.message };
  }
}

async function requestPairingCode(gymId, phone) {
  try {
    const { baseUrl, apiKey } = getConfig();
    const instanceName = getInstanceName(gymId);
    const data = await connectInstance(baseUrl, apiKey, instanceName, phone);

    return { pairingCode: extractPairingCode(data), response: data };
  } catch (err) {
    return { error: err.message };
  }
}

async function sendWhatsappMessage({ gymId, phone, message, mediaUrl }) {
  try {
    const { baseUrl, apiKey } = getConfig();
    const instanceName = getInstanceName(gymId);
    const cleanPhone = cleanPhoneNumber(phone);
    const hasMedia = Boolean(mediaUrl);
    const endpoint = hasMedia ? 'sendMedia' : 'sendText';
    const body = hasMedia
      ? { number: cleanPhone, mediatype: 'image', media: mediaUrl, caption: message }
      : { number: cleanPhone, text: message };

    const data = await request(`${baseUrl}/message/${endpoint}/${instanceName}`, {
      method: 'POST',
      headers: getHeaders(apiKey, true),
      body: JSON.stringify(body),
    });

    return { success: true, response: data };
  } catch (err) {
    return { error: err.message };
  }
}

module.exports = {
  getStatus,
  startClient,
  logoutClient,
  requestPairingCode,
  sendWhatsappMessage,
};