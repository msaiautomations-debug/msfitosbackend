const jwt = require('jsonwebtoken');
const prisma = require('../utils/prisma');
const {
  addBillingCycle,
  normalizeBillingCycle,
  resolveWebsitePricingSelection,
} = require('../services/websitePricingService');

const DEFAULT_ADMIN_PASSWORD = 'MS@Fitness2024';
const MAX_DIET_PLAN_BYTES = 5 * 1024 * 1024;
const SUPABASE_DIET_PLAN_BUCKET = process.env.SUPABASE_DIET_PLAN_BUCKET || 'diet-plans';

function getRequiredSupabaseConfig() {
  const supabaseUrl = String(process.env.SUPABASE_URL || '').replace(/\/+$/, '');
  const serviceRoleKey = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '');

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('Supabase storage is not configured on the server');
  }

  return { supabaseUrl, serviceRoleKey };
}

function sanitizeStoragePathPart(value) {
  return String(value || '').trim().replace(/[^a-zA-Z0-9_-]/g, '_') || 'gym';
}

function calculateTrialDaysRemaining(trialEndDate, now) {
  if (!trialEndDate) return null;
  const diff = trialEndDate.getTime() - now.getTime();
  return Math.max(0, Math.ceil(diff / (1000 * 60 * 60 * 24)));
}

function buildGymStatusDetails(gym) {
  const now = new Date();
  const trialEndDate = gym.trial_end_date ? new Date(gym.trial_end_date) : null;
  const isOnFreeTrial = Boolean(gym.plan === 'trial' && trialEndDate && trialEndDate >= now);
  const hasPaid = gym.subscription_status === 'active' || (gym.payments || []).length > 0;
  const isActivated = Boolean(gym.email_verified) && (gym.subscription_status === 'active' || isOnFreeTrial);
  const isInactive = !isActivated;
  const lastPaidAt = gym.payments?.[0]?.created_at || null;
  const trialDaysRemaining = calculateTrialDaysRemaining(trialEndDate, now);

  let currentStatusLabel = 'Inactive';
  if (!gym.email_verified) {
    currentStatusLabel = 'Pending verification';
  } else if (hasPaid) {
    currentStatusLabel = 'Paid';
  } else if (isOnFreeTrial) {
    currentStatusLabel = 'Free trial';
  } else if (isActivated) {
    currentStatusLabel = 'Activated';
  }

  let accessWindowLabel = 'Inactive';
  if (isOnFreeTrial && trialDaysRemaining !== null) {
    accessWindowLabel = `${trialDaysRemaining} day${trialDaysRemaining === 1 ? '' : 's'} left in trial`;
  } else if (trialEndDate && trialEndDate < now) {
    accessWindowLabel = `Trial expired on ${trialEndDate.toLocaleDateString('en-IN')}`;
  } else if (hasPaid) {
    accessWindowLabel = 'Paid access';
  }

  return {
    paid_payment_count: gym.payments?.length || 0,
    last_paid_at: lastPaidAt,
    statuses: {
      activated: isActivated,
      inactive: isInactive,
      free_trial: isOnFreeTrial,
      paid: hasPaid,
      unpaid: !hasPaid,
    },
    current_status_label: currentStatusLabel,
    access_window_label: accessWindowLabel,
  };
}

function serializeGymBooking(gym) {
  return {
    id: gym.id,
    gym_name: gym.gym_name,
    gym_id: gym.gym_id,
    owner_name: gym.owner_name,
    email: gym.email,
    phone: gym.phone,
    plan: gym.plan,
    email_verified: gym.email_verified,
    subscription_status: gym.subscription_status,
    created_at: gym.created_at,
    trial_start_date: gym.trial_start_date,
    trial_end_date: gym.trial_end_date,
    membership_plans:
      gym.membership_plans?.map((plan) => ({
        id: plan.id,
        name: plan.name,
        duration_days: plan.duration_days,
        price: plan.price,
        description: plan.description,
        is_active: plan.is_active,
        created_at: plan.created_at,
      })) || [],
    subscription_payments:
      gym.payments?.map((payment) => ({
        id: payment.id,
        amount: payment.amount,
        status: payment.status,
        created_at: payment.created_at,
      })) || [],
    ...buildGymStatusDetails(gym),
  };
}

