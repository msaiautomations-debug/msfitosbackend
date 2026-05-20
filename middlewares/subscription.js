const prisma = require('../utils/prisma');

async function subscriptionRequired(req, res, next) {
  try {
    const gym_id = req.gym_id;
    if (!gym_id) return res.status(401).json({ error: 'Gym context missing' });

    const gym = req.gym || (await prisma.gyms.findUnique({ where: { id: gym_id } }));
    if (!gym) return res.status(404).json({ error: 'Gym not found' });

    const now = new Date();

    // Check if subscription is active
    if (gym.subscription_status === 'active') {
      req.gym = gym;
      return next();
    }

    // Check if trial is active
    if (gym.plan === 'trial' && now <= gym.trial_end_date) {
      req.gym = gym;
      return next();
    }

    // Trial expired
    return res.status(403).json({ error: 'Trial expired', redirect: '/payment' });
  } catch (err) {
    console.error("subscription middleware error", err);
    const msg = err?.message || String(err);
    res.status(500).json({ error: 'Server error', details: process.env.NODE_ENV !== 'production' ? msg : undefined });
  }
}

module.exports = { subscriptionRequired };
