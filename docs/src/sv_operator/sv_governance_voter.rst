..
   Copyright (c) 2024 Digital Asset (Switzerland) GmbH and/or its affiliates. All rights reserved.
..
   SPDX-License-Identifier: Apache-2.0

SV Governance Voter (Phase 1 Infrastructure)
============================================

The governance-voter contract work implements Milestone 1 of the SV
Governance dApp project
(`Canton Development Fund PR #223 <https://github.com/canton-foundation/canton-dev-fund/pull/223>`_,
as amended by
`PR #414 <https://github.com/canton-foundation/canton-dev-fund/pull/414>`_).

Phase 1 lands the *flexibility* to split governance voting from node
operations while preserving status-quo voting behavior. Each SV retains one
vote; the operator path remains valid for every action; and a new, optional
governance-voter path is introduced for explicitly supported non-operational
governance actions. A governance voter is the party authorized to act on the
represented SV's vote on those actions; it is not a new voting unit and does
not add voting weight.

Vote attribution
----------------

Vote records carry the represented SV (``Vote.sv``) plus optional
attribution metadata: the party that signed the cast (``Vote.castBy``) and
the authority path used (``Vote.castByRole``, ``VCR_Operator`` or
``VCR_GovernanceVoter``). Attribution is accountability metadata only;
tallying continues to use the represented SV's single vote slot, keyed by SV
name as before. Both fields are optional and appended at the end of the
record so existing on-ledger contracts upgrade cleanly (legacy votes carry
``None``).

The binding
-----------

``SvGovernanceVoter`` binds a represented SV to the party that may cast its
vote on governance-voter eligible actions. The binding is DSO-signed and
managed exclusively through ``DsoRules``. SV onboarding (``DsoRules_AddSv``)
atomically installs the represented SV's self-binding
(``governanceVoter == sv``), so every onboarded SV has exactly one active
binding from creation — and, because the self-binding leaves the SV operator
in control, onboarding behavior is unchanged from the operator's
perspective.

Subsequent changes flow through the ``SRARC_RotateGovernanceVoter`` action,
which is dispatched by ``DsoRules_RotateGovernanceVoter`` to
fetch-and-archive the current binding and create a new one — preserving the
single-active-binding-per-SV property on the ledger. The action is
operational (not in ``isGovernanceVoterAction``) and runs through the
standard confirmation-quorum flow, so a single SV operator cannot
unilaterally swap their governance voter. Returning control to the operator
is expressed as rotation back to ``governanceVoter == sv``. There is
intentionally no ``Clear`` choice — leaving the SV without a binding would
leave nobody authorized to cast its vote on the governance-voter path.

Because the DSO is the sole signatory, bare-create by the represented SV is
not authorized, and the implicit per-signatory ``Archive`` choice is only
available to the DSO. Multi-user organizations are expected to assign
several users to the single governance-voter party at the dApp/UI layer
rather than by maintaining multiple bindings.

The DSO party is the sole stakeholder: neither the represented SV nor the
governance-voter party is a ledger observer. Both discover the binding
through Scan or explicit disclosure. SV nodes still see every binding because
they host the DSO party, while keeping the DSO party as the only stakeholder
confines the binding to participants that already vet the
``splice-dso-governance`` DAR. This matters during party migration:
recovering an offboarded SV's party onto a regular validator imports that
party's ACS, and a stray observer on this template would make the import
fail because a regular validator does not carry the
``splice-dso-governance`` package.

Request and cast paths
----------------------

Both opening and casting a vote use a single choice each —
``DsoRules_RequestVote`` and ``DsoRules_CastVote``. Each choice has an
optional ``bindingCid`` argument (appended at the end for upgrade
compatibility) that selects the path:

* Operator path (``bindingCid = None``): status-quo behavior, valid for
  **all** actions. The controller is the represented SV; the vote is
  recorded with ``VCR_Operator`` attribution. Existing clients that do not
  pass the new optional arguments keep working unchanged.
* Governance-voter path (``bindingCid = Some _``, and on the cast choice
  ``castBy = Some <governance-voter party>``): available for
  *governance-voter eligible* actions only. The represented SV is recovered
  from the binding; a checked fetch enforces that the caller is the
  binding's authoritative governance voter; the vote is recorded with
  ``VCR_GovernanceVoter`` attribution.

In Phase 1 the two paths *coexist*: the operator path is not restricted, so
enabling the governance-voter path does not change which votes can be cast
or by whom they can be overridden — both paths write into the represented
SV's single vote slot under the shared per-SV cooldown, last writer wins.
Enforcing a strict operational/governance split (closing the operator path
for governance-classified actions) is deliberately deferred to a later
phase, gated on the CIP review.

Action taxonomy
---------------

``isGovernanceVoterAction`` defines which actions are *eligible* for the
governance-voter path. The ``SRARC_*`` branch is an explicit per-constructor
enumeration with no wildcard fall-through, so adding a new SV-side action
forces an explicit eligibility decision at compile time. The ``CRARC_*``
(AmuletRules) branch retains a wildcard default of non-eligibility, with
``CRARC_SetConfig`` as the single eligible action; AmuletRules actions are
owned by a separate codebase area and policy changes for them should be
driven from there.

The proposed allowlist is intended to be concrete enough for maintainer and
CIP review, not a final statement of upstream governance policy. In
particular, inclusion of ``SRARC_OffboardSv`` should be validated through
that review because it is a high-impact governance membership action.

Action-level taxonomy is related to, but distinct from, the field-level
classification of DSO rules config and Amulet config (operational /
governance / fixed per field, governance by default) introduced by the
amended Milestone 1 scope; the field-classification model and its
reclassification vote process are documented in the accompanying CIP and
implemented in a follow-up contract slice.

Submission path
---------------

The supported submission path is explicit disclosure: a governance voter
that is not affiliated with the represented SV presents the Scan-discovered
proposal and request contract IDs together with the necessary disclosed
contracts when exercising the cast choice. SV-hosted submission or relay
remains a valid deployment option but is not required by this design.

The dApp standard (CIP-0103) defines the client-side API between a dApp and
a Wallet rather than any on-ledger contract pattern, so it does not
prescribe the shape of these templates. The contract surface in this slice
is intentionally compatible with a CIP-0103 external-party submission flow:
the cast choice is controlled by the governance-voter party and takes
``requestCid`` and ``bindingCid`` as plain contract IDs, with the binding
sourced via Scan and supplied as a disclosed contract on the cast
submission. A CIP-0103-conforming Wallet can therefore submit the cast via
``prepareExecute`` with the relevant disclosed contracts; the
governance-voter dApp client, Scan-based discovery, and
Wallet/signing-provider choice live downstream of this contract work.
