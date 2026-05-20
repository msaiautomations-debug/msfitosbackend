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
  )
  SELECT json_build_object(
    'totalMembers', ms.total_members,
    'activeMembers', ms.active_members,
    'expired', ms.expired_members,
    'expiring7', ms.expiring_7_days,
    'expiring2', ms.expiring_2_days,
    'pendingMembers', ms.pending_members,
    'monthlyRevenue', ps.monthly_revenue,
    'todayRevenue', ps.today_revenue
  )
  FROM member_stats ms
  CROSS JOIN payment_stats ps;
$$;

CREATE OR REPLACE FUNCTION public.get_revenue_analytics(
  p_gym_id text,
  p_from timestamptz,
  p_to timestamptz
)
RETURNS json
LANGUAGE sql
STABLE
AS $$
  SELECT json_build_object(
    'from', p_from,
    'to', p_to,
    'totalRevenue', COALESCE(SUM(amount), 0)::float8,
    'paymentsCount', COUNT(*)::int
  )
  FROM public.payments
  WHERE gym_id = p_gym_id
    AND status = 'paid'
    AND created_at >= p_from
    AND created_at <= p_to;
$$;
