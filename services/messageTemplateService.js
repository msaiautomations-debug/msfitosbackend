function renderTemplate(template, variables) {
  const input = String(template ?? "");
  return input.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_, key) => {
    const value = variables?.[key];
    return value === undefined || value === null ? "" : String(value);
  });
}

function formatDateForMessage(date) {
  try {
    const d = new Date(date);
    if (Number.isNaN(d.getTime())) return "";
    return d.toLocaleDateString("en-IN", { year: "numeric", month: "short", day: "2-digit" });
  } catch {
    return "";
  }
}

module.exports = { renderTemplate, formatDateForMessage };

