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
  listGymBookings,
} = require('../controllers/adminController');
const { authenticateAdmin } = require('../middlewares/adminAuth');
const { listWebsiteInquiriesAdmin } = require('../controllers/websiteInquiryController');

const router = express.Router();

router.post('/login', adminLogin);
router.get('/gyms', authenticateAdmin, listGyms);
router.get('/gyms/:id', authenticateAdmin, getGymDetails);
router.put('/gyms/:id', authenticateAdmin, updateGym);
router.delete('/gyms/:id', authenticateAdmin, deleteGym);
router.post('/gyms/:id/payments', authenticateAdmin, createGymPayment);
router.post('/gyms/:id/membership-plans', authenticateAdmin, createGymMembershipPlan);
router.put('/gyms/:id/membership-plans/:planId', authenticateAdmin, updateGymMembershipPlan);
router.get('/gym-bookings', authenticateAdmin, listGymBookings);
router.get('/website-inquiries', authenticateAdmin, listWebsiteInquiriesAdmin);

module.exports = router;
