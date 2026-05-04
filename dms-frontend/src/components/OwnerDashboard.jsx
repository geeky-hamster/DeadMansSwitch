import { useState, useEffect } from 'react';
import { ethers } from 'ethers';
import CountdownRing from './CountdownRing.jsx';
import VaultUploader from './VaultUploader.jsx';

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

  // Heartbeat / Start
  async function sendHeartbeat() {
    if (!isOwner) return showToast('Only the owner can start/heartbeat.', 'error');
    setLoadingHb(true);
    try {
      const tx = await contract.heartbeat();
      showToast(`${status.started ? 'Heartbeat' : 'Start'} tx sent: ${tx.hash.slice(0, 10)}...`, 'info');
      await tx.wait();
      showToast(`🚀 ${status.started ? 'Heartbeat' : 'Timer started'} successfully!`, 'success');
      onRefresh();
    } catch (err) {
      showToast('Failed to start/heartbeat: ' + (err.reason || err.message), 'error');
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
    const s = Math.floor(secs % 60);
    if (d > 0) return `${d}d ${h}h`;
    if (h > 0) return `${h}h ${m}m`;
    if (m > 0) return `${m}m ${s}s`;
    return `${s}s`;
  };

  return (
    <div>
      {!isOwner && (
        <div className="card" style={{ borderColor: '#633806', background: '#2e1a0a' }}>
          <p style={{ color: '#f0a030', fontSize: '0.875rem' }}>
            ⚠️ Your wallet (<code>{wallet.address.slice(0,8)}...</code>) is not the contract
            owner. You can view data but cannot start the switch or register vaults.
          </p>
        </div>
      )}

      {/* Status card */}
      <div className="card">
        <div className="card-title">Contract Status</div>

        <div className="status-grid">
          <div className="stat">
            <div className={`stat-val ${status.triggered ? 'red' : !status.started ? 'amber' : 'green'}`}>
              {status.triggered ? 'TRIGGERED' : (!status.started ? 'INACTIVE' : 'ALIVE')}
            </div>
            <div className="stat-lbl">Switch state</div>
          </div>
          <div className="stat">
            <div className={`stat-val ${!status.started ? 'amber' : status.expired ? 'red' : status.timeRemaining < 3600 ? 'amber' : 'green'}`}>
              {!status.started ? 'N/A' : fmtTime(status.timeRemaining)}
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
            {!status.started ? 'DORMANT' : fmtTime(status.timeRemaining)}
          </div>
          <div className="countdown-sub">{!status.started ? 'awaiting start' : 'until release'}</div>
        </div>

        <div style={{ display: 'flex', gap: '0.75rem', marginTop: '0.5rem' }}>
          <button
            className="btn btn-primary"
            onClick={sendHeartbeat}
            disabled={loadingHb || !isOwner || status.triggered || (status.started && status.expired)}
            style={{ flex: 1 }}
          >
            {loadingHb ? '⏳ Sending...' : (status.started && status.expired) ? '💀 EXPIRED — Cannot Revive' : (!status.started ? '🚀 Start Timer & First Heartbeat' : '💓 Send Heartbeat')}
          </button>
          <button className="btn btn-ghost" onClick={onRefresh}>
            ↻ Refresh
          </button>
        </div>

        <div style={{ marginTop: '0.75rem', fontSize: '0.75rem', color: 'var(--muted)' }}>
          Owner: <code>{status.owner}</code>
          &nbsp;·&nbsp;
          Last ping: {status.lastPing > 0 ? new Date(status.lastPing * 1000).toLocaleString() : 'Not started'}
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

      {isOwner && (
        <VaultUploader contract={contract} showToast={showToast} onRefresh={onRefresh} />
      )}

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
