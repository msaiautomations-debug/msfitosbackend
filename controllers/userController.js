const prisma = require('../utils/prisma');

const getUserGyms = async (req, res) => {
  try {
    const email = req.gym_email; // From JWT token
    if (!email) {
      return res.status(401).json({ error: 'No email found in token' });
    }

    // Find all gyms linked to this owner
    // Use owner_email if available, fallback to email for backward compatibility
    const gyms = await prisma.gyms.findMany({
      where: {
        OR: [
          { owner_email: email },
          { email: email }, // For backward compatibility
        ],
      },
      select: {
        id: true,
        gym_id: true,
        gym_name: true,
        email: true,
        subscription_status: true,
        trial_end_date: true,
      },
      orderBy: { created_at: 'asc' },
    });

    if (!gyms.length) {
      return res.status(404).json({ error: 'No gyms found for this user' });
    }

    res.json({ gyms });
  } catch (err) {
    console.error(err);
    res.status(500).json({
      error: 'Failed to fetch user gyms',
      details: process.env.NODE_ENV !== 'production' ? err.message : undefined,
    });
  }
};

module.exports = {
  getUserGyms,
};
