// Copyright (c) 2024 Digital Asset (Switzerland) GmbH and/or its affiliates. All rights reserved.
// SPDX-License-Identifier: Apache-2.0
import type { AccountsChangedEvent, Wallet } from '@canton-network/dapp-sdk';
import React, { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';

import { useDappModeConfig } from '../utils';
import { getDappSdkClient } from './dappSdkClient';

export type WalletConnectionStatus =
  | 'initializing'
  | 'connected'
  | 'disconnected'
  | 'wallet_connection_failed';

export interface WalletSession {
  status: WalletConnectionStatus;
  /** Party id of the connected wallet account — the VoteDelegation voterParty. */
  voterPartyId?: string;
  errorMessage?: string;
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
}

/** Prefer the wallet marked primary; otherwise the first authorized account. */
export const selectPrimaryWallet = (accounts: readonly Wallet[]): Wallet | undefined =>
  accounts.find(account => account.primary) ?? accounts[0];

export const formatWalletError = (error: unknown): string =>
  error instanceof Error && error.message.length > 0 ? error.message : 'Wallet connection failed';

const WalletSessionContext = React.createContext<WalletSession | undefined>(undefined);

/**
 * dApp-mode wallet session: initializes the CIP-103 SDK against the configured
 * wallet gateway, restores a persisted session on mount, and tracks the
 * connected voter party. Mounted only when dApp mode is enabled.
 */
export const WalletSessionProvider: React.FC<React.PropsWithChildren> = ({ children }) => {
  const dappMode = useDappModeConfig();
  if (!dappMode) {
    throw new Error('WalletSessionProvider requires dappMode to be enabled in the app config');
  }
  const walletGatewayUrl = dappMode.walletGatewayUrl;
  const client = useMemo(() => getDappSdkClient(walletGatewayUrl), [walletGatewayUrl]);

  const [status, setStatus] = useState<WalletConnectionStatus>('initializing');
  const [voterPartyId, setVoterPartyId] = useState<string | undefined>(undefined);
  const [errorMessage, setErrorMessage] = useState<string | undefined>(undefined);

  const applyAccounts = useCallback((accounts: readonly Wallet[]) => {
    const primary = selectPrimaryWallet(accounts);
    if (primary) {
      setVoterPartyId(primary.partyId);
      setStatus('connected');
    } else {
      setVoterPartyId(undefined);
      setStatus('disconnected');
    }
    setErrorMessage(undefined);
  }, []);

  // The SDK only accepts event subscriptions while a session is connected
  // (requireClient throws "Not connected" otherwise), so the accounts listener
  // is registered after a restored session or a successful connect, and
  // removed best-effort on teardown.
  const accountsListenerRef = useRef<(accounts: AccountsChangedEvent) => void>(() => undefined);
  const subscribedRef = useRef(false);

  const ensureSubscribed = useCallback(async (): Promise<void> => {
    if (subscribedRef.current) {
      return;
    }
    try {
      await client.onAccountsChanged(accountsListenerRef.current);
      subscribedRef.current = true;
    } catch {
      // The session may have dropped between the connection check and the
      // subscription; account updates are picked up on the next connect.
    }
  }, [client]);

  const unsubscribe = useCallback((): void => {
    if (!subscribedRef.current) {
      return;
    }
    subscribedRef.current = false;
    client.removeOnAccountsChanged(accountsListenerRef.current).catch(() => undefined);
  }, [client]);

  useEffect(() => {
    let cancelled = false;
    accountsListenerRef.current = (accounts: AccountsChangedEvent): void => {
      if (!cancelled) {
        applyAccounts(accounts);
      }
    };
    const bootstrap = async (): Promise<void> => {
      try {
        await client.init();
        const connection = await client.isConnected();
        if (cancelled) {
          return;
        }
        if (connection.isConnected) {
          await ensureSubscribed();
          const accounts = await client.listAccounts();
          if (!cancelled) {
            applyAccounts(accounts);
          }
        } else {
          setStatus('disconnected');
        }
      } catch (error) {
        if (!cancelled) {
          setStatus('wallet_connection_failed');
          setErrorMessage(formatWalletError(error));
        }
      }
    };
    void bootstrap();
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [client, applyAccounts, ensureSubscribed, unsubscribe]);

  const connect = useCallback(async (): Promise<void> => {
    setStatus('initializing');
    setErrorMessage(undefined);
    try {
      const result = await client.connect();
      if (!result.isConnected) {
        setVoterPartyId(undefined);
        setStatus('wallet_connection_failed');
        setErrorMessage(result.reason ?? 'Wallet connection failed');
        return;
      }
      await ensureSubscribed();
      applyAccounts(await client.listAccounts());
    } catch (error) {
      setVoterPartyId(undefined);
      setStatus('wallet_connection_failed');
      setErrorMessage(formatWalletError(error));
    }
  }, [client, applyAccounts, ensureSubscribed]);

  const disconnect = useCallback(async (): Promise<void> => {
    try {
      await client.disconnect();
    } catch (error) {
      setStatus('wallet_connection_failed');
      setErrorMessage(formatWalletError(error));
      return;
    }
    unsubscribe();
    setVoterPartyId(undefined);
    setStatus('disconnected');
    setErrorMessage(undefined);
  }, [client, unsubscribe]);

  const session = useMemo<WalletSession>(
    () => ({ status, voterPartyId, errorMessage, connect, disconnect }),
    [status, voterPartyId, errorMessage, connect, disconnect]
  );

  return <WalletSessionContext.Provider value={session}>{children}</WalletSessionContext.Provider>;
};

export const useWalletSession = (): WalletSession => {
  const session = useContext(WalletSessionContext);
  if (!session) {
    throw new Error('Wallet session not initialized — is dApp mode enabled?');
  }
  return session;
};

/** For components rendered in both modes (e.g. the header logout button). */
export const useWalletSessionOptional = (): WalletSession | undefined =>
  useContext(WalletSessionContext);
