// Copyright (c) 2024 Digital Asset (Switzerland) GmbH and/or its affiliates. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

package org.lfdecentralizedtrust.splice.integration.tests

import com.digitalasset.canton.console.CommandFailure
import com.digitalasset.canton.topology.PartyId
import org.lfdecentralizedtrust.splice.codegen.java.splice.dsorules.actionrequiringconfirmation.ARC_DsoRules
import org.lfdecentralizedtrust.splice.codegen.java.splice.dsorules.dsorules_actionrequiringconfirmation.SRARC_GrantFeaturedAppRight
import org.lfdecentralizedtrust.splice.codegen.java.splice.dsorules.votedelegation.VoteDelegation
import org.lfdecentralizedtrust.splice.codegen.java.splice.dsorules.{
  ActionRequiringConfirmation,
  DsoRules_CastVote,
  DsoRules_GrantFeaturedAppRight,
  DsoRules_RequestVote,
  Reason,
  Vote,
}
import org.lfdecentralizedtrust.splice.config.ConfigTransforms
import org.lfdecentralizedtrust.splice.integration.EnvironmentDefinition
import org.lfdecentralizedtrust.splice.integration.tests.SpliceTests.SpliceTestConsoleEnvironment
import org.lfdecentralizedtrust.splice.sv.automation.delegatebased.CloseVoteRequestTrigger
import org.lfdecentralizedtrust.splice.util.{ContractWithState, DisclosedContracts, WalletTestUtil}

import java.util.Optional
import scala.jdk.CollectionConverters.*

/** Tier A ledger-path coverage for delegated governance:
  * SV creates VoteDelegation; a voter on a non-SV participant exercises
  * VoteDelegation_* with disclosed DsoRules / VoteRequest; recorded requester /
  * vote.sv remain the delegating SV.
  */
@org.lfdecentralizedtrust.splice.util.scalatesttags.SpliceDsoGovernance_0_1_29
class VoteDelegationIntegrationTest extends SvIntegrationTestBase with WalletTestUtil {

  override protected def runTokenStandardCliSanityCheck: Boolean = false

  override def environmentDefinition: EnvironmentDefinition =
    EnvironmentDefinition
      .simpleTopology4Svs(this.getClass.getSimpleName)
      .withManualStart
      .addConfigTransform((_, config) => ConfigTransforms.withNoVoteCooldown(config))
      .addConfigTransforms((_, config) =>
        ConfigTransforms.updateAutomationConfig(ConfigTransforms.ConfigurableApp.Sv)(
          _.withPausedTrigger[CloseVoteRequestTrigger]
        )(config)
      )

  private def grantFeaturedAppAction(provider: PartyId): ActionRequiringConfirmation =
    new ARC_DsoRules(
      new SRARC_GrantFeaturedAppRight(
        new DsoRules_GrantFeaturedAppRight(
          provider.toProtoPrimitive,
          Optional.empty(),
        )
      )
    )

  private def createVoteDelegation(
      svParty: PartyId,
      dsoParty: PartyId,
      voterParty: PartyId,
  )(implicit env: SpliceTestConsoleEnvironment): VoteDelegation.ContractId = {
    sv1Backend.participantClientWithAdminToken.ledger_api_extensions.commands.submitJava(
      actAs = Seq(svParty),
      commands = new VoteDelegation(
        dsoParty.toProtoPrimitive,
        svParty.toProtoPrimitive,
        voterParty.toProtoPrimitive,
      ).create().commands.asScala.toSeq,
    )
    sv1Backend.participantClientWithAdminToken.ledger_api_extensions.acs
      .filterJava(VoteDelegation.COMPANION)(
        svParty,
        c =>
          c.data.voterParty == voterParty.toProtoPrimitive &&
            c.data.sv == svParty.toProtoPrimitive,
      )
      .loneElement
      .id
  }

  private def setupDelegatedVoter()(implicit
      env: SpliceTestConsoleEnvironment
  ): (PartyId, PartyId, PartyId, VoteDelegation.ContractId) = {
    initDso()
    startAllSync(aliceValidatorBackend)
    aliceValidatorBackend.participantClient.upload_dar_unless_exists(dsoGovernanceDarPath)

    val dsoInfo = sv1Backend.getDsoInfo()
    val svParty = dsoInfo.svParty
    val dsoParty = dsoInfo.dsoParty
    val voterParty = onboardWalletUser(aliceWalletClient, aliceValidatorBackend)

    svParty should not be voterParty withClue "voter must not be the SV party"
    aliceValidatorBackend.participantClient.id should not be sv1Backend.participantClient.id withClue "voter participant must differ from SV participant"

    val delegationCid = createVoteDelegation(svParty, dsoParty, voterParty)
    (svParty, dsoParty, voterParty, delegationCid)
  }

