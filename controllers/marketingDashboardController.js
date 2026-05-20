const prisma = require('../utils/prisma');
const { getOrCreateReminderSettings } = require('../services/reminderSettingsService');

function addDays(date, days) {
  const d = new Date(date);
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

const getMarketingDashboard = async (req, res) => {
  try {
    const gym_id = req.gym_id;
    const today = new Date();
    const settings = await getOrCreateReminderSettings(gym_id);

    const expiringSoonCutoff = addDays(today, 3);

    const expiringSoon = await prisma.members.count({
      where: {
        gym_id,
        expiry_date: { gte: today, lte: expiringSoonCutoff },
      },
    });

    const expired = await prisma.members.count({
      where: { gym_id, expiry_date: { lt: today } },
    });

    const inactiveCutoff = addDays(today, -settings.inactive_days_threshold);

    const inactiveRows = await prisma.$queryRaw`
      SELECT m.id, MAX(a.checkin_at) AS last_checkin, m.start_date
      FROM "members" m
      LEFT JOIN "attendances" a ON a.member_id = m.id
      WHERE m.gym_id = ${gym_id}
        AND m.expiry_date >= ${today}
      GROUP BY m.id
    `;

    let inactiveCount = 0;
    for (const row of inactiveRows) {
      const last = row.last_checkin || row.start_date;
      if (last && new Date(last) < inactiveCutoff) inactiveCount += 1;
    }

    const trialNotConverted = await prisma.trial_users.count({
      where: { gym_id, status: 'trial' },
    });

    res.json({
      expiringSoon,
      expired,
      inactiveMembers: inactiveCount,
      trialNotConverted,
      inactiveThresholdDays: settings.inactive_days_threshold,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load marketing dashboard', details: process.env.NODE_ENV !== 'production' ? err.message : undefined });
  }
};

module.exports = { getMarketingDashboard };
