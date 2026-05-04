// contract.js — update these two values after deploying

export const CONTRACT_ADDRESS = '0x34f3f7aff36a46c9EebC856bE662F29958E7d445'; // The exact user's switch (dynamically set in app now)

export const FACTORY_ADDRESS = '0x0000000000000000000000000000000000000000'; // Replace with Factory address after deployment

export const FACTORY_ABI = [
  'function createSwitch(uint256 _intervalSeconds) external',
  'function getMySwitch() external view returns (address)',
  'function userToSwitch(address) external view returns (address)',
  'event SwitchCreated(address indexed owner, address switchAddress, uint256 interval)'
];

export const CONTRACT_ABI = [
  'function heartbeat() external',
  'function started() external view returns (bool)',
  'function registerVault(string calldata _cid, bytes calldata _encryptedKey, string calldata _label) external',
  'function addBeneficiary(address _wallet) external',
  'function removeBeneficiary(address _wallet) external',
  'function checkAndRelease(uint256 _vaultId) external',
  'function getDecryptionKey(uint256 _vaultId) external view returns (bytes)',
  'function getVaultInfo(uint256 _vaultId) external view returns (string cid, string label, bool released, uint256 createdAt)',
  'function getStatus() external view returns (address _owner, uint256 _interval, uint256 _lastPing, uint256 _timeRemaining, bool _triggered, bool _expired, uint256 _vaultCount, bool _started)',
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