  "delegated voter can cast a vote attributed to the SV" in { implicit env =>
    val (sv1Party, _, voterParty, delegationCid) = setupDelegatedVoter()
    val dsoRules = sv1Backend.getDsoInfo().dsoRules

    val (_, voteRequest) = actAndCheck(
      "sv2 opens a vote request",
      sv2Backend.createVoteRequest(
        sv2Backend.getDsoInfo().svParty.toProtoPrimitive,
        grantFeaturedAppAction(voterParty),
        "url",
        "open request for delegated cast",
        dsoRules.payload.config.voteRequestTimeout,
        None,
      ),
    )(
      "vote request is visible",
      _ => sv1Backend.listVoteRequests().loneElement,
    )

    val trackingCid = getTrackingId(voteRequest)
    val castVote = new DsoRules_CastVote(
      voteRequest.contractId,
      new Vote(
        sv1Party.toProtoPrimitive,
        true,
        new Reason("url", "delegated cast"),
        Optional.empty(),
      ),
      Optional.of(voterParty.toProtoPrimitive),
    )

    actAndCheck(
      "voter casts through VoteDelegation on the alice validator participant", {
        val voteRequestWithState = ContractWithState(voteRequest, dsoRules.state)
        aliceValidatorBackend.participantClientWithAdminToken.ledger_api_extensions.commands
          .submitJava(
            actAs = Seq(voterParty),
            commands = delegationCid
              .exerciseVoteDelegation_CastVote(dsoRules.contractId, castVote)
              .commands
              .asScala
              .toSeq,
            disclosedContracts = DisclosedContracts
              .forTesting(dsoRules, voteRequestWithState)
              .toLedgerApiDisclosedContracts,
          )
      },
    )(
      "ballot is recorded for the delegating SV, not the voter party",
      _ => {
        val updated = sv1Backend
          .listVoteRequests()
          .find(vr => getTrackingId(vr) == trackingCid)
          .value
        val votes = updated.payload.votes.asScala.values.toSeq
        votes.map(_.sv) should contain(sv1Party.toProtoPrimitive)
        votes.map(_.sv) should not contain voterParty.toProtoPrimitive
        votes
          .find(_.sv == sv1Party.toProtoPrimitive)
          .value
          .accept shouldBe true
      },
    )
  }

  "delegated voter can request a vote attributed to the SV" in { implicit env =>
    val (sv1Party, _, voterParty, delegationCid) = setupDelegatedVoter()
    val dsoRules = sv1Backend.getDsoInfo().dsoRules
    // VoteRequest.requester is the SV name (Text), not the party id.
    val sv1Name = Option(dsoRules.payload.svs.get(sv1Party.toProtoPrimitive)).value.name

    val requestVote = new DsoRules_RequestVote(
      sv1Party.toProtoPrimitive,
      grantFeaturedAppAction(voterParty),
      new Reason("url", "delegated request"),
      Optional.of(dsoRules.payload.config.voteRequestTimeout),
      Optional.empty(),
      Optional.of(voterParty.toProtoPrimitive),
    )

    actAndCheck(
      "voter requests a vote through VoteDelegation", {
        aliceValidatorBackend.participantClientWithAdminToken.ledger_api_extensions.commands
          .submitJava(
            actAs = Seq(voterParty),
            commands = delegationCid
              .exerciseVoteDelegation_RequestVote(dsoRules.contractId, requestVote)
              .commands
              .asScala
              .toSeq,
            disclosedContracts = DisclosedContracts
              .forTesting(dsoRules)
              .toLedgerApiDisclosedContracts,
          )
      },
    )(
      "created VoteRequest records the SV as requester",
      _ => {
        val created = sv1Backend
          .listVoteRequests()
          .find(_.payload.reason.body == "delegated request")
          .value
        created.payload.requester shouldBe sv1Name
        created.payload.votes.asScala.keySet should contain(sv1Name)
        created.payload.votes.asScala.values.map(_.sv) should contain(sv1Party.toProtoPrimitive)
        created.payload.votes.asScala.values
          .map(_.sv) should not contain voterParty.toProtoPrimitive
      },
    )
  }

  "VoteDelegation_CastVote rejects a ballot for the wrong SV" in { implicit env =>
    val (sv1Party, _, voterParty, delegationCid) = setupDelegatedVoter()
    val dsoRules = sv1Backend.getDsoInfo().dsoRules
    val sv2Party = sv2Backend.getDsoInfo().svParty

    val voteRequest = clue("sv2 opens a vote request") {
      sv2Backend.createVoteRequest(
        sv2Party.toProtoPrimitive,
        grantFeaturedAppAction(voterParty),
        "url",
        "open request for negative cast",
        dsoRules.payload.config.voteRequestTimeout,
        None,
      )
      sv1Backend.listVoteRequests().loneElement
    }
    // Opening the request already records sv2's requester vote; the rejected cast must not change that map.
    val votesBefore = voteRequest.payload.votes

    val castVoteWrongSv = new DsoRules_CastVote(
      voteRequest.contractId,
      new Vote(
        sv2Party.toProtoPrimitive,
        true,
        new Reason("url", "wrong sv"),
        Optional.empty(),
      ),
      Optional.of(voterParty.toProtoPrimitive),
    )
    val voteRequestWithState = ContractWithState(voteRequest, dsoRules.state)

    loggerFactory.assertLoggedWarningsAndErrorsSeq(
      a[CommandFailure] should be thrownBy {
        aliceValidatorBackend.participantClientWithAdminToken.ledger_api_extensions.commands
          .submitJava(
            actAs = Seq(voterParty),
            commands = delegationCid
              .exerciseVoteDelegation_CastVote(dsoRules.contractId, castVoteWrongSv)
              .commands
              .asScala
              .toSeq,
            disclosedContracts = DisclosedContracts
              .forTesting(dsoRules, voteRequestWithState)
              .toLedgerApiDisclosedContracts,
          )
      },
      _ => succeed,
    )

    clue("rejected cast leaves the vote map unchanged") {
      val unchanged =
        sv1Backend.listVoteRequests().find(_.contractId == voteRequest.contractId).value
      unchanged.payload.votes shouldBe votesBefore
      unchanged.payload.votes.asScala.values.map(_.reason.body) should not contain "wrong sv"
      unchanged.payload.votes.asScala.values
        .map(_.sv) should not contain sv1Party.toProtoPrimitive
    }
  }
}
