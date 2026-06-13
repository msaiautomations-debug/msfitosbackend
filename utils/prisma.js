const { PrismaClient } = require('@prisma/client');
const { setPrismaUnavailableReason } = require('./runtimeState');

const globalForPrisma = globalThis;
const connectionString = process.env.DATABASE_URL;

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

let prisma = globalForPrisma.prisma;

if (!connectionString) {
  const reason = 'DATABASE_URL is required to initialize Prisma';
  setPrismaUnavailableReason(reason);
  console.error(reason);
  prisma = prisma || createUnavailablePrisma(reason);
} else if (!prisma) {
  try {
    prisma = new PrismaClient({
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
  globalForPrisma.prisma = prisma;
}

prisma.pool = null;

module.exports = prisma;
