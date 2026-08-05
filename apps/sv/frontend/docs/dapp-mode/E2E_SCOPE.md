# dApp mode — end-to-end integration test scope

This doc scopes the automated e2e work called out in
[PR #19 review](https://github.com/canton-network/splice-sv-voting-dapp/pull/19#pullrequestreview-4843117996)
("an end to end integration test that shows this working fully").

## What "working fully" means

The delegated governance path must be proven end to end:

1. An SV creates a `VoteDelegation` naming a non-SV `voterParty`.
2. That voter exercises `VoteDelegation_RequestVote` and/or
   `VoteDelegation_CastVote` (with `DsoRules` / `VoteRequest` disclosed).
3. The resulting vote request / ballot is visible through Scan (or the SV
   admin API), with `vote.sv` / `requester` equal to the delegating SV — not
   the voter party.

CIP-103 wallet transport (connect → `prepareExecuteAndWait` → gateway UI
approval) is covered by the frontend integration test below.

## Coverage

| Layer | What it proves | Where |
| --- | --- | --- |
| Daml scripts | Choice semantics, mismatch / wrong-voter / wrong-SV rejects | `daml/splice-dso-governance-test/.../TestGovernance.daml` (`testVoteDelegationRequestVote`, `testVoteDelegationCastVote`, …) |
| Vitest | Config, wallet login gate, Scan-backed reads, command builders, submission + disclosures (mocked `dappSdkClient`) | `apps/sv/frontend/src/__tests__/dapp/` |
| Scala IntegrationTest | Cross-participant VoteDelegation create + cast/request with disclosures; attribution to SV; wrong-SV reject | `apps/app/src/test/scala/.../VoteDelegationIntegrationTest.scala` |
| Scala Frontend IT | Real SV UI (`dappMode`) + reference wallet gateway: connect → ACS discovery → cast → Approve → on-ledger SV attribution | `apps/app/src/test/scala/.../SvDappModeFrontendIntegrationTest.scala` |
| Manual LocalNet | Full CIP-103 UI path including gateway approval | Root `DEMO_RUNBOOK.md` |

## Ledger-path IntegrationTest (`VoteDelegationIntegrationTest`)

**Goal:** CI-green proof of the delegated ledger path without Selenium or a live
wallet gateway.

**Scenario:**

1. Allocate a voter party on alice validator (non-SV participant).
2. SV creates `VoteDelegation(sv, voterParty)` via ledger `submitJava`.
3. Seed an open `VoteRequest` (for cast) via SV admin API.
4. As the voter (with `DisclosedContracts` for `DsoRules` and the
   `VoteRequest`), exercise `VoteDelegation_CastVote` and
   `VoteDelegation_RequestVote`.
5. Assert via SV list APIs that `vote.sv` / `requester` = delegating SV.
6. Negative: cast with wrong `vote.sv` fails.

**Acceptance criteria:**

- [x] Green in the normal Splice `IntegrationTest` CI lane (no frontend job)
- [x] Voter participant ≠ SV participant
- [x] Cast and request succeed only through `VoteDelegation_*`
- [x] Assertion on SV list APIs that the recorded SV is the delegating party
- [x] At least one negative case (wrong SV on cast) fails as expected

## UI + wallet gateway Frontend IT (`SvDappModeFrontendIntegrationTest`)

**Goal:** CI-green proof of the CIP-103 browser path against the real SV UI and
`@canton-network/wallet-gateway-remote`.

**Topology:**

```
SV UI :3213 (dappMode)
  ├─ reads  → Scan :5012
  └─ CIP-103 → wallet-gateway :3030
                 └─ JSON Ledger API → alice participant :6501
```

**Auth:** gateway `self_signed` IDP with HMAC secret `test` and audience
`https://canton.network.global` (same as Splice IT `unsafe-jwt-hmac-256`).
No mock OAuth IDP.

**Party allocation:** gateway-first. `createWallet` with
`signingProviderId=participant` allocates a new party on alice's participant;
the test then creates `VoteDelegation` for that party (the gateway cannot import
a pre-existing party).

**Scenario:**

1. Start gateway (`npx @canton-network/wallet-gateway-remote@1.6.0`); allocate
   participant-signed wallet via User API.
2. SV creates `VoteDelegation`; sv2 seeds an open `VoteRequest`.
3. Open `http://localhost:3213`; assert connect-wallet (not OIDC).
4. Connect through the gateway popup; ACS discovery resolves the delegation.
5. Cast accept in the proposal form; Approve in the gateway popup.
6. Assert UI success and on-ledger `vote.sv` = delegating SV.

**Local run:**

```bash
./start-canton.sh   # or your usual IT Canton bring-up
./start-frontends.sh -d -s -D
sbt "apps-app/testOnly org.lfdecentralizedtrust.splice.integration.tests.SvDappModeFrontendIntegrationTest"
```

The test itself starts/stops the wallet gateway child process. Port **3213** is
the dApp-mode SV UI (`start-frontends.sh -D`); **3030** is the gateway.

**Acceptance criteria:**

- [x] Class lands in the frontend wall-clock CI lane (`Frontend` in the name)
- [x] Uses the real gateway and real SV UI (no mocked CIP-103 endpoint)
- [x] On-ledger attribution to the delegating SV after Approve
- [x] Standard-mode SV UIs on 3211/3212 unchanged when `-D` is omitted
