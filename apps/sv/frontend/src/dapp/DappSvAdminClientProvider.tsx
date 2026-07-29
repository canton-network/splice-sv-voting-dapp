// Copyright (c) 2024 Digital Asset (Switzerland) GmbH and/or its affiliates. All rights reserved.
// SPDX-License-Identifier: Apache-2.0
import { useScanClient } from '@canton-network/splice-common-frontend/scan-api';
import React, { useMemo } from 'react';

import { SvAdminClient, SvAdminContext } from '../contexts/SvAdminServiceContext';
import { useDappModeConfig } from '../utils';
import { useWalletSession } from './WalletSessionContext';
import { createDappSvAdminClient } from './dappSvAdminClient';
import { DappModeUnsupportedError } from './dappSvAdminClient';

/**
 * Provides the SvAdminClient interface backed by Scan reads and wallet-gateway
 * submissions. Mounted in place of SvAdminClientProvider when dApp mode is on,
 * so the governance UI works unchanged.
 */
export const DappSvAdminClientProvider: React.FC<React.PropsWithChildren> = ({ children }) => {
  const dappMode = useDappModeConfig();
  if (!dappMode) {
    throw new Error('DappSvAdminClientProvider requires dappMode to be enabled in the app config');
  }
  const scanClient = useScanClient();
  const walletSession = useWalletSession();
  const voterPartyId = walletSession.voterPartyId;
  const isWalletConnected = walletSession.status === 'connected';
  const { scanUrl, walletGatewayUrl, svPartyId, voteDelegationCid, dsoGovernancePackageName } =
    dappMode;

  const client: SvAdminClient = useMemo(
    () =>
      createDappSvAdminClient({
        scanClient,
        dappMode: {
          scanUrl,
          walletGatewayUrl,
          svPartyId,
          voteDelegationCid,
          dsoGovernancePackageName,
        },
        voterPartyId,
        isWalletConnected,
        submitCastVote: () => Promise.reject(new DappModeUnsupportedError('castVote')),
        submitCreateVoteRequest: () =>
          Promise.reject(new DappModeUnsupportedError('createVoteRequest')),
      }),
    [
      scanClient,
      scanUrl,
      walletGatewayUrl,
      svPartyId,
      voteDelegationCid,
      dsoGovernancePackageName,
      voterPartyId,
      isWalletConnected,
    ]
  );

  return <SvAdminContext.Provider value={client}>{children}</SvAdminContext.Provider>;
};
