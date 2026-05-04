// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./DeadMansSwitch.sol";

/**
 * @title DeadMansSwitchFactory
 * @dev A factory contract to deploy individualized Dead Man's Switch contracts.
 *      This allows the React dashboard to act as a proper Web3 App where any
 *      user can create their own switch without needing Remix IDE.
 */
contract DeadMansSwitchFactory {
    
    // Mapping from a user's wallet address to their specific Switch contract
    mapping(address => address) public userToSwitch;
    
    // Optional: Keep track of all deployed switches
    address[] public allSwitches;

    event SwitchCreated(address indexed owner, address switchAddress, uint256 interval);

    /**
     * @notice Deploys a new DeadMansSwitch for the caller.
     * @param _intervalSeconds The heartbeat interval for the new switch.
     */
    function createSwitch(uint256 _intervalSeconds) external {
        // Ensure the user doesn't already have one (optional, but good practice for this app)
        require(userToSwitch[msg.sender] == address(0), "You already have a Dead Man's Switch deployed.");

        // Deploy the new switch, passing msg.sender as the owner!
        DeadMansSwitch newSwitch = new DeadMansSwitch(msg.sender, _intervalSeconds);
        
        address switchAddr = address(newSwitch);
        
        userToSwitch[msg.sender] = switchAddr;
        allSwitches.push(switchAddr);

        emit SwitchCreated(msg.sender, switchAddr, _intervalSeconds);
    }

    /**
     * @notice Returns the address of the caller's Dead Man's Switch.
     * @return The contract address, or 0x0 if they haven't created one.
     */
    function getMySwitch() external view returns (address) {
        return userToSwitch[msg.sender];
    }
}
