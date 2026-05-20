const prisma = require('../utils/prisma');
const { measureAsync } = require('../utils/performance');

const DASHBOARD_CACHE_TTL_MS = Number(process.env.DASHBOARD_CACHE_TTL_MS || 60 * 1000);
const ANALYTICS_CACHE_TTL_MS = Number(process.env.ANALYTICS_CACHE_TTL_MS || 60 * 1000);
const DASHBOARD_MAX_INFLIGHT = Number(process.env.DASHBOARD_MAX_INFLIGHT || 6);
const dashboardCache = new Map();
const analyticsCache = new Map();
let dashboardInflight = 0;
const dashboardQueue = [];

async function acquireDashboardSlot() {
  if (dashboardInflight < DASHBOARD_MAX_INFLIGHT) {
    dashboardInflight += 1;
    return;
  }

  await new Promise((resolve) => dashboardQueue.push(resolve));
}

function releaseDashboardSlot() {
  dashboardInflight = Math.max(0, dashboardInflight - 1);
  if (dashboardQueue.length) {
    dashboardInflight += 1;
    const next = dashboardQueue.shift();
    next();
  }
}

async function withDashboardCapacity(label, meta, fn) {
  await acquireDashboardSlot();

  try {
    return await measureAsync(label, meta, fn);
  } finally {
    releaseDashboardSlot();
  }
}

function getFreshCache(cache, key) {
  const cached = cache.get(key);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.payload;
  }
  return null;
}

function setTimedCache(cache, key, payload, ttlMs) {
  cache.set(key, {
    payload,
    expiresAt: Date.now() + ttlMs,
  });
}

function invalidateDashboardCache(gym_id) {
  if (!gym_id) return;

  dashboardCache.delete(gym_id);
  for (const key of analyticsCache.keys()) {
    if (String(key).startsWith(`${gym_id}:`)) {
      analyticsCache.delete(key);
    }
  }
}

function parseIsoDateInput(value, fallback) {
  if (!value) return fallback;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return fallback;
  return date;
}

function buildWeeklyBuckets() {
  const buckets = [];
  const today = new Date();

  for (let index = 6; index >= 0; index -= 1) {
    const start = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - index, 0, 0, 0, 0));
    const end = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - index, 23, 59, 59, 999));
    buckets.push({
      key: start.toISOString().slice(0, 10),
      label: start.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }),
      start,
      end,
    });
  }

  return buckets;
}

function buildMonthlyBuckets() {
  const buckets = [];
  const today = new Date();

  for (let index = 5; index >= 0; index -= 1) {
    const start = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - index, 1, 0, 0, 0, 0));
    const end = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - index + 1, 0, 23, 59, 59, 999));
    buckets.push({
      key: `${start.getUTCFullYear()}-${String(start.getUTCMonth() + 1).padStart(2, '0')}`,
      label: start.toLocaleDateString('en-IN', { month: 'short' }),
      start,
      end,
    });
  }

  return buckets;
}

function getBucketKey(value, granularity) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';

  if (granularity === 'monthly') {
    return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
  }

  return date.toISOString().slice(0, 10);
}

async function getDashboardStatsSummary(gym_id) {
  return measureAsync('dashboard.stats-query', { gym_id }, async () => {
    const result = await prisma.$queryRaw`
      SELECT public.get_dashboard_stats(${gym_id}::text) AS payload
    `;

    return result?.[0]?.payload || {
      totalMembers: 0,
      activeMembers: 0,
      expired: 0,
      expiring7: 0,
      expiring2: 0,
      pendingMembers: 0,
      monthlyRevenue: 0,
      todayRevenue: 0,
      todayCheckins: 0,
    };
  });
}

async function getGymContext(gym_id, gymContext = null) {
  if (gymContext?.id === gym_id) {
    return gymContext;
  }

  return prisma.gyms.findUnique({
    where: { id: gym_id },
    select: {
      id: true,
      gym_name: true,
      trial_end_date: true,
      subscription_status: true,
    },
  });
}

