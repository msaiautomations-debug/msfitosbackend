const express = require('express');
const {
  adminLogin,
  listGyms,
  getGymDetails,
  updateGym,
  deleteGym,
  createGymPayment,
  createGymMembershipPlan,
  updateGymMembershipPlan,
  getAdminDietPlan,
  uploadAdminDietPlan,
  removeAdminDietPlan,
  listGymBookings,
  createGymForUser,
  getUserGymsAdmin,
} = require('../controllers/adminController');
const { authenticateAdmin } = require('../middlewares/adminAuth');
const { listWebsiteInquiriesAdmin } = require('../controllers/websiteInquiryController');
const {
  getAdminWhatsappStatus,
  startAdminWhatsapp,
  logoutAdminWhatsapp,
} = require('../controllers/adminWhatsappController');

const router = express.Router();

router.post('/login', adminLogin);
router.get('/diet-plan', authenticateAdmin, getAdminDietPlan);
router.put('/diet-plan', authenticateAdmin, express.raw({ type: 'application/pdf', limit: '5mb' }), uploadAdminDietPlan);
router.delete('/diet-plan', authenticateAdmin, removeAdminDietPlan);
router.get('/gyms', authenticateAdmin, listGyms);
router.get('/gyms/:id', authenticateAdmin, getGymDetails);
router.put('/gyms/:id', authenticateAdmin, updateGym);
router.delete('/gyms/:id', authenticateAdmin, deleteGym);
router.post('/gyms/:id/payments', authenticateAdmin, createGymPayment);
router.post('/gyms/:id/membership-plans', authenticateAdmin, createGymMembershipPlan);
router.put('/gyms/:id/membership-plans/:planId', authenticateAdmin, updateGymMembershipPlan);
router.get('/gym-bookings', authenticateAdmin, listGymBookings);
router.get('/website-inquiries', authenticateAdmin, listWebsiteInquiriesAdmin);
router.get('/whatsapp/status', authenticateAdmin, getAdminWhatsappStatus);
router.post('/whatsapp/start', authenticateAdmin, startAdminWhatsapp);
router.post('/whatsapp/logout', authenticateAdmin, logoutAdminWhatsapp);
router.get('/users/:userEmail/gyms', authenticateAdmin, getUserGymsAdmin);
router.post('/users/:userEmail/gyms', authenticateAdmin, createGymForUser);

module.exports = router;
