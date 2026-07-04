const express = require('express');
const router = express.Router();
const { runOnce: runExpiryNotifications } = require('../cron/expiryNotifications');
const { runOnce: runMemberReminders } = require('../cron/memberEmailReminders');
const { processAllOwnerSummaries } = require('../services/ownerSummaryService');

router.post('/run', async (req, res) => {
  const secret = req.headers['x-cron-secret'];
  if (secret !== process.env.CRON_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    await runExpiryNotifications();
    await runMemberReminders();
    await processAllOwnerSummaries(new Date());
    res.json({ ok: true, message: 'Cron ran successfully' });
  } catch (err) {
    console.error('Cron HTTP trigger failed:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;