const Razorpay = require('razorpay');
const { decrypt } = require('../utils/encryption');

async function createPaymentLinkForGym(gym, member) {
  try {
    if (!gym.razorpay_key_id || !gym.razorpay_key_secret) {
      // fallback: return an internal payment URL or instruct to contact gym
      return 'https://example.com/pay-not-configured';
    }
    const key_id = decrypt(gym.razorpay_key_id);
    const key_secret = decrypt(gym.razorpay_key_secret);

    const instance = new Razorpay({ key_id, key_secret });

    const payload = {
      amount: Math.round((member.amount || 0) * 100),
      currency: 'INR',
      accept_partial: false,
      reference_id: member.id,
      description: `Renewal for ${member.name}`,
      customer: { name: member.name, contact: member.phone },
      notify: { sms: false, email: false },
      callback_url: process.env.PAYMENT_CALLBACK_URL || '',
      callback_method: 'get',
    };

    const resp = await instance.paymentLink.create(payload);
    return resp.short_url || resp.long_url || resp.url;
  } catch (err) {
    console.error('createPaymentLinkForGym error', err);
    return 'https://example.com/error';
  }
}

module.exports = { createPaymentLinkForGym };

async function createOrderForGym(gym, member, amount) {
  try {
    if (!gym.razorpay_key_id || !gym.razorpay_key_secret) return null;
    const key_id = decrypt(gym.razorpay_key_id);
    const key_secret = decrypt(gym.razorpay_key_secret);
    const Razorpay = require('razorpay');
    const instance = new Razorpay({ key_id, key_secret });

    const payload = {
      amount: Math.round((amount || member.amount || 0) * 100),
      currency: 'INR',
      receipt: `rcpt_${member.id}_${Date.now()}`,
      notes: { member_id: member.id },
    };

    const order = await instance.orders.create(payload);
    return order;
  } catch (err) {
    console.error('createOrderForGym error', err);
    return null;
  }
}

module.exports.createOrderForGym = createOrderForGym;
