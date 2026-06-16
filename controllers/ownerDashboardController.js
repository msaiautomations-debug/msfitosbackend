const prisma = require('../utils/prisma');

function formatCurrency(amount) {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(Number(amount || 0));
}

async function getOwnerGymIds(ownerId) {
  const access = await prisma.admin_gym_access.findMany({
    where: { owner_id: ownerId },
    select: { gym_id: true },
  });
  return access.map((a) => a.gym_id);
}

// Helper function to calculate gym card data
async function calculateGymCardData(gym, now, expiringSoonDays, monthStart, monthEnd, todayStart, todayEnd) {
  const members = await prisma.members.findMany({
    where: { gym_id: gym.id },
    select: {
      id: true,
      expiry_date: true,
      is_inactive: true,
      is_paused: true,
      amount: true,
      payment_status: true,
      payment_method: true,
      plan_duration: true,
      created_at: true,
    },
  });

  const total = members.length;
  let active = 0;
  let expired = 0;
  let expiringSoon = 0;
  let pendingCount = 0;
  let pendingAmount = 0;
  let todaysAddedMembers = 0;
  let monthlyRevenue = 0;
  let todayRevenue = 0;

  const expiringSoonEnd = new Date(now);
  expiringSoonEnd.setDate(expiringSoonEnd.getDate() + expiringSoonDays);

  for (const m of members) {
    const expiryDate = new Date(m.expiry_date);
    const isExpired = expiryDate < now;
    const isActive = !m.is_inactive && !isExpired;
    const isExpiringSoon = !m.is_inactive && expiryDate >= now && expiryDate <= expiringSoonEnd;
    const isPending = !m.payment_method || m.payment_status === 'pending';

    if (isActive) active++;
    if (isExpired && !m.is_inactive) expired++;
    if (isExpiringSoon) expiringSoon++;

    if (isPending && !m.is_inactive) {
      pendingCount++;
      pendingAmount += Number(m.amount || 0);
    }

    // Today's added members
    if (m.created_at >= todayStart && m.created_at <= todayEnd) {
      todaysAddedMembers++;
    }

    // Monthly revenue
    if (
      m.payment_status === 'paid' &&
      m.created_at >= monthStart &&
      m.created_at <= monthEnd
    ) {
      monthlyRevenue += Number(m.amount || 0);
    }

    // Today's revenue
    if (
      m.payment_status === 'paid' &&
      m.created_at >= todayStart &&
      m.created_at <= todayEnd
    ) {
      todayRevenue += Number(m.amount || 0);
    }
  }

  // Fetch trial users stats
  const trialUsers = await prisma.trial_users.findMany({
    where: { gym_id: gym.id },
    select: { status: true },
  });
  const trialMembers = trialUsers.filter((t) => t.status === 'trial').length;
  const trialConverted = trialUsers.filter((t) => t.status === 'converted').length;
  const trialLost = trialUsers.filter((t) => t.status === 'lost').length;
  const totalEverTrial = trialUsers.length;
  const trialConversionRate = totalEverTrial > 0
    ? Math.round((trialConverted / totalEverTrial) * 100)
    : 0;
  const trialLostRate = totalEverTrial > 0
    ? Math.round((trialLost / totalEverTrial) * 100)
    : 0;

  return {
    id: gym.id,
    gym_name: gym.gym_name,
    logo_url: gym.logo_url,
    totalMembers: total,
    activeMembers: active,
    expiredMembers: expired,
    expiringSoon,
    pendingCount,
    pendingAmount,
    monthlyRevenue,
    todayRevenue,
    todaysAddedMembers,
    trialMembers,
    trialConverted,
    trialLost,
    trialConversionRate,
    trialLostRate,
    revenueTrend: 'neutral',
    notificationFailedRate: 0,
  };
}

