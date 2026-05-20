const prisma = require('../utils/prisma');
const crypto = require('crypto');
const { sendWebsiteInquiryOwnerNotification } = require('../services/ownerNotificationService');

function normalizeField(value) {
  return String(value || '').trim();
}

async function ensureWebsiteInquiryTable() {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "website_inquiries" (
      "id" TEXT NOT NULL,
      "name" TEXT NOT NULL,
      "gym_name" TEXT NOT NULL,
      "phone" TEXT NOT NULL,
      "email" TEXT NOT NULL,
      "message" TEXT,
      "status" TEXT NOT NULL DEFAULT 'new',
      "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "website_inquiries_pkey" PRIMARY KEY ("id")
    )
  `);

  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS "website_inquiries_status_created_at_idx"
    ON "website_inquiries"("status", "created_at")
  `);

  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS "website_inquiries_created_at_idx"
    ON "website_inquiries"("created_at")
  `);
}

const createWebsiteInquiry = async (req, res) => {
  try {
    await ensureWebsiteInquiryTable();

    const name = normalizeField(req.body?.name);
    const gym_name = normalizeField(req.body?.gym_name);
    const phone = normalizeField(req.body?.phone);
    const email = normalizeField(req.body?.email);
    const message = normalizeField(req.body?.message) || null;

    if (!name || !gym_name || !phone || !email) {
      return res.status(400).json({ error: 'Name, gym name, phone, and email are required' });
    }

    const inquiryId = crypto.randomUUID();
    const rows = await prisma.$queryRaw`
      INSERT INTO "website_inquiries" (
        "id", "name", "gym_name", "phone", "email", "message", "status", "created_at", "updated_at"
      )
      VALUES (
        ${inquiryId}, ${name}, ${gym_name}, ${phone}, ${email}, ${message}, 'new', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
      )
      RETURNING "id", "name", "gym_name", "phone", "email", "message", "status", "created_at", "updated_at"
    `;
    const inquiry = rows[0];

    const notification = await sendWebsiteInquiryOwnerNotification(inquiry);

    return res.status(201).json({
      inquiry,
      message: 'Inquiry submitted successfully',
      owner_notification: notification,
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({
      error: 'Failed to submit inquiry',
      details: process.env.NODE_ENV !== 'production' ? err.message : undefined,
    });
  }
};

const listWebsiteInquiriesAdmin = async (req, res) => {
  try {
    await ensureWebsiteInquiryTable();

    const inquiries = await prisma.$queryRaw`
      SELECT "id", "name", "gym_name", "phone", "email", "message", "status", "created_at", "updated_at"
      FROM "website_inquiries"
      ORDER BY "created_at" DESC
    `;

    return res.json({ inquiries });
  } catch (err) {
    console.error(err);
    return res.status(500).json({
      error: 'Failed to load website inquiries',
      details: process.env.NODE_ENV !== 'production' ? err.message : undefined,
    });
  }
};

module.exports = {
  createWebsiteInquiry,
  listWebsiteInquiriesAdmin,
};
