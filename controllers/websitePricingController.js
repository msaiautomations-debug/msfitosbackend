const prisma = require('../utils/prisma');

const DEFAULT_SETTINGS = {
  id: 'default',
  tagline: 'Affordable pricing designed for growing gyms',
  billing_toggle_enabled: true,
};

const DEFAULT_PLANS = [
  {
    name: 'Basic',
    description: 'For gyms that want automated reminders and a cleaner renewal process.',
    monthly_price: 2499,
    monthly_discount_type: 'percent',
    monthly_discount_value: 20,
    yearly_price: 23999,
    yearly_discount_type: 'flat',
    yearly_discount_value: 6000,
    features: [
      'Auto WhatsApp renewal reminders',
      'Payment follow-up tracking',
      'Attendance and member visibility',
      'Simple onboarding for your staff',
    ],
    cta_label: 'Get Started',
    badge_text: 'Limited time discount',
    is_recommended: false,
    is_visible: true,
    has_custom_feature_requests: false,
    sort_order: 0,
  },
  {
    name: 'Pro',
    description: 'Best for growing gyms that need stronger follow-ups and day-to-day operational clarity.',
    monthly_price: 4999,
    monthly_discount_type: 'percent',
    monthly_discount_value: 25,
    yearly_price: 47999,
    yearly_discount_type: 'flat',
    yearly_discount_value: 12000,
    features: [
      'Everything in Basic',
      'Inactive member detection',
      'Renewal and collection analytics',
      'Priority support for gym owners',
    ],
    cta_label: 'Choose Plan',
    badge_text: 'Most gyms pick this',
    is_recommended: true,
    is_visible: true,
    has_custom_feature_requests: false,
    sort_order: 1,
  },
  {
    name: 'Premium',
    description: 'For established gyms that want a more tailored operating system and closer collaboration.',
    monthly_price: 7999,
    monthly_discount_type: 'flat',
    monthly_discount_value: 1500,
    yearly_price: 77999,
    yearly_discount_type: 'flat',
    yearly_discount_value: 18000,
    features: [
      'Everything in Pro',
      'Advanced automation reviews',
      'Priority onboarding and support',
      'Custom dashboard guidance',
    ],
    cta_label: 'Talk to Us',
    badge_text: 'Scale-ready',
    is_recommended: false,
    is_visible: true,
    has_custom_feature_requests: true,
    sort_order: 2,
  },
];

const VALID_DISCOUNT_TYPES = new Set(['percent', 'flat']);

