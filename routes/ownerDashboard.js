const express = require('express');
const { ownerLogin } = require('../controllers/ownerAuthController');
const {
  getOwnerDashboard,
  getOwnerGymMembers,
  getOwnerCharts,
} = require('../controllers/ownerDashboardController');
const {
  getOwnerSettings,
  updateExpiringSoonDays,
  getOwnerWhatsappStatus,
  startOwnerWhatsapp,
  requestOwnerPairingCode,
  logoutOwnerWhatsapp,
} = require('../controllers/ownerSettingsController');
const { authenticateOwner } = require('../middlewares/ownerAuth');

const router = express.Router();

// --- Auth (public) ---
router.post('/login', ownerLogin);

// --- Dashboard (owner auth required) ---
router.get('/dashboard', authenticateOwner, getOwnerDashboard);
router.get('/gyms/:gymId/members', authenticateOwner, getOwnerGymMembers);
router.get('/charts', authenticateOwner, getOwnerCharts);

// --- Settings (owner auth required) ---
router.get('/settings', authenticateOwner, getOwnerSettings);
router.put('/settings/expiring-days', authenticateOwner, updateExpiringSoonDays);

// --- WhatsApp (owner auth required) ---
router.get('/whatsapp/status', authenticateOwner, getOwnerWhatsappStatus);
router.post('/whatsapp/start', authenticateOwner, startOwnerWhatsapp);
router.post('/whatsapp/pairing-code', authenticateOwner, requestOwnerPairingCode);
router.post('/whatsapp/logout', authenticateOwner, logoutOwnerWhatsapp);

module.exports = router;
