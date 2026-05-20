ALTER TABLE "reminder_settings"
ADD COLUMN "email_subject_expiring" TEXT NOT NULL DEFAULT 'Your membership at {gym_name} expires on {expiry_date}',
ADD COLUMN "email_body_expiring" TEXT NOT NULL DEFAULT E'Hi {member_name},\n\nThis is a reminder from {gym_name} that your membership will expire on {expiry_date}.\n\nAmount due: {amount_due}\n\nPlease renew before the expiry date to continue uninterrupted access.\n\nThanks,\n{gym_name}',
ADD COLUMN "email_subject_expired" TEXT NOT NULL DEFAULT 'Your membership at {gym_name} has expired',
ADD COLUMN "email_body_expired" TEXT NOT NULL DEFAULT E'Hi {member_name},\n\nYour membership at {gym_name} expired on {expiry_date}.\n\nAmount due: {amount_due}\n\nPlease renew to reactivate your access.\n\nThanks,\n{gym_name}';
