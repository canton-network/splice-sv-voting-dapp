..
   Copyright (c) 2024 Digital Asset (Switzerland) GmbH and/or its affiliates. All rights reserved.
..
   SPDX-License-Identifier: Apache-2.0

.. _sv-dapp-mode:

SV UI dApp Mode (Delegated Governance Voting)
=============================================

The SV web UI supports an optional **dApp mode** that lets a *delegated voter
party* use the standard governance UI without any access to the SV app
backend. The mode is a pure configuration toggle: the UI, routes, and
governance workflows are identical to standard operation.

When dApp mode is enabled:

- **Login** goes through a `CIP-0103 <https://github.com/canton-foundation/cips>`_
  compatible wallet (for example the reference
  ``@canton-network/wallet-gateway-remote`` gateway, or partner wallets)
  instead of OAuth against the SV app backend.
  The header *Logout* button disconnects the wallet session.
- **Reads** (vote requests, vote results, DSO info, and related governance
  data) are served by a Scan instance instead of the SV app backend.
- **Vote submissions** (proposal creation and vote casting) are signed by the
  connected wallet and exercised on a ``VoteDelegation`` contract through the
  wallet's dApp API, instead of being submitted by the SV app backend as the
  SV party.

The UI itself holds no keys, mnemonics, or long-lived tokens: every
submission is approved in the wallet, and the connected wallet account's
party is used as the delegation's voter party.

On-ledger foundation
--------------------

dApp mode builds on the ``VoteDelegation`` template in the
``splice-dso-governance`` Daml package. An SV signs a ``VoteDelegation``
contract naming a ``voterParty`` that is authorized to request votes and cast
votes on the SV's behalf:

- ``VoteDelegation_RequestVote`` relays ``DsoRules_RequestVote`` with
  ``requester`` equal to the delegating SV.
- ``VoteDelegation_CastVote`` relays ``DsoRules_CastVote`` with ``vote.sv``
  equal to the delegating SV.

Both underlying ``DsoRules`` choices carry an optional ``voterParty``
co-controller, so delegated exercises are co-authorized and recorded
on-ledger. One vote per SV is preserved: the recorded ballot always belongs
to the SV; the delegated party only authorizes the exercise.

The SV can revoke a delegation at any time by archiving the
``VoteDelegation`` contract.

Prerequisites
-------------

1. A ``VoteDelegation`` contract on the ledger, with ``sv`` set to the
   delegating SV party and ``voterParty`` set to a party controlled by the
   voter's wallet. The voter party is typically hosted on a participant other
   than the SV node.
2. The ``splice-dso-governance`` Daml package vetted on the participant
   hosting the voter party (the voter party is a stakeholder on the
   delegation contract).
3. A CIP-0103 wallet holding the voter party, reachable from the voter's
   browser. The configured wallet gateway is added to the wallet picker
   alongside any announced browser-extension wallets, so partner wallets can
   be used as long as they hold the voter party.
4. A Scan URL reachable from the voter's browser.

Configuration
-------------

dApp mode is configured on the SV web UI only; no SV app backend changes are
required (in a typical delegated-voter deployment there is no SV app backend
at all — the UI is served as static assets).

For containerized deployments, the ``sv-web-ui`` docker image accepts the
following environment variables. Leaving them unset (the default) keeps the
UI in standard mode, so existing deployments are unaffected:

.. list-table::
   :header-rows: 1

   * - Environment variable
     - Purpose
   * - ``SPLICE_APP_UI_DAPP_MODE_ENABLED``
     - Set to ``true`` to enable dApp mode.
   * - ``SPLICE_APP_UI_DAPP_MODE_SCAN_URL``
     - Scan API base URL, e.g. ``https://scan.sv-2.example.com/api/scan``.
   * - ``SPLICE_APP_UI_DAPP_MODE_WALLET_GATEWAY_URL``
     - CIP-0103 wallet gateway dApp RPC URL, e.g. ``http://localhost:3030/api/v0/dapp``.
   * - ``SPLICE_APP_UI_DAPP_MODE_SV_PARTY_ID``
     - The delegating SV party. Falls back to the ``sv_party_id`` reported by
       Scan's ``/v0/dso`` endpoint when unset; set it explicitly whenever the
       configured Scan instance is not sponsored by the delegating SV.
   * - ``SPLICE_APP_UI_DAPP_MODE_VOTE_DELEGATION_CID``
     - Contract id of the ``VoteDelegation`` authorizing the wallet party.

Equivalently, when providing ``config.js`` directly, add a ``dappMode`` block
to ``window.splice_config`` (the ``auth`` and ``services.sv`` entries remain
required by the config schema but are not used while dApp mode is enabled):

.. code-block:: javascript

   window.splice_config = {
     // ... existing auth, services, and spliceInstanceNames entries ...
     dappMode: {
       enabled: "true",
       scanUrl: "https://scan.sv-2.example.com/api/scan",
       walletGatewayUrl: "http://localhost:3030/api/v0/dapp",
       svPartyId: "<delegating SV party id>",
       voteDelegationCid: "<VoteDelegation contract id>",
     },
   };

Functional scope
----------------

All governance functionality is available in dApp mode: the proposal listing
(action required, inflight, and history), proposal details, vote casting and
editing, and proposal creation for all supported action types.

Operations that require the SV node itself have no Scan equivalent and are
unavailable; the corresponding UI sections show their regular error states.
This includes generating validator onboarding secrets, updating the desired
amulet price, and the CometBFT/sequencer/mediator status views.

Testing locally
---------------

dApp mode can be verified end to end on LocalNet:

1. Build the LocalNet images from a branch containing the ``VoteDelegation``
   template and start LocalNet.
2. Create a ``VoteDelegation`` contract through the SV participant's JSON
   Ledger API, with ``voterParty`` set to a party hosted on the app-user
   participant. Upload the ``splice-dso-governance`` DAR to that participant
   first — the voter party's participant must vet the package, or the create
   fails with ``PACKAGE_SELECTION_FAILED``.
3. Run the reference wallet gateway via
   ``npx @canton-network/wallet-gateway-remote``, configured against the
   participant hosting the voter party, and add a wallet for that party.
4. Enable ``dappMode`` in the SV UI ``config.js`` with the LocalNet Scan URL
   (``http://scan.localhost:4000/api/scan``), the gateway dApp RPC URL
   (``http://localhost:3030/api/v0/dapp``), the SV party, and the delegation
   contract id.

A developer-focused guide to the implementation and its tests is maintained
with the frontend sources under ``apps/sv/frontend/docs/dapp-mode/README.md``.
