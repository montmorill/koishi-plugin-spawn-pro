import type { Context } from 'koishi'
import type { Buffer } from 'node:buffer'
import { exec } from 'node:child_process'
import path from 'node:path'
import { stripVTControlCharacters } from 'node:util'
import iconv from 'iconv-lite'
import { h, Schema, Time } from 'koishi'
import enUS from './locales/en-US.yml'
import zhCN from './locales/zh-CN.yml'

const encodings = ['utf8', 'utf16le', 'latin1', 'ucs2', 'gbk'] as const

export interface Config {
  root: string
  shell?: string
  encoding: typeof encodings[number]
  timeout: number
  stream: boolean
}

export const Config: Schema<Config> = Schema.object({
  root: Schema.string().description('工作路径。').default(''),
  shell: Schema.string().description('运行命令的程序。'),
  encoding: Schema.union(encodings).description('输出内容编码。').default('utf8'),
  timeout: Schema.number().description('最长运行时间。').default(Time.minute),
  stream: Schema.boolean().description('默认使用流式输出。').default(false),
})

export interface State {
  stream: boolean
  command: string
  timeout: number
  output: string
  code?: number | null
  signal?: NodeJS.Signals | null
  timeUsed?: number
  cwd: string
}

export const name = 'spawn-pro'

export function apply(ctx: Context, config: Config) {
  ctx.i18n.define('en-US', enUS)
  ctx.i18n.define('zh-CN', zhCN)

  const command = ctx.command('exec <command:rawtext>', { authority: 4 })
    .option('stream', '-s')
    .option('encoding', '--encoding <encoding>', { type: encodings })

  for (const encoding of encodings)
    command.option('encoding', `--${encoding}`, { value: encoding })

  command.action(async ({ session, options }, command) => {
    if (!session)
      return

    const stream = options?.stream === undefined ? config.stream : options.stream
    const { root, shell, encoding, timeout } = Object.assign({}, config, options)
    const cwd = path.resolve(ctx.baseDir, root)

    const state: State = { stream, command, timeout, output: '', cwd }
    let elements = session.i18n('.started', state)
    if (stream)
      elements = [h('stream', ...elements, h('br'))]
    await session.send(elements)

    let lastPromise = Promise.resolve([] as string[])
    const sendQueued = (fragment: h.Fragment): Promise<string[]> =>
      (lastPromise = lastPromise.then(() => session.send(fragment)))

    const start = Date.now()
    const child = exec(command, { timeout, cwd, encoding: 'buffer', shell, windowsHide: true })

    const onData = (fd: 'stdout' | 'stderr') => (buffer: Buffer) => {
      let chunk = iconv.decode(buffer, encoding)
      chunk = stripVTControlCharacters(chunk)
      // TODO: support color
      chunk = session.text('.chunk', { chunk, fd })
      state.output += chunk
      stream && sendQueued(h('stream', chunk))
    }
    child.stdout?.on('data', onData('stdout'))
    child.stderr?.on('data', onData('stderr'))
    await new Promise((resolve) => {
      child.on('close', (code, signal) => {
        state.code = code
        state.signal = signal
        state.timeUsed = Date.now() - start
        let elements = session.i18n('.finished', state)
        if (stream)
          elements = [h('stream', { done: true }, h('br'), ...elements)]
        sendQueued(elements).then(resolve)
      })
    })
  })
}
