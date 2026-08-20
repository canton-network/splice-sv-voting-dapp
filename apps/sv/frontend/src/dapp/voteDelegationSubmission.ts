// Copyright (c) 2024 Digital Asset (Switzerland) GmbH and/or its affiliates. All rights reserved.
// SPDX-License-Identifier: Apache-2.0
import * as scanOpenapi from '@canton-network/scan-openapi';

import { RelTime } from '@daml.js/daml-stdlib-DA-Time-Types-1.0.0/lib/DA/Time/Types/module';
import { ActionRequiringConfirmation } from '@daml.js/splice-dso-governance/lib/Splice/DsoRules/module';

import { DappModeConfig } from '../utils/config';
import { DappSdkClient } from './dappSdkClient';
import {
  buildVoteDelegationCastParams,
  buildVoteDelegationRequestParams,
  DisclosedContractInput,
} from './voteDelegationCommands';

/** Raised when dApp-mode configuration or wallet state cannot support a submission. */
export class VoteDelegationContextError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'VoteDelegationContextError';
  }
}

/** Raised when the user cancels or the wallet rejects the signature. */
export class SignatureRejectedError extends Error {
  readonly code = 'signature_rejected' as const;

  constructor(message = 'Signature rejected or cancelled in the wallet') {
    super(message);
    this.name = 'SignatureRejectedError';
  }
}

// ErrorCode.UserCancelled from @canton-network/dapp-sdk — compare by value so
// this module never statically imports the SDK (Lit warning in standard mode).
const DAPP_SDK_USER_CANCELLED = 1;

function isUserCancelled(error: unknown): boolean {
  if (error instanceof SignatureRejectedError) {
    return true;
  }
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const code = (error as { code: unknown }).code;
    // Structured CIP-103 / wallet signals only. Do not substring-match message
    // text: ledger failures often contain "rejected" and must surface as
    // themselves, not as a wallet cancellation.
    return (
      code === DAPP_SDK_USER_CANCELLED || code === 'UserCancelled' || code === 'signature_rejected'
    );
  }
  return false;
}

const mapWalletError = (error: unknown): Error => {
  if (isUserCancelled(error)) {
    return new SignatureRejectedError(
      error instanceof Error ? error.message : 'Signature rejected or cancelled in the wallet'
    );
  }
  return error instanceof Error ? error : new Error(String(error));
};

/** Scan OpenAPI clients throw ApiException with numeric HTTP `code` on 404. */
function isScanNotFound(error: unknown): boolean {
  if (typeof error !== 'object' || error === null || !('code' in error)) {
    return false;
  }
  return (error as { code: unknown }).code === 404;
}

interface ScanContract {
  contract_id: string;
  template_id?: string;
  created_event_blob?: string;
  payload: unknown;
}

const toDisclosure = (contract: ScanContract): DisclosedContractInput | undefined => {
  const blob = contract.created_event_blob?.trim();
  if (!blob) {
    return undefined;
  }
  return {
    contractId: contract.contract_id,
    createdEventBlob: blob,
    ...(contract.template_id !== undefined ? { templateId: contract.template_id } : {}),
  };
};

interface VoteDelegationContext {
  readonly voterPartyId: string;
  readonly svPartyId: string;
  readonly voteDelegationCid: string;
  readonly dsoRulesCid: string;
  /**
   * The voter's participant does not host DSO contracts, so submissions must
   * disclose DsoRules explicitly; without it, prepare fails with
   * PERMISSION_DENIED ("A security-sensitive error has been received").
   */
  readonly dsoRulesDisclosed?: DisclosedContractInput;
}

export interface VoteDelegationSubmissionDeps {
  scanClient: scanOpenapi.ScanApi;
  sdkClient: DappSdkClient;
  dappMode: DappModeConfig;
  getVoterPartyId: () => string | undefined;
  /** Delegating SV party from ACS-discovered VoteDelegation. */
  getSvPartyId: () => string | undefined;
  /** VoteDelegation contract id from ACS discovery. */
  getVoteDelegationCid: () => string | undefined;
}

export interface VoteDelegationSubmission {
  submitCastVote: (args: {
    voteRequestContractId: string;
    isAccepted: boolean;
    reasonUrl: string;
    reasonDescription: string;
  }) => Promise<void>;
  submitCreateVoteRequest: (args: {
    requester: string;
    action: ActionRequiringConfirmation;
    url: string;
    description: string;
    expiration: RelTime;
    effectiveTime?: Date;
  }) => Promise<void>;
}

/**
 * Governance submissions through the CIP-103 dApp API, exercising the
 * VoteDelegation contract as the connected wallet party.
 */
