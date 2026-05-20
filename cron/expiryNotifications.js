const cron = require('node-cron');
const prisma = require('../utils/prisma');
const { sendEmail } = require('../services/emailService');
const { getOrCreateReminderSettings } = require('../services/reminderSettingsService');

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
  if (!gym.email_notifications_enabled || !gym.email) return { sent: false, reason: 'email-disabled' };

  const settings = await getOrCreateReminderSettings(gym.id);
  if (!settings.enable_owner_daily_summary_email && !force) {
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

  try {
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
    return { sent: true };
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
    return { sent: false, reason: 'send-failed' };
  }
}

async function runOnce() {
  const now = new Date();
  const gyms = await prisma.gyms.findMany({
    select: {
      id: true,
      gym_name: true,
      email: true,
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
