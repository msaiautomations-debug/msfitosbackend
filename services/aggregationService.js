const prisma = require('../utils/prisma');

/**
 * Normalizes date to the start of the day in local/UTC time.
 */
function getDayBounds(date) {
  const start = new Date(date);
  start.setHours(0, 0, 0, 0);
  const end = new Date(date);
  end.setHours(23, 59, 59, 999);
  return { start, end };
}

/**
 * Gets the start and end dates for a month string like "YYYY-MM"
 */
function getMonthBounds(monthStr) {
  const [year, month] = monthStr.split('-').map(Number);
  const start = new Date(year, month - 1, 1);
  const end = new Date(year, month, 0, 23, 59, 59, 999);
  return { start, end };
}

/**
 * Aggregates all daily precomputations for a specific date.
 */
async function aggregateDailyMetricsForDate(date) {
  const { start: dateStart, end: dateEnd } = getDayBounds(date);
  const dateObj = new Date(dateStart);

  const gyms = await prisma.gyms.findMany({ select: { id: true, gym_name: true } });

  for (const gym of gyms) {
    const gymId = gym.id;

    // 1. gym_revenue_daily
    const paymentsToday = await prisma.payments.findMany({
      where: {
        gym_id: gymId,
        status: 'paid',
        created_at: { gte: dateStart, lte: dateEnd },
      },
      select: { amount: true },
    });
    const revenue = paymentsToday.reduce((sum, p) => sum + (p.amount || 0), 0);

    const pendingMembers = await prisma.members.findMany({
      where: {
        gym_id: gymId,
        is_inactive: false,
        OR: [
          { payment_status: 'pending' },
          { payment_method: null },
        ],
      },
      select: { amount: true },
    });
    const pendingAmount = pendingMembers.reduce((sum, m) => sum + (m.amount || 0), 0);
    const pendingCount = pendingMembers.length;

    await prisma.gym_revenue_daily.upsert({
      where: { gym_id_date: { gym_id: gymId, date: dateObj } },
      update: { revenue, pending_amount: pendingAmount, pending_count: pendingCount },
      create: { gym_id: gymId, date: dateObj, revenue, pending_amount: pendingAmount, pending_count: pendingCount },
    });

    // 2. gym_attendance_daily
    const attendancesToday = await prisma.attendances.findMany({
      where: {
        gym_id: gymId,
        checkin_at: { gte: dateStart, lte: dateEnd },
      },
      select: { member_id: true, checkin_at: true },
    });

    const totalCheckins = attendancesToday.length;
    const uniqueMembers = new Set(attendancesToday.map(a => a.member_id)).size;

    const byHourBreakdown = {};
    for (let h = 0; h < 24; h++) byHourBreakdown[String(h)] = 0;
    attendancesToday.forEach(a => {
      const hour = new Date(a.checkin_at).getHours();
      byHourBreakdown[String(hour)] = (byHourBreakdown[String(hour)] || 0) + 1;
    });

    await prisma.gym_attendance_daily.upsert({
      where: { gym_id_date: { gym_id: gymId, date: dateObj } },
      update: { total_checkins: totalCheckins, unique_members: uniqueMembers, by_hour_breakdown: byHourBreakdown },
      create: { gym_id: gymId, date: dateObj, total_checkins: totalCheckins, unique_members: uniqueMembers, by_hour_breakdown: byHourBreakdown },
    });

    // 3. trial_funnel_daily
    const trialsToday = await prisma.trial_users.findMany({
      where: {
        gym_id: gymId,
        trial_date: { gte: dateStart, lte: dateEnd },
      },
    });
    const newTrials = trialsToday.length;

    // Conversion: Find members created today who matches a trial_users phone number
    const membersCreatedToday = await prisma.members.findMany({
      where: {
        gym_id: gymId,
        created_at: { gte: dateStart, lte: dateEnd },
      },
      select: { phone: true, created_at: true },
    });

    let convertedCount = 0;
    let totalDaysToConvert = 0;

    for (const member of membersCreatedToday) {
      // Find matching trial user
      const trialUser = await prisma.trial_users.findFirst({
        where: {
          gym_id: gymId,
          phone: member.phone,
          status: 'converted',
        },
      });
      if (trialUser) {
        convertedCount++;
        const diffMs = new Date(member.created_at).getTime() - new Date(trialUser.trial_date).getTime();
        const diffDays = Math.max(0, diffMs / (1000 * 60 * 60 * 24));
        totalDaysToConvert += diffDays;
      }
    }

    const avgDaysToConvert = convertedCount > 0 ? (totalDaysToConvert / convertedCount) : 0;

    // Expired trials: Trial status is lost or trial duration expired today
    const trialsExpiredToday = await prisma.trial_users.findMany({
      where: {
        gym_id: gymId,
        OR: [
          { status: 'lost', created_at: { gte: dateStart, lte: dateEnd } },
          {
            status: 'trial',
            trial_date: {
              gte: new Date(dateStart.getTime() - 7 * 24 * 60 * 60 * 1000),
              lte: new Date(dateEnd.getTime() - 7 * 24 * 60 * 60 * 1000),
            },
          },
        ],
      },
    });
    const expiredCount = trialsExpiredToday.length;

    await prisma.trial_funnel_daily.upsert({
      where: { gym_id_date: { gym_id: gymId, date: dateObj } },
      update: { new_trials: newTrials, converted: convertedCount, expired: expiredCount, avg_days_to_convert: avgDaysToConvert },
      create: { gym_id: gymId, date: dateObj, new_trials: newTrials, converted: convertedCount, expired: expiredCount, avg_days_to_convert: avgDaysToConvert },
    });

    // 4. lead_funnel_daily
    // Get all website inquiries for this gym name using Prisma ORM
    const rawInquiries = await prisma.website_inquiries.findMany({
      where: {
        gym_name: {
          equals: gym.gym_name,
          mode: 'insensitive',
        },
        created_at: {
          gte: dateStart,
          lte: dateEnd,
        },
      },
      select: { id: true, phone: true, email: true, created_at: true },
    }).catch(() => []);
    const newInquiries = rawInquiries.length;

    // inquiries_to_trial: website inquiries created in the last 30 days that converted to trial_users today
    const trialsStartedToday = await prisma.trial_users.findMany({
      where: {
        gym_id: gymId,
        trial_date: { gte: dateStart, lte: dateEnd },
      },
      select: { phone: true },
    });

    let inquiriesToTrial = 0;
    const thirtyDaysAgo = new Date(dateStart.getTime() - 30 * 24 * 60 * 60 * 1000);

    if (trialsStartedToday.length > 0) {
      const trialPhones = trialsStartedToday.map(t => t.phone).filter(Boolean);
      
      const matchingInquiries = await prisma.website_inquiries.count({
        where: {
          gym_name: {
            equals: gym.gym_name,
            mode: 'insensitive',
          },
          phone: { in: trialPhones },
          created_at: {
            gte: thirtyDaysAgo,
            lte: dateEnd,
          },
        },
      }).catch(() => 0);
      inquiriesToTrial = matchingInquiries;
    }

    // trials_to_paid: trial users that converted to paid members today
    const trialsToPaid = convertedCount;

    await prisma.lead_funnel_daily.upsert({
      where: { gym_id_date: { gym_id: gymId, date: dateObj } },
      update: { new_inquiries: newInquiries, inquiries_to_trial: inquiriesToTrial, trials_to_paid: trialsToPaid },
      create: { gym_id: gymId, date: dateObj, new_inquiries: newInquiries, inquiries_to_trial: inquiriesToTrial, trials_to_paid: trialsToPaid },
    });

    // 5. notification_health_daily (Email and WhatsApp channels)
    const emailSent = await prisma.email_notifications.count({
      where: { gym_id: gymId, status: 'sent', sent_at: { gte: dateStart, lte: dateEnd } },
    });
    const emailFailed = await prisma.email_notifications.findMany({
      where: { gym_id: gymId, status: 'failed', sent_at: { gte: dateStart, lte: dateEnd } },
      select: { error_message: true },
    });
    const emailErrors = {};
    emailFailed.forEach(f => {
      const msg = f.error_message || 'Unknown Email Error';
      emailErrors[msg] = (emailErrors[msg] || 0) + 1;
    });

    await prisma.notification_health_daily.upsert({
      where: { gym_id_date_channel: { gym_id: gymId, date: dateObj, channel: 'email' } },
      update: { sent_count: emailSent, failed_count: emailFailed.length, errors: emailErrors },
      create: { gym_id: gymId, date: dateObj, channel: 'email', sent_count: emailSent, failed_count: emailFailed.length, errors: emailErrors },
    });

    const waSent = await prisma.gym_notifications.count({
      where: { gym_id: gymId, status: 'sent', sent_at: { gte: dateStart, lte: dateEnd } },
    });
    const waFailed = await prisma.gym_notifications.findMany({
      where: { gym_id: gymId, status: 'failed', sent_at: { gte: dateStart, lte: dateEnd } },
      select: { message: true }, // We sometimes log error inside message in logGymNotification
    });
    const waErrors = {};
    waFailed.forEach(f => {
      const msg = f.message || 'Unknown WhatsApp Error';
      waErrors[msg] = (waErrors[msg] || 0) + 1;
    });

    await prisma.notification_health_daily.upsert({
      where: { gym_id_date_channel: { gym_id: gymId, date: dateObj, channel: 'whatsapp' } },
      update: { sent_count: waSent, failed_count: waFailed.length, errors: waErrors },
      create: { gym_id: gymId, date: dateObj, channel: 'whatsapp', sent_count: waSent, failed_count: waFailed.length, errors: waErrors },
    });
  }
}

