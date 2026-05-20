const express = require("express");
const { authenticate } = require("../middlewares/auth");
const { subscriptionRequired } = require("../middlewares/subscription");
const { getReminderSettings, updateReminderSettings, testExpiryEmail } = require("../controllers/reminderSettingsController");

const router = express.Router();

router.use(authenticate);
router.use(subscriptionRequired);

router.get("/", getReminderSettings);
router.put("/", updateReminderSettings);
router.post("/test-expiry-email", testExpiryEmail);

module.exports = router;
