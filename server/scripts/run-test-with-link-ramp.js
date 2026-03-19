/**
 * End-to-end simulated range test (test run + link-quality ramp).
 *
 * Flow:
 * 1) POST /api/test-run/start with durationMs + intervalMs (defaults: 9 min, 5s)
 * 2) Run run-link-ramp.js for the same duration, passing --test-run-id
 * 3) POST /api/test-run/stop
 *
 * Usage:
 *   node scripts/run-test-with-link-ramp.js
 *   node scripts/run-test-with-link-ramp.js --minutes 9 --interval-seconds 5 --node node1
 *   node scripts/run-test-with-link-ramp.js --rssi-start -55 --rssi-end -115 --snr-start 12 --snr-end -10
 *
 * Requires: server running (npm start), bridge running (npm run bridge)
 */
const { spawn } = require('child_process');
const path = require('path');

const API_BASE = process.env.API_BASE || 'http://localhost:5000/api';
const args = process.argv.slice(2);

function getArg(name, fallback = null) {
  const idx = args.indexOf(name);
  return idx !== -1 ? args[idx + 1] : fallback;
}

const minutes = Math.max(1, parseInt(getArg('--minutes', '9'), 10) || 9);
const intervalSeconds = Math.max(1, parseInt(getArg('--interval-seconds', '5'), 10) || 5);
const nodeArg = getArg('--node', 'node1');

const durationMs = minutes * 60 * 1000;
const intervalMs = intervalSeconds * 1000;

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
  // If the run already expired naturally, the backend returns 404 "No active test run".
  // Treat that as a successful end-state for this wrapper.
  if (res.status === 404) return { ok: true, test_run_id: testRunId, status: 'expired' };
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `stop failed: ${res.status}`);
  }
  return res.json();
}

function runRamp(testRunId) {
  return new Promise((resolve, reject) => {
    const scriptPath = path.join(__dirname, 'run-link-ramp.js');
    const passThrough = [];
    for (let i = 0; i < args.length; i++) {
      const a = args[i];
      // We'll always force these so cadence matches the test run window
      if (a === '--minutes' || a === '--interval-seconds' || a === '--test-run-id') {
        i++; // skip value
        continue;
      }
      passThrough.push(a);
      // If option expects a value, include it as well
      if (a.startsWith('--') && i + 1 < args.length && !args[i + 1].startsWith('--')) {
        passThrough.push(args[i + 1]);
        i++;
      }
    }

    const childArgs = [
      scriptPath,
      '--minutes', String(minutes),
      '--interval-seconds', String(intervalSeconds),
      '--node', String(nodeArg),
      '--test-run-id', String(testRunId),
      ...passThrough,
    ];

    const child = spawn(process.execPath, childArgs, {
      cwd: path.join(__dirname, '..'),
      stdio: 'inherit',
    });
    child.on('close', (code) => {
      if (code !== 0) reject(new Error(`link ramp exited with code ${code}`));
      else resolve();
    });
  });
}

async function main() {
  console.log(`[RunTestWithLinkRamp] Duration: ${minutes} min, interval: ${intervalSeconds}s, node: ${nodeArg}`);
  console.log('[RunTestWithLinkRamp] Ensure bridge and server are running before starting.\n');

  let run;
  try {
    run = await startTestRun();
    console.log(`[RunTestWithLinkRamp] Test run started: ${run.test_run_id}\n`);
  } catch (e) {
    console.error('[RunTestWithLinkRamp] Failed to start test run:', e.message);
    process.exit(1);
  }

  const runId = run.test_run_id;

  try {
    await runRamp(runId);
  } catch (e) {
    console.warn('[RunTestWithLinkRamp] Ramp error:', e.message);
  }

  try {
    await stopTestRun(runId);
    console.log(`\n[RunTestWithLinkRamp] Test run stopped: ${runId}`);
  } catch (e) {
    console.warn('[RunTestWithLinkRamp] Stop failed (run may have expired):', e.message);
  }

  console.log(`\n[RunTestWithLinkRamp] Done. Check Reports > Test Runs for run ${runId}`);
  process.exit(0);
}

main().catch((err) => {
  console.error('[RunTestWithLinkRamp] Error:', err);
  process.exit(1);
});

