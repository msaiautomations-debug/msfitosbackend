/* eslint-disable no-console */
const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

const FIRST_NAMES = [
  "Aarav",
  "Vikram",
  "Neha",
  "Isha",
  "Kiran",
  "Arjun",
  "Meera",
  "Rohan",
  "Priya",
  "Kabir",
  "Anaya",
  "Sahil",
  "Nisha",
  "Aditya",
  "Pooja",
];

const LAST_NAMES = [
  "Sharma",
  "Gupta",
  "Patel",
  "Singh",
  "Verma",
  "Nair",
  "Iyer",
  "Khan",
  "Chopra",
  "Bose",
  "Mehta",
];

const PLAN_DURATIONS = [30, 90, 180];

function pick(list) {
  return list[Math.floor(Math.random() * list.length)];
}

function addDays(date, days) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

async function main() {
  const gymPrefix = process.env.GYM_PREFIX || "loadtest-";
  const target = Number(process.env.MEMBERS_PER_GYM || 1000);
  const batchSize = 500;
  const now = new Date();

  const gyms = await prisma.gyms.findMany({
    where: { gym_id: { startsWith: gymPrefix } },
    select: { id: true, gym_id: true },
    orderBy: { gym_id: "asc" },
  });

  for (const gym of gyms) {
    const current = await prisma.members.count({ where: { gym_id: gym.id } });
    const missing = Math.max(0, target - current);
    if (!missing) {
      console.log(`Gym ${gym.gym_id}: already at ${current}`);
      continue;
    }

    let inserted = 0;
    for (let offset = 0; offset < missing; offset += batchSize) {
      const size = Math.min(batchSize, missing - offset);
      const data = Array.from({ length: size }).map((_, j) => {
        const idx = current + offset + j;
        const plan_duration = pick(PLAN_DURATIONS);
        const expiryOffset = Math.floor(Math.random() * 121) - 60;
        const expiry_date = addDays(now, expiryOffset);
        const start_date = addDays(expiry_date, -plan_duration);
        const payment_status = Math.random() > 0.35 ? "paid" : "pending";
        const is_inactive = Math.random() < 0.1;
        const first = pick(FIRST_NAMES);
        const last = pick(LAST_NAMES);
        return {
          gym_id: gym.id,
          name: `${first} ${last}`,
          phone: String(9200000000 + idx).slice(0, 10),
          email: `${first.toLowerCase()}.${last.toLowerCase()}.${idx}@example.com`,
          plan_duration,
          start_date,
          expiry_date,
          amount: Math.floor(1000 + Math.random() * 4000),
          payment_status,
          payment_method: payment_status === "paid" ? "cash" : null,
          is_inactive,
          inactive_since: is_inactive ? now : null,
          reminder_1_sent: false,
          reminder_2_sent: false,
          reminder_3_sent: false,
          reminder_4_sent: false,
          expiry_notified: false,
          is_paused: false,
          paused_at: null,
          paused_total_days: 0,
        };
      });

      const result = await prisma.members.createMany({
        data,
        skipDuplicates: true,
      });
      inserted += result.count;
    }

    console.log(`Gym ${gym.gym_id}: added ${inserted} (target ${target})`);
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
