import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import { randomBytes } from 'node:crypto'

/** Small unique id: 8 hex chars, collision-safe for label suffixes. */
export function shortUniqueId(bytes = 4): string {
  return randomBytes(bytes).toString('hex')
}

/** Blank/absent answer → `pot_<unique>` (e.g. pot_a1b2c3d4). */
export function generatePotLabel(seedValue?: string): string {
  const trimmed = seedValue?.trim()
  if (trimmed) return trimmed
  return `pot_${shortUniqueId()}`
}

export function openUrl(href: string) {
  const command = process.platform === 'darwin' ? 'open' : 'xdg-open'
  const child = spawn(command, [href], { stdio: 'ignore', detached: true })
  child.unref()
}

async function spawnCopyToClipboard(text: string): Promise<boolean> {
  const command =
    process.platform === 'darwin'
      ? 'pbcopy'
      : process.platform === 'win32'
        ? 'clip'
        : 'xclip -selection clipboard'
  const parts = command.split(' ')
  return await new Promise((resolve) => {
    try {
      const child = spawn(parts[0], parts.slice(1), { stdio: ['pipe', 'ignore'] })
      child.on('error', () => resolve(false))
      child.on('spawn', () => {
        if (!child.stdin) {
          resolve(false)
          return
        }
        child.stdin.write(text)
        child.stdin.end()
        resolve(true)
      })
      // Fallback resolution in case neither event fires.
      const timer = setTimeout(() => resolve(false), 1500)
      child.on('close', () => {
        clearTimeout(timer)
        resolve(true)
      })
    } catch {
      resolve(false)
    }
  })
}

export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    // Prefer OSC52-style inline copy when TTY supports it.
    if (process.stdout.isTTY && typeof process.stdout.write === 'function') {
      const b64 = Buffer.from(text, 'utf8').toString('base64')
      process.stdout.write(`\x1b]52;c;${b64}\x07`)
      return true
    }
  } catch {
    // fall through to platform clipboard tool
  }
  return spawnCopyToClipboard(text)
}

let sharedInterface: ReturnType<typeof createInterface> | null = null
let interfaceClosed = false
const pendingLines: string[] = []
let pendingResolver: ((answer: string) => void) | null = null

/**
 * Tear down the shared readline before raw-mode UIs (`select`, `promptOpenLink`).
 * Leaving readline attached to stdin steals keypresses so the browser open
 * prompt never sees ENTER / never seems to run.
 */
export function closeWizardReadline(): void {
  pendingLines.length = 0
  pendingResolver = null
  if (!sharedInterface) {
    interfaceClosed = false
    return
  }
  try {
    sharedInterface.removeAllListeners()
    sharedInterface.close()
  } catch {
    // already closed
  }
  sharedInterface = null
  interfaceClosed = false
}

/**
 * One readline interface + a manual line buffer for every question.
 * `rl.question()` alone drops lines that arrive between prompts (piped stdin);
 * buffering 'line' events keeps TTY and pipe input behaving identically.
 */
function ensureReadline() {
  if (sharedInterface) return sharedInterface
  interfaceClosed = false
  sharedInterface = createInterface({
    input: process.stdin,
    output: process.stdout,
  })
  sharedInterface.on('line', (line: string) => {
    if (pendingResolver) {
      const resolve = pendingResolver
      pendingResolver = null
      resolve(line)
    } else {
      pendingLines.push(line)
    }
  })
  sharedInterface.on('close', () => {
    interfaceClosed = true
    if (pendingResolver) {
      const resolve = pendingResolver
      pendingResolver = null
      resolve('')
    }
  })
  return sharedInterface
}

export async function ask(prompt: string): Promise<string> {
  process.stdout.write(`${prompt} `)
  const rl = ensureReadline()
  rl.resume()
  const buffered = pendingLines.shift()
  if (buffered != null) return buffered
  if (interfaceClosed) return ''
  return await new Promise<string>((resolve) => {
    pendingResolver = resolve
  })
}

export interface SelectOption {
  label: string
  value: string
}

export interface SelectIo {
  stdin?: NodeJS.ReadableStream & {
    isTTY?: boolean
    setRawMode?: (mode: boolean) => unknown
  }
  stdout?: NodeJS.WritableStream
}

/**
 * Arrow-key single-choice menu (TTY):
 *
 *   ◉ Generate a new pot (create a fresh key on this host)   ← green
 *   ○ Use an existing pot (I already registered one)
 *   (↑/↓ to move, ENTER to select)
 *
 * ↑/↓ (or j/k) move, digits 1-9 pick directly, ENTER confirms the highlighted
 * row — the first option is the default. Non-TTY (piped/scripted) input falls
 * back to a numbered prompt where blank input also picks the first option.
 */
