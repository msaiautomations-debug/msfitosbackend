const express = require('express');
const { authenticate } = require('../middlewares/auth');
const { subscriptionRequired } = require('../middlewares/subscription');
const { getMarketingDashboard } = require('../controllers/marketingDashboardController');

const router = express.Router();

router.use(authenticate);
router.use(subscriptionRequired);

router.get('/', getMarketingDashboard);

module.exports = router;
