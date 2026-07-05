const { getStatus, startClient, logoutClient } = require('../services/whatsappService');

const getAdminWhatsappStatus = async (req, res) => {
  try {
    const status = await getStatus();
    res.json(status);
  } catch (err) {
    res.status(500).json({ error: err?.message || 'Failed to get WhatsApp status' });
  }
};

const startAdminWhatsapp = async (req, res) => {
  try {
    const status = await startClient();
    res.json(status);
  } catch (err) {
    res.status(500).json({ error: err?.message || 'Failed to start WhatsApp' });
  }
};

const logoutAdminWhatsapp = async (req, res) => {
  try {
    const status = await logoutClient();
    res.json(status);
  } catch (err) {
    res.status(500).json({ error: err?.message || 'Failed to logout WhatsApp' });
  }
};

module.exports = {
  getAdminWhatsappStatus,
  startAdminWhatsapp,
  logoutAdminWhatsapp,
};