const getOwnerDashboard = async (req, res) => {
  try {
    const gymIds = await getOwnerGymIds(req.owner_id);

    if (!gymIds.length) {
      return res.json({
        summary: {
          totalGyms: 0,
          totalMembers: 0,
          activeMembers: 0,
          pendingPaymentsCount: 0,
          pendingPaymentsAmount: 0,
          monthlyRevenue: 0,
          todayRevenue: 0,
          revenueTrend: 'neutral',
          pendingTrend: 'neutral',
          trialAnomaly: false,
          notificationIssue: false,
        },
        gyms: [],
        totalGymCount: 0,
      });
    }

    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
    const todayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
    
    const expiringSoonDays = req.owner.expiring_soon_days || 7;
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);

    // Only fetch first 4 gyms for initial load
    const limit = 4;
    const gyms = await prisma.gyms.findMany({
      where: { id: { in: gymIds } },
      select: { id: true, gym_name: true, logo_url: true },
      take: limit,
    });

    const gymCards = [];
    let totalMembers = 0;
    let totalActive = 0;
    let totalPendingCount = 0;
    let totalPendingAmount = 0;
    let totalMonthlyRevenue = 0;
    let totalTodayRevenue = 0;

    for (const gym of gyms) {
      const gymCard = await calculateGymCardData(gym, now, expiringSoonDays, monthStart, monthEnd, todayStart, todayEnd);
      gymCards.push(gymCard);

      totalMembers += gymCard.totalMembers;
      totalActive += gymCard.activeMembers;
      totalPendingCount += gymCard.pendingCount;
      totalPendingAmount += gymCard.pendingAmount;
      totalMonthlyRevenue += gymCard.monthlyRevenue;
      totalTodayRevenue += gymCard.todayRevenue;
    }

    res.json({
      summary: {
        totalGyms: gymIds.length,
        totalMembers,
        activeMembers: totalActive,
        pendingPaymentsCount: totalPendingCount,
        pendingPaymentsAmount: totalPendingAmount,
        monthlyRevenue: totalMonthlyRevenue,
        todayRevenue: totalTodayRevenue,
        revenueTrend: 'neutral',
        pendingTrend: 'neutral',
        trialAnomaly: false,
        notificationIssue: false,
      },
      gyms: gymCards,
      totalGymCount: gymIds.length,
      ownerName: req.owner.name,
      expiringSoonDays: expiringSoonDays,
    });
  } catch (err) {
    console.error('Owner dashboard error', err);
    res.status(500).json({
      error: 'Failed to load dashboard',
      details: process.env.NODE_ENV !== 'production' ? err.message : undefined,
    });
  }
};

const getGymDetails = async (req, res) => {
  try {
    const { gymId } = req.params;
    const gymIds = await getOwnerGymIds(req.owner_id);

    if (!gymIds.includes(gymId)) {
      return res.status(403).json({ error: 'You do not have access to this gym' });
    }

    const gym = await prisma.gyms.findUnique({
      where: { id: gymId },
      select: { id: true, gym_name: true, logo_url: true },
    });

    if (!gym) {
      return res.status(404).json({ error: 'Gym not found' });
    }

    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
    const todayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
    
    const expiringSoonDays = req.owner.expiring_soon_days || 7;
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);

    const gymData = await calculateGymCardData(gym, now, expiringSoonDays, monthStart, monthEnd, todayStart, todayEnd);

    res.json(gymData);
  } catch (err) {
    console.error('Gym details error', err);
    res.status(500).json({
      error: 'Failed to load gym details',
      details: process.env.NODE_ENV !== 'production' ? err.message : undefined,
    });
  }
};

