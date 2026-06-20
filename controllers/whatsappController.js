const prisma = require('../utils/prisma');
const {
  getStatus,
  startClient,
  logoutClient,
  requestPairingCode,
  sendWhatsappMessage,
} = require('../services/evolutionWhatsapp');

async function getGymLogo(gymId) {
  return prisma.gyms.findUnique({
    where: { id: gymId },
    select: { logo_url: true },
  });
}

const getWhatsappStatus = async (req, res) => {
  try {
    const result = await getStatus(req.gym_id);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

const startWhatsapp = async (req, res) => {
  try {
    const result = await startClient(req.gym_id);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

const logoutWhatsapp = async (req, res) => {
  try {
    const result = await logoutClient(req.gym_id);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

const requestWhatsappPairingCode = async (req, res) => {
  try {
    const { phone } = req.body;
    const result = await requestPairingCode(req.gym_id, phone);
    res.json(result);
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