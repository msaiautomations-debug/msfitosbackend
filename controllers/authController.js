const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const prisma = require('../utils/prisma');
const crypto = require('crypto');
const { sendEmail } = require('../services/emailService');
const { sendGymSignupOwnerNotification } = require('../services/ownerNotificationService');
const {
  addBillingCycle,
  normalizeBillingCycle,
  resolveWebsitePricingSelection,
} = require('../services/websitePricingService');

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function generateOtp() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

function buildOtpExpiry() {
  const otpExpiresAt = new Date();
  otpExpiresAt.setMinutes(otpExpiresAt.getMinutes() + 10);
  return otpExpiresAt;
}

async function sendSignupOtpEmail(email, otpCode) {
  await sendEmail({
    to: email,
    subject: 'Your OTP for Gym Management SaaS Signup',
    text: `Welcome to Gym Management Software. Your OTP for email verification is ${otpCode}. This OTP will expire in 10 minutes.`,
    html: `<p>Welcome to Gym Management Software.</p><p>Your OTP for email verification is: <strong>${otpCode}</strong></p><p>This OTP will expire in 10 minutes.</p>`,
  });
}

async function sendPasswordResetOtpEmail(email, otpCode) {
  await sendEmail({
    to: email,
    subject: 'Reset your MS FitOS gym owner password',
    text: `Your password reset OTP is ${otpCode}. This OTP will expire in 10 minutes. If you did not request this, you can ignore this email.`,
    html: `<p>Your MS FitOS password reset OTP is: <strong>${otpCode}</strong></p><p>This OTP will expire in 10 minutes.</p><p>If you did not request this, you can ignore this email.</p>`,
  });
}

const register = async (req, res) => {
  try {
    const { gym_name, owner_name, password, phone } = req.body;
    const email = normalizeEmail(req.body?.email);
    // basic input validation
    if (!gym_name || !owner_name || !email || !password) {
      return res.status(400).json({ error: 'Required fields missing' });
    }

    // check uniqueness with gyms
    const existing = await prisma.gyms.findFirst({
      where: {
        email: {
          equals: email,
          mode: 'insensitive',
        },
      },
    });
    if (existing) {
      return res.status(409).json({ error: 'This email already exists. Enter a new email' });
    }

    // check if email is already used by an owner
    const existingOwner = await prisma.owners.findUnique({
      where: { email },
    });
    if (existingOwner) {
      return res.status(409).json({ error: 'This email already exists. Enter a new email' });
    }

    const password_hash = await bcrypt.hash(password, 10);
    const gym = await prisma.gyms.create({
      data: {
        gym_name,
        owner_name,
        email,
        password_hash,
        phone,
      },
    });

    // create default inactive subscription record
    await prisma.gym_subscriptions.create({
      data: {
        gym_id: gym.id,
        plan_name: 'monthly',
        status: 'inactive',
        start_date: new Date(),
        end_date: new Date(),
      },
    });

    res.status(201).json({ message: 'Gym registered' });
  } catch (err) {
    console.error(err);
    res.status(500).json({
      error: 'Server error',
      details: process.env.NODE_ENV !== 'production' ? err.message : undefined,
    });
  }
};

const login = async (req, res) => {
  try {
    const { password } = req.body;
    const email = normalizeEmail(req.body?.email);
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password required' });
    }
    const gym = await prisma.gyms.findFirst({
      where: {
        email: {
          equals: email,
          mode: 'insensitive',
        },
      },
    });
    if (!gym) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    const match = await bcrypt.compare(password, gym.password_hash);
    if (!match) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    const token = jwt.sign(
      { gym_id: gym.id, gym_code: gym.gym_id, email: gym.email },
      process.env.JWT_SECRET,
      { expiresIn: '30d' }
    );
    res.json({ token });
  } catch (err) {
    console.error(err);
    res.status(500).json({
      error: 'Server error',
      details: process.env.NODE_ENV !== 'production' ? err.message : undefined,
    });
  }
};