/**
 * Aggregates monthly precomputations for a specific month (format "YYYY-MM").
 */
async function aggregateMonthlyMetricsForMonth(monthStr) {
  const { start: monthStart, end: monthEnd } = getMonthBounds(monthStr);

  const gyms = await prisma.gyms.findMany({ select: { id: true } });

  for (const gym of gyms) {
    const gymId = gym.id;

    // 1. gym_plan_performance
    const plans = await prisma.membership_plans.findMany({ where: { gym_id: gymId } });
    for (const plan of plans) {
      const newMembers = await prisma.members.count({
        where: { gym_id: gymId, plan_id: plan.id, created_at: { gte: monthStart, lte: monthEnd } },
      });

      const activeMembers = await prisma.members.count({
        where: {
          gym_id: gymId,
          plan_id: plan.id,
          is_inactive: false,
          start_date: { lte: monthEnd },
          expiry_date: { gte: monthStart },
        },
      });

      // Sum revenue for members belonging to this plan
      const payments = await prisma.payments.findMany({
        where: {
          gym_id: gymId,
          status: 'paid',
          created_at: { gte: monthStart, lte: monthEnd },
          member: { plan_id: plan.id },
        },
        select: { amount: true },
      });
      const revenue = payments.reduce((sum, p) => sum + (p.amount || 0), 0);

      await prisma.gym_plan_performance.upsert({
        where: { gym_id_plan_id_month: { gym_id: gymId, plan_id: plan.id, month: monthStr } },
        update: { revenue, active_members: activeMembers, new_members: newMembers },
        create: { gym_id: gymId, plan_id: plan.id, month: monthStr, revenue, active_members: activeMembers, new_members: newMembers },
      });
    }

    // 2. trainer_performance_monthly
    const trainers = await prisma.trainers.findMany({ where: { gym_id: gymId } });
    for (const trainer of trainers) {
      const sessions = await prisma.trainer_sessions.findMany({
        where: {
          gym_id: gymId,
          trainer_id: trainer.id,
          session_date: { gte: monthStart, lte: monthEnd },
        },
        select: { member_id: true },
      });

      const sessionsCount = sessions.length;
      const trainedMemberIds = [...new Set(sessions.map(s => s.member_id).filter(Boolean))];
      const membersTrained = trainedMemberIds.length;

      let retentionRate = 0;
      if (membersTrained > 0) {
        // How many of these members are currently active
        const now = new Date();
        const activeTrained = await prisma.members.count({
          where: {
            id: { in: trainedMemberIds },
            is_inactive: false,
            expiry_date: { gte: now },
          },
        });
        retentionRate = Math.round((activeTrained / membersTrained) * 100);
      }

      await prisma.trainer_performance_monthly.upsert({
        where: { trainer_id_gym_id_month: { trainer_id: trainer.id, gym_id: gymId, month: monthStr } },
        update: { sessions_count: sessionsCount, members_trained: membersTrained, retention_rate: retentionRate },
        create: { trainer_id: trainer.id, gym_id: gymId, month: monthStr, sessions_count: sessionsCount, members_trained: membersTrained, retention_rate: retentionRate },
      });
    }
  }
}

