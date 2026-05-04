# Dead Man's Switch — Complete Run Guide & Demo Workflow

This guide covers how to set up, configure, and run the complete End-to-End Demo for the Dead Man's Switch project on both **Windows** and **Linux**.

> [!NOTE]
> The backend and frontend are entirely cross-platform since they run on Node.js. The primary difference between Windows and Linux will just be how you open your terminal and manage your environment variables.

---

## 🛠️ Prerequisites

Before you begin, ensure you have the following installed on your machine:
1. **Node.js (v20+)**: [Download here](https://nodejs.org/)
2. **VS Code**: [Download here](https://code.visualstudio.com/) (or your preferred IDE)
3. **MetaMask Extension**: Installed in Chrome, Firefox, or Edge.
4. **Git Bash (Windows Only)**: Highly recommended for Windows users to use a Linux-like terminal within VS Code.

---

## 🦊 Part 1: Wallet & Testnet Setup

You need **two** wallet addresses for the demo: 
- **Wallet A (Owner)**: Deploys the contract, creates the vault, and sends heartbeats.
- **Wallet B (Beneficiary)**: Triggers the release and decrypts the vault.

1. Open MetaMask and create a second account (Account switcher → Create Account).
2. Enable Test Networks: `Settings` → `Advanced` → `Show test networks` (Toggle ON).
3. Switch your network to **Sepolia** (or manually add Hoodi if you prefer).
4. **Get Testnet Funds**: 
   - Get Sepolia ETH from [Google Cloud Faucet](https://cloud.google.com/application/web3/faucet/ethereum/sepolia) or [Alchemy Faucet](https://sepoliafaucet.com/). You only need funds in Wallet A to deploy and register.

> [!IMPORTANT]
> Export the **Private Key** of Wallet A (Owner). You will need this for the backend `.env` file. (MetaMask → Account Details → Show Private Key).

---

## 📜 Part 2: Smart Contract Deployment (Remix IDE)

1. Open your browser and go to [Remix IDE](https://remix.ethereum.org/).
2. Under the **File Explorer**, create a new file named `DeadMansSwitch.sol`.
3. Open `DeadMansSwitch.sol` from your local folder in VS Code, copy the entire code, and paste it into Remix.
4. Go to the **Solidity Compiler** tab (2nd icon):
   - Compiler Version: `0.8.24`
   - Click **Compile DeadMansSwitch.sol**.
5. Go to the **Deploy & Run** tab (4th icon):
   - **Environment**: Select `Injected Provider - MetaMask`. (MetaMask will pop up, connect it using Wallet A).
   - **Contract**: Select `DeadMansSwitch`.
   - **Deploy parameter (_intervalSeconds)**: Enter `300` (This sets a 5-minute heartbeat interval, perfect for the demo).
   - Click **Deploy** and confirm the transaction in MetaMask.
6. Once deployed, copy the **Contract Address** from the "Deployed Contracts" section at the bottom.

---

## 💻 Part 3: Local Setup (VS Code)

Open the parent directory of the project in **VS Code**. 
* **Linux**: Open terminal and run `code .`
* **Windows**: Open VS Code, `File` → `Open Folder`. Open a terminal in VS Code (`Ctrl` + `~`). For Windows, ensure your terminal profile is set to Git Bash, Command Prompt, or PowerShell.

### 1. Configure Environment Variables
Navigate to `dms-backend/.env` and fill it out:

```env
PRIVATE_KEY=0x<YOUR_WALLET_A_PRIVATE_KEY>
RPC_URL=https://sepolia.infura.io/v3/<YOUR_INFURA_PROJECT_ID>  # Or use a public RPC
CONTRACT_ADDRESS=<DEPLOYED_CONTRACT_ADDRESS_FROM_REMIX>
PINATA_JWT=<YOUR_PINATA_JWT_TOKEN> # Get from pinata.cloud
VAULT_PASSWORD=my-super-secret-password-123
```
*(Also, open `dms-frontend/src/contract.js` and paste your deployed contract address in the `CONTRACT_ADDRESS` constant.)*

### 2. Start the Frontend
Open a terminal in VS Code and run:
**Linux & Windows:**
```bash
cd dms-frontend
npm run dev
```
> The app will be available at `http://localhost:5173`. Open it in your browser.

### 3. Start the Heartbeat Daemon
Open a **second** terminal window in VS Code:
**Linux & Windows:**
```bash
cd dms-backend
node scripts/heartbeat-daemon.js
```
> [!TIP]
> This daemon will run in the background, automatically pinging the contract to reset the 5-minute timer so your vault doesn't unlock prematurely. Keep this running!

---

## 🚀 Part 4: The Demo Workflow (End-to-End)

Now that everything is running, let's walk through the exact lifecycle of the application.

### Step 1: Add the Beneficiary
1. Go back to **Remix IDE**.
2. Under your deployed contract, find the `addBeneficiary` function.
3. Paste the address of **Wallet B** and click "transact". Confirm in MetaMask.

### Step 2: Encrypt and Register a Vault
We will use the backend CLI to locally encrypt a file and register it on the blockchain.

Open a **third** terminal window in VS Code:
**Linux & Windows:**
```bash
cd dms-backend
# Create a dummy file
echo "Here are my final wishes and my seed phrase: apple banana orange..." > final_words.txt

# Run the upload and encrypt script
node scripts/encrypt-upload.js --file ./final_words.txt --label "My Final Words"
```
> The script will encrypt the file locally, push the ciphertext to IPFS, encrypt the decryption key, and store it on your smart contract.

### Step 3: Monitor on the Frontend
1. Go to `http://localhost:5173`.
2. Connect MetaMask using **Wallet A** (The Owner).
3. You will see the **Owner Dashboard**.
   - Your vault should be visible.
   - The status should say **ALIVE**.
   - The countdown ring should show the time until the next required heartbeat.

### Step 4: Simulate a "Missed Heartbeat" (The "Dead Man" Scenario)
To see the switch trigger, we must simulate that the owner has stopped checking in.

1. Go to the terminal where your **Heartbeat Daemon** (`node scripts/heartbeat-daemon.js`) is running.
2. **Stop the daemon**:
   - **Linux**: Press `Ctrl + C`
   - **Windows**: Press `Ctrl + C`
3. Wait for the 5-minute interval you set during deployment to expire. You can watch the countdown hit zero on your frontend Owner Dashboard.

### Step 5: Trigger the Release (As Beneficiary)
Once the time has expired, the vault is ready to be unlocked.

1. In your browser extension, switch MetaMask to **Wallet B (Beneficiary)**.
2. In the frontend app, click the **"Reader View"** tab.
3. Because the timer has expired, the status banner will show **Heartbeat Expired — Ready to Release**.
4. Click the **"🔓 Trigger Release"** button next to the vault.
5. Confirm the transaction in MetaMask.

> [!NOTE]
> Alternatively, you can run the watcher script in your terminal to trigger it automatically: `node scripts/check-release.js`

### Step 6: Decrypt and Reveal 
1. Once the release transaction is confirmed, the status will change to **Switch Triggered — Vaults Released**.
2. A password input field will appear. Enter the `VAULT_PASSWORD` (e.g., `my-super-secret-password-123`). This is the password you shared with your beneficiary in the real world.
3. Click **"🔑 Decrypt Vault"**.
4. The frontend will fetch the ciphertext from IPFS, pull the encrypted AES key from the smart contract, decrypt it locally in your browser, and reveal your file!

```text
✅ Decrypted content:
Here are my final wishes and my seed phrase: apple banana orange...
```

You have successfully completed the Dead Man's Switch lifecycle! 🎉
