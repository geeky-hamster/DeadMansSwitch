# 💀 Dead Man's Switch — Web3 Time Capsule

A decentralized Dead Man's Switch built on Ethereum that automatically releases encrypted files to beneficiaries when the owner stops sending periodic heartbeat transactions.

> **If you stop checking in, your secrets are released.**

---

## 🎯 What It Does

| Step | Action |
|------|--------|
| 1 | Owner deploys a smart contract with a heartbeat interval (e.g., 7 days) |
| 2 | Owner encrypts sensitive files and stores them on IPFS |
| 3 | Owner sends periodic "heartbeat" transactions to prove they're alive |
| 4 | Owner adds beneficiary wallet addresses to the whitelist |
| 5 | **If the owner misses a heartbeat deadline → vaults are released irreversibly** |
| 6 | Beneficiaries decrypt the files using a shared password |

---

## 🏗️ Architecture

```
┌──────────────────────────────────────────────────────────┐
│                    React Dashboard                        │
│  ┌─────────────┐  ┌─────────────┐  ┌──────────────────┐ │
│  │   Owner      │  │   Reader    │  │  Vault Uploader  │ │
│  │  Dashboard   │  │    View     │  │  (In-Browser     │ │
│  │  (Heartbeat, │  │  (Decrypt   │  │   Encryption)    │ │
│  │   Vaults,    │  │   Vaults)   │  │                  │ │
│  │   Benefic.)  │  │             │  │                  │ │
│  └──────┬───────┘  └──────┬──────┘  └────────┬─────────┘ │
│         │                 │                   │           │
│         └─────────┬───────┴───────────────────┘           │
│                   │  ethers.js + MetaMask                 │
└───────────────────┼──────────────────────────────────────┘
                    │
        ┌───────────┴───────────┐
        │  Ethereum Blockchain  │        ┌──────────────┐
        │  ┌─────────────────┐  │        │   IPFS       │
        │  │ DeadMansSwitch  │  │◄──────►│  (Pinata)    │
        │  │    Contract     │  │        │  Encrypted   │
        │  └─────────────────┘  │        │  File Blobs  │
        └───────────────────────┘        └──────────────┘
```

---

## 🔐 Security Model

**Two-Layer Encryption:**
1. **Layer 1:** Files encrypted with a random AES-256-GCM key → stored on IPFS
2. **Layer 2:** AES key encrypted with a shared password (PBKDF2, 100k iterations) → stored on-chain

**Access Control:**
- Only the **owner** can register vaults, send heartbeats, and manage beneficiaries
- Only whitelisted **beneficiaries** can read decryption keys after trigger
- **Anyone** can call `checkAndRelease()` to trigger an expired switch (trustless)
- Once expired, the switch **cannot be revived** — heartbeats are permanently rejected

---

## 📁 Project Structure

```
├── DeadMansSwitch.sol              # Main smart contract (Solidity 0.8.24)
├── DeadMansSwitchFactory.sol       # Factory contract for deploying switches
│
├── dms-frontend/                   # React + Vite dashboard
│   ├── src/
│   │   ├── App.jsx                 # Root component, wallet connection
│   │   ├── contract.js             # Contract address & ABI
│   │   ├── crypto.js               # Browser WebCrypto (AES-256-GCM, PBKDF2)
│   │   └── components/
│   │       ├── OwnerDashboard.jsx  # Heartbeat, vaults, beneficiary manager
│   │       ├── ReaderView.jsx      # Beneficiary decryption interface
│   │       ├── VaultUploader.jsx   # In-browser encrypt & upload
│   │       ├── CreateSwitchView.jsx# Deploy new switch via factory
│   │       ├── CountdownRing.jsx   # SVG countdown timer
│   │       └── Toast.jsx           # Notification component
│   └── .env                        # VITE_PINATA_JWT
│
├── dms-backend/                    # Node.js CLI tools & daemon
│   ├── scripts/
│   │   ├── crypto-utils.js         # Node.js crypto (AES-256-GCM, PBKDF2)
│   │   ├── encrypt-upload.js       # CLI: encrypt file → IPFS → on-chain
│   │   ├── heartbeat-daemon.js     # Automated heartbeat cron job
│   │   └── check-release.js        # Release watcher & vault reader
│   ├── abi/DeadMansSwitch.json     # Contract ABI
│   └── .env                        # PRIVATE_KEY, RPC_URL, CONTRACT_ADDRESS
```

---

## 🚀 Quick Start

