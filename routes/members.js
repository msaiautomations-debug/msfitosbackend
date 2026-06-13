const express = require('express');
const { authenticate } = require('../middlewares/auth');
const { subscriptionRequired } = require('../middlewares/subscription');
const { handleMultiGymAccess } = require('../middlewares/multiGymAccess');
const {
  addMember,
  editMember,
  deleteMember,
  searchMembers,
  listMembershipStatusMembers,
  listPendingPayments,
  markPendingPaymentsPaid,
  sendPendingPaymentEmails,
  sendPendingPaymentWhatsapps,
  sendMembershipStatusEmails,
  sendMembershipStatusWhatsapps,
  manualRenew,
  deactivateMember,
  activateMember,
  restoreMember,
  getMemberHistory,
  pauseMember,
  resumeMember,
} = require('../controllers/membersController');

const router = express.Router();

router.use(authenticate);
router.use(handleMultiGymAccess);
router.use(subscriptionRequired);

router.post('/', addMember);
router.get('/membership-status', listMembershipStatusMembers);
router.get('/pending-payments', listPendingPayments);
router.post('/pending-payments/mark-paid', markPendingPaymentsPaid);
router.post('/pending-payments/send-email', sendPendingPaymentEmails);
router.post('/pending-payments/send-whatsapp', sendPendingPaymentWhatsapps);
router.post('/membership-status-email', sendMembershipStatusEmails);
router.post('/membership-status-whatsapp', sendMembershipStatusWhatsapps);
router.put('/:id', editMember);
router.delete('/:id', deleteMember);
router.get('/search', searchMembers);
router.get('/:id/history', getMemberHistory);
router.post('/:id/renew', manualRenew);
router.post('/:id/deactivate', deactivateMember);
router.post('/:id/activate', activateMember);
router.post('/:id/restore', restoreMember);
router.post('/:id/pause', pauseMember);
router.post('/:id/resume', resumeMember);

module.exports = router;
