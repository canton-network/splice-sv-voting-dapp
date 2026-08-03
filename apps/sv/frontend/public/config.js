// Copyright (c) 2024 Digital Asset (Switzerland) GmbH and/or its affiliates. All rights reserved.
// SPDX-License-Identifier: Apache-2.0
window.splice_config = {
  // URL of SV API.
  // Edit this to match the SV you're trying to connect to.
  // Note that this gets overwritten in `start-frontends.sh`.
  // HMAC256-based auth with browser self-signed tokens
  auth: {
    algorithm: 'hs-256-unsafe',
    secret: 'test',
    token_audience: 'https://sv.example.com',
  },

  services: {
    sv: {
      url: 'http://localhost:5014/api/sv',
    },
  },

  spliceInstanceNames: {
    networkName: 'Splice',
    networkFaviconUrl: 'https://www.hyperledger.org/hubfs/hyperledgerfavicon.png',
    amuletName: 'Amulet',
    amuletNameAcronym: 'AMT',
    nameServiceName: 'Amulet Name Service',
    nameServiceNameAcronym: 'ANS',
  },

  // Optional dApp mode: CIP-103 wallet login, Scan reads, VoteDelegation submissions.
  // Uncomment and point at a reachable Scan + CIP-103 RPC to try locally.
  // dappMode: {
  //   enabled: 'true',
  //   scanUrl: 'http://scan.localhost:4000/api/scan',
  //   cip103RpcUrl: 'http://localhost:3030/api/v0/dapp',
  // },
};
