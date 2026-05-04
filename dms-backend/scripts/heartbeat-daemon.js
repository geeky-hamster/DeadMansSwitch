// heartbeat-daemon.js
// Automatically sends heartbeat() transactions on a schedule.
// Warns loudly when deadline is approaching.
//
// Usage: node scripts/heartbeat-daemon.js
// Keep this running in a background terminal or tmux session.

import 'dotenv/config';
import cron from 'node-cron';
import { ethers } from 'ethers';
import { writeFileSync, readFileSync, existsSync } from 'fs';

// ── Config ────────────────────────────────────────────────────────────────────
// How often to send a heartbeat.
// Should be MORE frequent than the contract interval.
// e.g. if interval is 7 days (604800s), send heartbeat every 5 days.
// For testing with interval=300s (5 min), send every 3 minutes.
const CRON_SCHEDULE = process.env.HEARTBEAT_CRON || '*/3 * * * *'; // every 3 min (testing)
// Production: '0 9 */5 * *'  → 9am every 5 days

const LOG_FILE = './heartbeat-log.json';

// Module-level references (initialized in startup)
let provider, wallet, contract, cronTask;

// ── ABI ───────────────────────────────────────────────────────────────────────
const ABI = [
  'function heartbeat() external',
  'function timeRemaining() external view returns (uint256)',
  'function isExpired() external view returns (bool)',
  'function triggered() external view returns (bool)',
  'function owner() external view returns (address)',
];

// ── Logger ────────────────────────────────────────────────────────────────────
function loadLog() {
  if (!existsSync(LOG_FILE)) return [];
  try { return JSON.parse(readFileSync(LOG_FILE, 'utf8')); }
  catch { return []; }
}

function saveLog(entry) {
  const log = loadLog();
  log.push(entry);
  // Keep last 200 entries
  if (log.length > 200) log.splice(0, log.length - 200);
  writeFileSync(LOG_FILE, JSON.stringify(log, null, 2));
}

// ── Alert ─────────────────────────────────────────────────────────────────────
function alert(msg) {
  // In production you'd send an email, SMS, or push notification here.
  // For the demo we just log loudly.
  console.error('\n' + '⚠️ '.repeat(20));
  console.error(`ALERT: ${msg}`);
  console.error('⚠️ '.repeat(20) + '\n');
}

// ── Retry wrapper ─────────────────────────────────────────────────────────────
async function withRetry(fn, retries = 3) {
  for (let i = 0; i < retries; i++) {
    try {
      return await fn();
    } catch (err) {
      if (i === retries - 1) throw err;
      const wait = (2 ** i) * 3000; // 3s, 6s, 12s
      console.log(`      Retry ${i + 1}/${retries} in ${wait / 1000}s...`);
      await new Promise(r => setTimeout(r, wait));
    }
  }
}

// ── Main heartbeat job ────────────────────────────────────────────────────────
async function sendHeartbeat() {
  const timestamp = new Date().toISOString();
  console.log(`\n[${timestamp}] Running heartbeat check...`);

  // Check if already triggered
  const triggered = await contract.triggered();
  if (triggered) {
    alert('SWITCH IS TRIGGERED. Stopping daemon. Beneficiaries can now read the vaults.');
    if (cronTask) cronTask.stop();
    process.exit(0);
    return;
  }

  // Check time remaining
  const remaining = await contract.timeRemaining();
  const remainingMins = Number(remaining) / 60;
  console.log(`  ⏰ Time remaining: ${remainingMins.toFixed(1)} minutes`);

  if (Number(remaining) < 60 * 60) { // Less than 1 hour
    alert(`CRITICAL: Only ${remainingMins.toFixed(0)} minutes until switch triggers!`);
  } else if (Number(remaining) < 60 * 60 * 24) { // Less than 24 hours
    alert(`WARNING: Less than 24 hours until switch triggers (${remainingMins.toFixed(0)} min remaining)`);
  }

  // Send heartbeat
  try {
    const tx = await withRetry(async () => {
      const t = await contract.heartbeat();
      return t;
    });

    console.log(`  📡 Tx sent: ${tx.hash}`);
    const receipt = await tx.wait();
    console.log(`  ✅ Heartbeat confirmed in block ${receipt.blockNumber}`);

    saveLog({
      timestamp,
      txHash:      tx.hash,
      blockNumber: receipt.blockNumber,
      gasUsed:     receipt.gasUsed.toString(),
      success:     true,
    });

  } catch (err) {
    console.error(`  ❌ Heartbeat FAILED: ${err.message}`);
    saveLog({ timestamp, error: err.message, success: false });
    alert(`Heartbeat failed: ${err.message}`);
  }
}

// ── Startup ───────────────────────────────────────────────────────────────────
async function startup() {
  console.log('\n💓 Dead Man\'s Switch — Heartbeat Daemon');
  console.log(`   Contract:  ${process.env.CONTRACT_ADDRESS}`);
  console.log(`   Schedule:  ${CRON_SCHEDULE}`);
  console.log(`   Log file:  ${LOG_FILE}`);
  console.log('\nSending first heartbeat immediately...');

  // Initialize module-level connection (reused by all heartbeat calls)
  provider = new ethers.JsonRpcProvider(process.env.RPC_URL);
  wallet   = new ethers.Wallet(process.env.PRIVATE_KEY, provider);
  contract = new ethers.Contract(process.env.CONTRACT_ADDRESS, ABI, wallet);
  const owner = await contract.owner();

  if (owner.toLowerCase() !== wallet.address.toLowerCase()) {
    console.error(`\n❌ Wallet mismatch!`);
    console.error(`   Contract owner: ${owner}`);
    console.error(`   Your wallet:    ${wallet.address}`);
    console.error('   Set PRIVATE_KEY to the contract owner\'s key.\n');
    process.exit(1);
  }

  console.log(`   Wallet:    ${wallet.address} ✓\n`);

  // Send one heartbeat immediately on startup
  await sendHeartbeat();

  // Schedule future heartbeats
  cronTask = cron.schedule(CRON_SCHEDULE, sendHeartbeat);
  console.log(`\n🕐 Daemon running. Next heartbeat per schedule: ${CRON_SCHEDULE}`);
  console.log('   Press Ctrl+C to stop.\n');
}

startup().catch(err => {
  console.error('Fatal startup error:', err);
  process.exit(1);
});
