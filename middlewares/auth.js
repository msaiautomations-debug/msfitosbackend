const jwt = require('jsonwebtoken');
const prisma = require('../utils/prisma');

const authenticate = async (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    return res.status(401).json({ error: 'Missing Authorization header' });
  }
  const token = authHeader.split(' ')[1];
  if (!token) {
    return res.status(401).json({ error: 'Malformed Authorization header' });
  }

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);

    // Backward compatible:
    // - Old tokens used `gym_id = gyms.gym_id` (public code)
    // - New tokens use `gym_id = gyms.id` (db uuid) and include `gym_code`
    const gymLookup = payload.gym_id;
    const gym = await prisma.gyms.findFirst({
      where: { OR: [{ id: gymLookup }, { gym_id: gymLookup }] },
      select: {
        id: true,
        gym_id: true,
        gym_name: true,
        email: true,
        plan: true,
        trial_end_date: true,
        subscription_status: true,
      },
    });
    if (!gym) return res.status(401).json({ error: 'Gym not found for token' });

    req.gym_id = gym.id; // always use db uuid downstream
    req.gym_code = gym.gym_id;
    req.gym_email = payload.email;
    req.gym = gym;
    next();
  } catch (err) {
    if (err instanceof jwt.JsonWebTokenError || err instanceof jwt.TokenExpiredError || err?.name === 'NotBeforeError') {
      return res.status(401).json({ error: 'Invalid or expired token' });
    }

    console.error('Authentication middleware error', err);
    return res.status(500).json({
      error: 'Authentication failed due to a server error',
      details: process.env.NODE_ENV !== 'production' ? err.message : undefined,
    });
  }
};

module.exports = { authenticate };
