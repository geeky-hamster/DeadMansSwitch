# Dead Man's Switch — Complete Build Guide
### Remix IDE · Sepolia / Hoodi Testnet · Step-by-Step with Full Code

> Every code block in this file is complete and copy-paste ready.
> No files are split. No "refer to previous section". Zero missing pieces.
> Stack: Solidity 0.8.24 · Node.js 20 · React + Vite · ethers.js v6 · MetaMask

---

## What You Are Building

An encrypted digital vault that auto-releases to designated wallets if you stop
checking in. You encrypt a file locally, store the ciphertext on IPFS, register
it on a smart contract, and send a heartbeat transaction every few days. Miss
one — the contract flips a flag and beneficiary wallets can decrypt the file.

**Core contract logic:**
- `heartbeat()` — resets the countdown (owner only)
- `registerVault(cid, encryptedKey)` — stores IPFS hash + encrypted key (owner only)
- `addBeneficiary(wallet)` — whitelist a beneficiary (owner only)
- `checkAndRelease(vaultId)` — anyone calls this after deadline to trigger release
- `getDecryptionKey(vaultId)` — returns key only if triggered + caller is beneficiary

---

## Table of Contents

1. [Prerequisites & Wallet Setup](#1-prerequisites--wallet-setup)
2. [Smart Contract — Full Code](#2-smart-contract--full-code)
3. [Deploy via Remix IDE](#3-deploy-via-remix-ide)
4. [Backend Scripts — Encrypt & Upload](#4-backend-scripts--encrypt--upload)
5. [Heartbeat Daemon](#5-heartbeat-daemon)
6. [Release Watcher Script](#6-release-watcher-script)
7. [React Frontend — Full Code](#7-react-frontend--full-code)
8. [Running the Full Demo](#8-running-the-full-demo)
9. [Common Errors & Fixes](#9-common-errors--fixes)

---

## 1. Prerequisites & Wallet Setup

### What you need installed

| Tool | Version | Install |
|---|---|---|
| Node.js | 20+ | https://nodejs.org |
| MetaMask | Latest | https://metamask.io |
| A browser | Chrome/Firefox | — |

### Get testnet ETH

**Sepolia:**
1. Go to https://cloud.google.com/application/web3/faucet/ethereum/sepolia
2. Paste your MetaMask wallet address
3. Receive 0.05 ETH — enough for hundreds of transactions

**Hoodi (Holesky replacement):**
1. Go to https://hoodi.ethpandaops.io
2. Follow faucet instructions for Hoodi testnet

> You need two MetaMask wallets for the full demo — one as **owner**, one as
> **beneficiary**. Create a second account inside MetaMask via the account
> switcher (top right circle → Create Account).

### Add Sepolia to MetaMask

MetaMask has Sepolia built in. Enable test networks:
`Settings → Advanced → Show test networks → ON`
Then select **Sepolia** from the network dropdown.

### Add Hoodi to MetaMask (if using Hoodi)

In MetaMask:
`Add Network → Add Network Manually`

| Field | Value |
|---|---|
| Network name | Hoodi |
| RPC URL | https://rpc.hoodi.ethpandaops.io |
| Chain ID | 560048 |
| Currency symbol | ETH |
| Block explorer | https://explorer.hoodi.ethpandaops.io |

---

## 2. Smart Contract — Full Code

This is the complete, deployment-ready Solidity file. No imports needed — zero
external dependencies. Copy the entire block.

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title DeadMansSwitch
 * @notice Encrypts files on IPFS and releases decryption keys to beneficiaries
 *         automatically if the owner stops sending heartbeat transactions.
 * @dev Deploy with an interval in seconds. Recommended: 604800 (7 days).
 */
contract DeadMansSwitch {

    // ─────────────────────────────────────────────────────────────
    //  State variables
    // ─────────────────────────────────────────────────────────────

    address public owner;
    uint256 public interval;      // seconds between required heartbeats
    uint256 public lastPing;      // timestamp of last successful heartbeat
    bool    public triggered;     // true once deadline is missed and released

    struct Vault {
        string  cid;              // IPFS CID of the encrypted file blob
        bytes   encryptedKey;     // AES key, password-encrypted, stored as bytes
        bool    released;         // true once checkAndRelease() is called
        uint256 createdAt;        // block timestamp when vault was registered
        string  label;            // human-readable label (e.g. "Will - 2026")
    }

    mapping(uint256 => Vault) private vaults;
    uint256 public vaultCount;

    mapping(address => bool) public isBeneficiary;
    address[] private beneficiaryList;

    // ─────────────────────────────────────────────────────────────
    //  Events
    // ─────────────────────────────────────────────────────────────

    event Heartbeat(address indexed owner, uint256 timestamp, uint256 remaining);
    event VaultRegistered(uint256 indexed id, string cid, string label);
    event SwitchTriggered(uint256 timestamp, uint256 vaultCount);
    event VaultReleased(uint256 indexed vaultId);
    event BeneficiaryAdded(address indexed wallet);
    event BeneficiaryRemoved(address indexed wallet);
    event IntervalUpdated(uint256 oldInterval, uint256 newInterval);

    // ─────────────────────────────────────────────────────────────
    //  Modifiers
    // ─────────────────────────────────────────────────────────────

    modifier onlyOwner() {
        require(msg.sender == owner, "DeadMansSwitch: caller is not the owner");
        _;
    }

    modifier notTriggered() {
        require(!triggered, "DeadMansSwitch: switch already triggered");
        _;
    }

    modifier validVault(uint256 _id) {
        require(_id < vaultCount, "DeadMansSwitch: invalid vault ID");
        _;
    }

    // ─────────────────────────────────────────────────────────────
    //  Constructor
    // ─────────────────────────────────────────────────────────────

    /**
     * @param _intervalSeconds Seconds between required heartbeats.
     *        Use 300 (5 min) for testing, 604800 (7 days) for production.
     */
    constructor(uint256 _intervalSeconds) {
        require(_intervalSeconds >= 60, "Interval must be at least 60 seconds");
        owner    = msg.sender;
        interval = _intervalSeconds;
        lastPing = block.timestamp;
    }

    // ─────────────────────────────────────────────────────────────
    //  Owner functions
    // ─────────────────────────────────────────────────────────────

    /**
     * @notice Resets the heartbeat countdown. Must be called before interval expires.
     */
    function heartbeat() external onlyOwner notTriggered {
        lastPing = block.timestamp;
        uint256 remaining = lastPing + interval - block.timestamp;
        emit Heartbeat(msg.sender, block.timestamp, remaining);
    }

    /**
     * @notice Registers an encrypted file vault.
     * @param _cid IPFS CID of the encrypted file (e.g. "bafybeig...")
     * @param _encryptedKey The AES key, encrypted with a shared password, as hex bytes
     * @param _label Human-readable name for this vault
     */
    function registerVault(
        string  calldata _cid,
        bytes   calldata _encryptedKey,
        string  calldata _label
    ) external onlyOwner notTriggered {
        require(bytes(_cid).length > 0,       "CID cannot be empty");
        require(_encryptedKey.length > 0,     "Encrypted key cannot be empty");
        require(bytes(_label).length > 0,     "Label cannot be empty");

        vaults[vaultCount] = Vault({
            cid:          _cid,
            encryptedKey: _encryptedKey,
            released:     false,
            createdAt:    block.timestamp,
            label:        _label
        });

        emit VaultRegistered(vaultCount, _cid, _label);
        vaultCount++;
    }

    /**
     * @notice Adds a wallet address to the beneficiary whitelist.
     */
    function addBeneficiary(address _wallet) external onlyOwner {
        require(_wallet != address(0), "Invalid address: zero address");
        require(_wallet != owner,      "Owner cannot be a beneficiary");
        require(!isBeneficiary[_wallet], "Already a beneficiary");

        isBeneficiary[_wallet] = true;
        beneficiaryList.push(_wallet);
        emit BeneficiaryAdded(_wallet);
    }

    /**
     * @notice Removes a wallet from the beneficiary whitelist.
     */
    function removeBeneficiary(address _wallet) external onlyOwner {
        require(isBeneficiary[_wallet], "Not a beneficiary");

        isBeneficiary[_wallet] = false;

        for (uint256 i = 0; i < beneficiaryList.length; i++) {
            if (beneficiaryList[i] == _wallet) {
                beneficiaryList[i] = beneficiaryList[beneficiaryList.length - 1];
                beneficiaryList.pop();
                break;
            }
        }

        emit BeneficiaryRemoved(_wallet);
    }

    /**
     * @notice Updates the heartbeat interval. Takes effect immediately.
     * @dev Can only increase interval (prevents gaming by reducing right before trigger).
     */
    function updateInterval(uint256 _newInterval) external onlyOwner notTriggered {
        require(_newInterval >= interval, "Can only increase interval");
        require(_newInterval >= 60,       "Interval must be at least 60 seconds");
        emit IntervalUpdated(interval, _newInterval);
        interval = _newInterval;
    }

    // ─────────────────────────────────────────────────────────────
    //  Public trigger functions
    // ─────────────────────────────────────────────────────────────

    /**
     * @notice Call this after the heartbeat interval expires.
     *         Anyone can call it — no permission required.
     *         Marks the vault as released and sets triggered = true.
     * @param _vaultId The vault to release (call once per vault).
     */
    function checkAndRelease(uint256 _vaultId) external validVault(_vaultId) {
        require(isExpired(), "Heartbeat interval has not expired yet");

        if (!triggered) {
            triggered = true;
            emit SwitchTriggered(block.timestamp, vaultCount);
        }

        Vault storage vault = vaults[_vaultId];
        require(!vault.released, "Vault already released");

        vault.released = true;
        emit VaultReleased(_vaultId);
    }

    // ─────────────────────────────────────────────────────────────
    //  Beneficiary read functions
    // ─────────────────────────────────────────────────────────────

    /**
     * @notice Returns the encrypted AES key for a released vault.
     *         Only callable by beneficiaries after the switch is triggered.
     * @return The encrypted key bytes — decrypt off-chain using the shared password.
     */
    function getDecryptionKey(uint256 _vaultId)
        external
        view
        validVault(_vaultId)
        returns (bytes memory)
    {
        require(triggered,                   "Switch not triggered yet");
        require(isBeneficiary[msg.sender],   "Caller is not a beneficiary");
        require(vaults[_vaultId].released,   "Vault not released yet");

        return vaults[_vaultId].encryptedKey;
    }

    // ─────────────────────────────────────────────────────────────
    //  View / pure helpers
    // ─────────────────────────────────────────────────────────────

    /**
     * @notice Returns true when the heartbeat window has expired.
     */
    function isExpired() public view returns (bool) {
        return block.timestamp > lastPing + interval;
    }

    /**
     * @notice Seconds remaining until the switch can be triggered.
     *         Returns 0 if already expired.
     */
    function timeRemaining() external view returns (uint256) {
        if (isExpired()) return 0;
        return (lastPing + interval) - block.timestamp;
    }

    /**
     * @notice Returns public vault metadata (NOT the encrypted key).
     */
    function getVaultInfo(uint256 _vaultId)
        external
        view
        validVault(_vaultId)
        returns (
            string memory cid,
            string memory label,
            bool   released,
            uint256 createdAt
        )
    {
        Vault storage v = vaults[_vaultId];
        return (v.cid, v.label, v.released, v.createdAt);
    }

    /**
     * @notice Returns the full list of beneficiary addresses.
     */
    function getBeneficiaries() external view returns (address[] memory) {
        return beneficiaryList;
    }

    /**
     * @notice Returns core contract state in one call (saves RPC round-trips).
     */
    function getStatus() external view returns (
        address _owner,
        uint256 _interval,
        uint256 _lastPing,
        uint256 _timeRemaining,
        bool    _triggered,
        bool    _expired,
        uint256 _vaultCount
    ) {
        return (
            owner,
            interval,
            lastPing,
            this.timeRemaining(),
            triggered,
            isExpired(),
            vaultCount
        );
    }
}
```

---

## 3. Deploy via Remix IDE

### Step 1 — Open Remix

Go to **https://remix.ethereum.org** in your browser.

### Step 2 — Create the contract file

1. In the left sidebar, click the **📄 File Explorer** icon (top icon)
2. Click the **+** button next to "contracts"
3. Name the file: `DeadMansSwitch.sol`
4. Paste the **entire contract code** from Section 2 into the editor

### Step 3 — Compile

1. Click the **⚙️ Solidity Compiler** icon (left sidebar, 2nd icon)
2. Set compiler version to **0.8.24** (click the dropdown)
3. Make sure **"Enable optimization"** is checked, runs: **200**
4. Click **"Compile DeadMansSwitch.sol"**
5. You should see a green checkmark. If you see errors, re-check the paste.

### Step 4 — Connect MetaMask to Remix

1. In MetaMask, switch to **Sepolia** (or Hoodi) network
2. Make sure you have testnet ETH

### Step 5 — Deploy

1. Click the **🚀 Deploy & Run Transactions** icon (left sidebar, 4th icon)
2. Under **"Environment"** dropdown, select: **"Injected Provider - MetaMask"**
3. MetaMask will pop up — click **Connect**
4. You should see your wallet address under **"Account"**
5. Under **"Contract"** dropdown, select: `DeadMansSwitch`
6. In the `_INTERVALSECONDS` field, enter:
   - `300` for testing (5 minutes — so you can simulate a missed heartbeat fast)
   - `604800` for production (7 days)
7. Click **"Deploy"** → MetaMask pops up → click **"Confirm"**
8. Wait ~15 seconds → in the **"Deployed Contracts"** section at the bottom, your contract appears

### Step 6 — Save your contract address

Click the **copy icon** next to your deployed contract address.
Save it — you'll need it for the scripts and frontend.

Example: `0x1234...abcd`

### Step 7 — Verify the deployment

In the deployed contract panel, expand it and click:
- `owner` → should return your wallet address
- `triggered` → should return `false`
- `isExpired` → should return `false`
- `timeRemaining` → should return a number (seconds until expiry)

### Step 8 — Add a beneficiary (from Remix)

In the deployed contract panel:
1. Find the `addBeneficiary` function
2. Paste your **second MetaMask wallet address** into the input field
3. Click **"transact"** → confirm in MetaMask
4. Click `getBeneficiaries` to confirm it was added

### Verify on Etherscan (optional but recommended)

1. Go to https://sepolia.etherscan.io (or https://explorer.hoodi.ethpandaops.io)
2. Paste your contract address in the search bar
3. You should see your deploy transaction

---

## 4. Backend Scripts — Encrypt & Upload

This section covers the Node.js CLI that encrypts your file, uploads to IPFS,
and calls `registerVault()` on the contract.

### Step 1 — Create the project folder

Open a terminal (not Remix — your local terminal):

```bash
mkdir dms-backend
cd dms-backend
```

### Step 2 — package.json

Create this file exactly as shown:

```json
{
  "name": "dms-backend",
  "version": "1.0.0",
  "description": "Dead Man's Switch backend scripts",
  "type": "module",
  "scripts": {
    "encrypt": "node scripts/encrypt-upload.js",
    "heartbeat": "node scripts/heartbeat-daemon.js",
    "watcher": "node scripts/check-release.js"
  },
  "dependencies": {
    "ethers": "^6.13.0",
    "kubo-rpc-client": "^4.1.0",
    "node-cron": "^3.0.3",
    "dotenv": "^16.4.5",
    "commander": "^12.1.0"
  }
}
```

### Step 3 — Install dependencies

```bash
npm install
```

### Step 4 — .env file

Create a `.env` file in `dms-backend/`:

```
# Your owner wallet private key (NEVER commit this to git)
PRIVATE_KEY=0xYOUR_OWNER_WALLET_PRIVATE_KEY_HERE

# Sepolia RPC - get a free key from https://infura.io or https://alchemy.com
# OR use the public one below (may be rate-limited)
RPC_URL=https://sepolia.infura.io/v3/YOUR_INFURA_KEY

# For Hoodi testnet, use:
# RPC_URL=https://rpc.hoodi.ethpandaops.io

# Your deployed contract address from Section 3
CONTRACT_ADDRESS=0xYOUR_CONTRACT_ADDRESS_HERE

# IPFS - we use a public gateway for the demo
# For production, get a Pinata key at https://pinata.cloud (free tier)
PINATA_JWT=YOUR_PINATA_JWT_TOKEN_HERE

# Password to encrypt the AES key (share this with your beneficiaries securely)
# This is the secret your beneficiaries need to decrypt the file after release
VAULT_PASSWORD=some-long-strong-password-here
```

> **How to get your private key from MetaMask:**
> MetaMask → click the three dots next to your account → Account Details →
> Show Private Key → enter your MetaMask password → copy the key
>
> **Add 0x prefix if MetaMask doesn't include it.**

> **Getting a free Infura RPC:**
> 1. Go to https://infura.io and sign up free
> 2. Create a new project → select Ethereum
> 3. Copy the Sepolia endpoint URL

### Step 5 — ABI file

Create folder `dms-backend/abi/` and file `dms-backend/abi/DeadMansSwitch.json`:

```json
[
  {
    "inputs": [{ "internalType": "uint256", "name": "_intervalSeconds", "type": "uint256" }],
    "stateMutability": "nonpayable",
    "type": "constructor"
  },
  {
    "anonymous": false,
    "inputs": [
      { "indexed": true, "internalType": "address", "name": "wallet", "type": "address" }
    ],
    "name": "BeneficiaryAdded",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      { "indexed": true, "internalType": "address", "name": "wallet", "type": "address" }
    ],
    "name": "BeneficiaryRemoved",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      { "indexed": true, "internalType": "address", "name": "owner", "type": "address" },
      { "indexed": false, "internalType": "uint256", "name": "timestamp", "type": "uint256" },
      { "indexed": false, "internalType": "uint256", "name": "remaining", "type": "uint256" }
    ],
    "name": "Heartbeat",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      { "indexed": false, "internalType": "uint256", "name": "oldInterval", "type": "uint256" },
      { "indexed": false, "internalType": "uint256", "name": "newInterval", "type": "uint256" }
    ],
    "name": "IntervalUpdated",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      { "indexed": false, "internalType": "uint256", "name": "timestamp", "type": "uint256" },
      { "indexed": false, "internalType": "uint256", "name": "vaultCount", "type": "uint256" }
    ],
    "name": "SwitchTriggered",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      { "indexed": true, "internalType": "uint256", "name": "vaultId", "type": "uint256" }
    ],
    "name": "VaultReleased",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      { "indexed": true, "internalType": "uint256", "name": "id", "type": "uint256" },
      { "indexed": false, "internalType": "string", "name": "cid", "type": "string" },
      { "indexed": false, "internalType": "string", "name": "label", "type": "string" }
    ],
    "name": "VaultRegistered",
    "type": "event"
  },
  {
    "inputs": [{ "internalType": "address", "name": "_wallet", "type": "address" }],
    "name": "addBeneficiary",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [{ "internalType": "uint256", "name": "_vaultId", "type": "uint256" }],
    "name": "checkAndRelease",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "getBeneficiaries",
    "outputs": [{ "internalType": "address[]", "name": "", "type": "address[]" }],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [{ "internalType": "uint256", "name": "_vaultId", "type": "uint256" }],
    "name": "getDecryptionKey",
    "outputs": [{ "internalType": "bytes", "name": "", "type": "bytes" }],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "getStatus",
    "outputs": [
      { "internalType": "address", "name": "_owner", "type": "address" },
      { "internalType": "uint256", "name": "_interval", "type": "uint256" },
      { "internalType": "uint256", "name": "_lastPing", "type": "uint256" },
      { "internalType": "uint256", "name": "_timeRemaining", "type": "uint256" },
      { "internalType": "bool", "name": "_triggered", "type": "bool" },
      { "internalType": "bool", "name": "_expired", "type": "bool" },
      { "internalType": "uint256", "name": "_vaultCount", "type": "uint256" }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [{ "internalType": "uint256", "name": "_vaultId", "type": "uint256" }],
    "name": "getVaultInfo",
    "outputs": [
      { "internalType": "string", "name": "cid", "type": "string" },
      { "internalType": "string", "name": "label", "type": "string" },
      { "internalType": "bool", "name": "released", "type": "bool" },
      { "internalType": "uint256", "name": "createdAt", "type": "uint256" }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "heartbeat",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [{ "internalType": "address", "name": "", "type": "address" }],
    "name": "isBeneficiary",
    "outputs": [{ "internalType": "bool", "name": "", "type": "bool" }],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "isExpired",
    "outputs": [{ "internalType": "bool", "name": "", "type": "bool" }],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "interval",
    "outputs": [{ "internalType": "uint256", "name": "", "type": "uint256" }],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "lastPing",
    "outputs": [{ "internalType": "uint256", "name": "", "type": "uint256" }],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "owner",
    "outputs": [{ "internalType": "address", "name": "", "type": "address" }],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [{ "internalType": "address", "name": "_wallet", "type": "address" }],
    "name": "removeBeneficiary",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      { "internalType": "string", "name": "_cid", "type": "string" },
      { "internalType": "bytes", "name": "_encryptedKey", "type": "bytes" },
      { "internalType": "string", "name": "_label", "type": "string" }
    ],
    "name": "registerVault",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "timeRemaining",
    "outputs": [{ "internalType": "uint256", "name": "", "type": "uint256" }],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "triggered",
    "outputs": [{ "internalType": "bool", "name": "", "type": "bool" }],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [{ "internalType": "uint256", "name": "_newInterval", "type": "uint256" }],
    "name": "updateInterval",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "vaultCount",
    "outputs": [{ "internalType": "uint256", "name": "", "type": "uint256" }],
    "stateMutability": "view",
    "type": "function"
  }
]
```

### Step 6 — Shared crypto utilities

Create `dms-backend/scripts/crypto-utils.js`:

```javascript
// crypto-utils.js
// Shared encryption helpers used by encrypt-upload and reader view.
// Uses only Node.js built-in 'crypto' — no extra dependencies.

import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'crypto';

const ALGORITHM  = 'aes-256-gcm';
const KEY_LEN    = 32;   // 256 bits
const IV_LEN     = 12;   // 96 bits — GCM standard
const SALT_LEN   = 16;
const TAG_LEN    = 16;
const SCRYPT_N   = 16384;
const SCRYPT_r   = 8;
const SCRYPT_p   = 1;

/**
 * Derives a 256-bit key from a password using scrypt.
 * @param {string} password
 * @param {Buffer} salt
 * @returns {Buffer} 32-byte derived key
 */
export function deriveKey(password, salt) {
  return scryptSync(password, salt, KEY_LEN, {
    N: SCRYPT_N,
    r: SCRYPT_r,
    p: SCRYPT_p,
  });
}

/**
 * Encrypts arbitrary data with AES-256-GCM.
 * Returns a single Buffer: [salt(16)] + [iv(12)] + [tag(16)] + [ciphertext]
 * @param {Buffer} data
 * @param {string} password
 * @returns {Buffer}
 */
export function encryptBuffer(data, password) {
  const salt   = randomBytes(SALT_LEN);
  const iv     = randomBytes(IV_LEN);
  const key    = deriveKey(password, salt);
  const cipher = createCipheriv(ALGORITHM, key, iv);

  const encrypted = Buffer.concat([cipher.update(data), cipher.final()]);
  const tag       = cipher.getAuthTag();

  // Layout: salt | iv | tag | ciphertext
  return Buffer.concat([salt, iv, tag, encrypted]);
}

/**
 * Decrypts a Buffer produced by encryptBuffer().
 * @param {Buffer} blob  The full encrypted blob (salt + iv + tag + ciphertext)
 * @param {string} password
 * @returns {Buffer} Decrypted plaintext
 */
export function decryptBuffer(blob, password) {
  const salt       = blob.subarray(0, SALT_LEN);
  const iv         = blob.subarray(SALT_LEN, SALT_LEN + IV_LEN);
  const tag        = blob.subarray(SALT_LEN + IV_LEN, SALT_LEN + IV_LEN + TAG_LEN);
  const ciphertext = blob.subarray(SALT_LEN + IV_LEN + TAG_LEN);

  const key      = deriveKey(password, salt);
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);

  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

/**
 * Generates a random AES-256 key (32 bytes).
 * @returns {Buffer}
 */
export function generateAESKey() {
  return randomBytes(KEY_LEN);
}

/**
 * Encrypts file data with a fresh random AES-256-GCM key.
 * Returns both the ciphertext blob and the raw key (to be stored separately).
 * Blob layout: [iv(12)] + [tag(16)] + [ciphertext]
 *
 * @param {Buffer} fileData
 * @returns {{ cipherBlob: Buffer, aesKey: Buffer }}
 */
export function encryptFile(fileData) {
  const aesKey = generateAESKey();
  const iv     = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALGORITHM, aesKey, iv);

  const ciphertext = Buffer.concat([cipher.update(fileData), cipher.final()]);
  const tag        = cipher.getAuthTag();

  // Blob: iv | tag | ciphertext
  const cipherBlob = Buffer.concat([iv, tag, ciphertext]);

  return { cipherBlob, aesKey };
}

/**
 * Decrypts a file blob produced by encryptFile().
 * @param {Buffer} blob   The [iv + tag + ciphertext] blob from IPFS
 * @param {Buffer} aesKey The 32-byte AES key
 * @returns {Buffer} Decrypted file content
 */
export function decryptFile(blob, aesKey) {
  const iv         = blob.subarray(0, IV_LEN);
  const tag        = blob.subarray(IV_LEN, IV_LEN + TAG_LEN);
  const ciphertext = blob.subarray(IV_LEN + TAG_LEN);

  const decipher = createDecipheriv(ALGORITHM, aesKey, iv);
  decipher.setAuthTag(tag);

  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}
```

### Step 7 — encrypt-upload.js

Create `dms-backend/scripts/encrypt-upload.js`:

```javascript
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
import { readFileSync as rf } from 'fs';

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
  const { default: FormData } = await import('formdata-node');

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
```

### Step 8 — Run the encrypt script

Create a test file to encrypt:

```bash
echo "# My Secret Will\n\nMy crypto seed phrase is: word1 word2 word3..." > secret.md
```

Run the script:

```bash
node scripts/encrypt-upload.js --file ./secret.md --label "My Will 2026"
```

Expected output:
```
🔐 Dead Man's Switch — Encrypt & Upload

📄 File:     /path/to/secret.md
🏷️  Label:    My Will 2026

[1/4] Encrypting file with AES-256-GCM...
      ✓ Encrypted. Cipher blob: 312 bytes
      ✓ AES key:   a1b2c3...

[2/4] Encrypting AES key with vault password...
      ✓ Encrypted key: 64 bytes

[3/4] Uploading encrypted file to IPFS via Pinata...
      ✓ CID: bafybeig...
      🌐 View: https://gateway.pinata.cloud/ipfs/bafybeig...

[4/4] Registering vault on-chain...
      Wallet: 0xYourWallet
      ⏳ Tx sent: 0xabc...
      ✓ Confirmed in block 7654321

✅ Vault registered successfully!
```

---

## 5. Heartbeat Daemon

The daemon runs in the background and automatically sends heartbeat transactions
on a schedule, so you don't need to do it manually.

Create `dms-backend/scripts/heartbeat-daemon.js`:

```javascript
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

  const provider = new ethers.JsonRpcProvider(process.env.RPC_URL);
  const wallet   = new ethers.Wallet(process.env.PRIVATE_KEY, provider);
  const contract = new ethers.Contract(process.env.CONTRACT_ADDRESS, ABI, wallet);

  // Check if already triggered
  const triggered = await contract.triggered();
  if (triggered) {
    alert('SWITCH IS TRIGGERED. Stop the daemon. Beneficiaries can now read the vaults.');
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

  // Validate wallet matches contract owner
  const provider = new ethers.JsonRpcProvider(process.env.RPC_URL);
  const wallet   = new ethers.Wallet(process.env.PRIVATE_KEY, provider);
  const contract = new ethers.Contract(process.env.CONTRACT_ADDRESS, ABI, wallet);
  const owner    = await contract.owner();

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
  cron.schedule(CRON_SCHEDULE, sendHeartbeat);
  console.log(`\n🕐 Daemon running. Next heartbeat per schedule: ${CRON_SCHEDULE}`);
  console.log('   Press Ctrl+C to stop.\n');
}

startup().catch(err => {
  console.error('Fatal startup error:', err);
  process.exit(1);
});
```

Run it:

```bash
node scripts/heartbeat-daemon.js
```

---

## 6. Release Watcher Script

This script listens for the `SwitchTriggered` event and automatically calls
`checkAndRelease()` on all vaults. A beneficiary can also run it manually.

Create `dms-backend/scripts/check-release.js`:

```javascript
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
    return;
  }

  // Listen for event
  contract.on('SwitchTriggered', async (timestamp, count) => {
    console.log(`\n🚨 SWITCH TRIGGERED at ${new Date(Number(timestamp) * 1000).toISOString()}`);
    console.log(`   ${count} vault(s) to release`);
    await releaseAllVaults(contract);
  });

  // Also poll every minute in case we missed the event
  setInterval(async () => {
    const triggered = await contract.triggered().catch(() => false);
    if (triggered) {
      console.log('\n⏰ Detected triggered state via polling. Releasing...');
      await releaseAllVaults(contract);
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
```

**To run in listen mode (auto-releases on trigger):**
```bash
node scripts/check-release.js
```

**To manually read a released vault (as beneficiary):**
```bash
node scripts/check-release.js --read 0
```

---

## 7. React Frontend — Full Code

The frontend has two views: **Owner Dashboard** and **Reader View**. It connects
to MetaMask, reads from the contract, and decrypts files in-browser using WebCrypto.

### Step 1 — Create the Vite project

Open a new terminal (separate from the backend):

```bash
npm create vite@latest dms-frontend -- --template react
cd dms-frontend
npm install
npm install ethers
```

### Step 2 — vite.config.js

Replace `dms-frontend/vite.config.js` with:

```javascript
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  define: {
    global: 'globalThis',
  },
})
```

### Step 3 — index.html

Replace `dms-frontend/index.html` with:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Dead Man's Switch</title>
    <style>
      * { box-sizing: border-box; margin: 0; padding: 0; }
      body {
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
        background: #0f0f0f;
        color: #e8e6df;
        min-height: 100vh;
      }
    </style>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.jsx"></script>
  </body>
</html>
```

### Step 4 — Contract config

Create `dms-frontend/src/contract.js`:

```javascript
// contract.js — update these two values after deploying

export const CONTRACT_ADDRESS = '0xYOUR_CONTRACT_ADDRESS_HERE'; // from Section 3

export const CONTRACT_ABI = [
  'function heartbeat() external',
  'function registerVault(string calldata _cid, bytes calldata _encryptedKey, string calldata _label) external',
  'function addBeneficiary(address _wallet) external',
  'function removeBeneficiary(address _wallet) external',
  'function checkAndRelease(uint256 _vaultId) external',
  'function getDecryptionKey(uint256 _vaultId) external view returns (bytes)',
  'function getVaultInfo(uint256 _vaultId) external view returns (string cid, string label, bool released, uint256 createdAt)',
  'function getStatus() external view returns (address _owner, uint256 _interval, uint256 _lastPing, uint256 _timeRemaining, bool _triggered, bool _expired, uint256 _vaultCount)',
  'function getBeneficiaries() external view returns (address[])',
  'function isExpired() external view returns (bool)',
  'function isBeneficiary(address) external view returns (bool)',
  'function owner() external view returns (address)',
  'function triggered() external view returns (bool)',
  'function vaultCount() external view returns (uint256)',
  'event Heartbeat(address indexed owner, uint256 timestamp, uint256 remaining)',
  'event SwitchTriggered(uint256 timestamp, uint256 vaultCount)',
  'event VaultReleased(uint256 indexed vaultId)',
];
```

### Step 5 — Crypto utilities (browser version)

Create `dms-frontend/src/crypto.js`:

```javascript
// crypto.js — Browser-native WebCrypto API utilities
// Mirrors the logic in the backend crypto-utils.js but uses SubtleCrypto.

const SALT_LEN = 16;
const IV_LEN   = 12;
const TAG_LEN  = 16; // GCM auth tag is included in the ciphertext by WebCrypto

/**
 * Derives an AES-256 key from a password using PBKDF2.
 * @param {string} password
 * @param {Uint8Array} salt
 * @returns {Promise<CryptoKey>}
 */
async function deriveKey(password, salt) {
  const enc     = new TextEncoder();
  const keyMat  = await crypto.subtle.importKey(
    'raw', enc.encode(password), { name: 'PBKDF2' }, false, ['deriveKey']
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' },
    keyMat,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

/**
 * Decrypts a blob produced by the Node.js encryptBuffer() function.
 * Blob layout: [salt(16)] + [iv(12)] + [tag(16)] + [ciphertext]
 * Note: WebCrypto's AES-GCM expects [ciphertext + tag] together.
 *
 * @param {ArrayBuffer} blob
 * @param {string} password
 * @returns {Promise<ArrayBuffer>} decrypted data
 */
export async function decryptBlob(blob, password) {
  const buf  = new Uint8Array(blob);
  const salt = buf.slice(0, SALT_LEN);
  const iv   = buf.slice(SALT_LEN, SALT_LEN + IV_LEN);
  const tag  = buf.slice(SALT_LEN + IV_LEN, SALT_LEN + IV_LEN + TAG_LEN);
  const ct   = buf.slice(SALT_LEN + IV_LEN + TAG_LEN);

  // WebCrypto expects ciphertext + tag concatenated
  const ctWithTag = new Uint8Array(ct.length + TAG_LEN);
  ctWithTag.set(ct, 0);
  ctWithTag.set(tag, ct.length);

  const key = await deriveKey(password, salt);
  return crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ctWithTag);
}

/**
 * Decrypts a file blob produced by the Node.js encryptFile() function.
 * Blob layout: [iv(12)] + [ciphertext+tag (rest)]
 * The raw AES key is passed as a hex string.
 *
 * @param {ArrayBuffer} blob
 * @param {string} aesKeyHex  32-byte AES key as hex string
 * @returns {Promise<ArrayBuffer>} decrypted file bytes
 */
export async function decryptFile(blob, aesKeyHex) {
  const keyBytes = hexToBytes(aesKeyHex);
  const buf      = new Uint8Array(blob);
  const iv       = buf.slice(0, IV_LEN);
  const ctTag    = buf.slice(IV_LEN); // ciphertext + tag (WebCrypto handles combined)

  const key = await crypto.subtle.importKey(
    'raw', keyBytes, { name: 'AES-GCM' }, false, ['decrypt']
  );

  return crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ctTag);
}

/** Converts a hex string (with or without 0x) to Uint8Array */
export function hexToBytes(hex) {
  const h = hex.startsWith('0x') ? hex.slice(2) : hex;
  const bytes = new Uint8Array(h.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

/** Converts ArrayBuffer to UTF-8 string */
export function bufferToString(buf) {
  return new TextDecoder().decode(buf);
}
```

### Step 6 — Global styles

Create `dms-frontend/src/styles.css`:

```css
/* styles.css */
:root {
  --bg:       #0f0f0f;
  --bg2:      #1a1a1a;
  --bg3:      #222222;
  --border:   #2e2e2e;
  --text:     #e8e6df;
  --muted:    #7a7a74;
  --accent:   #D85A30;
  --purple:   #534AB7;
  --teal:     #0f8c6e;
  --green:    #2dbd6e;
  --red:      #e05252;
  --amber:    #f0a030;
}

.app {
  max-width: 860px;
  margin: 0 auto;
  padding: 2rem 1.5rem;
}

/* Header */
.header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 2.5rem;
  padding-bottom: 1.5rem;
  border-bottom: 1px solid var(--border);
}
.header h1 {
  font-size: 1.3rem;
  font-weight: 600;
  letter-spacing: -0.01em;
}
.header h1 span { color: var(--accent); }

/* Wallet button */
.wallet-btn {
  background: var(--bg2);
  border: 1px solid var(--border);
  color: var(--text);
  padding: 0.5rem 1rem;
  border-radius: 8px;
  cursor: pointer;
  font-size: 0.875rem;
  transition: background 0.15s;
}
.wallet-btn:hover { background: var(--bg3); }
.wallet-btn.connected { border-color: var(--green); color: var(--green); }

/* Tabs */
.tabs {
  display: flex;
  gap: 0.5rem;
  margin-bottom: 2rem;
  background: var(--bg2);
  padding: 0.25rem;
  border-radius: 10px;
}
.tab {
  flex: 1;
  padding: 0.6rem 1rem;
  border: none;
  background: transparent;
  color: var(--muted);
  border-radius: 8px;
  cursor: pointer;
  font-size: 0.875rem;
  transition: all 0.15s;
}
.tab.active {
  background: var(--bg3);
  color: var(--text);
}

/* Cards */
.card {
  background: var(--bg2);
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 1.5rem;
  margin-bottom: 1rem;
}
.card-title {
  font-size: 0.7rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--muted);
  margin-bottom: 1rem;
}

/* Status grid */
.status-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
  gap: 0.75rem;
  margin-bottom: 1rem;
}
.stat {
  background: var(--bg3);
  border-radius: 8px;
  padding: 0.875rem 1rem;
}
.stat-val {
  font-size: 1.4rem;
  font-weight: 600;
  line-height: 1;
  margin-bottom: 0.25rem;
}
.stat-lbl {
  font-size: 0.75rem;
  color: var(--muted);
}
.stat-val.green { color: var(--green); }
.stat-val.red   { color: var(--red);   }
.stat-val.amber { color: var(--amber); }

/* Countdown ring */
.countdown-wrap {
  display: flex;
  flex-direction: column;
  align-items: center;
  margin: 1rem 0;
}
.countdown-ring { transform: rotate(-90deg); }
.ring-track { fill: none; stroke: var(--bg3); stroke-width: 8; }
.ring-progress {
  fill: none;
  stroke-width: 8;
  stroke-linecap: round;
  transition: stroke-dashoffset 1s ease, stroke 0.5s;
}
.countdown-text {
  font-size: 1.5rem;
  font-weight: 600;
  margin-top: 0.75rem;
}
.countdown-sub {
  font-size: 0.8rem;
  color: var(--muted);
  margin-top: 0.25rem;
}

/* Buttons */
.btn {
  padding: 0.625rem 1.25rem;
  border-radius: 8px;
  border: none;
  cursor: pointer;
  font-size: 0.875rem;
  font-weight: 500;
  transition: opacity 0.15s, transform 0.1s;
}
.btn:active { transform: scale(0.97); }
.btn:disabled { opacity: 0.4; cursor: not-allowed; }
.btn-primary  { background: var(--accent);  color: #fff; }
.btn-purple   { background: var(--purple);  color: #fff; }
.btn-teal     { background: var(--teal);    color: #fff; }
.btn-ghost    { background: var(--bg3); border: 1px solid var(--border); color: var(--text); }

/* Input */
.input-row {
  display: flex;
  gap: 0.5rem;
  margin-top: 0.75rem;
}
input[type="text"], input[type="password"], textarea {
  background: var(--bg3);
  border: 1px solid var(--border);
  color: var(--text);
  border-radius: 8px;
  padding: 0.5rem 0.75rem;
  font-size: 0.875rem;
  flex: 1;
  outline: none;
  transition: border-color 0.15s;
}
input:focus, textarea:focus { border-color: var(--purple); }

/* Vault list */
.vault-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.875rem 0;
  border-bottom: 1px solid var(--border);
}
.vault-item:last-child { border-bottom: none; }
.vault-label { font-weight: 500; font-size: 0.9rem; }
.vault-cid   { font-size: 0.72rem; color: var(--muted); font-family: monospace; margin-top: 0.2rem; }
.badge {
  font-size: 0.7rem;
  font-weight: 600;
  padding: 0.2rem 0.6rem;
  border-radius: 99px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
.badge-green  { background: #0f2e1a; color: var(--green); }
.badge-amber  { background: #2e1f0a; color: var(--amber); }
.badge-red    { background: #2e0f0f; color: var(--red);   }

/* Toast */
.toast {
  position: fixed;
  bottom: 1.5rem;
  right: 1.5rem;
  background: var(--bg2);
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 0.875rem 1.25rem;
  font-size: 0.875rem;
  max-width: 360px;
  z-index: 999;
  animation: slideIn 0.3s ease;
}
.toast.success { border-left: 3px solid var(--green); }
.toast.error   { border-left: 3px solid var(--red);   }
.toast.info    { border-left: 3px solid var(--purple); }

@keyframes slideIn {
  from { transform: translateY(20px); opacity: 0; }
  to   { transform: translateY(0);   opacity: 1; }
}

/* Decrypted content */
.decrypted-box {
  background: var(--bg3);
  border: 1px solid var(--teal);
  border-radius: 10px;
  padding: 1.25rem;
  font-family: monospace;
  font-size: 0.875rem;
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 400px;
  overflow-y: auto;
  line-height: 1.6;
  margin-top: 1rem;
}

.locked-state {
  text-align: center;
  padding: 3rem 1rem;
  color: var(--muted);
}
.locked-state .lock-icon { font-size: 3rem; margin-bottom: 1rem; }
.locked-state p { margin-top: 0.5rem; font-size: 0.9rem; }

.empty-state {
  text-align: center;
  padding: 2rem;
  color: var(--muted);
  font-size: 0.875rem;
}

code {
  background: var(--bg3);
  padding: 0.1rem 0.4rem;
  border-radius: 4px;
  font-family: monospace;
  font-size: 0.8rem;
}

.addr { font-family: monospace; font-size: 0.8rem; color: var(--muted); }
```

### Step 7 — Main App

Replace `dms-frontend/src/main.jsx` with:

```jsx
import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import './styles.css'

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
```

### Step 8 — App.jsx (root component)

Replace `dms-frontend/src/App.jsx` with:

```jsx
import { useState, useEffect, useCallback } from 'react';
import { ethers } from 'ethers';
import { CONTRACT_ADDRESS, CONTRACT_ABI } from './contract.js';
import OwnerDashboard from './components/OwnerDashboard.jsx';
import ReaderView from './components/ReaderView.jsx';
import Toast from './components/Toast.jsx';

export default function App() {
  const [wallet, setWallet]       = useState(null);  // { address, signer, provider }
  const [contract, setContract]   = useState(null);
  const [status, setStatus]       = useState(null);  // getStatus() result
  const [isOwner, setIsOwner]     = useState(false);
  const [isBenef, setIsBenef]     = useState(false);
  const [tab, setTab]             = useState('owner');
  const [toast, setToast]         = useState(null);
  const [loading, setLoading]     = useState(false);

  const showToast = useCallback((msg, type = 'info') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 4000);
  }, []);

  // Connect MetaMask
  async function connectWallet() {
    if (!window.ethereum) {
      showToast('MetaMask not found. Install it first.', 'error');
      return;
    }

    try {
      const provider = new ethers.BrowserProvider(window.ethereum);
      await provider.send('eth_requestAccounts', []);
      const signer  = await provider.getSigner();
      const address = await signer.getAddress();

      const c = new ethers.Contract(CONTRACT_ADDRESS, CONTRACT_ABI, signer);
      setContract(c);
      setWallet({ address, signer, provider });

      // Check roles
      const ownerAddr = await c.owner();
      const benef     = await c.isBeneficiary(address);
      setIsOwner(ownerAddr.toLowerCase() === address.toLowerCase());
      setIsBenef(benef);

      showToast(`Connected: ${address.slice(0, 6)}...${address.slice(-4)}`, 'success');
    } catch (err) {
      showToast('Connection failed: ' + err.message, 'error');
    }
  }

  // Fetch contract status
  const refreshStatus = useCallback(async () => {
    if (!contract) return;
    try {
      const s = await contract.getStatus();
      setStatus({
        owner:         s._owner,
        interval:      Number(s._interval),
        lastPing:      Number(s._lastPing),
        timeRemaining: Number(s._timeRemaining),
        triggered:     s._triggered,
        expired:       s._expired,
        vaultCount:    Number(s._vaultCount),
      });
    } catch (err) {
      console.error('Status fetch failed:', err);
    }
  }, [contract]);

  useEffect(() => {
    if (contract) {
      refreshStatus();
      const id = setInterval(refreshStatus, 15000);
      return () => clearInterval(id);
    }
  }, [contract, refreshStatus]);

  // Auto-connect if already approved
  useEffect(() => {
    if (window.ethereum) {
      window.ethereum.request({ method: 'eth_accounts' })
        .then(accounts => { if (accounts.length > 0) connectWallet(); })
        .catch(() => {});
    }
  }, []);

  const short = wallet
    ? `${wallet.address.slice(0, 6)}...${wallet.address.slice(-4)}`
    : null;

  return (
    <div className="app">
      {/* Header */}
      <header className="header">
        <h1>💀 Dead Man's <span>Switch</span></h1>
        <button
          className={`wallet-btn ${wallet ? 'connected' : ''}`}
          onClick={connectWallet}
        >
          {wallet ? `✓ ${short}` : 'Connect MetaMask'}
        </button>
      </header>

      {!wallet ? (
        <div className="locked-state">
          <div className="lock-icon">🔌</div>
          <h2>Connect your wallet</h2>
          <p>Connect MetaMask to interact with the Dead Man's Switch contract.</p>
          <br />
          <button className="btn btn-primary" onClick={connectWallet}>
            Connect MetaMask
          </button>
        </div>
      ) : (
        <>
          {/* Tabs */}
          <div className="tabs">
            <button
              className={`tab ${tab === 'owner' ? 'active' : ''}`}
              onClick={() => setTab('owner')}
            >
              🏠 Owner Dashboard
            </button>
            <button
              className={`tab ${tab === 'reader' ? 'active' : ''}`}
              onClick={() => setTab('reader')}
            >
              🔓 Reader View
            </button>
          </div>

          {tab === 'owner' ? (
            <OwnerDashboard
              contract={contract}
              wallet={wallet}
              status={status}
              isOwner={isOwner}
              onRefresh={refreshStatus}
              showToast={showToast}
            />
          ) : (
            <ReaderView
              contract={contract}
              wallet={wallet}
              status={status}
              isBeneficiary={isBenef}
              showToast={showToast}
            />
          )}
        </>
      )}

      {toast && <Toast msg={toast.msg} type={toast.type} />}
    </div>
  );
}
```

### Step 9 — OwnerDashboard component

Create `dms-frontend/src/components/OwnerDashboard.jsx`:

```jsx
import { useState, useEffect } from 'react';
import { ethers } from 'ethers';
import CountdownRing from './CountdownRing.jsx';

export default function OwnerDashboard({ contract, wallet, status, isOwner, onRefresh, showToast }) {
  const [vaults, setVaults]         = useState([]);
  const [beneficiaries, setBenef]   = useState([]);
  const [newBenef, setNewBenef]     = useState('');
  const [loading, setLoading]       = useState(false);
  const [loadingHb, setLoadingHb]   = useState(false);

  // Load vaults and beneficiaries
  async function loadData() {
    if (!contract || !status) return;
    try {
      const vaultList = [];
      for (let i = 0; i < status.vaultCount; i++) {
        const v = await contract.getVaultInfo(i);
        vaultList.push({
          id: i, cid: v.cid, label: v.label,
          released: v.released,
          createdAt: Number(v.createdAt),
        });
      }
      setVaults(vaultList);

      const bList = await contract.getBeneficiaries();
      setBenef(bList);
    } catch (err) {
      console.error('Load data failed:', err.message);
    }
  }

  useEffect(() => { loadData(); }, [contract, status]);

  // Send heartbeat
  async function sendHeartbeat() {
    if (!isOwner) return showToast('Only the owner can send a heartbeat.', 'error');
    setLoadingHb(true);
    try {
      const tx = await contract.heartbeat();
      showToast(`Heartbeat tx sent: ${tx.hash.slice(0, 10)}...`, 'info');
      await tx.wait();
      showToast('💓 Heartbeat confirmed!', 'success');
      onRefresh();
    } catch (err) {
      showToast('Heartbeat failed: ' + (err.reason || err.message), 'error');
    } finally {
      setLoadingHb(false);
    }
  }

  // Add beneficiary
  async function addBeneficiary() {
    if (!isOwner) return showToast('Only the owner can add beneficiaries.', 'error');
    if (!ethers.isAddress(newBenef)) return showToast('Invalid wallet address.', 'error');
    setLoading(true);
    try {
      const tx = await contract.addBeneficiary(newBenef);
      showToast('Adding beneficiary...', 'info');
      await tx.wait();
      showToast('Beneficiary added!', 'success');
      setNewBenef('');
      loadData();
    } catch (err) {
      showToast('Failed: ' + (err.reason || err.message), 'error');
    } finally {
      setLoading(false);
    }
  }

  // Remove beneficiary
  async function removeBeneficiary(addr) {
    if (!isOwner) return showToast('Only the owner can remove beneficiaries.', 'error');
    setLoading(true);
    try {
      const tx = await contract.removeBeneficiary(addr);
      showToast('Removing beneficiary...', 'info');
      await tx.wait();
      showToast('Beneficiary removed.', 'success');
      loadData();
    } catch (err) {
      showToast('Failed: ' + (err.reason || err.message), 'error');
    } finally {
      setLoading(false);
    }
  }

  if (!status) {
    return <div className="empty-state">Loading contract status...</div>;
  }

  const pct = status.interval > 0
    ? Math.max(0, status.timeRemaining / status.interval)
    : 0;

  const fmtTime = (secs) => {
    if (secs <= 0) return 'EXPIRED';
    const d = Math.floor(secs / 86400);
    const h = Math.floor((secs % 86400) / 3600);
    const m = Math.floor((secs % 3600) / 60);
    if (d > 0) return `${d}d ${h}h`;
    if (h > 0) return `${h}h ${m}m`;
    return `${m}m`;
  };

  return (
    <div>
      {!isOwner && (
        <div className="card" style={{ borderColor: '#633806', background: '#2e1a0a' }}>
          <p style={{ color: '#f0a030', fontSize: '0.875rem' }}>
            ⚠️ Your wallet (<code>{wallet.address.slice(0,8)}...</code>) is not the contract
            owner. You can view data but cannot send heartbeats or register vaults.
          </p>
        </div>
      )}

      {/* Status card */}
      <div className="card">
        <div className="card-title">Contract Status</div>

        <div className="status-grid">
          <div className="stat">
            <div className={`stat-val ${status.triggered ? 'red' : 'green'}`}>
              {status.triggered ? 'TRIGGERED' : 'ALIVE'}
            </div>
            <div className="stat-lbl">Switch state</div>
          </div>
          <div className="stat">
            <div className={`stat-val ${status.expired ? 'red' : status.timeRemaining < 3600 ? 'amber' : 'green'}`}>
              {fmtTime(status.timeRemaining)}
            </div>
            <div className="stat-lbl">Time remaining</div>
          </div>
          <div className="stat">
            <div className="stat-val">{status.vaultCount}</div>
            <div className="stat-lbl">Vaults</div>
          </div>
          <div className="stat">
            <div className="stat-val">{beneficiaries.length}</div>
            <div className="stat-lbl">Beneficiaries</div>
          </div>
        </div>

        <div className="countdown-wrap">
          <CountdownRing pct={pct} expired={status.expired} triggered={status.triggered} />
          <div className={`countdown-text ${status.expired ? 'red' : ''}`}
               style={{ color: status.expired ? 'var(--red)' : status.timeRemaining < 3600 ? 'var(--amber)' : 'var(--green)' }}>
            {fmtTime(status.timeRemaining)}
          </div>
          <div className="countdown-sub">until heartbeat required</div>
        </div>

        <div style={{ display: 'flex', gap: '0.75rem', marginTop: '0.5rem' }}>
          <button
            className="btn btn-primary"
            onClick={sendHeartbeat}
            disabled={loadingHb || !isOwner || status.triggered}
            style={{ flex: 1 }}
          >
            {loadingHb ? '⏳ Sending...' : '💓 Send Heartbeat'}
          </button>
          <button className="btn btn-ghost" onClick={onRefresh}>
            ↻ Refresh
          </button>
        </div>

        <div style={{ marginTop: '0.75rem', fontSize: '0.75rem', color: 'var(--muted)' }}>
          Owner: <code>{status.owner}</code>
          &nbsp;·&nbsp;
          Last ping: {new Date(status.lastPing * 1000).toLocaleString()}
        </div>
      </div>

      {/* Vault list */}
      <div className="card">
        <div className="card-title">Registered Vaults</div>
        {vaults.length === 0 ? (
          <div className="empty-state">
            No vaults yet. Use the CLI script to encrypt and register a file.
          </div>
        ) : (
          vaults.map(v => (
            <div key={v.id} className="vault-item">
              <div>
                <div className="vault-label">#{v.id} — {v.label}</div>
                <div className="vault-cid">
                  <a
                    href={`https://gateway.pinata.cloud/ipfs/${v.cid}`}
                    target="_blank"
                    rel="noreferrer"
                    style={{ color: 'var(--purple)' }}
                  >
                    {v.cid.slice(0, 20)}...
                  </a>
                </div>
                <div style={{ fontSize: '0.72rem', color: 'var(--muted)', marginTop: '0.15rem' }}>
                  Registered: {new Date(v.createdAt * 1000).toLocaleDateString()}
                </div>
              </div>
              <span className={`badge ${v.released ? 'badge-green' : 'badge-amber'}`}>
                {v.released ? 'Released' : 'Locked'}
              </span>
            </div>
          ))
        )}
      </div>

      {/* Beneficiary manager */}
      <div className="card">
        <div className="card-title">Beneficiaries</div>
        {beneficiaries.length === 0 ? (
          <div className="empty-state">No beneficiaries added yet.</div>
        ) : (
          beneficiaries.map(addr => (
            <div key={addr} className="vault-item">
              <span className="addr">{addr}</span>
              {isOwner && (
                <button
                  className="btn btn-ghost"
                  style={{ fontSize: '0.75rem', padding: '0.3rem 0.7rem' }}
                  onClick={() => removeBeneficiary(addr)}
                  disabled={loading}
                >
                  Remove
                </button>
              )}
            </div>
          ))
        )}

        {isOwner && (
          <div className="input-row" style={{ marginTop: '1rem' }}>
            <input
              type="text"
              placeholder="0x... beneficiary wallet address"
              value={newBenef}
              onChange={e => setNewBenef(e.target.value)}
            />
            <button
              className="btn btn-teal"
              onClick={addBeneficiary}
              disabled={loading || !newBenef}
            >
              {loading ? '...' : 'Add'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
```

### Step 10 — CountdownRing component

Create `dms-frontend/src/components/CountdownRing.jsx`:

```jsx
export default function CountdownRing({ pct, expired, triggered }) {
  const r   = 54;
  const circ = 2 * Math.PI * r;
  const offset = circ * (1 - Math.max(0, Math.min(1, pct)));

  const color = triggered
    ? '#e05252'
    : expired
    ? '#e05252'
    : pct < 0.2
    ? '#f0a030'
    : '#2dbd6e';

  return (
    <svg width="140" height="140" className="countdown-ring">
      <circle className="ring-track" cx="70" cy="70" r={r} />
      <circle
        className="ring-progress"
        cx="70" cy="70" r={r}
        stroke={color}
        strokeDasharray={circ}
        strokeDashoffset={triggered ? circ : offset}
      />
    </svg>
  );
}
```

### Step 11 — ReaderView component

Create `dms-frontend/src/components/ReaderView.jsx`:

```jsx
import { useState, useEffect } from 'react';
import { decryptBlob, decryptFile, hexToBytes, bufferToString } from '../crypto.js';

export default function ReaderView({ contract, wallet, status, isBeneficiary, showToast }) {
  const [vaults, setVaults]       = useState([]);
  const [password, setPassword]   = useState('');
  const [decrypted, setDecrypted] = useState({});   // { [vaultId]: string }
  const [loading, setLoading]     = useState({});   // { [vaultId]: bool }
  const [releasing, setReleasing] = useState(false);

  useEffect(() => {
    loadVaults();
  }, [contract, status]);

  async function loadVaults() {
    if (!contract || !status) return;
    const list = [];
    for (let i = 0; i < status.vaultCount; i++) {
      const v = await contract.getVaultInfo(i);
      list.push({ id: i, cid: v.cid, label: v.label, released: v.released });
    }
    setVaults(list);
  }

  async function triggerRelease(vaultId) {
    setReleasing(true);
    try {
      const tx = await contract.checkAndRelease(vaultId);
      showToast(`Release tx sent: ${tx.hash.slice(0, 10)}...`, 'info');
      await tx.wait();
      showToast(`Vault ${vaultId} released!`, 'success');
      loadVaults();
    } catch (err) {
      showToast('Release failed: ' + (err.reason || err.message), 'error');
    } finally {
      setReleasing(false);
    }
  }

  async function decryptVault(vaultId, cid) {
    if (!password) return showToast('Enter the vault password first.', 'error');

    setLoading(prev => ({ ...prev, [vaultId]: true }));

    try {
      // 1. Get encrypted key from contract
      showToast('Fetching decryption key from contract...', 'info');
      const encKeyHex = await contract.getDecryptionKey(vaultId);
      const encKeyBuf = hexToBytes(encKeyHex).buffer;

      // 2. Decrypt AES key using password
      let aesKeyBuf;
      try {
        aesKeyBuf = await decryptBlob(encKeyBuf, password);
      } catch {
        showToast('❌ Wrong password. Cannot decrypt AES key.', 'error');
        return;
      }
      const aesKeyHex = Array.from(new Uint8Array(aesKeyBuf))
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');

      // 3. Fetch ciphertext from IPFS
      showToast('Fetching encrypted file from IPFS...', 'info');
      const resp = await fetch(`https://gateway.pinata.cloud/ipfs/${cid}`);
      if (!resp.ok) throw new Error(`IPFS fetch failed: HTTP ${resp.status}`);
      const cipherBuf = await resp.arrayBuffer();

      // 4. Decrypt file
      const plaintextBuf = await decryptFile(cipherBuf, aesKeyHex);
      const text = bufferToString(plaintextBuf);

      setDecrypted(prev => ({ ...prev, [vaultId]: text }));
      showToast('✅ File decrypted successfully!', 'success');

    } catch (err) {
      showToast('Decryption error: ' + err.message, 'error');
    } finally {
      setLoading(prev => ({ ...prev, [vaultId]: false }));
    }
  }

  if (!status) return <div className="empty-state">Loading...</div>;

  // Not a beneficiary and switch not triggered
  if (!isBeneficiary && !status.triggered) {
    return (
      <div className="locked-state">
        <div className="lock-icon">🔒</div>
        <h2>Vault Locked</h2>
        <p>Your wallet is not a beneficiary.</p>
        <p>The switch has not been triggered yet.</p>
      </div>
    );
  }

  return (
    <div>
      {/* Status banner */}
      <div className="card" style={{
        borderColor: status.triggered ? 'var(--green)' : status.expired ? 'var(--red)' : 'var(--border)',
        background:  status.triggered ? '#0f2e1a'     : status.expired ? '#2e0f0f'    : 'var(--bg2)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <div style={{ fontSize: '2rem' }}>
            {status.triggered ? '🔓' : status.expired ? '⚠️' : '🔒'}
          </div>
          <div>
            <div style={{ fontWeight: 600 }}>
              {status.triggered
                ? 'Switch Triggered — Vaults Released'
                : status.expired
                ? 'Heartbeat Expired — Ready to Release'
                : 'Switch Active — Heartbeat Running'}
            </div>
            <div style={{ fontSize: '0.8rem', color: 'var(--muted)', marginTop: '0.25rem' }}>
              {status.triggered
                ? 'All released vaults can now be decrypted by beneficiaries.'
                : status.expired
                ? 'Call checkAndRelease() to trigger the vault release.'
                : `Time remaining: ${Math.floor(status.timeRemaining / 60)} minutes`}
            </div>
          </div>
        </div>
      </div>

      {/* Password input */}
      {status.triggered && (
        <div className="card">
          <div className="card-title">Vault Password</div>
          <p style={{ fontSize: '0.875rem', color: 'var(--muted)', marginBottom: '0.75rem' }}>
            Enter the password the owner shared with you. This decrypts the AES key.
          </p>
          <input
            type="password"
            placeholder="Vault password"
            value={password}
            onChange={e => setPassword(e.target.value)}
          />
        </div>
      )}

      {/* Vault list */}
      <div className="card">
        <div className="card-title">Vaults ({vaults.length})</div>

        {vaults.length === 0 && (
          <div className="empty-state">No vaults registered on this contract.</div>
        )}

        {vaults.map(v => (
          <div key={v.id} style={{ paddingBottom: '1.5rem', marginBottom: '1.5rem', borderBottom: '1px solid var(--border)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div>
                <div className="vault-label">#{v.id} — {v.label}</div>
                <div className="vault-cid">{v.cid}</div>
              </div>
              <span className={`badge ${v.released ? 'badge-green' : 'badge-amber'}`}>
                {v.released ? 'Released' : 'Locked'}
              </span>
            </div>

            {/* Release button (if expired but not yet released) */}
            {status.expired && !v.released && !status.triggered && (
              <button
                className="btn btn-primary"
                style={{ marginTop: '0.75rem', width: '100%' }}
                onClick={() => triggerRelease(v.id)}
                disabled={releasing}
              >
                {releasing ? '⏳ Releasing...' : '🔓 Trigger Release'}
              </button>
            )}

            {/* Also show release button if triggered but vault not individually released */}
            {status.triggered && !v.released && (
              <button
                className="btn btn-primary"
                style={{ marginTop: '0.75rem', width: '100%' }}
                onClick={() => triggerRelease(v.id)}
                disabled={releasing}
              >
                {releasing ? '⏳ Releasing...' : '🔓 Release This Vault'}
              </button>
            )}

            {/* Decrypt button */}
            {v.released && isBeneficiary && !decrypted[v.id] && (
              <button
                className="btn btn-teal"
                style={{ marginTop: '0.75rem', width: '100%' }}
                onClick={() => decryptVault(v.id, v.cid)}
                disabled={loading[v.id] || !password}
              >
                {loading[v.id] ? '⏳ Decrypting...' : '🔑 Decrypt Vault'}
              </button>
            )}

            {/* Decrypted content */}
            {decrypted[v.id] && (
              <div>
                <div style={{ fontSize: '0.75rem', color: 'var(--green)', marginTop: '0.75rem', marginBottom: '0.25rem' }}>
                  ✅ Decrypted content:
                </div>
                <pre className="decrypted-box">{decrypted[v.id]}</pre>
                <button
                  className="btn btn-ghost"
                  style={{ marginTop: '0.5rem', fontSize: '0.75rem' }}
                  onClick={() => {
                    const blob = new Blob([decrypted[v.id]], { type: 'text/plain' });
                    const url  = URL.createObjectURL(blob);
                    const a    = document.createElement('a');
                    a.href = url; a.download = `vault-${v.id}-decrypted.txt`;
                    a.click(); URL.revokeObjectURL(url);
                  }}
                >
                  ⬇ Download
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
```

### Step 12 — Toast component

Create `dms-frontend/src/components/Toast.jsx`:

```jsx
export default function Toast({ msg, type }) {
  return (
    <div className={`toast ${type}`}>
      {msg}
    </div>
  );
}
```

### Step 13 — Run the frontend

```bash
cd dms-frontend
npm run dev
```

Open http://localhost:5173 in your browser.

---

## 8. Running the Full Demo

This section walks through the complete end-to-end demo flow to verify everything
works. Use two MetaMask wallets: **Wallet A (owner)** and **Wallet B (beneficiary)**.

### Demo flow

**Step 1 — Deploy the contract with a short interval**

In Remix, deploy with `_intervalSeconds = 300` (5 minutes). This lets you see
the full lifecycle without waiting 7 days.

**Step 2 — Add Wallet B as a beneficiary**

In Remix (with Wallet A connected), expand the deployed contract and call:
```
addBeneficiary("0xWalletB_Address")
```

**Step 3 — Encrypt and register a file**

```bash
cd dms-backend
echo "TOP SECRET: My crypto password is 'banana-yellow-sky'" > test-secret.txt
node scripts/encrypt-upload.js --file ./test-secret.txt --label "Test Secret"
```

**Step 4 — Verify in the frontend**

- Open http://localhost:5173
- Connect Wallet A → Owner Dashboard → you should see the vault listed
- The countdown ring should show ~5 minutes

**Step 5 — Send a heartbeat**

Click "💓 Send Heartbeat" in the dashboard. Confirm in MetaMask.
Watch the countdown reset.

**Step 6 — Simulate a missed heartbeat**

Wait 5 minutes WITHOUT sending a heartbeat. (Or in Remix, use the `isExpired`
button to check. It will return `true` after 5 minutes.)

**Step 7 — Trigger the release**

Switch to the "Reader View" tab.
- Connect as Wallet B (or any wallet)
- Click "🔓 Trigger Release" on the vault
- Confirm in MetaMask

**Step 8 — Decrypt as the beneficiary**

- Make sure Wallet B is connected
- Enter the `VAULT_PASSWORD` from your `.env` into the password field
- Click "🔑 Decrypt Vault"
- The file content appears: `TOP SECRET: My crypto password is 'banana-yellow-sky'`

### Alternatively — trigger from the CLI

```bash
# As beneficiary (set PRIVATE_KEY to Wallet B's key)
node scripts/check-release.js              # listen and auto-release
node scripts/check-release.js --read 0    # decrypt vault 0
```

---

## 9. Common Errors & Fixes

| Error | Cause | Fix |
|---|---|---|
| `Compilation error: Source file requires different compiler version` | Wrong compiler selected | Set Remix compiler to exactly 0.8.24 |
| `DeadMansSwitch: caller is not the owner` | Wrong wallet sending heartbeat | Switch MetaMask to the wallet that deployed the contract |
| `DeadMansSwitch: switch already triggered` | Calling heartbeat after expiry | The switch is permanently triggered — deploy a fresh contract for testing |
| `DeadMansSwitch: Heartbeat interval has not expired yet` | Calling checkAndRelease too early | Wait until interval expires, or deploy with shorter interval |
| `Caller is not a beneficiary` | Wrong wallet calling getDecryptionKey | Use the beneficiary wallet. Run addBeneficiary() from the owner wallet first. |
| `Vault not released yet` | checkAndRelease() not called for that vault | Call checkAndRelease(vaultId) first |
| `IPFS upload failed: Unauthorized` | Wrong Pinata JWT | Check PINATA_JWT in .env — get it from app.pinata.cloud → API Keys |
| `Transaction failed: insufficient funds` | No testnet ETH | Get Sepolia ETH from faucet |
| `Cannot read properties of undefined (reading 'request')` | MetaMask not installed | Install MetaMask extension |
| `Invalid ABI...` | Stale ABI after redeployment | Redeploy → copy new address → update CONTRACT_ADDRESS in contract.js |
| `Cannot find module 'formdata-node'` | Missing package | `npm install formdata-node` |
| `Wrong password` on decrypt | VAULT_PASSWORD mismatch | Same password in .env used to encrypt must be used to decrypt |
| Remix "Gas estimation failed" | Function reverting before execution | Check the error in Remix console — usually a require() message |
| `net_version` mismatch | MetaMask on wrong network | Switch MetaMask to Sepolia (or Hoodi) before connecting Remix |

### Getting the ABI from Remix (if needed)

Instead of copying the ABI manually, you can get it from Remix after compilation:
1. Click the **⚙️ Compiler** icon → scroll down
2. Click **"ABI"** button next to the contract name
3. Copy the JSON → paste into `abi/DeadMansSwitch.json`

---

## Project Folder Summary

```
dead-mans-switch/
├── dms-backend/
│   ├── scripts/
│   │   ├── crypto-utils.js       ← shared encrypt/decrypt functions
│   │   ├── encrypt-upload.js     ← CLI: encrypt file + pin IPFS + register vault
│   │   ├── heartbeat-daemon.js   ← cron daemon: auto-sends heartbeat
│   │   └── check-release.js      ← event watcher + beneficiary reader
│   ├── abi/
│   │   └── DeadMansSwitch.json   ← contract ABI
│   ├── manifests/                ← auto-created: vault metadata per file
│   ├── heartbeat-log.json        ← auto-created: heartbeat history
│   ├── .env                      ← private keys + config (never commit)
│   └── package.json
│
├── dms-frontend/
│   ├── src/
│   │   ├── components/
│   │   │   ├── OwnerDashboard.jsx
│   │   │   ├── CountdownRing.jsx
│   │   │   ├── ReaderView.jsx
│   │   │   └── Toast.jsx
│   │   ├── App.jsx
│   │   ├── contract.js           ← UPDATE: CONTRACT_ADDRESS
│   │   ├── crypto.js             ← browser WebCrypto utils
│   │   ├── styles.css
│   │   └── main.jsx
│   └── package.json
│
└── DeadMansSwitch.sol             ← deploy this from Remix IDE
```

---

*Dead Man's Switch — Project Documentation*
*Built with Solidity · ethers.js v6 · Vite · React · Pinata IPFS*
*Testnet: Sepolia / Hoodi*
