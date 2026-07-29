// Copyright (c) 2024 Digital Asset (Switzerland) GmbH and/or its affiliates. All rights reserved.
// SPDX-License-Identifier: Apache-2.0
import type {
  AccountsChangedEvent,
  ConnectResult,
  DappSDK,
  ListAccountsResult,
  PrepareExecuteAndWaitResult,
  PrepareExecuteParams,
} from '@canton-network/dapp-sdk';

/**
 * Narrow facade over `@canton-network/dapp-sdk` (CIP-103) used by dApp mode.
 * All wallet-gateway interaction goes through this module so tests can mock a
 * single seam.
 *
 * The SDK is loaded lazily via a dynamic import: standard mode must never pull
 * wallet code (and its transitive Lit dependency) into the page — Lit logs a
 * dev-mode console warning that trips the strict console assertions in the
 * frontend integration tests, and the SDK is dead weight without a wallet.
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
  let sdkPromise: Promise<DappSDK> | undefined;

  const getSdk = (): Promise<DappSDK> => {
    if (!sdkPromise) {
      sdkPromise = (async () => {
        const { DappSDK, RemoteAdapter } = await import('@canton-network/dapp-sdk');
        const sdk = new DappSDK();
        await sdk.init({
          additionalAdapters: [
            new RemoteAdapter({
              rpcUrl: walletGatewayUrl,
              name: 'Wallet Gateway',
              description: 'Configured via splice_config dappMode.walletGatewayUrl',
            }),
          ],
        });
        return sdk;
      })();
    }
    return sdkPromise;
  };

  return {
    walletGatewayUrl,
    async init(): Promise<void> {
      await getSdk();
    },
    async connect(): Promise<ConnectResult> {
      return (await getSdk()).connect();
    },
    async disconnect(): Promise<void> {
      if (!sdkPromise) {
        return;
      }
      await (await getSdk()).disconnect();
    },
    async isConnected(): Promise<ConnectResult> {
      return (await getSdk()).isConnected();
    },
    async listAccounts(): Promise<ListAccountsResult> {
      return (await getSdk()).listAccounts();
    },
    async onAccountsChanged(listener: (accounts: AccountsChangedEvent) => void): Promise<void> {
      (await getSdk()).onAccountsChanged(listener);
    },
    async removeOnAccountsChanged(
      listener: (accounts: AccountsChangedEvent) => void
    ): Promise<void> {
      if (!sdkPromise) {
        return;
      }
      (await getSdk()).removeOnAccountsChanged(listener);
    },
    async prepareExecuteAndWait(
      params: PrepareExecuteParams
    ): Promise<PrepareExecuteAndWaitResult> {
      return (await getSdk()).prepareExecuteAndWait(params);
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
