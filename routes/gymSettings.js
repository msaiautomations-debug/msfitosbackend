const express = require('express');
const { authenticate } = require('../middlewares/auth');
const { subscriptionRequired } = require('../middlewares/subscription');
const {
  getGymSettings,
  updateGymSettings,
  updateGymPassword,
  uploadGymLogo,
} = require('../controllers/gymSettingsController');

const router = express.Router();

router.use(authenticate);

router.put('/password', updateGymPassword);

router.use(subscriptionRequired);

router.get('/', getGymSettings);
router.put('/', updateGymSettings);
router.put(
  '/logo',
  express.raw({ type: ['image/png', 'image/jpeg', 'image/webp'], limit: '200kb' }),
  uploadGymLogo,
);

module.exports = router;
