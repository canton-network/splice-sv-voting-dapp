# SV app dApp mode

> **Staging docs.** User-facing operator documentation ultimately belongs in
> [cf-docs](https://github.com/canton-network/cf-docs). This folder is the
> single in-repo staging location for dApp-mode prose (easy to extract later).
> Do not add parallel docs under `docs/src`.

dApp mode is a config flag for the SV frontend that lets a **delegated voter
party** use the existing governance UI without any access to the SV backend:

| Concern | Standard mode | dApp mode |
| --- | --- | --- |
| Login | OIDC (or self-signed test tokens) against the SV backend | Connect a CIP-103 wallet (wallet gateway or partner wallet) |
| Reads | SV backend admin API (`/api/sv`) | Scan API |
| Governance submissions | SV backend exercises `DsoRules_RequestVote` / `DsoRules_CastVote` as the SV party | The wallet exercises `VoteDelegation_RequestVote` / `VoteDelegation_CastVote` as the wallet-bound voter party |
| Header logout | OIDC logout | Wallet disconnect |

There are no layout or design changes: the same routes, pages, and forms run
in both modes. The toggle swaps the data/auth/submission providers behind the
existing `SvAdminClient` / `VotesHooks` seams.

The UI holds no keys, mnemonics, or long-lived tokens: every submission is
approved in the wallet, and the connected wallet account's party is used as
the delegation's voter party.

## On-ledger foundation

dApp mode builds on the `VoteDelegation` template
(`daml/splice-dso-governance/daml/Splice/DsoRules/VoteDelegation.daml`). An SV
signs a contract naming a `voterParty` that may request votes and cast votes
on the SV's behalf:

- `VoteDelegation_RequestVote` relays `DsoRules_RequestVote` with `requester`
  equal to the delegating SV.
- `VoteDelegation_CastVote` relays `DsoRules_CastVote` with `vote.sv` equal to
  the delegating SV.

Both underlying `DsoRules` choices carry an optional `voterParty` co-controller,
so delegated exercises are co-authorized and recorded on-ledger. One vote per
SV is preserved — the recorded ballot belongs to the SV; the delegated party
only authorizes the exercise. The SV can revoke a delegation at any time by
archiving the `VoteDelegation` contract.

## Prerequisites

1. A `VoteDelegation` contract on the ledger, with `sv` set to the delegating
   SV party and `voterParty` set to a party controlled by the voter's wallet.
   The voter party is typically hosted on a participant other than the SV node.
2. The `splice-dso-governance` Daml package vetted on the participant hosting
   the voter party (the voter party is a stakeholder on the delegation).
3. A CIP-103 wallet holding the voter party, reachable from the voter's
   browser.
4. A Scan URL reachable from the voter's browser.

## Configuration

dApp mode is configured on the SV web UI only; no SV app backend changes are
required (in a typical delegated-voter deployment there is no SV app backend
at all — the UI is served as static assets).

Add a `dappMode` block to `window.splice_config` (see
[`public/config.js`](../../public/config.js) for the dev-server config):

```js
window.splice_config = {
  // auth and services.sv are still required by the config schema, but they
  // are not used while dApp mode is enabled.
  auth: { algorithm: 'hs-256-unsafe', secret: 'test', token_audience: 'https://sv.example.com' },
  services: { sv: { url: 'http://localhost:5014/api/sv' } },
  spliceInstanceNames: { /* ... */ },

  dappMode: {
    // 'true' (or true) turns the mode on; anything else leaves standard mode.
    enabled: 'true',
    // Scan API base URL.
    scanUrl: 'http://scan.localhost:4000/api/scan',
    // CIP-103 dApp RPC URL (reference wallet gateway or any CIP-103 endpoint).
    cip103RpcUrl: 'http://localhost:3030/api/v0/dapp',
    // The delegating SV party (Vote.sv / requester). Falls back to the
    // sv_party_id reported by Scan /v0/dso when unset.
    svPartyId: '<sv party id>',
    // Contract id of the VoteDelegation authorizing the wallet party.
    voteDelegationCid: '<VoteDelegation contract id>',
    // Optional override of the Daml package name used in template ids.
    // dsoGovernancePackageName: 'splice-dso-governance',
  },
};
```

For containerized deployments the `sv-web-ui` image exposes the same settings
as environment variables (unset means disabled, so existing deployments are
unaffected):

| Environment variable | Purpose |
| --- | --- |
| `SPLICE_APP_UI_DAPP_MODE_ENABLED` | Set to `true` to enable dApp mode |
| `SPLICE_APP_UI_DAPP_MODE_SCAN_URL` | Scan API base URL |
| `SPLICE_APP_UI_DAPP_MODE_CIP103_RPC_URL` | CIP-103 dApp RPC URL |
| `SPLICE_APP_UI_DAPP_MODE_SV_PARTY_ID` | Delegating SV party (optional; falls back to Scan) |
| `SPLICE_APP_UI_DAPP_MODE_VOTE_DELEGATION_CID` | `VoteDelegation` contract id |

## Wallets

The frontend integrates CIP-103 through `@canton-network/dapp-sdk`. The
configured RPC URL is registered as an *additional* remote adapter, and the
SDK's default discovery stays active — announced browser-extension wallets and
the default gateway list remain selectable in the wallet picker. Any CIP-103
compliant wallet (e.g. the reference `@canton-network/wallet-gateway-remote`,
or partner wallets such as Send or Loop) can hold the voter party and approve
signatures; nothing in this app is specific to the reference gateway.

## What works in dApp mode

Everything governance: the proposal list (action needed / in progress /
history), proposal details, vote casting and editing, and proposal creation
for all supported action types. Amulet price *votes* and validator licenses
are also served by Scan.

SV-node-only operations have no Scan equivalent and reject with a clear
"not available in dApp mode" error, so their page sections degrade to their
existing error states: validator onboarding secrets, CometBFT/sequencer/
mediator debug status, and desired-amulet-price updates.

## Implementation map

- `src/utils/config.tsx` — `dappMode` schema and `useDappModeConfig`
- `src/dapp/dappSdkClient.ts` — CIP-103 SDK facade (single mockable seam)
- `src/dapp/WalletSessionContext.tsx` — wallet session provider
- `src/dapp/WalletAuthCheck.tsx` — connect-wallet login gate
- `src/dapp/DappSvAdminClientProvider.tsx` — provides `SvAdminClient` in dApp mode
- `src/dapp/dappSvAdminClient.ts` — Scan-backed reads
- `src/dapp/voteDelegationCommands.ts` — `VoteDelegation_*` command builders
- `src/dapp/voteDelegationSubmission.ts` — disclosure, stale-cid re-resolution,
  gateway submission, wallet-rejection mapping
- `src/contexts/SvContext.tsx` — `useDsoInfos` branches to Scan in dApp mode
- `src/routes/authCheck.tsx` — login gate branches to the wallet gate

Two details worth knowing when debugging:

- The voter's participant does not host DSO contracts, so every submission
  attaches `DsoRules` (and for casts the `VoteRequest`) as explicitly
  disclosed contracts read from Scan. Missing disclosure surfaces as
  `PERMISSION_DENIED` ("A security-sensitive error has been received").
- `DsoRules_CastVote` archives and recreates the `VoteRequest`, so the app
  re-resolves the current contract id through Scan immediately before every
  cast. Stale ids would otherwise fail with `CONTRACT_NOT_FOUND`.

## Testing

Unit and component tests live in `src/__tests__/dapp/` and run with the rest
of the suite (`npm test`). Scan reads are mocked with msw
(`src/__tests__/mocks/handlers/scan-api.ts`), and the wallet SDK is mocked at
the `dappSdkClient` seam.

For a LocalNet walkthrough (manual e2e), see the root
[`DEMO_RUNBOOK.md`](../../../../../DEMO_RUNBOOK.md). For the planned automated
integration-test scope, see [`E2E_SCOPE.md`](./E2E_SCOPE.md).
