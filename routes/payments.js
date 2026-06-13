const express = require('express');
const { authenticate } = require('../middlewares/auth');
const { subscriptionRequired } = require('../middlewares/subscription');
const { handleMultiGymAccess } = require('../middlewares/multiGymAccess');
const { createOrder, createGymSubscriptionOrder, listPayments } = require('../controllers/paymentsController');

const router = express.Router();

router.use(authenticate);
router.use(handleMultiGymAccess);

// Gym subscription payment - allow even if trial expired
router.post('/create-gym-subscription-order', createGymSubscriptionOrder);

// Other payment routes require subscription
router.use(subscriptionRequired);

router.post('/create-order', createOrder);
router.get('/history', listPayments);

module.exports = router;
