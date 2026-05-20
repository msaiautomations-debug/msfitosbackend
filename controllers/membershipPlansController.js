const prisma = require('../utils/prisma');

const DEFAULT_MEMBERSHIP_PLANS = [
  { name: '1 month', duration_days: 30, price: 0, description: 'Default monthly membership plan' },
  { name: '3 months', duration_days: 90, price: 0, description: 'Default quarterly membership plan' },
  { name: '6 months', duration_days: 180, price: 0, description: 'Default half-year membership plan' },
  { name: '1 year', duration_days: 365, price: 0, description: 'Default annual membership plan' },
];
const ensuredDefaultPlansByGym = new Set();

async function ensureDefaultPlans(gym_id) {
  if (ensuredDefaultPlansByGym.has(gym_id)) return;

  const existingPlans = await prisma.membership_plans.findMany({
    where: { gym_id },
    select: { id: true, name: true, is_active: true },
  });

  const existingByName = new Map(existingPlans.map((plan) => [plan.name, plan]));

  for (const defaultPlan of DEFAULT_MEMBERSHIP_PLANS) {
    const existingPlan = existingByName.get(defaultPlan.name);

    if (!existingPlan) {
      await prisma.membership_plans.create({
        data: {
          gym_id,
          ...defaultPlan,
          is_active: true,
        },
      });
      continue;
    }

    if (!existingPlan.is_active) {
      await prisma.membership_plans.update({
        where: { id: existingPlan.id },
        data: { is_active: true },
      });
    }
  }

  ensuredDefaultPlansByGym.add(gym_id);
}

const listMembershipPlans = async (req, res) => {
  try {
    const gym_id = req.gym_id;
    await ensureDefaultPlans(gym_id);

    const plans = await prisma.membership_plans.findMany({
      where: { gym_id, is_active: true },
      orderBy: [{ duration_days: 'asc' }, { created_at: 'asc' }],
    });

    res.json({ plans });
  } catch (err) {
    console.error(err);
    res.status(500).json({
      error: 'Failed to load membership plans',
      details: process.env.NODE_ENV !== 'production' ? err.message : undefined,
    });
  }
};

const createMembershipPlan = async (req, res) => {
  try {
    const gym_id = req.gym_id;
    const { name, duration_days, price, description } = req.body;

    const trimmedName = String(name || '').trim();
    const parsedDuration = parseInt(duration_days, 10);
    const parsedPrice = Number(price || 0);

    if (!trimmedName || !parsedDuration || parsedDuration <= 0) {
      return res.status(400).json({ error: 'Valid name and duration_days are required' });
    }

    const plan = await prisma.membership_plans.create({
      data: {
        gym_id,
        name: trimmedName,
        duration_days: parsedDuration,
        price: Number.isFinite(parsedPrice) ? parsedPrice : 0,
        description: description ? String(description).trim() : null,
        is_active: true,
      },
    });

    ensuredDefaultPlansByGym.add(gym_id);
    res.status(201).json({ plan });
  } catch (err) {
    console.error(err);
    const isDuplicate = err?.code === 'P2002';
    res.status(isDuplicate ? 409 : 500).json({
      error: isDuplicate ? 'A plan with this name already exists' : 'Failed to create membership plan',
      details: process.env.NODE_ENV !== 'production' ? err.message : undefined,
    });
  }
};

const updateMembershipPlan = async (req, res) => {
  try {
    const gym_id = req.gym_id;
    const { id } = req.params;
    const { name, duration_days, price, description, is_active } = req.body;

    const existingPlan = await prisma.membership_plans.findFirst({
      where: { id, gym_id },
    });

    if (!existingPlan) {
      return res.status(404).json({ error: 'Membership plan not found' });
    }

    const nextName =
      name === undefined ? existingPlan.name : String(name || '').trim();
    const nextDuration =
      duration_days === undefined ? existingPlan.duration_days : parseInt(duration_days, 10);
    const nextPrice =
      price === undefined ? existingPlan.price : Number(price);

    if (!nextName || !nextDuration || nextDuration <= 0) {
      return res.status(400).json({ error: 'Valid name and duration_days are required' });
    }

    if (!Number.isFinite(nextPrice) || nextPrice < 0) {
      return res.status(400).json({ error: 'Valid price is required' });
    }

    const plan = await prisma.membership_plans.update({
      where: { id: existingPlan.id },
      data: {
        name: nextName,
        duration_days: nextDuration,
        price: nextPrice,
        description:
          description === undefined ? existingPlan.description : String(description || '').trim() || null,
        is_active: is_active === undefined ? existingPlan.is_active : Boolean(is_active),
      },
    });

    ensuredDefaultPlansByGym.add(gym_id);
    res.json({ plan });
  } catch (err) {
    console.error(err);
    const isDuplicate = err?.code === 'P2002';
    res.status(isDuplicate ? 409 : 500).json({
      error: isDuplicate ? 'A plan with this name already exists' : 'Failed to update membership plan',
      details: process.env.NODE_ENV !== 'production' ? err.message : undefined,
    });
  }
};

module.exports = {
  ensureDefaultPlans,
  listMembershipPlans,
  createMembershipPlan,
  updateMembershipPlan,
};
