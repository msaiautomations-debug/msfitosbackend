ALTER TABLE "reminder_settings"
ADD COLUMN "member_email_send_hour" INTEGER NOT NULL DEFAULT 10,
ADD COLUMN "member_email_send_minute" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "email_subject_birthday" TEXT NOT NULL DEFAULT 'Happy Birthday from {gym_name}!',
ADD COLUMN "email_body_birthday" TEXT NOT NULL DEFAULT E'Hi {member_name},\n\nHappy Birthday from everyone at {gym_name}.\n\nWishing you a strong, healthy, and successful year ahead.\n\nThanks,\n{gym_name}',
ADD COLUMN "email_subject_inactive" TEXT NOT NULL DEFAULT 'We miss you at {gym_name}',
ADD COLUMN "email_body_inactive" TEXT NOT NULL DEFAULT E'Hi {member_name},\n\nWe haven''t seen you at {gym_name} recently.\n\nCome back this week and keep your progress going.\n\nThanks,\n{gym_name}';
