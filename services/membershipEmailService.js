const PLACEHOLDER_PATTERN = /\{(member_name|gym_name|expiry_date|amount_due|last_checkin_date)\}/g;

function formatMembershipEmailDate(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(date);
}

function formatMembershipAmount(value) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(Number(value || 0));
}

function interpolateMembershipTemplate(template, data) {
  return String(template || "").replace(PLACEHOLDER_PATTERN, (_, key) => String(data[key] ?? ""));
}

function getMembershipEmailTemplate(settings, type) {
  const normalizedType = type === "expired" ? "expired" : "expiring";
  if (normalizedType === "expired") {
    return {
      subject: settings?.email_subject_expired,
      body: settings?.email_body_expired,
    };
  }

  return {
    subject: settings?.email_subject_expiring,
    body: settings?.email_body_expiring,
  };
}

function renderMembershipEmail({ template, member, gymName }) {
  const replacements = {
    member_name: member?.name || "Member",
    gym_name: gymName || "Your gym",
    expiry_date: formatMembershipEmailDate(member?.expiry_date),
    amount_due: formatMembershipAmount(member?.amount),
    last_checkin_date: formatMembershipEmailDate(member?.last_checkin_date),
  };

  const subject = interpolateMembershipTemplate(template?.subject, replacements);
  const text = interpolateMembershipTemplate(template?.body, replacements);
  const html = `
    <div style="font-family:Arial,sans-serif;line-height:1.7;color:#E5E7EB;background:#0B0F1A;padding:24px;">
      <div style="max-width:640px;margin:0 auto;background:#111827;border:1px solid #1F2937;border-radius:16px;padding:24px;">
        <h2 style="margin:0 0 16px;color:#E5E7EB;">${subject}</h2>
        ${text
          .split("\n")
          .filter(Boolean)
          .map((line) => `<p style="margin:0 0 12px;color:#CBD5E1;">${line}</p>`)
          .join("")}
      </div>
    </div>
  `;

  return { subject, text, html };
}

module.exports = {
  formatMembershipEmailDate,
  formatMembershipAmount,
  getMembershipEmailTemplate,
  interpolateMembershipTemplate,
  renderMembershipEmail,
};
