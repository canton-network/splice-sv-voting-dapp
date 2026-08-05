// Copyright (c) 2024 Digital Asset (Switzerland) GmbH and/or its affiliates. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

package org.lfdecentralizedtrust.splice.integration.tests

import com.digitalasset.canton.logging.SuppressionRule
import com.digitalasset.canton.topology.PartyId
import org.lfdecentralizedtrust.splice.codegen.java.splice.dsorules.actionrequiringconfirmation.ARC_DsoRules
import org.lfdecentralizedtrust.splice.codegen.java.splice.dsorules.dsorules_actionrequiringconfirmation.SRARC_GrantFeaturedAppRight
import org.lfdecentralizedtrust.splice.codegen.java.splice.dsorules.votedelegation.VoteDelegation
import org.lfdecentralizedtrust.splice.codegen.java.splice.dsorules.{
  ActionRequiringConfirmation,
  DsoRules_GrantFeaturedAppRight,
}
import org.lfdecentralizedtrust.splice.config.ConfigTransforms
import org.lfdecentralizedtrust.splice.environment.DarResources
import org.lfdecentralizedtrust.splice.integration.EnvironmentDefinition
import org.lfdecentralizedtrust.splice.integration.InitialPackageVersions
import org.lfdecentralizedtrust.splice.integration.tests.SpliceTests.SpliceTestConsoleEnvironment
import org.lfdecentralizedtrust.splice.sv.automation.delegatebased.CloseVoteRequestTrigger
import org.lfdecentralizedtrust.splice.util.*
import org.openqa.selenium.{By, WebDriver}
import org.openqa.selenium.support.ui.{ExpectedConditions, Select, WebDriverWait}
import org.slf4j.event.Level

import java.util.Optional
import scala.concurrent.duration.*
import scala.jdk.CollectionConverters.*

/** CIP-103 UI + reference wallet gateway coverage for SV dApp mode:
  * gateway allocates a voter party on alice's participant; SV creates
  * VoteDelegation; browser connects via the configured RemoteAdapter, discovers
  * the delegation from ACS, casts a vote through prepareExecuteAndWait, and
  * approves the gateway popup. On-ledger attribution remains the delegating SV.
  */
