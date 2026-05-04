import { useState, useEffect, useCallback } from 'react';
import { ethers } from 'ethers';
import { CONTRACT_ADDRESS, CONTRACT_ABI, FACTORY_ADDRESS, FACTORY_ABI } from './contract.js';
import OwnerDashboard from './components/OwnerDashboard.jsx';
import ReaderView from './components/ReaderView.jsx';
import CreateSwitchView from './components/CreateSwitchView.jsx';
import Toast from './components/Toast.jsx';

export default function App() {
  const [wallet, setWallet]       = useState(null);  // { address, signer, provider }
  const [contract, setContract]   = useState(null);
  const [factory, setFactory]     = useState(null);
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

      const factoryContract = new ethers.Contract(FACTORY_ADDRESS, FACTORY_ABI, signer);
      setFactory(factoryContract);
      setWallet({ address, signer, provider });

      // 1. Check URL for a specific switch
      const urlParams = new URLSearchParams(window.location.search);
      const switchFromUrl = urlParams.get('switch');

      let targetAddress = switchFromUrl;

      // 2. If no URL param, check if the owner has a switch deployed via factory
      if (!targetAddress && FACTORY_ADDRESS !== ethers.ZeroAddress) {
        try {
          const mySwitch = await factoryContract.getMySwitch();
          if (mySwitch !== ethers.ZeroAddress) {
            targetAddress = mySwitch;
            // Update URL silently
            window.history.pushState({}, '', `?switch=${targetAddress}`);
          }
        } catch (factoryErr) {
          console.warn('Factory lookup failed (may not be deployed):', factoryErr.message);
        }
      }

      // 3. If still no address, fall back to the hardcoded CONTRACT_ADDRESS
      if (!targetAddress && CONTRACT_ADDRESS && CONTRACT_ADDRESS !== ethers.ZeroAddress) {
        targetAddress = CONTRACT_ADDRESS;
        console.log('Using hardcoded CONTRACT_ADDRESS:', targetAddress);
      }

      // 4. Connect to the Switch if we found one
      if (targetAddress) {
        const c = new ethers.Contract(targetAddress, CONTRACT_ABI, signer);
        setContract(c);

        // Check roles
        const ownerAddr = await c.owner();
        const benef     = await c.isBeneficiary(address);
        setIsOwner(ownerAddr.toLowerCase() === address.toLowerCase());
        setIsBenef(benef);
      }

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
        started:       s._started,
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
      ) : !contract ? (
        <CreateSwitchView 
          factoryContract={factory} 
          showToast={showToast} 
          onSwitchCreated={connectWallet} // Re-run wallet connection to pick up the new switch
        />
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
