const prisma = require("../utils/prisma");
const { invalidateDashboardCache } = require("./dashboardController");
const { measureAsync } = require("../utils/performance");

function dayWindowUtc(date) {
  const start = new Date(date);
  start.setUTCHours(0, 0, 0, 0);
  const end = new Date(date);
  end.setUTCHours(23, 59, 59, 999);
  return { start, end };
}

const checkin = async (req, res) => {
  try {
    const gym_id = req.gym_id;
    const { member_id } = req.body;
    if (!member_id) return res.status(400).json({ error: "member_id required" });

    const member = await prisma.members.findFirst({
      where: { id: member_id, gym_id },
      select: { id: true, gym_id: true },
    });
    if (!member) return res.status(404).json({ error: "Member not found" });

    const [attendance] = await prisma.$transaction([
      prisma.attendances.create({
        data: { gym_id, member_id },
      }),
      prisma.members.update({
        where: { id: member_id },
        data: { is_inactive: false, inactive_since: null },
      }),
    ]);

    invalidateDashboardCache(gym_id);
    res.json({ attendance });
  } catch (err) {
    console.error(err);
    res.status(500).json({
      error: "Failed to check in",
      details: process.env.NODE_ENV !== "production" ? err.message : undefined,
    });
  }
};

const getDailySummary = async (req, res) => {
  try {
    const gym_id = req.gym_id;
    const date = req.query.date ? new Date(String(req.query.date)) : new Date();
    const { start, end } = dayWindowUtc(date);

    const rows = await measureAsync(
      "attendance.daily-summary-query",
      { gym_id, date: start.toISOString().slice(0, 10) },
      async () =>
        prisma.$queryRaw`
          SELECT
            m.id AS member_id,
            COUNT(a.id)::int AS attendance_count,
            MAX(a.checkin_at) AS last_checkin
          FROM public.members m
          INNER JOIN public.attendances a
            ON a.member_id = m.id
           AND a.gym_id = ${gym_id}
           AND a.checkin_at >= ${start}
           AND a.checkin_at <= ${end}
           AND a.checkin_at >= m.start_date
          WHERE m.gym_id = ${gym_id}
          GROUP BY m.id
        `,
    );

    const byMember = {};
    let total = 0;

    for (const row of rows || []) {
      const count = Number(row.attendance_count || 0);
      if (!count) continue;

      byMember[row.member_id] = {
        count,
        lastCheckin: row.last_checkin,
      };
      total += count;
    }

    res.json({ date: start.toISOString().slice(0, 10), total, byMember });
  } catch (err) {
    console.error(err);
    res.status(500).json({
      error: "Failed to load attendance summary",
      details: process.env.NODE_ENV !== "production" ? err.message : undefined,
    });
  }
};

module.exports = { checkin, getDailySummary };
