const express = require('express');
const { authenticate } = require('../middlewares/auth');
const { subscriptionRequired } = require('../middlewares/subscription');
const { getDashboard, getRevenueAnalytics, getGrowthAnalytics, getDashboardBootstrap } = require('../controllers/dashboardController');

const router = express.Router();

router.use(authenticate);
router.use(subscriptionRequired);

router.get('/', getDashboard);
router.get('/bootstrap', getDashboardBootstrap);
router.get('/revenue', getRevenueAnalytics);
router.get('/growth', getGrowthAnalytics);

module.exports = router;
