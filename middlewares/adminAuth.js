const jwt = require('jsonwebtoken');

const authenticateAdmin = (req, res, next) => {
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
    if (payload?.role !== 'admin') {
      return res.status(403).json({ error: 'Admin access required' });
    }

    req.admin = payload;
    next();
  } catch (err) {
    if (err instanceof jwt.JsonWebTokenError || err instanceof jwt.TokenExpiredError || err?.name === 'NotBeforeError') {
      return res.status(401).json({ error: 'Invalid or expired admin token' });
    }

    console.error('Admin authentication failed', err);
    return res.status(500).json({
      error: 'Admin authentication failed due to a server error',
      details: process.env.NODE_ENV !== 'production' ? err.message : undefined,
    });
  }
};

module.exports = { authenticateAdmin };
