const prisma = require("../utils/prisma");

const AUTOMATIC_REMINDER_ENABLES = {
  enable_expiry_email: true,
  enable_expiry_whatsapp: true,
  enable_owner_daily_summary_email: true,
  enable_owner_daily_summary_whatsapp: true,
  enable_expiry_reminder: true,
  enable_expiry_reminder_email: true,
  enable_expiry_reminder_whatsapp: true,
  enable_birthday_message: true,
  enable_birthday_email: true,
  enable_birthday_whatsapp: true,
  enable_inactive_reminder: true,
  enable_inactive_email: true,
  enable_inactive_whatsapp: true,
  enable_renewal_email: true,
  enable_renewal_whatsapp: true,
};

const DEFAULT_REMINDER_SETTINGS = {
  expiry_email_delay_days: 0,
  reminder_1_days_before: 3,
  reminder_2_days_before: 7,
  reminder_3_days_before: 14,
  reminder_4_days_before: 21,
  inactive_days_threshold: 14,
  member_email_send_hour: 10,
  member_email_send_minute: 0,
  email_subject_expiring: "Your membership at {gym_name} expires on {expiry_date}",
  email_body_expiring:
    "Hi {member_name},\n\nThis is a reminder from {gym_name} that your membership will expire on {expiry_date}.\n\nAmount due: {amount_due}\n\nPlease renew before the expiry date to continue uninterrupted access.\n\nThanks,\n{gym_name}",
  email_subject_expired: "Your membership at {gym_name} has expired",
  email_body_expired:
    "Hi {member_name},\n\nYour membership at {gym_name} expired on {expiry_date}.\n\nAmount due: {amount_due}\n\nPlease renew to reactivate your access.\n\nThanks,\n{gym_name}",
  email_subject_birthday: "Happy Birthday from {gym_name}!",
  email_body_birthday:
    "Hi {member_name},\n\nHappy Birthday from everyone at {gym_name}.\n\nWishing you a strong, healthy, and successful year ahead.\n\nThanks,\n{gym_name}",
  email_subject_inactive: "We miss you at {gym_name}",
  email_body_inactive:
    "Hi {member_name},\n\nWe haven't seen you at {gym_name} recently.\n\nCome back this week and keep your progress going.\n\nThanks,\n{gym_name}",
  email_subject_renewal: "Your membership at {gym_name} has been renewed",
  email_body_renewal:
    "Hi {member_name},\n\nYour membership at {gym_name} has been renewed successfully.\n\nNew expiry: {expiry_date}\nAmount paid: {amount_due}\n\nThanks,\n{gym_name}",
  whatsapp_body_expiring:
    "Hi {member_name}, your membership at {gym_name} will expire on {expiry_date}. Amount due: {amount_due}. Please renew before expiry.",
  whatsapp_body_expired:
    "Hi {member_name}, your membership at {gym_name} expired on {expiry_date}. Amount due: {amount_due}. Please renew to reactivate your access.",
  whatsapp_body_birthday:
    "Happy Birthday {member_name}! Everyone at {gym_name} wishes you a strong, healthy, and successful year ahead.",
  whatsapp_body_inactive:
    "Hi {member_name}, we haven't seen you at {gym_name} recently. Come back this week and keep your progress going.",
  whatsapp_body_renewal:
    "Hi {member_name}, your membership at {gym_name} has been renewed successfully. New expiry: {expiry_date}. Amount paid: {amount_due}. Thank you.",
};

function buildMissingAutomaticEnablePatch(settings) {
  return Object.fromEntries(
    Object.entries(AUTOMATIC_REMINDER_ENABLES).filter(([key, value]) => settings?.[key] !== value),
  );
}

function applyAutomaticReminderEnables(settings) {
  return {
    ...DEFAULT_REMINDER_SETTINGS,
    ...settings,
    ...AUTOMATIC_REMINDER_ENABLES,
  };
}

async function repairAutomaticReminderEnables(gym_id, settings) {
  const patch = buildMissingAutomaticEnablePatch(settings);
  if (!Object.keys(patch).length) return settings;

  try {
    return await prisma.reminder_settings.update({
      where: { gym_id },
      data: patch,
    });
  } catch (error) {
    console.warn("Unable to persist automatic reminder enable defaults", {
      gym_id,
      error: error?.message || error,
    });
    return settings;
  }
}

async function getOrCreateReminderSettings(gym_id) {
  let existing = null;
  try {
    existing = await prisma.reminder_settings.findUnique({ where: { gym_id } });
  } catch (error) {
    console.warn("Unable to load reminder settings from database; returning defaults", {
      gym_id,
      error: error?.message || error,
    });
    return applyAutomaticReminderEnables({ gym_id });
  }

  if (existing) {
    const repaired = await repairAutomaticReminderEnables(gym_id, existing);
    return applyAutomaticReminderEnables(repaired);
  }

  try {
    const created = await prisma.reminder_settings.create({
      data: {
        gym_id,
        ...AUTOMATIC_REMINDER_ENABLES,
      },
    });
    return applyAutomaticReminderEnables(created);
  } catch (error) {
    console.warn("Unable to create reminder settings with automatic enable defaults", {
      gym_id,
      error: error?.message || error,
    });
    return applyAutomaticReminderEnables({ gym_id });
  }
}

module.exports = {
  getOrCreateReminderSettings,
  AUTOMATIC_REMINDER_ENABLES,
  DEFAULT_REMINDER_SETTINGS,
  applyAutomaticReminderEnables,
};

