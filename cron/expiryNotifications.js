const cron = require('node-cron');
const prisma = require('../utils/prisma');
const { sendEmail } = require('../services/emailService');
const { getOrCreateReminderSettings } = require('../services/reminderSettingsService');
const { sendWhatsappMessage } = require('../services/whatsappService');
const { logGymNotification } = require('../services/notificationService');

const OWNER_DAILY_SUMMARY_CRON = process.env.OWNER_DAILY_SUMMARY_CRON || '0 5 * * *';
let isRunning = false;

function escapeHtml(value) {
  if (!value) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatDate(date) {
  return new Date(date).toISOString().slice(0, 10);
}

function buildSectionRows(rows, emptyLabel, columns) {
  if (!rows.length) {
    return `<tr><td colspan="${columns.length}" style="padding:8px;">${escapeHtml(emptyLabel)}</td></tr>`;
  }

  return rows
    .map((row) => {
      const cells = columns
        .map((column) => `<td style="padding:8px;border-bottom:1px solid #eee;">${escapeHtml(row[column.key])}</td>`)
        .join('');
      return `<tr>${cells}</tr>`;
    })
    .join('');
}

function buildTable(title, rows, columns, emptyLabel) {
  const headers = columns
    .map(
      (column) =>
        `<th style="text-align:left;border-bottom:1px solid #ddd;padding:8px;background:#f8fafc;">${escapeHtml(column.label)}</th>`,
    )
    .join('');

  return `
    <div style="margin-top:24px;">
      <h3 style="margin:0 0 12px;">${escapeHtml(title)}</h3>
      <table style="border-collapse:collapse;width:100%;max-width:900px;">
        <thead>
          <tr>${headers}</tr>
        </thead>
        <tbody>
          ${buildSectionRows(rows, emptyLabel, columns)}
        </tbody>
      </table>
    </div>
  `;
}

function buildEmailHtml({ gymName, expiredRows, pendingRows, now }) {
  return `
    <div style="font-family:Arial,sans-serif;line-height:1.5;color:#111827;">
      <h2>Daily Owner Summary for ${escapeHtml(gymName)}</h2>
      <p>Date: ${escapeHtml(formatDate(now))}</p>
      <p>
        Expired memberships: <strong>${expiredRows.length}</strong><br />
        Pending payments: <strong>${pendingRows.length}</strong>
      </p>
      ${buildTable(
        'Expired Members',
        expiredRows,
        [
          { key: 'name', label: 'Member Name' },
          { key: 'phone', label: 'Phone' },
          { key: 'email', label: 'Email' },
          { key: 'expiry', label: 'Expiry Date' },
          { key: 'plan', label: 'Plan' },
          { key: 'amount', label: 'Amount' },
        ],
        'No expired members.',
      )}
      ${buildTable(
        'Pending Payments',
        pendingRows,
        [
          { key: 'name', label: 'Member Name' },
          { key: 'phone', label: 'Phone' },
          { key: 'email', label: 'Email' },
          { key: 'expiry', label: 'Expiry Date' },
          { key: 'plan', label: 'Plan' },
          { key: 'amount', label: 'Amount' },
        ],
        'No pending payments.',
      )}
      <p style="margin-top:24px;">Thank you for using Gym Management SaaS.</p>
    </div>
  `;
}

function buildTextSection(title, rows) {
  if (!rows.length) return `${title}\nNone`;
  return `${title}\n${rows
    .map((row) => `${row.name} | ${row.phone} | ${row.email} | ${row.expiry} | ${row.plan} | ${row.amount}`)
    .join('\n')}`;
}

function buildWhatsappSummaryText({ gymName, expiredRows, pendingRows, now }) {
  const lines = [
    `Daily Summary - ${gymName}`,
    `Date: ${formatDate(now)}`,
    `Expired memberships: ${expiredRows.length}`,
    `Pending payments: ${pendingRows.length}`,
  ];

  const appendRows = (title, rows) => {
    lines.push('', title);
    if (!rows.length) {
      lines.push('None');
      return;
    }
    rows.slice(0, 10).forEach((row) => {
      lines.push(`${row.name} | ${row.phone} | ${row.expiry} | ${row.amount}`);
    });
    if (rows.length > 10) lines.push(`+${rows.length - 10} more`);
  };

  appendRows('Expired Members', expiredRows);
  appendRows('Pending Payments', pendingRows);
  return lines.join('\n');
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

  const pendingPayments = await prisma.members.findMany({
    where: {
      gym_id: gymId,
      is_inactive: false,
      payment_method: null,
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
  const whatsappEnabled = Boolean(settings.enable_owner_daily_summary_whatsapp && gym.phone);

  if (!force && !emailEnabled && !whatsappEnabled) {
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
          type: force ? 'owner_daily_summary_test' : 'owner_daily_summary',
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

  if (!force && whatsappEnabled) {
    const message = buildWhatsappSummaryText({ gymName: gym.gym_name, expiredRows, pendingRows, now });
    try {
      await sendWhatsappMessage({ gymId: gym.id, phone: gym.phone, message, mediaUrl: gym.logo_url });
      await logGymNotification({
        gym_id: gym.id,
        type: 'owner_daily_summary_whatsapp',
        message,
        status: 'sent',
      });
      sentAny = true;
    } catch (err) {
      const messageText = err?.message || 'Failed to send owner daily summary WhatsApp';
      await logGymNotification({
        gym_id: gym.id,
        type: 'owner_daily_summary_whatsapp',
        message: messageText,
        status: 'failed',
      });
    }
  }

  return sentAny ? { sent: true } : { sent: false, reason: 'send-failed' };
}

async function runOnce() {
  const now = new Date();
  const gyms = await prisma.gyms.findMany({
    select: {
      id: true,
      gym_name: true,
      email: true,
      phone: true,
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
    OWNER_DAILY_SUMMARY_CRON,
    async () => {
      if (isRunning) {
        console.warn('Owner daily summary cron skipped because a previous run is still in progress');
        return;
      }

      isRunning = true;
      try {
        await runOnce();
      } catch (err) {
        console.error('Owner daily summary cron failed', err);
      } finally {
        isRunning = false;
      }
    },
    options,
  );
}

async function sendTestEmailForGym(gym_id) {
  const gym = await prisma.gyms.findUnique({
    where: { id: gym_id },
    select: {
      id: true,
      gym_name: true,
      email: true,
      phone: true,
      logo_url: true,
      email_notifications_enabled: true,
    },
  });

  if (!gym || !gym.email) throw new Error('Gym email not found');

  const settings = await getOrCreateReminderSettings(gym.id);
  if (!gym.email_notifications_enabled || !settings.enable_owner_daily_summary_email) {
    throw new Error('Owner daily summary emails are disabled for this gym');
  }

  const result = await processGym(gym, new Date(), { force: true });
  if (!result?.sent) {
    throw new Error(result?.reason === 'send-failed' ? 'Failed to send test email' : 'Test email was not sent');
  }
}

module.exports = { start, runOnce, sendTestEmailForGym };
