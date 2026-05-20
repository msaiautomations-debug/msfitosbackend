const prisma = require('../utils/prisma');

function formatTypeLabel(type) {
  const raw = String(type || 'notification').trim();
  if (!raw) return 'Notification';
  return raw
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function inferChannel(type) {
  const value = String(type || '').toLowerCase();
  if (value.includes('whatsapp')) return 'whatsapp';
  if (value.includes('email')) return 'email';
  return 'notification';
}

function normalizePayload(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return {};
  return payload;
}

const listNotifications = async (req, res) => {
  try {
    const gym_id = req.gym_id;
    const limit = Math.min(parseInt(req.query.limit || '50', 10), 200);
    const offset = Math.max(parseInt(req.query.offset || '0', 10), 0);
    const windowSize = Math.min(limit + offset, 200);

    const [gymNotifications, emailNotifications] = await Promise.all([
      prisma.gym_notifications.findMany({
        where: { gym_id },
        orderBy: { sent_at: 'desc' },
        take: windowSize,
        include: {
          member: {
            select: { id: true, name: true, phone: true, email: true },
          },
        },
      }),
      prisma.email_notifications.findMany({
        where: { gym_id },
        orderBy: { sent_at: 'desc' },
        take: windowSize,
      }),
    ]);

    const memberIdsFromEmailLogs = Array.from(
      new Set(
        emailNotifications
          .map((entry) => {
            const payload = normalizePayload(entry.payload);
            return String(payload.member_id || '').trim();
          })
          .filter(Boolean),
      ),
    );

    const emailLogMembers = memberIdsFromEmailLogs.length
      ? await prisma.members.findMany({
          where: { gym_id, id: { in: memberIdsFromEmailLogs } },
          select: { id: true, name: true, phone: true, email: true },
        })
      : [];

    const membersById = new Map(emailLogMembers.map((member) => [member.id, member]));

    const merged = [
      ...gymNotifications.map((entry) => ({
        id: `gym:${entry.id}`,
        source: 'gym_notification',
        channel: inferChannel(entry.type),
        type: entry.type,
        type_label: formatTypeLabel(entry.type),
        status: entry.status,
        subject: entry.message || null,
        message: entry.message || null,
        error_message: null,
        sent_at: entry.sent_at,
        member: entry.member
          ? {
              id: entry.member.id,
              name: entry.member.name,
              phone: entry.member.phone || '',
              email: entry.member.email || '',
            }
          : null,
        payload: null,
      })),
      ...emailNotifications.map((entry) => {
        const payload = normalizePayload(entry.payload);
        const memberId = String(payload.member_id || '').trim();
        const linkedMember = memberId ? membersById.get(memberId) : null;
        return {
          id: `email:${entry.id}`,
          source: 'email_notification',
          channel: 'email',
          type: entry.type,
          type_label: formatTypeLabel(entry.type),
          status: entry.status,
          subject: entry.subject || null,
          message:
            entry.error_message ||
            String(payload.custom_message || payload.preview_text || payload.member_name || '').trim() ||
            null,
          error_message: entry.error_message || null,
          sent_at: entry.sent_at,
          member:
            linkedMember || payload.member_name || payload.email
              ? {
                  id: linkedMember?.id || memberId || '',
                  name: linkedMember?.name || String(payload.member_name || 'Member'),
                  phone: linkedMember?.phone || '',
                  email: linkedMember?.email || String(payload.email || ''),
                }
              : null,
          payload,
        };
      }),
    ]
      .sort((a, b) => new Date(b.sent_at).getTime() - new Date(a.sent_at).getTime())
      .slice(offset, offset + limit);

    res.json({ notifications: merged, limit, offset });
  } catch (err) {
    console.error(err);
    res.status(500).json({
      error: 'Failed to load notifications',
      details: process.env.NODE_ENV !== 'production' ? err.message : undefined,
    });
  }
};

module.exports = { listNotifications };
