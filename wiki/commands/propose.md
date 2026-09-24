---
type: command
tags: [cli, propose, pots]
updated: 2026-09-24
---

# propose

Host setup. Run on the **agent host** so the pot key is created there. The human only registers and funds in Zappi. Usages: [[usages]].

```bash
npx @zappimoney/zappi-cli propose
npx @zappimoney/zappi-cli propose --address <pot-address> [--label <name>] [--mode free|auth_required] [--open] [--origin <url>]
npx @zappimoney/zappi-cli propose --generate [--label <name>] [--mode free|auth_required] [--key-file <path>] [--open] [--origin <url>]
```

There is no `--pot` install flag. After the human registers, the runtime pot id is `ZAPPI_POT_ID`.

## Wizard (TTY, no generate/address flags)

1. **Existing or generate.** Default row is **Generate a new pot**. Selected row is a green `◉`; others are `○`. ↑/↓, `j`/`k`, and digits `1`/`2` move. ENTER confirms. `NO_COLOR=1` drops the green.
2. **How should this pot spend?** Auth not required (`free`) or Auth required (`auth_required`). Sets deep-link `mode=`. Skipped when `--mode` was passed.
3. **Network.** MAINNET or REGTEST. Asked only when `SPARK_NETWORK` is unset. Must match the app you register in. MAINNET is the first row. The wizard does not invent a network for this question.
4. **App origin.** Production `https://zappi.money`, staging `http://dev.zappi.money` (pair with api-dev), local `http://localhost:3000`, or a custom http(s) URL. Asked only when `--origin`, `ZAPPI_APP_ORIGIN`, and `NEXT_PUBLIC_SITE_URL` are all unset. Production is the first row.
5. **Label.** Shown in both modes when `--label` was not passed. A typed name is kept. A blank answer asks to confirm **auto `pot_<8-hex>`** or a custom name. Choosing auto, or leaving the custom name blank, accepts `pot_<unique>`.
6. **Key file** (generate only). Blank uses `~/.zappi/pot-<slug>-<stamp>.txt` (or `new-pot-<stamp>.txt`). A pasted **folder** writes the `.txt` inside that folder (`resolveKeyFilePath`) so the CLI does not `open()` a directory (`EISDIR`). File mode is `0600`. The phrase is not printed. Skipped when `--key-file` was passed.
7. **Browser.** Opens the origin chosen above. ENTER continues, `c` copies. Ctrl+C quits cleanly.

Existing pot: paste the **public** pot address. It is validated for the network chosen in step 3 (or `SPARK_NETWORK` when that env is set). A recovery phrase is rejected. Blank cancels.

No TTY: bare `propose` prints the flag usage instead of hanging. Flag runs stay non-interactive and keep the CI defaults (`free`, MAINNET, `https://zappi.money`) when a setting was omitted. On a TTY, incomplete flags ask only for the missing settings. Fully specified flags (`--generate` or `--address`, `--mode`, `--label`, origin, and `SPARK_NETWORK`) do not prompt.

## Flags

| Flag | Role |
| --- | --- |
| `--generate` | Create a fresh BIP-39 key on this host and a `0600` key file. |
| `--address` | Public pot address for a pot that already exists. Not a recovery phrase. |
| `--label` | Pot name. In the wizard, blank confirms auto `pot_<unique>` or a custom name. |
| `--mode` | `free` or `auth_required`. Invalid values error: `Use --mode free or --mode auth_required`. |
| `--key-file` | Override the generate key path. |
| `--open` | Open the register link (also the wizard’s browser step). |
| `--origin` | Web origin for the link. On a TTY, omitted origin with `ZAPPI_APP_ORIGIN` and `NEXT_PUBLIC_SITE_URL` unset is asked (local, staging, production, or custom). Non-TTY flag runs use `ZAPPI_APP_ORIGIN`, else `NEXT_PUBLIC_SITE_URL`, else `https://zappi.money`. Non-http(s) on that flag path falls back to the default. |

Register URL is built from the public address, optional label, origin, and network. Staging must set `ZAPPI_APP_ORIGIN` together with `ZAPPI_API_URL` ([[flows/buyer]]).

## Output

Pretty success includes address, label, key file path when generated, and the register URL. It tells the operator to set `ZAPPI_POT_SEED` and not `cat` the file. `--json` best-effort parses the plain lines into `{ ok, command: "propose", mode, sparkAddress, href, keyFile?, copied }`. `mode` in that JSON is `generate` when a key file line is present, otherwise `flags` — that is not the spend mode.

Success copy for a free pot includes: disconnect cannot stop on-chain spend; empty pot is the cap.
