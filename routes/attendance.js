const express = require("express");
const { authenticate } = require("../middlewares/auth");
const { subscriptionRequired } = require("../middlewares/subscription");
const { handleMultiGymAccess } = require("../middlewares/multiGymAccess");
const { checkin, getDailySummary } = require("../controllers/attendanceController");

const router = express.Router();

router.use(authenticate);
router.use(handleMultiGymAccess);
router.use(subscriptionRequired);

router.post("/checkin", checkin);
router.get("/daily-summary", getDailySummary);

module.exports = router;

