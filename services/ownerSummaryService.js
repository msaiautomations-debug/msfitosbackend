const prisma = require('../utils/prisma');
const { sendEmail } = require('../services/emailService');

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

/**
 * Builds a rich daily summary payload using precomputed tables.
 */
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
  const gymNameMap = {};
  gyms.forEach(g => { gymNameMap[g.id] = g.gym_name; });

  const currentMonthStr = now.toISOString().slice(0, 7);
  const lastMonthDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const lastMonthStr = lastMonthDate.toISOString().slice(0, 7);
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const todayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);

  const perGymData = [];
  let totalRevenueCurrent = 0;
  let totalRevenueLast = 0;
  let totalPendingCurrent = 0;
  let totalPendingLastWeek = 0;
  let overallRiskCount = 0;
  let overallNewTrials = 0;
  let overallConvertedTrials = 0;
  let overallNotifsSent = 0;
  let overallNotifsFailed = 0;

  for (const gym of gyms) {
    const gymId = gym.id;

    // 1. Revenue this month & last month
    const revsCurrent = await prisma.gym_revenue_daily.findMany({
      where: {
        gym_id: gymId,
        date: { gte: new Date(now.getFullYear(), now.getMonth(), 1) },
      },
      select: { revenue: true },
    });
    const revenueThisPeriod = revsCurrent.reduce((sum, r) => sum + r.revenue, 0);

    const revsLast = await prisma.gym_revenue_daily.findMany({
      where: {
        gym_id: gymId,
        date: {
          gte: new Date(now.getFullYear(), now.getMonth() - 1, 1),
          lte: new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999),
        },
      },
      select: { revenue: true },
    });
    const revenueLastPeriod = revsLast.reduce((sum, r) => sum + r.revenue, 0);

    totalRevenueCurrent += revenueThisPeriod;
    totalRevenueLast += revenueLastPeriod;

    // 2. Pending payments now vs 7 days ago
    const latestSnapshot = await prisma.gym_revenue_daily.findFirst({
      where: { gym_id: gymId },
      orderBy: { date: 'desc' },
      select: { pending_amount: true, pending_count: true },
    });
    const pendingAmount = latestSnapshot?.pending_amount || 0;
    const pendingCount = latestSnapshot?.pending_count || 0;

    const histSnapshot = await prisma.gym_revenue_daily.findFirst({
      where: { gym_id: gymId, date: { lte: sevenDaysAgo } },
      orderBy: { date: 'desc' },
      select: { pending_amount: true },
    });
    const pendingAmountLastWeek = histSnapshot?.pending_amount || 0;

    totalPendingCurrent += pendingAmount;
    totalPendingLastWeek += pendingAmountLastWeek;

    // 3. Renewals (expiring / expired)
    const expiringSoon = await prisma.gym_renewal_queue.findMany({
      where: { gym_id: gymId, status: 'expiring' },
      orderBy: { expiry_date: 'asc' },
      take: 10,
    });
    const expiredToday = await prisma.gym_renewal_queue.findMany({
      where: { gym_id: gymId, status: 'expired' },
      orderBy: { expiry_date: 'desc' },
      take: 10,
    });

    // 4. Attendance Churn Risk Count
    const riskCount = await prisma.member_attendance_risk.count({
      where: { gym_id: gymId, status: 'paid_but_not_attending' },
    });
    overallRiskCount += riskCount;

    // 5. Trials (last 30 days)
    const trials = await prisma.trial_funnel_daily.findMany({
      where: { gym_id: gymId, date: { gte: thirtyDaysAgo } },
      select: { new_trials: true, converted: true },
    });
    const newTrials = trials.reduce((sum, t) => sum + t.new_trials, 0);
    const converted = trials.reduce((sum, t) => sum + t.converted, 0);

    overallNewTrials += newTrials;
    overallConvertedTrials += converted;

    const trialConversionRate = newTrials > 0 ? Math.round((converted / newTrials) * 100) : 0;
    const trialAnomaly = newTrials > 0 && converted === 0;

    // Member counts breakdown (Total, Active, Expired, Trial, Lost, Added Today, Today's Revenue)
    const allMembers = await prisma.members.findMany({
      where: { gym_id: gymId },
      select: {
        expiry_date: true,
        is_inactive: true,
        plan_duration: true,
        created_at: true,
        amount: true,
        payment_status: true,
      },
    });

    const totalMembers = allMembers.length;
    let activeMembers = 0;
    let expiredMembers = 0;
    let trialMembersCount = 0;
    let trialLostCount = 0;
    let membersAddedToday = 0;
    let todayRevenue = 0;

    for (const m of allMembers) {
      const expiryDate = new Date(m.expiry_date);
      const isExpired = expiryDate < now;
      const isActive = !m.is_inactive && !isExpired;
      const isTrial = m.plan_duration <= 7;

      if (isActive) activeMembers++;
      if (isExpired && !m.is_inactive) expiredMembers++;

      if (isTrial) {
        if (isActive) trialMembersCount++;
        if (isExpired && !m.is_inactive) trialLostCount++;
      }

      const createdAt = new Date(m.created_at);
      if (createdAt >= todayStart && createdAt <= todayEnd) {
        membersAddedToday++;
        if (m.payment_status === 'paid') {
          todayRevenue += Number(m.amount || 0);
        }
      }
    }

    // 6. Notification health (last 7 days)
    const notifs = await prisma.notification_health_daily.findMany({
      where: { gym_id: gymId, date: { gte: sevenDaysAgo } },
      select: { sent_count: true, failed_count: true },
    });
    const sent = notifs.reduce((sum, n) => sum + n.sent_count, 0);
    const failed = notifs.reduce((sum, n) => sum + n.failed_count, 0);

    overallNotifsSent += sent;
    overallNotifsFailed += failed;

    perGymData.push({
      gymId,
      gymName: gym.gym_name,
      revenueThisPeriod,
      revenueLastPeriod,
      revenueTrend: revenueThisPeriod > revenueLastPeriod ? 'up' : revenueThisPeriod < revenueLastPeriod ? 'down' : 'neutral',
      pendingAmount,
      pendingCount,
      expiringSoon,
      expiredToday,
      riskCount,
      totalMembers,
      activeMembers,
      expiredMembers,
      trialMembersCount,
      trialLostCount,
      membersAddedToday,
      todayRevenue,
      newTrials,
      converted,
      trialConversionRate,
      trialAnomaly,
      notificationHealth: { sent, failed, total: sent + failed, failRate: (sent + failed) > 0 ? Math.round((failed / (sent + failed)) * 100) : 0 },
    });
  }

  // Cross-gym comparisons
  let bestGym = null;
  let worstGym = null;
  if (perGymData.length > 0) {
    const sorted = [...perGymData].sort((a, b) => b.revenueThisPeriod - a.revenueThisPeriod);
    bestGym = { name: sorted[0].gymName, revenue: sorted[0].revenueThisPeriod };
    worstGym = { name: sorted[sorted.length - 1].gymName, revenue: sorted[sorted.length - 1].revenueThisPeriod };
  }

  const overallTrialsRate = overallNewTrials > 0 ? Math.round((overallConvertedTrials / overallNewTrials) * 100) : 0;
  const overallTrialsAnomaly = overallNewTrials > 0 && overallConvertedTrials === 0;

  const totalNotifs = overallNotifsSent + overallNotifsFailed;
  const overallFailRate = totalNotifs > 0 ? Math.round((overallNotifsFailed / totalNotifs) * 100) : 0;

  return {
    perGymData,
    totals: {
      revenueCurrent: totalRevenueCurrent,
      revenueLast: totalRevenueLast,
      revenueTrend: totalRevenueCurrent > totalRevenueLast ? 'up' : totalRevenueCurrent < totalRevenueLast ? 'down' : 'neutral',
      pendingCurrent: totalPendingCurrent,
      pendingLastWeek: totalPendingLastWeek,
      pendingTrend: totalPendingCurrent > totalPendingLastWeek ? 'growing' : totalPendingCurrent < totalPendingLastWeek ? 'shrinking' : 'neutral',
      riskCount: overallRiskCount,
      newTrials: overallNewTrials,
      convertedTrials: overallConvertedTrials,
      trialsConversionRate: overallTrialsRate,
      trialsAnomaly: overallTrialsAnomaly,
      notifications: { sent: overallNotifsSent, failed: overallNotifsFailed, total: totalNotifs, failRate: overallFailRate },
    },
    bestGym,
    worstGym,
    expiringSoonDays: owner.expiring_soon_days || 7,
  };
}

