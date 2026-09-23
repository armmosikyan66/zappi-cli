---
type: command
tags: [cli, propose, pots]
updated: 2026-09-22
---

# propose

Host setup. Run on the **agent host** so the pot key is created there. The human only registers and funds in Zappi. Usages: [[usages]].

```bash
zappi-cli propose
zappi-cli propose --address <pot-address> [--label <name>] [--mode free|auth_required] [--open] [--origin <url>]
zappi-cli propose --generate [--label <name>] [--mode free|auth_required] [--key-file <path>] [--open] [--origin <url>]
```

There is no `--pot` install flag. After the human registers, the runtime pot id is `ZAPPI_POT_ID`.

## Wizard (TTY, no generate/address flags)

1. **Existing or generate.** Default row is **Generate a new pot**. Selected row is a green `◉`; others are `○`. ↑/↓, `j`/`k`, and digits `1`/`2` move. ENTER confirms. `NO_COLOR=1` drops the green.
2. **How should this pot spend?** Auth not required (`free`) or Auth required (`auth_required`). Sets deep-link `mode=`.
3. **Label.** Shown in both modes. Blank auto-generates `pot_<8-hex>`.
4. **Key file** (generate only). Blank uses `~/.zappi/pot-<slug>-<stamp>.txt` (or `new-pot-<stamp>.txt`). A pasted **folder** writes the `.txt` inside that folder (`resolveKeyFilePath`) so the CLI does not `open()` a directory (`EISDIR`). File mode is `0600`. The phrase is not printed.
5. **Browser.** Opens `https://zappi.money` by default. ENTER opens, auto-open after a few seconds, `c` copies. Ctrl+C quits cleanly.

Existing pot: paste the **public** pot address. It is validated for `SPARK_NETWORK` (default `MAINNET`). A recovery phrase is rejected. Blank cancels.

No TTY: the wizard does not run. The CLI prints the flag usage instead of hanging.

## Flags

| Flag | Role |
| --- | --- |
| `--generate` | Create a fresh BIP-39 key on this host and a `0600` key file. |
| `--address` | Public pot address for a pot that already exists. Not a recovery phrase. |
| `--label` | Pot name. Blank in the wizard becomes `pot_<id>`. |
| `--mode` | `free` or `auth_required`. Invalid values error: `Use --mode free or --mode auth_required`. |
| `--key-file` | Override the generate key path. |
| `--open` | Open the register link (also the wizard’s browser step). |
| `--origin` | Web origin for the link. Else `ZAPPI_APP_ORIGIN`, else `NEXT_PUBLIC_SITE_URL`, else `https://zappi.money`. Non-http(s) falls back to the default. |

Register URL is built from the public address, optional label, origin, and network. Staging must set `ZAPPI_APP_ORIGIN` together with `ZAPPI_API_URL` ([[flows/buyer]]).

## Output

Pretty success includes address, label, key file path when generated, and the register URL. It tells the operator to set `ZAPPI_POT_SEED` and not `cat` the file. `--json` best-effort parses the plain lines into `{ ok, command: "propose", mode, sparkAddress, href, keyFile?, copied }`. `mode` in that JSON is `generate` when a key file line is present, otherwise `flags` — that is not the spend mode.

Success copy for a free pot includes: disconnect cannot stop on-chain spend; empty pot is the cap.