/**
 * Aggregates state-based queues and lists (renewal queue, attendance risk).
 */
async function aggregateCurrentState() {
  const now = new Date();
  const gyms = await prisma.gyms.findMany({ select: { id: true } });

  for (const gym of gyms) {
    const gymId = gym.id;

    // 1. member_attendance_risk
    const members = await prisma.members.findMany({
      where: { gym_id: gymId },
      select: { id: true, payment_status: true, start_date: true, is_inactive: true },
    });

    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const fourteenDaysAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);

    for (const member of members) {
      // Find last attendance
      const lastAttendance = await prisma.attendances.findFirst({
        where: { member_id: member.id },
        orderBy: { checkin_at: 'desc' },
        select: { checkin_at: true },
      });

      const visitsCount = await prisma.attendances.count({
        where: {
          member_id: member.id,
          checkin_at: { gte: thirtyDaysAgo },
        },
      });

      let status = 'normal';
      // Risk threshold: paid member, not inactive, started at least 14 days ago, but 0 visits in last 30 days
      if (
        member.payment_status === 'paid' &&
        !member.is_inactive &&
        member.start_date <= fourteenDaysAgo &&
        visitsCount === 0
      ) {
        status = 'paid_but_not_attending';
      }

      await prisma.member_attendance_risk.upsert({
        where: { member_id: member.id },
        update: {
          last_visit_date: lastAttendance?.checkin_at || null,
          visits_last_30d: visitsCount,
          status,
        },
        create: {
          member_id: member.id,
          gym_id: gymId,
          last_visit_date: lastAttendance?.checkin_at || null,
          visits_last_30d: visitsCount,
          status,
        },
      });
    }

    // 2. gym_renewal_queue
    // Find all expiring soon and expired members
    // We clean the renewal queue for this gym and rebuild it
    await prisma.gym_renewal_queue.deleteMany({ where: { gym_id: gymId } });

    // Expiring soon window is typically 7-30 days. Let's capture up to 30 days to build a robust list.
    const thirtyDaysFuture = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

    const renewalMembers = await prisma.members.findMany({
      where: {
        gym_id: gymId,
        is_inactive: false,
        OR: [
          { expiry_date: { lt: now } }, // Expired
          { expiry_date: { gte: now, lte: thirtyDaysFuture } }, // Expiring soon
        ],
      },
      select: { id: true, name: true, phone: true, expiry_date: true },
    });

    for (const member of renewalMembers) {
      const lastAttendance = await prisma.attendances.findFirst({
        where: { member_id: member.id },
        orderBy: { checkin_at: 'desc' },
        select: { checkin_at: true },
      });

      const status = member.expiry_date < now ? 'expired' : 'expiring';

      await prisma.gym_renewal_queue.create({
        data: {
          gym_id: gymId,
          member_id: member.id,
          status,
          expiry_date: member.expiry_date,
          last_visit_date: lastAttendance?.checkin_at || null,
          phone: member.phone,
          name: member.name,
        },
      });
    }
  }
}