/**
 * WhatsApp message (plain text, concise, actionable items).
 */
function buildWhatsappMessage(summary, dateStr) {
  const lines = [];
  lines.push(`📊 MS FitOS Owner Daily Summary — ${dateStr}`);
  lines.push('──────────────────────');

  // Overall KPIs
  lines.push(`💰 Revenue: ${formatCurrency(summary.totals.revenueCurrent)} (${summary.totals.revenueTrend === 'up' ? '📈 ↑' : summary.totals.revenueTrend === 'down' ? '📉 ↓' : '→'} vs last month)`);
  lines.push(`⚠️ Pending: ${formatCurrency(summary.totals.pendingCurrent)} (${summary.totals.pendingTrend === 'growing' ? '📈 growing' : '📉 shrinking'} vs last week)`);
  lines.push(`🆕 Trials conversion: ${summary.totals.trialsConversionRate}% ${summary.totals.trialsAnomaly ? '⚠️ (Anomaly: 0% conversions!)' : ''}`);

  if (summary.bestGym && summary.perGymData.length > 1) {
    lines.push(`🏆 Top Gym: ${summary.bestGym.name} (${formatCurrency(summary.bestGym.revenue)})`);
    if (summary.worstGym && summary.worstGym.revenue === 0) {
      lines.push(`🚨 Zero Revenue Warning: ${summary.worstGym.name}`);
    }
  }

  lines.push('──────────────────────');
  lines.push('🏢 Gym-wise Breakdown:');
  for (const gym of summary.perGymData) {
    lines.push(`\n[${gym.gymName}]`);
    lines.push(`Total: ${gym.totalMembers} | Active: ${gym.activeMembers} | Expired: ${gym.expiredMembers}`);
    lines.push(`Trial: ${gym.trialMembersCount} | Converted: ${gym.converted} | Lost: ${gym.trialLostCount}`);
    lines.push(`Today Added: ${gym.membersAddedToday} | Today Revenue: ${formatCurrency(gym.todayRevenue)} | Month Revenue: ${formatCurrency(gym.revenueThisPeriod)}`);
  }

  lines.push('──────────────────────');
  lines.push('📋 Top Actions for Renewals:');

  let actionCount = 0;
  for (const gym of summary.perGymData) {
    if (gym.expiringSoon.length > 0 && actionCount < 5) {
      lines.push(`\n[${gym.gymName} - Expiring Soon]`);
      gym.expiringSoon.slice(0, 3).forEach(m => {
        const diffMs = new Date(m.expiry_date).getTime() - Date.now();
        const diffDays = Math.max(0, Math.round(diffMs / (1000 * 60 * 60 * 24)));
        lines.push(`• ${m.name} (${m.phone}) - ${diffDays}d left`);
        actionCount++;
      });
    }

    if (gym.expiredToday.length > 0 && actionCount < 5) {
      lines.push(`\n[${gym.gymName} - Expired Today]`);
      gym.expiredToday.slice(0, 2).forEach(m => {
        lines.push(`• ${m.name} (${m.phone}) - Renew now`);
        actionCount++;
      });
    }
  }

  return lines.join('\n');
}

