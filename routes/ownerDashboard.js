const express = require('express');
const { ownerLogin } = require('../controllers/ownerAuthController');
const {
  getOwnerDashboard,
  getGymDetails,
  getOwnerGymMembers,
  getOwnerCharts,
  getRevenueTrends,
  getMembershipBreakdown,
  getRenewals,
  getAttendance,
  getTrials,
  getTrainers,
  getLeads,
  getNotificationsHealth,
  getGymComparison,
} = require('../controllers/ownerDashboardController');
const {
  getOwnerSettings,
  updateExpiringSoonDays,
  getOwnerWhatsappStatus,
  startOwnerWhatsapp,
  requestOwnerPairingCode,
  logoutOwnerWhatsapp,
  testOwnerSummaryWhatsapp,
} = require('../controllers/ownerSettingsController');
const { authenticateOwner } = require('../middlewares/ownerAuth');

const router = express.Router();

// --- Auth (public) ---
router.post('/login', ownerLogin);

// --- Dashboard (owner auth required) ---
router.get('/dashboard', authenticateOwner, getOwnerDashboard);
router.get('/gyms/:gymId/details', authenticateOwner, getGymDetails);
router.get('/dashboard/revenue-trends', authenticateOwner, getRevenueTrends);
router.get('/dashboard/membership-breakdown', authenticateOwner, getMembershipBreakdown);
router.get('/dashboard/renewals', authenticateOwner, getRenewals);
router.get('/dashboard/attendance', authenticateOwner, getAttendance);
router.get('/dashboard/trials', authenticateOwner, getTrials);
router.get('/dashboard/trainers', authenticateOwner, getTrainers);
router.get('/dashboard/leads', authenticateOwner, getLeads);
router.get('/dashboard/notifications-health', authenticateOwner, getNotificationsHealth);
router.get('/dashboard/gym-comparison', authenticateOwner, getGymComparison);
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
router.post('/whatsapp/test-summary', authenticateOwner, testOwnerSummaryWhatsapp);

module.exports = router;
