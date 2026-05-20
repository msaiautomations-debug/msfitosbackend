const prisma = require('../utils/prisma');
const {
  getStatus,
  startClient,
  logoutClient,
  sendWhatsappMessage,
} = require('../services/whatsappService');
const { logGymNotification } = require('../services/notificationService');

const getWhatsappStatus = async (req, res) => {
  const status = await getStatus(req.gym_id);
  res.json(status);
};

const startWhatsapp = async (req, res) => {
  const status = await startClient(req.gym_id);
  res.json(status);
};

const logoutWhatsapp = async (req, res) => {
  const status = await logoutClient(req.gym_id);
  res.json(status);
};

const sendTestWhatsapp = async (req, res) => {
  const phone = String(req.body?.phone || '').trim();
  const message = String(req.body?.message || 'Test message from MSFitOS WhatsApp integration.').trim();

  if (!phone) return res.status(400).json({ error: 'Phone number is required' });

  try {
    const result = await sendWhatsappMessage({ gymId: req.gym_id, phone, message });
    await logGymNotification({
      gym_id: req.gym_id,
      type: 'whatsapp_test',
      message,
      status: 'sent',
    });
    res.json({ sent: true, phone: result.phone });
  } catch (error) {
    await logGymNotification({
      gym_id: req.gym_id,
      type: 'whatsapp_test',
      message: error?.message || 'WhatsApp test failed',
      status: 'failed',
    });
    res.status(400).json({ error: error?.message || 'Failed to send WhatsApp test' });
  }
};

const broadcastFitnessTip = async (req, res) => {
  const tipId = String(req.params.id || '');
  const memberIds = Array.isArray(req.body?.member_ids)
    ? req.body.member_ids.map((id) => String(id)).filter(Boolean)
    : [];

  const tip = await prisma.fitness_tips.findFirst({
    where: { id: tipId, gym_id: req.gym_id },
  });

  if (!tip) return res.status(404).json({ error: 'Tip not found' });

  const members = await prisma.members.findMany({
    where: {
      gym_id: req.gym_id,
      is_inactive: false,
      ...(memberIds.length ? { id: { in: memberIds } } : {}),
    },
    select: { id: true, name: true, phone: true },
    orderBy: { created_at: 'desc' },
  });

  const message = `${tip.title}\n\n${tip.message}`;
  let sent = 0;
  let failed = 0;
  const results = [];

  for (const member of members) {
    try {
      await sendWhatsappMessage({ gymId: req.gym_id, phone: member.phone, message });
      await logGymNotification({
        gym_id: req.gym_id,
        member_id: member.id,
        type: 'fitness_tip_whatsapp',
        message: tip.title,
        status: 'sent',
      });
      sent += 1;
      results.push({ member_id: member.id, member_name: member.name, status: 'sent' });
    } catch (error) {
      const errorMessage = error?.message || 'Failed to send WhatsApp tip';
      await logGymNotification({
        gym_id: req.gym_id,
        member_id: member.id,
        type: 'fitness_tip_whatsapp',
        message: errorMessage,
        status: 'failed',
      });
      failed += 1;
      results.push({ member_id: member.id, member_name: member.name, status: 'failed', error: errorMessage });
    }
  }

  res.json({ sent, failed, results });
};

module.exports = {
  getWhatsappStatus,
  startWhatsapp,
  logoutWhatsapp,
  sendTestWhatsapp,
  broadcastFitnessTip,
};
