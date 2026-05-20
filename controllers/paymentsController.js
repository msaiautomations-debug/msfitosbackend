
const prisma = require('../utils/prisma');
const { createOrderForGym, createPaymentLinkForGym } = require('../services/razorpayService');

const createOrder = async (req, res) => {
  try {
    const gym_id = req.gym_id;
    const { member_id, amount } = req.body;
    if (!member_id) return res.status(400).json({ error: 'member_id required' });

    const member = await prisma.members.findFirst({ where: { id: member_id, gym_id } });
    if (!member) return res.status(404).json({ error: 'Member not found' });

    const gym = await prisma.gyms.findUnique({ where: { id: gym_id } });

    const order = await createOrderForGym(gym, member, amount);
    if (!order) return res.status(500).json({ error: 'Failed to create order' });

    // create payments record with order id
    const payment = await prisma.payments.create({
      data: {
        gym_id,
        member_id,
        razorpay_order_id: order.id,
        amount: (amount || member.amount) || 0,
        status: 'created',
      },
    });

    // try also to create a payment link if gym keys present
    const link = await createPaymentLinkForGym(gym, member);

    res.json({ order, payment, payment_link: link });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error', details: process.env.NODE_ENV !== 'production' ? err.message : undefined });
  }
};

// Create subscription payment for gym (trial extension or upgrade)
const createGymSubscriptionOrder = async (req, res) => {
  try {
    const gym_id = req.gym_id;
    const { plan, amount } = req.body;

    if (!plan || !amount) {
      return res.status(400).json({ error: 'plan and amount required' });
    }

    const gym = await prisma.gyms.findUnique({ where: { id: gym_id } });
    if (!gym) return res.status(404).json({ error: 'Gym not found' });

    // Create Razorpay order for gym subscription
    const Razorpay = require('razorpay');
    const razorpay = new Razorpay({
      key_id: gym.razorpay_key_id,
      key_secret: gym.razorpay_key_secret,
    });

    const order = await razorpay.orders.create({
      amount: Math.round(amount * 100), // Convert to paise
      currency: 'INR',
      receipt: `gym-${gym_id}-${Date.now()}`,
      notes: {
        gym_id,
        type: 'subscription',
        plan,
      },
    });

    // Create payment record for tracking
    const payment = await prisma.payments.create({
      data: {
        gym_id,
        razorpay_order_id: order.id,
        amount,
        status: 'created',
      },
    });

    res.json({ order, payment });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error', details: process.env.NODE_ENV !== 'production' ? err.message : undefined });
  }
};

// return all payments for the gym with related member info
const listPayments = async (req, res) => {
  try {
    const gym_id = req.gym_id;
    const payments = await prisma.payments.findMany({
      where: { gym_id },
      orderBy: { created_at: 'desc' },
      include: { member: true },
    });
    res.json({ payments });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error', details: process.env.NODE_ENV !== 'production' ? err.message : undefined });
  }
};

module.exports = { createOrder, createGymSubscriptionOrder, listPayments };