async function getDashboardData(gym_id, gymContext = null) {
  const cacheKey = gym_id;
  const cached = getFreshCache(dashboardCache, cacheKey);
  if (cached) {
    return cached;
  }

  return withDashboardCapacity('dashboard.summary', { gym_id }, async () => {
    const freshAfterWait = getFreshCache(dashboardCache, cacheKey);
    if (freshAfterWait) {
      return freshAfterWait;
    }

    const today = new Date();
    const gym = await getGymContext(gym_id, gymContext);
    if (!gym) {
      const err = new Error('Gym not found');
      err.statusCode = 404;
      throw err;
    }

    const trialEnded = gym.trial_end_date < today;
    const daysLeftInTrial = Math.ceil((gym.trial_end_date - today) / (1000 * 60 * 60 * 24));

    if (trialEnded && gym.subscription_status !== 'active') {
      const err = new Error('Trial period has ended. Payment required to continue.');
      err.statusCode = 402;
      err.payload = {
        error: 'Trial period has ended. Payment required to continue.',
        trialEnded: true,
        paymentRequired: true,
        redirect: '/payment',
      };
      throw err;
    }

    const stats = await getDashboardStatsSummary(gym_id);

    const payload = {
      gymName: gym.gym_name,
      totalMembers: Number(stats.totalMembers || 0),
      activeMembers: Number(stats.activeMembers || 0),
      expiring7: Number(stats.expiring7 || 0),
      expiring2: Number(stats.expiring2 || 0),
      expired: Number(stats.expired || 0),
      pendingMembers: Number(stats.pendingMembers || 0),
      monthlyRevenue: Number(stats.monthlyRevenue || 0),
      todayRevenue: Number(stats.todayRevenue || 0),
      todayCheckins: Number(stats.todayCheckins || 0),
      trialEnded,
      daysLeftInTrial: trialEnded ? 0 : daysLeftInTrial,
      trialEndDate: gym.trial_end_date,
      subscriptionStatus: gym.subscription_status,
    };

    setTimedCache(dashboardCache, cacheKey, payload, DASHBOARD_CACHE_TTL_MS);
    return payload;
  });
}

async function getGrowthAnalyticsData(gym_id, granularity = 'weekly') {
  const safeGranularity = String(granularity || 'weekly').toLowerCase() === 'monthly' ? 'monthly' : 'weekly';
  const buckets = safeGranularity === 'monthly' ? buildMonthlyBuckets() : buildWeeklyBuckets();
  const rangeStart = buckets[0]?.start;
  const rangeEnd = buckets[buckets.length - 1]?.end;
  const cacheKey = `${gym_id}:growth:${safeGranularity}:${rangeStart?.toISOString()}:${rangeEnd?.toISOString()}`;
  const cached = getFreshCache(analyticsCache, cacheKey);

  if (cached) {
    return cached;
  }

  return withDashboardCapacity('dashboard.growth', { gym_id, granularity: safeGranularity }, async () => {
    const freshAfterWait = getFreshCache(analyticsCache, cacheKey);
    if (freshAfterWait) {
      return freshAfterWait;
    }

    const bucketUnit = safeGranularity === 'monthly' ? 'month' : 'day';

    const [newRows, lostRows] = await Promise.all([
      measureAsync('dashboard.growth.new-query', { gym_id, granularity: safeGranularity }, async () =>
        prisma.$queryRaw`
          SELECT DATE_TRUNC(${bucketUnit}, created_at) AS bucket_start, COUNT(*)::int AS total
          FROM public.members
          WHERE gym_id = ${gym_id}
            AND created_at >= ${rangeStart}
            AND created_at <= ${rangeEnd}
          GROUP BY 1
        `,
      ),
      measureAsync('dashboard.growth.lost-query', { gym_id, granularity: safeGranularity }, async () =>
        prisma.$queryRaw`
          SELECT DATE_TRUNC(${bucketUnit}, bucket_at) AS bucket_start, COUNT(*)::int AS total
          FROM (
            SELECT inactive_since AS bucket_at
            FROM public.members
            WHERE gym_id = ${gym_id}
              AND is_inactive = true
              AND inactive_since >= ${rangeStart}
              AND inactive_since <= ${rangeEnd}

            UNION ALL

            SELECT expiry_date AS bucket_at
            FROM public.members
            WHERE gym_id = ${gym_id}
              AND is_inactive = false
              AND expiry_date >= ${rangeStart}
              AND expiry_date <= ${rangeEnd}
              AND expiry_date < NOW()
          ) AS lost_members
          GROUP BY 1
        `,
      ),
    ]);

    const newCounts = new Map(
      (newRows || []).map((row) => [getBucketKey(row.bucket_start, safeGranularity), Number(row.total || 0)]),
    );
    const lostCounts = new Map(
      (lostRows || []).map((row) => [getBucketKey(row.bucket_start, safeGranularity), Number(row.total || 0)]),
    );

    const payload = {
      granularity: safeGranularity,
      points: buckets.map((bucket) => ({
        label: bucket.label,
        newMembers: newCounts.get(bucket.key) || 0,
        lostMembers: lostCounts.get(bucket.key) || 0,
      })),
    };

    setTimedCache(analyticsCache, cacheKey, payload, ANALYTICS_CACHE_TTL_MS);
    return payload;
  });
}

