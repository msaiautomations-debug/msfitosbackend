const express = require('express');
const { createWebsiteInquiry } = require('../controllers/websiteInquiryController');

const router = express.Router();

router.post('/', createWebsiteInquiry);

module.exports = router;
