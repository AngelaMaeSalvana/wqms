/**
 * Run a test run with random scenarios for automated validation.
 * 1. POST /api/test-run/start
 * 2. Run run-random-scenarios for the run duration
 * 3. POST /api/test-run/stop
 *
 * Usage:
 *   node scripts/run-test-with-scenarios.js [--minutes N] [--interval 60]
 *   node scripts/run-test-with-scenarios.js --minutes 5 --interval 60
 *
 * Requires: server running (npm start), bridge running (npm run bridge)
 */
const { spawn } = require('child_process');
const path = require('path');

const API_BASE = process.env.API_BASE || 'http://localhost:5000/api';
const args = process.argv.slice(2);
const minutesIdx = args.indexOf('--minutes');
const intervalIdx = args.indexOf('--interval');
const durationMinutes = minutesIdx !== -1 && args[minutesIdx + 1]
  ? Math.max(1, parseInt(args[minutesIdx + 1], 10))
  : 5;
const scenarioIntervalSec = intervalIdx !== -1 && args[intervalIdx + 1]
  ? Math.max(10, parseInt(args[intervalIdx + 1], 10))
  : 60;

const durationMs = durationMinutes * 60 * 1000;
const intervalMs = 48000; // Match typical TDMA cycle for test runs

async function startTestRun() {
  const res = await fetch(`${API_BASE}/test-run/start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ durationMs, intervalMs, nodeId: null }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `start failed: ${res.status}`);
  }
  return res.json();
}

async function stopTestRun(testRunId) {
  const res = await fetch(`${API_BASE}/test-run/stop`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ test_run_id: testRunId }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `stop failed: ${res.status}`);
  }
  return res.json();
}

function runScenarios(durationMinutes) {
  return new Promise((resolve, reject) => {
    const scriptPath = path.join(__dirname, 'run-random-scenarios.js');
    const child = spawn(process.execPath, [scriptPath, '--minutes', String(durationMinutes)], {
      cwd: path.join(__dirname, '..'),
      stdio: 'inherit',
    });
    child.on('close', (code) => {
      if (code !== 0) reject(new Error(`scenarios exited with code ${code}`));
      else resolve();
    });
  });
}

async function main() {
  console.log(`[RunTestWithScenarios] Duration: ${durationMinutes} min, scenario interval: ${scenarioIntervalSec}s\n`);
  console.log('[RunTestWithScenarios] Ensure bridge and server are running before starting.\n');

  let run;
  try {
    run = await startTestRun();
    console.log(`[RunTestWithScenarios] Test run started: ${run.test_run_id}\n`);
  } catch (e) {
    console.error('[RunTestWithScenarios] Failed to start test run:', e.message);
    process.exit(1);
  }

  const runId = run.test_run_id;

  try {
    await runScenarios(durationMinutes);
  } catch (e) {
    console.warn('[RunTestWithScenarios] Scenarios error:', e.message);
  }

  try {
    await stopTestRun(runId);
    console.log(`\n[RunTestWithScenarios] Test run stopped: ${runId}`);
  } catch (e) {
    console.warn('[RunTestWithScenarios] Stop failed (run may have expired):', e.message);
  }

  console.log(`\n[RunTestWithScenarios] Done. Check Reports > Test Runs for run ${runId}`);
  process.exit(0);
}

main().catch((err) => {
  console.error('[RunTestWithScenarios] Error:', err);
  process.exit(1);
});
