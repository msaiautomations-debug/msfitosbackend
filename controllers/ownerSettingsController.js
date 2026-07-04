const prisma = require('../utils/prisma');
const { getStatus, startClient, logoutClient, requestPairingCode } = require('../services/evolutionWhatsapp');

function ownerSessionKey(ownerId) {
  return `owner_${ownerId}`;
}

const getOwnerSettings = async (req, res) => {
  try {
    res.json({
      owner: {
        id: req.owner.id,
        name: req.owner.name,
        email: req.owner.email,
        phone: req.owner.phone,
        whatsapp_number: req.owner.whatsapp_number,
        whatsapp_verified: req.owner.whatsapp_verified,
        expiring_soon_days: req.owner.expiring_soon_days,
      },
    });
  } catch (err) {
    console.error('Get owner settings error', err);
    res.status(500).json({ error: 'Failed to load settings' });
  }
};

const updateExpiringSoonDays = async (req, res) => {
  try {
    const { days } = req.body;
    const parsedDays = Number(days);

    if (![7, 30].includes(parsedDays)) {
      return res.status(400).json({ error: 'Expiring soon days must be 7 or 30' });
    }

    await prisma.owners.update({
      where: { id: req.owner_id },
      data: { expiring_soon_days: parsedDays },
    });

    res.json({ message: `Expiring soon window updated to ${parsedDays} days` });
  } catch (err) {
    console.error('Update expiring soon days error', err);
    res.status(500).json({ error: 'Failed to update settings' });
  }
};

const getOwnerWhatsappStatus = async (req, res) => {
  try {
    const sessionKey = ownerSessionKey(req.owner_id);
    const status = await getStatus(sessionKey);

    if (status.status === 'ready' && status.phone && !req.owner.whatsapp_verified) {
      await prisma.owners.update({
        where: { id: req.owner_id },
        data: {
          whatsapp_number: status.phone,
          whatsapp_verified: true,
        },
      });
    }

    res.json(status);
  } catch (err) {
    console.error('Get owner whatsapp status error', err);
    res.status(500).json({ error: 'Failed to get WhatsApp status' });
  }
};

const startOwnerWhatsapp = async (req, res) => {
  try {
    const sessionKey = ownerSessionKey(req.owner_id);
    const result = await startClient(sessionKey);

    if (result.state === 'open' && result.phone) {
      await prisma.owners.update({
        where: { id: req.owner_id },
        data: {
          whatsapp_number: result.phone,
          whatsapp_verified: true,
        },
      });
    }

    res.json(result);
  } catch (err) {
    console.error('Start owner whatsapp error', err);
    res.status(500).json({ error: err?.message || 'Failed to start WhatsApp session' });
  }
};

const requestOwnerPairingCode = async (req, res) => {
  try {
    const { phone } = req.body;
    if (!phone) {
      return res.status(400).json({ error: 'Phone number is required' });
    }

    const sessionKey = ownerSessionKey(req.owner_id);
    const result = await requestPairingCode(sessionKey, phone);

    if (result.error) {
      return res.status(500).json({ error: result.error });
    }

    await prisma.owners.update({
      where: { id: req.owner_id },
      data: {
        whatsapp_number: result.phone || phone,
        whatsapp_verified: result.status === 'ready',
      },
    });

    res.json(result);
  } catch (err) {
    console.error('Request owner pairing code error', err);
    res.status(500).json({ error: err?.message || 'Failed to request pairing code' });
  }
};

const logoutOwnerWhatsapp = async (req, res) => {
  try {
    const sessionKey = ownerSessionKey(req.owner_id);
    const result = await logoutClient(sessionKey);

    await prisma.owners.update({
      where: { id: req.owner_id },
      data: {
        whatsapp_number: null,
        whatsapp_verified: false,
      },
    });

    res.json(result);
  } catch (err) {
    console.error('Logout owner whatsapp error', err);
    res.status(500).json({ error: err?.message || 'Failed to disconnect WhatsApp' });
  }
};

const testOwnerSummaryWhatsapp = async (req, res) => {
  try {
    const { sendTestOwnerSummary } = require('../services/ownerSummaryService');
    await sendTestOwnerSummary(req.owner_id);
    res.json({ message: 'Test owner summary WhatsApp sent' });
  } catch (err) {
    console.error('Test owner summary WhatsApp error', err);
    const message = err?.message || 'Failed to send test owner summary';
    const status = message.includes('not verified') || message.includes('WhatsApp not') ? 400 : 500;
    res.status(status).json({ error: message });
  }
};

module.exports = {
  getOwnerSettings,
  updateExpiringSoonDays,
  getOwnerWhatsappStatus,
  startOwnerWhatsapp,
  requestOwnerPairingCode,
  logoutOwnerWhatsapp,
  testOwnerSummaryWhatsapp,
};