export async function select(
  prompt: string,
  options: SelectOption[],
  io: SelectIo = {},
): Promise<string> {
  closeWizardReadline()
  const input = io.stdin ?? process.stdin
  const output = io.stdout ?? process.stdout
  output.write(`${prompt}\n`)

  const tty = input as { isTTY?: boolean; setRawMode?: (m: boolean) => unknown }
  if (!tty.isTTY) {
    options.forEach((option, index) => {
      output.write(`  ${index + 1}. ${option.label}\n`)
    })
    for (;;) {
      const answer = (await ask('Select [1]:')).trim()
      if (answer === '') return options[0].value
      const parsed = Number(answer)
      if (
        Number.isInteger(parsed) &&
        parsed >= 1 &&
        parsed <= options.length
      ) {
        return options[parsed - 1].value
      }
      output.write(
        `Please enter a number between 1 and ${options.length}.\n`,
      )
    }
  }

  let selected = 0
  // Green radio circle on the selected row, hollow circle on the rest.
  // NO_COLOR (https://no-color.org) and non-terminals fall back to plain text.
  const useColor =
    process.env.NO_COLOR == null && (io.stdout ? true : process.stdout.isTTY)
  const marker = (index: number) =>
    index === selected
      ? useColor
        ? `\x1b[32m◉\x1b[0m`
        : '◉'
      : '○'
  const draw = () =>
    [
      ...options.map((option, index) =>
        `${marker(index)} ${option.label}`,
      ),
      '(↑/↓ to move, ENTER to select)',
    ].join('\n')

  let frame = draw()
  output.write(frame)

  return await new Promise<string>((resolve) => {
    const finish = () => {
      tty.setRawMode?.(false)
      input.removeListener('data', onData)
      if (tty.isTTY) input.pause?.()
      output.write('\n')
      resolve(options[selected].value)
    }

    const redraw = () => {
      const linesUp = frame.split('\n').length - 1
      output.write(`\x1b[${linesUp}A\r\x1b[J`)
      frame = draw()
      output.write(frame)
    }

    const onData = (chunk: Buffer) => {
      const key = chunk.toString('utf8')
      if (key === '\x03') {
        // Ctrl+C — restore the terminal before dying.
        tty.setRawMode?.(false)
        output.write('\n')
        process.exit(130)
      }
      if (key === '\r' || key === '\n') {
        finish()
        return
      }
      const digit = Number(key)
      if (Number.isInteger(digit) && digit >= 1 && digit <= options.length) {
        selected = digit - 1
        redraw()
        finish()
        return
      }
      const isUp = key === '\x1b[A' || key === 'k'
      const isDown = key === '\x1b[B' || key === 'j'
      if (!isUp && !isDown) return
      if (isUp) {
        selected = (selected - 1 + options.length) % options.length
      } else {
        selected = (selected + 1) % options.length
      }
      redraw()
    }

    tty.setRawMode?.(true)
    input.resume()
    input.on('data', onData)
  })
}

export interface AuthPromptResult {
  action: 'opened' | 'copied' | 'skipped'
  auto: boolean
}

/**
 * Open a register / approve link in the browser.
 *
 * Always opens immediately (so a stuck readline/raw-mode conflict cannot
 * swallow ENTER and skip the browser). Then waits for ENTER to continue or
 * "c" to copy. Ctrl+C quits.
 */
export async function promptOpenLink(
  href: string,
  options: { autoOpenMs?: number; headline?: string } = {},
): Promise<AuthPromptResult> {
  closeWizardReadline()

  const headline = options.headline ?? 'Open this link:'
  process.stdout.write(`${headline}\n`)
  process.stdout.write(`${href}\n`)

  // Open right away — do not wait for ENTER. Waiting was unreliable after
  // arrow-key menus + readline prompts on the same stdin.
  openUrl(href)

  if (!process.stdin.isTTY) {
    return { action: 'opened', auto: true }
  }

  process.stdout.write(
    'Opened in your browser. Press ENTER to continue — or "c" to copy the link (Ctrl+C to quit)… ',
  )

  return await new Promise<AuthPromptResult>((resolve) => {
    const finish = (result: AuthPromptResult) => {
      try {
        process.stdin.setRawMode(false)
      } catch {
        // ignore
      }
      process.stdin.removeListener('data', onData)
      if (process.stdin.isTTY) process.stdin.pause()
      process.stdout.write('\n')
      resolve(result)
    }

    const onData = async (chunk: Buffer) => {
      const key = chunk.toString('utf8')
      if (key === '\x03') {
        try {
          process.stdin.setRawMode(false)
        } catch {
          // ignore
        }
        process.stdin.removeListener('data', onData)
        process.stdout.write('\n')
        process.exit(130)
      }
      if (key === '\r' || key === '\n') {
        finish({ action: 'opened', auto: true })
        return
      }
      if (key === 'c' || key === 'C') {
        const copied = await copyToClipboard(href)
        finish(
          copied
            ? { action: 'copied', auto: false }
            : { action: 'skipped', auto: false },
        )
      }
    }

    try {
      process.stdin.setRawMode(true)
    } catch {
      // Raw mode unavailable — browser already opened above.
      finish({ action: 'opened', auto: true })
      return
    }
    process.stdin.resume()
    process.stdin.on('data', onData)
  })
}