function serializeGymListItem(gym) {
  return {
    id: gym.id,
    gym_name: gym.gym_name,
    owner_name: gym.owner_name || null,
    plan: gym.plan,
    plan_expiry: gym.trial_end_date,
    subscription_status: gym.subscription_status,
  };
}

function parseDateOrUndefined(value) {
  if (value === undefined) return undefined;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? Number.NaN : parsed;
}

function resolveRenewalStartDate(currentExpiry) {
  const now = new Date();
  if (!currentExpiry) return now;

  const parsedExpiry = new Date(currentExpiry);
  if (Number.isNaN(parsedExpiry.getTime())) return now;

  return parsedExpiry > now ? parsedExpiry : now;
}

const adminLogin = async (req, res) => {
  try {
    const { password } = req.body || {};
    const expectedPassword = process.env.ADMIN_PASSWORD || DEFAULT_ADMIN_PASSWORD;

    if (!password) {
      return res.status(400).json({ error: 'Admin password is required' });
    }

    if (password !== expectedPassword) {
      return res.status(401).json({ error: 'Invalid admin password' });
    }

    const token = jwt.sign(
      { role: 'admin', scope: 'website_pricing' },
      process.env.JWT_SECRET,
      { expiresIn: '12h' },
    );

    return res.json({ token });
  } catch (err) {
    console.error(err);
    return res.status(500).json({
      error: 'Admin login failed',
      details: process.env.NODE_ENV !== 'production' ? err.message : undefined,
    });
  }
};

const listGyms = async (req, res) => {
  try {
    const gyms = await prisma.gyms.findMany({
      orderBy: { gym_name: 'asc' },
      select: {
        id: true,
        gym_name: true,
        owner_name: true,
        plan: true,
        trial_end_date: true,
        subscription_status: true,
      },
    });

    return res.json({ gyms: gyms.map(serializeGymListItem) });
  } catch (err) {
    console.error(err);
    return res.status(500).json({
      error: 'Failed to load gyms',
      details: process.env.NODE_ENV !== 'production' ? err.message : undefined,
    });
  }
};

const getGymDetails = async (req, res) => {
  try {
    const gym = await prisma.gyms.findUnique({
      where: { id: req.params.id },
      select: {
        id: true,
        gym_name: true,
        gym_id: true,
        owner_name: true,
        email: true,
        phone: true,
        plan: true,
        email_verified: true,
        subscription_status: true,
        created_at: true,
        trial_start_date: true,
        trial_end_date: true,
        payments: {
          where: {
            member_id: null,
          },
          orderBy: { created_at: 'desc' },
          select: {
            id: true,
            amount: true,
            status: true,
            created_at: true,
          },
        },
        membership_plans: {
          orderBy: [{ is_active: 'desc' }, { duration_days: 'asc' }, { created_at: 'asc' }],
          select: {
            id: true,
            name: true,
            duration_days: true,
            price: true,
            description: true,
            is_active: true,
            created_at: true,
          },
        },
      },
    });

    if (!gym) {
      return res.status(404).json({ error: 'Gym not found' });
    }

    return res.json({ gym: serializeGymBooking(gym) });
  } catch (err) {
    console.error(err);
    return res.status(500).json({
      error: 'Failed to load gym details',
      details: process.env.NODE_ENV !== 'production' ? err.message : undefined,
    });
  }
};