const getOwnerGymMembers = async (req, res) => {
  try {
    const { gymId } = req.params;
    const gymIds = await getOwnerGymIds(req.owner_id);

    if (!gymIds.includes(gymId)) {
      return res.status(403).json({ error: 'You do not have access to this gym' });
    }

    const { q = '', status = 'all', payment = 'all', limit = 50, offset = 0 } = req.query;
    const parsedLimit = Math.min(100, Math.max(1, Number(limit) || 50));
    const parsedOffset = Math.max(0, Number(offset) || 0);

    const where = { gym_id: gymId };
    const now = new Date();

    // Status filter
    if (status === 'active') {
      where.is_inactive = false;
      where.expiry_date = { gte: now };
    } else if (status === 'expired') {
      where.is_inactive = false;
      where.expiry_date = { lt: now };
    } else if (status === 'paused') {
      where.is_paused = true;
    } else if (status === 'inactive') {
      where.is_inactive = true;
    }

    // Payment filter
    if (payment === 'paid') {
      where.payment_status = 'paid';
    } else if (payment === 'pending') {
      where.OR = [
        { payment_status: 'pending' },
        { payment_method: null },
      ];
    }

    // Search
    if (q.trim()) {
      const search = q.trim();
      const searchConditions = [
        { name: { contains: search, mode: 'insensitive' } },
        { phone: { contains: search, mode: 'insensitive' } },
      ];

      if (where.OR) {
        // Combine with existing OR
        where.AND = [{ OR: where.OR }, { OR: searchConditions }];
        delete where.OR;
      } else {
        where.OR = searchConditions;
      }
    }

    const [members, total] = await Promise.all([
      prisma.members.findMany({
        where,
        select: {
          id: true,
          name: true,
          phone: true,
          email: true,
          plan_duration: true,
          start_date: true,
          expiry_date: true,
          amount: true,
          payment_status: true,
          payment_method: true,
          is_paused: true,
          is_inactive: true,
          created_at: true,
          membership_plan: { select: { id: true, name: true, duration_days: true } },
        },
        orderBy: [{ created_at: 'desc' }],
        take: parsedLimit,
        skip: parsedOffset,
      }),
      prisma.members.count({ where }),
    ]);

    const gym = await prisma.gyms.findUnique({
      where: { id: gymId },
      select: { gym_name: true },
    });

    res.json({
      members,
      total,
      limit: parsedLimit,
      offset: parsedOffset,
      hasMore: parsedOffset + parsedLimit < total,
      gymName: gym?.gym_name || '',
    });
  } catch (err) {
    console.error('Owner gym members error', err);
    res.status(500).json({
      error: 'Failed to load members',
      details: process.env.NODE_ENV !== 'production' ? err.message : undefined,
    });
  }
};

const getOwnerCharts = async (req, res) => {
  try {
    const gymIds = await getOwnerGymIds(req.owner_id);

    if (!gymIds.length) {
      return res.json({ memberGrowth: [], revenue: [], trialStats: [] });
    }

    const gyms = await prisma.gyms.findMany({
      where: { id: { in: gymIds } },
      select: { id: true, gym_name: true },
    });

    const gymNameMap = {};
    gyms.forEach((g) => { gymNameMap[g.id] = g.gym_name; });

    // Member growth per gym per month (last 12 months)
    const twelveMonthsAgo = new Date();
    twelveMonthsAgo.setMonth(twelveMonthsAgo.getMonth() - 12);

    const memberGrowthRaw = await prisma.$queryRawUnsafe(`
      SELECT
        gym_id,
        DATE_TRUNC('month', created_at) AS month,
        COUNT(*)::int AS count
      FROM members
      WHERE gym_id = ANY($1) AND created_at >= $2
      GROUP BY gym_id, DATE_TRUNC('month', created_at)
      ORDER BY month ASC
    `, gymIds, twelveMonthsAgo);

    const memberGrowth = memberGrowthRaw.map((row) => ({
      gymId: row.gym_id,
      gymName: gymNameMap[row.gym_id] || row.gym_id,
      month: new Date(row.month).toISOString().slice(0, 7),
      count: Number(row.count),
    }));

    // Revenue per gym per month (from members table)
    const revenueRaw = await prisma.$queryRawUnsafe(`
      SELECT
        gym_id,
        DATE_TRUNC('month', created_at) AS month,
        COALESCE(SUM(amount), 0)::float AS total
      FROM members
      WHERE gym_id = ANY($1) AND payment_status = 'paid' AND created_at >= $2
      GROUP BY gym_id, DATE_TRUNC('month', created_at)
      ORDER BY month ASC
    `, gymIds, twelveMonthsAgo);

    const revenue = revenueRaw.map((row) => ({
      gymId: row.gym_id,
      gymName: gymNameMap[row.gym_id] || row.gym_id,
      month: new Date(row.month).toISOString().slice(0, 7),
      total: Number(row.total),
    }));

    // Trial stats per gym (from members table, plan_duration <= 7)
    const now = new Date();
    const trialStats = [];

    for (const gym of gyms) {
      const trialMembers = await prisma.members.findMany({
        where: { gym_id: gym.id, plan_duration: { lte: 7 } },
        select: { is_inactive: true, expiry_date: true },
      });

      const totalTrial = trialMembers.length;
      const trialActive = trialMembers.filter(
        (m) => !m.is_inactive && new Date(m.expiry_date) >= now,
      ).length;
      const trialLost = trialMembers.filter(
        (m) => !m.is_inactive && new Date(m.expiry_date) < now,
      ).length;

      // Converted: members who had trial duration but somehow got longer duration
      // Since we can't track plan history, approximate as 0 for now
      // or count members with longer plans minus those who were never trial
      const converted = 0;

      trialStats.push({
        gymId: gym.id,
        gymName: gym.gym_name,
        totalTrial,
        trialActive,
        trialLost,
        converted,
      });
    }

    res.json({ memberGrowth, revenue, trialStats });
  } catch (err) {
    console.error('Owner charts error', err);
    res.status(500).json({
      error: 'Failed to load chart data',
      details: process.env.NODE_ENV !== 'production' ? err.message : undefined,
    });
  }
};