const registerGym = async (req, res) => {
  try {
    const { gym_name, gym_id, password, owner_name, phone, plan, plan_id, billing_cycle } = req.body;
    const email = normalizeEmail(req.body?.email);
    if (!gym_name || !gym_id || !password || !owner_name || !email || !phone) {
      return res.status(400).json({ error: 'All fields are required' });
    }

    const requestedPlanName = plan ? String(plan).trim() : 'trial';
    const cycle = normalizeBillingCycle(billing_cycle);
    const pricingSelection = cycle
      ? await resolveWebsitePricingSelection({
          planId: plan_id,
          planName: requestedPlanName,
          billingCycle: cycle,
        })
      : null;

    if (billing_cycle && !cycle) {
      return res.status(400).json({ error: 'Billing cycle must be monthly or yearly' });
    }

    if (billing_cycle && !pricingSelection) {
      return res.status(400).json({ error: 'Selected pricing plan is not available for this billing cycle' });
    }

    const planName = pricingSelection?.planName || requestedPlanName;
    const isPaidPlan = Boolean(pricingSelection);
    const storedPlanName = isPaidPlan ? planName : 'trial';
    const ownerNotificationPlanName = isPaidPlan ? planName : requestedPlanName;
    const paymentAmount = pricingSelection?.amount || 0;

    const now = new Date();
    const expiryDate = isPaidPlan ? addBillingCycle(now, cycle) : new Date(now);
    if (!isPaidPlan) {
      expiryDate.setDate(expiryDate.getDate() + 30);
    }

    // check if gym_id or email already used
    const existing = await prisma.gyms.findFirst({
      where: {
        OR: [
          {
            email: {
              equals: email,
              mode: 'insensitive',
            },
          },
          { gym_id },
        ],
      },
    });
    if (existing) {
      if (existing.email_verified) {
        return res.status(409).json({ error: 'Gym ID or email already registered' });
      }

      const password_hash = await bcrypt.hash(password, 10);
      const otp_code = generateOtp();
      const otp_expires_at = buildOtpExpiry();

      await prisma.gyms.update({
        where: { id: existing.id },
        data: {
          gym_id,
          gym_name,
          owner_name,
          email,
          owner_email: email,
          password_hash,
          phone,
          plan: storedPlanName,
          otp_code,
          otp_expires_at,
          trial_start_date: now,
          trial_end_date: expiryDate,
          subscription_status: isPaidPlan ? 'active' : 'inactive',
        },
      });

      await prisma.$transaction(async (tx) => {
        await tx.gym_subscriptions.deleteMany({ where: { gym_id: existing.id } });
        await tx.payments.deleteMany({
          where: {
            gym_id: existing.id,
            member_id: null,
          },
        });

        if (isPaidPlan) {
          await tx.payments.create({
            data: {
              gym_id: existing.id,
              amount: paymentAmount,
              status: 'paid',
            },
          });

          await tx.gym_subscriptions.create({
            data: {
              gym_id: existing.id,
              plan_name: `${planName} (${cycle})`,
              status: 'active',
              start_date: now,
              end_date: expiryDate,
            },
          });
        }
      });

      await sendSignupOtpEmail(email, otp_code);
      await sendGymSignupOwnerNotification({
        submissionType: 'updated pending signup',
        gym_name,
        gym_id,
        owner_name,
        email,
        phone,
        plan: ownerNotificationPlanName,
        email_verified: false,
        subscription_status: isPaidPlan ? 'active' : 'inactive',
        trial_end_date: expiryDate,
      });
      return res.status(200).json({
        message: 'OTP re-sent to your email. Please verify to complete signup.',
        gym_id,
      });
    }

    const password_hash = await bcrypt.hash(password, 10);
    const otp_code = generateOtp();
    const otp_expires_at = buildOtpExpiry();

    const gym = await prisma.gyms.create({
      data: {
        gym_id,
        gym_name,
        owner_name,
        email,
        owner_email: email,
        password_hash,
        phone,
        plan: storedPlanName,
        email_verified: false,
        otp_code,
        otp_expires_at,
        trial_start_date: now,
        trial_end_date: expiryDate,
        subscription_status: isPaidPlan ? 'active' : 'inactive',
      },
    });

    if (isPaidPlan) {
      await prisma.payments.create({
        data: {
          gym_id: gym.id,
          amount: paymentAmount,
          status: 'paid',
        },
      });

      await prisma.gym_subscriptions.create({
        data: {
          gym_id: gym.id,
          plan_name: `${planName} (${cycle})`,
          status: 'active',
          start_date: now,
          end_date: expiryDate,
        },
      });
    }

    try {
      await sendSignupOtpEmail(email, otp_code);
    } catch (emailError) {
      await prisma.$transaction(async (tx) => {
        await tx.gym_subscriptions.deleteMany({ where: { gym_id: gym.id } });
        await tx.payments.deleteMany({ where: { gym_id: gym.id, member_id: null } });
        await tx.gyms.delete({ where: { id: gym.id } });
      }).catch((cleanupError) => {
        console.error('Failed to rollback gym after OTP email failure', cleanupError);
      });
      throw emailError;
    }

    await sendGymSignupOwnerNotification({
      submissionType: 'new signup',
      gym_name,
      gym_id,
      owner_name,
      email,
      phone,
      plan: ownerNotificationPlanName,
      email_verified: gym.email_verified,
      subscription_status: gym.subscription_status,
      trial_end_date: gym.trial_end_date,
    });

    res.status(201).json({ message: 'OTP sent to your email. Please verify to complete signup.', gym_id });
  } catch (err) {
    console.error(err);
    res.status(500).json({
      error: 'Server error',
      details: process.env.NODE_ENV !== 'production' ? err.message : undefined,
    });
  }
};

