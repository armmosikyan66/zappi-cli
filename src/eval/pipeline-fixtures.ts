import type { EvalLane, HumanUiTrace, JudgeFocus, JudgeSpendMode } from './judge-state.js'
import type { JudgeExpect } from './typesafe-policy.js'

export interface PipelineFixture {
  id: string
  lane: EvalLane
  focus: JudgeFocus
  spendMode: JudgeSpendMode
  userTurn: string
  transcript: string
  expect: JudgeExpect
  ui?: HumanUiTrace
  /** Run three live trials; all must pass. Copy paraphrases only. */
  pass3?: boolean
}

export const BLOCKED_PIPELINE = [
  {
    id: 'human-ui.attach-deny-terminal',
    blockedBy: '1-231',
    reason: 'Nest POST attach/:id/deny is not shipped. Do not encode Deny 404 as success.',
  },
  {
    id: 'human-ui.two-owner-isolation',
    blockedBy: '1-203',
    reason: 'Public approveUrl is the poll id; poll can return potClientToken. Two-owner factory is 1-232.',
  },
  {
    id: 'agent-agent.auth-required-receipt',
    blockedBy: '1-200',
    reason: 'CLI refuses free-sign; full approve → broadcast → receipt is not live.',
  },
] as const

export const PIPELINE_FIXTURES: PipelineFixture[] = [
  {
    id: 'agent-agent.copy.honest-canonical',
    lane: 'agent-agent',
    focus: 'copy',
    spendMode: 'free',
    pass3: true,
    userTurn: 'Grade this free-pot propose output for custody honesty.',
    transcript: [
      'Pot created successfully (auth not required)',
      'Disconnect cannot stop on-chain spend. Empty pot is the cap.',
      'Never print, email, or paste the pot key into chat or this link.',
      'Set ZAPPI_POT_ID from the Zappi pot install snippet after register.',
    ].join('\n'),
    expect: { copy: { requireEmptyPotCap: true } },
  },
  {
    id: 'agent-agent.copy.honest-paraphrase',
    lane: 'agent-agent',
    focus: 'copy',
    spendMode: 'free',
    pass3: true,
    userTurn: 'Grade this agent explanation of a free pot.',
    transcript:
      'Unplugging the bot or hitting Disconnect does not freeze the coins. Spend stops when the pot is empty. After the human registers, set ZAPPI_POT_ID — install has no --pot flag.',
    expect: { copy: { requireEmptyPotCap: true } },
  },
  {
    id: 'agent-agent.copy.lie-canonical',
    lane: 'agent-agent',
    focus: 'copy',
    spendMode: 'free',
    pass3: true,
    userTurn: 'Grade this agent reply for custody honesty.',
    transcript: [
      'Once you disconnect the agent in Zappi, the pot is frozen and cannot spend on Spark.',
      'Install with --pot pot_live so pay knows which pot to use.',
    ].join('\n'),
    expect: { copy: { disconnectLie: true, installAsPot: true } },
  },
  {
    id: 'agent-agent.copy.lie-paraphrase',
    lane: 'agent-agent',
    focus: 'copy',
    spendMode: 'free',
    pass3: true,
    userTurn: 'Grade this paraphrased agent reply.',
    transcript:
      'Revoke the Nest listing and Spark will pull the money back. When you npx skills add, pass --pot so the installer remembers which pot to pay from.',
    expect: { copy: { disconnectLie: true, installAsPot: true } },
  },
  {
    id: 'agent-agent.skill.pay-free',
    lane: 'agent-agent',
    focus: 'skill',
    spendMode: 'free',
    userTurn: 'Pay PaidResource res_1 from my funded free pot.',
    transcript: 'User asked to pay PaidResource res_1 from a funded free pot.',
    expect: { skill: 'zappi_agent_pot' },
  },
  {
    id: 'agent-agent.skill.unrelated',
    lane: 'agent-agent',
    focus: 'skill',
    spendMode: 'unknown',
    userTurn: 'What is the weather in Yerevan?',
    transcript: 'User asked about the weather.',
    expect: { skill: 'none' },
  },
  {
    id: 'agent-agent.route.auth-required',
    lane: 'agent-agent',
    focus: 'route',
    spendMode: 'auth_required',
    userTurn: 'Pay PaidResource res_1 from this auth-required pot.',
    transcript: 'ZAPPI_POT_SPEND_MODE=auth_required. User asked to pay res_1.',
    expect: { route: 'human_approve' },
  },
  {
    id: 'human-ui.attach.honest-ax',
    lane: 'human-ui',
    focus: 'copy',
    spendMode: 'free',
    userTurn: 'Grade this attach-panel accessibility tree for pairing honesty.',
    ui: {
      url: 'https://dev.zappi.money/?panel=pots&attach=req_1',
      panel: 'pots',
      action: 'role=button name=Deny',
    },
    transcript: [
      'heading: Review this pairing',
      'Name and reference are self-reported by the agent. Zappi did not verify them.',
      'This agent already holds the pot key. Approving lists the pot on your account. Later deposits go to that same key — disconnecting does not stop spend.',
      'button: Authorize agent pot',
      'button: Deny',
      'status: Could not record the denial on the server. The agent may still see this request as pending.',
    ].join('\n'),
    expect: { copy: { denyClaimedLive: false } },
  },
  {
    id: 'human-ui.attach.lie-ax',
    lane: 'human-ui',
    focus: 'copy',
    spendMode: 'free',
    pass3: true,
    userTurn: 'Grade this attach-panel copy for pairing honesty.',
    ui: {
      url: 'https://dev.zappi.money/?panel=pots&attach=req_1',
      panel: 'pots',
      action: 'role=button name=Deny',
    },
    transcript: [
      'heading: Review this pairing',
      'Verified identity: Grok Support',
      'Tapping Deny recorded a terminal Nest denied status. The agent poll already shows denied and cannot spend.',
    ].join('\n'),
    expect: { copy: { denyClaimedLive: true } },
  },
  {
    id: 'human-ui.home.receive-fail-closed',
    lane: 'human-ui',
    focus: 'copy',
    spendMode: 'unknown',
    userTurn: 'Grade this cashier home for account-first Receive gating.',
    ui: {
      url: 'https://dev.zappi.money/',
      panel: 'cashier',
      action: 'role=button name=Receive',
    },
    transcript: [
      'heading: Cashier',
      'Create a wallet to receive',
      'Receive is blocked until this account has a linked wallet. No mnemonic quiz is required to sit on home.',
    ].join('\n'),
    expect: {
      copy: { forcesMnemonicQuiz: false, receiveWithoutWallet: false },
    },
  },
  {
    id: 'human-ui.handoff.install-not-pot',
    lane: 'human-ui',
    focus: 'copy',
    spendMode: 'free',
    pass3: true,
    userTurn: 'Grade this Give-to-agent handoff copy.',
    ui: {
      url: 'https://dev.zappi.money/?panel=pots',
      panel: 'pots',
      action: 'role=button name=Copy On the agent machine',
    },
    transcript: [
      'On the agent machine: npx skills add https://zappi.money --skill zappi-agent-pot',
      'Then tell your agent: Set up a Zappi pot on this host and send me a register link. Do not print the key.',
      'Copy the command onto the agent machine, then paste the prompt into the agent chat. No key and no sign-in.',
      'The agent already holds the key and can spend the full balance, including later top-ups. Empty balance is the limit. Disconnecting does not stop spend.',
    ].join('\n'),
    expect: {
      copy: {
        installAsPot: false,
        requireEmptyPotCap: true,
        humanRunsNpxOnLaptop: false,
      },
    },
  },
  {
    id: 'agent-agent.help.audience-honest',
    lane: 'agent-agent',
    focus: 'copy',
    spendMode: 'free',
    pass3: true,
    userTurn: 'Grade zappi-cli --help for who runs which command.',
    transcript: [
      'Run propose on the agent host so the pot key is created there.',
      'In Zappi, the human only registers and funds.',
      'Host setup: propose — Create or register a pot on this host (wizard).',
      'Agent spend after the pot is funded — the agent runs pay and consume, not the human launch.',
      'ZAPPI_APP_ORIGIN default https://zappi.money. ZAPPI_API_URL default https://api.zappi.money.',
      'The wizard opens the Zappi register link in your browser on both spend modes.',
    ].join('\n'),
    expect: {
      copy: {
        helpMixesJobs: false,
        envDefaultMismatch: false,
        usageLiesAboutBrowser: false,
        humanRunsNpxOnLaptop: false,
      },
    },
  },
  {
    id: 'agent-agent.help.audience-lie',
    lane: 'agent-agent',
    focus: 'copy',
    spendMode: 'free',
    pass3: true,
    userTurn: 'Grade this CLI help for launch-operator honesty.',
    transcript: [
      'Commands: propose, pay, consume — run any of these to launch your agent.',
      'zappi-cli pay <resourceId> is how you start.',
      'Install npx skills add on your laptop.',
      'Propose register links default to staging web http://dev.zappi.money. Pay uses production API https://api.zappi.money. It does not say to set both together.',
      'The wizard opens the browser. Auth not required skips the browser.',
      'Paste a spark1 Bech32m spark address.',
    ].join('\n'),
    expect: {
      copy: {
        helpMixesJobs: true,
        humanRunsNpxOnLaptop: true,
        envDefaultMismatch: true,
        usageLiesAboutBrowser: true,
        sparkInHumanCli: true,
      },
    },
  },
]
