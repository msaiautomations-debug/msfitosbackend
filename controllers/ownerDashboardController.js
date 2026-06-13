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
        },
        gyms: [],
      });
    }

    const now = new Date();
    const expiringSoonDays = req.owner.expiring_soon_days || 7;
    const expiringSoonEnd = new Date(now);
    expiringSoonEnd.setDate(expiringSoonEnd.getDate() + expiringSoonDays);

    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);

    const gyms = await prisma.gyms.findMany({
      where: { id: { in: gymIds } },
      select: { id: true, gym_name: true, logo_url: true },
    });

    const gymCards = [];
    let totalMembers = 0;
    let totalActive = 0;
    let totalPendingCount = 0;
    let totalPendingAmount = 0;
    let totalMonthlyRevenue = 0;

    for (const gym of gyms) {
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
      let trialMembers = 0;
      let trialConverted = 0;
      let trialLost = 0;
      let monthlyRevenue = 0;

      for (const m of members) {
        const expiryDate = new Date(m.expiry_date);
        const isExpired = expiryDate < now;
        const isActive = !m.is_inactive && !isExpired;
        const isExpiringSoon = !m.is_inactive && expiryDate >= now && expiryDate <= expiringSoonEnd;
        const isPending = !m.payment_method || m.payment_status === 'pending';
        const isTrial = m.plan_duration <= 7;

        if (isActive) active++;
        if (isExpired && !m.is_inactive) expired++;
        if (isExpiringSoon) expiringSoon++;

        if (isPending && !m.is_inactive) {
          pendingCount++;
          pendingAmount += Number(m.amount || 0);
        }

        // Monthly revenue: paid members created this month
        if (
          m.payment_status === 'paid' &&
          m.created_at >= monthStart &&
          m.created_at <= monthEnd
        ) {
          monthlyRevenue += Number(m.amount || 0);
        }

        // Trial stats
        if (isTrial) {
          if (isActive) trialMembers++;
          if (isExpired && !m.is_inactive) trialLost++;
        }
      }

      // Count members who were trial but now have longer plans (converted)
      // This is an approximation - trial members who renewed to longer plans
      const totalEverTrial = members.filter((m) => m.plan_duration <= 7).length;
      // Members with longer plans who might have started as trial
      const longerPlanMembers = members.filter((m) => m.plan_duration > 7);
      // For conversion rate, use total trial duration members as base
      const trialConversionRate = totalEverTrial > 0
        ? Math.round((trialConverted / totalEverTrial) * 100)
        : 0;
      const trialLostRate = totalEverTrial > 0
        ? Math.round((trialLost / totalEverTrial) * 100)
        : 0;

      gymCards.push({
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
        trialMembers,
        trialConversionRate,
        trialLostRate,
      });

      totalMembers += total;
      totalActive += active;
      totalPendingCount += pendingCount;
      totalPendingAmount += pendingAmount;
      totalMonthlyRevenue += monthlyRevenue;
    }

    res.json({
      summary: {
        totalGyms: gyms.length,
        totalMembers,
        activeMembers: totalActive,
        pendingPaymentsCount: totalPendingCount,
        pendingPaymentsAmount: totalPendingAmount,
        monthlyRevenue: totalMonthlyRevenue,
      },
      gyms: gymCards,
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

module.exports = { getOwnerDashboard, getOwnerGymMembers, getOwnerCharts };
