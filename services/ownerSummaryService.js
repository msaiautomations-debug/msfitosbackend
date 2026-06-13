const prisma = require('../utils/prisma');
const { sendEmail } = require('../services/emailService');
const { sendWhatsappMessage } = require('../services/whatsappService');

function ownerSessionKey(ownerId) {
  return `owner_${ownerId}`;
}

function formatDate(date) {
  return new Date(date).toLocaleDateString('en-IN', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

function formatCurrency(amount) {
  return `₹${Number(amount || 0).toLocaleString('en-IN')}`;
}

async function buildOwnerSummary(owner, now) {
  const access = await prisma.admin_gym_access.findMany({
    where: { owner_id: owner.id },
    select: { gym_id: true },
  });
  const gymIds = access.map((a) => a.gym_id);

  if (!gymIds.length) return null;

  const gyms = await prisma.gyms.findMany({
    where: { id: { in: gymIds } },
    select: { id: true, gym_name: true },
  });

  const expiringSoonDays = owner.expiring_soon_days || 7;
  const expiringSoonEnd = new Date(now);
  expiringSoonEnd.setDate(expiringSoonEnd.getDate() + expiringSoonDays);

  const todayStart = new Date(now);
  todayStart.setHours(0, 0, 0, 0);
  const todayEnd = new Date(now);
  todayEnd.setHours(23, 59, 59, 999);

  const perGymData = [];
  let overallNewToday = 0;
  let overallTrialToday = 0;
  let overallExpiringSoon = 0;
  let overallExpiredToday = 0;
  let overallPendingCount = 0;
  let overallPendingAmount = 0;
  let overallTodayRevenue = 0;

  for (const gym of gyms) {
    const members = await prisma.members.findMany({
      where: { gym_id: gym.id },
      select: {
        name: true,
        phone: true,
        expiry_date: true,
        amount: true,
        payment_status: true,
        payment_method: true,
        plan_duration: true,
        is_inactive: true,
        created_at: true,
      },
    });

    // New members today
    const newToday = members.filter(
      (m) => m.created_at >= todayStart && m.created_at <= todayEnd,
    );

    // Trial members today (plan_duration <= 7 and created today)
    const trialToday = newToday.filter((m) => m.plan_duration <= 7);

    // Expiring soon
    const expiringSoon = members.filter(
      (m) =>
        !m.is_inactive &&
        new Date(m.expiry_date) >= now &&
        new Date(m.expiry_date) <= expiringSoonEnd,
    );

    // Expired today
    const expiredToday = members.filter((m) => {
      const exp = new Date(m.expiry_date);
      return !m.is_inactive && exp >= todayStart && exp <= todayEnd && exp < now;
    });

    // Pending payments
    const pending = members.filter(
      (m) =>
        !m.is_inactive && (!m.payment_method || m.payment_status === 'pending'),
    );
    const pendingAmount = pending.reduce((sum, m) => sum + Number(m.amount || 0), 0);

    // Today's revenue
    const todaysRevenue = members
      .filter(
        (m) =>
          m.payment_status === 'paid' &&
          m.created_at >= todayStart &&
          m.created_at <= todayEnd,
      )
      .reduce((sum, m) => sum + Number(m.amount || 0), 0);

    perGymData.push({
      gymName: gym.gym_name,
      newToday,
      trialToday,
      expiringSoon,
      expiredToday,
      pending,
      pendingAmount,
      todaysRevenue,
    });

    overallNewToday += newToday.length;
    overallTrialToday += trialToday.length;
    overallExpiringSoon += expiringSoon.length;
    overallExpiredToday += expiredToday.length;
    overallPendingCount += pending.length;
    overallPendingAmount += pendingAmount;
    overallTodayRevenue += todaysRevenue;
  }

  return {
    perGymData,
    expiringSoonDays,
    totals: {
      newToday: overallNewToday,
      trialToday: overallTrialToday,
      expiringSoon: overallExpiringSoon,
      expiredToday: overallExpiredToday,
      pendingCount: overallPendingCount,
      pendingAmount: overallPendingAmount,
      todayRevenue: overallTodayRevenue,
    },
  };
}

function buildWhatsappMessage(summary, dateStr) {
  const lines = [];

  for (const gym of summary.perGymData) {
    lines.push(`🏋️ ${gym.gymName} — Daily Summary (${dateStr})`);
    lines.push('');
    lines.push(`👥 New Members Today: ${gym.newToday.length}`);
    lines.push(`🆕 Trial Members Today: ${gym.trialToday.length}`);
    lines.push('');

    lines.push(`⚠️ Expiring Soon (${summary.expiringSoonDays} days): ${gym.expiringSoon.length} members`);
    if (gym.expiringSoon.length > 0) {
      gym.expiringSoon.slice(0, 10).forEach((m) => {
        lines.push(`• ${m.name} — ${formatDate(m.expiry_date)}`);
      });
      if (gym.expiringSoon.length > 10) {
        lines.push(`  ... and ${gym.expiringSoon.length - 10} more`);
      }
    }
    lines.push('');

    lines.push(`❌ Expired Today: ${gym.expiredToday.length} members`);
    if (gym.expiredToday.length > 0) {
      gym.expiredToday.slice(0, 10).forEach((m) => {
        lines.push(`• ${m.name} — ${m.phone || 'No phone'}`);
      });
    }
    lines.push('');

    lines.push(`💰 Pending Payments: ${gym.pending.length} members | ${formatCurrency(gym.pendingAmount)}`);
    if (gym.pending.length > 0) {
      gym.pending.slice(0, 10).forEach((m) => {
        lines.push(`• ${m.name} — ${formatCurrency(m.amount)}`);
      });
      if (gym.pending.length > 10) {
        lines.push(`  ... and ${gym.pending.length - 10} more`);
      }
    }
    lines.push('');

    lines.push(`📈 Today's Revenue: ${formatCurrency(gym.todaysRevenue)}`);
    lines.push('──────────────────────');
    lines.push('');
  }

  // Overall summary
  lines.push('📊 OVERALL SUMMARY');
  lines.push(`Total New Members Today: ${summary.totals.newToday}`);
  lines.push(`Total Revenue Today: ${formatCurrency(summary.totals.todayRevenue)}`);
  lines.push(`Total Pending Payments: ${summary.totals.pendingCount} | ${formatCurrency(summary.totals.pendingAmount)}`);
  lines.push(`Total Expiring in ${summary.expiringSoonDays} days: ${summary.totals.expiringSoon}`);
  lines.push(`Total Trial Today: ${summary.totals.trialToday}`);

  return lines.join('\n');
}

function buildEmailHtml(summary, dateStr, ownerName) {
  const gymSections = summary.perGymData
    .map((gym) => {
      const expiringSoonRows = gym.expiringSoon
        .slice(0, 15)
        .map((m) => `<tr><td style="padding:4px 8px;border-bottom:1px solid #2A2925;">${m.name}</td><td style="padding:4px 8px;border-bottom:1px solid #2A2925;">${formatDate(m.expiry_date)}</td></tr>`)
        .join('');

      const expiredRows = gym.expiredToday
        .slice(0, 15)
        .map((m) => `<tr><td style="padding:4px 8px;border-bottom:1px solid #2A2925;">${m.name}</td><td style="padding:4px 8px;border-bottom:1px solid #2A2925;">${m.phone || '-'}</td></tr>`)
        .join('');

      const pendingRows = gym.pending
        .slice(0, 15)
        .map((m) => `<tr><td style="padding:4px 8px;border-bottom:1px solid #2A2925;">${m.name}</td><td style="padding:4px 8px;border-bottom:1px solid #2A2925;">${formatCurrency(m.amount)}</td></tr>`)
        .join('');

      return `
        <div style="margin-bottom:24px;padding:16px;background:#1E1D1A;border-radius:8px;border:1px solid #2A2925;">
          <h2 style="color:#C9A84C;margin:0 0 12px 0;font-size:18px;">🏋️ ${gym.gymName}</h2>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:12px;">
            <div style="padding:8px;background:#111110;border-radius:4px;"><span style="color:#9E9A90;">New Today:</span> <strong style="color:#E5E7EB;">${gym.newToday.length}</strong></div>
            <div style="padding:8px;background:#111110;border-radius:4px;"><span style="color:#9E9A90;">Trial Today:</span> <strong style="color:#E5E7EB;">${gym.trialToday.length}</strong></div>
            <div style="padding:8px;background:#111110;border-radius:4px;"><span style="color:#9E9A90;">Expiring (${summary.expiringSoonDays}d):</span> <strong style="color:#EAB308;">${gym.expiringSoon.length}</strong></div>
            <div style="padding:8px;background:#111110;border-radius:4px;"><span style="color:#9E9A90;">Expired Today:</span> <strong style="color:#EF4444;">${gym.expiredToday.length}</strong></div>
            <div style="padding:8px;background:#111110;border-radius:4px;"><span style="color:#9E9A90;">Pending:</span> <strong style="color:#EAB308;">${gym.pending.length} | ${formatCurrency(gym.pendingAmount)}</strong></div>
            <div style="padding:8px;background:#111110;border-radius:4px;"><span style="color:#9E9A90;">Revenue:</span> <strong style="color:#22C55E;">${formatCurrency(gym.todaysRevenue)}</strong></div>
          </div>
          ${expiringSoonRows ? `<details style="margin-top:8px;"><summary style="color:#C9A84C;cursor:pointer;">⚠️ Expiring Soon Members</summary><table style="width:100%;color:#E5E7EB;font-size:13px;margin-top:6px;">${expiringSoonRows}</table></details>` : ''}
          ${expiredRows ? `<details style="margin-top:8px;"><summary style="color:#EF4444;cursor:pointer;">❌ Expired Today</summary><table style="width:100%;color:#E5E7EB;font-size:13px;margin-top:6px;">${expiredRows}</table></details>` : ''}
          ${pendingRows ? `<details style="margin-top:8px;"><summary style="color:#EAB308;cursor:pointer;">💰 Pending Payments</summary><table style="width:100%;color:#E5E7EB;font-size:13px;margin-top:6px;">${pendingRows}</table></details>` : ''}
        </div>
      `;
    })
    .join('');

  return `
    <div style="font-family:Inter,Arial,sans-serif;background:#111110;color:#E5E7EB;padding:24px;max-width:640px;margin:0 auto;">
      <div style="text-align:center;margin-bottom:24px;">
        <h1 style="color:#C9A84C;font-size:22px;margin:0;">MS FitOS — Daily Summary</h1>
        <p style="color:#9E9A90;margin:4px 0 0;">Hi ${ownerName}, here's your daily report for ${dateStr}</p>
      </div>

      ${gymSections}

      <div style="padding:16px;background:#1E1D1A;border-radius:8px;border:2px solid #C9A84C;margin-top:16px;">
        <h2 style="color:#C9A84C;margin:0 0 12px 0;font-size:18px;">📊 Overall Summary</h2>
        <table style="width:100%;color:#E5E7EB;font-size:14px;">
          <tr><td style="padding:4px 0;">New Members Today</td><td style="text-align:right;font-weight:bold;">${summary.totals.newToday}</td></tr>
          <tr><td style="padding:4px 0;">Revenue Today</td><td style="text-align:right;font-weight:bold;color:#22C55E;">${formatCurrency(summary.totals.todayRevenue)}</td></tr>
          <tr><td style="padding:4px 0;">Pending Payments</td><td style="text-align:right;font-weight:bold;color:#EAB308;">${summary.totals.pendingCount} | ${formatCurrency(summary.totals.pendingAmount)}</td></tr>
          <tr><td style="padding:4px 0;">Expiring in ${summary.expiringSoonDays} days</td><td style="text-align:right;font-weight:bold;color:#EAB308;">${summary.totals.expiringSoon}</td></tr>
          <tr><td style="padding:4px 0;">Trial Members Today</td><td style="text-align:right;font-weight:bold;">${summary.totals.trialToday}</td></tr>
        </table>
      </div>

      <p style="text-align:center;color:#6B6860;font-size:12px;margin-top:24px;">
        Sent by MS FitOS • ${dateStr}
      </p>
    </div>
  `;
}

async function processAllOwnerSummaries(now) {
  const owners = await prisma.owners.findMany({
    select: {
      id: true,
      name: true,
      email: true,
      phone: true,
      whatsapp_number: true,
      whatsapp_verified: true,
      expiring_soon_days: true,
    },
  });

  if (!owners.length) {
    console.log('[OwnerSummary] No owners found, skipping');
    return;
  }

  const dateStr = formatDate(now);
  let sentCount = 0;

  for (const owner of owners) {
    try {
      const summary = await buildOwnerSummary(owner, now);

      if (!summary) {
        console.log(`[OwnerSummary] Owner ${owner.name} has no assigned gyms, skipping`);
        continue;
      }

      // Always send email
      if (owner.email) {
        try {
          const html = buildEmailHtml(summary, dateStr, owner.name);
          await sendEmail({
            to: owner.email,
            subject: `MS FitOS — Daily Summary (${dateStr})`,
            html,
          });
          console.log(`[OwnerSummary] Email sent to ${owner.email}`);
        } catch (emailErr) {
          console.error(`[OwnerSummary] Email failed for ${owner.email}:`, emailErr?.message);
        }
      }

      // WhatsApp only if verified
      if (owner.whatsapp_verified && owner.whatsapp_number) {
        try {
          const message = buildWhatsappMessage(summary, dateStr);
          await sendWhatsappMessage({
            gymId: ownerSessionKey(owner.id),
            phone: owner.whatsapp_number,
            message,
          });
          console.log(`[OwnerSummary] WhatsApp sent to ${owner.whatsapp_number}`);
        } catch (waErr) {
          console.error(`[OwnerSummary] WhatsApp failed for ${owner.whatsapp_number}:`, waErr?.message);
        }
      } else {
        console.log(`[OwnerSummary] WhatsApp skipped for ${owner.name} (not verified)`);
      }

      sentCount++;
    } catch (ownerErr) {
      console.error(`[OwnerSummary] Failed for owner ${owner.name}:`, ownerErr?.message);
    }
  }

  console.log(`[OwnerSummary] Processed ${sentCount}/${owners.length} owners`);
}

module.exports = { processAllOwnerSummaries, buildOwnerSummary };
