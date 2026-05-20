const express = require('express');
const { authenticateAdmin } = require('../middlewares/adminAuth');
const {
  listWebsitePricing,
  listWebsitePricingAdmin,
  updateWebsitePricingSettings,
  createWebsitePricingPlan,
  updateWebsitePricingPlan,
  deleteWebsitePricingPlan,
} = require('../controllers/websitePricingController');

const router = express.Router();

router.get('/', listWebsitePricing);
router.get('/admin', authenticateAdmin, listWebsitePricingAdmin);
router.put('/settings', authenticateAdmin, updateWebsitePricingSettings);
router.post('/', authenticateAdmin, createWebsitePricingPlan);
router.put('/:id', authenticateAdmin, updateWebsitePricingPlan);
router.delete('/:id', authenticateAdmin, deleteWebsitePricingPlan);

module.exports = router;