const gymLogin = async (req, res) => {
  try {
    const { password } = req.body;
    const email = normalizeEmail(req.body?.email);
    if (!email || !password) {
      return res.status(400).json({ error: 'email and password required' });
    }
    const gym = await prisma.gyms.findFirst({
      where: {
        email: {
          equals: email,
          mode: 'insensitive',
        },
      },
    });
    if (!gym) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }
    if (!gym.email_verified) {
      // send OTP
      const otp = Math.floor(100000 + Math.random() * 900000).toString();
      await prisma.gyms.update({
        where: { id: gym.id },
        data: {
          otp_code: otp,
          otp_expires_at: new Date(Date.now() + 10 * 60 * 1000),
        },
      });
      await sendEmail({
        to: email,
        subject: 'Verify your email',
        text: `Your OTP is ${otp}`,
      });
      return res.status(403).json({ error: 'Please verify your email. OTP sent to your email.' });
    }
    const match = await bcrypt.compare(password, gym.password_hash);
    if (!match) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }
    const token = jwt.sign(
      { gym_id: gym.id, gym_code: gym.gym_id, email: gym.email },
      process.env.JWT_SECRET,
      { expiresIn: '30d' }
    );
    res.json({ token, gym_id: gym.gym_id });
  } catch (err) {
    console.error(err);
    res.status(500).json({
      error: 'Server error',
      details: process.env.NODE_ENV !== 'production' ? err.message : undefined,
    });
  }
};

const verifyOtp = async (req, res) => {
  try {
    const { otp } = req.body;
    const email = normalizeEmail(req.body?.email);
    if (!email || !otp) {
      return res.status(400).json({ error: 'Email and OTP required' });
    }

    const gym = await prisma.gyms.findFirst({
      where: {
        email: {
          equals: email,
          mode: 'insensitive',
        },
      },
    });
    if (!gym) {
      return res.status(404).json({ error: 'Gym not found' });
    }

    if (gym.email_verified) {
      return res.status(400).json({ error: 'Email already verified' });
    }

    if (!gym.otp_code || !gym.otp_expires_at) {
      return res.status(400).json({ error: 'No OTP found. Please request signup again.' });
    }

    if (new Date() > gym.otp_expires_at) {
      return res.status(400).json({ error: 'OTP has expired. Please request a new one.' });
    }

    if (gym.otp_code !== otp) {
      return res.status(400).json({ error: 'Invalid OTP' });
    }

    // Verify email and clear OTP
    await prisma.gyms.update({
      where: { id: gym.id },
      data: {
        email_verified: true,
        otp_code: null,
        otp_expires_at: null,
      },
    });

    // Generate JWT token for auto-login
    const token = jwt.sign(
      { gym_id: gym.id, gym_code: gym.gym_id, email: gym.email },
      process.env.JWT_SECRET,
      { expiresIn: '30d' }
    );

    res.json({ token, message: 'Email verified successfully. Welcome!' });
  } catch (err) {
    console.error(err);
    res.status(500).json({
      error: 'Server error',
      details: process.env.NODE_ENV !== 'production' ? err.message : undefined,
    });
  }
};