const getRevenueTrends = async (req, res) => {
  try {
    const gymIds = await getOwnerGymIds(req.owner_id);

    if (!gymIds.length) {
      return res.json({ revenueTrends: [], pendingBacklog: [] });
    }

    const now = new Date();
    const twelveMonthsAgo = new Date();
    twelveMonthsAgo.setMonth(twelveMonthsAgo.getMonth() - 12);

    // Monthly revenue trends
    const revenueRaw = await prisma.$queryRawUnsafe(`
      SELECT
        g.gym_name,
        DATE_TRUNC('month', m.created_at) AS month,
        COALESCE(SUM(m.amount), 0)::float AS total
      FROM members m
      JOIN gyms g ON m.gym_id = g.id
      WHERE m.gym_id = ANY($1) AND m.payment_status = 'paid' AND m.created_at >= $2
      GROUP BY g.gym_name, DATE_TRUNC('month', m.created_at)
      ORDER BY month ASC
    `, gymIds, twelveMonthsAgo);

    // Group by month
    const revenueTrendsByMonth = {};
    revenueRaw.forEach((row) => {
      const month = new Date(row.month).toISOString().slice(0, 7);
      if (!revenueTrendsByMonth[month]) revenueTrendsByMonth[month] = { month };
      revenueTrendsByMonth[month][row.gym_name] = Number(row.total) || 0;
    });

    const revenueTrends = Object.values(revenueTrendsByMonth).sort((a, b) =>
      new Date(a.month) - new Date(b.month)
    );

    // Weekly pending backlog
    const fourWeeksAgo = new Date();
    fourWeeksAgo.setDate(fourWeeksAgo.getDate() - 28);

    const pendingRaw = await prisma.$queryRawUnsafe(`
      SELECT
        g.gym_name,
        DATE_TRUNC('week', m.created_at) AS week,
        COALESCE(SUM(m.amount), 0)::float AS total
      FROM members m
      JOIN gyms g ON m.gym_id = g.id
      WHERE m.gym_id = ANY($1) AND (m.payment_status = 'pending' OR m.payment_method IS NULL)
        AND m.created_at >= $2
      GROUP BY g.gym_name, DATE_TRUNC('week', m.created_at)
      ORDER BY week ASC
    `, gymIds, fourWeeksAgo);

    const pendingBacklogByWeek = {};
    pendingRaw.forEach((row) => {
      const week = new Date(row.week).toISOString().slice(0, 10);
      if (!pendingBacklogByWeek[week]) pendingBacklogByWeek[week] = { week };
      pendingBacklogByWeek[week][row.gym_name] = Number(row.total) || 0;
    });

    const pendingBacklog = Object.values(pendingBacklogByWeek).sort((a, b) =>
      new Date(a.week) - new Date(b.week)
    );

    res.json({ revenueTrends, pendingBacklog });
  } catch (err) {
    console.error('Revenue trends error', err);
    res.status(500).json({
      error: 'Failed to load revenue trends',
      details: process.env.NODE_ENV !== 'production' ? err.message : undefined,
    });
  }
};

