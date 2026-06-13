const bcrypt = require('bcrypt');
const prisma = require('../utils/prisma');

const SALT_ROUNDS = 10;

const listOwners = async (req, res) => {
  try {
    const owners = await prisma.owners.findMany({
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        whatsapp_verified: true,
        created_at: true,
        _count: { select: { admin_gym_access: true } },
      },
      orderBy: { created_at: 'desc' },
    });

    res.json({
      owners: owners.map((o) => ({
        ...o,
        assignedGyms: o._count.admin_gym_access,
        _count: undefined,
      })),
    });
  } catch (err) {
    console.error('List owners error', err);
    res.status(500).json({ error: 'Failed to list owners' });
  }
};

const createOwner = async (req, res) => {
  try {
    const { name, email, phone, password } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({ error: 'Name, email, and password are required' });
    }

    const emailLower = email.trim().toLowerCase();

    // Check if email is already used by an owner
    const existingOwner = await prisma.owners.findUnique({
      where: { email: emailLower },
    });

    if (existingOwner) {
      return res.status(409).json({ error: 'This email already exists. Enter a new email' });
    }

    // Check if email is already used by a gym
    const existingGym = await prisma.gyms.findUnique({
      where: { email: emailLower },
    });

    if (existingGym) {
      return res.status(409).json({ error: 'This email already exists. Enter a new email' });
    }

    if (password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }

    const password_hash = await bcrypt.hash(password, SALT_ROUNDS);

    const owner = await prisma.owners.create({
      data: {
        name: name.trim(),
        email: emailLower,
        phone: phone ? phone.trim() : null,
        password_hash,
      },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        created_at: true,
      },
    });

    res.status(201).json({ owner });
  } catch (err) {
    console.error('Create owner error', err);
    res.status(500).json({ error: 'Failed to create owner' });
  }
};

const getOwnerDetail = async (req, res) => {
  try {
    const { ownerId } = req.params;

    const owner = await prisma.owners.findUnique({
      where: { id: ownerId },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        whatsapp_number: true,
        whatsapp_verified: true,
        expiring_soon_days: true,
        created_at: true,
        admin_gym_access: {
          include: {
            gym: {
              select: {
                id: true,
                gym_name: true,
                gym_id: true,
                email: true,
                plan: true,
                subscription_status: true,
              },
            },
          },
          orderBy: { created_at: 'desc' },
        },
      },
    });

    if (!owner) {
      return res.status(404).json({ error: 'Owner not found' });
    }

    const gyms = owner.admin_gym_access.map((a) => ({
      ...a.gym,
      owner_name: owner.name,
      assigned_at: a.created_at,
    }));

    res.json({
      owner: {
        id: owner.id,
        name: owner.name,
        email: owner.email,
        phone: owner.phone,
        whatsapp_number: owner.whatsapp_number,
        whatsapp_verified: owner.whatsapp_verified,
        expiring_soon_days: owner.expiring_soon_days,
        created_at: owner.created_at,
      },
      gyms,
    });
  } catch (err) {
    console.error('Get owner detail error', err);
    res.status(500).json({ error: 'Failed to load owner details' });
  }
};

const assignGymToOwner = async (req, res) => {
  try {
    const { ownerId } = req.params;
    const { gym_id } = req.body;

    if (!gym_id) {
      return res.status(400).json({ error: 'gym_id is required' });
    }

    // Verify owner exists
    const owner = await prisma.owners.findUnique({ where: { id: ownerId } });
    if (!owner) return res.status(404).json({ error: 'Owner not found' });

    // Verify gym exists
    const gym = await prisma.gyms.findUnique({ where: { id: gym_id } });
    if (!gym) return res.status(404).json({ error: 'Gym not found' });

    // Check if already assigned
    const existing = await prisma.admin_gym_access.findFirst({
      where: { owner_id: ownerId, gym_id },
    });

    if (existing) {
      return res.status(409).json({ error: 'Gym is already assigned to this owner' });
    }

    await prisma.admin_gym_access.create({
      data: {
        owner_id: ownerId,
        gym_id,
        granted_by_admin: req.admin?.id || req.admin?.email || null,
      },
    });

    res.status(201).json({ message: `${gym.gym_name} assigned to ${owner.name}` });
  } catch (err) {
    console.error('Assign gym to owner error', err);
    res.status(500).json({ error: 'Failed to assign gym' });
  }
};

const removeGymFromOwner = async (req, res) => {
  try {
    const { ownerId, gymId } = req.params;

    const deleted = await prisma.admin_gym_access.deleteMany({
      where: { owner_id: ownerId, gym_id: gymId },
    });

    if (deleted.count === 0) {
      return res.status(404).json({ error: 'Assignment not found' });
    }

    res.json({ message: 'Gym removed from owner' });
  } catch (err) {
    console.error('Remove gym from owner error', err);
    res.status(500).json({ error: 'Failed to remove gym' });
  }
};

const listAvailableGyms = async (req, res) => {
  try {
    const { ownerId } = req.params;

    // Get gym IDs already assigned to this owner
    const assigned = await prisma.admin_gym_access.findMany({
      where: { owner_id: ownerId },
      select: { gym_id: true },
    });
    const assignedIds = assigned.map((a) => a.gym_id);

    // Get all gyms NOT in the assigned list, include owner info
    const gyms = await prisma.gyms.findMany({
      where: assignedIds.length ? { id: { notIn: assignedIds } } : {},
      select: {
        id: true,
        gym_name: true,
        gym_id: true,
        email: true,
        plan: true,
        owner: {
          select: {
            name: true,
          },
        },
      },
      orderBy: { gym_name: 'asc' },
    });

    // Map with owner_name field
    const gymsWithOwner = gyms.map((gym) => ({
      id: gym.id,
      gym_name: gym.gym_name,
      gym_id: gym.gym_id,
      email: gym.email,
      plan: gym.plan,
      owner_name: gym.owner?.name || null,
    }));

    res.json({ gyms: gymsWithOwner });
  } catch (err) {
    console.error('List available gyms error', err);
    res.status(500).json({ error: 'Failed to load available gyms' });
  }
};

module.exports = {
  listOwners,
  createOwner,
  getOwnerDetail,
  assignGymToOwner,
  removeGymFromOwner,
  listAvailableGyms,
};