/**
 * Rich HTML Email template.
 */
function buildEmailHtml(summary, dateStr, ownerName) {
  const gymSections = summary.perGymData
    .map((gym) => {
      const expiringSoonRows = gym.expiringSoon
        .slice(0, 5)
        .map((m) => {
          const diffMs = new Date(m.expiry_date).getTime() - Date.now();
          const diffDays = Math.max(0, Math.round(diffMs / (1000 * 60 * 60 * 24)));
          return `<tr><td style="padding:6px;border-bottom:1px solid #2A2925;">${m.name}</td><td style="padding:6px;border-bottom:1px solid #2A2925;">${m.phone}</td><td style="padding:6px;border-bottom:1px solid #2A2925;color:#EAB308;">${diffDays} days left</td></tr>`;
        })
        .join('');

      const expiredRows = gym.expiredToday
        .slice(0, 5)
        .map((m) => `<tr><td style="padding:6px;border-bottom:1px solid #2A2925;">${m.name}</td><td style="padding:6px;border-bottom:1px solid #2A2925;">${m.phone}</td><td style="padding:6px;border-bottom:1px solid #2A2925;color:#EF4444;">Expired</td></tr>`)
        .join('');

      return `
        <div style="margin-bottom:24px;padding:16px;background:#1E1D1A;border-radius:8px;border:1px solid #2A2925;">
          <h2 style="color:#C9A84C;margin:0 0 12px 0;font-size:18px;">🏋️ ${gym.gymName}</h2>
          
          <table style="width:100%;color:#E5E7EB;font-size:13px;margin-bottom:12px;border-collapse:collapse;">
            <tr>
              <td style="padding:6px;background:#111110;border:1px solid #2A2925;"><strong>Month Revenue:</strong> ${formatCurrency(gym.revenueThisPeriod)}</td>
              <td style="padding:6px;background:#111110;border:1px solid #2A2925;"><strong>Pending:</strong> ${formatCurrency(gym.pendingAmount)} (${gym.pendingCount})</td>
            </tr>
            <tr>
              <td style="padding:6px;background:#111110;border:1px solid #2A2925;"><strong>Trials rate:</strong> ${gym.trialConversionRate}% ${gym.trialAnomaly ? '<span style="color:#EF4444;">⚠️ 0%!</span>' : ''}</td>
              <td style="padding:6px;background:#111110;border:1px solid #2A2925;"><strong>Churn Risk:</strong> <span style="${gym.riskCount > 0 ? 'color:#EF4444;font-weight:bold;' : ''}">${gym.riskCount} members</span></td>
            </tr>
            <tr>
              <td style="padding:6px;background:#111110;border:1px solid #2A2925;"><strong>Total/Active/Expired:</strong> ${gym.totalMembers} / ${gym.activeMembers} / ${gym.expiredMembers}</td>
              <td style="padding:6px;background:#111110;border:1px solid #2A2925;"><strong>Trial/Converted/Lost:</strong> ${gym.trialMembersCount} / ${gym.converted} / ${gym.trialLostCount}</td>
            </tr>
            <tr>
              <td style="padding:6px;background:#111110;border:1px solid #2A2925;"><strong>Today Added:</strong> ${gym.membersAddedToday} members | <strong>Today Revenue:</strong> ${formatCurrency(gym.todayRevenue)}</td>
              <td style="padding:6px;background:#111110;border:1px solid #2A2925;"><strong>Month Revenue:</strong> ${formatCurrency(gym.revenueThisPeriod)}</td>
            </tr>
            <tr>
              <td colspan="2" style="padding:6px;background:#111110;border:1px solid #2A2925;color:${gym.notificationHealth.failRate > 15 ? '#EF4444' : '#E5E7EB'}">
                <strong>Notification Delivery:</strong> Fail rate: ${gym.notificationHealth.failRate}% (${gym.notificationHealth.failed}/${gym.notificationHealth.total})
              </td>
            </tr>
          </table>

          ${expiringSoonRows ? `<h3 style="color:#C9A84C;font-size:14px;margin:12px 0 6px 0;">⚠️ Expiring Soon</h3><table style="width:100%;color:#E5E7EB;font-size:12px;margin-bottom:12px;border-collapse:collapse;">${expiringSoonRows}</table>` : ''}
          ${expiredRows ? `<h3 style="color:#EF4444;font-size:14px;margin:12px 0 6px 0;">❌ Expired Recently</h3><table style="width:100%;color:#E5E7EB;font-size:12px;margin-bottom:12px;border-collapse:collapse;">${expiredRows}</table>` : ''}
        </div>
      `;
    })
    .join('');

  const worstGymAlert = (summary.worstGym && summary.worstGym.revenue === 0) 
    ? `<div style="background:#EF4444;color:#FFF;padding:12px;border-radius:6px;font-weight:bold;text-align:center;margin-bottom:16px;">
        🚨 ZERO REVENUE ALERT: ${summary.worstGym.name} generated ₹0 this period!
       </div>`
    : '';

  return `
    <div style="font-family:Inter,Arial,sans-serif;background:#111110;color:#E5E7EB;padding:24px;max-width:640px;margin:0 auto;">
      <div style="text-align:center;margin-bottom:24px;">
        <h1 style="color:#C9A84C;font-size:22px;margin:0;">MS FitOS — Executive Summary</h1>
        <p style="color:#9E9A90;margin:4px 0 0;">Hi ${ownerName}, here is your daily multi-gym report for ${dateStr}</p>
      </div>

      ${worstGymAlert}

      <div style="padding:16px;background:#1E1D1A;border-radius:8px;border:2px solid #C9A84C;margin-bottom:24px;">
        <h2 style="color:#C9A84C;margin:0 0 12px 0;font-size:18px;">📊 Overall Performance Summary</h2>
        <table style="width:100%;color:#E5E7EB;font-size:14px;border-collapse:collapse;">
          <tr style="border-bottom:1px solid #2A2925;"><td style="padding:8px 0;">Current Period Revenue</td><td style="text-align:right;font-weight:bold;color:#22C55E;">${formatCurrency(summary.totals.revenueCurrent)} (${summary.totals.revenueTrend === 'up' ? '📈 ↑' : '📉 ↓'})</td></tr>
          <tr style="border-bottom:1px solid #2A2925;"><td style="padding:8px 0;">Pending Payments Backlog</td><td style="text-align:right;font-weight:bold;color:#EAB308;">${formatCurrency(summary.totals.pendingCurrent)} (${summary.totals.pendingTrend})</td></tr>
          <tr style="border-bottom:1px solid #2A2925;"><td style="padding:8px 0;">Attendance Churn Risks</td><td style="text-align:right;font-weight:bold;color:#EF4444;">${summary.totals.riskCount} members</td></tr>
          <tr style="border-bottom:1px solid #2A2925;"><td style="padding:8px 0;">Trial Conversion Rate</td><td style="text-align:right;font-weight:bold;color:${summary.totals.trialsAnomaly ? '#EF4444' : '#22C55E'}">${summary.totals.trialsConversionRate}% ${summary.totals.trialsAnomaly ? '(Anomaly: 0%!)' : ''}</td></tr>
          <tr><td style="padding:8px 0;">Notification Fail Rate</td><td style="text-align:right;font-weight:bold;color:${summary.totals.notifications.failRate > 15 ? '#EF4444' : '#E5E7EB'}">${summary.totals.notifications.failRate}%</td></tr>
        </table>
      </div>

      ${gymSections}

      <p style="text-align:center;color:#6B6860;font-size:12px;margin-top:24px;">
        Sent by MS FitOS • ${dateStr}
      </p>
    </div>
  `;
}

