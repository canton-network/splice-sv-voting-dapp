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

  test('enabled dappMode requires scanUrl and cip103RpcUrl', () => {
    expect(() => parse({ enabled: true })).toThrow(/scanUrl/);
    expect(() => parse({ enabled: true, scanUrl: 'http://scan.localhost:4000/api/scan' })).toThrow(
      /cip103RpcUrl/
    );
  });

  test('enabled dappMode with boolean flag normalizes correctly', () => {
    const parsed = parse({
      enabled: true,
      scanUrl: 'http://scan.localhost:4000/api/scan',
      cip103RpcUrl: 'http://localhost:3030/api/v0/dapp',
    });
    const dappMode = getDappModeConfig(parsed);
    expect(dappMode).toBeDefined();
    expect(dappMode?.scanUrl).toBe('http://scan.localhost:4000/api/scan');
    expect(dappMode?.cip103RpcUrl).toBe('http://localhost:3030/api/v0/dapp');
  });

  test("enabled dappMode with string flag 'true' normalizes correctly", () => {
    const parsed = parse({
      enabled: 'true',
      scanUrl: 'http://scan.localhost:4000/api/scan',
      cip103RpcUrl: 'http://localhost:3030/api/v0/dapp',
    });
    expect(getDappModeConfig(parsed)).toBeDefined();
  });

  test("string flag 'false' stays in standard mode", () => {
    const parsed = parse({
      enabled: 'false',
      scanUrl: 'http://scan.localhost:4000/api/scan',
      cip103RpcUrl: 'http://localhost:3030/api/v0/dapp',
    });
    expect(getDappModeConfig(parsed)).toBeUndefined();
  });

  test('rejects unknown enabled strings instead of silently disabling', () => {
    expect(() =>
      parse({
        enabled: '1',
        scanUrl: 'http://scan.localhost:4000/api/scan',
        cip103RpcUrl: 'http://localhost:3030/api/v0/dapp',
      })
    ).toThrow();
    expect(() =>
      parse({
        enabled: 'TRUE',
        scanUrl: 'http://scan.localhost:4000/api/scan',
        cip103RpcUrl: 'http://localhost:3030/api/v0/dapp',
      })
    ).toThrow();
  });
});
