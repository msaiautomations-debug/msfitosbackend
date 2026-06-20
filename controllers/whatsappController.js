const prisma = require('../utils/prisma');
const {
  getStatus,
  startClient,
  logoutClient,
  requestPairingCode,
  sendWhatsappMessage,
} = require('../services/evolutionWhatsapp');

function mapEvolutionStateToStatus(state) {
  const normalized = String(state || '').toLowerCase();

  if (normalized === 'open') return 'ready';
  if (normalized === 'connecting') return 'starting';
  if (normalized === 'close' || normalized === 'closed') return 'logged_out';
  if (normalized === 'not_created') return 'logged_out';
  if (normalized === 'qr_pending') return 'qr';

  return normalized || 'unknown';
}

function statusPayload(result) {
  if (result?.error && !result?.state) {
    return { status: 'error', message: result.error };
  }

  const status = mapEvolutionStateToStatus(result?.state);
  return {
    status,
    message: result?.error || null,
    updated_at: new Date().toISOString(),
  };
}

function qrPayload(result) {
  if (result?.error) {
    return { status: 'error', message: result.error };
  }

  if (result?.qrCode) {
    return {
      status: 'qr',
      qr: result.qrCode,
      message: 'Scan this QR code from WhatsApp linked devices.',
      updated_at: new Date().toISOString(),
    };
  }

  if (result?.pairingCode) {
    return {
      status: 'pairing_code',
      message: result.pairingCode,
      updated_at: new Date().toISOString(),
    };
  }

  return {
    status: mapEvolutionStateToStatus(result?.state),
    message: 'WhatsApp session started, but Evolution API did not return a QR code.',
    updated_at: new Date().toISOString(),
  };
}

function pairingPayload(result) {
  if (result?.error) {
    return { status: 'error', message: result.error };
  }

  return {
    status: result?.pairingCode ? 'pairing_code' : 'starting',
    message: result?.pairingCode || 'Pairing code was not returned by Evolution API.',
    updated_at: new Date().toISOString(),
  };
}

async function getGymLogo(gymId) {
  return prisma.gyms.findUnique({
    where: { id: gymId },
    select: { logo_url: true },
  });
}

const getWhatsappStatus = async (req, res) => {
  try {
    const result = await getStatus(req.gym_id);
    res.json(statusPayload(result));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

const startWhatsapp = async (req, res) => {
  try {
    const result = await startClient(req.gym_id);
    res.json(qrPayload(result));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

const logoutWhatsapp = async (req, res) => {
  try {
    const result = await logoutClient(req.gym_id);

    if (result?.error) {
      return res.json({ status: 'error', message: result.error });
    }

    return res.json({ status: 'logged_out', message: 'WhatsApp logged out', updated_at: new Date().toISOString() });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};

const requestWhatsappPairingCode = async (req, res) => {
  try {
    const { phone } = req.body;
    const result = await requestPairingCode(req.gym_id, phone);
    res.json(pairingPayload(result));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

const sendTestWhatsapp = async (req, res) => {
  try {
    const { phone, message } = req.body;
    const gym = await getGymLogo(req.gym_id);
    const result = await sendWhatsappMessage({
      gymId: req.gym_id,
      phone,
      message,
      mediaUrl: gym?.logo_url,
    });

    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

const broadcastFitnessTip = async (req, res) => {
  try {
    const gymId = req.gym_id;
    const { id } = req.params;

    const [gym, tip, members] = await Promise.all([
      getGymLogo(gymId),
      prisma.fitness_tips.findFirst({
        where: { id, gym_id: gymId },
        select: { message: true },
      }),
      prisma.members.findMany({
        where: {
          gym_id: gymId,
          phone: { not: '' },
        },
        select: { phone: true },
      }),
    ]);

    if (!tip) {
      return res.status(404).json({ error: 'Fitness tip not found' });
    }

    for (const member of members) {
      await sendWhatsappMessage({
        gymId,
        phone: member.phone,
        message: tip.message,
        mediaUrl: gym?.logo_url,
      });
    }

    return res.json({ success: true, sentCount: members.length });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};

module.exports = {
  getWhatsappStatus,
  startWhatsapp,
  logoutWhatsapp,
  requestWhatsappPairingCode,
  sendTestWhatsapp,
  broadcastFitnessTip,
};