/**
 * Process summaries for all registered owners.
 */
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

      // 1. Send Rich Email via Brevo
      if (owner.email) {
        try {
          const html = buildEmailHtml(summary, dateStr, owner.name);
          await sendEmail({
            to: owner.email,
            subject: `MS FitOS — Daily Executive Summary (${dateStr})`,
            html,
          });
          console.log(`[OwnerSummary] Rich Email sent to ${owner.email}`);
        } catch (emailErr) {
          console.error(`[OwnerSummary] Email failed for ${owner.email}:`, emailErr?.message);
        }
      }

      // 2. WhatsApp integration removed with Baileys cleanup.
      if (owner.whatsapp_verified && owner.whatsapp_number) {
        // await sendWhatsappMessage({
        //   gymId: ownerSessionKey(owner.id),
        //   phone: owner.whatsapp_number,
        //   message,
        // });
        console.log(`[OwnerSummary] WhatsApp skipped for ${owner.name} (integration removed)`);
      } else {
        console.log(`[OwnerSummary] WhatsApp skipped for ${owner.name} (not verified)`);
      }

      sentCount++;
    } catch (ownerErr) {
      console.error(`[OwnerSummary] Failed for owner ${owner.name}:`, ownerErr?.message);
    }
  }

  console.log(`[OwnerSummary] Processed summaries for ${sentCount}/${owners.length} owners`);
}

async function sendTestOwnerSummary(ownerId) {
  // await sendWhatsappMessage({ gymId: ownerSessionKey(owner.id), phone: owner.whatsapp_number, message });
  throw new Error('WhatsApp integration has been removed');
}

module.exports = { processAllOwnerSummaries, buildOwnerSummary, sendTestOwnerSummary };
