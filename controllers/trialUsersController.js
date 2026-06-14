const prisma = require('../utils/prisma');
const { sendWhatsappMessage } = require('../services/whatsappService');
const { logGymNotification } = require('../services/notificationService');

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
const allowedLeadType = new Set(['trial', 'visitor']);
const allowedFollowUpTypes = new Set(['trials', 'visitors', 'lost']);
let leadTypeColumnAvailable = null;

async function hasLeadTypeColumn() {
  if (leadTypeColumnAvailable !== null) return leadTypeColumnAvailable;

  try {
    const rows = await prisma.$queryRaw`
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'trial_users'
        AND column_name = 'lead_type'
      LIMIT 1
    `;
    leadTypeColumnAvailable = Array.isArray(rows) && rows.length > 0;
  } catch (err) {
    console.error('Failed to inspect trial_users.lead_type column', err);
    leadTypeColumnAvailable = false;
  }

  return leadTypeColumnAvailable;
}

function markVisitorNotes(notes) {
  const trimmedNotes = String(notes || '').trim();
  return trimmedNotes ? `__MSFITOS_VISITOR__\n${trimmedNotes}` : '__MSFITOS_VISITOR__';
}

function mapLegacyLeadType(trial) {
  if (!trial || trial.lead_type) return trial;
  return {
    ...trial,
    lead_type: String(trial.notes || '').startsWith('__MSFITOS_VISITOR__') ? 'visitor' : 'trial',
  };
}

function getTrialUserSelect(includeLeadType) {
  return {
    id: true,
    gym_id: true,
    ...(includeLeadType ? { lead_type: true } : {}),
    name: true,
    phone: true,
    trial_date: true,
    trial_duration: true,
    trainer_name: true,
    notes: true,
    lost_reason: true,
    status: true,
    reminder_day1_sent: true,
    reminder_day2_sent: true,
    reminder_day5_sent: true,
    created_at: true,
  };
}

function formatDateForMessage(date) {
  if (!date) return '';
  const parsed = new Date(date);
  if (Number.isNaN(parsed.getTime())) return '';
  return parsed.toISOString().slice(0, 10);
}

function getTrialExpiryDate(trial) {
  const duration = Math.max(0, parseInt(trial?.trial_duration, 10) || 0);
  if (!trial?.trial_date || duration <= 0) return null;
  const start = new Date(trial.trial_date);
  if (Number.isNaN(start.getTime())) return null;
  return addDays(start, duration);
}

function renderLeadWhatsappTemplate(template, { trial, gymName, followUpType }) {
  const mapped = mapLegacyLeadType(trial);
  const values = {
    lead_name: mapped?.name || 'there',
    trial_name: mapped?.name || 'there',
    visitor_name: mapped?.name || 'there',
    gym_name: gymName || 'your gym',
    phone: mapped?.phone || '',
    trial_date: formatDateForMessage(mapped?.trial_date),
    trial_expiry_date: formatDateForMessage(getTrialExpiryDate(mapped)),
    trial_duration: String(mapped?.trial_duration || 0),
    lost_reason: mapped?.lost_reason || '',
    lead_type: mapped?.lead_type || followUpType || 'trial',
  };

  return String(template || '')
    .replace(
      /\{\{\s*(lead_name|trial_name|visitor_name|gym_name|phone|trial_date|trial_expiry_date|trial_duration|lost_reason|lead_type)\s*\}\}/g,
      (_, key) => values[key] || '',
    )
    .replace(
      /\{(lead_name|trial_name|visitor_name|gym_name|phone|trial_date|trial_expiry_date|trial_duration|lost_reason|lead_type)\}/g,
      (_, key) => values[key] || '',
    )
    .trim();
}

function getDefaultFollowUpTemplate(type) {
  if (type === 'visitors') {
    return 'Hi {lead_name}, thanks for visiting {gym_name}. We would love to help you start your fitness journey. Reply here or call us to book your next session.';
  }

  if (type === 'lost') {
    return 'Hi {lead_name}, this is {gym_name}. We missed having you continue with us. If you are still interested, reply here and we will help you restart with the right plan.';
  }

  return 'Hi {lead_name}, this is {gym_name}. Your trial started on {trial_date}. We would love to help you continue your fitness journey. Reply here or call us to convert your trial into a membership.';
}

function buildFollowUpWhere(gymId, type, ids, includeLeadType) {
  const where = { gym_id: gymId };

  if (ids.length) {
    return { ...where, id: { in: ids } };
  }

  if (type === 'lost') {
    where.status = 'lost';
    return where;
  }

  where.status = 'trial';

  if (type === 'visitors') {
    if (includeLeadType) {
      where.OR = [{ lead_type: 'visitor' }, { notes: { startsWith: '__MSFITOS_VISITOR__' } }];
    } else {
      where.notes = { startsWith: '__MSFITOS_VISITOR__' };
    }
    return where;
  }

  if (includeLeadType) {
    where.AND = [
      { OR: [{ lead_type: 'trial' }, { lead_type: null }] },
      { OR: [{ notes: null }, { NOT: { notes: { startsWith: '__MSFITOS_VISITOR__' } } }] },
    ];
  } else {
    where.OR = [{ notes: null }, { NOT: { notes: { startsWith: '__MSFITOS_VISITOR__' } } }];
  }

  return where;
}

