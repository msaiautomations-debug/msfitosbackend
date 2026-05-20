const prisma = require("../utils/prisma");

async function getOrCreateReminderSettings(gym_id) {
  const existing = await prisma.reminder_settings.findUnique({ where: { gym_id } });
  if (existing) return existing;

  return prisma.reminder_settings.create({ data: { gym_id } });
}

module.exports = { getOrCreateReminderSettings };

