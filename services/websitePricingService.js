const prisma = require('../utils/prisma');

const VALID_BILLING_CYCLES = new Set(['monthly', 'yearly']);

function computeDiscountedPrice(price, discountType, discountValue) {
  if (!Number.isFinite(price) || price < 0) return null;
  if (!discountType || !Number.isFinite(discountValue) || discountValue <= 0) return price;

  if (discountType === 'percent') {
    return Math.max(0, price - (price * discountValue) / 100);
  }

  return Math.max(0, price - discountValue);
}

function normalizeBillingCycle(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return VALID_BILLING_CYCLES.has(normalized) ? normalized : null;
}

function addBillingCycle(startDate, billingCycle) {
  const nextDate = new Date(startDate);

  if (billingCycle === 'monthly') {
    nextDate.setMonth(nextDate.getMonth() + 1);
    return nextDate;
  }

  if (billingCycle === 'yearly') {
    nextDate.setFullYear(nextDate.getFullYear() + 1);
    return nextDate;
  }

  return nextDate;
}

function getCyclePricing(plan, billingCycle) {
  const normalizedCycle = normalizeBillingCycle(billingCycle);
  if (!normalizedCycle || !plan) return null;

  const priceField = normalizedCycle === 'monthly' ? 'monthly_price' : 'yearly_price';
  const discountTypeField =
    normalizedCycle === 'monthly' ? 'monthly_discount_type' : 'yearly_discount_type';
  const discountValueField =
    normalizedCycle === 'monthly' ? 'monthly_discount_value' : 'yearly_discount_value';

  const basePrice = Number(plan[priceField]);
  if (!Number.isFinite(basePrice) || basePrice < 0) return null;

  return {
    billingCycle: normalizedCycle,
    basePrice,
    discountType: plan[discountTypeField] || null,
    discountValue: Number.isFinite(Number(plan[discountValueField]))
      ? Number(plan[discountValueField])
      : null,
    finalPrice: computeDiscountedPrice(
      basePrice,
      plan[discountTypeField],
      Number(plan[discountValueField]),
    ),
  };
}

async function findWebsitePricingPlan({ planId, planName }) {
  if (planId) {
    return prisma.website_pricing_plans.findUnique({
      where: { id: String(planId).trim() },
    });
  }

  const normalizedPlanName = String(planName || '').trim();
  if (!normalizedPlanName) return null;

  return prisma.website_pricing_plans.findFirst({
    where: {
      name: {
        equals: normalizedPlanName,
        mode: 'insensitive',
      },
    },
  });
}

async function resolveWebsitePricingSelection({ planId, planName, billingCycle }) {
  const normalizedCycle = normalizeBillingCycle(billingCycle);
  if (!normalizedCycle) return null;

  const plan = await findWebsitePricingPlan({ planId, planName });
  if (!plan) return null;

  const cyclePricing = getCyclePricing(plan, normalizedCycle);
  if (!cyclePricing) return null;

  return {
    plan,
    planName: plan.name,
    billingCycle: normalizedCycle,
    amount: cyclePricing.finalPrice,
    baseAmount: cyclePricing.basePrice,
    discountType: cyclePricing.discountType,
    discountValue: cyclePricing.discountValue,
  };
}

module.exports = {
  addBillingCycle,
  computeDiscountedPrice,
  findWebsitePricingPlan,
  getCyclePricing,
  normalizeBillingCycle,
  resolveWebsitePricingSelection,
};
