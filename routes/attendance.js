const express = require("express");
const { authenticate } = require("../middlewares/auth");
const { subscriptionRequired } = require("../middlewares/subscription");
const { checkin, getDailySummary } = require("../controllers/attendanceController");

const router = express.Router();

router.use(authenticate);
router.use(subscriptionRequired);

router.post("/checkin", checkin);
router.get("/daily-summary", getDailySummary);

module.exports = router;