function toNumberOrNull(value) {
  if (value === undefined || value === null || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

function normalizeFeatures(features) {
  if (Array.isArray(features)) {
    return features.map((item) => String(item || '').trim()).filter(Boolean);
  }

  if (typeof features === 'string') {
    return features
      .split(/\r?\n/)
      .map((item) => item.trim())
      .filter(Boolean);
  }

  return [];
}

function computeDiscountedPrice(price, discountType, discountValue) {
  if (!Number.isFinite(price) || price < 0) return null;
  if (!discountType || !Number.isFinite(discountValue) || discountValue <= 0) return price;

  if (discountType === 'percent') {
    return Math.max(0, price - (price * discountValue) / 100);
  }

  return Math.max(0, price - discountValue);
}

function serializePlan(plan) {
  const features = Array.isArray(plan.features) ? plan.features : normalizeFeatures(plan.features);

  return {
    ...plan,
    features,
    monthly_discounted_price: computeDiscountedPrice(
      plan.monthly_price,
      plan.monthly_discount_type,
      plan.monthly_discount_value,
    ),
    yearly_discounted_price: computeDiscountedPrice(
      plan.yearly_price,
      plan.yearly_discount_type,
      plan.yearly_discount_value,
    ),
  };
}

async function ensureWebsitePricingData() {
  const [settings, planCount] = await Promise.all([
    prisma.website_pricing_settings.findUnique({ where: { id: DEFAULT_SETTINGS.id } }),
    prisma.website_pricing_plans.count(),
  ]);

  if (!settings) {
    await prisma.website_pricing_settings.create({ data: DEFAULT_SETTINGS });
  }

  if (planCount === 0) {
    for (const plan of DEFAULT_PLANS) {
      await prisma.website_pricing_plans.create({ data: plan });
    }
  }
}

function validateDiscount(label, price, discountType, discountValue) {
  if (!discountType && (discountValue === null || discountValue === undefined)) return null;
  if (!VALID_DISCOUNT_TYPES.has(discountType)) {
    return `${label} discount type must be percent or flat`;
  }
  if (!Number.isFinite(discountValue) || discountValue <= 0) {
    return `${label} discount value must be greater than 0`;
  }
  if (discountType === 'percent' && discountValue > 100) {
    return `${label} percent discount cannot be greater than 100`;
  }
  if (discountType === 'flat' && Number.isFinite(price) && discountValue > price) {
    return `${label} flat discount cannot be greater than the base price`;
  }
  return null;
}

function buildPlanPayload(body, existingPlan) {
  const name = body.name === undefined ? existingPlan?.name : String(body.name || '').trim();
  const description =
    body.description === undefined
      ? existingPlan?.description ?? null
      : String(body.description || '').trim() || null;
  const featuresInput = body.features === undefined ? existingPlan?.features : body.features;
  const features = normalizeFeatures(featuresInput);
  const monthlyPrice =
    body.monthly_price === undefined ? existingPlan?.monthly_price ?? null : toNumberOrNull(body.monthly_price);
  const yearlyPrice =
    body.yearly_price === undefined ? existingPlan?.yearly_price ?? null : toNumberOrNull(body.yearly_price);
  const monthlyDiscountType =
    body.monthly_discount_type === undefined
      ? existingPlan?.monthly_discount_type ?? null
      : String(body.monthly_discount_type || '').trim() || null;
  const monthlyDiscountValue =
    body.monthly_discount_value === undefined
      ? existingPlan?.monthly_discount_value ?? null
      : toNumberOrNull(body.monthly_discount_value);
  const yearlyDiscountType =
    body.yearly_discount_type === undefined
      ? existingPlan?.yearly_discount_type ?? null
      : String(body.yearly_discount_type || '').trim() || null;
  const yearlyDiscountValue =
    body.yearly_discount_value === undefined
      ? existingPlan?.yearly_discount_value ?? null
      : toNumberOrNull(body.yearly_discount_value);
  const ctaLabel =
    body.cta_label === undefined ? existingPlan?.cta_label || 'Choose Plan' : String(body.cta_label || '').trim();
  const badgeText =
    body.badge_text === undefined
      ? existingPlan?.badge_text ?? null
      : String(body.badge_text || '').trim() || null;
  const sortOrder =
    body.sort_order === undefined
      ? existingPlan?.sort_order ?? 0
      : Number.parseInt(String(body.sort_order), 10);
  const isRecommended =
    body.is_recommended === undefined ? Boolean(existingPlan?.is_recommended) : Boolean(body.is_recommended);
  const isVisible =
    body.is_visible === undefined ? (existingPlan?.is_visible ?? true) : Boolean(body.is_visible);
  const hasCustomFeatureRequests =
    body.has_custom_feature_requests === undefined
      ? Boolean(existingPlan?.has_custom_feature_requests)
      : Boolean(body.has_custom_feature_requests);

  const payload = {
    name,
    description,
    monthly_price: monthlyPrice,
    monthly_discount_type: monthlyPrice === null ? null : monthlyDiscountType,
    monthly_discount_value: monthlyPrice === null ? null : monthlyDiscountValue,
    yearly_price: yearlyPrice,
    yearly_discount_type: yearlyPrice === null ? null : yearlyDiscountType,
    yearly_discount_value: yearlyPrice === null ? null : yearlyDiscountValue,
    features,
    cta_label: ctaLabel || 'Choose Plan',
    badge_text: badgeText,
    sort_order: Number.isFinite(sortOrder) ? sortOrder : Number.NaN,
    is_recommended: isRecommended,
    is_visible: isVisible,
    has_custom_feature_requests: hasCustomFeatureRequests,
  };

  if (!payload.name) {
    return { error: 'Plan name is required' };
  }

  if (!features.length) {
    return { error: 'Add at least one feature to the plan' };
  }

  if (payload.monthly_price === null && payload.yearly_price === null) {
    return { error: 'At least one price is required' };
  }

  if (
    (payload.monthly_price !== null && (!Number.isFinite(payload.monthly_price) || payload.monthly_price < 0)) ||
    (payload.yearly_price !== null && (!Number.isFinite(payload.yearly_price) || payload.yearly_price < 0))
  ) {
    return { error: 'Plan prices must be valid numbers' };
  }

  if (!Number.isFinite(payload.sort_order)) {
    return { error: 'Sort order must be a valid number' };
  }

  const monthlyDiscountError = validateDiscount(
    'Monthly',
    payload.monthly_price,
    payload.monthly_discount_type,
    payload.monthly_discount_value,
  );
  if (monthlyDiscountError) {
    return { error: monthlyDiscountError };
  }

  const yearlyDiscountError = validateDiscount(
    'Yearly',
    payload.yearly_price,
    payload.yearly_discount_type,
    payload.yearly_discount_value,
  );
  if (yearlyDiscountError) {
    return { error: yearlyDiscountError };
  }

  return { data: payload };
}

async function getSettingsAndPlans(includeHidden = false) {
  await ensureWebsitePricingData();

  const [settings, plans] = await Promise.all([
    prisma.website_pricing_settings.findUnique({ where: { id: DEFAULT_SETTINGS.id } }),
    prisma.website_pricing_plans.findMany({
      where: includeHidden ? undefined : { is_visible: true },
      orderBy: [{ sort_order: 'asc' }, { created_at: 'asc' }],
    }),
  ]);

  return {
    settings,
    plans: plans.map(serializePlan),
  };
}

const listWebsitePricing = async (req, res) => {
  try {
    const data = await getSettingsAndPlans(false);
    return res.json(data);
  } catch (err) {
    console.error(err);
    return res.status(500).json({
      error: 'Failed to load website pricing',
      details: process.env.NODE_ENV !== 'production' ? err.message : undefined,
    });
  }
};

const listWebsitePricingAdmin = async (req, res) => {
  try {
    const data = await getSettingsAndPlans(true);
    return res.json(data);
  } catch (err) {
    console.error(err);
    return res.status(500).json({
      error: 'Failed to load website pricing for admin',
      details: process.env.NODE_ENV !== 'production' ? err.message : undefined,
    });
  }
};

const updateWebsitePricingSettings = async (req, res) => {
  try {
    await ensureWebsitePricingData();

    const tagline =
      req.body?.tagline === undefined ? undefined : String(req.body.tagline || '').trim();
    const billingToggleEnabled =
      req.body?.billing_toggle_enabled === undefined
        ? undefined
        : Boolean(req.body.billing_toggle_enabled);

    if (tagline !== undefined && !tagline) {
      return res.status(400).json({ error: 'Tagline cannot be empty' });
    }

    const settings = await prisma.website_pricing_settings.upsert({
      where: { id: DEFAULT_SETTINGS.id },
      update: {
        ...(tagline !== undefined ? { tagline } : {}),
        ...(billingToggleEnabled !== undefined
          ? { billing_toggle_enabled: billingToggleEnabled }
          : {}),
      },
      create: {
        ...DEFAULT_SETTINGS,
        ...(tagline !== undefined ? { tagline } : {}),
        ...(billingToggleEnabled !== undefined
          ? { billing_toggle_enabled: billingToggleEnabled }
          : {}),
      },
    });

    return res.json({ settings });
  } catch (err) {
    console.error(err);
    return res.status(500).json({
      error: 'Failed to update website pricing settings',
      details: process.env.NODE_ENV !== 'production' ? err.message : undefined,
    });
  }
};

const createWebsitePricingPlan = async (req, res) => {
  try {
    await ensureWebsitePricingData();
    const { data, error } = buildPlanPayload(req.body || {});

    if (error) {
      return res.status(400).json({ error });
    }

    const plan = await prisma.$transaction(async (tx) => {
      if (data.is_recommended) {
        await tx.website_pricing_plans.updateMany({
          where: { is_recommended: true },
          data: { is_recommended: false },
        });
      }

      return tx.website_pricing_plans.create({ data });
    });

    return res.status(201).json({ plan: serializePlan(plan) });
  } catch (err) {
    console.error(err);
    return res.status(500).json({
      error: 'Failed to create website pricing plan',
      details: process.env.NODE_ENV !== 'production' ? err.message : undefined,
    });
  }
};

const updateWebsitePricingPlan = async (req, res) => {
  try {
    await ensureWebsitePricingData();
    const existingPlan = await prisma.website_pricing_plans.findUnique({
      where: { id: req.params.id },
    });

    if (!existingPlan) {
      return res.status(404).json({ error: 'Website pricing plan not found' });
    }

    const { data, error } = buildPlanPayload(req.body || {}, existingPlan);
    if (error) {
      return res.status(400).json({ error });
    }

    const plan = await prisma.$transaction(async (tx) => {
      if (data.is_recommended) {
        await tx.website_pricing_plans.updateMany({
          where: { is_recommended: true, NOT: { id: existingPlan.id } },
          data: { is_recommended: false },
        });
      }

      return tx.website_pricing_plans.update({
        where: { id: existingPlan.id },
        data,
      });
    });

    return res.json({ plan: serializePlan(plan) });
  } catch (err) {
    console.error(err);
    return res.status(500).json({
      error: 'Failed to update website pricing plan',
      details: process.env.NODE_ENV !== 'production' ? err.message : undefined,
    });
  }
};

const deleteWebsitePricingPlan = async (req, res) => {
  try {
    const existingPlan = await prisma.website_pricing_plans.findUnique({
      where: { id: req.params.id },
    });

    if (!existingPlan) {
      return res.status(404).json({ error: 'Website pricing plan not found' });
    }

    await prisma.website_pricing_plans.delete({ where: { id: existingPlan.id } });
    return res.json({ success: true });
  } catch (err) {
    console.error(err);
    return res.status(500).json({
      error: 'Failed to delete website pricing plan',
      details: process.env.NODE_ENV !== 'production' ? err.message : undefined,
    });
  }
};

module.exports = {
  listWebsitePricing,
  listWebsitePricingAdmin,
  updateWebsitePricingSettings,
  createWebsitePricingPlan,
  updateWebsitePricingPlan,
  deleteWebsitePricingPlan,
};
