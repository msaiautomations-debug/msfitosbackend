require('dotenv').config();

const express = require('express');

require('./cron/expiryNotifications');
require('./cron/memberEmailReminders');

const app = express();
const PORT = process.env.CRON_PORT || 4000;

function getIstTimestamp() {
  return new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(new Date());
}

app.get('/health', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

const server = app.listen(PORT, () => {
  console.log(`[${getIstTimestamp()} IST] Cron server listening on port ${PORT}`);
});

process.on('SIGTERM', () => {
  console.log(`[${getIstTimestamp()} IST] SIGTERM received. Shutting down cron server.`);
  server.close(() => {
    console.log(`[${getIstTimestamp()} IST] Cron server stopped.`);
    process.exit(0);
  });
});
