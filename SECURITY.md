# Security Policy

## Scope

This repo is the off-chain backend for AureumDCA (schedule executor,
event indexer, and REST API). It runs against `dca-vault-contract`
on **Stellar Testnet only** and is not intended for production use
with real funds at this stage.

The `EXECUTOR_SECRET` environment variable controls a Stellar
account used to submit transactions. This key pays transaction fees
only — it holds no vault funds itself, since `execute_swap` on the
contract is permissionless and does not require the executor to
have any special authority over user vaults.

## Reporting a Vulnerability

If you discover a security vulnerability — including issues with
event parsing correctness, executor transaction logic, API
endpoints exposing unintended data, or environment variable
handling — please report it privately rather than opening a public
GitHub issue.

**To report:** email douglasfrancis054@gmail.com with a clear
description of the vulnerability, steps to reproduce if applicable,
and its potential impact.

Please do not disclose the vulnerability publicly until it has
been reviewed and, if valid, addressed.

## What to expect

- We aim to acknowledge reports within 5 business days.
- We will keep you updated as we investigate and work on a fix.
- We're happy to credit reporters in the fix's commit message or
  release notes, unless you prefer to remain anonymous.

## Out of scope

- Issues already tracked in open GitHub issues
- Purely theoretical vulnerabilities with no demonstrated impact
- Issues in third-party dependencies (report those to the
  respective maintainers; we will still appreciate a heads-up)
