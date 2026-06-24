const { Prisma } = require('@prisma/client');
const prisma = require('../utils/prisma');
const { getOrCreateReminderSettings } = require('../services/reminderSettingsService');
const { invalidateDashboardCache } = require('./dashboardController');
const { sendEmail } = require('../services/emailService');
const { measureAsync } = require('../utils/performance');
const {
  getMembershipEmailTemplate,
  renderMembershipEmail,
} = require('../services/membershipEmailService');
const { logGymNotification } = require('../services/notificationService');
const { sendWhatsappMessage } = require('../services/evolutionWhatsapp');

function addDays(date, days) {
  const d = new Date(date);
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

function getMembershipExpiryFromStart(startDate, planDurationDays) {
  const days = Math.max(1, parseInt(planDurationDays, 10) || 1);
  return addDays(startDate, days - 1);
}

const pendingAddMemberRequests = new Set();

function normalizePhone(phone) {
  return String(phone || '').replace(/\D/g, '').slice(0, 10);
}

function normalizeName(name) {
  return String(name || '').trim().replace(/\s+/g, ' ');
}

function normalizeEmail(email) {
  const cleanEmail = String(email || '').trim().toLowerCase();
  return cleanEmail || null;
}

function parseMemberSearchLimit(limitRaw) {
  if (limitRaw === undefined) return null;
  const parsed = parseInt(limitRaw, 10);
  if (!Number.isFinite(parsed)) return 20;
  return Math.max(1, parsed);
}

function buildMemberListItem(row) {
  return {
    id: row.id,
    name: row.name,
    phone: row.phone,
    email: row.email,
    dob: row.dob,
    plan_duration: Number(row.plan_duration || 0),
    height_cm: row.height_cm === null || row.height_cm === undefined ? null : Number(row.height_cm),
    weight_kg: row.weight_kg === null || row.weight_kg === undefined ? null : Number(row.weight_kg),
    bmi: row.bmi === null || row.bmi === undefined ? null : Number(row.bmi),
    start_date: row.start_date,
    expiry_date: row.expiry_date,
    amount: Number(row.amount || 0),
    payment_status: row.payment_status,
    payment_method: row.payment_method,
    is_paused: Boolean(row.is_paused),
    paused_at: row.paused_at,
    is_inactive: Boolean(row.is_inactive),
    inactive_since: row.inactive_since,
    created_at: row.created_at,
    plan_id: row.plan_id,
    membership_plan: row.membership_plan_id
      ? {
          id: row.membership_plan_id,
          name: row.membership_plan_name,
          duration_days: Number(row.membership_plan_duration_days || 0),
        }
      : null,
  };
}

async function findMatchingTrialsByContact({ gym_id, name, phone }) {
  const cleanName = normalizeName(name);
  const cleanPhone = normalizePhone(phone);
  const orConditions = [];

  if (cleanPhone) {
    orConditions.push({ phone: cleanPhone });
  }

  if (cleanName) {
    orConditions.push({ name: { equals: cleanName, mode: 'insensitive' } });
  }

  if (!orConditions.length) return [];

  return prisma.trial_users.findMany({
    where: {
      gym_id,
      OR: orConditions,
    },
    orderBy: [{ trial_date: 'desc' }, { created_at: 'desc' }],
  });
}

async function findDuplicateMemberByContact({ gym_id, phone, email, excludeId = null }) {
  const cleanPhone = normalizePhone(phone);
  const cleanEmail = normalizeEmail(email);
  const orConditions = [];

  if (cleanPhone) {
    orConditions.push({ phone: cleanPhone });
  }

  if (cleanEmail) {
    orConditions.push({ email: { equals: cleanEmail, mode: 'insensitive' } });
  }

  if (!orConditions.length) return null;

  return prisma.members.findFirst({
    where: {
      gym_id,
      ...(excludeId ? { NOT: { id: excludeId } } : {}),
      OR: orConditions,
    },
    select: {
      id: true,
      name: true,
      phone: true,
      email: true,
    },
    orderBy: { created_at: 'desc' },
  });
}

function buildPendingPaymentEmail({ gymName, memberName, amountDue, customMessage }) {
  const safeGymName = gymName || 'Your gym';
  const safeMemberName = memberName || 'Member';
  const safeAmount = Number(amountDue || 0);
  const intro =
    String(customMessage || '').trim() ||
    `Hi ${safeMemberName}, this is a reminder from ${safeGymName} that your membership payment is still pending.`;

  const html = `
    <div style="font-family:Arial,sans-serif;line-height:1.6;color:#111827;">
      <p>${intro}</p>
      <p><strong>Gym:</strong> ${safeGymName}</p>
      <p><strong>Member:</strong> ${safeMemberName}</p>
      <p><strong>Amount Due:</strong> ${safeAmount}</p>
      <p>Please complete your membership payment at the earliest convenience.</p>
    </div>
  `;

  const text = [
    intro,
    `Gym: ${safeGymName}`,
    `Member: ${safeMemberName}`,
    `Amount Due: ${safeAmount}`,
    'Please complete your membership payment at the earliest convenience.',
  ].join('\n');

  return { html, text };
}

function formatDateForMessage(date) {
  if (!date) return '';
  return new Date(date).toISOString().slice(0, 10);
}

function renderWhatsappTemplate(template, { member, gymName, lastCheckinDate }) {
  const values = {
    member_name: member?.name || 'Member',
    gym_name: gymName || 'Your gym',
    expiry_date: formatDateForMessage(member?.expiry_date),
    amount_due: String(Number(member?.amount || 0)),
    last_checkin_date: lastCheckinDate ? formatDateForMessage(lastCheckinDate) : '',
  };

  return String(template || '')
    .replace(/\{\{\s*(member_name|gym_name|expiry_date|amount_due|last_checkin_date)\s*\}\}/g, (_, key) => values[key] || '')
    .replace(/\{(member_name|gym_name|expiry_date|amount_due|last_checkin_date)\}/g, (_, key) => values[key] || '')
    .trim();
}

function buildPendingPaymentWhatsapp({ gymName, memberName, amountDue, customMessage }) {
  const intro =
    String(customMessage || '').trim() ||
    `Hi ${memberName || 'Member'}, this is a reminder from ${gymName || 'your gym'} that your membership payment is still pending.`;

  return [
    intro,
    `Gym: ${gymName || 'Your gym'}`,
    `Member: ${memberName || 'Member'}`,
    `Amount Due: ${Number(amountDue || 0)}`,
    'Please complete your membership payment at the earliest convenience.',
  ].join('\n');
}

const DEFAULT_RENEWAL_EMAIL_SUBJECT = 'Your membership at {gym_name} has been renewed';
const DEFAULT_RENEWAL_EMAIL_BODY =
  'Hi {member_name},\n\nYour membership at {gym_name} has been renewed successfully.\n\nNew expiry: {expiry_date}\nAmount paid: {amount_due}\n\nThanks,\n{gym_name}';
const DEFAULT_RENEWAL_WHATSAPP_BODY =
  'Hi {member_name}, your membership at {gym_name} has been renewed successfully. New expiry: {expiry_date}. Amount paid: {amount_due}. Thank you.';

async function sendRenewalConfirmationMessages({ gym_id, member }) {
  const [gym, settings] = await Promise.all([
    prisma.gyms.findUnique({
      where: { id: gym_id },
      select: { id: true, gym_name: true, logo_url: true },
    }),
    getOrCreateReminderSettings(gym_id),
  ]);

  if (!gym) return { email: { skipped: true, reason: 'missing-gym' }, whatsapp: { skipped: true, reason: 'missing-gym' } };

  const result = {
    email: { skipped: true, reason: 'disabled' },
    whatsapp: { skipped: true, reason: 'disabled' },
  };

  if (settings.enable_renewal_email !== false) {
    const email = normalizeEmail(member.email);

    if (!email) {
      result.email = { skipped: true, reason: 'missing-email' };
    } else {
      const template = {
        subject: settings.email_subject_renewal || DEFAULT_RENEWAL_EMAIL_SUBJECT,
        body: settings.email_body_renewal || DEFAULT_RENEWAL_EMAIL_BODY,
      };
      const rendered = renderMembershipEmail({
        template,
        member,
        gymName: gym.gym_name,
      });

      try {
        await sendEmail({
          to: email,
          subject: rendered.subject,
          html: rendered.html,
          text: rendered.text,
        });

        await prisma.email_notifications.create({
          data: {
            gym_id,
            type: 'renewal_confirmation_email',
            status: 'sent',
            subject: rendered.subject,
            payload: {
              member_id: member.id,
              member_name: member.name,
              email,
              expiry_date: member.expiry_date?.toISOString?.() || null,
              amount_paid: member.amount,
            },
          },
        });

        result.email = { sent: true };
      } catch (error) {
        const message = error?.message || 'Failed to send renewal confirmation email';
        await prisma.email_notifications.create({
          data: {
            gym_id,
            type: 'renewal_confirmation_email',
            status: 'failed',
            subject: rendered.subject,
            error_message: message,
            payload: {
              member_id: member.id,
              member_name: member.name,
              email,
              expiry_date: member.expiry_date?.toISOString?.() || null,
              amount_paid: member.amount,
            },
          },
        });

        result.email = { sent: false, reason: message };
      }
    }
  }

  if (settings.enable_renewal_whatsapp !== false) {
    if (!member.phone) {
      result.whatsapp = { skipped: true, reason: 'missing-phone' };
    } else {
      const message = renderWhatsappTemplate(settings.whatsapp_body_renewal || DEFAULT_RENEWAL_WHATSAPP_BODY, {
        member,
        gymName: gym.gym_name,
      });

      try {
        await sendWhatsappMessage({ gymId: gym_id, phone: member.phone, message, mediaUrl: gym.logo_url });
        await logGymNotification({
          gym_id,
          member_id: member.id,
          type: 'renewal_confirmation_whatsapp',
          message,
          status: 'sent',
        });
        result.whatsapp = { sent: true };
      } catch (error) {
        const reason = error?.message || 'Failed to send renewal confirmation WhatsApp';
        await logGymNotification({
          gym_id,
          member_id: member.id,
          type: 'renewal_confirmation_whatsapp',
          message: reason,
          status: 'failed',
        });
        result.whatsapp = { sent: false, reason };
      }
    }
  }

  return result;
}

function formatCurrencyForMessage(amount) {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(Number(amount || 0));
}

function formatPaymentMethodForMessage(method) {
  const normalized = String(method || '').trim();
  if (!normalized) return 'Pending';
  return normalized
    .split(/[\s_-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(' ');
}

function calculateBmi(heightCm, weightKg) {
  const height = Number(heightCm || 0);
  const weight = Number(weightKg || 0);
  if (!height || !weight) return null;
  const heightM = height / 100;
  const bmi = weight / (heightM * heightM);
  if (!Number.isFinite(bmi)) return null;
  return Math.round(bmi * 10) / 10;
}

function getBmiCategory(bmi) {
  const value = Number(bmi || 0);
  if (!Number.isFinite(value) || value <= 0) return null;
  if (value < 18.5) return 'Underweight';
  if (value < 25) return 'Healthy range';
  if (value < 30) return 'Overweight';
  return 'Obesity range';
}

function buildBmiMessageLine(member) {
  if (!member.bmi) return null;
  const bmi = Number(member.bmi).toFixed(1);
  const category = getBmiCategory(member.bmi);
  return category ? `BMI: ${bmi} (${category})` : `BMI: ${bmi}`;
}

function buildNewMemberWelcomeMessage({ gym, member }) {
  const planName = member.membership_plan?.name || `${Number(member.plan_duration || 0)} day membership`;
  const paymentStatus = member.payment_method ? 'Paid' : 'Pending';
  const paymentMethod = formatPaymentMethodForMessage(member.payment_method);
  const bmiLine = buildBmiMessageLine(member);

  return [
    `Hi ${member.name}, welcome to ${gym.gym_name}!`,
    '',
    'Thank you for joining us. Here are your membership details:',
    `Membership: ${planName}`,
    `Duration: ${Number(member.plan_duration || 0)} days`,
    `Date of Joining: ${formatDateForMessage(member.start_date)}`,
    `Expiry Date: ${formatDateForMessage(member.expiry_date)}`,
    `Payment Amount: ${formatCurrencyForMessage(member.amount)}`,
    `Payment Method: ${paymentMethod}`,
    `Payment Status: ${paymentStatus}`,
    ...(bmiLine ? [bmiLine] : []),
    '',
    'Your fitness journey starts now. Please follow your workouts and diet plan consistently.',
  ].join('\n');
}

function buildNewMemberDietPlanCaption({ gym, member }) {
  const bmiLine = buildBmiMessageLine(member);

  return [
    `Hi ${member.name}, please see your diet plan from ${gym.gym_name}.`,
    ...(bmiLine ? [`Reference ${bmiLine}.`] : []),
    `This plan is shared for your current membership ending on ${formatDateForMessage(member.expiry_date)}.`,
    'Follow it regularly and connect with your trainer/gym team if you need changes based on your progress.',
  ].join('\n');
}

async function sendNewMemberWelcomeWhatsapp({ gym_id, member }) {
  if (!member.phone) return { skipped: true, reason: 'missing-phone' };

  const gym = await prisma.gyms.findUnique({
    where: { id: gym_id },
    select: { id: true, gym_name: true, logo_url: true },
  });

  if (!gym) return { skipped: true, reason: 'missing-gym' };

  const message = buildNewMemberWelcomeMessage({ gym, member });
  await sendWhatsappMessage({ gymId: gym_id, phone: member.phone, message, mediaUrl: gym.logo_url });
  await logGymNotification({
    gym_id,
    member_id: member.id,
    type: 'new_member_welcome_whatsapp',
    message,
    status: 'sent',
  });

  return { sent: true };
}

function buildMembershipEmailWhere(gym_id, type) {
  const today = new Date();
  if (type === 'expired') {
    return { gym_id, is_inactive: false, expiry_date: { lt: today } };
  }

  const end = new Date();
  end.setUTCDate(end.getUTCDate() + 7);
  end.setUTCHours(23, 59, 59, 999);
  return { gym_id, is_inactive: false, expiry_date: { gte: today, lte: end } };
}

function buildMembershipStatusWhere(gym_id, type, query) {
  const normalizedQuery = String(query || '').trim();
  const baseWhere = buildMembershipEmailWhere(gym_id, type);
  if (!normalizedQuery) return baseWhere;

  return {
    ...baseWhere,
    OR: [
      { name: { contains: normalizedQuery, mode: 'insensitive' } },
      { phone: { contains: normalizedQuery } },
      { email: { contains: normalizedQuery, mode: 'insensitive' } },
    ],
  };
}

const addMember = async (req, res) => {
  let requestKey = null;
  try {
    const gym_id = req.gym_id;
    const {
      name,
      phone,
      email,
      dob,
      plan_duration,
      plan_id,
      height_cm,
      weight_kg,
      start_date,
      amount,
      payment_method,
    } = req.body;
    if (!name || !plan_duration) return res.status(400).json({ error: 'Missing fields' });

    const start = start_date ? new Date(start_date) : new Date();
    const cleanName = normalizeName(name);
    const cleanPhone = normalizePhone(phone);
    const cleanEmail = normalizeEmail(email);
    const expiry = getMembershipExpiryFromStart(start, plan_duration);
    const dobDate = dob ? new Date(dob) : null;
    const safeDob = dobDate && !Number.isNaN(dobDate.getTime()) ? dobDate : null;
    const parsedPlanDuration = parseInt(plan_duration, 10);
    const parsedAmount = parseFloat(amount || 0);
    const parsedHeightCm = height_cm === undefined || height_cm === null || height_cm === '' ? null : Number(height_cm);
    const parsedWeightKg = weight_kg === undefined || weight_kg === null || weight_kg === '' ? null : Number(weight_kg);
    const parsedBmi = calculateBmi(parsedHeightCm, parsedWeightKg);
    const normalizedPaymentMethod =
      payment_method && String(payment_method).trim().toLowerCase() !== 'pending'
        ? String(payment_method).trim().toLowerCase()
        : null;
    const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    if (cleanEmail && !emailPattern.test(cleanEmail)) {
      return res.status(400).json({ error: 'Valid email is required' });
    }
    if (parsedHeightCm !== null && (!Number.isFinite(parsedHeightCm) || parsedHeightCm <= 0 || parsedHeightCm > 300)) {
      return res.status(400).json({ error: 'Valid height in cm is required' });
    }
    if (parsedWeightKg !== null && (!Number.isFinite(parsedWeightKg) || parsedWeightKg <= 0 || parsedWeightKg > 500)) {
      return res.status(400).json({ error: 'Valid weight in kg is required' });
    }

    const duplicateMember = await findDuplicateMemberByContact({ gym_id, phone: cleanPhone, email: cleanEmail });

    requestKey = [
      gym_id,
      cleanName.toLowerCase(),
      cleanPhone,
      cleanEmail || '',
      start.toISOString(),
      parsedPlanDuration,
      parsedHeightCm || '',
      parsedWeightKg || '',
      parsedAmount,
      normalizedPaymentMethod || '',
    ].join('|');

    if (pendingAddMemberRequests.has(requestKey)) {
      return res.status(409).json({ error: 'Add member request already in progress. Please wait.' });
    }
    pendingAddMemberRequests.add(requestKey);

    const existingMember = await prisma.members.findFirst({
      where: {
        gym_id,
        OR: [{ phone: cleanPhone }, ...(cleanEmail ? [{ email: { equals: cleanEmail, mode: 'insensitive' } }] : [])],
        start_date: start,
        plan_duration: parsedPlanDuration,
        amount: parsedAmount,
        payment_method: normalizedPaymentMethod,
      },
      orderBy: { created_at: 'desc' },
    });

    if (existingMember) {
      return res.status(409).json({ error: 'A matching member already exists.' });
    }

    let safePlanId = null;
    if (plan_id) {
      const plan = await prisma.membership_plans.findFirst({
        where: { id: plan_id, gym_id, is_active: true },
      });
      if (!plan) return res.status(400).json({ error: 'Invalid membership plan' });
      safePlanId = plan.id;
    }

    const member = await prisma.$transaction(async (tx) => {
      const createdMember = await tx.members.create({
        data: {
          gym_id,
          name: cleanName,
          phone: cleanPhone,
          email: cleanEmail,
          dob: safeDob,
          plan_duration: parsedPlanDuration,
          height_cm: parsedHeightCm,
          weight_kg: parsedWeightKg,
          bmi: parsedBmi,
          plan_id: safePlanId,
          start_date: start,
          expiry_date: expiry,
          amount: parsedAmount,
          payment_status: normalizedPaymentMethod ? 'paid' : 'pending',
          payment_method: normalizedPaymentMethod,
        },
        include: {
          membership_plan: true,
        },
      });

      if (normalizedPaymentMethod) {
        await tx.payments.create({
          data: {
            gym_id,
            member_id: createdMember.id,
            amount: parsedAmount,
            status: 'paid',
          },
        });
      }

      return createdMember;
    });

    invalidateDashboardCache(gym_id);
    const welcome_whatsapp = await sendNewMemberWelcomeWhatsapp({ gym_id, member }).catch((error) => ({
      sent: false,
      reason: error?.message || 'Failed to send welcome WhatsApp',
    }));
    res.status(201).json({
      member,
      welcome_whatsapp,
      warning: duplicateMember ? 'User with same email or phone no. already exists.' : null,
      duplicate_member: duplicateMember,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({
      error: 'Server error',
      details: process.env.NODE_ENV !== 'production' ? err.message : undefined,
    });
  } finally {
    if (requestKey) pendingAddMemberRequests.delete(requestKey);
  }
};

const editMember = async (req, res) => {
  try {
    const gym_id = req.gym_id;
    const { id } = req.params;
    const data = { ...req.body };
    // prevent changing gym_id
    delete data.gym_id;

    if (data.name !== undefined) {
      const cleanName = normalizeName(data.name);
      if (!cleanName) {
        return res.status(400).json({ error: 'Member name is required' });
      }

      data.name = cleanName;
    }

    if (data.phone !== undefined) {
      data.phone = normalizePhone(data.phone);
    }

    if (data.email !== undefined) {
      data.email = normalizeEmail(data.email);
      if (!data.email) {
        data.email = null;
      } else {
        const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailPattern.test(data.email)) {
          return res.status(400).json({ error: 'Valid email is required' });
        }
      }
    }

    if (data.phone !== undefined || data.email !== undefined) {
      const existingMember = await prisma.members.findFirst({
        where: { id, gym_id },
        select: { phone: true, email: true },
      });

      if (!existingMember) {
        return res.status(404).json({ error: 'Member not found' });
      }

      const duplicateMember = await findDuplicateMemberByContact({
        gym_id,
        phone: data.phone !== undefined ? data.phone : existingMember.phone,
        email: data.email !== undefined ? data.email : existingMember.email,
        excludeId: id,
      });

      if (duplicateMember) {
        return res.status(409).json({
          error: 'User already exists',
          duplicate_member: duplicateMember,
        });
      }
    }

    if (data.dob !== undefined) {
      if (!data.dob) {
        data.dob = null;
      } else {
        const dobDate = new Date(data.dob);
        if (Number.isNaN(dobDate.getTime())) {
          return res.status(400).json({ error: 'Invalid DOB' });
        }
        data.dob = dobDate;
      }
    }

    if (data.start_date !== undefined) {
      const startDate = new Date(data.start_date);
      if (Number.isNaN(startDate.getTime())) {
        return res.status(400).json({ error: 'Invalid start date' });
      }
      data.start_date = startDate;
    }

    if (data.expiry_date !== undefined) {
      const expiryDate = new Date(data.expiry_date);
      if (Number.isNaN(expiryDate.getTime())) {
        return res.status(400).json({ error: 'Invalid expiry date' });
      }
      data.expiry_date = expiryDate;
    }

    if (data.plan_duration !== undefined) {
      const parsedPlanDuration = parseInt(data.plan_duration, 10);
      if (!parsedPlanDuration || parsedPlanDuration < 1) {
        return res.status(400).json({ error: 'Valid plan_duration is required' });
      }
      data.plan_duration = parsedPlanDuration;
    }

    if (data.height_cm !== undefined) {
      data.height_cm = data.height_cm === null || data.height_cm === '' ? null : Number(data.height_cm);
      if (data.height_cm !== null && (!Number.isFinite(data.height_cm) || data.height_cm <= 0 || data.height_cm > 300)) {
        return res.status(400).json({ error: 'Valid height in cm is required' });
      }
    }

    if (data.weight_kg !== undefined) {
      data.weight_kg = data.weight_kg === null || data.weight_kg === '' ? null : Number(data.weight_kg);
      if (data.weight_kg !== null && (!Number.isFinite(data.weight_kg) || data.weight_kg <= 0 || data.weight_kg > 500)) {
        return res.status(400).json({ error: 'Valid weight in kg is required' });
      }
    }

    if (data.height_cm !== undefined || data.weight_kg !== undefined) {
      const existingMetrics = await prisma.members.findFirst({
        where: { id, gym_id },
        select: { height_cm: true, weight_kg: true },
      });
      if (!existingMetrics) return res.status(404).json({ error: 'Member not found' });
      const nextHeight = data.height_cm !== undefined ? data.height_cm : existingMetrics.height_cm;
      const nextWeight = data.weight_kg !== undefined ? data.weight_kg : existingMetrics.weight_kg;
      data.bmi = calculateBmi(nextHeight, nextWeight);
    }

    if (data.amount !== undefined) {
      const parsedAmount = parseFloat(data.amount);
      if (Number.isNaN(parsedAmount) || parsedAmount < 0) {
        return res.status(400).json({ error: 'Valid amount is required' });
      }
      data.amount = parsedAmount;
    }

    if (data.payment_method !== undefined) {
      data.payment_method =
        data.payment_method && String(data.payment_method).trim().toLowerCase() !== 'pending'
          ? String(data.payment_method).trim().toLowerCase()
          : null;

      if (data.payment_status === undefined) {
        data.payment_status = data.payment_method ? 'paid' : 'pending';
      }
    }

    if (data.plan_id !== undefined) {
      if (!data.plan_id) {
        data.plan_id = null;
      } else {
        const plan = await prisma.membership_plans.findFirst({
          where: { id: data.plan_id, gym_id, is_active: true },
        });
        if (!plan) {
          return res.status(400).json({ error: 'Invalid membership plan' });
        }
      }
    }

    const member = await prisma.members.updateMany({
      where: { id, gym_id },
      data,
    });
    if (member.count === 0) return res.status(404).json({ error: 'Member not found' });
    invalidateDashboardCache(gym_id);
    res.json({ message: 'Updated' });
  } catch (err) {
    console.error(err);
    res.status(500).json({
      error: 'Server error',
      details: process.env.NODE_ENV !== 'production' ? err.message : undefined,
    });
  }
};

const deleteMember = async (req, res) => {
  try {
    const gym_id = req.gym_id;
    const { id } = req.params;
    await prisma.members.deleteMany({ where: { id, gym_id } });
    res.json({ message: 'Deleted' });
  } catch (err) {
    console.error(err);
    res.status(500).json({
      error: 'Server error',
      details: process.env.NODE_ENV !== 'production' ? err.message : undefined,
    });
  }
};

const deactivateMember = async (req, res) => {
  try {
    const gym_id = req.gym_id;
    const { id } = req.params;
    const updated = await prisma.members.updateMany({
      where: { id, gym_id },
      data: { is_inactive: true, inactive_since: new Date(), is_paused: false, paused_at: null },
    });
    if (updated.count === 0) return res.status(404).json({ error: 'Member not found' });
    invalidateDashboardCache(gym_id);
    res.json({ message: 'Deactivated' });
  } catch (err) {
    console.error(err);
    res.status(500).json({
      error: 'Server error',
      details: process.env.NODE_ENV !== 'production' ? err.message : undefined,
    });
  }
};

const pauseMember = async (req, res) => {
  try {
    const gym_id = req.gym_id;
    const { id } = req.params;
    const updated = await prisma.members.updateMany({
      where: { id, gym_id, is_inactive: false, is_paused: false },
      data: { is_paused: true, paused_at: new Date() },
    });
    if (updated.count === 0) return res.status(404).json({ error: 'Member not found' });
    invalidateDashboardCache(gym_id);
    res.json({ message: 'Paused' });
  } catch (err) {
    console.error(err);
    res.status(500).json({
      error: 'Server error',
      details: process.env.NODE_ENV !== 'production' ? err.message : undefined,
    });
  }
};

const resumeMember = async (req, res) => {
  try {
    const gym_id = req.gym_id;
    const { id } = req.params;
    const member = await prisma.members.findFirst({ where: { id, gym_id } });
    if (!member) return res.status(404).json({ error: 'Member not found' });

    let extraDays = 0;
    if (member.is_paused && member.paused_at) {
      const ms = Date.now() - new Date(member.paused_at).getTime();
      extraDays = Math.max(0, Math.ceil(ms / (1000 * 60 * 60 * 24)));
    }

    const newExpiry = addDays(member.expiry_date, extraDays);
    await prisma.members.update({
      where: { id: member.id },
      data: {
        is_paused: false,
        paused_at: null,
        paused_total_days: (member.paused_total_days || 0) + extraDays,
        expiry_date: newExpiry,
      },
    });
    invalidateDashboardCache(gym_id);
    res.json({ message: 'Resumed', expiry: newExpiry, extra_days: extraDays });
  } catch (err) {
    console.error(err);
    res.status(500).json({
      error: 'Server error',
      details: process.env.NODE_ENV !== 'production' ? err.message : undefined,
    });
  }
};

const activateMember = async (req, res) => {
  try {
    const gym_id = req.gym_id;
    const { id } = req.params;
    const updated = await prisma.members.updateMany({
      where: { id, gym_id },
      data: { is_inactive: false, inactive_since: null },
    });
    if (updated.count === 0) return res.status(404).json({ error: 'Member not found' });
    invalidateDashboardCache(gym_id);
    res.json({ message: 'Activated' });
  } catch (err) {
    console.error(err);
    res.status(500).json({
      error: 'Server error',
      details: process.env.NODE_ENV !== 'production' ? err.message : undefined,
    });
  }
};

const restoreMember = async (req, res) => {
  try {
    const gym_id = req.gym_id;
    const { id } = req.params;
    const {
      name,
      phone,
      email,
      dob,
      plan_duration,
      plan_id,
      start_date,
      amount,
      payment_method,
    } = req.body;

    if (!name || !plan_duration) return res.status(400).json({ error: 'Missing fields' });

    const existingMember = await prisma.members.findFirst({ where: { id, gym_id } });
    if (!existingMember) return res.status(404).json({ error: 'Member not found' });

    const start = start_date ? new Date(start_date) : new Date();
    const cleanName = normalizeName(name);
    const cleanPhone = normalizePhone(phone);
    const cleanEmail = normalizeEmail(email) || null;
    const expiry = getMembershipExpiryFromStart(start, plan_duration);
    const dobDate = dob ? new Date(dob) : null;
    const safeDob = dobDate && !Number.isNaN(dobDate.getTime()) ? dobDate : null;
    const parsedPlanDuration = parseInt(plan_duration, 10);
    const parsedAmount = parseFloat(amount || 0);
    const normalizedPaymentMethod =
      payment_method && String(payment_method).trim().toLowerCase() !== 'pending'
        ? String(payment_method).trim().toLowerCase()
        : null;
    const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    if (cleanEmail && !emailPattern.test(cleanEmail)) {
      return res.status(400).json({ error: 'Valid email is required' });
    }

    const duplicateMember = await findDuplicateMemberByContact({
      gym_id,
      phone: cleanPhone,
      email: cleanEmail,
      excludeId: id,
    });

    if (duplicateMember) {
      return res.status(409).json({
        error: 'User already exists',
        duplicate_member: duplicateMember,
      });
    }

    let safePlanId = null;
    if (plan_id) {
      const plan = await prisma.membership_plans.findFirst({
        where: { id: plan_id, gym_id, is_active: true },
      });
      if (!plan) return res.status(400).json({ error: 'Invalid membership plan' });
      safePlanId = plan.id;
    }

    const member = await prisma.$transaction(async (tx) => {
      const restoredMember = await tx.members.update({
        where: { id: existingMember.id },
        data: {
          name: cleanName,
          phone: cleanPhone,
          email: cleanEmail,
          dob: safeDob,
          plan_duration: parsedPlanDuration,
          plan_id: safePlanId,
          start_date: start,
          expiry_date: expiry,
          amount: parsedAmount,
          payment_status: normalizedPaymentMethod ? 'paid' : 'pending',
          payment_method: normalizedPaymentMethod,
          is_inactive: false,
          inactive_since: null,
          is_paused: false,
          paused_at: null,
          reminder_1_sent: false,
          reminder_2_sent: false,
          reminder_3_sent: false,
          reminder_4_sent: false,
          expiry_notified: false,
        },
        include: {
          membership_plan: true,
        },
      });

      if (normalizedPaymentMethod) {
        await tx.payments.create({
          data: {
            gym_id,
            member_id: restoredMember.id,
            amount: parsedAmount,
            status: 'paid',
          },
        });
      }

      return restoredMember;
    });

    invalidateDashboardCache(gym_id);
    res.json({ message: 'Restored', member });
  } catch (err) {
    console.error(err);
    res.status(500).json({
      error: 'Server error',
      details: process.env.NODE_ENV !== 'production' ? err.message : undefined,
    });
  }
};

function inferPaymentMethod(payment, member) {
  if (payment?.razorpay_payment_id || payment?.razorpay_order_id) {
    return 'online';
  }

  if (member?.payment_method) {
    return String(member.payment_method);
  }

  return payment?.status === 'paid' ? 'manual' : 'pending';
}

const getMemberHistory = async (req, res) => {
  try {
    const gym_id = req.gym_id;
    const { id } = req.params;

    const member = await prisma.members.findFirst({
      where: { id, gym_id },
      include: {
        membership_plan: true,
        payments: {
          orderBy: { created_at: 'desc' },
        },
        trainer_sessions: {
          include: {
            trainer: true,
          },
          orderBy: [{ session_date: 'desc' }, { created_at: 'desc' }],
        },
      },
    });

    if (!member) return res.status(404).json({ error: 'Member not found' });

    const matchingTrials = await findMatchingTrialsByContact({
      gym_id,
      name: member.name,
      phone: member.phone,
    });

    const lifecycle = [];
    if (member.created_at) {
      lifecycle.push({
        type: 'joined',
        label: 'Joined',
        at: member.created_at,
      });
    }

    if (
      member.start_date &&
      (!member.created_at || new Date(member.start_date).getTime() !== new Date(member.created_at).getTime())
    ) {
      lifecycle.push({
        type: 'plan_started',
        label: 'Current plan started',
        at: member.start_date,
      });
    }

    if (member.inactive_since) {
      lifecycle.push({
        type: 'inactive',
        label: 'Marked inactive',
        at: member.inactive_since,
      });
    }

    if (member.paused_at) {
      lifecycle.push({
        type: 'paused',
        label: 'Paused',
        at: member.paused_at,
      });
    }

    if (member.expiry_date) {
      lifecycle.push({
        type: 'expiry',
        label: 'Current expiry',
        at: member.expiry_date,
      });
    }

    for (const trial of matchingTrials) {
      lifecycle.push({
        type: 'trial_taken',
        label: `Took trial${trial.trial_duration ? ` (${trial.trial_duration} days)` : ''}`,
        at: trial.trial_date || trial.created_at,
      });

      if (trial.status === 'lost') {
        lifecycle.push({
          type: 'trial_lost',
          label: trial.lost_reason
            ? `Trial marked lost: ${trial.lost_reason}`
            : 'Trial marked lost',
          at: trial.created_at || trial.trial_date,
        });
      }

      if (trial.status === 'converted') {
        lifecycle.push({
          type: 'trial_converted',
          label: 'Trial converted to member',
          at: member.created_at || trial.created_at || trial.trial_date,
        });
      }
    }

    lifecycle.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());

    const payments = (member.payments || []).map((payment) => ({
      id: payment.id,
      amount: payment.amount,
      status: payment.status,
      created_at: payment.created_at,
      method: inferPaymentMethod(payment, member),
      razorpay_payment_id: payment.razorpay_payment_id || null,
      razorpay_order_id: payment.razorpay_order_id || null,
    }));

    const trainer_history = (member.trainer_sessions || []).map((session) => ({
      id: session.id,
      session_date: session.session_date,
      created_at: session.created_at,
      duration_minutes: session.duration_minutes,
      status: session.status,
      notes: session.notes,
      trainer: session.trainer
        ? {
            id: session.trainer.id,
            name: session.trainer.name,
            email: session.trainer.email,
            phone: session.trainer.phone,
            specialization: session.trainer.specialization,
            experience_years: session.trainer.experience_years,
            salary_amount: session.trainer.salary_amount,
            salary_basis: session.trainer.salary_basis,
            status: session.trainer.status,
            created_at: session.trainer.created_at,
          }
        : null,
    }));

    res.json({
      member: {
        id: member.id,
        name: member.name,
        phone: member.phone,
        email: member.email,
        start_date: member.start_date,
        expiry_date: member.expiry_date,
        created_at: member.created_at,
        inactive_since: member.inactive_since,
        is_inactive: member.is_inactive,
        payment_method: member.payment_method,
        payment_status: member.payment_status,
        amount: member.amount,
        plan_duration: member.plan_duration,
        membership_plan: member.membership_plan,
      },
      lifecycle,
      payments,
      trainer_history,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({
      error: 'Server error',
      details: process.env.NODE_ENV !== 'production' ? err.message : undefined,
    });
  }
};

const searchMembers = async (req, res) => {
  try {
    const gym_id = req.gym_id;
    const q = String(req.query.q || '').trim();
    const status = req.query.status ? String(req.query.status) : 'all';
    const limitRaw = req.query.limit;
    const offsetRaw = req.query.offset;
    const limit = parseMemberSearchLimit(limitRaw);
    const parsedOffset = offsetRaw !== undefined ? parseInt(offsetRaw, 10) : 0;
    const offset = Number.isFinite(parsedOffset) ? Math.max(0, parsedOffset) : 0;
    const normalizedStatus = ['active', 'inactive', 'all'].includes(status) ? status : 'all';
    const searchPattern = `%${q}%`;
    const loweredSearchPattern = `%${q.toLowerCase()}%`;

    const statusSql =
      normalizedStatus === 'active'
        ? Prisma.sql`AND m.is_inactive = false`
        : normalizedStatus === 'inactive'
          ? Prisma.sql`AND m.is_inactive = true`
          : Prisma.sql``;

    const searchSql = q
      ? Prisma.sql`
          AND (
            m.name ILIKE ${searchPattern}
            OR m.phone LIKE ${searchPattern}
            OR LOWER(COALESCE(m.email, '')) LIKE ${loweredSearchPattern}
          )
        `
      : Prisma.sql``;

    const pagingSql =
      limit !== null
        ? Prisma.sql`LIMIT ${limit} OFFSET ${offset}`
        : Prisma.sql``;

    const rows = await measureAsync(
      'members.search.query',
      { gym_id, status: normalizedStatus, q: q || '(empty)', limit: limit ?? 'all', offset },
      async () =>
        prisma.$queryRaw`
          SELECT
            m.id,
            m.name,
            m.phone,
            m.email,
            m.dob,
          m.plan_duration,
          m.height_cm,
          m.weight_kg,
          m.bmi,
          m.start_date,
            m.expiry_date,
            m.amount,
            m.payment_status,
            m.payment_method,
            m.is_paused,
            m.paused_at,
            m.is_inactive,
            m.inactive_since,
            m.created_at,
            m.plan_id,
            mp.id AS membership_plan_id,
            mp.name AS membership_plan_name,
            mp.duration_days AS membership_plan_duration_days,
            ${limit !== null ? Prisma.sql`COUNT(*) OVER()::int AS total_count` : Prisma.sql`NULL::int AS total_count`}
          FROM public.members m
          LEFT JOIN public.membership_plans mp ON mp.id = m.plan_id
          WHERE m.gym_id = ${gym_id}
          ${statusSql}
          ${searchSql}
          ORDER BY m.created_at DESC, m.id DESC
          ${pagingSql}
        `,
    );

    const members = rows.map(buildMemberListItem);
    const total = limit !== null ? Number(rows[0]?.total_count || 0) : members.length;
    const payload = {
      members,
      total,
      limit: limit ?? members.length,
      offset,
      hasMore: limit !== null ? offset + members.length < total : false,
    };

    const serializationStartedAt = process.hrtime.bigint();
    const serializedPayload = JSON.stringify(payload);
    const serializationMs = Number(process.hrtime.bigint() - serializationStartedAt) / 1e6;
    console.info(
      `[perf] members.search.serialization ${serializationMs.toFixed(1)}ms bytes=${Buffer.byteLength(serializedPayload)} members=${members.length} total=${total}`,
    );

    return res
      .type('application/json')
      .send(serializedPayload);
  } catch (err) {
    console.error(err);
    res.status(500).json({
      error: 'Server error',
      details: process.env.NODE_ENV !== 'production' ? err.message : undefined,
    });
  }
};

const listPendingPayments = async (req, res) => {
  try {
    const gym_id = req.gym_id;
    const members = await prisma.members.findMany({
      where: { gym_id, is_inactive: false, payment_method: null },
      orderBy: [{ expiry_date: 'asc' }, { created_at: 'desc' }],
      include: {
        membership_plan: true,
      },
    });

    res.json({ members });
  } catch (err) {
    console.error(err);
    res.status(500).json({
      error: 'Failed to load pending payments',
      details: process.env.NODE_ENV !== 'production' ? err.message : undefined,
    });
  }
};

const listMembershipStatusMembers = async (req, res) => {
  try {
    const gym_id = req.gym_id;
    const type = String(req.query.type || '').trim().toLowerCase();
    const q = String(req.query.q || '').trim();

    if (!['expiring', 'expired'].includes(type)) {
      return res.status(400).json({ error: 'Valid membership status type is required' });
    }

    const now = new Date();
    const end = new Date();
    end.setUTCDate(end.getUTCDate() + 7);
    end.setUTCHours(23, 59, 59, 999);
    const searchPattern = `%${q}%`;
    const loweredSearchPattern = `%${q.toLowerCase()}%`;
    const statusSql =
      type === 'expired'
        ? Prisma.sql`AND m.expiry_date < ${now}`
        : Prisma.sql`AND m.expiry_date >= ${now} AND m.expiry_date <= ${end}`;
    const searchSql = q
      ? Prisma.sql`
          AND (
            m.name ILIKE ${searchPattern}
            OR m.phone LIKE ${searchPattern}
            OR LOWER(COALESCE(m.email, '')) LIKE ${loweredSearchPattern}
          )
        `
      : Prisma.sql``;

    const rows = await prisma.$queryRaw`
      SELECT
        m.id,
        m.name,
        m.phone,
        m.email,
        m.dob,
        m.plan_duration,
        m.height_cm,
        m.weight_kg,
        m.bmi,
        m.start_date,
        m.expiry_date,
        m.amount,
        m.payment_status,
        m.payment_method,
        m.is_paused,
        m.paused_at,
        m.is_inactive,
        m.inactive_since,
        m.created_at,
        m.plan_id,
        mp.id AS membership_plan_id,
        mp.name AS membership_plan_name,
        mp.duration_days AS membership_plan_duration_days
      FROM public.members m
      LEFT JOIN public.membership_plans mp ON mp.id = m.plan_id
      WHERE m.gym_id = ${gym_id}
        AND m.is_inactive = false
        ${statusSql}
        ${searchSql}
      ORDER BY m.expiry_date ASC, m.created_at DESC
    `;

    const members = rows.map(buildMemberListItem);

    res.json({ members });
  } catch (err) {
    console.error(err);
    res.status(500).json({
      error: 'Failed to load membership status members',
      details: process.env.NODE_ENV !== 'production' ? err.message : undefined,
    });
  }
};

const markPendingPaymentsPaid = async (req, res) => {
  try {
    const gym_id = req.gym_id;
    const { member_ids, payment_method } = req.body;
    const normalizedMethod = String(payment_method || '').trim().toLowerCase();

    if (!['upi', 'card', 'cash'].includes(normalizedMethod)) {
      return res.status(400).json({ error: 'Valid payment_method is required' });
    }

    const targetIds = Array.isArray(member_ids)
      ? member_ids.map((id) => String(id)).filter(Boolean)
      : null;

    const where = {
      gym_id,
      is_inactive: false,
      payment_method: null,
      ...(targetIds?.length ? { id: { in: targetIds } } : {}),
    };

    const members = await prisma.members.findMany({
      where,
      select: { id: true, amount: true },
    });

    if (!members.length) {
      return res.json({ updated: 0 });
    }

    await prisma.$transaction([
      prisma.members.updateMany({
        where: { id: { in: members.map((member) => member.id) } },
        data: {
          payment_method: normalizedMethod,
          payment_status: 'paid',
        },
      }),
      ...members.map((member) =>
        prisma.payments.create({
          data: {
            gym_id,
            member_id: member.id,
            amount: Number(member.amount || 0),
            status: 'paid',
          },
        }),
      ),
    ]);

    invalidateDashboardCache(gym_id);
    res.json({ updated: members.length });
  } catch (err) {
    console.error(err);
    res.status(500).json({
      error: 'Failed to update pending payments',
      details: process.env.NODE_ENV !== 'production' ? err.message : undefined,
    });
  }
};

const sendPendingPaymentEmails = async (req, res) => {
  try {
    const gym_id = req.gym_id;
    const { recipients, custom_message, subject } = req.body;

    if (!Array.isArray(recipients) || !recipients.length) {
      return res.status(400).json({ error: 'At least one recipient is required' });
    }

    const gym = await prisma.gyms.findUnique({
      where: { id: gym_id },
      select: { gym_name: true },
    });

    const memberIds = recipients
      .map((item) => String(item?.member_id || ''))
      .filter(Boolean);

    const members = await prisma.members.findMany({
      where: { gym_id, id: { in: memberIds } },
      select: { id: true, name: true, amount: true, email: true },
    });

    const membersById = new Map(members.map((member) => [member.id, member]));
    let sent = 0;
    let failed = 0;
    const results = [];

    for (const recipient of recipients) {
      const memberId = String(recipient?.member_id || '');
      const member = membersById.get(memberId);
      const email = String(recipient?.email || member?.email || '').trim();

      if (!memberId || !member) continue;
      if (!email) {
        failed += 1;
        results.push({
          member_id: member.id,
          member_name: member.name,
          email: '',
          status: 'failed',
          error: 'Missing member email',
        });
        await prisma.email_notifications.create({
          data: {
            gym_id,
            type: 'pending_payment_email',
            status: 'failed',
            subject: String(subject || `Pending membership payment - ${gym?.gym_name || 'Gym'}`),
            error_message: 'Missing member email',
            payload: {
              member_id: member.id,
              member_name: member.name,
              email: '',
              amount_due: member.amount,
              custom_message: String(custom_message || ''),
            },
          },
        });
        continue;
      }

      try {
        const emailSubject = String(subject || `Pending membership payment - ${gym?.gym_name || 'Gym'}`);
        const { html, text } = buildPendingPaymentEmail({
          gymName: gym?.gym_name,
          memberName: member.name,
          amountDue: member.amount,
          customMessage: custom_message,
        });

        await sendEmail({
          to: email,
          subject: emailSubject,
          html,
          text,
        });

        await prisma.email_notifications.create({
          data: {
            gym_id,
            type: 'pending_payment_email',
            status: 'sent',
            subject: emailSubject,
            payload: {
              member_id: member.id,
              member_name: member.name,
              email,
              amount_due: member.amount,
              custom_message: String(custom_message || ''),
            },
          },
        });

        sent += 1;
        results.push({ member_id: member.id, member_name: member.name, email, status: 'sent' });
      } catch (error) {
        const message = error?.message || 'Failed to send payment reminder email';
        failed += 1;
        results.push({
          member_id: member.id,
          member_name: member.name,
          email,
          status: 'failed',
          error: message,
        });
        await prisma.email_notifications.create({
          data: {
            gym_id,
            type: 'pending_payment_email',
            status: 'failed',
            subject: String(subject || `Pending membership payment - ${gym?.gym_name || 'Gym'}`),
            error_message: message,
            payload: {
              member_id: member.id,
              member_name: member.name,
              email,
              amount_due: member.amount,
              custom_message: String(custom_message || ''),
            },
          },
        });
      }
    }

    res.json({ sent, failed, results });
  } catch (err) {
    console.error(err);
    res.status(500).json({
      error: 'Failed to send payment reminder emails',
      details: process.env.NODE_ENV !== 'production' ? err.message : undefined,
    });
  }
};

const sendPendingPaymentWhatsapps = async (req, res) => {
  try {
    const gym_id = req.gym_id;
    const { recipients, custom_message } = req.body;

    if (!Array.isArray(recipients) || !recipients.length) {
      return res.status(400).json({ error: 'At least one recipient is required' });
    }

    const gym = await prisma.gyms.findUnique({
      where: { id: gym_id },
      select: { gym_name: true, logo_url: true },
    });

    const memberIds = recipients
      .map((item) => String(item?.member_id || ''))
      .filter(Boolean);

    const members = await prisma.members.findMany({
      where: { gym_id, id: { in: memberIds } },
      select: { id: true, name: true, amount: true, phone: true },
    });

    const membersById = new Map(members.map((member) => [member.id, member]));
    let sent = 0;
    let failed = 0;
    const results = [];

    for (const recipient of recipients) {
      const memberId = String(recipient?.member_id || '');
      const member = membersById.get(memberId);
      const phone = String(recipient?.phone || member?.phone || '').trim();

      if (!memberId || !member) continue;
      if (!phone) {
        const message = 'Missing member phone';
        failed += 1;
        results.push({ member_id: member.id, member_name: member.name, phone: '', status: 'failed', error: message });
        await logGymNotification({
          gym_id,
          member_id: member.id,
          type: 'pending_payment_whatsapp',
          message,
          status: 'failed',
        });
        continue;
      }

      const message = buildPendingPaymentWhatsapp({
        gymName: gym?.gym_name,
        memberName: member.name,
        amountDue: member.amount,
        customMessage: custom_message,
      });

      try {
        await sendWhatsappMessage({ gymId: gym_id, phone, message, mediaUrl: gym?.logo_url });
        await logGymNotification({
          gym_id,
          member_id: member.id,
          type: 'pending_payment_whatsapp',
          message,
          status: 'sent',
        });
        sent += 1;
        results.push({ member_id: member.id, member_name: member.name, phone, status: 'sent' });
      } catch (error) {
        const errorMessage = error?.message || 'Failed to send payment reminder WhatsApp';
        failed += 1;
        results.push({
          member_id: member.id,
          member_name: member.name,
          phone,
          status: 'failed',
          error: errorMessage,
        });
        await logGymNotification({
          gym_id,
          member_id: member.id,
          type: 'pending_payment_whatsapp',
          message: errorMessage,
          status: 'failed',
        });
      }
    }

    return res.json({ sent, failed, results });
  } catch (err) {
    console.error(err);
    return res.status(500).json({
      error: 'Failed to send payment WhatsApps',
      details: process.env.NODE_ENV !== 'production' ? err.message : undefined,
    });
  }
};

const sendMembershipStatusEmails = async (req, res) => {
  try {
    const gym_id = req.gym_id;
    const type = String(req.body?.type || '').trim().toLowerCase();
    const memberIds = Array.isArray(req.body?.member_ids)
      ? req.body.member_ids.map((id) => String(id)).filter(Boolean)
      : [];

    if (!['expiring', 'expired'].includes(type)) {
      return res.status(400).json({ error: 'Valid email type is required' });
    }

    const [gym, settings] = await Promise.all([
      prisma.gyms.findUnique({
        where: { id: gym_id },
        select: { gym_name: true },
      }),
      getOrCreateReminderSettings(gym_id),
    ]);

    const template = getMembershipEmailTemplate(settings, type);
    const where = {
      ...buildMembershipEmailWhere(gym_id, type),
      ...(memberIds.length ? { id: { in: memberIds } } : {}),
    };

    const members = await prisma.members.findMany({
      where,
      orderBy: [{ expiry_date: 'asc' }, { created_at: 'desc' }],
      select: { id: true, name: true, email: true, amount: true, expiry_date: true },
    });

    if (!members.length) {
      return res.json({ sent: 0, failed: 0, results: [] });
    }

    const results = [];
    let sent = 0;
    let failed = 0;

    for (const member of members) {
      const email = normalizeEmail(member.email);
      if (!email) {
        results.push({ member_id: member.id, member_name: member.name, status: 'failed', error: 'Missing member email' });
        failed += 1;
        continue;
      }

      try {
        const rendered = renderMembershipEmail({
          template,
          member,
          gymName: gym?.gym_name,
        });

        await sendEmail({
          to: email,
          subject: rendered.subject,
          html: rendered.html,
          text: rendered.text,
        });

        await prisma.email_notifications.create({
          data: {
            gym_id,
            type: `membership_${type}`,
            status: 'sent',
            subject: rendered.subject,
            payload: {
              member_id: member.id,
              member_name: member.name,
              email,
              expiry_date: member.expiry_date?.toISOString?.() || null,
              amount_due: member.amount,
            },
          },
        });

        results.push({ member_id: member.id, member_name: member.name, status: 'sent', email });
        sent += 1;
      } catch (error) {
        const message = error?.message || 'Failed to send email';
        await prisma.email_notifications.create({
          data: {
            gym_id,
            type: `membership_${type}`,
            status: 'failed',
            subject: template.subject,
            error_message: message,
            payload: {
              member_id: member.id,
              member_name: member.name,
              email,
              expiry_date: member.expiry_date?.toISOString?.() || null,
              amount_due: member.amount,
            },
          },
        });
        results.push({ member_id: member.id, member_name: member.name, status: 'failed', email, error: message });
        failed += 1;
      }
    }

    res.json({ sent, failed, results });
  } catch (err) {
    console.error(err);
    res.status(500).json({
      error: 'Failed to send membership emails',
      details: process.env.NODE_ENV !== 'production' ? err.message : undefined,
    });
  }
};

const sendMembershipStatusWhatsapps = async (req, res) => {
  try {
    const gym_id = req.gym_id;
    const type = String(req.body?.type || '').trim().toLowerCase();
    const customMessage = String(req.body?.custom_message || '').trim();
    const memberIds = Array.isArray(req.body?.member_ids)
      ? req.body.member_ids.map((id) => String(id)).filter(Boolean)
      : [];

    if (!['expiring', 'expired'].includes(type)) {
      return res.status(400).json({ error: 'Valid WhatsApp type is required' });
    }

    const [gym, settings] = await Promise.all([
      prisma.gyms.findUnique({
        where: { id: gym_id },
        select: { gym_name: true, logo_url: true },
      }),
      getOrCreateReminderSettings(gym_id),
    ]);

    const template =
      customMessage ||
      (type === 'expired' ? settings.whatsapp_body_expired : settings.whatsapp_body_expiring);
    const where = {
      ...buildMembershipEmailWhere(gym_id, type),
      ...(memberIds.length ? { id: { in: memberIds } } : {}),
    };

    const members = await prisma.members.findMany({
      where,
      orderBy: [{ expiry_date: 'asc' }, { created_at: 'desc' }],
      select: { id: true, name: true, phone: true, amount: true, expiry_date: true },
    });

    if (!members.length) {
      return res.json({ sent: 0, failed: 0, results: [] });
    }

    const results = [];
    let sent = 0;
    let failed = 0;
    const notificationType = `membership_${type}_whatsapp`;

    for (const member of members) {
      const phone = String(member.phone || '').trim();
      if (!phone) {
        const message = 'Missing member phone';
        results.push({ member_id: member.id, member_name: member.name, status: 'failed', error: message });
        failed += 1;
        await logGymNotification({
          gym_id,
          member_id: member.id,
          type: notificationType,
          message,
          status: 'failed',
        });
        continue;
      }

      const message = renderWhatsappTemplate(template, {
        member,
        gymName: gym?.gym_name,
      });

      try {
        await sendWhatsappMessage({ gymId: gym_id, phone, message, mediaUrl: gym?.logo_url });
        await logGymNotification({
          gym_id,
          member_id: member.id,
          type: notificationType,
          message,
          status: 'sent',
        });
        results.push({ member_id: member.id, member_name: member.name, status: 'sent', phone });
        sent += 1;
      } catch (error) {
        const errorMessage = error?.message || 'Failed to send WhatsApp';
        await logGymNotification({
          gym_id,
          member_id: member.id,
          type: notificationType,
          message: errorMessage,
          status: 'failed',
        });
        results.push({ member_id: member.id, member_name: member.name, status: 'failed', phone, error: errorMessage });
        failed += 1;
      }
    }

    return res.json({ sent, failed, results });
  } catch (err) {
    console.error(err);
    return res.status(500).json({
      error: 'Failed to send membership WhatsApps',
      details: process.env.NODE_ENV !== 'production' ? err.message : undefined,
    });
  }
};

const manualRenew = async (req, res) => {
  try {
    const gym_id = req.gym_id;
    const { id } = req.params; // member id
    const { plan_duration, amount, plan_id } = req.body;
    if (!plan_duration) return res.status(400).json({ error: 'plan_duration required' });

    const member = await prisma.members.findFirst({ where: { id, gym_id } });
    if (!member) return res.status(404).json({ error: 'Member not found' });

    let safePlanId = member.plan_id || null;
    if (plan_id) {
      const plan = await prisma.membership_plans.findFirst({
        where: { id: plan_id, gym_id, is_active: true },
      });
      if (!plan) return res.status(400).json({ error: 'Invalid membership plan' });
      safePlanId = plan.id;
    }

    const today = new Date();
    const renewalStart = today;
    let new_expiry;
    if (member.expiry_date > today) {
      new_expiry = addDays(member.expiry_date, parseInt(plan_duration, 10));
    } else {
      new_expiry = getMembershipExpiryFromStart(today, plan_duration);
    }

    const [renewedMember] = await prisma.$transaction([
      prisma.members.update({
        where: { id },
        data: {
          start_date: renewalStart,
          expiry_date: new_expiry,
          plan_duration: parseInt(plan_duration, 10),
          plan_id: safePlanId,
          amount: parseFloat(amount || 0),
          reminder_1_sent: false,
          reminder_2_sent: false,
          reminder_3_sent: false,
          reminder_4_sent: false,
          expiry_notified: false,
          is_inactive: false,
          inactive_since: null,
          payment_status: 'paid',
        },
        select: {
          id: true,
          name: true,
          email: true,
          phone: true,
          expiry_date: true,
          amount: true,
        },
      }),
      prisma.payments.create({
        data: {
          gym_id,
          member_id: id,
          amount: parseFloat(amount || 0),
          status: 'paid',
        },
      }),
    ]);

    const renewal_notifications = await sendRenewalConfirmationMessages({
      gym_id,
      member: renewedMember,
    }).catch((error) => ({
      email: { sent: false, reason: error?.message || 'Failed to send renewal confirmation email' },
      whatsapp: { sent: false, reason: error?.message || 'Failed to send renewal confirmation WhatsApp' },
    }));

    invalidateDashboardCache(gym_id);
    res.json({ message: 'Renewed', expiry: new_expiry, start_date: renewalStart, renewal_notifications });
  } catch (err) {
    console.error(err);
    res.status(500).json({
      error: 'Server error',
      details: process.env.NODE_ENV !== 'production' ? err.message : undefined,
    });
  }
};


module.exports = {
  addMember,
  editMember,
  deleteMember,
  searchMembers,
  listMembershipStatusMembers,
  listPendingPayments,
  markPendingPaymentsPaid,
  sendPendingPaymentEmails,
  sendPendingPaymentWhatsapps,
  sendMembershipStatusEmails,
  sendMembershipStatusWhatsapps,
  sendRenewalConfirmationMessages,
  manualRenew,
  deactivateMember,
  activateMember,
  restoreMember,
  getMemberHistory,
  pauseMember,
  resumeMember,
};
