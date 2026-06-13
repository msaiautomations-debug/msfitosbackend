require('dotenv').config();
require('./utils/network').configureIpv4OnlyNetworking();

const express = require('express');
const { patchExpressAsyncHandlers } = require('./utils/expressAsyncPatch');
patchExpressAsyncHandlers(express);
const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const authRoutes = require('./routes/auth');
const adminRoutes = require('./routes/admin');
const memberRoutes = require('./routes/members');
const webhookRoutes = require('./routes/webhook');
const dashboardRoutes = require('./routes/dashboard');
const paymentsRoutes = require('./routes/payments');
const reminderSettingsRoutes = require("./routes/reminderSettings");
const attendanceRoutes = require("./routes/attendance");
const fitnessTipsRoutes = require('./routes/fitnessTips');
const trialUsersRoutes = require('./routes/trialUsers');
const marketingDashboardRoutes = require('./routes/marketingDashboard');
const notificationsRoutes = require('./routes/notifications');
const membershipPlansRoutes = require('./routes/membershipPlans');
const trainersRoutes = require('./routes/trainers');
const whatsappRoutes = require('./routes/whatsapp');
const gymSettingsRoutes = require('./routes/gymSettings');
const websitePricingRoutes = require('./routes/websitePricing');
const websiteInquiryRoutes = require('./routes/websiteInquiries');
const userRoutes = require('./routes/user');
const ownerDashboardRoutes = require('./routes/ownerDashboard');
const expiryNotifications = require('./cron/expiryNotifications');
const memberEmailReminders = require('./cron/memberEmailReminders');
const prisma = require('./utils/prisma');
const { getPrismaUnavailableReason, isPrismaReady } = require('./utils/runtimeState');

const app = express();
// use PORT from environment (dotenv loads .env); default to 5000 if unspecified
const PORT = process.env.PORT || 5000;
const normalizeOrigin = (origin) => origin.replace(/\/+$|\s+/g, '');
const rawFrontendOrigins = String(process.env.FRONTEND_URL || '')
  .split(',')
  .map((value) => normalizeOrigin(value.trim()))
  .filter(Boolean);
const defaultFrontendOrigins = [
  'https://msfitos.in',
  'https://www.msfitos.in',
  'https://sienna-hawk-345174.hostingersite.com',
  'http://localhost:8080',
  'http://127.0.0.1:8080',
  'http://[::1]:8080',
  'http://localhost:8082',
  'http://127.0.0.1:8082',
  'http://[::1]:8082',
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://[::1]:5173',
  'http://localhost:4173',
  'http://127.0.0.1:4173',
  'http://[::1]:4173',
];
const allowedOrigins = new Set(
  [...new Set(rawFrontendOrigins.concat(defaultFrontendOrigins))].flatMap((origin) => {
    if (!origin.includes('localhost')) return [origin];
    return [
      origin,
      origin.replace('localhost', '127.0.0.1'),
      origin.replace('localhost', '[::1]'),
    ];
  }),
);
const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;
const parsedRateLimitMax = Number(process.env.RATE_LIMIT_MAX || 150);
const RATE_LIMIT_MAX = Number.isFinite(parsedRateLimitMax)
  ? Math.min(200, Math.max(100, parsedRateLimitMax))
  : 150;
const SLOW_REQUEST_THRESHOLD_MS = Number(process.env.SLOW_REQUEST_THRESHOLD_MS || 400);
const ENABLE_CRONS = String(
  process.env.ENABLE_CRONS ?? (process.env.NODE_ENV === 'production' ? 'true' : 'false'),
).toLowerCase() === 'true';
const cronJobs = {
  expiryNotifications: 'stopped',
  memberEmailReminders: 'stopped',
};

function shouldSkipRateLimit(req) {
  return (
    req.path === '/api/health' ||
    req.path === '/api/ping' ||
    req.path === '/' ||
    req.path === '/api/admin/whatsapp/status' ||
    req.path === '/api/whatsapp/status'
  );
}

function serializeError(error) {
  return {
    message: error?.message || 'Unknown error',
    code: error?.code,
    name: error?.name,
  };
}

// global middleware
app.set('trust proxy', 1);
app.use(helmet());
app.use(express.json());
app.use(
  cors({
    origin(origin, callback) {
      if (!origin || allowedOrigins.size === 0 || allowedOrigins.has(origin)) {
        callback(null, true);
        return;
      }

      callback(new Error('CORS origin not allowed'));
    },
    credentials: true,
  }),
);

app.use((req, res, next) => {
  const start = process.hrtime.bigint();

  res.on('finish', () => {
    const elapsedMs = Number(process.hrtime.bigint() - start) / 1e6;
    const shouldLog =
      elapsedMs >= SLOW_REQUEST_THRESHOLD_MS ||
      req.path.startsWith('/api/dashboard') ||
      req.path.startsWith('/api/members/search') ||
      req.path === '/api/health' ||
      req.path === '/api/ping';

    if (!shouldLog) return;

    console.info(
      `[perf][http] ${req.method} ${req.originalUrl} status=${res.statusCode} duration=${elapsedMs.toFixed(1)}ms`,
    );
  });

  next();
});

