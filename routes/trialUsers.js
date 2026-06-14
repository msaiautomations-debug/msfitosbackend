const express = require('express');
const { authenticate } = require('../middlewares/auth');
const { subscriptionRequired } = require('../middlewares/subscription');
const {
  listTrialUsers,
  createTrialUser,
  updateTrialUser,
  convertTrialUser,
  sendTrialFollowUpWhatsapps,
} = require('../controllers/trialUsersController');

const router = express.Router();

router.use(authenticate);
router.use(subscriptionRequired);

router.get('/', listTrialUsers);
router.post('/', createTrialUser);
router.post('/follow-up-whatsapp', sendTrialFollowUpWhatsapps);
router.put('/:id', updateTrialUser);
router.post('/:id/convert', convertTrialUser);

module.exports = router;
