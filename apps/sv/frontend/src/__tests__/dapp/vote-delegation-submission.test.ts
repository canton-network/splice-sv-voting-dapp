// Copyright (c) 2024 Digital Asset (Switzerland) GmbH and/or its affiliates. All rights reserved.
// SPDX-License-Identifier: Apache-2.0
import { ErrorCode } from '@canton-network/dapp-sdk';
import * as scanOpenapi from '@canton-network/scan-openapi';
import { afterEach, describe, expect, test, vi } from 'vitest';

import { RelTime } from '@daml.js/daml-stdlib-DA-Time-Types-1.0.0/lib/DA/Time/Types/module';
import { ActionRequiringConfirmation } from '@daml.js/splice-dso-governance/lib/Splice/DsoRules/module';

import { DappSdkClient } from '../../dapp/dappSdkClient';
import {
  createVoteDelegationSubmission,
  SignatureRejectedError,
  VoteDelegationContextError,
} from '../../dapp/voteDelegationSubmission';
import { DappModeConfig } from '../../utils/config';

const VOTER_PARTY = 'voter::1220bb';
const SV_PARTY = 'Delegating-SV::1220aa';

const dappMode: DappModeConfig = {
  scanUrl: 'http://scan.localhost:4000/api/scan',
  cip103RpcUrl: 'http://localhost:3030/api/v0/dapp',
  svPartyId: SV_PARTY,
  voteDelegationCid: '00votedelegation',
  dsoGovernancePackageName: 'splice-dso-governance',
};

const dsoInfoResponse = {
  sv_party_id: 'Scan-Sponsor-SV::1220cc',
  dso_rules: {
    contract: {
      contract_id: '00dsorules',
      template_id: 'pkg:Splice.DsoRules:DsoRules',
      created_event_blob: 'dso-rules-blob',
      payload: {},
    },
  },
};

const currentVoteRequest = {
  contract_id: '00currentvoterequest',
  template_id: 'pkg:Splice.DsoRules:VoteRequest',
  created_event_blob: 'vote-request-blob',
  payload: { trackingCid: '00trackingcid' },
};

interface FakeClients {
  scanClient: scanOpenapi.ScanApi;
  sdkClient: DappSdkClient;
  prepareExecuteAndWait: ReturnType<typeof vi.fn>;
  lookupDsoRulesVoteRequest: ReturnType<typeof vi.fn>;
  listDsoRulesVoteRequests: ReturnType<typeof vi.fn>;
}

const buildFakes = (): FakeClients => {
  const prepareExecuteAndWait = vi.fn(async () => ({
    tx: { payload: { updateId: 'update-1' } },
  }));
  const lookupDsoRulesVoteRequest = vi.fn(async () => ({
    dso_rules_vote_request: currentVoteRequest,
  }));
  const listDsoRulesVoteRequests = vi.fn(async () => ({
    dso_rules_vote_requests: [currentVoteRequest],
  }));
  const scanClient = {
    getDsoInfo: vi.fn(async () => dsoInfoResponse),
    lookupDsoRulesVoteRequest,
    listDsoRulesVoteRequests,
  } as unknown as scanOpenapi.ScanApi;
  const sdkClient = { prepareExecuteAndWait } as unknown as DappSdkClient;
  return {
    scanClient,
    sdkClient,
    prepareExecuteAndWait,
    lookupDsoRulesVoteRequest,
    listDsoRulesVoteRequests,
  };
};

const buildSubmission = (fakes: FakeClients, voterPartyId: string | undefined = VOTER_PARTY) =>
  createVoteDelegationSubmission({
    scanClient: fakes.scanClient,
    sdkClient: fakes.sdkClient,
    dappMode,
    getVoterPartyId: () => voterPartyId,
  });

const castArgs = {
  voteRequestContractId: '00currentvoterequest',
  isAccepted: true,
  reasonUrl: '',
  reasonDescription: 'agreed',
};

afterEach(() => {
  vi.clearAllMocks();
});

