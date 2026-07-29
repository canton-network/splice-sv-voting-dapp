// Copyright (c) 2024 Digital Asset (Switzerland) GmbH and/or its affiliates. All rights reserved.
// SPDX-License-Identifier: Apache-2.0
import { describe, expect, test } from 'vitest';

import { configScheme, getDappModeConfig } from '../../utils/config';
import { config as baseConfig } from '../setup/config';

const parse = (dappMode?: unknown) =>
  configScheme.parse({
    ...baseConfig,
    ...(dappMode !== undefined ? { dappMode } : {}),
  });

describe('dappMode config schema', () => {
  test('config without dappMode parses and stays in standard mode', () => {
    const parsed = parse();
    expect(parsed.dappMode).toBeUndefined();
    expect(getDappModeConfig(parsed)).toBeUndefined();
  });

  test('disabled dappMode block parses and stays in standard mode', () => {
    const parsed = parse({ enabled: false });
    expect(getDappModeConfig(parsed)).toBeUndefined();
  });

  test('env-substituted empty strings are treated as disabled', () => {
    // The docker config.js template substitutes missing env vars with ''.
    const parsed = parse({
      enabled: '',
      scanUrl: '',
      walletGatewayUrl: '',
      svPartyId: '',
      voteDelegationCid: '',
    });
    expect(getDappModeConfig(parsed)).toBeUndefined();
  });

  test('enabled dappMode requires scanUrl and walletGatewayUrl', () => {
    expect(() => parse({ enabled: true })).toThrow(/scanUrl/);
    expect(() => parse({ enabled: true, scanUrl: 'http://scan.localhost:4000/api/scan' })).toThrow(
      /walletGatewayUrl/
    );
  });

  test('enabled dappMode with boolean flag normalizes correctly', () => {
    const parsed = parse({
      enabled: true,
      scanUrl: 'http://scan.localhost:4000/api/scan',
      walletGatewayUrl: 'http://localhost:3030/api/v0/dapp',
      svPartyId: 'DSO-SV-1::1220deadbeef',
      voteDelegationCid: '00delegation',
    });
    const dappMode = getDappModeConfig(parsed);
    expect(dappMode).toBeDefined();
    expect(dappMode?.scanUrl).toBe('http://scan.localhost:4000/api/scan');
    expect(dappMode?.walletGatewayUrl).toBe('http://localhost:3030/api/v0/dapp');
    expect(dappMode?.svPartyId).toBe('DSO-SV-1::1220deadbeef');
    expect(dappMode?.voteDelegationCid).toBe('00delegation');
    expect(dappMode?.dsoGovernancePackageName).toBe('splice-dso-governance');
  });

  test("enabled dappMode with string flag 'true' normalizes correctly", () => {
    const parsed = parse({
      enabled: 'true',
      scanUrl: 'http://scan.localhost:4000/api/scan',
      walletGatewayUrl: 'http://localhost:3030/api/v0/dapp',
      dsoGovernancePackageName: 'splice-dso-governance-dev',
    });
    const dappMode = getDappModeConfig(parsed);
    expect(dappMode).toBeDefined();
    expect(dappMode?.svPartyId).toBeUndefined();
    expect(dappMode?.voteDelegationCid).toBeUndefined();
    expect(dappMode?.dsoGovernancePackageName).toBe('splice-dso-governance-dev');
  });

  test("string flag 'false' stays in standard mode", () => {
    const parsed = parse({
      enabled: 'false',
      scanUrl: 'http://scan.localhost:4000/api/scan',
      walletGatewayUrl: 'http://localhost:3030/api/v0/dapp',
    });
    expect(getDappModeConfig(parsed)).toBeUndefined();
  });
});
