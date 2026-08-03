# dApp mode — end-to-end integration test scope

This doc scopes the automated e2e work called out in
[PR #19 review](https://github.com/canton-network/splice-sv-voting-dapp/pull/19#pullrequestreview-4843117996)
("an end to end integration test that shows this working fully"). It is a plan
only — **Tier A is not implemented in the current PR**.

## What "working fully" means

The delegated governance path must be proven end to end:

1. An SV creates a `VoteDelegation` naming a non-SV `voterParty`.
2. That voter exercises `VoteDelegation_RequestVote` and/or
   `VoteDelegation_CastVote` (with `DsoRules` / `VoteRequest` disclosed).
3. The resulting vote request / ballot is visible through Scan (or the SV
   admin API), with `vote.sv` / `requester` equal to the delegating SV — not
   the voter party.

CIP-103 wallet transport (connect → `prepareExecuteAndWait` → gateway UI
approval) is a separate, heavier layer; see Tier B.

## Coverage already in place

| Layer | What it proves | Where |
| --- | --- | --- |
| Daml scripts | Choice semantics, mismatch / wrong-voter / wrong-SV rejects | `daml/splice-dso-governance-test/.../TestGovernance.daml` (`testVoteDelegationRequestVote`, `testVoteDelegationCastVote`, …) |
| Vitest | Config, wallet login gate, Scan-backed reads, command builders, submission + disclosures (mocked `dappSdkClient`) | `apps/sv/frontend/src/__tests__/dapp/` |
| Manual LocalNet | Full CIP-103 UI path including gateway approval | Root `DEMO_RUNBOOK.md` |

## Tier A (recommended next) — ledger-path Scala IntegrationTest

**Goal:** CI-green proof of the delegated ledger path without Selenium,
LocalNet compose, or a live wallet gateway.

**Proposed class:** `VoteDelegationIntegrationTest` next to existing SV
integration tests, extending `SvIntegrationTestBase` /
`EnvironmentDefinition.simpleTopology4Svs` (same harness as
`SvStateManagementIntegrationTest`).

**Minimal scenario:**

1. Allocate a voter party on a non-SV participant (e.g. alice/bob validator).
2. SV creates `VoteDelegation(sv, voterParty)` via ledger submit
   (`submitJava` / JSON API — same shape as `DEMO_RUNBOOK.md` §0.2).
3. Seed or create an open `VoteRequest`.
4. As the voter (with `DisclosedContracts` for `DsoRules` and the
   `VoteRequest`), exercise `VoteDelegation_CastVote` and/or
   `VoteDelegation_RequestVote`.
5. Assert the ballot / request is visible via Scan or SV APIs with
   `vote.sv` / `requester` = delegating SV.

**Prior art to reuse:**

- Governance lifecycle via SV APIs:
  `apps/app/src/test/scala/.../SvStateManagementIntegrationTest.scala`
- Disclosed-contract submission patterns:
  `WalletSubscriptionsIntegrationTest`, `TokenStandardV2TransferIntegrationTest`,
  `ExternalPartySetupProposalIntegrationTest`
- Choice argument shapes: Daml scripts in `TestGovernance.daml`

**Explicitly out of scope for Tier A:**

- Selenium / Firefox UI automation
- LocalNet docker-compose (`splice-localnet-compose.sh`)
- Starting `@canton-network/wallet-gateway-remote` or approving txs in a
  wallet UI
- Exercising CIP-103 `prepareExecuteAndWait` against a real gateway

**Acceptance criteria (Tier A):**

- [ ] Green in the normal Splice `IntegrationTest` CI lane (no frontend job)
- [ ] Voter participant ≠ SV participant
- [ ] Cast (and optionally request) succeeds only through `VoteDelegation_*`
- [ ] Assertion on Scan or SV list APIs that the recorded SV is the
      delegating party
- [ ] At least one negative case (e.g. wrong voter) fails as expected

## Tier B (later, optional) — CIP-103 UI e2e

Browser e2e that also covers wallet connect and gateway approval.

**Prior art:** `LocalNetFrontendIntegrationTest` is the only in-repo pattern
for compose + Selenium against hostname-based UIs. There is **no** existing
CIP-103 / wallet-gateway Selenium coverage.

**Blockers / cost:**

- Inject `dappMode` into the served SV UI (LocalNet static assets or a
  dedicated Vite config — not current `start-frontends.sh`).
- Automate gateway transaction approval; dapp-sdk 1.4 ships mock-remote
  **types only** (no JS), and `wallet-gateway-remote` has no documented
  auto-approve / headless mode.
- Heavier CI (compose + images + Firefox).

**Do not invest in Tier B** until Tier A is landed and review confirms CIP-103
transport must also be automated.

## Recommendation

Ship **Tier A** as the integration test that satisfies “shows this working
fully” for the on-ledger delegated path. Keep CIP-103 UI coverage as Vitest
(mocked SDK) + `DEMO_RUNBOOK.md` until Tier B is explicitly requested.
