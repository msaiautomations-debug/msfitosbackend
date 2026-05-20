const prisma = require("../utils/prisma");

async function logGymNotification({ gym_id, member_id = null, type, message, status = "sent" }) {
  return prisma.gym_notifications.create({
    data: {
      gym_id,
      member_id,
      type,
      message,
      status,
    },
  });
}

async function hasSentBirthdayToday({ gym_id, member_id }) {
  return hasSentGymNotificationToday({ gym_id, member_id, type: "birthday" });
}

async function hasSentGymNotificationToday({ gym_id, member_id, type }) {
  const start = new Date();
  start.setUTCHours(0, 0, 0, 0);
  const end = new Date();
  end.setUTCHours(23, 59, 59, 999);

  const existing = await prisma.gym_notifications.findFirst({
    where: {
      gym_id,
      member_id,
      type,
      status: "sent",
      sent_at: { gte: start, lte: end },
    },
    select: { id: true },
  });

  return Boolean(existing);
}

module.exports = { logGymNotification, hasSentBirthdayToday, hasSentGymNotificationToday };