const listTrialUsers = async (req, res) => {
  try {
    const gym_id = req.gym_id;
    const status = req.query.status ? String(req.query.status) : null;
    const where = { gym_id };
    if (status && allowedStatus.has(status)) where.status = status;
    const includeLeadType = await hasLeadTypeColumn();

    const trials = await prisma.trial_users.findMany({
      where,
      select: getTrialUserSelect(includeLeadType),
      orderBy: { created_at: 'desc' },
    });

    res.json({ trials: trials.map(mapLegacyLeadType) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load trial users', details: process.env.NODE_ENV !== 'production' ? err.message : undefined });
  }
};

const createTrialUser = async (req, res) => {
  try {
    const gym_id = req.gym_id;
    const { name, phone, trial_date, trial_duration, trainer_name, notes, lead_type } = req.body;
    if (!name || !phone) return res.status(400).json({ error: 'Missing fields' });
    const safeLeadType = allowedLeadType.has(String(lead_type || 'trial')) ? String(lead_type || 'trial') : 'trial';
    const includeLeadType = await hasLeadTypeColumn();

    const trial = await prisma.trial_users.create({
      data: {
        gym_id,
        ...(includeLeadType ? { lead_type: safeLeadType } : {}),
        name,
        phone,
        trial_date: trial_date ? new Date(trial_date) : new Date(),
        trial_duration: safeLeadType === 'visitor' ? 0 : trial_duration ? parseInt(trial_duration, 10) : 7,
        trainer_name: trainer_name || null,
        notes: safeLeadType === 'visitor' && !includeLeadType ? markVisitorNotes(notes) : notes || null,
      },
      select: getTrialUserSelect(includeLeadType),
    });

    res.status(201).json({ trial: mapLegacyLeadType(trial) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to create trial user', details: process.env.NODE_ENV !== 'production' ? err.message : undefined });
  }
};

const updateTrialUser = async (req, res) => {
  try {
    const gym_id = req.gym_id;
    const { id } = req.params;
    const { name, phone, trial_date, trial_duration, trainer_name, notes, status, lost_reason, lead_type } = req.body;

    if (status && !allowedStatus.has(status)) return res.status(400).json({ error: 'Invalid status' });
    if (lead_type && !allowedLeadType.has(String(lead_type))) return res.status(400).json({ error: 'Invalid lead type' });
    const includeLeadType = await hasLeadTypeColumn();

    const data = {
      ...(lead_type && includeLeadType ? { lead_type: String(lead_type) } : {}),
      ...(name ? { name } : {}),
      ...(phone ? { phone } : {}),
      ...(trial_date ? { trial_date: new Date(trial_date) } : {}),
      ...(trial_duration !== undefined ? { trial_duration: parseInt(trial_duration, 10) } : {}),
      ...(trainer_name ? { trainer_name } : {}),
      ...(typeof notes === 'string'
        ? { notes: lead_type === 'visitor' && !includeLeadType ? markVisitorNotes(notes) : notes }
        : {}),
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
    const includeLeadType = await hasLeadTypeColumn();

    const trial = await prisma.trial_users.findFirst({
      where: { id, gym_id },
      select: getTrialUserSelect(includeLeadType),
    });
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
      prisma.trial_users.updateMany({
        where: { id: trial.id, gym_id },
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

const sendTrialFollowUpWhatsapps = async (req, res) => {
  try {
    const gym_id = req.gym_id;
    const type = String(req.body?.type || 'trials').trim().toLowerCase();
    const trialIds = Array.isArray(req.body?.trial_ids)
      ? req.body.trial_ids.map((id) => String(id)).filter(Boolean)
      : [];
    const customMessage = String(req.body?.custom_message || '').trim();

    if (!allowedFollowUpTypes.has(type)) {
      return res.status(400).json({ error: 'Valid follow-up type is required' });
    }

    const includeLeadType = await hasLeadTypeColumn();
    const gym = await prisma.gyms.findUnique({
      where: { id: gym_id },
      select: { gym_name: true, logo_url: true },
    });

    const trials = await prisma.trial_users.findMany({
      where: buildFollowUpWhere(gym_id, type, trialIds, includeLeadType),
      select: getTrialUserSelect(includeLeadType),
      orderBy: [{ trial_date: 'desc' }, { created_at: 'desc' }],
    });

    if (!trials.length) {
      return res.json({ sent: 0, failed: 0, results: [] });
    }

    const template = customMessage || getDefaultFollowUpTemplate(type);
    const results = [];
    let sent = 0;
    let failed = 0;

    for (const rawTrial of trials) {
      const trial = mapLegacyLeadType(rawTrial);
      const phone = normalizePhone(trial.phone);

      if (!phone) {
        failed += 1;
        results.push({
          trial_id: trial.id,
          trial_name: trial.name,
          phone,
          status: 'failed',
          error: 'Missing phone number',
        });
        continue;
      }

      try {
        const message = renderLeadWhatsappTemplate(template, {
          trial,
          gymName: gym?.gym_name,
          followUpType: type,
        });

        await sendWhatsappMessage({ gymId: gym_id, phone, message, mediaUrl: gym?.logo_url });
        await logGymNotification({
          gym_id,
          type: `trial_${type}_follow_up_whatsapp`,
          message,
          status: 'sent',
        });

        sent += 1;
        results.push({ trial_id: trial.id, trial_name: trial.name, phone, status: 'sent' });
      } catch (error) {
        const message = error?.message || 'Failed to send follow-up WhatsApp';
        await logGymNotification({
          gym_id,
          type: `trial_${type}_follow_up_whatsapp`,
          message,
          status: 'failed',
        });
        failed += 1;
        results.push({
          trial_id: trial.id,
          trial_name: trial.name,
          phone,
          status: 'failed',
          error: message,
        });
      }
    }

    res.json({ sent, failed, results });
  } catch (err) {
    console.error(err);
    res.status(500).json({
      error: 'Failed to send trial follow-up WhatsApps',
      details: process.env.NODE_ENV !== 'production' ? err.message : undefined,
    });
  }
};

module.exports = {
  listTrialUsers,
  createTrialUser,
  updateTrialUser,
  convertTrialUser,
  sendTrialFollowUpWhatsapps,
};
