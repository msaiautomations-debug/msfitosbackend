const jwt = require('jsonwebtoken');
const prisma = require('../utils/prisma');

const authenticateOwner = async (req, res, next) => {
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

    if (payload.role !== 'owner') {
      return res.status(403).json({ error: 'Owner access required' });
    }

    const owner = await prisma.owners.findUnique({
      where: { id: payload.owner_id },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        whatsapp_number: true,
        whatsapp_verified: true,
        expiring_soon_days: true,
      },
    });

    if (!owner) {
      return res.status(401).json({ error: 'Owner not found for token' });
    }

    req.owner_id = owner.id;
    req.owner = owner;
    next();
  } catch (err) {
    if (
      err instanceof jwt.JsonWebTokenError ||
      err instanceof jwt.TokenExpiredError ||
      err?.name === 'NotBeforeError'
    ) {
      return res.status(401).json({ error: 'Invalid or expired token' });
    }

    console.error('Owner authentication middleware error', err);
    return res.status(500).json({
      error: 'Authentication failed due to a server error',
      details: process.env.NODE_ENV !== 'production' ? err.message : undefined,
    });
  }
};

module.exports = { authenticateOwner };
