CREATE TABLE "website_pricing_settings" (
  "id" TEXT NOT NULL DEFAULT 'default',
  "tagline" TEXT NOT NULL DEFAULT 'Affordable pricing designed for growing gyms',
  "billing_toggle_enabled" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "website_pricing_settings_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "website_pricing_plans" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "monthly_price" DOUBLE PRECISION,
  "monthly_discount_type" TEXT,
  "monthly_discount_value" DOUBLE PRECISION,
  "yearly_price" DOUBLE PRECISION,
  "yearly_discount_type" TEXT,
  "yearly_discount_value" DOUBLE PRECISION,
  "features" JSONB NOT NULL,
  "cta_label" TEXT NOT NULL DEFAULT 'Choose Plan',
  "badge_text" TEXT,
  "is_recommended" BOOLEAN NOT NULL DEFAULT false,
  "is_visible" BOOLEAN NOT NULL DEFAULT true,
  "has_custom_feature_requests" BOOLEAN NOT NULL DEFAULT false,
  "sort_order" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "website_pricing_plans_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "website_pricing_plans_is_visible_sort_order_idx" ON "website_pricing_plans"("is_visible", "sort_order");
