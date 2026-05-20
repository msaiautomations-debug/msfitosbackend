const express = require('express');
const { authenticate } = require('../middlewares/auth');
const { subscriptionRequired } = require('../middlewares/subscription');
const {
  listMembershipPlans,
  createMembershipPlan,
  updateMembershipPlan,
} = require('../controllers/membershipPlansController');

const router = express.Router();

router.use(authenticate);
router.use(subscriptionRequired);

router.get('/', listMembershipPlans);
router.post('/', createMembershipPlan);
router.put('/:id', updateMembershipPlan);

module.exports = router;
