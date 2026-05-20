const express = require('express');
const { authenticate } = require('../middlewares/auth');
const { subscriptionRequired } = require('../middlewares/subscription');
const { listNotifications } = require('../controllers/notificationsController');

const router = express.Router();

router.use(authenticate);
router.use(subscriptionRequired);

router.get('/', listNotifications);

module.exports = router;
