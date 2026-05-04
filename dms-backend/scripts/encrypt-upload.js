// encrypt-upload.js
// CLI: encrypts a file, pins to IPFS via Pinata, registers vault on-chain.
//
// Usage:
//   node scripts/encrypt-upload.js --file ./secret.md --label "My Will"
//
// What it does:
//   1. Reads the file from disk
//   2. Generates a random AES-256 key
//   3. Encrypts the file with AES-256-GCM → cipherBlob
//   4. Encrypts the AES key with VAULT_PASSWORD → encryptedKey
//   5. Uploads cipherBlob to IPFS (Pinata) → gets CID
//   6. Calls registerVault(cid, encryptedKey, label) on the contract
//   7. Saves a local manifest JSON for your records

import 'dotenv/config';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { basename, resolve } from 'path';
import { ethers } from 'ethers';
import { program } from 'commander';
import { encryptFile, encryptBuffer } from './crypto-utils.js';

// ── CLI args ──────────────────────────────────────────────────────────────────
program
  .requiredOption('-f, --file <path>',   'Path to the file you want to encrypt')
  .requiredOption('-l, --label <label>', 'Human-readable label for this vault')
  .parse();

const opts = program.opts();
const FILE_PATH  = resolve(opts.file);
const VAULT_LABEL = opts.label;

// ── Validate env ──────────────────────────────────────────────────────────────
const REQUIRED = ['PRIVATE_KEY', 'RPC_URL', 'CONTRACT_ADDRESS', 'PINATA_JWT', 'VAULT_PASSWORD'];
for (const key of REQUIRED) {
  if (!process.env[key]) {
    console.error(`❌ Missing .env variable: ${key}`);
    process.exit(1);
  }
}

if (!existsSync(FILE_PATH)) {
  console.error(`❌ File not found: ${FILE_PATH}`);
  process.exit(1);
}

// ── ABI (minimal — only what we need) ────────────────────────────────────────
const ABI = [
  'function registerVault(string calldata _cid, bytes calldata _encryptedKey, string calldata _label) external',
  'function vaultCount() external view returns (uint256)',
];

// ── Upload to Pinata (IPFS) ───────────────────────────────────────────────────
async function uploadToPinata(data, filename) {
  const form = new FormData();
  form.set('file', new Blob([data]), filename);
  form.set('pinataOptions', JSON.stringify({ cidVersion: 1 }));
  form.set('pinataMetadata', JSON.stringify({ name: filename }));

  const response = await fetch('https://api.pinata.cloud/pinning/pinFileToIPFS', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.PINATA_JWT}`,
    },
    body: form,
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Pinata upload failed: ${err}`);
  }

  const result = await response.json();
  return result.IpfsHash; // This is the CID
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log('\n🔐 Dead Man\'s Switch — Encrypt & Upload\n');
  console.log(`📄 File:     ${FILE_PATH}`);
  console.log(`🏷️  Label:    ${VAULT_LABEL}`);

  // Step 1: Read file
  const fileData = readFileSync(FILE_PATH);
  console.log(`📦 File size: ${fileData.length} bytes`);

  // Step 2 & 3: Generate AES key + encrypt file
  console.log('\n[1/4] Encrypting file with AES-256-GCM...');
  const { cipherBlob, aesKey } = encryptFile(fileData);
  console.log(`      ✓ Encrypted. Cipher blob: ${cipherBlob.length} bytes`);
  console.log(`      ✓ AES key:   ${aesKey.toString('hex')}`);

  // Step 4: Encrypt AES key with VAULT_PASSWORD
  console.log('\n[2/4] Encrypting AES key with vault password...');
  const encryptedKey = encryptBuffer(aesKey, process.env.VAULT_PASSWORD);
  console.log(`      ✓ Encrypted key: ${encryptedKey.length} bytes`);

  // Step 5: Upload cipherBlob to IPFS via Pinata
  console.log('\n[3/4] Uploading encrypted file to IPFS via Pinata...');
  const filename = `dms-${basename(FILE_PATH)}-${Date.now()}.enc`;
  let cid;

  try {
    cid = await uploadToPinata(cipherBlob, filename);
    console.log(`      ✓ CID: ${cid}`);
    console.log(`      🌐 View: https://gateway.pinata.cloud/ipfs/${cid}`);
  } catch (err) {
    console.error(`      ❌ IPFS upload failed: ${err.message}`);
    console.error('      Tip: Check your PINATA_JWT in .env');
    process.exit(1);
  }

  // Step 6: Register on-chain
  console.log('\n[4/4] Registering vault on-chain...');
  const provider = new ethers.JsonRpcProvider(process.env.RPC_URL);
  const wallet   = new ethers.Wallet(process.env.PRIVATE_KEY, provider);
  const contract = new ethers.Contract(process.env.CONTRACT_ADDRESS, ABI, wallet);

  console.log(`      Wallet: ${wallet.address}`);
  console.log(`      Contract: ${process.env.CONTRACT_ADDRESS}`);

  // Convert encryptedKey Buffer to hex bytes for Solidity 'bytes' param
  const encryptedKeyHex = '0x' + encryptedKey.toString('hex');

  try {
    const tx = await contract.registerVault(cid, encryptedKeyHex, VAULT_LABEL);
    console.log(`      ⏳ Tx sent: ${tx.hash}`);
    const receipt = await tx.wait();
    console.log(`      ✓ Confirmed in block ${receipt.blockNumber}`);
  } catch (err) {
    console.error(`      ❌ Transaction failed: ${err.message}`);
    if (err.message.includes('not the owner')) {
      console.error('      Tip: PRIVATE_KEY in .env must match the contract owner wallet');
    }
    process.exit(1);
  }

  // Step 7: Get vault ID
  const vaultId = Number(await contract.vaultCount()) - 1;

  // Step 8: Save local manifest
  mkdirSync('./manifests', { recursive: true });
  const manifest = {
    vaultId,
    label:        VAULT_LABEL,
    originalFile: FILE_PATH,
    cid,
    ipfsUrl:      `https://gateway.pinata.cloud/ipfs/${cid}`,
    contractAddress: process.env.CONTRACT_ADDRESS,
    encryptedAt:  new Date().toISOString(),
    note: 'encryptedKey is stored on-chain. Share VAULT_PASSWORD with your beneficiaries.'
  };

  const manifestPath = `./manifests/vault-${vaultId}.json`;
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

  console.log('\n✅ Vault registered successfully!');
  console.log('─'.repeat(50));
  console.log(`  Vault ID:   ${vaultId}`);
  console.log(`  Label:      ${VAULT_LABEL}`);
  console.log(`  CID:        ${cid}`);
  console.log(`  Manifest:   ${manifestPath}`);
  console.log('─'.repeat(50));
  console.log('\n⚠️  IMPORTANT: Share your VAULT_PASSWORD with your beneficiaries');
  console.log('   They will need it + their whitelisted wallet to decrypt after release.\n');
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
