import { useState } from 'react';
import { ethers } from 'ethers';

export default function CreateSwitchView({ factoryContract, showToast, onSwitchCreated }) {
  const [loading, setLoading] = useState(false);
  const [intervalDays, setIntervalDays] = useState(7);

  async function handleCreate() {
    if (intervalDays < 1) return showToast('Interval must be at least 1 day', 'error');
    
    setLoading(true);
    try {
      const intervalSeconds = intervalDays * 24 * 60 * 60;
      showToast('Please confirm the deployment in MetaMask...', 'info');
      
      const tx = await factoryContract.createSwitch(intervalSeconds);
      showToast(`Deploying new Dead Man's Switch: ${tx.hash.slice(0, 10)}...`, 'info');
      
      await tx.wait();
      showToast('🎉 Switch deployed successfully!', 'success');
      
      // Wait a moment and then check the factory again to load the new switch
      setTimeout(onSwitchCreated, 2000);
    } catch (err) {
      showToast('Deployment failed: ' + (err.reason || err.message), 'error');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="card" style={{ maxWidth: '500px', margin: '4rem auto', textAlign: 'center' }}>
      <div className="card-title" style={{ fontSize: '1.5rem', marginBottom: '1rem' }}>💀 Create Your Dead Man's Switch</div>
      <p style={{ color: 'var(--muted)', marginBottom: '2rem' }}>
        It looks like you don't have a switch deployed yet. Deploy your own personalized smart contract directly from the dashboard!
      </p>
      
      <div className="input-group" style={{ textAlign: 'left', marginBottom: '2rem' }}>
        <label style={{ display: 'block', marginBottom: '0.5rem', color: 'var(--muted)' }}>
          Heartbeat Interval (in days)
        </label>
        <input 
          type="number" 
          value={intervalDays}
          onChange={e => setIntervalDays(Number(e.target.value))}
          style={{ width: '100%', fontSize: '1.2rem', padding: '0.75rem' }}
          min="1"
        />
        <small style={{ display: 'block', marginTop: '0.5rem', color: '#888' }}>
          You must check in at least once every {intervalDays} days, otherwise your switch will trigger.
        </small>
      </div>

      <button className="btn btn-primary" onClick={handleCreate} disabled={loading} style={{ width: '100%', fontSize: '1.1rem', padding: '1rem' }}>
        {loading ? 'Deploying...' : 'Deploy My Switch'}
      </button>
    </div>
  );
}
