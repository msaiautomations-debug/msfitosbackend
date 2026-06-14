const cron = require('node-cron');
const prisma = require('../utils/prisma');
const { sendEmail, getEmailConfigIssues } = require('../services/emailService');
const { getOrCreateReminderSettings } = require('../services/reminderSettingsService');
const { renderMembershipEmail } = require('../services/membershipEmailService');
const { logGymNotification, hasSentGymNotificationToday } = require('../services/notificationService');
const { getStatus, sendWhatsappMessage } = require('../services/whatsappService');

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

async function processExpiringReminderEmails({ gym, settings, delivery }) {
  const sendEmailEnabled = settings.enable_expiry_reminder && settings.enable_expiry_reminder_email && delivery.emailConfigured;
  const sendWhatsappEnabled = settings.enable_expiry_reminder && settings.enable_expiry_reminder_whatsapp && delivery.whatsappReady;
  if (!sendEmailEnabled && !sendWhatsappEnabled) return;

  const reminders = [
    { index: 1, days: settings.reminder_1_days_before },
    { index: 2, days: settings.reminder_2_days_before },
    { index: 3, days: settings.reminder_3_days_before },
    { index: 4, days: settings.reminder_4_days_before },
  ];

  for (const reminder of reminders) {
    const target = addDays(new Date(), Number(reminder.days || 0));
    const { start, end } = dayWindowUtc(target);

    const members = await prisma.members.findMany({
      where: {
        gym_id: gym.id,
        is_inactive: false,
        expiry_date: { gte: start, lte: end },
        [`reminder_${reminder.index}_sent`]: false,
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

    for (const member of members) {
      let delivered = false;

      try {
        let subject = settings.email_subject_expiring;
        if (sendEmailEnabled && member.email) {
          subject = await sendMemberEmail({
            gym,
            member,
            subject: settings.email_subject_expiring,
            body: settings.email_body_expiring,
            type: `member_expiring_email_reminder_${reminder.index}`,
          });
          delivered = true;
        }

        if (sendWhatsappEnabled) {
          try {
            await sendMemberWhatsapp({
              gym,
              member,
              body: settings.whatsapp_body_expiring,
              type: `member_expiring_whatsapp_reminder_${reminder.index}`,
            });
            delivered = true;
          } catch (whatsappErr) {
            await logGymNotification({
              gym_id: gym.id,
              member_id: member.id,
              type: `member_expiring_whatsapp_reminder_${reminder.index}`,
              message: whatsappErr?.message || 'Failed to send expiring reminder WhatsApp',
              status: 'failed',
            });
          }
        }

        if (!delivered) continue;

        await prisma.members.update({
          where: { id: member.id },
          data: { [`reminder_${reminder.index}_sent`]: true },
        });

        await logGymNotification({
          gym_id: gym.id,
          member_id: member.id,
          type: `member_expiring_email_reminder_${reminder.index}`,
          message: subject,
          status: 'sent',
        });
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
            payload: {
              member_id: member.id,
              member_name: member.name,
              email: member.email || null,
            },
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

  for (const member of members) {
    let delivered = false;

    try {
      let subject = settings.email_subject_expired;
      if (sendEmailEnabled && member.email) {
        subject = await sendMemberEmail({
          gym,
          member,
          subject: settings.email_subject_expired,
          body: settings.email_body_expired,
          type: 'member_expired_email',
        });
        delivered = true;
      }

      if (sendWhatsappEnabled) {
        try {
          await sendMemberWhatsapp({
            gym,
            member,
            body: settings.whatsapp_body_expired,
            type: 'member_expired_whatsapp',
          });
          delivered = true;
        } catch (whatsappErr) {
          await logGymNotification({
            gym_id: gym.id,
            member_id: member.id,
            type: 'member_expired_whatsapp',
            message: whatsappErr?.message || 'Failed to send expired reminder WhatsApp',
            status: 'failed',
          });
        }
      }

      if (!delivered) continue;

      await prisma.members.update({
        where: { id: member.id },
        data: { expiry_notified: true },
      });

      if (sendEmailEnabled) {
        await logGymNotification({
          gym_id: gym.id,
          member_id: member.id,
          type: 'member_expired_email',
          message: subject,
          status: member.email ? 'sent' : 'skipped',
        });
      }
    } catch (err) {
      const message = err?.message || 'Failed to send expired reminder email';
      console.error('Expired reminder email failed', gym.id, member.id, message);
      await prisma.email_notifications.create({
        data: {
          gym_id: gym.id,
          type: 'member_expired_email',
          status: 'failed',
          subject: settings.email_subject_expired,
          error_message: message,
          payload: {
            member_id: member.id,
            member_name: member.name,
            email: member.email || null,
          },
        },
      });
    }
  }
}

async function processInactiveReminderEmails({ gym, settings, delivery }) {
  const sendEmailEnabled = settings.enable_inactive_reminder && settings.enable_inactive_email && delivery.emailConfigured;
  const sendWhatsappEnabled = settings.enable_inactive_reminder && settings.enable_inactive_whatsapp && delivery.whatsappReady;
  if (!sendEmailEnabled && !sendWhatsappEnabled) return;

  const thresholdDays = Number(settings.inactive_days_threshold || 14);
  const cutoff = addDays(new Date(), -thresholdDays);

  const rows = await prisma.$queryRaw`
    SELECT m.id, m.gym_id, m.name, m.email, m.phone, m.start_date, m.expiry_date, m.amount, m.is_inactive,
           MAX(a.checkin_at) AS last_checkin
    FROM "members" m
    LEFT JOIN "attendances" a ON a.member_id = m.id
    WHERE m.gym_id = ${gym.id}
      AND m.expiry_date >= ${new Date()}
    GROUP BY m.id
  `;

  for (const member of rows) {
    if (member.is_inactive) continue;

    const lastCheckin = member.last_checkin || member.start_date;
    if (!lastCheckin) continue;
    if (new Date(lastCheckin) > cutoff) continue;

    try {
      let subject = settings.email_subject_inactive;
      let delivered = false;

      if (sendEmailEnabled && member.email) {
        subject = await sendMemberEmail({
          gym,
          member: {
            ...member,
            last_checkin_date: lastCheckin,
          },
          subject: settings.email_subject_inactive,
          body: settings.email_body_inactive,
          type: 'inactive_member_email',
        });
        delivered = true;
      }

      if (sendWhatsappEnabled) {
        try {
          await sendMemberWhatsapp({
            gym,
            member,
            body: settings.whatsapp_body_inactive,
            type: 'inactive_member_whatsapp',
            lastCheckinDate: lastCheckin,
          });
          delivered = true;
        } catch (whatsappErr) {
          await logGymNotification({
            gym_id: gym.id,
            member_id: member.id,
            type: 'inactive_member_whatsapp',
            message: whatsappErr?.message || 'Failed to send inactive reminder WhatsApp',
            status: 'failed',
          });
        }
      }

      if (!delivered) continue;

      await prisma.members.update({
        where: { id: member.id },
        data: { is_inactive: true, inactive_since: new Date() },
      });

      await logGymNotification({
        gym_id: gym.id,
        member_id: member.id,
        type: 'inactive_member_email',
        message: subject,
        status: 'sent',
      });

    } catch (err) {
      const message = err?.message || 'Failed to send inactive reminder email';
      console.error('Inactive reminder email failed', gym.id, member.id, message);
      await prisma.email_notifications.create({
        data: {
          gym_id: gym.id,
          type: 'inactive_member_email',
          status: 'failed',
          subject: settings.email_subject_inactive,
          error_message: message,
          payload: {
            member_id: member.id,
            member_name: member.name,
            email: member.email || null,
          },
        },
      });
      await logGymNotification({
        gym_id: gym.id,
        member_id: member.id,
        type: 'inactive_member_email',
        message,
        status: 'failed',
      });
    }
  }
}

async function processBirthdayEmails({ gym, settings, delivery }) {
  const sendEmailEnabled = settings.enable_birthday_message && settings.enable_birthday_email && delivery.emailConfigured;
  const sendWhatsappEnabled = settings.enable_birthday_message && settings.enable_birthday_whatsapp && delivery.whatsappReady;
  if (!sendEmailEnabled && !sendWhatsappEnabled) return;

  const today = new Date();
  const day = today.getUTCDate();
  const month = today.getUTCMonth() + 1;

  const members = await prisma.$queryRaw`
    SELECT id, gym_id, name, email, phone, dob
    FROM "members"
    WHERE gym_id = ${gym.id}
      AND dob IS NOT NULL
      AND EXTRACT(MONTH FROM dob) = ${month}
      AND EXTRACT(DAY FROM dob) = ${day}
  `;

  for (const member of members) {
    const alreadySent = await hasSentGymNotificationToday({
      gym_id: gym.id,
      member_id: member.id,
      type: 'birthday_email',
    });
    if (alreadySent) continue;

    try {
      let subject = settings.email_subject_birthday;
      if (sendEmailEnabled && member.email) {
        subject = await sendMemberEmail({
          gym,
          member,
          subject: settings.email_subject_birthday,
          body: settings.email_body_birthday,
          type: 'birthday_email',
        });
      }

      await logGymNotification({
        gym_id: gym.id,
        member_id: member.id,
        type: 'birthday_email',
        message: subject,
        status: sendEmailEnabled && member.email ? 'sent' : 'skipped',
      });

      if (sendWhatsappEnabled) {
        try {
          await sendMemberWhatsapp({
            gym,
            member,
            body: settings.whatsapp_body_birthday || settings.message_birthday,
            type: 'birthday_whatsapp',
          });
        } catch (whatsappErr) {
          await logGymNotification({
            gym_id: gym.id,
            member_id: member.id,
            type: 'birthday_whatsapp',
            message: whatsappErr?.message || 'Failed to send birthday WhatsApp',
            status: 'failed',
          });
        }
      }
    } catch (err) {
      const message = err?.message || 'Failed to send birthday email';
      console.error('Birthday email failed', gym.id, member.id, message);
      await prisma.email_notifications.create({
        data: {
          gym_id: gym.id,
          type: 'birthday_email',
          status: 'failed',
          subject: settings.email_subject_birthday,
          error_message: message,
          payload: {
            member_id: member.id,
            member_name: member.name,
            email: member.email || null,
          },
        },
      });
      await logGymNotification({
        gym_id: gym.id,
        member_id: member.id,
        type: 'birthday_email',
        message,
        status: 'failed',
      });
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
