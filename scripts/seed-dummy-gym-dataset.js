/* eslint-disable no-console */
require('dotenv').config();

const prisma = require('../utils/prisma');

const TARGET_EMAIL = (process.env.TARGET_GYM_EMAIL || 'muditpatidar7@gmail.com').trim().toLowerCase();
const MEMBER_COUNT = Math.max(1, Number(process.env.DUMMY_MEMBER_COUNT || 80));
const SEED_DOMAIN = 'dummy.msfitos.local';
const SEED_PHONE_PREFIX = '88010';

const PLANS = [
  { name: 'Starter Monthly', duration_days: 30, price: 1499, description: 'Dummy monthly plan' },
  { name: 'Quarterly Strength', duration_days: 90, price: 3999, description: 'Dummy quarterly plan' },
  { name: 'Half Year Transformation', duration_days: 180, price: 6999, description: 'Dummy half-year plan' },
  { name: 'Annual Elite', duration_days: 365, price: 11999, description: 'Dummy yearly plan' },
];

const TRAINERS = [
  {
    name: 'Amit Suryavanshi',
    email: `trainer.amit@${SEED_DOMAIN}`,
    phone: '8810010101',
    specialization: 'Strength Training',
    experience_years: 6,
    salary_amount: 32000,
    salary_basis: 'monthly',
  },
  {
    name: 'Sneha Rathore',
    email: `trainer.sneha@${SEED_DOMAIN}`,
    phone: '8810010102',
    specialization: 'Weight Loss',
    experience_years: 4,
    salary_amount: 27000,
    salary_basis: 'monthly',
  },
  {
    name: 'Rahul Menon',
    email: `trainer.rahul@${SEED_DOMAIN}`,
    phone: '8810010103',
    specialization: 'CrossFit',
    experience_years: 5,
    salary_amount: 450,
    salary_basis: 'hourly',
  },
];

const FIRST_NAMES = [
  'Aarav',
  'Isha',
  'Vikram',
  'Neha',
  'Kabir',
  'Priya',
  'Rohan',
  'Anaya',
  'Sahil',
  'Meera',
  'Aditya',
  'Pooja',
  'Kiran',
  'Nisha',
  'Arjun',
  'Tanya',
  'Dev',
  'Ritika',
  'Yash',
  'Sanya',
];

const LAST_NAMES = [
  'Sharma',
  'Patel',
  'Singh',
  'Verma',
  'Gupta',
  'Khan',
  'Mehta',
  'Chopra',
  'Nair',
  'Iyer',
];

function addDays(date, days) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function pick(list, index) {
  return list[index % list.length];
}

function amountForPlan(plan, index) {
  const discount = index % 7 === 0 ? 500 : 0;
  return Math.max(0, plan.price - discount);
}

async function cleanupSeedData(gymId) {
  const seededMembers = await prisma.members.findMany({
    where: {
      gym_id: gymId,
      OR: [
        { email: { endsWith: `@${SEED_DOMAIN}` } },
        { phone: { startsWith: SEED_PHONE_PREFIX } },
      ],
    },
    select: { id: true },
  });

  const memberIds = seededMembers.map((member) => member.id);

  await prisma.$transaction(async (tx) => {
    if (memberIds.length) {
      await tx.attendances.deleteMany({ where: { member_id: { in: memberIds } } });
      await tx.trainer_sessions.deleteMany({ where: { member_id: { in: memberIds } } });
      await tx.gym_notifications.deleteMany({ where: { member_id: { in: memberIds } } });
      await tx.payments.deleteMany({ where: { member_id: { in: memberIds } } });
      await tx.members.deleteMany({ where: { id: { in: memberIds } } });
    }

    await tx.trial_users.deleteMany({
      where: {
        gym_id: gymId,
        OR: [
          { phone: { startsWith: SEED_PHONE_PREFIX } },
          { notes: { contains: 'dummy-seed' } },
        ],
      },
    });
    await tx.trainer_sessions.deleteMany({ where: { gym_id: gymId, notes: { contains: 'dummy-seed' } } });
    await tx.gym_notifications.deleteMany({ where: { gym_id: gymId, message: { contains: 'dummy-seed' } } });
    await tx.fitness_tips.deleteMany({ where: { gym_id: gymId, message: { contains: 'dummy-seed' } } });
    await tx.payments.deleteMany({ where: { gym_id: gymId, razorpay_payment_id: { startsWith: 'dummy_seed_' } } });
  });
}

