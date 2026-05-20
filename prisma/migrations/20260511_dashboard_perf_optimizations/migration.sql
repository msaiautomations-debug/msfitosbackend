CREATE OR REPLACE FUNCTION public.get_dashboard_stats(p_gym_id text)
RETURNS json
LANGUAGE sql
STABLE
AS $$
  WITH bounds AS (
    SELECT
      NOW() AS now_ts,
      DATE_TRUNC('day', NOW()) AS start_today,
      DATE_TRUNC('day', NOW()) + INTERVAL '7 day' + INTERVAL '23 hour 59 minute 59.999 second' AS end_7_days,
      DATE_TRUNC('day', NOW()) + INTERVAL '2 day' + INTERVAL '23 hour 59 minute 59.999 second' AS end_2_days,
      DATE_TRUNC('month', NOW()) AS start_month,
      DATE_TRUNC('month', NOW()) + INTERVAL '1 month' - INTERVAL '1 millisecond' AS end_month,
      DATE_TRUNC('day', NOW()) + INTERVAL '1 day' - INTERVAL '1 millisecond' AS end_today
  ),
  member_stats AS (
    SELECT
      COUNT(*)::int AS total_members,
      COUNT(*) FILTER (
        WHERE m.is_inactive = false AND m.expiry_date > b.now_ts
      )::int AS active_members,
      COUNT(*) FILTER (
        WHERE m.is_inactive = false AND m.expiry_date < b.now_ts
      )::int AS expired_members,
      COUNT(*) FILTER (
        WHERE m.is_inactive = false AND m.expiry_date >= b.start_today AND m.expiry_date <= b.end_7_days
      )::int AS expiring_7_days,
      COUNT(*) FILTER (
        WHERE m.is_inactive = false AND m.expiry_date >= b.start_today AND m.expiry_date <= b.end_2_days
      )::int AS expiring_2_days,
      COUNT(*) FILTER (
        WHERE m.is_inactive = false AND m.payment_method IS NULL
      )::int AS pending_members
    FROM public.members m
    CROSS JOIN bounds b
    WHERE m.gym_id = p_gym_id
  ),
  payment_stats AS (
    SELECT
      COALESCE(SUM(p.amount) FILTER (
        WHERE p.status = 'paid' AND p.created_at >= b.start_month AND p.created_at <= b.end_month
      ), 0)::float8 AS monthly_revenue,
      COALESCE(SUM(p.amount) FILTER (
        WHERE p.status = 'paid' AND p.created_at >= b.start_today AND p.created_at <= b.end_today
      ), 0)::float8 AS today_revenue
    FROM public.payments p
    CROSS JOIN bounds b
    WHERE p.gym_id = p_gym_id
  ),
  attendance_stats AS (
    SELECT
      COUNT(*)::int AS today_checkins
    FROM public.attendances a
    CROSS JOIN bounds b
    WHERE a.gym_id = p_gym_id
      AND a.checkin_at >= b.start_today
      AND a.checkin_at <= b.end_today
  )
  SELECT json_build_object(
    'totalMembers', ms.total_members,
    'activeMembers', ms.active_members,
    'expired', ms.expired_members,
    'expiring7', ms.expiring_7_days,
    'expiring2', ms.expiring_2_days,
    'pendingMembers', ms.pending_members,
    'monthlyRevenue', ps.monthly_revenue,
    'todayRevenue', ps.today_revenue,
    'todayCheckins', ats.today_checkins
  )
  FROM member_stats ms
  CROSS JOIN payment_stats ps
  CROSS JOIN attendance_stats ats;
$$;

CREATE INDEX IF NOT EXISTS members_gym_id_is_inactive_expiry_date_idx
  ON public.members (gym_id, is_inactive, expiry_date);

CREATE INDEX IF NOT EXISTS members_gym_id_payment_method_idx
  ON public.members (gym_id, payment_method);

CREATE INDEX IF NOT EXISTS members_gym_id_is_inactive_created_at_idx
  ON public.members (gym_id, is_inactive, created_at);

CREATE INDEX IF NOT EXISTS members_gym_id_inactive_since_idx
  ON public.members (gym_id, inactive_since);

CREATE INDEX IF NOT EXISTS members_gym_id_is_inactive_inactive_since_idx
  ON public.members (gym_id, is_inactive, inactive_since);

CREATE INDEX IF NOT EXISTS payments_gym_id_status_created_at_idx
  ON public.payments (gym_id, status, created_at);

CREATE INDEX IF NOT EXISTS payments_gym_id_member_id_created_at_idx
  ON public.payments (gym_id, member_id, created_at);

CREATE INDEX IF NOT EXISTS attendances_gym_id_checkin_at_member_id_idx
  ON public.attendances (gym_id, checkin_at, member_id);
