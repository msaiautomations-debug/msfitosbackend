const express = require('express');
const { register, login, registerGym, gymLogin, verifyOtp } = require('../controllers/authController');

const router = express.Router();

router.post('/register', register);
router.post('/login', login);
router.post('/register-gym', registerGym);
router.post('/gym-login', gymLogin);
router.post('/verify-otp', verifyOtp);

module.exports = router;