export function createVoteDelegationSubmission(
  deps: VoteDelegationSubmissionDeps
): VoteDelegationSubmission {
  const { scanClient, sdkClient, dappMode, getVoterPartyId, getSvPartyId, getVoteDelegationCid } =
    deps;

  const resolveContext = async (operation: string): Promise<VoteDelegationContext> => {
    const voterPartyId = getVoterPartyId();
    if (!voterPartyId) {
      throw new VoteDelegationContextError(
        `Connect a wallet so the VoteDelegation voter party can sign the ${operation}.`
      );
    }
    const voteDelegationCid = getVoteDelegationCid();
    if (!voteDelegationCid) {
      throw new VoteDelegationContextError(
        'No VoteDelegation discovered for the connected wallet party — reconnect or ask the SV to create one.'
      );
    }
    const svPartyId = getSvPartyId();
    if (!svPartyId) {
      throw new VoteDelegationContextError(
        'VoteDelegation discovery did not yield a delegating SV party — reconnect and retry.'
      );
    }

    const dsoInfo = await scanClient.getDsoInfo();
    const dsoRulesContract = dsoInfo.dso_rules.contract as ScanContract;
    const dsoRulesCid = dsoRulesContract.contract_id;
    if (!dsoRulesCid) {
      throw new VoteDelegationContextError(
        'Scan /v0/dso did not return a DsoRules contract id — cannot submit.'
      );
    }

    const dsoRulesDisclosed = toDisclosure(dsoRulesContract);
    return {
      voterPartyId,
      svPartyId,
      voteDelegationCid,
      dsoRulesCid,
      ...(dsoRulesDisclosed !== undefined ? { dsoRulesDisclosed } : {}),
    };
  };

  /**
   * Resolves the id held by the UI (tracking cid or contract id) to the
   * *current* VoteRequest contract. DsoRules_CastVote archives and recreates
   * the VoteRequest on every vote, so stale ids fail with CONTRACT_NOT_FOUND.
   *
   * Scan's lookup is ACS-backed and indexes by tracking cid
   * (`vote_request_tracking_cid`), so a tracking-cid lookup already returns
   * the live contract. A 404 falls through to listing active requests (covers
   * stale intermediate contract ids). Non-404 Scan failures are rethrown so a
   * 500/network blip is not mistaken for "not found".
   */
  const resolveCurrentVoteRequest = async (
    routeId: string
  ): Promise<{ contractId: string; disclosed?: DisclosedContractInput }> => {
    let contract: ScanContract | undefined;
    try {
      const response = await scanClient.lookupDsoRulesVoteRequest(routeId);
      contract = response.dso_rules_vote_request as ScanContract | undefined;
    } catch (error) {
      if (!isScanNotFound(error)) {
        throw error;
      }
      contract = undefined;
    }

    if (!contract) {
      const known = await scanClient.listDsoRulesVoteRequests();
      contract = (known.dso_rules_vote_requests as ScanContract[]).find(vr => {
        const trackingCid = (vr.payload as { trackingCid?: string | null })?.trackingCid;
        return vr.contract_id === routeId || trackingCid === routeId;
      });
    }

    if (!contract) {
      throw new VoteDelegationContextError(
        'This vote request is no longer open — it may have executed, expired, or been updated. Refresh and retry.'
      );
    }

    const disclosed = toDisclosure(contract);
    return {
      contractId: contract.contract_id,
      ...(disclosed !== undefined ? { disclosed } : {}),
    };
  };

  return {
    submitCastVote: async ({
      voteRequestContractId,
      isAccepted,
      reasonUrl,
      reasonDescription,
    }): Promise<void> => {
      const context = await resolveContext('vote');
      const voteRequest = await resolveCurrentVoteRequest(voteRequestContractId);

      const disclosedContracts = [
        ...(context.dsoRulesDisclosed !== undefined ? [context.dsoRulesDisclosed] : []),
        ...(voteRequest.disclosed !== undefined ? [voteRequest.disclosed] : []),
      ];

      const params = buildVoteDelegationCastParams(
        {
          voteRequestContractId: voteRequest.contractId,
          accepted: isAccepted,
          reasonUrl,
          reasonDescription,
          voteDelegationCid: context.voteDelegationCid,
          dsoRulesCid: context.dsoRulesCid,
          svPartyId: context.svPartyId,
          voterPartyId: context.voterPartyId,
          ...(disclosedContracts.length > 0 ? { disclosedContracts } : {}),
        },
        dappMode.dsoGovernancePackageName
      );

      try {
        await sdkClient.prepareExecuteAndWait(params);
      } catch (error) {
        throw mapWalletError(error);
      }
    },

    submitCreateVoteRequest: async ({
      action,
      url,
      description,
      expiration,
      effectiveTime,
    }): Promise<void> => {
      const context = await resolveContext('proposal');

      const encodedExpiration = RelTime.encode(expiration) as { microseconds: string };
      const params = buildVoteDelegationRequestParams(
        {
          action: ActionRequiringConfirmation.encode(action),
          reasonUrl: url,
          reasonDescription: description,
          voteRequestTimeoutMicroseconds: encodedExpiration.microseconds,
          targetEffectiveAt: effectiveTime?.toISOString(),
          voteDelegationCid: context.voteDelegationCid,
          dsoRulesCid: context.dsoRulesCid,
          svPartyId: context.svPartyId,
          voterPartyId: context.voterPartyId,
          ...(context.dsoRulesDisclosed !== undefined
            ? { disclosedContracts: [context.dsoRulesDisclosed] }
            : {}),
        },
        dappMode.dsoGovernancePackageName
      );

      try {
        await sdkClient.prepareExecuteAndWait(params);
      } catch (error) {
        throw mapWalletError(error);
      }
    },
  };
}
