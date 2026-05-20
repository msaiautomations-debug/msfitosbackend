CREATE TABLE "website_inquiries" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "gym_name" TEXT NOT NULL,
  "phone" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "message" TEXT,
  "status" TEXT NOT NULL DEFAULT 'new',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "website_inquiries_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "website_inquiries_status_created_at_idx" ON "website_inquiries"("status", "created_at");
CREATE INDEX "website_inquiries_created_at_idx" ON "website_inquiries"("created_at");