/**
 * Main function to run the nightly precomputation job.
 */
async function runNightlyAggregation() {
  const now = new Date();
  console.log(`[AggregationJob] Starting nightly aggregation at ${now.toISOString()}`);
  try {
    // 1. Compute today's metrics
    await aggregateDailyMetricsForDate(now);

    // 2. Compute current month's metrics
    const currentMonth = now.toISOString().slice(0, 7); // "YYYY-MM"
    await aggregateMonthlyMetricsForMonth(currentMonth);

    // 3. Compute current queue/risk state
    await aggregateCurrentState();

    console.log(`[AggregationJob] Nightly aggregation completed successfully.`);
  } catch (err) {
    console.error(`[AggregationJob] Error in nightly aggregation:`, err);
    throw err;
  }
}

/**
 * Backfills historical daily and monthly aggregates for the last N days.
 */
async function backfillHistoricalData(daysCount = 30) {
  console.log(`[AggregationJob] Starting historical backfill for last ${daysCount} days...`);
  const now = new Date();
  
  // Aggregate daily metrics day by day backwards
  for (let i = daysCount; i >= 0; i--) {
    const targetDate = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
    console.log(`[AggregationJob] Backfilling daily metrics for ${targetDate.toISOString().slice(0, 10)}`);
    await aggregateDailyMetricsForDate(targetDate);
  }

  // Aggregate monthly metrics for last 6 months
  const monthsToBackfill = new Set();
  for (let i = 0; i <= 6; i++) {
    const targetDate = new Date(now.getFullYear(), now.getMonth() - i, 1);
    monthsToBackfill.add(targetDate.toISOString().slice(0, 7));
  }

  for (const monthStr of monthsToBackfill) {
    console.log(`[AggregationJob] Backfilling monthly metrics for ${monthStr}`);
    await aggregateMonthlyMetricsForMonth(monthStr);
  }

  // Aggregate current state
  console.log(`[AggregationJob] Aggregating current queue/risk state`);
  await aggregateCurrentState();

  console.log(`[AggregationJob] Historical backfill completed successfully.`);
}

module.exports = {
  aggregateDailyMetricsForDate,
  aggregateMonthlyMetricsForMonth,
  aggregateCurrentState,
  runNightlyAggregation,
  backfillHistoricalData,
};
