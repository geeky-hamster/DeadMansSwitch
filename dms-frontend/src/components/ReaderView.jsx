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
