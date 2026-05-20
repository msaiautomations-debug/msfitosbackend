const prisma = require('../utils/prisma');

const listTrainers = async (req, res) => {
  try {
    const gym_id = req.gym_id;
    const trainers = await prisma.trainers.findMany({
      where: { gym_id },
      orderBy: [{ status: 'asc' }, { created_at: 'desc' }],
    });
    res.json({ trainers });
  } catch (err) {
    console.error(err);
    res.status(500).json({
      error: 'Failed to load trainers',
      details: process.env.NODE_ENV !== 'production' ? err.message : undefined,
    });
  }
};

const createTrainer = async (req, res) => {
  try {
    const gym_id = req.gym_id;
    const {
      name,
      email,
      phone,
      specialization,
      experience_years,
      hourly_rate,
      salary_amount,
      salary_basis,
      status,
    } = req.body;

    const trimmedName = String(name || '').trim();
    if (!trimmedName) {
      return res.status(400).json({ error: 'Trainer name is required' });
    }

    const trainer = await prisma.trainers.create({
      data: {
        gym_id,
        name: trimmedName,
        email: email ? String(email).trim() : null,
        phone: phone ? String(phone).trim() : null,
        specialization: specialization ? String(specialization).trim() : null,
        experience_years: Math.max(0, parseInt(experience_years || 0, 10) || 0),
        hourly_rate: Number.isFinite(Number(hourly_rate)) ? Number(hourly_rate) : null,
        salary_amount: Number.isFinite(Number(salary_amount)) ? Number(salary_amount) : null,
        salary_basis: salary_basis ? String(salary_basis).trim().toLowerCase() : null,
        status: status ? String(status) : 'active',
      },
    });

    res.status(201).json({ trainer });
  } catch (err) {
    console.error(err);
    res.status(500).json({
      error: 'Failed to create trainer',
      details: process.env.NODE_ENV !== 'production' ? err.message : undefined,
    });
  }
};

const listTrainerAssignments = async (req, res) => {
  try {
    const gym_id = req.gym_id;
    const sessions = await prisma.trainer_sessions.findMany({
      where: { gym_id },
      include: {
        trainer: true,
        member: true,
      },
      orderBy: [{ session_date: 'desc' }, { created_at: 'desc' }],
      take: 50,
    });
    res.json({ sessions });
  } catch (err) {
    console.error(err);
    res.status(500).json({
      error: 'Failed to load trainer assignments',
      details: process.env.NODE_ENV !== 'production' ? err.message : undefined,
    });
  }
};

const createTrainerAssignment = async (req, res) => {
  try {
    const gym_id = req.gym_id;
    const {
      trainer_id,
      member_id,
      session_date,
      duration_minutes,
      notes,
      status,
    } = req.body;

    if (!trainer_id || !member_id || !session_date || !duration_minutes) {
      return res.status(400).json({ error: 'trainer_id, member_id, session_date and duration_minutes are required' });
    }

    const [trainer, member] = await Promise.all([
      prisma.trainers.findFirst({ where: { id: trainer_id, gym_id } }),
      prisma.members.findFirst({ where: { id: member_id, gym_id } }),
    ]);

    if (!trainer) return res.status(404).json({ error: 'Trainer not found' });
    if (!member) return res.status(404).json({ error: 'Member not found' });

    const session = await prisma.trainer_sessions.create({
      data: {
        gym_id,
        trainer_id,
        member_id,
        session_date: new Date(session_date),
        duration_minutes: Math.max(1, parseInt(duration_minutes, 10)),
        notes: notes ? String(notes).trim() : null,
        status: status ? String(status) : 'scheduled',
      },
      include: {
        trainer: true,
        member: true,
      },
    });

    res.status(201).json({ session });
  } catch (err) {
    console.error(err);
    res.status(500).json({
      error: 'Failed to create trainer assignment',
      details: process.env.NODE_ENV !== 'production' ? err.message : undefined,
    });
  }
};