// Per-IP rate limit across the API to soften abuse and accidental refresh storms.
const limiter = rateLimit({
  windowMs: RATE_LIMIT_WINDOW_MS,
  max: RATE_LIMIT_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.ip,
  skip: shouldSkipRateLimit,
  message: {
    error: `Too many requests from this IP. Please try again after 15 minutes.`,
  },
});
app.use(limiter);

// routes
app.use('/api/auth', authRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/members', memberRoutes);
app.use('/api/webhook', webhookRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/payments', paymentsRoutes);
app.use("/api/reminder-settings", reminderSettingsRoutes);
app.use("/api/attendance", attendanceRoutes);
app.use("/api/fitness-tips", fitnessTipsRoutes);
app.use("/api/trial-users", trialUsersRoutes);
app.use("/api/marketing-dashboard", marketingDashboardRoutes);
app.use("/api/notifications", notificationsRoutes);
app.use("/api/membership-plans", membershipPlansRoutes);
app.use("/api/trainers", trainersRoutes);
app.use('/api/whatsapp', whatsappRoutes);
app.use('/api/gym-settings', gymSettingsRoutes);
app.use('/api/website-pricing', websitePricingRoutes);
app.use('/api/website-inquiries', websiteInquiryRoutes);
app.use('/api/user', userRoutes);
app.use('/api/owner', ownerDashboardRoutes);

app.get('/api/ping', (req, res) => {
  res.json({
    ok: true,
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  });
});

app.get('/api/health', async (req, res) => {
  const timestamp = new Date().toISOString();
  const services = {
    database: isPrismaReady() ? 'disconnected' : 'unavailable',
    email: 'disconnected',
    api: 'working',
    cron: Object.values(cronJobs).every((status) => status === 'running') ? 'running' : 'degraded',
  };
  const prismaUnavailableReason = getPrismaUnavailableReason();

  if (prismaUnavailableReason) {
    return res.status(503).json({
      ok: false,
      uptime: process.uptime(),
      timestamp,
      services,
      cronJobs,
      error: {
        database: prismaUnavailableReason,
      },
    });
  }

  try {
    await prisma.$queryRaw`SELECT 1`;
    services.database = 'connected';

    // Check email service health
    try {
      const { getEmailConfigIssues } = require('./services/emailService');
      services.email = getEmailConfigIssues().length ? 'misconfigured' : 'ready';
    } catch (emailError) {
      console.error('Email service health check failed:', emailError.message);
      services.email = 'error';
    }

    services.cron = Object.values(cronJobs).every((status) => status === 'running') ? 'running' : 'degraded';

    res.json({
      ok: true,
      uptime: process.uptime(),
      timestamp,
      services,
      cronJobs,
    });
  } catch (error) {
    console.error('Health check failed', error);

    res.status(503).json({
      ok: false,
      uptime: process.uptime(),
      timestamp,
      services,
      cronJobs,
      error: {
        database: 'Database health check failed',
      },
    });
  }
});

app.get('/', (req, res) => {
  res.send('Gym Management SaaS API');
});

app.use((err, req, res, next) => {
  const details = serializeError(err);
  console.error('Unhandled request error', {
    method: req.method,
    path: req.originalUrl,
    ...details,
  });

  if (res.headersSent) {
    return next(err);
  }

  const statusCode =
    Number.isInteger(err?.statusCode) ? err.statusCode : Number.isInteger(err?.status) ? err.status : 500;
  const safeStatusCode = statusCode >= 400 && statusCode < 600 ? statusCode : 500;

  return res.status(safeStatusCode).json({
    error: safeStatusCode >= 500 ? 'Server error' : details.message,
    details: process.env.NODE_ENV !== 'production' ? details.message : undefined,
  });
});

const server = app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  const prismaUnavailableReason = getPrismaUnavailableReason();
  if (prismaUnavailableReason) {
    console.warn(`Database unavailable. API is running in degraded mode: ${prismaUnavailableReason}`);
  }
  if (!ENABLE_CRONS) {
    console.log('Cron jobs are disabled for this process');
    return;
  }

  try {
    expiryNotifications.start();
    cronJobs.expiryNotifications = 'running';
  } catch (err) {
    console.error('Failed to start expiry notifications cron', err);
  }

  try {
    memberEmailReminders.start();
    cronJobs.memberEmailReminders = 'running';
  } catch (err) {
    console.error('Failed to start member email reminder cron', err);
  }
});

server.on('error', (error) => {
  const details = serializeError(error);
  console.error('Server failed to start', {
    port: PORT,
    ...details,
  });

  if (details.code === 'EADDRINUSE') {
    console.error(`Port ${PORT} is already in use. Stop the existing process or set a different PORT.`);
  }
});

const shutdown = async (signal) => {
  console.log(`Received ${signal}. Shutting down gracefully...`);

  server.close(async () => {
    try {
      await prisma.$disconnect();
      await prisma.pool?.end();
    } catch (err) {
      console.error('Error while disconnecting Prisma', err);
    } finally {
      process.exit(0);
    }
  });

  setTimeout(() => {
    console.error('Forced shutdown after timeout');
    process.exit(1);
  }, 10000).unref();
};

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('uncaughtException', (error) => {
  console.error('Uncaught exception', serializeError(error));
});
process.on('unhandledRejection', (reason) => {
  console.error('Unhandled rejection', serializeError(reason));
});
