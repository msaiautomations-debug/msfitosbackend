const crypto = require('crypto');
const prisma = require('../utils/prisma');

function getMembershipExpiryFromStart(startDate, planDurationDays) {
  const date = new Date(startDate);
  const days = Math.max(1, parseInt(planDurationDays, 10) || 1);
  date.setUTCDate(date.getUTCDate() + days - 1);
  return date;
}

// uses RAZORPAY_WEBHOOK_SECRET for signature verification
const handleRazorpay = async (req, res) => {
  try {
    const payload = JSON.stringify(req.body);
    const signature = req.headers['x-razorpay-signature'] || req.headers['X-Razorpay-Signature'];
    const secret = process.env.RAZORPAY_WEBHOOK_SECRET || '';
    const expected = crypto.createHmac('sha256', secret).update(payload).digest('hex');
    if (signature !== expected) return res.status(400).send('Invalid signature');

    const event = req.body.event;
    if (event === 'payment.captured') {
      const entity = req.body.payload?.payment?.entity;
      const razorpay_payment_id = entity?.id;
      const razorpay_order_id = entity?.order_id;
      const amount = (entity?.amount || 0) / 100;

      // idempotency: if payment id already exists, ignore
      const existingByPaymentId = await prisma.payments.findUnique({ where: { razorpay_payment_id } }).catch(() => null);
      if (existingByPaymentId) return res.status(200).send('Already processed');

      // find existing payment by order id
      const paymentEntry = await prisma.payments.findFirst({ where: { razorpay_order_id } });

      // if paymentEntry exists, use its gym_id/member_id; otherwise attempt to pull member_id from notes
      let memberId = paymentEntry ? paymentEntry.member_id : null;
      if (!memberId && entity?.notes?.member_id) memberId = entity.notes.member_id;

      // determine gym_id
      let gymId = paymentEntry ? paymentEntry.gym_id : null;
      if (!gymId && memberId) {
        const m = await prisma.members.findUnique({ where: { id: memberId } }).catch(() => null);
        if (m) gymId = m.gym_id;
      }
      if (!gymId && entity?.notes?.gym_id) gymId = entity.notes.gym_id;

      await prisma.$transaction(async (tx) => {
        if (paymentEntry) {
          // update existing payment record with captured id
          await tx.payments.update({ where: { id: paymentEntry.id }, data: { razorpay_payment_id, status: 'paid', amount } });
        } else {
          // create a new payment record
          await tx.payments.create({ data: { gym_id: gymId || '', member_id: memberId, razorpay_payment_id, razorpay_order_id, amount, status: 'paid' } });
        }

        // Check if this is a member payment or gym subscription payment
        if (memberId) {
          // Member payment - extend membership
          const member = await tx.members.findUnique({ where: { id: memberId } });
          if (member) {
            const today = new Date();
            const plan_duration = member.plan_duration || 30;
            let new_expiry;
            if (member.expiry_date > today) {
              new_expiry = new Date(member.expiry_date);
              new_expiry.setUTCDate(new_expiry.getUTCDate() + plan_duration);
            } else {
              new_expiry = getMembershipExpiryFromStart(new Date(), plan_duration);
            }
            await tx.members.update({ where: { id: memberId }, data: { expiry_date: new_expiry, payment_status: 'paid', reminder_7_sent: false } });
          }
        } else if (gymId) {
          // Gym subscription payment - activate subscription
          const gym = await tx.gyms.findUnique({ where: { id: gymId } });
          if (gym) {
            const trial_end_date = new Date();
            trial_end_date.setDate(trial_end_date.getDate() + 30);
            await tx.gyms.update({
              where: { id: gymId },
              data: {
                subscription_status: 'active',
                trial_end_date, // Extend trial/subscription by 30 more days
              },
            });
          }
        }
      });

      return res.status(200).send('ok');
    }

    return res.status(200).send('event ignored');
  } catch (err) {
    console.error(err);
    return res.status(500).json({
      error: 'Server error',
      details: process.env.NODE_ENV !== 'production' ? err.message : undefined,
    });
  }
};

module.exports = { handleRazorpay };
