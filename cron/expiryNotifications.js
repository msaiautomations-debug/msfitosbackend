const cron = require('node-cron');
const prisma = require('../utils/prisma');
const { sendEmail, getEmailConfigIssues } = require('../services/emailService');
const { getOrCreateReminderSettings } = require('../services/reminderSettingsService');
const { runNightlyAggregation } = require('../services/aggregationService');
const { processAllOwnerSummaries } = require('../services/ownerSummaryService');

const MEMBER_EMAIL_REMINDER_CRON = process.env.MEMBER_EMAIL_REMINDER_CRON || '* * * * *';
let isRunning = false;

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

function formatDateForMessage(date) {
  if (!date) return '';
  return new Date(date).toISOString().slice(0, 10);
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

function shouldRunMemberMessages(now, settings) {
  const hour = Number(settings.member_email_send_hour ?? 10);
  const minute = Number(settings.member_email_send_minute ?? 0);
  return now.getHours() === hour && now.getMinutes() === minute;
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

function formatCurrency(amount) {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(Number(amount || 0));
}

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

    for (const member of members) {
      const emailAlreadySent = member[`reminder_${reminder.index}_sent`];
      const whatsappAlreadySent = member[`whatsapp_reminder_${reminder.index}_sent`];

      const shouldSendEmail = sendEmailEnabled && !emailAlreadySent && member.email;
      const shouldSendWhatsapp = sendWhatsappEnabled && !whatsappAlreadySent && member.phone;

      if (!shouldSendEmail && !shouldSendWhatsapp) continue;

      let emailSent = false;
      let whatsappSent = false;
      let subject = settings.email_subject_expiring;

      // --- Send Email ---
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

      // --- Send WhatsApp ---
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

      // --- Update flags independently ---
      const updateData = {};
      if (emailSent) updateData[`reminder_${reminder.index}_sent`] = true;
      if (whatsappSent) updateData[`whatsapp_reminder_${reminder.index}_sent`] = true;

      if (Object.keys(updateData).length > 0) {
        await prisma.members.update({
          where: { id: member.id },
          data: updateData,
        });
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

  const members = await prisma.members.findMany({
    where: {
      gym_id: gym.id,
      is_inactive: false,
      expiry_date: { gte: start, lte: end },
      expiry_notified: false,
    },
    select: {
      id: true,
      name: true,
      email: true,
      phone: true,
      expiry_date: true,
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

async function processGym(gym, now, { force = false } = {}) {
  if (!gym.email_notifications_enabled) return { sent: false, reason: 'notifications-disabled' };

  const settings = await getOrCreateReminderSettings(gym.id);
  const emailEnabled = Boolean(settings.enable_owner_daily_summary_email && gym.email);
  if (!force && !emailEnabled) {
    return { sent: false, reason: 'summary-disabled' };
  }

  const { expiredRows, pendingRows } = await getSummaryRows(gym.id);
  if (!force && !expiredRows.length && !pendingRows.length) {
    return { sent: false, reason: 'empty-summary' };
  }

  const subject = `Daily owner summary - ${gym.gym_name} - ${formatDate(now)}`;
  const html = buildEmailHtml({ gymName: gym.gym_name, expiredRows, pendingRows, now });
  const text = [
    `Daily Owner Summary for ${gym.gym_name}`,
    `Date: ${formatDate(now)}`,
    `Expired memberships: ${expiredRows.length}`,
    `Pending payments: ${pendingRows.length}`,
    '',
    buildTextSection('Expired Members', expiredRows),
    '',
    buildTextSection('Pending Payments', pendingRows),
  ].join('\n');

  let sentAny = false;

  try {
    if (emailEnabled || force) {
      if (!gym.email) throw new Error('Gym email not found');
      await sendEmail({ to: gym.email, subject, html, text });
      await prisma.email_notifications.create({
        data: {
          gym_id: gym.id,
          member_id: member.id,
          type: 'member_expired_email',
          message: subject,
          status: 'sent',
          subject,
          payload: {
            expired_members: expiredRows.length,
            pending_payments: pendingRows.length,
          },
        },
      });
      sentAny = true;
    }
  } catch (err) {
    console.error('Owner daily summary email failed for gym', gym.id, err?.message || err);
    await prisma.email_notifications.create({
      data: {
        gym_id: gym.id,
        type: force ? 'owner_daily_summary_test' : 'owner_daily_summary',
        status: 'failed',
        subject,
        payload: {
          expired_members: expiredRows.length,
          pending_payments: pendingRows.length,
        },
        error_message: err?.message || String(err),
        retry_count: 1,
      },
    });
  }

    // --- Send WhatsApp ---
    if (sendWhatsappEnabled && member.phone) {
      try {
        await sendMemberWhatsapp({
          gym,
          member,
          body: settings.whatsapp_body_birthday || settings.message_birthday,
          type: 'birthday_whatsapp',
        });
      } catch (err) {
        await logGymNotification({
          gym_id: gym.id,
          member_id: member.id,
          type: 'birthday_whatsapp',
          message: err?.message || 'Failed to send birthday WhatsApp',
          status: 'failed',
        });
      }
    }
  }
}

async function processGym(gym, now) {
  if (!gym.email_notifications_enabled) return;
  const settings = await getOrCreateReminderSettings(gym.id);
  if (!shouldRunMemberMessages(now, settings)) return;
  const delivery = await getDeliveryAvailability(gym);

  await processExpiringReminderEmails({ gym, settings, delivery });
  await processExpiredReminderMessages({ gym, settings, delivery });
  await processInactiveReminderEmails({ gym, settings, delivery });
  await processBirthdayEmails({ gym, settings, delivery });
}

async function runOnce(now = new Date()) {
  const gyms = await prisma.gyms.findMany({
    select: {
      id: true,
      gym_name: true,
      logo_url: true,
      email_notifications_enabled: true,
    },
  });

  for (const gym of gyms) {
    await processGym(gym, now);
  }
}

function start() {
  const options = {};
  if (process.env.CRON_TIMEZONE) options.timezone = process.env.CRON_TIMEZONE;

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
}

module.exports = { start, runOnce };