@org.lfdecentralizedtrust.splice.util.scalatesttags.SpliceDsoGovernance_0_1_29
class SvDappModeFrontendIntegrationTest
    extends FrontendIntegrationTest("sv-dapp")
    with WalletTestUtil
    with SvTestUtil
    with WalletGatewayTestFixture {

  override protected def runTokenStandardCliSanityCheck: Boolean = false

  private val dsoGovernanceDarPath =
    s"daml/dars/splice-dso-governance-${InitialPackageVersions.initialPackageVersion(DarResources.dsoGovernance)}.dar"

  override def environmentDefinition: EnvironmentDefinition =
    EnvironmentDefinition
      .simpleTopology4Svs(this.getClass.getSimpleName)
      .addConfigTransform((_, config) => ConfigTransforms.withNoVoteCooldown(config))
      .addConfigTransforms((_, config) =>
        ConfigTransforms.updateAutomationConfig(ConfigTransforms.ConfigurableApp.Sv)(
          _.withPausedTrigger[CloseVoteRequestTrigger]
        )(config)
      )

  private def testId(id: String) = cssSelector(s"[data-testid='$id']")

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

  // --- Selenium helpers for gateway popups (this test only) ---

  private def switchToNewestWindow(implicit webDriver: WebDriver): String = {
    val handles = webDriver.getWindowHandles.asScala.toSeq
    val newest = handles.last
    webDriver.switchTo().window(newest)
    newest
  }

  private def switchToWindow(handle: String)(implicit webDriver: WebDriver): Unit =
    webDriver.switchTo().window(handle)

  private def waitForWindowClose(handle: String, timeout: FiniteDuration = 30.seconds)(implicit
      webDriver: WebDriver
  ): Unit =
    eventually(timeUntilSuccess = timeout) {
      webDriver.getWindowHandles.asScala.contains(handle) shouldBe false
    }

  private def clickButtonNamed(name: String)(implicit webDriver: WebDriver): Unit = {
    val wait = new WebDriverWait(webDriver, java.time.Duration.ofSeconds(20))
    val button = wait.until(
      ExpectedConditions.elementToBeClickable(
        By.xpath(
          s"//button[normalize-space()='$name' or contains(normalize-space(.), '$name')]"
        )
      )
    )
    button.click()
  }

  private def selectNetworkByLabel(networkLabel: String)(implicit webDriver: WebDriver): Unit = {
    eventually(timeUntilSuccess = 20.seconds) {
      val selects = webDriver.findElements(By.cssSelector("select#network, select")).asScala
      selects.nonEmpty shouldBe true
      new Select(selects.head).selectByVisibleText(networkLabel)
    }
  }

  /** Drive CIP-103 connect against the preconfigured RemoteAdapter RPC URL. */
  private def connectWalletThroughGateway()(implicit webDriver: WebDriver): Unit = {
    val mainWindow = webDriver.getWindowHandle
    val handlesBefore = webDriver.getWindowHandles.asScala

    eventuallyClickOn(testId("connect-wallet-button"))

    eventually(timeUntilSuccess = 30.seconds) {
      webDriver.getWindowHandles.size should be > handlesBefore.size
    }
    switchToNewestWindow

    // Wallet picker may offer a custom URL field; RemoteAdapter is already
    // configured, but selecting/adding the RPC keeps the flow aligned with
    // DA's WalletGatewayPage helper.
    val customUrlInputs = webDriver.findElements(By.cssSelector(".custom-url-input")).asScala
    if (customUrlInputs.nonEmpty) {
      customUrlInputs.head.clear()
      customUrlInputs.head.sendKeys(walletGatewayDappApi)
      webDriver.findElements(By.cssSelector(".btn-add")).asScala.headOption.foreach(_.click())
    } else {
      webDriver.findElements(By.cssSelector(".wallet-card")).asScala.headOption.foreach(_.click())
    }

    // Connect form may replace the picker in-place or open a new popup.
    eventually(timeUntilSuccess = 30.seconds) {
      val networkSelects =
        webDriver.findElements(By.cssSelector("select#network, select")).asScala
      if (networkSelects.isEmpty && webDriver.getWindowHandles.size > handlesBefore.size) {
        switchToNewestWindow
      }
      webDriver
        .findElements(By.cssSelector("select#network, select"))
        .asScala
        .nonEmpty shouldBe true
    }

    // Self-signed login may ask for a client id (defaults from network config).
    webDriver.findElements(By.cssSelector("input")).asScala.foreach { input =>
      val `type` = Option(input.getAttribute("type")).getOrElse("")
      val name = Option(input.getAttribute("name")).getOrElse("").toLowerCase
      val label = Option(input.getAttribute("aria-label")).getOrElse("").toLowerCase
      if (
        `type` != "hidden" &&
        (name.contains("client") || label.contains("client") || label.contains("user"))
      ) {
        input.clear()
        input.sendKeys(walletGatewayAuthClientId)
      }
    }

    selectNetworkByLabel(walletGatewayNetworkName)
    clickButtonNamed("Connect")
    switchToWindow(mainWindow)
  }

  private def approveGatewayTransaction()(implicit webDriver: WebDriver): Unit = {
    val mainWindow = webDriver.getWindowHandle
    eventually(timeUntilSuccess = 45.seconds) {
      webDriver.getWindowHandles.size should be > 1
    }
    val popup = switchToNewestWindow
    clickButtonNamed("Approve")
    waitForWindowClose(popup)
    switchToWindow(mainWindow)
  }

  "SV dApp-mode UI" should {
    "connect wallet, discover VoteDelegation, and cast a vote attributed to the SV" in {
      implicit env =>
        clue("upload dso-governance DAR on alice's participant") {
          aliceValidatorBackend.participantClient.upload_dar_unless_exists(dsoGovernanceDarPath)
        }

        val dsoInfo = sv1Backend.getDsoInfo()
        val sv1Party = dsoInfo.svParty
        val dsoParty = dsoInfo.dsoParty
        val dsoRules = dsoInfo.dsoRules

        try {
          // Gateway self_signed tokens use sub=alice_wallet_user. Canton rejects
          // JWTs for unknown users (UserNotFound → 403), which surfaces as
          // addSession "Failed to add session" / "Client version missing".
          // The wallet-app-client config names this user but does not create it.
          clue("ensure gateway auth ledger user exists on alice") {
            val users = aliceValidatorBackend.participantClientWithAdminToken.ledger_api.users
            if (!users.list().users.exists(_.id == walletGatewayAuthClientId)) {
              users.create(
                id = walletGatewayAuthClientId,
                actAs = Set.empty,
                primaryParty = None,
                readAs = Set.empty,
                participantAdmin = true,
              )
            }
          }

          val voterParty = clue("start wallet gateway and allocate participant-signed voter") {
            startWalletGateway()
            createParticipantWallet(partyHint = s"dapp-voter-${System.currentTimeMillis()}")
          }

          clue("SV creates VoteDelegation for the gateway-allocated voter") {
            createVoteDelegation(sv1Party, dsoParty, voterParty)
          }

          val (_, voteRequest) = actAndCheck(
            "sv2 opens a vote request",
            sv2Backend.createVoteRequest(
              sv2Backend.getDsoInfo().svParty.toProtoPrimitive,
              grantFeaturedAppAction(voterParty),
              "url",
              "open request for dapp-mode cast",
              dsoRules.payload.config.voteRequestTimeout,
              None,
            ),
          )(
            "vote request is visible",
            _ => sv1Backend.listVoteRequests().loneElement,
          )
          val trackingCid = getTrackingId(voteRequest)
          val proposalCid = voteRequest.contractId.contractId

          // Lit / dapp-sdk console warnings are expected once the SDK chunk loads.
          loggerFactory.assertLogsSeq(SuppressionRule.LevelAndAbove(Level.WARN))(
            {
              withFrontEnd("sv-dapp") { implicit webDriver =>
                actAndCheck(
                  "open dApp-mode SV UI", {
                    go to s"http://localhost:$svDappUIPort"
                  },
                )(
                  "connect-wallet screen is shown (not OIDC login)",
                  _ => {
                    find(testId("connect-wallet-button")) should not be empty
                    find(id("user-id-field")) shouldBe empty
                  },
                )

                actAndCheck(
                  "connect CIP-103 wallet through the gateway", {
                    connectWalletThroughGateway()
                  },
                )(
                  "governance nav is available after ACS discovery",
                  _ => {
                    find(testId("navlink-governance")) should not be empty
                    find(testId("wallet-login-error")) shouldBe empty
                  },
                )

                actAndCheck(
                  "open proposal and cast accept via wallet gateway", {
                    go to s"http://localhost:$svDappUIPort/governance/proposals/$proposalCid"
                    eventually(timeUntilSuccess = 30.seconds) {
                      find(testId("your-vote-accept")) should not be empty
                    }
                    inside(find(testId("your-vote-reason-input"))) { case Some(element) =>
                      element.underlying.sendKeys("dapp-mode delegated cast")
                    }
                    inside(find(testId("your-vote-url-input"))) { case Some(element) =>
                      element.underlying.sendKeys("https://example.com/dapp-vote")
                    }
                    click on testId("your-vote-accept")
                    approveGatewayTransaction()
                  },
                )(
                  "vote submission succeeds in the UI",
                  _ =>
                    inside(find(testId("vote-submission-success"))) { case Some(element) =>
                      element.text should include("Vote successfully")
                    },
                )
              }
            },
            _ => succeed,
          )

          clue("on-ledger ballot is attributed to the delegating SV") {
            eventually() {
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
            }
          }
        } finally {
          stopWalletGateway()
        }
    }
  }
}
