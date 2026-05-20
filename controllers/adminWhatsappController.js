const {
  getStatus,
  startClient,
  logoutClient,
} = require('../services/whatsappService');

const getAdminWhatsappStatus = async (req, res) => {
  const status = await getStatus();
  res.json(status);
};

const startAdminWhatsapp = async (req, res) => {
  const status = await startClient();
  res.json(status);
};

const logoutAdminWhatsapp = async (req, res) => {
  const status = await logoutClient();
  res.json(status);
};

module.exports = {
  getAdminWhatsappStatus,
  startAdminWhatsapp,
  logoutAdminWhatsapp,
};