async function upsertPlans(gymId) {
  const plans = [];

  for (const plan of PLANS) {
    const existing = await prisma.membership_plans.findFirst({
      where: { gym_id: gymId, name: plan.name },
    });

    if (existing) {
      plans.push(
        await prisma.membership_plans.update({
          where: { id: existing.id },
          data: { ...plan, is_active: true },
        }),
      );
    } else {
      plans.push(
        await prisma.membership_plans.create({
          data: { gym_id: gymId, ...plan, is_active: true },
        }),
      );
    }
  }

  return plans;
}

async function upsertTrainers(gymId) {
  const trainers = [];

  for (const trainer of TRAINERS) {
    trainers.push(
      await prisma.trainers.upsert({
        where: { email: trainer.email },
        update: { ...trainer, gym_id: gymId, status: 'active' },
        create: { ...trainer, gym_id: gymId, status: 'active' },
      }),
    );
  }

  return trainers;
}

function buildMemberData(gymId, plans, now) {
  return Array.from({ length: MEMBER_COUNT }, (_, index) => {
    const plan = pick(plans, index);
    const first = pick(FIRST_NAMES, index);
    const last = pick(LAST_NAMES, index * 3);
    const expiryOffset = (index % 5) * 21 - 35;
    const expiryDate = addDays(now, expiryOffset);
    const startDate = addDays(expiryDate, -plan.duration_days);
    const paid = index % 4 !== 0;
    const weight = 56 + (index % 35);
    const height = 158 + (index % 25);
    const bmi = Number((weight / ((height / 100) ** 2)).toFixed(1));

    return {
      gym_id: gymId,
      plan_id: plan.id,
      name: `${first} ${last}`,
      phone: `${SEED_PHONE_PREFIX}${String(index).padStart(5, '0')}`,
      email: `${first.toLowerCase()}.${last.toLowerCase()}.${String(index + 1).padStart(3, '0')}@${SEED_DOMAIN}`,
      dob: addDays(now, -365 * (20 + (index % 24))),
      plan_duration: plan.duration_days,
      height_cm: height,
      weight_kg: weight,
      bmi,
      start_date: startDate,
      expiry_date: expiryDate,
      amount: amountForPlan(plan, index),
      payment_status: paid ? 'paid' : 'pending',
      payment_method: paid ? pick(['cash', 'upi', 'card'], index) : null,
      is_inactive: index % 11 === 0,
      inactive_since: index % 11 === 0 ? addDays(now, -18) : null,
      reminder_1_sent: index % 9 === 0,
      reminder_2_sent: index % 9 === 0,
      reminder_3_sent: index % 9 === 0,
      reminder_4_sent: index % 9 === 0,
      expiry_notified: expiryOffset < 0,
      is_paused: index % 17 === 0,
      paused_at: index % 17 === 0 ? addDays(now, -4) : null,
      paused_total_days: index % 17 === 0 ? 4 : 0,
    };
  });
}

