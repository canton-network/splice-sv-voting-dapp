// Copyright (c) 2024 Digital Asset (Switzerland) GmbH and/or its affiliates. All rights reserved.
// SPDX-License-Identifier: Apache-2.0
import { VoteDelegation } from '@daml.js/splice-dso-governance/lib/Splice/DsoRules/VoteDelegation';

import { DappSdkClient } from './dappSdkClient';
import { getVoteDelegationTemplateId } from './voteDelegationCommands';

export type VoteDelegationDiscoveryFailureCode = 'none' | 'ambiguous' | 'ledger';

/** Raised when ACS discovery cannot resolve exactly one VoteDelegation. */
export class VoteDelegationDiscoveryError extends Error {
  readonly code: VoteDelegationDiscoveryFailureCode;

  constructor(message: string, code: VoteDelegationDiscoveryFailureCode) {
    super(message);
    this.name = 'VoteDelegationDiscoveryError';
    this.code = code;
  }
}

export interface DiscoveredVoteDelegation {
  readonly voteDelegationCid: string;
  readonly svPartyId: string;
  readonly voterPartyId: string;
}

interface CreatedEventLike {
  contractId: string;
  createArgument: unknown;
}

interface ActiveContractEntry {
  contractEntry?: {
    JsActiveContract?: {
      createdEvent?: {
        contractId?: unknown;
        createArgument?: unknown;
      };
    };
  };
}

const parseLedgerEndOffset = (result: unknown): number | undefined => {
  if (typeof result !== 'object' || result === null) {
    return undefined;
  }
  const offset = (result as { offset?: unknown }).offset;
  return typeof offset === 'number' ? offset : undefined;
};

const extractCreatedEvents = (result: unknown): CreatedEventLike[] => {
  const entries: ActiveContractEntry[] = Array.isArray(result)
    ? (result as ActiveContractEntry[])
    : typeof result === 'object' &&
        result !== null &&
        Array.isArray((result as { contractEntries?: unknown }).contractEntries)
      ? (result as { contractEntries: ActiveContractEntry[] }).contractEntries
      : [];

  return entries.flatMap(entry => {
    const event = entry.contractEntry?.JsActiveContract?.createdEvent;
    if (
      event === undefined ||
      typeof event.contractId !== 'string' ||
      event.createArgument === undefined
    ) {
      return [];
    }
    return [{ contractId: event.contractId, createArgument: event.createArgument }];
  });
};

/**
 * Query the connected wallet party's ACS for VoteDelegation contracts and
 * require exactly one match. The delegating SV party and contract id are taken
 * from that contract — they are not configured statically.
 */
export async function discoverVoteDelegation(args: {
  sdkClient: DappSdkClient;
  voterPartyId: string;
}): Promise<DiscoveredVoteDelegation> {
  const { sdkClient, voterPartyId } = args;
  const templateId = getVoteDelegationTemplateId();

  let ledgerEnd: unknown;
  try {
    ledgerEnd = await sdkClient.ledgerApi({
      requestMethod: 'get',
      resource: '/v2/state/ledger-end',
    });
  } catch (error) {
    throw new VoteDelegationDiscoveryError(
      `Failed to read ledger end while discovering VoteDelegation: ${
        error instanceof Error ? error.message : String(error)
      }`,
      'ledger'
    );
  }

  const activeAtOffset = parseLedgerEndOffset(ledgerEnd);
  if (activeAtOffset === undefined) {
    throw new VoteDelegationDiscoveryError(
      'Ledger end response did not include a usable offset for VoteDelegation ACS discovery.',
      'ledger'
    );
  }

  let acsResult: unknown;
  try {
    acsResult = await sdkClient.ledgerApi({
      requestMethod: 'post',
      resource: '/v2/state/active-contracts',
      body: {
        activeAtOffset,
        verbose: false,
        eventFormat: {
          verbose: false,
          filtersByParty: {
            [voterPartyId]: {
              cumulative: [
                {
                  identifierFilter: {
                    TemplateFilter: {
                      value: {
                        templateId,
                        includeCreatedEventBlob: false,
                      },
                    },
                  },
                },
              ],
            },
          },
        },
      },
    });
  } catch (error) {
    throw new VoteDelegationDiscoveryError(
      `Failed to query VoteDelegation ACS: ${
        error instanceof Error ? error.message : String(error)
      }`,
      'ledger'
    );
  }

  const matches = extractCreatedEvents(acsResult).flatMap(event => {
    const payload = VoteDelegation.decoder.runWithException(event.createArgument);
    if (payload.voterParty !== voterPartyId) {
      return [];
    }
    return [
      {
        voteDelegationCid: event.contractId,
        svPartyId: payload.sv,
        voterPartyId,
      } satisfies DiscoveredVoteDelegation,
    ];
  });

  if (matches.length === 0) {
    throw new VoteDelegationDiscoveryError(
      `No VoteDelegation contract found for wallet party ${voterPartyId}. ` +
        'Ask the SV to create a VoteDelegation naming this party as voterParty.',
      'none'
    );
  }

  if (matches.length > 1) {
    const svList = matches.map(match => match.svPartyId).join(', ');
    throw new VoteDelegationDiscoveryError(
      `Found ${matches.length} VoteDelegation contracts for wallet party ${voterPartyId} ` +
        `(delegating SVs: ${svList}). Exactly one is required; archive extras or use a dedicated voter party.`,
      'ambiguous'
    );
  }

  return matches[0]!;
}
