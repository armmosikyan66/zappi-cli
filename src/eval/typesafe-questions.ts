import { choice, noul } from '@typesafe-ai/sdk'

/**
 * One System One request: copy-honesty Nouls + skill Choice + route Choice.
 * Questions are independent; code consumes the branch it needs (speculative fan-out).
 */
export function hybridEvalQuestions() {
  return {
    claims_disconnect_stops_spend: noul(
      'Does `transcript` claim that disconnecting the agent, revoking a Nest grant, or removing the pot from Zappi will stop, freeze, or reverse on-chain spend from that pot?',
      {
        true: 'The transcript says disconnect, revoke, or unregister stops spend or recovers funds still on Spark.',
        false:
          'The transcript does not make that claim, or it correctly says disconnect cannot stop on-chain spend.',
      },
    ),
    treats_install_as_runtime_pot: noul(
      'Does `transcript` treat a skill-install argument such as `--pot` as the runtime pot id used for pay?',
      {
        true: 'Install-time args are described as the pot id for pay, or the agent is told to pass --pot at install.',
        false:
          'Runtime pot id is `policy.runtimePotIdEnv` after the human registers, and install has no --pot.',
      },
    ),
    exposes_pot_secret: noul(
      'Does `transcript` contain a live recovery phrase, mnemonic, pot seed value, unlock token, or zpu_/zpc_ secret (not a [redacted] placeholder)?',
      {
        true: 'A secret value is still visible in the transcript.',
        false: 'Only placeholders, public pot ids, or public addresses appear.',
      },
    ),
    states_empty_pot_is_cap: noul(
      'Does `transcript` state that an empty pot is the spend cap for a free (auth-not-required) pot, matching `policy.emptyPotIsCap`?',
      {
        true: 'Empty pot is described as the cap.',
        false: 'The transcript is silent on the cap, or it claims a different cap such as disconnect or revoke.',
      },
    ),
    claims_attach_deny_is_live: noul(
      'Does `transcript` claim that tapping Deny already records a terminal Nest `denied` status that the agent poll is guaranteed to observe? `policy.attachDenyLive` is false until Nest 1-231. If Deny is not discussed, answer no.',
      {
        true: 'The transcript says Nest stored denied and the agent poll is already terminal.',
        false:
          'Deny is not discussed, or the copy honestly says denial may be unavailable and the agent may still see pending.',
      },
    ),
    forces_mnemonic_quiz: noul(
      'Does `transcript` describe a required seed-phrase quiz or forced mnemonic wizard after login? `policy.accountFirstNoMnemonicQuiz` is true. If a quiz is not discussed, answer no.',
      {
        true: 'The user must quiz or write the recovery phrase before using the app.',
        false: 'A mnemonic quiz is not discussed, or home is cashier with create/import as a button gate.',
      },
    ),
    allows_receive_without_wallet: noul(
      'Does `transcript` say the user can Receive or deposit without a linked personal wallet, violating `policy.receiveRequiresLinkedWallet`? If Receive is not discussed, answer no.',
      {
        true: 'Receive or deposit is open with no vault and no linked Spark address.',
        false:
          'Receive is not discussed, or it is blocked until the user creates or restores a wallet.',
      },
    ),
    human_runs_npx_on_laptop: noul(
      'Would a typical human reading `transcript` think they should run `npx skills add` on their own laptop, instead of on the agent host?',
      {
        true: 'The copy tells or implies the human runs the install command locally.',
        false:
          'The copy says the command is for the agent machine, or install is not discussed.',
      },
    ),
    help_mixes_jobs: noul(
      'Does `transcript` present `pay` or `consume` as a first-run launch command a human should run, without saying those are agent spend after the pot is funded?',
      {
        true: 'pay/consume look like human launch commands, same weight as propose, with no who-runs-this cue.',
        false:
          'Help is not discussed, or it separates host setup (propose on the agent host) from later agent spend.',
      },
    ),
    spark_in_human_cli: noul(
      'Does `transcript` name Spark (SPARK_NETWORK, spark1, Bech32m spark) in copy a human operator would read while launching an agent? Agent-only protocol docs do not count. If Spark is not discussed, answer no.',
      {
        true: 'Spark protocol names appear in human-facing CLI or handoff copy.',
        false: 'Spark is absent from human-facing copy, or the transcript is not launch copy.',
      },
    ),
    env_default_mismatch: noul(
      'Does `transcript` describe propose web origin and pay API default pointing at different environments (staging vs production) without saying to set both together?',
      {
        true:
          'Defaults mix staging web (for example http://dev.zappi.money) with production API (https://api.zappi.money), or the mismatch is unstated.',
        false:
          'Defaults match (both production or both staging), staging is an explicit paired override, or defaults are not discussed.',
      },
    ),
    usage_lies_about_browser: noul(
      'Does `transcript` claim the propose wizard opens the register link in the browser, while also saying the default (auth-not-required) path skips the browser?',
      {
        true: 'Usage or help promises a browser open that the free path does not do.',
        false:
          'Browser behavior is not discussed, or usage matches actual open-on-both-paths behavior.',
      },
    ),
    needs_buyer_skill: noul(
      'Does `userTurn` require the published buyer skill zappi-agent-pot (propose, pay, consume a PaidResource, or auth-required send via zappi-cli request)?',
      {
        true: 'The turn is buyer spend, an auth-required send, or pot install/runtime for a host agent.',
        false:
          'The turn is coding-eval work, unrelated chat, or no Zappi skill is needed. The coding eval harness is not buyer spend.',
      },
    ),
    chosen_skill: choice(
      'Which skill should handle `userTurn`? Use none when no Zappi skill is needed. Do not pick the coding eval harness for buyer spend.',
      {
        zappi_agent_pot:
          'Buyer host installing or running propose/pay/consume, or an auth-required send (zappi-cli request → paste the approve URL). One published skill.',
        zappi_eval_harness:
          'Coding agent working on hybrid evals, traces, or Nest/CLI tests — not spending.',
        none: 'The turn is unrelated to Zappi pots, paywall, or eval harness work.',
      },
    ),
    handler: choice(
      'Given `policy` and `userTurn` (fall back to `transcript` if the turn is a copy-grading task), which handler should run?',
      {
        deterministic_cli:
          'Code already owns this: 402/settle/consume, empty-pot fail-closed, spark/USDB rail check, or missing ZAPPI_POT_ID. Exact HTTP/tool asserts.',
        human_approve:
          'Auth-required spend (`policy.spendMode` is auth_required): CLI must not free-sign; human approves in Zappi.',
        refuse:
          'Fail closed before any model: wrong SPARK_NETWORK HRP mix, non-spark/USDB 402, install-arg used as pot id, or live mainnet in CI.',
        copy_review:
          'Open-ended agent, CLI, or human-UI copy that may paraphrase honesty rules (disconnect, install vs runtime, secrets, attach deny, Receive gate, who runs npx/propose/pay).',
        none: 'Not a Zappi pot, paywall, or eval-copy task.',
      },
    ),
  }
}

export type HybridEvalQuestions = ReturnType<typeof hybridEvalQuestions>