const updateTrainerAssignment = async (req, res) => {
  try {
    const gym_id = req.gym_id;
    const { id } = req.params;
    const {
      trainer_id,
      member_id,
      session_date,
      duration_minutes,
      notes,
      status,
    } = req.body;

    const existing = await prisma.trainer_sessions.findFirst({
      where: { id, gym_id },
    });
    if (!existing) return res.status(404).json({ error: 'Trainer assignment not found' });

    if (trainer_id) {
      const trainer = await prisma.trainers.findFirst({ where: { id: trainer_id, gym_id } });
      if (!trainer) return res.status(404).json({ error: 'Trainer not found' });
    }

    if (member_id) {
      const member = await prisma.members.findFirst({ where: { id: member_id, gym_id } });
      if (!member) return res.status(404).json({ error: 'Member not found' });
    }

    const session = await prisma.trainer_sessions.update({
      where: { id },
      data: {
        ...(trainer_id ? { trainer_id } : {}),
        ...(member_id !== undefined ? { member_id: member_id || null } : {}),
        ...(session_date ? { session_date: new Date(session_date) } : {}),
        ...(duration_minutes ? { duration_minutes: Math.max(1, parseInt(duration_minutes, 10)) } : {}),
        ...(notes !== undefined ? { notes: notes ? String(notes).trim() : null } : {}),
        ...(status ? { status: String(status) } : {}),
      },
      include: {
        trainer: true,
        member: true,
      },
    });

    res.json({ session });
  } catch (err) {
    console.error(err);
    res.status(500).json({
      error: 'Failed to update trainer assignment',
      details: process.env.NODE_ENV !== 'production' ? err.message : undefined,
    });
  }
};

const updateTrainer = async (req, res) => {
  try {
    const gym_id = req.gym_id;
    const { id } = req.params;
    const data = { ...req.body };

    if (data.name !== undefined) {
      const trimmedName = String(data.name || "").trim();
      if (!trimmedName) {
        return res.status(400).json({ error: 'Trainer name is required' });
      }
      data.name = trimmedName;
    }

    if (data.email !== undefined) {
      data.email = data.email ? String(data.email).trim().toLowerCase() : null;
    }
    if (data.phone !== undefined) {
      data.phone = data.phone ? String(data.phone).trim() : null;
    }
    if (data.specialization !== undefined) {
      data.specialization = data.specialization ? String(data.specialization).trim() : null;
    }
    if (data.experience_years !== undefined) {
      data.experience_years = Math.max(0, parseInt(data.experience_years || 0, 10) || 0);
    }
    if (data.salary_amount !== undefined) {
      data.salary_amount = Number.isFinite(Number(data.salary_amount)) ? Number(data.salary_amount) : null;
    }
    if (data.salary_basis !== undefined) {
      data.salary_basis = data.salary_basis ? String(data.salary_basis).trim().toLowerCase() : null;
    }
    if (data.status !== undefined) {
      data.status = data.status ? String(data.status).trim().toLowerCase() : "active";
    }

    const trainer = await prisma.trainers.updateMany({
      where: { id, gym_id },
      data,
    });

    if (trainer.count === 0) return res.status(404).json({ error: 'Trainer not found' });

    const updatedTrainer = await prisma.trainers.findFirst({ where: { id, gym_id } });
    res.json({ trainer: updatedTrainer, message: 'Trainer updated' });
  } catch (err) {
    console.error(err);
    res.status(500).json({
      error: 'Failed to update trainer',
      details: process.env.NODE_ENV !== 'production' ? err.message : undefined,
    });
  }
};

const deleteTrainerAssignment = async (req, res) => {
  try {
    const gym_id = req.gym_id;
    const { id } = req.params;

    const existing = await prisma.trainer_sessions.findFirst({
      where: { id, gym_id },
    });
    if (!existing) return res.status(404).json({ error: 'Trainer assignment not found' });

    try {
      await prisma.trainer_sessions.delete({
        where: { id },
      });
    } catch (deleteErr) {
      await prisma.trainer_sessions.update({
        where: { id },
        data: {
          member_id: null,
          status: 'cancelled',
          notes: existing.notes
            ? `${String(existing.notes).trim()}|note=${encodeURIComponent("Trainer removed from member")}`
            : `note=${encodeURIComponent("Trainer removed from member")}`,
        },
      });
    }

    res.json({ message: 'Trainer assignment removed' });
  } catch (err) {
    console.error(err);
    res.status(500).json({
      error: 'Failed to remove trainer assignment',
      details: process.env.NODE_ENV !== 'production' ? err.message : undefined,
    });
  }
};

module.exports = {
  listTrainers,
  createTrainer,
  updateTrainer,
  listTrainerAssignments,
  createTrainerAssignment,
  updateTrainerAssignment,
  deleteTrainerAssignment,
};
