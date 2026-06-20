require('dotenv').config();

const INSTANCE_NAME = 'test-fix-check';

function getConfig() {
  const baseUrl = String(process.env.EVOLUTION_API_URL || '').replace(/\/+$/, '');
  const apiKey = process.env.EVOLUTION_API_KEY;

  if (!baseUrl) {
    throw new Error('EVOLUTION_API_URL is missing. Add it to .env.');
  }

  if (!apiKey) {
    throw new Error('EVOLUTION_API_KEY is missing. Add it to .env.');
  }

  return { baseUrl, apiKey };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function readResponse(response) {
  const text = await response.text();
  if (!text) return {};

  try {
    return JSON.parse(text);
  } catch (err) {
    return { raw: text };
  }
}

async function requestJson(url, options) {
  const response = await fetch(url, options);
  const data = await readResponse(response);

  if (!response.ok) {
    const error = new Error(`HTTP ${response.status} ${response.statusText}`);
    error.status = response.status;
    error.data = data;
    throw error;
  }

  return data;
}

async function main() {
  try {
    const { baseUrl, apiKey } = getConfig();
    const headers = { apikey: apiKey };

    console.log('Evolution API QR test');
    console.log(`Base URL: ${baseUrl}`);
    console.log(`Instance: ${INSTANCE_NAME}`);

    console.log('\n1. Deleting existing test instance if it exists...');
    try {
      const deleteResponse = await requestJson(`${baseUrl}/instance/delete/${INSTANCE_NAME}`, {
        method: 'DELETE',
        headers,
      });
      console.log('Delete response:', JSON.stringify(deleteResponse, null, 2));
    } catch (err) {
      console.log(`Delete skipped/ignored: ${err.message}`);
      if (err.data) console.log('Delete error body:', JSON.stringify(err.data, null, 2));
    }

    console.log('\n2. Creating test instance with qrcode=true...');
    const createResponse = await requestJson(`${baseUrl}/instance/create`, {
      method: 'POST',
      headers: {
        ...headers,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        instanceName: INSTANCE_NAME,
        qrcode: true,
        integration: 'WHATSAPP-BAILEYS',
      }),
    });
    console.log('Create response:', JSON.stringify(createResponse, null, 2));

    console.log('\n3. Waiting 10 seconds for QR generation...');
    await sleep(10000);

    console.log('\n4. Connecting instance and checking QR response...');
    const connectResponse = await requestJson(`${baseUrl}/instance/connect/${INSTANCE_NAME}`, {
      method: 'GET',
      headers,
    });
    console.log('Connect response:', JSON.stringify(connectResponse, null, 2));

    if (connectResponse?.base64 && String(connectResponse.base64).trim()) {
      console.log('\nSUCCESS: QR code generated!');
      console.log(`Base64 length: ${String(connectResponse.base64).length}`);
      return;
    }

    console.log('\nFAILED: No QR code in response');
    console.log(JSON.stringify(connectResponse, null, 2));
  } catch (err) {
    console.error('\nERROR: Evolution QR test failed');
    console.error(err.message);
    if (err.data) {
      console.error('Error response body:', JSON.stringify(err.data, null, 2));
    }
    process.exitCode = 1;
  }
}

main();
