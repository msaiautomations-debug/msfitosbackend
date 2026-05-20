/* eslint-disable no-console */
const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

function addDays(date, days) {
  const d = new Date(date);
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

async function runDashboardQueries(gym_id) {
  const today = new Date();
  const memberBaseWhere = { gym_id, is_inactive: false };

  const in7 = addDays(today, 7);
  in7.setUTCHours(23, 59, 59, 999);
  const start7 = addDays(today, 7);
  start7.setUTCHours(0, 0, 0, 0);

  const in2 = addDays(today, 2);
  in2.setUTCHours(23, 59, 59, 999);
  const start2 = addDays(today, 2);
  start2.setUTCHours(0, 0, 0, 0);

  const startOfMonth = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));
  const endOfMonth = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + 1, 0, 23, 59, 59, 999));

  const startOfDay = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate(), 0, 0, 0, 0));
  const endOfDay = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate(), 23, 59, 59, 999));

  await prisma.$transaction([
    prisma.members.count({ where: { gym_id } }),
    prisma.members.count({ where: { ...memberBaseWhere, expiry_date: { gt: today } } }),
    prisma.members.count({ where: { ...memberBaseWhere, expiry_date: { gte: start7, lte: in7 } } }),
    prisma.members.count({ where: { ...memberBaseWhere, expiry_date: { gte: start2, lte: in2 } } }),
    prisma.members.count({ where: { ...memberBaseWhere, expiry_date: { lt: today } } }),
    prisma.members.count({ where: { ...memberBaseWhere, payment_method: null } }),
    prisma.payments.aggregate({
      _sum: { amount: true },
      where: { gym_id, status: "paid", created_at: { gte: startOfMonth, lte: endOfMonth } },
    }),
    prisma.payments.aggregate({
      _sum: { amount: true },
      where: { gym_id, status: "paid", created_at: { gte: startOfDay, lte: endOfDay } },
    }),
  ]);
}

async function main() {
  const gymPrefix = process.env.GYM_PREFIX || "loadtest";
  const limit = Number(process.env.GYM_LIMIT || 50);

  const gyms = await prisma.gyms.findMany({
    where: { gym_id: { startsWith: gymPrefix } },
    select: { id: true, gym_id: true },
    orderBy: { gym_id: "asc" },
    take: limit,
  });

  if (!gyms.length) {
    console.log("No gyms found for benchmark.");
    return;
  }

  const start = Date.now();
  for (const gym of gyms) {
    const t0 = Date.now();
    await runDashboardQueries(gym.id);
    const t1 = Date.now();
    console.log(`Gym ${gym.gym_id} dashboard queries: ${t1 - t0} ms`);
  }
  const totalMs = Date.now() - start;
  const avg = Math.round(totalMs / gyms.length);
  console.log(`Total time: ${totalMs} ms for ${gyms.length} gyms`);
  console.log(`Average per gym: ${avg} ms`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
