import os
import re

cwd = "/run/media/soham/DATA 2/TCET Files/BT/Prac 10 v2"
md_path = os.path.join(cwd, "DEAD_MANS_SWITCH_COMPLETE.md")

with open(md_path, 'r', encoding='utf-8') as f:
    content = f.read()

# Make directories
os.makedirs(os.path.join(cwd, "dms-backend", "scripts"), exist_ok=True)
os.makedirs(os.path.join(cwd, "dms-backend", "abi"), exist_ok=True)
os.makedirs(os.path.join(cwd, "dms-frontend", "src", "components"), exist_ok=True)

blocks = [m.group(1) for m in re.finditer(r'```[a-z]*\n(.*?)```', content, re.DOTALL)]

files_to_write = [
    ("pragma solidity ^0.8.24;", "DeadMansSwitch.sol"),
    ('"name": "dms-backend",', "dms-backend/package.json"),
    ("PRIVATE_KEY=0xYOUR_OWNER_WALLET_PRIVATE_KEY_HERE", "dms-backend/.env"),
    ('"inputs": [{ "internalType": "uint256"', "dms-backend/abi/DeadMansSwitch.json"),
    ("// crypto-utils.js", "dms-backend/scripts/crypto-utils.js"),
    ("// encrypt-upload.js", "dms-backend/scripts/encrypt-upload.js"),
    ("// heartbeat-daemon.js", "dms-backend/scripts/heartbeat-daemon.js"),
    ("// check-release.js", "dms-backend/scripts/check-release.js"),
    ("import { defineConfig } from 'vite'", "dms-frontend/vite.config.js"),
    ("<!doctype html>", "dms-frontend/index.html"),
    ("// contract.js — update these two values", "dms-frontend/src/contract.js"),
    ("// crypto.js — Browser-native", "dms-frontend/src/crypto.js"),
    ("/* styles.css */", "dms-frontend/src/styles.css"),
    ("import React from 'react'\nimport ReactDOM", "dms-frontend/src/main.jsx"),
    ("import { useState, useEffect, useCallback } from 'react';", "dms-frontend/src/App.jsx"),
    ("import CountdownRing from './CountdownRing.jsx';", "dms-frontend/src/components/OwnerDashboard.jsx"),
    ("export default function CountdownRing({", "dms-frontend/src/components/CountdownRing.jsx"),
    ("import { decryptBlob, decryptFile, hexToBytes, bufferToString }", "dms-frontend/src/components/ReaderView.jsx"),
    ("export default function Toast({ msg, type }) {", "dms-frontend/src/components/Toast.jsx"),
]

for identifier, filename in files_to_write:
    found = False
    for b in blocks:
        if identifier in b:
            with open(os.path.join(cwd, filename), "w", encoding='utf-8') as f:
                f.write(b)
            print(f"Wrote {filename}")
            found = True
            break
    if not found:
        print(f"COULD NOT FIND BLOCK FOR {filename}")

