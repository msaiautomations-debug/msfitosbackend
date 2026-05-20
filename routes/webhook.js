const express = require('express');
const { handleRazorpay } = require('../controllers/webhookController');
const router = express.Router();

// razorpay webhook endpoint
router.post('/razorpay', express.json({ type: '*/*' }), handleRazorpay);

module.exports = router;