### Prerequisites
- [Node.js](https://nodejs.org/) v18+
- [MetaMask](https://metamask.io/) browser extension
- Hoodi/Sepolia testnet ETH ([faucet](https://cloud.google.com/application/web3/faucet/ethereum))
- [Pinata](https://pinata.cloud) account (free tier) for IPFS uploads

### 1. Deploy the Smart Contract

1. Open [Remix IDE](https://remix.ethereum.org)
2. Create a new file, paste contents of `DeadMansSwitch.sol`
3. Compile with Solidity **0.8.24**
4. Deploy with **Injected Provider (MetaMask)** on your testnet:
   - `_owner`: Your MetaMask wallet address
   - `_intervalSeconds`: `300` (5 min for testing) or `604800` (7 days production)
5. Copy the deployed contract address

### 2. Configure

Update the contract address in **both** locations:

```bash
# dms-backend/.env
CONTRACT_ADDRESS=0xYOUR_DEPLOYED_ADDRESS

# dms-frontend/src/contract.js
export const CONTRACT_ADDRESS = '0xYOUR_DEPLOYED_ADDRESS';
```

Set up your Pinata JWT in both `.env` files:
```bash
# dms-backend/.env
PINATA_JWT=your_pinata_jwt_token

# dms-frontend/.env
VITE_PINATA_JWT=your_pinata_jwt_token
```

### 3. Install & Run Frontend

```bash
cd dms-frontend
npm install
npm run dev
```

Open `http://localhost:5173` → Connect MetaMask → You should see the Owner Dashboard.

### 4. Start the Heartbeat Daemon (Optional)

```bash
cd dms-backend
npm install
node scripts/heartbeat-daemon.js
```

This automatically sends heartbeats every 3 minutes to keep the switch alive.

---

## 📖 Usage Guide

### Owner Workflow

1. **Connect MetaMask** on the frontend dashboard
2. **Click "Start Timer & First Heartbeat"** to activate the switch
3. **Add beneficiaries** — paste their wallet addresses
4. **Create vaults** — upload files or type secrets, set a label and vault password
5. **Send heartbeats** periodically before the timer expires
6. **Share the vault password** with your beneficiaries through a secure channel

### Beneficiary Workflow

1. Visit the dashboard URL (or use `?switch=0xCONTRACT_ADDRESS`)
2. Connect MetaMask with your whitelisted wallet
3. Switch to the **Reader View** tab
4. If the heartbeat has expired, click **"Trigger Release"**
5. Enter the vault password shared by the owner
6. Click **"Decrypt Vault"** to view the contents

### CLI Tools (Backend)

```bash
# Encrypt a file and register it as a vault
node scripts/encrypt-upload.js --file ./my-will.pdf --label "My Will"

# Watch for switch trigger and auto-release all vaults
node scripts/check-release.js

# Read and decrypt a specific vault (as beneficiary)
node scripts/check-release.js --read 0
```

---

## ⚙️ Tech Stack

| Component | Technology |
|-----------|-----------|
| Smart Contract | Solidity 0.8.24, Ethereum |
| Frontend | React 18, Vite, ethers.js v6 |
| Wallet | MetaMask (Injected Web3 Provider) |
| Encryption (Browser) | WebCrypto API (AES-256-GCM, PBKDF2) |
| Encryption (Backend) | Node.js `crypto` module |
| File Storage | IPFS via Pinata |
| Backend Scripts | Node.js ESM, node-cron, commander |
| Testnet | Hoodi (Ethereum testnet) |

---

## 🔑 Smart Contract API

| Function | Access | Description |
|----------|--------|-------------|
| `heartbeat()` | Owner only | Reset the countdown timer |
| `registerVault(cid, key, label)` | Owner only | Store encrypted file reference |
| `addBeneficiary(wallet)` | Owner only | Whitelist a beneficiary |
| `removeBeneficiary(wallet)` | Owner only | Remove a beneficiary |
| `checkAndRelease(vaultId)` | Anyone | Trigger release after expiry |
| `getDecryptionKey(vaultId)` | Beneficiary only | Get encrypted AES key |
| `getStatus()` | Anyone | Get full contract state |
| `getVaultInfo(vaultId)` | Anyone | Get vault metadata |
| `isExpired()` | Anyone | Check if heartbeat window passed |
| `timeRemaining()` | Anyone | Seconds until expiry |

---

## ⚠️ Environment Variables

### `dms-backend/.env`
```env
PRIVATE_KEY=0x...           # Owner wallet private key (NEVER commit!)
RPC_URL=https://rpc.hoodi.ethpandaops.io
CONTRACT_ADDRESS=0x...      # Deployed contract address
PINATA_JWT=...              # Pinata API JWT token
VAULT_PASSWORD=...          # Password for encrypting AES keys (CLI only)
```

### `dms-frontend/.env`
```env
VITE_PINATA_JWT=...         # Pinata API JWT token (for in-browser uploads)
```

---

## 📜 License

MIT

---

## 👤 Author

Built as a Blockchain Technology practical project.