async function createRelatedData(gymId, members, trainers, now) {
  const paidMembers = members.filter((member) => member.payment_status === 'paid');

  await prisma.payments.createMany({
    data: paidMembers.map((member, index) => ({
      gym_id: gymId,
      member_id: member.id,
      razorpay_payment_id: `dummy_seed_${member.id}`,
      amount: member.amount,
      status: 'paid',
      created_at: addDays(member.start_date, index % 4),
    })),
    skipDuplicates: true,
  });

  const attendanceData = [];
  members.slice(0, Math.min(members.length, 45)).forEach((member, memberIndex) => {
    const visits = 2 + (memberIndex % 4);
    for (let visit = 0; visit < visits; visit += 1) {
      const checkin = addDays(now, -(visit * 3 + (memberIndex % 8)));
      checkin.setHours(6 + (memberIndex % 12), memberIndex % 2 ? 30 : 0, 0, 0);
      const checkout = new Date(checkin);
      checkout.setMinutes(checkout.getMinutes() + 70 + (memberIndex % 35));
      attendanceData.push({
        gym_id: gymId,
        member_id: member.id,
        trainer_id: pick(trainers, memberIndex).id,
        checkin_at: checkin,
        checkout_at: checkout,
        source: 'dummy-seed',
      });
    }
  });

  if (attendanceData.length) {
    await prisma.attendances.createMany({ data: attendanceData });
  }

  await prisma.trainer_sessions.createMany({
    data: members.slice(0, Math.min(members.length, 24)).map((member, index) => ({
      gym_id: gymId,
      trainer_id: pick(trainers, index).id,
      member_id: member.id,
      session_date: addDays(now, (index % 12) - 3),
      duration_minutes: pick([45, 60, 75], index),
      status: pick(['scheduled', 'completed', 'cancelled'], index),
      notes: `dummy-seed personal training session ${index + 1}`,
    })),
  });

  await prisma.trial_users.createMany({
    data: Array.from({ length: 18 }, (_, index) => ({
      gym_id: gymId,
      name: `${pick(FIRST_NAMES, index + 5)} ${pick(LAST_NAMES, index + 2)}`,
      phone: `${SEED_PHONE_PREFIX}9${String(index).padStart(4, '0')}`,
      trial_date: addDays(now, index - 8),
      trial_duration: pick([3, 5, 7], index),
      trainer_name: pick(trainers, index).name,
      notes: `dummy-seed trial lead ${index + 1}`,
      status: pick(['trial', 'converted', 'lost'], index),
      lost_reason: index % 3 === 2 ? 'Joined another gym' : null,
    })),
  });

  await prisma.gym_notifications.createMany({
    data: members.slice(0, Math.min(members.length, 20)).map((member, index) => ({
      gym_id: gymId,
      member_id: member.id,
      type: pick(['expiry_reminder', 'birthday', 'inactive'], index),
      message: `dummy-seed notification for ${member.name}`,
      status: pick(['sent', 'pending'], index),
      sent_at: addDays(now, -index),
    })),
  });

  await prisma.fitness_tips.createMany({
    data: [
      {
        gym_id: gymId,
        title: 'Hydration Reminder',
        message: 'dummy-seed Drink water before and after every workout.',
        category: 'wellness',
      },
      {
        gym_id: gymId,
        title: 'Progressive Overload',
        message: 'dummy-seed Increase reps or weight gradually every week.',
        category: 'strength',
      },
      {
        gym_id: gymId,
        title: 'Recovery Day',
        message: 'dummy-seed Rest days help muscles rebuild stronger.',
        category: 'recovery',
      },
    ],
  });
}

async function main() {
  const gym = await prisma.gyms.findUnique({
    where: { email: TARGET_EMAIL },
    select: { id: true, gym_id: true, gym_name: true, email: true },
  });

  if (!gym) {
    throw new Error(`Gym not found for email ${TARGET_EMAIL}`);
  }

  console.log(`Seeding dummy dataset for ${gym.gym_name} (${gym.email})`);
  await cleanupSeedData(gym.id);

  const now = new Date();
  const plans = await upsertPlans(gym.id);
  const trainers = await upsertTrainers(gym.id);

  const memberData = buildMemberData(gym.id, plans, now);
  await prisma.members.createMany({ data: memberData });

  const members = await prisma.members.findMany({
    where: { gym_id: gym.id, email: { endsWith: `@${SEED_DOMAIN}` } },
    orderBy: { email: 'asc' },
  });

  await createRelatedData(gym.id, members, trainers, now);

  console.log(`Done. Added ${members.length} members, ${plans.length} plans, ${trainers.length} trainers.`);
  console.log('Also added payments, attendance, trainer sessions, trial users, notifications, and fitness tips.');
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
    if (prisma.pool) await prisma.pool.end();
  });
