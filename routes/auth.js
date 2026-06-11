const express = require('express');
const {
  register,
  login,
  registerGym,
  gymLogin,
  verifyOtp,
  requestGymPasswordReset,
  verifyGymPasswordResetOtp,
  resetGymPassword,
} = require('../controllers/authController');

const router = express.Router();

router.post('/register', register);
router.post('/login', login);
router.post('/register-gym', registerGym);
router.post('/gym-login', gymLogin);
router.post('/verify-otp', verifyOtp);
router.post('/gym-password-reset/request', requestGymPasswordReset);
router.post('/gym-password-reset/verify', verifyGymPasswordResetOtp);
router.post('/gym-password-reset/reset', resetGymPassword);

module.exports = router;
