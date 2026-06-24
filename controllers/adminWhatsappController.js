const WHATSAPP_DISABLED_RESPONSE = { error: 'WhatsApp integration has been removed' };

const getAdminWhatsappStatus = async (req, res) => {
  // const status = await getStatus();
  res.status(410).json(WHATSAPP_DISABLED_RESPONSE);
};

const startAdminWhatsapp = async (req, res) => {
  // const status = await startClient();
  res.status(410).json(WHATSAPP_DISABLED_RESPONSE);
};

const logoutAdminWhatsapp = async (req, res) => {
  // const status = await logoutClient();
  res.status(410).json(WHATSAPP_DISABLED_RESPONSE);
};

module.exports = {
  getAdminWhatsappStatus,
  startAdminWhatsapp,
  logoutAdminWhatsapp,
};