---
type: command
tags: [cli, wallet, withdraw, send]
updated: 2026-09-22
---

# Wallet commands

Developer surface that calls nest through `ZappiClient`. Every command here needs [[reference/auth]]. Amounts named `--amount` are **USD cents** (positive integers). Usages: [[usages]].

These are separate from the buyer fund step in [[flows/buyer]], which does not call deposit APIs.

## balance

```bash
zappi-cli balance [--pot <id>]
```

- `--pot <id>`, or `ZAPPI_POT_ID` already set: `getPotBalance`. Prints `balanceUsdCents` and `pendingUsdCents`. JSON `scope` is `"pot"`.
- Otherwise: `getWalletBalance`. Pretty output shows wallet address, USDB owned balance (token id starting with `btkn`, else the first token), and pending transfer count. JSON also includes `tokenBalances`, `recentTransfers` length, and `readonlyReady`.

## transactions

```bash
zappi-cli transactions [<id>]
```

No id: `listTransactions`. Empty list prints `No transactions.` An id: `getTransaction` (id, type, status, amount cents).

## deposit-options / deposit-address

```bash
zappi-cli deposit-options
zappi-cli deposit-address --asset <asset> --network <network>
```

`deposit-options` lists each asset and its network ids plus arrival copy. `deposit-address` requires both flags and prints the nest deposit destination for that cashier combo. Missing either flag: `Usage: zappi-cli deposit-address --asset <a> --network <n>`.

## withdraw-options / withdraw

```bash
zappi-cli withdraw-options
zappi-cli withdraw estimate --asset <a> --network <n> (--address <addr> | --bolt11 <invoice>) [--amount <cents>] [--sats <n>]
zappi-cli withdraw quote    --asset <a> --network <n> (--address <addr> | --bolt11 <invoice>) [--amount <cents>] [--sats <n>]
zappi-cli withdraw confirm <quoteId> [--auth <token>]
zappi-cli withdraw status <id>
```

Bad or missing subcommand: `Usage: zappi-cli withdraw <estimate|quote|confirm|status>`.

`estimate` and `quote` require `--asset` and `--network`, plus `--address` (on-chain) or `--bolt11` (Lightning). Optional `--amount` (cents) and `--sats`. Estimate prints gross, fee, net, and arrival copy when present. Quote prints `quoteId`, `expiresAt`, net, and arrival copy.

`confirm <quoteId>` runs the SDK two-phase withdraw. The signer loads the pot seed ([[reference/auth]]), converts micro-USDB back to cents (`10_000` micro per cent), and sends USDB from account `0` on `SPARK_NETWORK`. Only `sparkTxHash` goes to nest. `--auth` is an authorization token for step-up. Output: `withdrawalId`, `status`, and a warning if `needsSignature` is still true.

`status <id>` prints id, status, destination display, and failure copy when nest sends it.

## send

```bash
zappi-cli send internal --to <userId> --amount <cents> [--memo <text>] [--auth <token>]
zappi-cli send external --asset <a> --network <n> --address <addr> --amount <cents> [--auth <token>]
```

Bad subcommand: `Usage: zappi-cli send <internal|external>`.

**internal**

1. `resolveSendTarget`. No `destinationSparkAddress` throws with the recipient’s custody mode.
2. Sign USDB from the pot to that address.
3. `POST wallet/send/internal` with `recipientUserId`, `amountCents`, `destinationType: "internal"`, `idempotencyKey`, `sparkTxHash`, `destinationSparkAddress`, optional `memo`.

**external**

1. `sendExternal` for a quote deposit address.
2. If `needsSignature` and nest returned `depositAddress`, `tokenIdentifier`, and `sendAmount`, sign that amount from the pot and call `sendExternal` again with `sparkTxHash`.

Both idempotency keys embed `Date.now()`, so a repeated command is a new key, not a retry of the same send.

Pretty success for internal includes recipient, amount, tx hash, transfer id, and status. External includes asset, network, amount, status, and `withdrawId` when present. The mnemonic is not printed.