const getMembershipBreakdown = async (req, res) => {
  try {
    const gymIds = await getOwnerGymIds(req.owner_id);

    if (!gymIds.length) {
      return res.json({ breakdown: [] });
    }

    const breakdown = await prisma.$queryRawUnsafe(`
      SELECT
        m.gym_id,
        g.gym_name,
        mp.id as planId,
        mp.name as planName,
        mp.duration_days as durationDays,
        COALESCE(SUM(m.amount), 0)::float AS revenue,
        COUNT(CASE WHEN m.payment_status = 'paid' AND m.expiry_date >= NOW() THEN 1 END)::int AS activeMembers,
        COUNT(CASE WHEN m.created_at >= NOW() - INTERVAL '30 days' THEN 1 END)::int AS newMembers
      FROM members m
      JOIN gyms g ON m.gym_id = g.id
      LEFT JOIN membership_plans mp ON m.membership_plan = mp.id
      WHERE m.gym_id = ANY($1)
      GROUP BY m.gym_id, g.gym_name, mp.id, mp.name, mp.duration_days
      ORDER BY g.gym_name, mp.name
    `, gymIds);

    const result = breakdown.map((row) => ({
      gymId: row.gym_id,
      gymName: row.gym_name,
      planId: row.planId || 'unknown',
      planName: row.planName || 'No Plan',
      durationDays: row.durationDays || 0,
      revenue: Number(row.revenue) || 0,
      activeMembers: Number(row.activeMembers) || 0,
      newMembers: Number(row.newMembers) || 0,
    }));

    res.json({ breakdown: result });
  } catch (err) {
    console.error('Membership breakdown error', err);
    res.status(500).json({
      error: 'Failed to load membership breakdown',
      details: process.env.NODE_ENV !== 'production' ? err.message : undefined,
    });
  }
};

const getRenewals = async (req, res) => {
  try {
    const gymIds = await getOwnerGymIds(req.owner_id);

    if (!gymIds.length) {
      return res.json({
        expiring: [],
        expired: [],
        expiringTotal: 0,
        expiredTotal: 0,
      });
    }

    const { limit = 10, offset = 0 } = req.query;
    const parsedLimit = Math.min(100, Math.max(1, Number(limit) || 10));
    const parsedOffset = Math.max(0, Number(offset) || 0);
    const now = new Date();
    const expiringSoonDays = req.owner?.expiring_soon_days || 7;
    const expiringSoonEnd = new Date(now);
    expiringSoonEnd.setDate(expiringSoonEnd.getDate() + expiringSoonDays);

    // Expiring soon members
    const [expiringMembers, expiringCount] = await Promise.all([
      prisma.members.findMany({
        where: {
          gym_id: { in: gymIds },
          is_inactive: false,
          expiry_date: { gte: now, lte: expiringSoonEnd },
        },
        select: {
          id: true,
          gym_id: true,
          name: true,
          phone: true,
          email: true,
          expiry_date: true,
          last_visit_date: true,
          created_at: true,
        },
        orderBy: { expiry_date: 'asc' },
        take: parsedLimit,
        skip: parsedOffset,
      }),
      prisma.members.count({
        where: {
          gym_id: { in: gymIds },
          is_inactive: false,
          expiry_date: { gte: now, lte: expiringSoonEnd },
        },
      }),
    ]);

    // Recently expired members
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const [expiredMembers, expiredCount] = await Promise.all([
      prisma.members.findMany({
        where: {
          gym_id: { in: gymIds },
          is_inactive: false,
          expiry_date: { lt: now, gte: thirtyDaysAgo },
        },
        select: {
          id: true,
          gym_id: true,
          name: true,
          phone: true,
          email: true,
          expiry_date: true,
          last_visit_date: true,
          created_at: true,
        },
        orderBy: { expiry_date: 'desc' },
        take: parsedLimit,
        skip: parsedOffset,
      }),
      prisma.members.count({
        where: {
          gym_id: { in: gymIds },
          is_inactive: false,
          expiry_date: { lt: now, gte: thirtyDaysAgo },
        },
      }),
    ]);

    // Get gym names
    const gyms = await prisma.gyms.findMany({
      where: { id: { in: gymIds } },
      select: { id: true, gym_name: true },
    });
    const gymMap = Object.fromEntries(gyms.map((g) => [g.id, g.gym_name]));

    const expiring = expiringMembers.map((m) => ({
      ...m,
      gymName: gymMap[m.gym_id] || '',
    }));

    const expired = expiredMembers.map((m) => ({
      ...m,
      gymName: gymMap[m.gym_id] || '',
    }));

    res.json({
      expiring,
      expired,
      expiringTotal: expiringCount,
      expiredTotal: expiredCount,
    });
  } catch (err) {
    console.error('Renewals error', err);
    res.status(500).json({
      error: 'Failed to load renewals',
      details: process.env.NODE_ENV !== 'production' ? err.message : undefined,
    });
  }
};