const requestGymPasswordReset = async (req, res) => {
  try {
    const email = normalizeEmail(req.body?.email);
    if (!email) {
      return res.status(400).json({ error: 'Email is required' });
    }

    const gym = await prisma.gyms.findFirst({
      where: {
        email: {
          equals: email,
          mode: 'insensitive',
        },
      },
      select: { id: true, email: true },
    });

    if (!gym) {
      return res.status(404).json({ error: 'No gym account found for this email' });
    }

    const otp = generateOtp();
    await prisma.gyms.update({
      where: { id: gym.id },
      data: {
        otp_code: otp,
        otp_expires_at: buildOtpExpiry(),
      },
    });

    await sendPasswordResetOtpEmail(gym.email, otp);
    res.json({ message: 'Password reset OTP sent to your registered email' });
  } catch (err) {
    console.error(err);
    res.status(500).json({
      error: 'Server error',
      details: process.env.NODE_ENV !== 'production' ? err.message : undefined,
    });
  }
};

const verifyGymPasswordResetOtp = async (req, res) => {
  try {
    const email = normalizeEmail(req.body?.email);
    const otp = String(req.body?.otp || '').trim();
    if (!email || !otp) {
      return res.status(400).json({ error: 'Email and OTP are required' });
    }

    const gym = await prisma.gyms.findFirst({
      where: {
        email: {
          equals: email,
          mode: 'insensitive',
        },
      },
      select: { id: true, otp_code: true, otp_expires_at: true },
    });

    if (!gym) {
      return res.status(404).json({ error: 'Gym not found' });
    }

    if (!gym.otp_code || !gym.otp_expires_at) {
      return res.status(400).json({ error: 'No reset OTP found. Please request a new OTP.' });
    }

    if (new Date() > gym.otp_expires_at) {
      return res.status(400).json({ error: 'OTP has expired. Please request a new OTP.' });
    }

    if (gym.otp_code !== otp) {
      return res.status(400).json({ error: 'Invalid OTP' });
    }

    res.json({ message: 'OTP verified' });
  } catch (err) {
    console.error(err);
    res.status(500).json({
      error: 'Server error',
      details: process.env.NODE_ENV !== 'production' ? err.message : undefined,
    });
  }
};

const resetGymPassword = async (req, res) => {
  try {
    const email = normalizeEmail(req.body?.email);
    const otp = String(req.body?.otp || '').trim();
    const newPassword = String(req.body?.new_password ?? req.body?.newPassword ?? req.body?.password ?? '').trim();

    if (!email || !otp || !newPassword) {
      return res.status(400).json({ error: 'Email, OTP, and new password are required' });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({ error: 'New password must be at least 6 characters' });
    }

    const gym = await prisma.gyms.findFirst({
      where: {
        email: {
          equals: email,
          mode: 'insensitive',
        },
      },
      select: { id: true, password_hash: true, otp_code: true, otp_expires_at: true },
    });

    if (!gym) {
      return res.status(404).json({ error: 'Gym not found' });
    }

    if (!gym.otp_code || !gym.otp_expires_at) {
      return res.status(400).json({ error: 'No reset OTP found. Please request a new OTP.' });
    }

    if (new Date() > gym.otp_expires_at) {
      return res.status(400).json({ error: 'OTP has expired. Please request a new OTP.' });
    }

    if (gym.otp_code !== otp) {
      return res.status(400).json({ error: 'Invalid OTP' });
    }

    const sameAsOldPassword = await bcrypt.compare(newPassword, gym.password_hash);
    if (sameAsOldPassword) {
      return res.status(400).json({ error: 'New password must be different from your old password' });
    }

    const password_hash = await bcrypt.hash(newPassword, 10);
    await prisma.gyms.update({
      where: { id: gym.id },
      data: {
        password_hash,
        otp_code: null,
        otp_expires_at: null,
      },
    });

    res.json({ message: 'Password reset successfully. You can now log in with your new password.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({
      error: 'Server error',
      details: process.env.NODE_ENV !== 'production' ? err.message : undefined,
    });
  }
};

module.exports = {
  register,
  login,
  registerGym,
  gymLogin,
  verifyOtp,
  requestGymPasswordReset,
  verifyGymPasswordResetOtp,
  resetGymPassword,
};