async function getRevenueAnalyticsData(gym_id, from, to) {
  const cacheKey = `${gym_id}:revenue:${from.toISOString()}:${to.toISOString()}`;
  const cached = getFreshCache(analyticsCache, cacheKey);
  if (cached) {
    return cached;
  }

  return withDashboardCapacity('dashboard.revenue', { gym_id, from: from.toISOString(), to: to.toISOString() }, async () => {
    const freshAfterWait = getFreshCache(analyticsCache, cacheKey);
    if (freshAfterWait) {
      return freshAfterWait;
    }

    const result = await measureAsync('dashboard.revenue-query', { gym_id }, async () =>
      prisma.$queryRaw`
        SELECT public.get_revenue_analytics(${gym_id}::text, ${from}::timestamptz, ${to}::timestamptz) AS payload
      `,
    );
    const row = result?.[0]?.payload || {};

    const payload = {
      from: row.from || from,
      to: row.to || to,
      totalRevenue: Number(row.totalRevenue || 0),
      paymentsCount: Number(row.paymentsCount || 0),
    };

    setTimedCache(analyticsCache, cacheKey, payload, ANALYTICS_CACHE_TTL_MS);
    return payload;
  });
}

const getDashboard = async (req, res) => {
  try {
    res.json(await getDashboardData(req.gym_id, req.gym));
  } catch (err) {
    if (err?.statusCode) {
      return res.status(err.statusCode).json(err.payload || { error: err.message });
    }

    console.error(err);
    return res.status(500).json({
      error: 'Server error',
      details: process.env.NODE_ENV !== 'production' ? err.message : undefined,
    });
  }
};

const getRevenueAnalytics = async (req, res) => {
  try {
    const gym_id = req.gym_id;
    const now = new Date();
    const defaultFrom = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0, 0));
    const defaultTo = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 23, 59, 59, 999));

    const from = parseIsoDateInput(req.query.from, defaultFrom);
    const toCandidate = parseIsoDateInput(req.query.to, defaultTo);
    const to = new Date(Date.UTC(
      toCandidate.getUTCFullYear(),
      toCandidate.getUTCMonth(),
      toCandidate.getUTCDate(),
      23,
      59,
      59,
      999,
    ));

    if (from > to) {
      return res.status(400).json({ error: 'From date must be before To date' });
    }

    return res.json(await getRevenueAnalyticsData(gym_id, from, to));
  } catch (err) {
    console.error(err);
    return res.status(500).json({
      error: 'Failed to load revenue analytics',
      details: process.env.NODE_ENV !== 'production' ? err.message : undefined,
    });
  }
};

const getGrowthAnalytics = async (req, res) => {
  try {
    const gym_id = req.gym_id;
    return res.json(await getGrowthAnalyticsData(gym_id, req.query.granularity));
  } catch (err) {
    console.error(err);
    return res.status(500).json({
      error: 'Failed to load growth analytics',
      details: process.env.NODE_ENV !== 'production' ? err.message : undefined,
    });
  }
};

const getDashboardBootstrap = async (req, res) => {
  try {
    const dashboard = await getDashboardData(req.gym_id, req.gym);
    return res.json({
      dashboard,
      bootstrapMode: 'minimal',
      cacheTtlMs: DASHBOARD_CACHE_TTL_MS,
    });
  } catch (err) {
    if (err?.statusCode) {
      return res.status(err.statusCode).json(err.payload || { error: err.message });
    }
    if (err?.code && err?.body) {
      return res.status(err.code).json(err.body);
    }

    console.error(err);
    return res.status(500).json({
      error: 'Failed to load dashboard bootstrap',
      details: process.env.NODE_ENV !== 'production' ? err.message : undefined,
    });
  }
};

module.exports = {
  getDashboard,
  getRevenueAnalytics,
  getGrowthAnalytics,
  getDashboardBootstrap,
  invalidateDashboardCache,
};
