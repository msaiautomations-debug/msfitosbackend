const WHATSAPP_DISABLED_RESPONSE = { error: 'WhatsApp integration has been removed' };

const getWhatsappStatus = async (req, res) => {
  // const status = await getStatus(req.gym_id);
  res.status(410).json(WHATSAPP_DISABLED_RESPONSE);
};

const startWhatsapp = async (req, res) => {
  // const status = await startClient(req.gym_id);
  res.status(410).json(WHATSAPP_DISABLED_RESPONSE);
};

const logoutWhatsapp = async (req, res) => {
  // const status = await logoutClient(req.gym_id);
  res.status(410).json(WHATSAPP_DISABLED_RESPONSE);
};

const requestWhatsappPairingCode = async (req, res) => {
  // const status = await requestPairingCode(req.gym_id, phone);
  res.status(410).json(WHATSAPP_DISABLED_RESPONSE);
};

const sendTestWhatsapp = async (req, res) => {
  // const result = await sendWhatsappMessage({ gymId: req.gym_id, phone, message, mediaUrl: gym?.logo_url });
  res.status(410).json(WHATSAPP_DISABLED_RESPONSE);
};

const broadcastFitnessTip = async (req, res) => {
  // await sendWhatsappMessage({ gymId: req.gym_id, phone: member.phone, message, mediaUrl: gym?.logo_url });
  res.status(410).json(WHATSAPP_DISABLED_RESPONSE);
};

module.exports = {
  getWhatsappStatus,
  startWhatsapp,
  logoutWhatsapp,
  requestWhatsappPairingCode,
  sendTestWhatsapp,
  broadcastFitnessTip,
};