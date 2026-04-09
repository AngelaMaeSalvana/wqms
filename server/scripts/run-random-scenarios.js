/**
 * Run random node test scenarios for a given duration.
 * Usage:
 *   node scripts/run-random-scenarios.js [--minutes N]
 *   node scripts/run-random-scenarios.js --until-end-of-day
 *   node scripts/run-random-scenarios.js --test-run-id <uuid> [--node node1]
 * Default: 10 minutes, 1 scenario per minute.
 */
const { spawn } = require('child_process');
const path = require('path');

const SCENARIOS = [
  'normal', 'low-do', 'medium-do', 'high-do',
  'low-ph', 'medium-ph', 'high-ph',
  'low-turbidity', 'medium-turbidity', 'high-turbidity',
  'low-temp', 'high-temp', 'low-nh3', 'high-nh3',
  'multi-param', 'all-clear', 'wqi-drop', 'persistence'
];

function getMinutesUntilEndOfDay() {
  const now = new Date();
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(0, 0, 0, 0);
  const ms = tomorrow.getTime() - now.getTime();
  return Math.max(1, Math.ceil(ms / 60000));
}

const args = process.argv.slice(2);
const untilEndOfDay = args.includes('--until-end-of-day');
const minutesIdx = args.indexOf('--minutes');
const testRunIdIdx = args.indexOf('--test-run-id');
const nodeIdx = args.indexOf('--node');
let durationMinutes = minutesIdx !== -1 && args[minutesIdx + 1]
  ? Math.max(1, parseInt(args[minutesIdx + 1], 10))
  : 10;
const testRunId = testRunIdIdx !== -1 ? args[testRunIdIdx + 1] : null;
const nodeArg = nodeIdx !== -1 ? args[nodeIdx + 1] : null;
if (untilEndOfDay) {
  durationMinutes = getMinutesUntilEndOfDay();
  console.log(`[RandomScenarios] --until-end-of-day: ${durationMinutes} minutes remaining today.\n`);
}

const intervalSeconds = 60;
const scriptPath = path.join(__dirname, 'test.js');

console.log(`[RandomScenarios] Running for ${durationMinutes} minutes, 1 scenario per ${intervalSeconds}s\n`);

let count = 0;
const runOne = () => {
  const scenario = SCENARIOS[Math.floor(Math.random() * SCENARIOS.length)];
  const time = new Date().toLocaleTimeString();
  console.log(`[${time}] #${count + 1} scenario: ${scenario}`);
  const spawnArgs = [scriptPath, '--scenario', scenario];
  if (testRunId) spawnArgs.push('--test-run-id', testRunId);
  if (nodeArg) spawnArgs.push('--node', nodeArg);
  const child = spawn(process.execPath, spawnArgs, {
    cwd: path.join(__dirname, '..'),
    stdio: 'inherit'
  });
  child.on('close', (code) => {
    if (code !== 0) console.warn(`[RandomScenarios] Scenario exited with code ${code}`);
  });
  count++;
};

// Run first immediately, then every intervalSeconds
runOne();
const interval = setInterval(runOne, intervalSeconds * 1000);

// Stop after duration
setTimeout(() => {
  clearInterval(interval);
  console.log(`\n[RandomScenarios] Done. Ran ${count} scenarios over ${durationMinutes} minutes.`);
  process.exit(0);
}, durationMinutes * 60 * 1000);
