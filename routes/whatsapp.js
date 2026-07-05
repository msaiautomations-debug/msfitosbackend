const express = require('express');
const { authenticate } = require('../middlewares/auth');
const { subscriptionRequired } = require('../middlewares/subscription');
const {
  getWhatsappStatus,
  startWhatsapp,
  logoutWhatsapp,
  sendTestWhatsapp,
  broadcastFitnessTip,
} = require('../controllers/whatsappController');

const router = express.Router();

router.use(authenticate);
router.use(subscriptionRequired);

router.get('/status', getWhatsappStatus);
router.post('/start', startWhatsapp);
router.post('/logout', logoutWhatsapp);
router.post('/test', sendTestWhatsapp);
router.post('/fitness-tips/:id/broadcast', broadcastFitnessTip);

module.exports = router;

