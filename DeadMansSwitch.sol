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
    bool    public started;       // true once started
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
    constructor(address _owner, uint256 _intervalSeconds) {
        require(_intervalSeconds >= 60, "Interval must be at least 60 seconds");
        owner    = _owner;
        interval = _intervalSeconds;
        // Do not set startTime here, it starts completely dormant
    }

    // ─────────────────────────────────────────────────────────────
    //  Owner functions
    // ─────────────────────────────────────────────────────────────

    /**
     * @notice Sends a heartbeat. If not started yet, this activates the switch.
     */
    function heartbeat() external onlyOwner notTriggered {
        require(!isExpired(), "DeadMansSwitch: heartbeat window expired, switch cannot be revived");
        if (!started) {
            started = true;
        }
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
        if (!started) return false;
        return block.timestamp > lastPing + interval;
    }

    /**
     * @notice Seconds remaining until the switch can be triggered.
     *         Returns 0 if already expired.
     */
    function timeRemaining() external view returns (uint256) {
        if (!started || isExpired()) return 0;
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
        uint256 _vaultCount,
        bool    _started
    ) {
        return (
            owner,
            interval,
            lastPing,
            this.timeRemaining(),
            triggered,
            isExpired(),
            vaultCount,
            started
        );
    }
}
