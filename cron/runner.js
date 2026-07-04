require('dotenv').config();

const expiryNotifications = require('./expiryNotifications');
const memberEmailReminders = require('./memberEmailReminders');

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

function logWithIst(message) {
  console.log(`[${getIstTimestamp()} IST] ${message}`);
}

expiryNotifications.start();
memberEmailReminders.start();

logWithIst('Cron background worker started');

const heartbeat = setInterval(() => {
  logWithIst('Cron background worker heartbeat');
}, 60 * 60 * 1000);

function shutdown(signal) {
  logWithIst(`Received ${signal}. Shutting down cron background worker.`);
  clearInterval(heartbeat);
  process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