describe('submitCastVote', () => {
  test('submits VoteDelegation_CastVote with disclosures through the gateway', async () => {
    const fakes = buildFakes();
    await buildSubmission(fakes).submitCastVote(castArgs);

    expect(fakes.prepareExecuteAndWait).toHaveBeenCalledTimes(1);
    const params = fakes.prepareExecuteAndWait.mock.calls[0][0];
    expect(params.actAs).toEqual([VOTER_PARTY]);
    const exercise = params.commands[0].ExerciseCommand;
    expect(exercise.templateId).toBe(
      '#splice-dso-governance:Splice.DsoRules.VoteDelegation:VoteDelegation'
    );
    expect(exercise.contractId).toBe('00votedelegation');
    expect(exercise.choiceArgument.castVote.requestCid).toBe('00currentvoterequest');
    expect(exercise.choiceArgument.castVote.vote.sv).toBe(SV_PARTY);
    expect(exercise.choiceArgument.castVote.voterParty).toBe(VOTER_PARTY);
    expect(params.disclosedContracts).toEqual([
      {
        contractId: '00dsorules',
        createdEventBlob: 'dso-rules-blob',
        templateId: 'pkg:Splice.DsoRules:DsoRules',
      },
      {
        contractId: '00currentvoterequest',
        createdEventBlob: 'vote-request-blob',
        templateId: 'pkg:Splice.DsoRules:VoteRequest',
      },
    ]);
  });

  test('re-resolves a stale id to the current VoteRequest contract', async () => {
    const fakes = buildFakes();
    fakes.lookupDsoRulesVoteRequest.mockRejectedValue(new Error('404 not found'));

    await buildSubmission(fakes).submitCastVote({
      ...castArgs,
      // The UI holds the tracking cid; the current contract id differs.
      voteRequestContractId: '00trackingcid',
    });

    expect(fakes.listDsoRulesVoteRequests).toHaveBeenCalled();
    const params = fakes.prepareExecuteAndWait.mock.calls[0][0];
    expect(params.commands[0].ExerciseCommand.choiceArgument.castVote.requestCid).toBe(
      '00currentvoterequest'
    );
  });

  test('fails clearly when the vote request cannot be resolved', async () => {
    const fakes = buildFakes();
    fakes.lookupDsoRulesVoteRequest.mockRejectedValue(new Error('404 not found'));
    fakes.listDsoRulesVoteRequests.mockResolvedValue({ dso_rules_vote_requests: [] });

    await expect(buildSubmission(fakes).submitCastVote(castArgs)).rejects.toBeInstanceOf(
      VoteDelegationContextError
    );
    expect(fakes.prepareExecuteAndWait).not.toHaveBeenCalled();
  });

  test('maps wallet cancellation to SignatureRejectedError', async () => {
    const fakes = buildFakes();
    fakes.prepareExecuteAndWait.mockRejectedValue(
      Object.assign(new Error('user dismissed the request'), { code: ErrorCode.UserCancelled })
    );

    await expect(buildSubmission(fakes).submitCastVote(castArgs)).rejects.toBeInstanceOf(
      SignatureRejectedError
    );
  });

  test('requires a connected wallet', async () => {
    const fakes = buildFakes();
    const submission = createVoteDelegationSubmission({
      scanClient: fakes.scanClient,
      sdkClient: fakes.sdkClient,
      dappMode,
      getVoterPartyId: () => undefined,
    });
    await expect(submission.submitCastVote(castArgs)).rejects.toBeInstanceOf(
      VoteDelegationContextError
    );
  });

  test('requires a configured VoteDelegation contract id', async () => {
    const fakes = buildFakes();
    const submission = createVoteDelegationSubmission({
      scanClient: fakes.scanClient,
      sdkClient: fakes.sdkClient,
      dappMode: { ...dappMode, voteDelegationCid: undefined },
      getVoterPartyId: () => VOTER_PARTY,
    });
    await expect(submission.submitCastVote(castArgs)).rejects.toThrow(/voteDelegationCid/);
  });
});

describe('submitCreateVoteRequest', () => {
  const action: ActionRequiringConfirmation = {
    tag: 'ARC_DsoRules',
    value: {
      dsoAction: {
        tag: 'SRARC_UpdateSvRewardWeight',
        value: { svParty: SV_PARTY, newRewardWeight: '1000' },
      },
    },
  };

  const requestArgs = {
    requester: SV_PARTY,
    action,
    url: 'https://example.com/proposal',
    description: 'Update reward weight',
    expiration: { microseconds: '604800000000' } as RelTime,
  };

  test('submits VoteDelegation_RequestVote through the gateway', async () => {
    const fakes = buildFakes();
    await buildSubmission(fakes).submitCreateVoteRequest(requestArgs);

    const params = fakes.prepareExecuteAndWait.mock.calls[0][0];
    expect(params.actAs).toEqual([VOTER_PARTY]);
    const exercise = params.commands[0].ExerciseCommand;
    expect(exercise.choice).toBe('VoteDelegation_RequestVote');
    expect(exercise.choiceArgument.requestVote.requester).toBe(SV_PARTY);
    expect(exercise.choiceArgument.requestVote.voterParty).toBe(VOTER_PARTY);
    expect(exercise.choiceArgument.requestVote.voteRequestTimeout).toEqual({
      microseconds: '604800000000',
    });
    expect(exercise.choiceArgument.requestVote.targetEffectiveAt).toBeNull();
    expect(exercise.choiceArgument.requestVote.action).toEqual(
      ActionRequiringConfirmation.encode(action)
    );
    expect(params.disclosedContracts).toEqual([
      {
        contractId: '00dsorules',
        createdEventBlob: 'dso-rules-blob',
        templateId: 'pkg:Splice.DsoRules:DsoRules',
      },
    ]);
  });

  test('passes an effective time as ISO timestamp', async () => {
    const fakes = buildFakes();
    await buildSubmission(fakes).submitCreateVoteRequest({
      ...requestArgs,
      effectiveTime: new Date('2026-08-01T12:00:00.000Z'),
    });

    const params = fakes.prepareExecuteAndWait.mock.calls[0][0];
    expect(params.commands[0].ExerciseCommand.choiceArgument.requestVote.targetEffectiveAt).toBe(
      '2026-08-01T12:00:00.000Z'
    );
  });

  test('maps wallet rejection to SignatureRejectedError', async () => {
    const fakes = buildFakes();
    fakes.prepareExecuteAndWait.mockRejectedValue(new Error('signature rejected by user'));

    await expect(
      buildSubmission(fakes).submitCreateVoteRequest(requestArgs)
    ).rejects.toBeInstanceOf(SignatureRejectedError);
  });

  test('falls back to the Scan SV party when none is configured', async () => {
    const fakes = buildFakes();
    const submission = createVoteDelegationSubmission({
      scanClient: fakes.scanClient,
      sdkClient: fakes.sdkClient,
      dappMode: { ...dappMode, svPartyId: undefined },
      getVoterPartyId: () => VOTER_PARTY,
    });
    await submission.submitCreateVoteRequest(requestArgs);

    const params = fakes.prepareExecuteAndWait.mock.calls[0][0];
    expect(params.commands[0].ExerciseCommand.choiceArgument.requestVote.requester).toBe(
      'Scan-Sponsor-SV::1220cc'
    );
  });
});
