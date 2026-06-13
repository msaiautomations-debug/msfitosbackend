const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const prisma = require('../utils/prisma');

const SALT_ROUNDS = 10;
const JWT_EXPIRY = '30d';

const ownerLogin = async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    const owner = await prisma.owners.findUnique({
      where: { email: email.trim().toLowerCase() },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        password_hash: true,
        whatsapp_number: true,
        whatsapp_verified: true,
        expiring_soon_days: true,
      },
    });

    if (!owner) {
      return res.status(401).json({ error: 'Owner account not found. Contact your admin.' });
    }

    if (!owner.password_hash) {
      return res.status(401).json({ error: 'Account not set up. Contact your admin.' });
    }

    const isValid = await bcrypt.compare(password, owner.password_hash);
    if (!isValid) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const token = jwt.sign(
      { owner_id: owner.id, email: owner.email, role: 'owner' },
      process.env.JWT_SECRET,
      { expiresIn: JWT_EXPIRY },
    );

    res.json({
      token,
      owner: {
        id: owner.id,
        name: owner.name,
        email: owner.email,
        phone: owner.phone,
        whatsapp_verified: owner.whatsapp_verified,
        expiring_soon_days: owner.expiring_soon_days,
      },
    });
  } catch (err) {
    console.error('Owner login error', err);
    res.status(500).json({
      error: 'Login failed',
      details: process.env.NODE_ENV !== 'production' ? err.message : undefined,
    });
  }
};

module.exports = { ownerLogin, SALT_ROUNDS };
