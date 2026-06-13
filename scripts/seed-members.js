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

function daysAgo(date, days) {
  const d = new Date(date);
  d.setDate(d.getDate() - days);
  return d;
}

async function main() {
  const gymId = process.env.GYM_ID || "YOUR_GYM_ID_HERE";
  const count = Math.max(100, Number(process.env.MEMBER_COUNT || 500));

  if (gymId === "YOUR_GYM_ID_HERE") {
    console.error("Set GYM_ID env var before running this script.");
    process.exit(1);
  }

  const now = new Date();
  const data = Array.from({ length: count }).map((_, i) => {
    const first = pick(FIRST_NAMES);
    const last = pick(LAST_NAMES);
    const plan_duration = pick(PLAN_DURATIONS);

    // expiry between -60 and +60 days from today
    const expiryOffset = Math.floor(Math.random() * 121) - 60;
    const expiry_date = new Date(now);
    expiry_date.setDate(expiry_date.getDate() + expiryOffset);

    const start_date = daysAgo(expiry_date, plan_duration);
    const payment_status = Math.random() > 0.35 ? "paid" : "pending";
    const is_inactive = Math.random() < 0.1;
    const phone = String(9000000000 + i).slice(0, 10);

    return {
      gym_id: gymId,
      name: `${first} ${last}`,
      phone,
      email: `${first.toLowerCase()}.${last.toLowerCase()}${i}@example.com`,
      plan_duration,
      start_date,
      expiry_date,
      amount: Math.floor(1000 + Math.random() * 4000),
      payment_status,
      payment_method: payment_status === "paid" ? "cash" : null,
      is_inactive,
      inactive_since: is_inactive ? new Date(now) : null,
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

  console.log(`Inserted ${result.count} members for gym_id=${gymId}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