const updateGym = async (req, res) => {
  try {
    const existingGym = await prisma.gyms.findUnique({ where: { id: req.params.id } });
    if (!existingGym) {
      return res.status(404).json({ error: 'Gym not found' });
    }

    const gym_name = req.body?.gym_name === undefined ? undefined : String(req.body.gym_name || '').trim();
    const gym_id = req.body?.gym_id === undefined ? undefined : String(req.body.gym_id || '').trim();
    const owner_name =
      req.body?.owner_name === undefined ? undefined : String(req.body.owner_name || '').trim();
    const email = req.body?.email === undefined ? undefined : String(req.body.email || '').trim();
    const phone = req.body?.phone === undefined ? undefined : String(req.body.phone || '').trim();
    const plan = req.body?.plan === undefined ? undefined : String(req.body.plan || '').trim();
    const subscription_status =
      req.body?.subscription_status === undefined
        ? undefined
        : String(req.body.subscription_status || '').trim();
    const email_verified =
      req.body?.email_verified === undefined ? undefined : Boolean(req.body.email_verified);
    const trial_start_date = parseDateOrUndefined(req.body?.trial_start_date);
    const trial_end_date = parseDateOrUndefined(req.body?.trial_end_date);

    if ([gym_name, gym_id, owner_name, email, phone].some((value) => value === '')) {
      return res.status(400).json({ error: 'Gym name, gym ID, owner name, email, and phone cannot be empty' });
    }

    if (plan !== undefined && !plan) {
      return res.status(400).json({ error: 'Plan cannot be empty' });
    }

    if (subscription_status !== undefined && !subscription_status) {
      return res.status(400).json({ error: 'Subscription status cannot be empty' });
    }

    if (Number.isNaN(trial_start_date?.getTime?.()) || Number.isNaN(trial_end_date?.getTime?.())) {
      return res.status(400).json({ error: 'Trial dates must be valid dates' });
    }

    if (gym_id && gym_id !== existingGym.gym_id) {
      const duplicateGymId = await prisma.gyms.findFirst({
        where: {
          gym_id,
          NOT: { id: existingGym.id },
        },
      });
      if (duplicateGymId) {
        return res.status(409).json({ error: 'Gym ID is already in use' });
      }
    }

    if (email && email !== existingGym.email) {
      const duplicateEmail = await prisma.gyms.findFirst({
        where: {
          email,
          NOT: { id: existingGym.id },
        },
      });
      if (duplicateEmail) {
        return res.status(409).json({ error: 'Email is already in use' });
      }
    }

    const updatedGym = await prisma.gyms.update({
      where: { id: existingGym.id },
      data: {
        ...(gym_name !== undefined ? { gym_name } : {}),
        ...(gym_id !== undefined ? { gym_id } : {}),
        ...(owner_name !== undefined ? { owner_name } : {}),
        ...(email !== undefined ? { email } : {}),
        ...(phone !== undefined ? { phone } : {}),
        ...(plan !== undefined ? { plan } : {}),
        ...(subscription_status !== undefined ? { subscription_status } : {}),
        ...(email_verified !== undefined ? { email_verified } : {}),
        ...(trial_start_date !== undefined ? { trial_start_date } : {}),
        ...(trial_end_date !== undefined ? { trial_end_date } : {}),
      },
      select: {
        id: true,
        gym_name: true,
        gym_id: true,
        owner_name: true,
        email: true,
        phone: true,
        plan: true,
        email_verified: true,
        subscription_status: true,
        created_at: true,
        trial_start_date: true,
        trial_end_date: true,
        payments: {
          where: {
            member_id: null,
          },
          orderBy: { created_at: 'desc' },
          select: {
            id: true,
            amount: true,
            status: true,
            created_at: true,
          },
        },
        membership_plans: {
          orderBy: [{ is_active: 'desc' }, { duration_days: 'asc' }, { created_at: 'asc' }],
          select: {
            id: true,
            name: true,
            duration_days: true,
            price: true,
            description: true,
            is_active: true,
            created_at: true,
          },
        },
      },
    });

    return res.json({
      gym: serializeGymBooking(updatedGym),
      message: 'Gym updated successfully',
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({
      error: 'Failed to update gym',
      details: process.env.NODE_ENV !== 'production' ? err.message : undefined,
    });
  }
};

const deleteGym = async (req, res) => {
  try {
    const existingGym = await prisma.gyms.findUnique({ where: { id: req.params.id } });
    if (!existingGym) {
      return res.status(404).json({ error: 'Gym not found' });
    }

    await prisma.$transaction(async (tx) => {
      await tx.trainer_sessions.deleteMany({ where: { gym_id: existingGym.id } });
      await tx.attendances.deleteMany({ where: { gym_id: existingGym.id } });
      await tx.gym_notifications.deleteMany({ where: { gym_id: existingGym.id } });
      await tx.payments.deleteMany({ where: { gym_id: existingGym.id } });
      await tx.trial_users.deleteMany({ where: { gym_id: existingGym.id } });
      await tx.members.deleteMany({ where: { gym_id: existingGym.id } });
      await tx.trainers.deleteMany({ where: { gym_id: existingGym.id } });
      await tx.membership_plans.deleteMany({ where: { gym_id: existingGym.id } });
      await tx.reminder_settings.deleteMany({ where: { gym_id: existingGym.id } });
      await tx.fitness_tips.deleteMany({ where: { gym_id: existingGym.id } });
      await tx.email_notifications.deleteMany({ where: { gym_id: existingGym.id } });
      await tx.gym_subscriptions.deleteMany({ where: { gym_id: existingGym.id } });
      await tx.gyms.delete({ where: { id: existingGym.id } });
    });

    return res.json({ success: true, message: 'Gym removed successfully' });
  } catch (err) {
    console.error(err);
    return res.status(500).json({
      error: 'Failed to remove gym',
      details: process.env.NODE_ENV !== 'production' ? err.message : undefined,
    });
  }
};

const createGymPayment = async (req, res) => {
  try {
    const gym = await prisma.gyms.findUnique({ where: { id: req.params.id } });
    if (!gym) {
      return res.status(404).json({ error: 'Gym not found' });
    }

    const requestedPlanName = String(req.body?.plan_name || '').trim();
    const billingCycle = normalizeBillingCycle(req.body?.billing_cycle);
    const websitePricingSelection = billingCycle
      ? await resolveWebsitePricingSelection({
          planId: req.body?.plan_id,
          planName: requestedPlanName,
          billingCycle,
        })
      : null;

    if (req.body?.billing_cycle && !billingCycle) {
      return res.status(400).json({ error: 'Billing cycle must be monthly or yearly' });
    }

    if (req.body?.billing_cycle && !websitePricingSelection) {
      return res.status(400).json({ error: 'Selected pricing plan is not available for this billing cycle' });
    }

    const plan_name = websitePricingSelection?.planName || requestedPlanName;
    const amount = websitePricingSelection?.amount ?? Number(req.body?.amount);
    const duration_days = websitePricingSelection
      ? null
      : Number.parseInt(String(req.body?.duration_days || ''), 10);

    if (!plan_name) {
      return res.status(400).json({ error: 'Plan name is required' });
    }
    if (!Number.isFinite(amount) || amount <= 0) {
      return res.status(400).json({ error: 'Valid amount is required' });
    }
    if (!websitePricingSelection && (!Number.isFinite(duration_days) || duration_days <= 0)) {
      return res.status(400).json({ error: 'Valid duration in days is required' });
    }

    const subscriptionStartDate = resolveRenewalStartDate(gym.trial_end_date);
    const endDate = websitePricingSelection
      ? addBillingCycle(subscriptionStartDate, billingCycle)
      : new Date(subscriptionStartDate);

    if (!websitePricingSelection) {
      endDate.setDate(endDate.getDate() + duration_days);
    }

    await prisma.$transaction(async (tx) => {
      await tx.payments.create({
        data: {
          gym_id: gym.id,
          amount,
          status: 'paid',
        },
      });

      await tx.gym_subscriptions.create({
        data: {
          gym_id: gym.id,
          plan_name: websitePricingSelection ? `${plan_name} (${billingCycle})` : plan_name,
          status: 'active',
          start_date: subscriptionStartDate,
          end_date: endDate,
        },
      });

      await tx.gyms.update({
        where: { id: gym.id },
        data: {
          plan: plan_name,
          subscription_status: 'active',
          trial_end_date: endDate,
        },
      });
    });

    return res.status(201).json({ success: true, message: 'Gym payment added successfully' });
  } catch (err) {
    console.error(err);
    return res.status(500).json({
      error: 'Failed to add gym payment',
      details: process.env.NODE_ENV !== 'production' ? err.message : undefined,
    });
  }
};

const createGymMembershipPlan = async (req, res) => {
  try {
    const gym = await prisma.gyms.findUnique({ where: { id: req.params.id } });
    if (!gym) {
      return res.status(404).json({ error: 'Gym not found' });
    }

    const name = String(req.body?.name || '').trim();
    const duration_days = Number.parseInt(String(req.body?.duration_days || ''), 10);
    const price = Number(req.body?.price || 0);
    const description = String(req.body?.description || '').trim() || null;

    if (!name || !Number.isFinite(duration_days) || duration_days <= 0) {
      return res.status(400).json({ error: 'Valid membership name and duration are required' });
    }
    if (!Number.isFinite(price) || price < 0) {
      return res.status(400).json({ error: 'Valid membership price is required' });
    }

    const plan = await prisma.membership_plans.create({
      data: {
        gym_id: gym.id,
        name,
        duration_days,
        price,
        description,
        is_active: true,
      },
    });

    return res.status(201).json({ plan, message: 'Membership plan added successfully' });
  } catch (err) {
    console.error(err);
    const isDuplicate = err?.code === 'P2002';
    return res.status(isDuplicate ? 409 : 500).json({
      error: isDuplicate ? 'A membership plan with this name already exists for this gym' : 'Failed to add membership plan',
      details: process.env.NODE_ENV !== 'production' ? err.message : undefined,
    });
  }
};

const updateGymMembershipPlan = async (req, res) => {
  try {
    const gym = await prisma.gyms.findUnique({ where: { id: req.params.id } });
    if (!gym) {
      return res.status(404).json({ error: 'Gym not found' });
    }

    const existingPlan = await prisma.membership_plans.findFirst({
      where: {
        id: req.params.planId,
        gym_id: gym.id,
      },
    });

    if (!existingPlan) {
      return res.status(404).json({ error: 'Membership plan not found' });
    }

    const name = req.body?.name === undefined ? existingPlan.name : String(req.body?.name || '').trim();
    const duration_days =
      req.body?.duration_days === undefined
        ? existingPlan.duration_days
        : Number.parseInt(String(req.body?.duration_days || ''), 10);
    const price = req.body?.price === undefined ? Number(existingPlan.price || 0) : Number(req.body?.price || 0);
    const description =
      req.body?.description === undefined
        ? existingPlan.description
        : String(req.body?.description || '').trim() || null;
    const is_active =
      req.body?.is_active === undefined ? existingPlan.is_active : Boolean(req.body?.is_active);

    if (!name || !Number.isFinite(duration_days) || duration_days <= 0) {
      return res.status(400).json({ error: 'Valid membership name and duration are required' });
    }
    if (!Number.isFinite(price) || price < 0) {
      return res.status(400).json({ error: 'Valid membership price is required' });
    }

    const plan = await prisma.membership_plans.update({
      where: { id: existingPlan.id },
      data: {
        name,
        duration_days,
        price,
        description,
        is_active,
      },
    });

    return res.json({ plan, message: 'Membership plan updated successfully' });
  } catch (err) {
    console.error(err);
    const isDuplicate = err?.code === 'P2002';
    return res.status(isDuplicate ? 409 : 500).json({
      error: isDuplicate ? 'A membership plan with this name already exists for this gym' : 'Failed to update membership plan',
      details: process.env.NODE_ENV !== 'production' ? err.message : undefined,
    });
  }
};

const listGymBookings = async (req, res) => {
  try {
    const gyms = await prisma.gyms.findMany({
      orderBy: { created_at: 'desc' },
      select: {
        id: true,
        gym_name: true,
        gym_id: true,
        owner_name: true,
        email: true,
        phone: true,
        plan: true,
        email_verified: true,
        subscription_status: true,
        created_at: true,
        trial_start_date: true,
        trial_end_date: true,
        payments: {
          where: {
            member_id: null,
            status: 'paid',
          },
          orderBy: { created_at: 'desc' },
          select: {
            id: true,
            created_at: true,
          },
        },
      },
    });

    const serializedGyms = gyms.map(serializeGymBooking);

    const summary = serializedGyms.reduce(
      (accumulator, gym) => {
        accumulator.total += 1;
        if (gym.statuses.activated) accumulator.activated += 1;
        if (gym.statuses.inactive) accumulator.inactive += 1;
        if (gym.statuses.free_trial) accumulator.free_trial += 1;
        if (gym.statuses.paid) accumulator.paid += 1;
        if (gym.statuses.unpaid) accumulator.unpaid += 1;
        return accumulator;
      },
      {
        total: 0,
        activated: 0,
        inactive: 0,
        free_trial: 0,
        paid: 0,
        unpaid: 0,
      },
    );

    return res.json({
      summary,
      gyms: serializedGyms,
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({
      error: 'Failed to load gym booking submissions',
      details: process.env.NODE_ENV !== 'production' ? err.message : undefined,
    });
  }
};

const getAdminDietPlan = async (req, res) => {
  try {
    const settings = await prisma.website_pricing_settings.upsert({
      where: { id: 'default' },
      update: {},
      create: { id: 'default' },
      select: { diet_plan_pdf_url: true },
    });

    return res.json({ diet_plan_pdf_url: settings.diet_plan_pdf_url || null });
  } catch (err) {
    console.error(err);
    return res.status(500).json({
      error: 'Failed to load diet plan PDF',
      details: process.env.NODE_ENV !== 'production' ? err.message : undefined,
    });
  }
};

const uploadAdminDietPlan = async (req, res) => {
  try {
    const contentType = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
    const fileBuffer = Buffer.isBuffer(req.body) ? req.body : null;

    if (contentType !== 'application/pdf') {
      return res.status(400).json({ error: 'Only PDF diet plans are allowed' });
    }

    if (!fileBuffer?.length) {
      return res.status(400).json({ error: 'Diet plan PDF is required' });
    }

    if (fileBuffer.length > MAX_DIET_PLAN_BYTES) {
      return res.status(400).json({ error: 'Diet plan PDF must be less than 5MB' });
    }

    const { supabaseUrl, serviceRoleKey } = getRequiredSupabaseConfig();
    const objectPath = `${sanitizeStoragePathPart('global')}/diet-plan.pdf`;
    const uploadUrl = `${supabaseUrl}/storage/v1/object/${SUPABASE_DIET_PLAN_BUCKET}/${objectPath}`;

    const uploadResponse = await fetch(uploadUrl, {
      method: 'POST',
      headers: {
        apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`,
        'Content-Type': contentType,
        'x-upsert': 'true',
      },
      body: fileBuffer,
    });

    if (!uploadResponse.ok) {
      const details = await uploadResponse.text().catch(() => '');
      return res.status(uploadResponse.status >= 400 && uploadResponse.status < 500 ? 400 : 502).json({
        error: details || 'Failed to upload diet plan PDF to Supabase',
      });
    }

    const dietPlanUrl = `${supabaseUrl}/storage/v1/object/public/${SUPABASE_DIET_PLAN_BUCKET}/${objectPath}?v=${Date.now()}`;
    const settings = await prisma.website_pricing_settings.upsert({
      where: { id: 'default' },
      update: { diet_plan_pdf_url: dietPlanUrl },
      create: { id: 'default', diet_plan_pdf_url: dietPlanUrl },
      select: { diet_plan_pdf_url: true },
    });

    return res.json({ diet_plan_pdf_url: settings.diet_plan_pdf_url, message: 'Diet plan uploaded' });
  } catch (err) {
    console.error(err);
    return res.status(500).json({
      error: 'Failed to upload diet plan PDF',
      details: process.env.NODE_ENV !== 'production' ? err.message : undefined,
    });
  }
};

const removeAdminDietPlan = async (req, res) => {
  try {
    const settings = await prisma.website_pricing_settings.upsert({
      where: { id: 'default' },
      update: { diet_plan_pdf_url: null },
      create: { id: 'default', diet_plan_pdf_url: null },
      select: { diet_plan_pdf_url: true },
    });

    return res.json({ diet_plan_pdf_url: settings.diet_plan_pdf_url, message: 'Diet plan removed' });
  } catch (err) {
    console.error(err);
    return res.status(500).json({
      error: 'Failed to remove diet plan PDF',
      details: process.env.NODE_ENV !== 'production' ? err.message : undefined,
    });
  }
};

module.exports = {
  adminLogin,
  listGyms,
  getGymDetails,
  updateGym,
  deleteGym,
  createGymPayment,
  createGymMembershipPlan,
  updateGymMembershipPlan,
  getAdminDietPlan,
  uploadAdminDietPlan,
  removeAdminDietPlan,
  listGymBookings,
};
