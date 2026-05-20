const express = require('express');
const { authenticate } = require('../middlewares/auth');
const { subscriptionRequired } = require('../middlewares/subscription');
const { createOrder, createGymSubscriptionOrder, listPayments } = require('../controllers/paymentsController');

const router = express.Router();

router.use(authenticate);

// Gym subscription payment - allow even if trial expired
router.post('/create-gym-subscription-order', createGymSubscriptionOrder);

// Other payment routes require subscription
router.use(subscriptionRequired);

router.post('/create-order', createOrder);
router.get('/history', listPayments);

module.exports = router;
