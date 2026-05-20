const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');
const { Pool } = require('pg');
const { setPrismaUnavailableReason } = require('./runtimeState');

const globalForPrisma = globalThis;
const connectionString = process.env.DATABASE_URL;

function buildPoolConfig(rawConnectionString) {
  const poolConfig = { connectionString: rawConnectionString };

  try {
    const parsedUrl = new URL(rawConnectionString);
    const host = parsedUrl.hostname || '';
    const sslMode = (parsedUrl.searchParams.get('sslmode') || '').toLowerCase();
    const isLocalHost = ['localhost', '127.0.0.1', '::1'].includes(host);
    const shouldUseSsl =
      ['require', 'prefer', 'verify-ca', 'verify-full', 'allow'].includes(sslMode) ||
      (!sslMode && host && !isLocalHost);

    if (shouldUseSsl) {
      poolConfig.ssl = {
        rejectUnauthorized: sslMode === 'verify-full' || sslMode === 'verify-ca',
      };
    }
  } catch (error) {
    console.warn('Failed to parse DATABASE_URL for Prisma pool configuration:', error.message);
  }

  return poolConfig;
}

function createUnavailablePrisma(reason) {
  const unavailableError = () => {
    const error = new Error(reason);
    error.code = 'PRISMA_UNAVAILABLE';
    return error;
  };

  const unavailableFn = () => Promise.reject(unavailableError());
  const nestedProxy = new Proxy(
    {},
    {
      get(_target, property) {
        if (property === 'then') return undefined;
        if (property === '$disconnect') return async () => undefined;
        if (property === 'pool') return null;
        return unavailableFn;
      },
    },
  );

  return new Proxy(
    {},
    {
      get(_target, property) {
        if (property === 'then') return undefined;
        if (property === '$disconnect') return async () => undefined;
        if (property === 'pool') return null;
        if (property === '$connect') return unavailableFn;
        if (property === '$transaction') return unavailableFn;
        if (property === '$queryRaw') return unavailableFn;
        if (property === '$executeRaw') return unavailableFn;
        return nestedProxy;
      },
    },
  );
}

let prismaPool = globalForPrisma.prismaPool;
let prismaAdapter = globalForPrisma.prismaAdapter;
let prisma = globalForPrisma.prisma;

if (!connectionString) {
  const reason = 'DATABASE_URL is required to initialize Prisma';
  setPrismaUnavailableReason(reason);
  console.error(reason);
  prisma = prisma || createUnavailablePrisma(reason);
} else if (!prisma) {
  try {
    prismaPool = prismaPool || new Pool(buildPoolConfig(connectionString));
    prismaAdapter = prismaAdapter || new PrismaPg(prismaPool);
    prisma = new PrismaClient({
      adapter: prismaAdapter,
      log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
    });
    setPrismaUnavailableReason(null);
  } catch (error) {
    const reason = `Failed to initialize Prisma: ${error.message}`;
    setPrismaUnavailableReason(reason);
    console.error(reason);
    prisma = createUnavailablePrisma(reason);
  }
}

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prismaPool = prismaPool;
  globalForPrisma.prismaAdapter = prismaAdapter;
  globalForPrisma.prisma = prisma;
}

prisma.pool = prismaPool;

module.exports = prisma;