const getAttendance = async (req, res) => {
  try {
    const gymIds = await getOwnerGymIds(req.owner_id);

    if (!gymIds.length) {
      return res.json({ riskList: [], riskTotal: 0 });
    }

    const { limit = 10, offset = 0 } = req.query;
    const parsedLimit = Math.min(100, Math.max(1, Number(limit) || 10));
    const parsedOffset = Math.max(0, Number(offset) || 0);

    // Members with low attendance (churn risk)
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const riskMembers = await prisma.$queryRawUnsafe(`
      SELECT
        m.id,
        m.gym_id,
        g.gym_name,
        m.name,
        m.phone,
        m.email,
        m.expiry_date,
        COUNT(a.id)::int AS attendanceCount,
        MAX(a.attendance_date) AS lastAttendance
      FROM members m
      JOIN gyms g ON m.gym_id = g.id
      LEFT JOIN attendances a ON m.id = a.member_id AND a.attendance_date >= $2
      WHERE m.gym_id = ANY($1) AND m.is_inactive = false AND m.expiry_date > NOW()
      GROUP BY m.id, m.gym_id, g.gym_name, m.name, m.phone, m.email, m.expiry_date
      HAVING COUNT(a.id) < 5
      ORDER BY COUNT(a.id) ASC, m.name ASC
      LIMIT $3 OFFSET $4
    `, gymIds, thirtyDaysAgo, parsedLimit, parsedOffset);

    const riskTotal = await prisma.$queryRawUnsafe(`
      SELECT COUNT(DISTINCT m.id)::int as count
      FROM members m
      LEFT JOIN attendances a ON m.id = a.member_id AND a.attendance_date >= $2
      WHERE m.gym_id = ANY($1) AND m.is_inactive = false AND m.expiry_date > NOW()
      GROUP BY m.id
      HAVING COUNT(a.id) < 5
    `, gymIds, thirtyDaysAgo);

    const riskList = riskMembers.map((m) => ({
      id: m.id,
      gym_id: m.gym_id,
      gymName: m.gym_name,
      name: m.name,
      phone: m.phone,
      email: m.email,
      expiry_date: m.expiry_date,
      attendanceCount: Number(m.attendanceCount) || 0,
      lastAttendance: m.lastAttendance,
    }));

    res.json({
      riskList,
      riskTotal: riskTotal.length > 0 ? Number(riskTotal[0].count) : 0,
    });
  } catch (err) {
    console.error('Attendance error', err);
    res.status(500).json({
      error: 'Failed to load attendance data',
      details: process.env.NODE_ENV !== 'production' ? err.message : undefined,
    });
  }
};

const getTrials = async (req, res) => {
  try {
    const gymIds = await getOwnerGymIds(req.owner_id);

    if (!gymIds.length) {
      return res.json({ funnel: {}, details: [] });
    }

    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const trials = await prisma.members.findMany({
      where: {
        gym_id: { in: gymIds },
        plan_duration: { lte: 7 },
        created_at: { gte: thirtyDaysAgo },
      },
      select: {
        id: true,
        gym_id: true,
        name: true,
        phone: true,
        expiry_date: true,
        is_inactive: true,
        created_at: true,
      },
    });

    const gyms = await prisma.gyms.findMany({
      where: { id: { in: gymIds } },
      select: { id: true, gym_name: true },
    });
    const gymMap = Object.fromEntries(gyms.map((g) => [g.id, g.gym_name]));

    const now = new Date();
    const totalTrials = trials.length;
    const activeTrials = trials.filter((t) => !t.is_inactive && new Date(t.expiry_date) >= now).length;
    const convertedTrials = trials.filter((t) => !t.is_inactive && new Date(t.expiry_date) >= now).length;
    const lostTrials = trials.filter((t) => !t.is_inactive && new Date(t.expiry_date) < now).length;

    const funnel = {
      total: totalTrials,
      active: activeTrials,
      converted: convertedTrials,
      lost: lostTrials,
      conversionRate: totalTrials > 0 ? Math.round((convertedTrials / totalTrials) * 100) : 0,
    };

    const details = trials.map((t) => ({
      ...t,
      gymName: gymMap[t.gym_id] || '',
    }));

    res.json({ funnel, details });
  } catch (err) {
    console.error('Trials error', err);
    res.status(500).json({
      error: 'Failed to load trials data',
      details: process.env.NODE_ENV !== 'production' ? err.message : undefined,
    });
  }
};

