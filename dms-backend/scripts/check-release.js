// check-release.js
// Listens for SwitchTriggered event and releases all vaults.
// Also shows the decrypted key if run as a beneficiary.
//
// Usage:
//   node scripts/check-release.js            — listen mode (auto-release on trigger)
//   node scripts/check-release.js --read 0  — read mode (decrypt vault 0 now)

import 'dotenv/config';
import { ethers } from 'ethers';
import { program } from 'commander';
import { decryptBuffer, decryptFile } from './crypto-utils.js';

program
  .option('-r, --read <vaultId>', 'Read and decrypt a specific vault (after trigger)')
  .parse();

const opts = program.opts();

const ABI = [
  'function checkAndRelease(uint256 _vaultId) external',
  'function getDecryptionKey(uint256 _vaultId) external view returns (bytes)',
  'function getVaultInfo(uint256 _vaultId) external view returns (string cid, string label, bool released, uint256 createdAt)',
  'function isExpired() external view returns (bool)',
  'function triggered() external view returns (bool)',
  'function vaultCount() external view returns (uint256)',
  'function isBeneficiary(address) external view returns (bool)',
  'event SwitchTriggered(uint256 timestamp, uint256 vaultCount)',
  'event VaultReleased(uint256 indexed vaultId)',
];

async function releaseAllVaults(contract) {
  const count = Number(await contract.vaultCount());
  console.log(`\n📦 Releasing ${count} vault(s)...`);

  for (let i = 0; i < count; i++) {
    try {
      const info = await contract.getVaultInfo(i);
      if (info.released) {
        console.log(`  Vault ${i} (${info.label}): already released ✓`);
        continue;
      }
      const tx = await contract.checkAndRelease(i);
      console.log(`  Vault ${i} (${info.label}): tx ${tx.hash}`);
      await tx.wait();
      console.log(`  Vault ${i}: ✅ Released`);
    } catch (err) {
      console.error(`  Vault ${i}: ❌ ${err.message}`);
    }
  }
}

async function readVault(contract, vaultId) {
  console.log(`\n🔓 Reading vault ${vaultId}...`);

  // Check state
  const triggered = await contract.triggered();
  if (!triggered) {
    console.error('❌ Switch is not triggered yet. Vault is still locked.');
    process.exit(1);
  }

  const info = await contract.getVaultInfo(vaultId);
  if (!info.released) {
    console.error('❌ Vault not released yet. Call checkAndRelease() first.');
    process.exit(1);
  }

  console.log(`  Label:     ${info.label}`);
  console.log(`  CID:       ${info.cid}`);
  console.log(`  IPFS URL:  https://gateway.pinata.cloud/ipfs/${info.cid}`);

  // Get encrypted key from contract
  console.log('\n[1/3] Fetching encrypted key from contract...');
  const encryptedKeyHex = await contract.getDecryptionKey(vaultId);
  const encryptedKey    = Buffer.from(encryptedKeyHex.slice(2), 'hex'); // remove 0x
  console.log('      ✓ Encrypted key received');

  // Decrypt AES key with vault password
  if (!process.env.VAULT_PASSWORD) {
    console.error('❌ VAULT_PASSWORD not set in .env');
    process.exit(1);
  }

  console.log('\n[2/3] Decrypting AES key with vault password...');
  let aesKey;
  try {
    aesKey = decryptBuffer(encryptedKey, process.env.VAULT_PASSWORD);
    console.log(`      ✓ AES key recovered: ${aesKey.toString('hex')}`);
  } catch (err) {
    console.error('❌ Failed to decrypt AES key. Wrong VAULT_PASSWORD?');
    process.exit(1);
  }

  // Fetch ciphertext from IPFS
  console.log(`\n[3/3] Fetching encrypted file from IPFS...`);
  let cipherBlob;
  try {
    const response  = await fetch(`https://gateway.pinata.cloud/ipfs/${info.cid}`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const arrayBuf  = await response.arrayBuffer();
    cipherBlob      = Buffer.from(arrayBuf);
    console.log(`      ✓ Downloaded ${cipherBlob.length} bytes`);
  } catch (err) {
    console.error(`❌ IPFS fetch failed: ${err.message}`);
    console.error('   Try fetching directly: https://gateway.pinata.cloud/ipfs/' + info.cid);
    process.exit(1);
  }

  // Decrypt file
  console.log('\n🔓 Decrypting file...');
  let plaintext;
  try {
    plaintext = decryptFile(cipherBlob, aesKey);
  } catch (err) {
    console.error(`❌ Decryption failed: ${err.message}`);
    console.error('   The file may be corrupted or the AES key is wrong.');
    process.exit(1);
  }

  console.log('\n' + '═'.repeat(60));
  console.log('  DECRYPTED CONTENT:');
  console.log('═'.repeat(60));
  console.log(plaintext.toString('utf8'));
  console.log('═'.repeat(60));
  console.log(`\n✅ Vault ${vaultId} successfully decrypted.\n`);
}

async function listenMode(contract) {
  console.log('\n👂 Listening for SwitchTriggered event...');
  console.log('   (Leave this running. It will auto-release vaults on trigger.)\n');

  // Check if already triggered
  const alreadyTriggered = await contract.triggered();
  if (alreadyTriggered) {
    console.log('⚠️  Switch already triggered. Releasing all vaults now...');
    await releaseAllVaults(contract);
    console.log('\n✅ All vaults processed. Exiting.');
    process.exit(0);
    return;
  }

  async function handleTrigger(source) {
    console.log(`\n🚨 SWITCH TRIGGERED (detected via ${source})`);
    contract.removeAllListeners('SwitchTriggered');
    if (pollInterval) clearInterval(pollInterval);
    await releaseAllVaults(contract);
    console.log('\n✅ All vaults processed. Exiting.');
    process.exit(0);
  }

  // Listen for event
  contract.on('SwitchTriggered', async (timestamp, count) => {
    console.log(`   Triggered at ${new Date(Number(timestamp) * 1000).toISOString()}, ${count} vault(s)`);
    await handleTrigger('event');
  });

  // Also poll every minute in case we missed the event
  const pollInterval = setInterval(async () => {
    const triggered = await contract.triggered().catch(() => false);
    if (triggered) {
      await handleTrigger('polling');
    }
  }, 60_000);
}

async function main() {
  console.log('\n🔓 Dead Man\'s Switch — Release Watcher\n');

  const provider = new ethers.JsonRpcProvider(process.env.RPC_URL);
  const wallet   = new ethers.Wallet(process.env.PRIVATE_KEY, provider);
  const contract = new ethers.Contract(process.env.CONTRACT_ADDRESS, ABI, wallet);

  console.log(`  Wallet:   ${wallet.address}`);
  console.log(`  Contract: ${process.env.CONTRACT_ADDRESS}`);

  // Check if this wallet is a beneficiary
  const isBeneficiary = await contract.isBeneficiary(wallet.address);
  if (opts.read !== undefined) {
    if (!isBeneficiary) {
      console.error('\n❌ Your wallet is not a beneficiary. Cannot read vaults.');
      console.error('   Ask the owner to call addBeneficiary() with your address.');
      process.exit(1);
    }
    await readVault(contract, parseInt(opts.read));
  } else {
    await listenMode(contract);
  }
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
