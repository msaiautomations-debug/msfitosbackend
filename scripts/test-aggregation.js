require('dotenv').config();
const { backfillHistoricalData, runNightlyAggregation } = require('../services/aggregationService');
const prisma = require('../utils/prisma');

async function test() {
  try {
    console.log('--- Starting Aggregation & Backfill Script ---');
    
    // 1. Run backfill for the last 30 days to ensure charts are populated
    console.log('Running 30-day historical backfill...');
    await backfillHistoricalData(30);
    
    // 2. Run nightly aggregation job
    console.log('Running nightly aggregation job...');
    await runNightlyAggregation();

    // 3. Verify counts in each of the 9 precomputed tables
    console.log('--- Verifying Precomputed Tables ---');
    
    const tables = [
      'gym_revenue_daily',
      'gym_plan_performance',
      'gym_attendance_daily',
      'member_attendance_risk',
      'trial_funnel_daily',
      'trainer_performance_monthly',
      'lead_funnel_daily',
      'notification_health_daily',
      'gym_renewal_queue'
    ];

    for (const table of tables) {
      const count = await prisma[table].count();
      console.log(`Table "${table}": ${count} records precomputed.`);
    }

    console.log('--- Aggregation Script Completed Successfully ---');
  } catch (err) {
    console.error('Aggregation script failed:', err);
  } finally {
    await prisma.$disconnect();
    process.exit(0);
  }
}

test();
