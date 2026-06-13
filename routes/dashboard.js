const express = require('express');
const { authenticate } = require('../middlewares/auth');
const { subscriptionRequired } = require('../middlewares/subscription');
const { handleMultiGymAccess } = require('../middlewares/multiGymAccess');
const { getDashboard, getRevenueAnalytics, getGrowthAnalytics, getDashboardBootstrap } = require('../controllers/dashboardController');

const router = express.Router();

router.use(authenticate);
router.use(handleMultiGymAccess); // Allow gym_id parameter for switching
router.use(subscriptionRequired);

router.get('/', getDashboard);
router.get('/bootstrap', getDashboardBootstrap);
router.get('/revenue', getRevenueAnalytics);
router.get('/growth', getGrowthAnalytics);

module.exports = router;
