const prisma = require('../utils/prisma');

function addDays(date, days) {
  const d = new Date(date);
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

function getMembershipExpiryFromStart(startDate, planDurationDays) {
  const days = Math.max(1, parseInt(planDurationDays, 10) || 1);
  return addDays(startDate, days - 1);
}

function normalizePhone(phone) {
  return String(phone || '').replace(/\D/g, '').slice(0, 10);
}

function normalizeName(name) {
  return String(name || '').trim().replace(/\s+/g, ' ');
}

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

const allowedStatus = new Set(['trial', 'converted', 'lost']);

const listTrialUsers = async (req, res) => {
  try {
    const gym_id = req.gym_id;
    const status = req.query.status ? String(req.query.status) : null;
    const where = { gym_id };
    if (status && allowedStatus.has(status)) where.status = status;

    const trials = await prisma.trial_users.findMany({
      where,
      orderBy: { created_at: 'desc' },
    });

    res.json({ trials });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load trial users', details: process.env.NODE_ENV !== 'production' ? err.message : undefined });
  }
};

const createTrialUser = async (req, res) => {
  try {
    const gym_id = req.gym_id;
    const { name, phone, trial_date, trial_duration, trainer_name, notes } = req.body;
    if (!name || !phone) return res.status(400).json({ error: 'Missing fields' });

    const trial = await prisma.trial_users.create({
      data: {
        gym_id,
        name,
        phone,
        trial_date: trial_date ? new Date(trial_date) : new Date(),
        trial_duration: trial_duration ? parseInt(trial_duration, 10) : 7,
        trainer_name: trainer_name || null,
        notes: notes || null,
      },
    });

    res.status(201).json({ trial });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to create trial user', details: process.env.NODE_ENV !== 'production' ? err.message : undefined });
  }
};

const updateTrialUser = async (req, res) => {
  try {
    const gym_id = req.gym_id;
    const { id } = req.params;
    const { name, phone, trial_date, trial_duration, trainer_name, notes, status, lost_reason } = req.body;

    if (status && !allowedStatus.has(status)) return res.status(400).json({ error: 'Invalid status' });

    const data = {
      ...(name ? { name } : {}),
      ...(phone ? { phone } : {}),
      ...(trial_date ? { trial_date: new Date(trial_date) } : {}),
      ...(trial_duration ? { trial_duration: parseInt(trial_duration, 10) } : {}),
      ...(trainer_name ? { trainer_name } : {}),
      ...(typeof notes === 'string' ? { notes } : {}),
      ...(status ? { status } : {}),
      ...(typeof lost_reason === 'string' ? { lost_reason } : {}),
    };

    const updated = await prisma.trial_users.updateMany({ where: { id, gym_id }, data });
    if (updated.count === 0) return res.status(404).json({ error: 'Trial user not found' });

    res.json({ message: 'Updated' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update trial user', details: process.env.NODE_ENV !== 'production' ? err.message : undefined });
  }
};

const convertTrialUser = async (req, res) => {
  try {
    const gym_id = req.gym_id;
    const { id } = req.params;
    const { name, phone, email, dob, plan_id, plan_duration, start_date, amount, payment_method } = req.body;
    if (!plan_duration) return res.status(400).json({ error: 'plan_duration required' });
    if (!email) return res.status(400).json({ error: 'email required' });

    const trial = await prisma.trial_users.findFirst({ where: { id, gym_id } });
    if (!trial) return res.status(404).json({ error: 'Trial user not found' });

    const cleanName = normalizeName(name || trial.name);
    const cleanPhone = normalizePhone(phone || trial.phone);
    const cleanEmail = normalizeEmail(email);
    const parsedPlanDuration = parseInt(plan_duration, 10);
    const parsedAmount = parseFloat(amount || 0);
    const start = start_date ? new Date(start_date) : new Date();
    const expiry = getMembershipExpiryFromStart(start, parsedPlanDuration);
    const dobDate = dob ? new Date(dob) : null;
    const safeDob = dobDate && !Number.isNaN(dobDate.getTime()) ? dobDate : null;
    const normalizedPaymentMethod =
      payment_method && String(payment_method).trim().toLowerCase() !== 'pending'
        ? String(payment_method).trim().toLowerCase()
        : null;
    const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    if (!cleanName || !cleanPhone) {
      return res.status(400).json({ error: 'name and phone are required' });
    }

    if (cleanPhone.length !== 10) {
      return res.status(400).json({ error: 'Phone number must be 10 digits' });
    }

    if (!emailPattern.test(cleanEmail)) {
      return res.status(400).json({ error: 'Valid email is required' });
    }

    let safePlanId = null;
    if (plan_id) {
      const plan = await prisma.membership_plans.findFirst({
        where: { id: plan_id, gym_id, is_active: true },
      });
      if (!plan) return res.status(400).json({ error: 'Invalid membership plan' });
      safePlanId = plan.id;
    }

    const [member] = await prisma.$transaction([
      prisma.members.create({
        data: {
          gym_id,
          name: cleanName,
          phone: cleanPhone,
          email: cleanEmail,
          dob: safeDob,
          plan_id: safePlanId,
          plan_duration: parsedPlanDuration,
          start_date: start,
          expiry_date: expiry,
          amount: parsedAmount,
          payment_method: normalizedPaymentMethod,
          payment_status: normalizedPaymentMethod ? 'paid' : 'pending',
        },
        include: {
          membership_plan: true,
        },
      }),
      prisma.trial_users.update({
        where: { id: trial.id },
        data: { status: 'converted' },
      }),
    ]);

    if (normalizedPaymentMethod) {
      await prisma.payments.create({
        data: {
          gym_id,
          member_id: member.id,
          amount: parsedAmount,
          status: 'paid',
        },
      });
    }

    res.json({ member, message: 'Trial user converted' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to convert trial user', details: process.env.NODE_ENV !== 'production' ? err.message : undefined });
  }
};

module.exports = { listTrialUsers, createTrialUser, updateTrialUser, convertTrialUser };
