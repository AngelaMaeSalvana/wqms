/**
 * Run random node test scenarios for a given duration.
 * Usage: node scripts/run-random-scenarios.js [--minutes N]
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

const args = process.argv.slice(2);
const minutesIdx = args.indexOf('--minutes');
const durationMinutes = minutesIdx !== -1 && args[minutesIdx + 1]
  ? Math.max(1, parseInt(args[minutesIdx + 1], 10))
  : 10;

const intervalSeconds = 60;
const scriptPath = path.join(__dirname, 'test.js');

console.log(`[RandomScenarios] Running for ${durationMinutes} minutes, 1 scenario per ${intervalSeconds}s\n`);

let count = 0;
const runOne = () => {
  const scenario = SCENARIOS[Math.floor(Math.random() * SCENARIOS.length)];
  const time = new Date().toLocaleTimeString();
  console.log(`[${time}] #${count + 1} scenario: ${scenario}`);
  const child = spawn(process.execPath, [scriptPath, '--scenario', scenario], {
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
