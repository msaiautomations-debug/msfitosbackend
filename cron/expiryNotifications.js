const cron = require('node-cron');
const prisma = require('../utils/prisma');
const { sendEmail, getEmailConfigIssues } = require('../services/emailService');
const { getOrCreateReminderSettings } = require('../services/reminderSettingsService');
const { runNightlyAggregation } = require('../services/aggregationService');
const { processAllOwnerSummaries } = require('../services/ownerSummaryService');
const { renderMembershipEmail } = require('../services/membershipEmailService');
const { sendWhatsappMessage, getStatus } = require('../services/whatsappService');
const { logGymNotification } = require('../services/notificationService');
const MEMBER_EMAIL_REMINDER_CRON = process.env.MEMBER_EMAIL_REMINDER_CRON || '* * * * *';
const OWNER_DAILY_SUMMARY_CRON = process.env.OWNER_DAILY_SUMMARY_CRON || '0 8 * * *';
let isRunning = false;
let isOwnerSummaryRunning = false;

// ─── Helpers ────────────────────────────────────────────────────────────────

function addDays(date, days) {
  const d = new Date(date);
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

function dayWindowUtc(date) {
  const start = new Date(date);
  start.setUTCHours(0, 0, 0, 0);
  const end = new Date(date);
  end.setUTCHours(23, 59, 59, 999);
  return { start, end };
}

function formatDateForMessage(date) {
  if (!date) return '';
  return new Date(date).toISOString().slice(0, 10);
}

function formatDate(date) {
  if (!date) return '';
  return new Date(date).toISOString().slice(0, 10);
}

function formatCurrency(amount) {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(Number(amount || 0));
}

function shouldRunMemberMessages(now, settings) {
  const hour = Number(settings.member_email_send_hour ?? 10);
  const minute = Number(settings.member_email_send_minute ?? 0);
  return now.getHours() === hour && now.getMinutes() === minute;
}

function renderWhatsappBody(body, { gym, member, lastCheckinDate }) {
  const values = {
    member_name: member?.name || 'Member',
    gym_name: gym?.gym_name || 'Your gym',
    expiry_date: formatDateForMessage(member?.expiry_date),
    amount_due: String(Number(member?.amount || 0)),
    last_checkin_date: lastCheckinDate ? formatDateForMessage(lastCheckinDate) : '',
  };

  return String(body || '')
    .replace(/\{\{\s*(member_name|gym_name|expiry_date|amount_due|last_checkin_date)\s*\}\}/g, (_, key) => values[key] || '')
    .replace(/\{(member_name|gym_name|expiry_date|amount_due|last_checkin_date)\}/g, (_, key) => values[key] || '')
    .trim();
}

// ─── Delivery Helpers ────────────────────────────────────────────────────────

async function sendMemberEmail({ gym, member, subject, body, type }) {
  const rendered = renderMembershipEmail({
    template: { subject, body },
    member,
    gymName: gym.gym_name,
  });

  await sendEmail({
    to: member.email,
    subject: rendered.subject,
    html: rendered.html,
    text: rendered.text,
  });

  await prisma.email_notifications.create({
    data: {
      gym_id: gym.id,
      type,
      status: 'sent',
      subject: rendered.subject,
      payload: {
        member_id: member.id,
        member_name: member.name,
        email: member.email,
      },
    },
  });

  return rendered.subject;
}

async function sendMemberWhatsapp({ gym, member, body, type, lastCheckinDate }) {
  const message = renderWhatsappBody(body, { gym, member, lastCheckinDate });
  await sendWhatsappMessage({ gymId: gym.id, phone: member.phone, message, mediaUrl: gym.logo_url });
  await logGymNotification({
    gym_id: gym.id,
    member_id: member.id,
    type,
    message,
    status: 'sent',
  });
}

async function getDeliveryAvailability(gym) {
  const emailConfigIssues = getEmailConfigIssues();
  let whatsappReady = false;

  try {
    const status = await getStatus(gym.id);
    whatsappReady = status.status === 'ready';
  } catch (error) {
    console.warn('WhatsApp reminder channel unavailable for gym', gym.id, error?.message || error);
  }

  if (emailConfigIssues.length) {
    console.warn('Email reminder channel unavailable:', emailConfigIssues.join(', '));
  }
  if (!whatsappReady) {
    console.warn('WhatsApp reminder channel skipped because the session is not ready for gym', gym.id);
  }

  return {
    emailConfigured: emailConfigIssues.length === 0,
    whatsappReady,
  };
}

// ─── Reminder Processors ────────────────────────────────────────────────────

async function processExpiringReminderEmails({ gym, settings, delivery }) {
  const reminders = [
    { index: 1, days: Number(settings.reminder_1_days_before ?? settings.reminder_1_days ?? 3) },
    { index: 2, days: Number(settings.reminder_2_days_before ?? settings.reminder_2_days ?? 7) },
    { index: 3, days: Number(settings.reminder_3_days_before ?? settings.reminder_3_days ?? 14) },
    { index: 4, days: Number(settings.reminder_4_days_before ?? settings.reminder_4_days ?? 21) },
  ];

  const sendEmailEnabled = settings.enable_expiry_email && delivery.emailConfigured;
  const sendWhatsappEnabled = settings.enable_expiry_whatsapp && delivery.whatsappReady;
  if (!sendEmailEnabled && !sendWhatsappEnabled) return;

  for (const reminder of reminders) {
    const target = addDays(new Date(), reminder.days);
    const { start, end } = dayWindowUtc(target);
    const unsentConditions = [];
    if (sendEmailEnabled) unsentConditions.push({ [`reminder_${reminder.index}_sent`]: false });
    if (sendWhatsappEnabled) unsentConditions.push({ [`whatsapp_reminder_${reminder.index}_sent`]: false });

    const members = await prisma.members.findMany({
      where: {
        gym_id: gym.id,
        is_inactive: false,
        expiry_date: { gte: start, lte: end },
        OR: unsentConditions,
      },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        expiry_date: true,
        amount: true,
        [`reminder_${reminder.index}_sent`]: true,
        [`whatsapp_reminder_${reminder.index}_sent`]: true,
      },
    });

    for (const member of members) {
      const emailAlreadySent = member[`reminder_${reminder.index}_sent`];
      const whatsappAlreadySent = member[`whatsapp_reminder_${reminder.index}_sent`];

      const shouldSendEmail = sendEmailEnabled && !emailAlreadySent && member.email;
      const shouldSendWhatsapp = sendWhatsappEnabled && !whatsappAlreadySent && member.phone;

      if (!shouldSendEmail && !shouldSendWhatsapp) continue;

      let emailSent = false;
      let whatsappSent = false;
      let subject = settings.email_subject_expiring;

      // Send Email
      if (shouldSendEmail) {
        try {
          subject = await sendMemberEmail({
            gym,
            member,
            subject: settings.email_subject_expiring,
            body: settings.email_body_expiring,
            type: `member_expiring_email_reminder_${reminder.index}`,
          });
          emailSent = true;
        } catch (err) {
          const message = err?.message || 'Failed to send expiring reminder email';
          console.error('Expiring reminder email failed', gym.id, member.id, message);
          await prisma.email_notifications.create({
            data: {
              gym_id: gym.id,
              type: `member_expiring_email_reminder_${reminder.index}`,
              status: 'failed',
              subject: settings.email_subject_expiring,
              error_message: message,
              payload: { member_id: member.id, member_name: member.name, email: member.email || null },
            },
          });
          await logGymNotification({
            gym_id: gym.id,
            member_id: member.id,
            type: `member_expiring_email_reminder_${reminder.index}`,
            message,
            status: 'failed',
          });
        }
      }

      // Send WhatsApp
      if (shouldSendWhatsapp) {
        try {
          await sendMemberWhatsapp({
            gym,
            member,
            body: settings.whatsapp_body_expiring,
            type: `member_expiring_whatsapp_reminder_${reminder.index}`,
          });
          whatsappSent = true;
        } catch (err) {
          await logGymNotification({
            gym_id: gym.id,
            member_id: member.id,
            type: `member_expiring_whatsapp_reminder_${reminder.index}`,
            message: err?.message || 'Failed to send expiring reminder WhatsApp',
            status: 'failed',
          });
        }
      }

      // Update flags
      const updateData = {};
      if (emailSent) updateData[`reminder_${reminder.index}_sent`] = true;
      if (whatsappSent) updateData[`whatsapp_reminder_${reminder.index}_sent`] = true;

      if (Object.keys(updateData).length > 0) {
        await prisma.members.update({ where: { id: member.id }, data: updateData });
      }

      if (emailSent) {
        await logGymNotification({
          gym_id: gym.id,
          member_id: member.id,
          type: `member_expiring_email_reminder_${reminder.index}`,
          message: subject,
          status: 'sent',
        });
      }
    }
  }
}

