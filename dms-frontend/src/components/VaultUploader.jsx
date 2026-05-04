import { useState } from 'react';
import { encryptFile, encryptBlob, bytesToHex } from '../crypto.js';

export default function VaultUploader({ contract, showToast, onRefresh }) {
  const [file, setFile] = useState(null);
  const [text, setText] = useState('');
  const [label, setLabel] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [mode, setMode] = useState('file'); // 'file' or 'text'

  async function handleUpload() {
    if (!label) return showToast('Please provide a label', 'error');
    if (!password) return showToast('Please provide a vault password', 'error');
    if (mode === 'file' && !file) return showToast('Please select a file', 'error');
    if (mode === 'text' && !text) return showToast('Please enter some text', 'error');
    
    // Check for Pinata JWT
    const pinataJwt = import.meta.env.VITE_PINATA_JWT;
    if (!pinataJwt) {
      return showToast('VITE_PINATA_JWT is not set in your frontend .env file!', 'error');
    }

    setLoading(true);
    try {
      showToast('Encrypting data locally...', 'info');
      let dataBuffer;
      if (mode === 'file') {
        dataBuffer = await file.arrayBuffer();
      } else {
        dataBuffer = new TextEncoder().encode(text).buffer;
      }

      // 1. Encrypt the file data with a random AES key
      const { cipherBlob, aesKey } = await encryptFile(dataBuffer);

      // 2. Encrypt the AES key with the user's password
      const encryptedKeyBlob = await encryptBlob(aesKey, password);
      const encryptedKeyHex = bytesToHex(encryptedKeyBlob);

      // 3. Upload cipherBlob to Pinata
      showToast('Uploading encrypted blob to IPFS...', 'info');
      const form = new FormData();
      form.set('file', new Blob([cipherBlob]), label);
      form.set('pinataOptions', JSON.stringify({ cidVersion: 1 }));
      form.set('pinataMetadata', JSON.stringify({ name: label }));

      const res = await fetch('https://api.pinata.cloud/pinning/pinFileToIPFS', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${pinataJwt}`,
        },
        body: form,
      });

      if (!res.ok) throw new Error(`Pinata upload failed: ${await res.text()}`);
      const { IpfsHash } = await res.json();
      showToast(`Upload complete. CID: ${IpfsHash.slice(0, 15)}...`, 'success');

      // 4. Register Vault on Contract
      showToast('Waiting for wallet confirmation...', 'info');
      const tx = await contract.registerVault(IpfsHash, encryptedKeyHex, label);
      showToast(`Transaction sent! Waiting for confirmation...`, 'info');
      
      await tx.wait();
      showToast('✅ Vault successfully registered!', 'success');
      
      // Clear form
      setFile(null);
      setText('');
      setLabel('');
      setPassword('');
      onRefresh();

    } catch (err) {
      showToast('Failed: ' + (err.reason || err.message), 'error');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="card" style={{ marginTop: '1rem', borderStyle: 'dashed' }}>
      <div className="card-title">🔐 Create New Vault (In-Browser)</div>
      
      <div style={{ marginBottom: '1rem' }}>
        <button className={`btn ${mode==='file' ? 'btn-teal' : 'btn-ghost'}`} onClick={() => setMode('file')}>Upload File</button>
        <button className={`btn ${mode==='text' ? 'btn-teal' : 'btn-ghost'}`} onClick={() => setMode('text')}>Write Secret</button>
      </div>

      <div className="input-group" style={{ marginBottom: '1rem' }}>
        {mode === 'file' ? (
          <input type="file" onChange={e => setFile(e.target.files[0])} />
        ) : (
          <textarea 
            placeholder="Write your final wishes, seed phrases, or secrets here..." 
            value={text} 
            onChange={e => setText(e.target.value)}
            rows={4}
            style={{ width: '100%', padding: '0.5rem', background: '#1a1a1a', color: 'white', border: '1px solid #333' }}
          />
        )}
      </div>

      <div className="input-group" style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem' }}>
        <input 
          type="text" 
          placeholder="Vault Label (e.g. My Will)" 
          value={label} 
          onChange={e => setLabel(e.target.value)} 
          style={{ flex: 1 }}
        />
        <input 
          type="password" 
          placeholder="Vault Password" 
          value={password} 
          onChange={e => setPassword(e.target.value)} 
          style={{ flex: 1 }}
        />
      </div>

      <button className="btn btn-primary" style={{ width: '100%' }} onClick={handleUpload} disabled={loading}>
        {loading ? 'Encrypting & Uploading...' : 'Encrypt & Register Vault'}
      </button>
    </div>
  );
}
