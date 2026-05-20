function formatMeta(meta = {}) {
  const entries = Object.entries(meta).filter(([, value]) => value !== undefined && value !== null && value !== '');
  if (!entries.length) return '';
  return ` ${entries.map(([key, value]) => `${key}=${value}`).join(' ')}`;
}

async function measureAsync(label, meta, fn) {
  const start = process.hrtime.bigint();

  try {
    return await fn();
  } finally {
    const elapsedMs = Number(process.hrtime.bigint() - start) / 1e6;
    console.info(`[perf] ${label} ${elapsedMs.toFixed(1)}ms${formatMeta(meta)}`);
  }
}

module.exports = {
  measureAsync,
};