async function processExpiredReminderMessages({ gym, settings, delivery }) {
  const sendEmailEnabled = settings.enable_expiry_email && delivery.emailConfigured;
  const sendWhatsappEnabled = settings.enable_expiry_whatsapp && delivery.whatsappReady;
  if (!sendEmailEnabled && !sendWhatsappEnabled) return;

  const target = addDays(new Date(), -Number(settings.expiry_email_delay_days || 0));
  const { start, end } = dayWindowUtc(target);

  const where = {
    gym_id: gym.id,
    is_inactive: false,
    expiry_date: { gte: start, lte: end },
    ...(!sendWhatsappEnabled ? { expiry_notified: false } : {}),
  };

  const members = await prisma.members.findMany({
    where,
    select: {
      id: true,
      name: true,
      email: true,
      phone: true,
      expiry_date: true,
      amount: true,
      expiry_notified: true,
    },
  });

  for (const member of members) {
    let emailSent = false;
    let whatsappSent = false;
    const whatsappAlreadySent = sendWhatsappEnabled
      ? await prisma.gym_notifications.findFirst({
          where: {
            gym_id: gym.id,
            member_id: member.id,
            type: 'member_expired_whatsapp',
            status: 'sent',
          },
          select: { id: true },
        })
      : null;

    if (sendEmailEnabled && !member.expiry_notified && member.email) {
      try {
        await sendMemberEmail({
          gym,
          member,
          subject: settings.email_subject_expired,
          body: settings.email_body_expired,
          type: 'member_expired_email',
        });
        emailSent = true;
      } catch (err) {
        console.error('Expired reminder email failed', gym.id, member.id, err?.message || err);
        await logGymNotification({
          gym_id: gym.id,
          member_id: member.id,
          type: 'member_expired_email',
          message: err?.message || 'Failed',
          status: 'failed',
        });
      }
    }

    if (sendWhatsappEnabled && !whatsappAlreadySent && member.phone) {
      try {
        await sendMemberWhatsapp({
          gym,
          member,
          body: settings.whatsapp_body_expired,
          type: 'member_expired_whatsapp',
        });
        whatsappSent = true;
      } catch (err) {
        await logGymNotification({
          gym_id: gym.id,
          member_id: member.id,
          type: 'member_expired_whatsapp',
          message: err?.message || 'Failed',
          status: 'failed',
        });
      }
    }

    if (emailSent || whatsappSent) {
      await prisma.members.update({
        where: { id: member.id },
        data: { expiry_notified: true },
      });
    }
  }
}

