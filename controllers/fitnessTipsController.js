const prisma = require('../utils/prisma');

const allowedCategories = new Set(['motivation', 'nutrition', 'workout']);

const listTips = async (req, res) => {
  try {
    const gym_id = req.gym_id;
    const tips = await prisma.fitness_tips.findMany({
      where: { gym_id },
      orderBy: { created_at: 'desc' },
    });
    res.json({ tips });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load tips', details: process.env.NODE_ENV !== 'production' ? err.message : undefined });
  }
};

const createTip = async (req, res) => {
  try {
    const gym_id = req.gym_id;
    const { title, message, category } = req.body;
    if (!title || !message || !category) return res.status(400).json({ error: 'Missing fields' });
    if (!allowedCategories.has(category)) return res.status(400).json({ error: 'Invalid category' });

    const tip = await prisma.fitness_tips.create({
      data: { gym_id, title, message, category },
    });

    res.status(201).json({ tip });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to create tip', details: process.env.NODE_ENV !== 'production' ? err.message : undefined });
  }
};

const updateTip = async (req, res) => {
  try {
    const gym_id = req.gym_id;
    const { id } = req.params;
    const { title, message, category } = req.body;

    if (category && !allowedCategories.has(category)) return res.status(400).json({ error: 'Invalid category' });

    const tip = await prisma.fitness_tips.updateMany({
      where: { id, gym_id },
      data: {
        ...(title ? { title } : {}),
        ...(message ? { message } : {}),
        ...(category ? { category } : {}),
      },
    });

    if (tip.count === 0) return res.status(404).json({ error: 'Tip not found' });
    res.json({ message: 'Updated' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update tip', details: process.env.NODE_ENV !== 'production' ? err.message : undefined });
  }
};

const deleteTip = async (req, res) => {
  try {
    const gym_id = req.gym_id;
    const { id } = req.params;
    await prisma.fitness_tips.deleteMany({ where: { id, gym_id } });
    res.json({ message: 'Deleted' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to delete tip', details: process.env.NODE_ENV !== 'production' ? err.message : undefined });
  }
};

module.exports = { listTips, createTip, updateTip, deleteTip };
