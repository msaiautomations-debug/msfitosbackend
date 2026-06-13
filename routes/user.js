const express = require('express');
const { authenticate } = require('../middlewares/auth');
const { getUserGyms } = require('../controllers/userController');

const router = express.Router();

router.use(authenticate);

// Get all gyms for the logged-in user
router.get('/gyms', getUserGyms);

module.exports = router;
