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
  return message.includes('already') || message.includes('exist');
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

async function getStatus(gymId) {
  try {
    const { baseUrl, apiKey } = getConfig();
    const instanceName = getInstanceName(gymId);
    const data = await request(`${baseUrl}/instance/connectionState/${instanceName}`, {
      method: 'GET',
      headers: getHeaders(apiKey),
    });

    return { state: data?.instance?.state };
  } catch (err) {
    if (err?.status === 404) return { state: 'not_created' };
    return { error: err.message };
  }
}

async function startClient(gymId) {
  try {
    const { baseUrl, apiKey } = getConfig();
    const instanceName = getInstanceName(gymId);

    try {
      await request(`${baseUrl}/instance/create`, {
        method: 'POST',
        headers: getHeaders(apiKey, true),
        body: JSON.stringify({
          instanceName,
          qrcode: true,
          integration: 'WHATSAPP-BAILEYS',
        }),
      });
    } catch (err) {
      if (!isInstanceAlreadyExistsError(err)) throw err;
    }

    const data = await request(`${baseUrl}/instance/connect/${instanceName}`, {
      method: 'GET',
      headers: getHeaders(apiKey),
    });

    return { qrCode: data?.base64, state: 'qr_pending' };
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
    const cleanPhone = cleanPhoneNumber(phone);
    const data = await request(`${baseUrl}/instance/connect/${instanceName}?number=${encodeURIComponent(cleanPhone)}`, {
      method: 'GET',
      headers: getHeaders(apiKey),
    });

    return { pairingCode: data?.pairingCode };
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