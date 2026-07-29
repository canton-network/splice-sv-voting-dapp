// Copyright (c) 2024 Digital Asset (Switzerland) GmbH and/or its affiliates. All rights reserved.
// SPDX-License-Identifier: Apache-2.0
import {
  DappSDK,
  RemoteAdapter,
  type AccountsChangedEvent,
  type ConnectResult,
  type ListAccountsResult,
  type PrepareExecuteAndWaitResult,
  type PrepareExecuteParams,
} from '@canton-network/dapp-sdk';

/**
 * Narrow facade over `@canton-network/dapp-sdk` (CIP-103) used by dApp mode.
 * All wallet-gateway interaction goes through this module so tests can mock a
 * single seam.
 */
export interface DappSdkClient {
  readonly walletGatewayUrl: string;
  init(): Promise<void>;
  connect(): Promise<ConnectResult>;
  disconnect(): Promise<void>;
  isConnected(): Promise<ConnectResult>;
  listAccounts(): Promise<ListAccountsResult>;
  onAccountsChanged(listener: (accounts: AccountsChangedEvent) => void): Promise<void>;
  removeOnAccountsChanged(listener: (accounts: AccountsChangedEvent) => void): Promise<void>;
  prepareExecuteAndWait(params: PrepareExecuteParams): Promise<PrepareExecuteAndWaitResult>;
}

const createClient = (walletGatewayUrl: string): DappSdkClient => {
  const sdk = new DappSDK();
  let initPromise: Promise<void> | undefined;

  const init = (): Promise<void> => {
    if (!initPromise) {
      initPromise = sdk
        .init({
          additionalAdapters: [
            new RemoteAdapter({
              rpcUrl: walletGatewayUrl,
              name: 'Wallet Gateway',
              description: 'Configured via splice_config dappMode.walletGatewayUrl',
            }),
          ],
        })
        .then(() => undefined);
    }
    return initPromise;
  };

  return {
    walletGatewayUrl,
    init,
    async connect(): Promise<ConnectResult> {
      await init();
      return sdk.connect();
    },
    async disconnect(): Promise<void> {
      await sdk.disconnect();
    },
    async isConnected(): Promise<ConnectResult> {
      await init();
      return sdk.isConnected();
    },
    async listAccounts(): Promise<ListAccountsResult> {
      await init();
      return sdk.listAccounts();
    },
    async onAccountsChanged(listener: (accounts: AccountsChangedEvent) => void): Promise<void> {
      await init();
      sdk.onAccountsChanged(listener);
    },
    async removeOnAccountsChanged(
      listener: (accounts: AccountsChangedEvent) => void
    ): Promise<void> {
      sdk.removeOnAccountsChanged(listener);
    },
    async prepareExecuteAndWait(
      params: PrepareExecuteParams
    ): Promise<PrepareExecuteAndWaitResult> {
      await init();
      return sdk.prepareExecuteAndWait(params);
    },
  };
};

let singleton: DappSdkClient | undefined;

/** App-wide client for the configured wallet gateway (one gateway per page load). */
export function getDappSdkClient(walletGatewayUrl: string): DappSdkClient {
  if (!singleton || singleton.walletGatewayUrl !== walletGatewayUrl) {
    singleton = createClient(walletGatewayUrl);
  }
  return singleton;
}

/** Test-only reset of the module-level singleton. */
export function resetDappSdkClientForTests(): void {
  singleton = undefined;
}
