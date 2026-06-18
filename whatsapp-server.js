require('dotenv').config();

const express = require('express');
const cors = require('cors');
const {
  createInstance,
  getQR,
  getStatus,
  sendTextMessage,
  disconnectInstance,
} = require('./services/whatsappService');

const app = express();
const PORT = process.env.WA_PORT || 3001;

app.use(cors());
app.use(express.json());

app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.post('/instance/create', (req, res) => {
  try {
    const { instanceName } = req.body || {};
    if (!instanceName) {
      return res.status(400).json({ error: 'instanceName is required' });
    }

    createInstance(instanceName).catch((error) => {
      console.error('Failed to create WhatsApp instance', {
        instanceName,
        error: error?.message || error,
      });
    });

    return res.json({ success: true, instanceName });
  } catch (error) {
    return res.status(500).json({ error: error?.message || 'Failed to create instance' });
  }
});

app.get('/instance/:name/qr', (req, res) => {
  try {
    const qr = getQR(req.params.name);
    if (!qr) {
      return res.status(404).json({ error: 'QR not ready, wait 3 seconds and retry' });
    }

    return res.json({ qr });
  } catch (error) {
    return res.status(500).json({ error: error?.message || 'Failed to get QR' });
  }
});

app.get('/instance/:name/status', (req, res) => {
  try {
    const status = getStatus(req.params.name);
    return res.json({ status });
  } catch (error) {
    return res.status(500).json({ error: error?.message || 'Failed to get status' });
  }
});

app.post('/send', async (req, res) => {
  try {
    const { instanceName, phone, message } = req.body || {};
    if (!instanceName || !phone || !message) {
      return res.status(400).json({ error: 'instanceName, phone, and message are required' });
    }

    await sendTextMessage(instanceName, phone, message);
    return res.json({ success: true });
  } catch (error) {
    return res.status(500).json({ error: error?.message || 'Failed to send message' });
  }
});

app.delete('/instance/:name', async (req, res) => {
  try {
    await disconnectInstance(req.params.name);
    return res.json({ success: true });
  } catch (error) {
    return res.status(500).json({ error: error?.message || 'Failed to disconnect instance' });
  }
});

app.listen(PORT, () => {
  console.log(`WhatsApp server listening on port ${PORT}`);
});
