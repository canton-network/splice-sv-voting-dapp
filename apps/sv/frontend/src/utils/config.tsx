// Copyright (c) 2024 Digital Asset (Switzerland) GmbH and/or its affiliates. All rights reserved.
// SPDX-License-Identifier: Apache-2.0
import {
  authSchema,
  testAuthSchema,
  serviceSchema,
  spliceInstanceNamesSchema,
  ConfigProvider,
  useConfig,
  pollIntervalSchema,
} from '@canton-network/splice-common-frontend';
import { PollingStrategy } from '@canton-network/splice-common-frontend-utils';
import React from 'react';
import { z } from 'zod';

type SvServicesConfig = {
  sv: z.infer<typeof serviceSchema>;
};

// When enabled, the SV app runs backend-less: login goes through a CIP-103
// RPC endpoint, governance reads come from Scan, and vote submissions are
// exercised on a VoteDelegation contract through the dApp API.
// Values may arrive as env-substituted strings (docker config.js template), so
// `enabled` is parsed leniently: only the boolean true or the string 'true'
// turn the mode on.
export const dappModeSchema = z
  .object({
    enabled: z
      .union([z.boolean(), z.string()])
      .optional()
      .transform(value => value === true || value === 'true'),
    // Scan API base URL, e.g. http://scan.localhost:4000/api/scan
    scanUrl: z.string().optional(),
    // CIP-103 dApp RPC URL (wallet gateway or partner wallet), e.g. http://localhost:3030/api/v0/dapp
    cip103RpcUrl: z.string().optional(),
    // Override for the dso-governance Daml package name in template ids.
    dsoGovernancePackageName: z.string().optional(),
  })
  .superRefine((value, ctx) => {
    if (!value.enabled) {
      return;
    }
    if (!value.scanUrl?.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['scanUrl'],
        message: 'dappMode.scanUrl is required when dappMode is enabled',
      });
    }
    if (!value.cip103RpcUrl?.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['cip103RpcUrl'],
        message: 'dappMode.cip103RpcUrl is required when dappMode is enabled',
      });
    }
  })
  .optional();

type SvConfig = {
  auth: z.infer<typeof authSchema>;
  testAuth?: z.infer<typeof testAuthSchema>;
  spliceInstanceNames: z.infer<typeof spliceInstanceNamesSchema>;
  services: SvServicesConfig;
  pollInterval?: z.infer<typeof pollIntervalSchema>;
  dappMode?: z.infer<typeof dappModeSchema>;
};

export const configScheme = z.object({
  auth: authSchema,
  testAuth: testAuthSchema.optional(),
  spliceInstanceNames: spliceInstanceNamesSchema,
  pollInterval: pollIntervalSchema,
  services: z.object({
    sv: serviceSchema,
  }),
  dappMode: dappModeSchema,
});

export const ConfigContext = React.createContext<SvConfig | undefined>(undefined);

export const SvConfigProvider: React.FC<{
  children: React.ReactNode;
}> = ({ children }) => {
  return (
    <ConfigProvider configScheme={configScheme} configContext={ConfigContext}>
      {children}
    </ConfigProvider>
  );
};

export const useSvConfig: () => SvConfig = () => useConfig<SvConfig>(ConfigContext);

export const useConfigPollInterval: () => number = () => {
  const config = useSvConfig();

  // Use default poll interval if not specified in config
  return config.pollInterval ?? PollingStrategy.FIXED;
};

const DEFAULT_DSO_GOVERNANCE_PACKAGE_NAME = 'splice-dso-governance';

/** Normalized dApp-mode settings; defined only when the mode is enabled and usable. */
export interface DappModeConfig {
  scanUrl: string;
  cip103RpcUrl: string;
  dsoGovernancePackageName: string;
}

export const getDappModeConfig = (config: SvConfig): DappModeConfig | undefined => {
  const dappMode = config.dappMode;
  const scanUrl = dappMode?.scanUrl?.trim();
  const cip103RpcUrl = dappMode?.cip103RpcUrl?.trim();
  if (!dappMode?.enabled || !scanUrl || !cip103RpcUrl) {
    return undefined;
  }
  return {
    scanUrl,
    cip103RpcUrl,
    dsoGovernancePackageName:
      dappMode.dsoGovernancePackageName?.trim() || DEFAULT_DSO_GOVERNANCE_PACKAGE_NAME,
  };
};

/**
 * The dApp-mode config, or undefined in standard mode. The mode is fixed for
 * the lifetime of the page (config is loaded once from window.splice_config).
 */
export const useDappModeConfig = (): DappModeConfig | undefined => getDappModeConfig(useSvConfig());
