const prisma = require("../utils/prisma");
const { getOrCreateReminderSettings, AUTOMATIC_REMINDER_ENABLES } = require("../services/reminderSettingsService");

function pickBoolean(value, fallback) {
  if (typeof value === "boolean") return value;
  return fallback;
}

function pickString(value, fallback) {
  if (typeof value === "string") return value;
  return fallback;
}

function pickInt(value, fallback) {
  if (typeof value === "number" && Number.isFinite(value)) return Math.trunc(value);
  return fallback;
}

const getReminderSettings = async (req, res) => {
  try {
    const gym_id = req.gym_id;
    const settings = await getOrCreateReminderSettings(gym_id);
    res.json({ settings });
  } catch (err) {
    console.error(err);
    res.status(500).json({
      error: "Failed to load reminder settings",
      details: process.env.NODE_ENV !== "production" ? err.message : undefined,
    });
  }
};

const updateReminderSettings = async (req, res) => {
  try {
    const gym_id = req.gym_id;
    const existing = await getOrCreateReminderSettings(gym_id);

    const next = {
      reminder_1_days_before: pickInt(req.body.reminder_1_days_before, existing.reminder_1_days_before),
      reminder_2_days_before: pickInt(req.body.reminder_2_days_before, existing.reminder_2_days_before),
      reminder_3_days_before: pickInt(req.body.reminder_3_days_before, existing.reminder_3_days_before),
      reminder_4_days_before: pickInt(req.body.reminder_4_days_before, existing.reminder_4_days_before),
      expiry_email_delay_days: pickInt(req.body.expiry_email_delay_days, existing.expiry_email_delay_days),
      enable_expiry_email: pickBoolean(req.body.enable_expiry_email, existing.enable_expiry_email),
      enable_expiry_whatsapp: pickBoolean(req.body.enable_expiry_whatsapp, existing.enable_expiry_whatsapp),
      enable_owner_daily_summary_email: pickBoolean(
        req.body.enable_owner_daily_summary_email,
        existing.enable_owner_daily_summary_email,
      ),
      enable_owner_daily_summary_whatsapp: pickBoolean(
        req.body.enable_owner_daily_summary_whatsapp,
        existing.enable_owner_daily_summary_whatsapp,
      ),
      enable_expiry_reminder: pickBoolean(req.body.enable_expiry_reminder, existing.enable_expiry_reminder),
      enable_expiry_reminder_email: pickBoolean(
        req.body.enable_expiry_reminder_email,
        existing.enable_expiry_reminder_email,
      ),
      enable_expiry_reminder_whatsapp: pickBoolean(
        req.body.enable_expiry_reminder_whatsapp,
        existing.enable_expiry_reminder_whatsapp,
      ),
      enable_birthday_message: pickBoolean(req.body.enable_birthday_message, existing.enable_birthday_message),
      enable_birthday_email: pickBoolean(req.body.enable_birthday_email, existing.enable_birthday_email),
      enable_birthday_whatsapp: pickBoolean(req.body.enable_birthday_whatsapp, existing.enable_birthday_whatsapp),
      enable_inactive_reminder: pickBoolean(req.body.enable_inactive_reminder, existing.enable_inactive_reminder),
      enable_inactive_email: pickBoolean(req.body.enable_inactive_email, existing.enable_inactive_email),
      enable_inactive_whatsapp: pickBoolean(req.body.enable_inactive_whatsapp, existing.enable_inactive_whatsapp),
      enable_renewal_email: pickBoolean(req.body.enable_renewal_email, existing.enable_renewal_email),
      enable_renewal_whatsapp: pickBoolean(req.body.enable_renewal_whatsapp, existing.enable_renewal_whatsapp),
      inactive_days_threshold: pickInt(req.body.inactive_days_threshold, existing.inactive_days_threshold),
      member_email_send_hour: pickInt(req.body.member_email_send_hour, existing.member_email_send_hour),
      member_email_send_minute: pickInt(req.body.member_email_send_minute, existing.member_email_send_minute),
      email_subject_expiring: pickString(req.body.email_subject_expiring, existing.email_subject_expiring),
      email_body_expiring: pickString(req.body.email_body_expiring, existing.email_body_expiring),
      email_subject_expired: pickString(req.body.email_subject_expired, existing.email_subject_expired),
      email_body_expired: pickString(req.body.email_body_expired, existing.email_body_expired),
      email_subject_birthday: pickString(req.body.email_subject_birthday, existing.email_subject_birthday),
      email_body_birthday: pickString(req.body.email_body_birthday, existing.email_body_birthday),
      email_subject_inactive: pickString(req.body.email_subject_inactive, existing.email_subject_inactive),
      email_body_inactive: pickString(req.body.email_body_inactive, existing.email_body_inactive),
      email_subject_renewal: pickString(req.body.email_subject_renewal, existing.email_subject_renewal),
      email_body_renewal: pickString(req.body.email_body_renewal, existing.email_body_renewal),
      whatsapp_body_expiring: pickString(req.body.whatsapp_body_expiring, existing.whatsapp_body_expiring),
      whatsapp_body_expired: pickString(req.body.whatsapp_body_expired, existing.whatsapp_body_expired),
      whatsapp_body_birthday: pickString(req.body.whatsapp_body_birthday, existing.whatsapp_body_birthday),
      whatsapp_body_inactive: pickString(req.body.whatsapp_body_inactive, existing.whatsapp_body_inactive),
      whatsapp_body_renewal: pickString(req.body.whatsapp_body_renewal, existing.whatsapp_body_renewal),
    };

    if (next.reminder_1_days_before < 0 || next.reminder_2_days_before < 0 || next.reminder_3_days_before < 0 || next.reminder_4_days_before < 0) {
      return res.status(400).json({ error: "Reminder days cannot be negative" });
    }
    if (next.expiry_email_delay_days < 0) {
      return res.status(400).json({ error: "Expiry email delay cannot be negative" });
    }
    if (next.inactive_days_threshold < 1) {
      return res.status(400).json({ error: "Inactive days threshold must be at least 1" });
    }
    if (next.member_email_send_hour < 0 || next.member_email_send_hour > 23) {
      return res.status(400).json({ error: "Member email hour must be between 0 and 23" });
    }
    if (next.member_email_send_minute < 0 || next.member_email_send_minute > 59) {
      return res.status(400).json({ error: "Member email minute must be between 0 and 59" });
    }
    const tooLong =
      next.email_subject_expiring.length > 250 ||
      next.email_body_expiring.length > 4000 ||
      next.email_subject_expired.length > 250 ||
      next.email_body_expired.length > 4000 ||
      next.email_subject_birthday.length > 250 ||
      next.email_body_birthday.length > 4000 ||
      next.email_subject_inactive.length > 250 ||
      next.email_body_inactive.length > 4000 ||
      next.email_subject_renewal.length > 250 ||
      next.email_body_renewal.length > 4000 ||
      next.whatsapp_body_expiring.length > 1000 ||
      next.whatsapp_body_expired.length > 1000 ||
      next.whatsapp_body_birthday.length > 1000 ||
      next.whatsapp_body_inactive.length > 1000 ||
      next.whatsapp_body_renewal.length > 1000;
    if (tooLong) return res.status(400).json({ error: "One or more templates are too long" });

    const settings = await prisma.reminder_settings.update({
      where: { gym_id },
      data: {
        ...next,
        ...AUTOMATIC_REMINDER_ENABLES,
      },
    });

    res.json({ settings });
  } catch (err) {
    console.error(err);
    res.status(500).json({
      error: "Failed to update reminder settings",
      details: process.env.NODE_ENV !== "production" ? err.message : undefined,
    });
  }
};

const testExpiryEmail = async (req, res) => {
  try {
    const gym_id = req.gym_id;
    const { sendTestEmailForGym } = require("../cron/expiryNotifications");
    await sendTestEmailForGym(gym_id);
    res.json({ message: "Test email sent" });
  } catch (err) {
    console.error(err);
    const message = err?.message || "Failed to send test email";
    const status = message === "Owner daily summary emails are disabled for this gym" ? 400 : 500;
    res.status(status).json({
      error: message,
      details: process.env.NODE_ENV !== "production" ? message : undefined,
    });
  }
};

module.exports = { getReminderSettings, updateReminderSettings, testExpiryEmail };
