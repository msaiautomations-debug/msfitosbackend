const prisma = require('../utils/prisma');

// Middleware to handle gym_id switching for users with multiple gyms
const handleMultiGymAccess = async (req, res, next) => {
  try {
    const requestedGymId = req.query.gym_id || req.body?.gym_id;
    
    if (!requestedGymId) {
      // No gym_id provided, use the one from JWT
      return next();
    }

    if (requestedGymId === req.gym_id) {
      // Requested gym is the same as the token gym, proceed
      return next();
    }

    // User is trying to access a different gym
    // Verify they have access to it
    const requestedGym = await prisma.gyms.findUnique({
      where: { id: requestedGymId },
      select: { id: true, owner_email: true, email: true },
    });

    if (!requestedGym) {
      return res.status(404).json({ error: 'Gym not found' });
    }

    // Check if the user owns this gym (by email)
    const userEmail = req.gym_email?.toLowerCase();
    const requestedGymOwnerEmail = requestedGym.owner_email?.toLowerCase();
    const requestedGymContactEmail = requestedGym.email?.toLowerCase();

    if (userEmail === requestedGymOwnerEmail || userEmail === requestedGymContactEmail) {
      // User has access to this gym, switch the gym context
      req.gym_id = requestedGymId;
      // We need to fetch the gym details for the context
      const gym = await prisma.gyms.findUnique({
        where: { id: requestedGymId },
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
      if (gym) {
        req.gym = gym;
      }
      return next();
    }

    // User doesn't have access to this gym
    return res.status(403).json({ error: 'Access denied to this gym' });
  } catch (err) {
    console.error('Error in handleMultiGymAccess middleware:', err);
    return res.status(500).json({
      error: 'Server error',
      details: process.env.NODE_ENV !== 'production' ? err.message : undefined,
    });
  }
};

module.exports = { handleMultiGymAccess };
