/* eslint-disable no-console */
const axios = require("axios");

const API_BASE = process.env.API_BASE || "http://localhost:5000";
const PASSWORD = process.env.PASSWORD || "LoadTest@123";
const GYM_PREFIX = process.env.GYM_PREFIX || "loadtest+";
const GYM_DOMAIN = process.env.GYM_DOMAIN || "example.com";
const GYM_COUNT = Number(process.env.GYM_COUNT || 50);
const CONCURRENCY = Number(process.env.CONCURRENCY || 5);
const DASHBOARD_PATH = process.env.DASHBOARD_PATH || "/api/dashboard/bootstrap";

function pad2(n) {
  return String(n).padStart(2, "0");
}

async function loginAndFetchDashboard(email, password) {
  const t0 = Date.now();
  const loginResp = await axios.post(`${API_BASE}/api/auth/gym-login`, { email, password });
  let token = loginResp.data?.token;
  const t1 = Date.now();
  if (!token) throw new Error("Missing token");

  try {
    await axios.get(`${API_BASE}${DASHBOARD_PATH}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
  } catch (err) {
    if (err?.response?.status === 401) {
      const retryLogin = await axios.post(`${API_BASE}/api/auth/gym-login`, { email, password });
      token = retryLogin.data?.token;
      if (!token) throw err;
      await axios.get(`${API_BASE}${DASHBOARD_PATH}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
    } else {
      throw err;
    }
  }
  const t2 = Date.now();

  return {
    email,
    loginMs: t1 - t0,
    dashboardMs: t2 - t1,
    totalMs: t2 - t0,
  };
}

async function runPool(tasks, concurrency) {
  const results = [];
  let index = 0;

  async function worker() {
    while (index < tasks.length) {
      const i = index++;
      try {
        const res = await tasks[i].run();
        results.push({ ok: true, ...res });
      } catch (err) {
        const status = err?.response?.status;
        const data = err?.response?.data;
        results.push({
          email: tasks[i].email,
          ok: false,
          error: err?.message || String(err),
          status,
          data,
        });
      }
    }
  }

  const workers = Array.from({ length: Math.max(1, concurrency) }, () => worker());
  await Promise.all(workers);
  return results;
}

function percentile(values, p) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(sorted.length - 1, idx))];
}

async function main() {
  const emails = Array.from({ length: GYM_COUNT }).map(
    (_, i) => `${GYM_PREFIX}${pad2(i + 1)}@${GYM_DOMAIN}`,
  );

  const tasks = emails.map((email) => ({
    email,
    run: () => loginAndFetchDashboard(email, PASSWORD),
  }));

  console.log(`Running ${GYM_COUNT} gyms with concurrency=${CONCURRENCY} against ${DASHBOARD_PATH}`);
  const start = Date.now();
  const results = await runPool(tasks, CONCURRENCY);
  const totalMs = Date.now() - start;

  const ok = results.filter((r) => r.ok);
  const failed = results.filter((r) => !r.ok);

  const loginTimes = ok.map((r) => r.loginMs);
  const dashTimes = ok.map((r) => r.dashboardMs);
  const totalTimes = ok.map((r) => r.totalMs);

  console.log(`Completed in ${totalMs} ms`);
  console.log(`Success: ${ok.length}, Failed: ${failed.length}`);
  if (failed.length) {
    console.log(
      "Sample errors:",
      failed.slice(0, 5).map((f) => ({ email: f.email, error: f.error, status: f.status, data: f.data })),
    );
  }

  console.log("Login ms: avg", Math.round(loginTimes.reduce((a, b) => a + b, 0) / (loginTimes.length || 1)));
  console.log("Login p95:", percentile(loginTimes, 95), "ms");
  console.log("Dashboard ms: avg", Math.round(dashTimes.reduce((a, b) => a + b, 0) / (dashTimes.length || 1)));
  console.log("Dashboard p95:", percentile(dashTimes, 95), "ms");
  console.log("Total ms: avg", Math.round(totalTimes.reduce((a, b) => a + b, 0) / (totalTimes.length || 1)));
  console.log("Total p95:", percentile(totalTimes, 95), "ms");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