const getTrainers = async (req, res) => {
  try {
    const gymIds = await getOwnerGymIds(req.owner_id);

    if (!gymIds.length) {
      return res.json({ trainers: [] });
    }

    const trainers = await prisma.trainers.findMany({
      where: { gym_id: { in: gymIds } },
      select: {
        id: true,
        gym_id: true,
        name: true,
        email: true,
        phone: true,
        specialization: true,
        created_at: true,
      },
    });

    res.json({ trainers });
  } catch (err) {
    console.error('Trainers error', err);
    res.status(500).json({
      error: 'Failed to load trainers',
      details: process.env.NODE_ENV !== 'production' ? err.message : undefined,
    });
  }
};

const getLeads = async (req, res) => {
  try {
    const gymIds = await getOwnerGymIds(req.owner_id);

    if (!gymIds.length) {
      return res.json({ leads: [] });
    }

    const leads = await prisma.trial_users.findMany({
      where: { gym_id: { in: gymIds } },
      select: {
        id: true,
        gym_id: true,
        name: true,
        email: true,
        phone: true,
        status: true,
        created_at: true,
      },
      orderBy: { created_at: 'desc' },
      take: 50,
    });

    res.json({ leads });
  } catch (err) {
    console.error('Leads error', err);
    res.status(500).json({
      error: 'Failed to load leads',
      details: process.env.NODE_ENV !== 'production' ? err.message : undefined,
    });
  }
};

const getNotificationsHealth = async (req, res) => {
  try {
    const gymIds = await getOwnerGymIds(req.owner_id);

    if (!gymIds.length) {
      return res.json({
        totalSent: 0,
        totalFailed: 0,
        failureRate: 0,
        byType: {},
      });
    }

    // Basic health metrics
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const notifications = await prisma.gym_notifications.findMany({
      where: {
        gym_id: { in: gymIds },
        created_at: { gte: sevenDaysAgo },
      },
      select: { id: true, status: true },
    });

    const totalSent = notifications.length;
    const totalFailed = notifications.filter((n) => n.status === 'failed').length;
    const failureRate = totalSent > 0 ? Math.round((totalFailed / totalSent) * 100) : 0;

    res.json({
      totalSent,
      totalFailed,
      failureRate,
      byType: {},
    });
  } catch (err) {
    console.error('Notifications health error', err);
    res.status(500).json({
      error: 'Failed to load notifications health',
      details: process.env.NODE_ENV !== 'production' ? err.message : undefined,
    });
  }
};

const getGymComparison = async (req, res) => {
  try {
    const gymIds = await getOwnerGymIds(req.owner_id);

    if (!gymIds.length) {
      return res.json({ comparison: [] });
    }

    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);

    const gyms = await prisma.gyms.findMany({
      where: { id: { in: gymIds } },
      select: { id: true, gym_name: true },
    });

    const comparison = [];

    for (const gym of gyms) {
      const members = await prisma.members.findMany({
        where: { gym_id: gym.id },
        select: {
          expiry_date: true,
          is_inactive: true,
          amount: true,
          payment_status: true,
          created_at: true,
        },
      });

      const total = members.length;
      const active = members.filter((m) => !m.is_inactive && new Date(m.expiry_date) >= now).length;
      const revenue = members
        .filter((m) => m.payment_status === 'paid' && m.created_at >= monthStart && m.created_at <= monthEnd)
        .reduce((sum, m) => sum + Number(m.amount || 0), 0);

      comparison.push({
        gym_id: gym.id,
        gym_name: gym.gym_name,
        totalMembers: total,
        activeMembers: active,
        monthlyRevenue: revenue,
      });
    }

    res.json({ comparison });
  } catch (err) {
    console.error('Gym comparison error', err);
    res.status(500).json({
      error: 'Failed to load gym comparison',
      details: process.env.NODE_ENV !== 'production' ? err.message : undefined,
    });
  }
};

module.exports = {
  getOwnerDashboard,
  getGymDetails,
  getOwnerGymMembers,
  getOwnerCharts,
  getRevenueTrends,
  getMembershipBreakdown,
  getRenewals,
  getAttendance,
  getTrials,
  getTrainers,
  getLeads,
  getNotificationsHealth,
  getGymComparison,
};