// ─── Owner Summary ───────────────────────────────────────────────────────────

async function getSummaryRows(gymId) {
  const now = new Date();

  const expiredMembers = await prisma.members.findMany({
    where: {
      gym_id: gymId,
      is_inactive: false,
      expiry_date: { lt: now },
    },
    orderBy: [{ expiry_date: 'asc' }, { created_at: 'desc' }],
    select: {
      name: true,
      phone: true,
      email: true,
      expiry_date: true,
      plan_duration: true,
      amount: true,
    },
  });

  const pendingPayments = await prisma.members.findMany({
    where: {
      gym_id: gymId,
      is_inactive: false,
      amount: { gt: 0 },
      // adjust condition as per your schema
    },
    select: {
      name: true,
      phone: true,
      email: true,
      expiry_date: true,
      plan_duration: true,
      amount: true,
    },
  });

  const mapRow = (member) => ({
    name: member.name,
    phone: member.phone || '-',
    email: member.email || '-',
    expiry: formatDate(member.expiry_date),
    plan: `${member.plan_duration || '-'} days`,
    amount: formatCurrency(member.amount),
  });

  return {
    expiredRows: expiredMembers.map(mapRow),
    pendingRows: pendingPayments.map(mapRow),
  };
}

// ─── Main processGym ────────────────────────────────────────────────────────

async function processGym(gym, now) {
  if (!gym.email_notifications_enabled) return;
  const settings = await getOrCreateReminderSettings(gym.id);
  if (!shouldRunMemberMessages(now, settings)) return;
  const delivery = await getDeliveryAvailability(gym);

  await processExpiringReminderEmails({ gym, settings, delivery });
  await processExpiredReminderMessages({ gym, settings, delivery });
  // await processInactiveReminderEmails({ gym, settings, delivery }); // implement when ready
  // await processBirthdayEmails({ gym, settings, delivery });          // implement when ready
}

// ─── Runner ──────────────────────────────────────────────────────────────────

async function runOnce(now = new Date()) {
  const gyms = await prisma.gyms.findMany({
    select: {
      id: true,
      gym_name: true,
      logo_url: true,
      email: true,
      email_notifications_enabled: true,
    },
  });

  for (const gym of gyms) {
    try {
      await processGym(gym, now);
    } catch (err) {
      console.error('processGym failed for gym', gym.id, err?.message || err);
    }
  }
}

function start() {
  const options = { timezone: process.env.CRON_TIMEZONE || 'Asia/Kolkata' };

  cron.schedule(
    MEMBER_EMAIL_REMINDER_CRON,
    async () => {
      if (isRunning) {
        console.warn('Member email reminder cron skipped because a previous run is still in progress');
        return;
      }

      isRunning = true;
      try {
        await runOnce();
      } catch (err) {
        console.error('Member email reminder cron failed', err);
      } finally {
        isRunning = false;
      }
    },
    options,
  );

  cron.schedule(
    OWNER_DAILY_SUMMARY_CRON,
    async () => {
      if (isOwnerSummaryRunning) {
        console.warn('Owner daily summary cron skipped because a previous run is still in progress');
        return;
      }

      isOwnerSummaryRunning = true;
      try {
        await processAllOwnerSummaries(new Date());
      } catch (err) {
        console.error('Owner daily summary cron failed', err);
      } finally {
        isOwnerSummaryRunning = false;
      }
    },
    options,
  );

  console.log(`Owner daily summary cron scheduled: ${OWNER_DAILY_SUMMARY_CRON} (${options.timezone})`);
}
module.exports = { start, runOnce };

