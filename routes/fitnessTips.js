const express = require('express');
const { authenticate } = require('../middlewares/auth');
const { subscriptionRequired } = require('../middlewares/subscription');
const { listTips, createTip, updateTip, deleteTip } = require('../controllers/fitnessTipsController');

const router = express.Router();

router.use(authenticate);
router.use(subscriptionRequired);

router.get('/', listTips);
router.post('/', createTip);
router.put('/:id', updateTip);
router.delete('/:id', deleteTip);

module.exports = router;
