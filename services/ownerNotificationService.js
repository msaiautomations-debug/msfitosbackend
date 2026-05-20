const { sendEmail } = require('./emailService');

function parseOwnerNotificationRecipients() {
  const explicitRecipients = String(
    process.env.BOOKING_NOTIFICATION_EMAILS || process.env.OWNER_NOTIFICATION_EMAILS || '',
  ).trim();

  const fallbackRecipient = String(process.env.EMAIL_USER || '').trim();
  const rawRecipients = explicitRecipients || fallbackRecipient;

  return [
    ...new Set(
      String(rawRecipients)
        .split(/[\n,;]+/)
        .map((value) => value.trim())
        .filter(Boolean),
    ),
  ];
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

async function sendOwnerNotification({ subject, text, html }) {
  const recipients = parseOwnerNotificationRecipients();
  if (!recipients.length) {
    console.warn('Owner notification skipped because no recipient email is configured.');
    return { sent: false, reason: 'missing_recipient' };
  }

  try {
    await sendEmail({
      to: recipients,
      subject,
      text,
      html,
    });
    return { sent: true };
  } catch (err) {
    console.error('Failed to send owner notification email', err);
    return { sent: false, reason: err.message };
  }
}

async function sendGymSignupOwnerNotification(details) {
  const submittedAt = new Date().toLocaleString('en-IN', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: process.env.CRON_TIMEZONE || 'Asia/Kolkata',
  });

  const text = [
    `A new gym booking/signup form submission has been received (${details.submissionType}).`,
    '',
    `Gym name: ${details.gym_name}`,
    `Gym ID: ${details.gym_id}`,
    `Owner name: ${details.owner_name}`,
    `Email: ${details.email}`,
    `Phone: ${details.phone}`,
    `Plan: ${details.plan || 'trial'}`,
    `Email verified: ${details.email_verified ? 'Yes' : 'No'}`,
    `Subscription status: ${details.subscription_status || 'inactive'}`,
    `Trial end date: ${details.trial_end_date ? new Date(details.trial_end_date).toISOString() : 'N/A'}`,
    `Submitted at: ${submittedAt}`,
  ].join('\n');

  const html = `
    <p>A new gym booking/signup form submission has been received (<strong>${escapeHtml(details.submissionType)}</strong>).</p>
    <table cellpadding="6" cellspacing="0" border="0">
      <tr><td><strong>Gym name</strong></td><td>${escapeHtml(details.gym_name)}</td></tr>
      <tr><td><strong>Gym ID</strong></td><td>${escapeHtml(details.gym_id)}</td></tr>
      <tr><td><strong>Owner name</strong></td><td>${escapeHtml(details.owner_name)}</td></tr>
      <tr><td><strong>Email</strong></td><td>${escapeHtml(details.email)}</td></tr>
      <tr><td><strong>Phone</strong></td><td>${escapeHtml(details.phone)}</td></tr>
      <tr><td><strong>Plan</strong></td><td>${escapeHtml(details.plan || 'trial')}</td></tr>
      <tr><td><strong>Email verified</strong></td><td>${details.email_verified ? 'Yes' : 'No'}</td></tr>
      <tr><td><strong>Subscription status</strong></td><td>${escapeHtml(details.subscription_status || 'inactive')}</td></tr>
      <tr><td><strong>Trial end date</strong></td><td>${escapeHtml(details.trial_end_date ? new Date(details.trial_end_date).toLocaleDateString('en-IN') : 'N/A')}</td></tr>
      <tr><td><strong>Submitted at</strong></td><td>${escapeHtml(submittedAt)}</td></tr>
    </table>
  `;

  return sendOwnerNotification({
    subject: `New gym booking: ${details.gym_name}`,
    text,
    html,
  });
}

async function sendWebsiteInquiryOwnerNotification(details) {
  const submittedAt = new Date(details.created_at || Date.now()).toLocaleString('en-IN', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: process.env.CRON_TIMEZONE || 'Asia/Kolkata',
  });

  const text = [
    'A new website inquiry has been received.',
    '',
    `Name: ${details.name}`,
    `Gym name: ${details.gym_name}`,
    `Phone: ${details.phone}`,
    `Email: ${details.email}`,
    `Message: ${details.message || 'N/A'}`,
    `Submitted at: ${submittedAt}`,
  ].join('\n');

  const html = `
    <p>A new website inquiry has been received.</p>
    <table cellpadding="6" cellspacing="0" border="0">
      <tr><td><strong>Name</strong></td><td>${escapeHtml(details.name)}</td></tr>
      <tr><td><strong>Gym name</strong></td><td>${escapeHtml(details.gym_name)}</td></tr>
      <tr><td><strong>Phone</strong></td><td>${escapeHtml(details.phone)}</td></tr>
      <tr><td><strong>Email</strong></td><td>${escapeHtml(details.email)}</td></tr>
      <tr><td><strong>Message</strong></td><td>${escapeHtml(details.message || 'N/A')}</td></tr>
      <tr><td><strong>Submitted at</strong></td><td>${escapeHtml(submittedAt)}</td></tr>
    </table>
  `;

  return sendOwnerNotification({
    subject: `New website inquiry: ${details.gym_name}`,
    text,
    html,
  });
}

module.exports = {
  sendGymSignupOwnerNotification,
  sendWebsiteInquiryOwnerNotification,
};
