import type { Context } from 'koishi'
import type { Buffer } from 'node:buffer'
import { exec } from 'node:child_process'
import path from 'node:path'
import { stripVTControlCharacters } from 'node:util'
import iconv from 'iconv-lite'
import { h, Schema, Time } from 'koishi'
import enUS from './locales/en-US.yml'
import zhCN from './locales/zh-CN.yml'

export interface Config {
  cwd: string
  shell?: string
  encoding: string
  timeout: number
  stream: boolean
  verbose: boolean
}

export const Config: Schema<Config> = Schema.object({
  cwd: Schema.string().description('工作路径。').default(''),
  shell: Schema.string().description('运行命令的程序。'),
  encoding: Schema.string().description('输出内容编码。').default('utf8'),
  timeout: Schema.number().description('最长运行时间。').default(Time.minute),
  stream: Schema.boolean().description('使用流式输出。').default(false),
  verbose: Schema.boolean().description('输出详细信息。').default(false),
})

export interface State extends Config {
  command: string
  output: string
  code?: number | null
  signal?: NodeJS.Signals | null
  timeUsed?: number
}

export const name = 'spawn-pro'

export function apply(ctx: Context, config: Config) {
  ctx.i18n.define('en-US', enUS)
  ctx.i18n.define('zh-CN', zhCN)

  const command = ctx.command('exec <command:rawtext>', { authority: 4 })
    .option('encoding', '--encoding <encoding>')
    .option('stream', '-s')
    .option('verbose', '-v')
    .option('stdout', '-1')
    .option('stderr', '-2')

  for (const encoding of ['utf8', 'utf16le', 'latin1', 'ucs2', 'gbk'])
    command.option('encoding', `--encoding-${encoding}`, { value: encoding })

  command.action(async ({ session, options = {} }, command) => {
    if (!session)
      return

    if (!('stdout' in options) && !('stderr' in options))
      options.stdout = options.stderr = true

    const state: State = Object.assign(config, options, {
      command,
      output: '',
      cwd: path.resolve(ctx.baseDir, config.cwd),
    })

    let elements = session.i18n('.started', state)
    if (state.stream)
      elements = [h('stream', ...elements, h('br'))]
    state.verbose && await session.send(elements)

    let lastPromise = Promise.resolve([] as string[])
    const sendQueued = (fragment: h.Fragment): Promise<string[]> =>
      (lastPromise = lastPromise.then(() => session.send(fragment)))

    const start = Date.now()
    const child = exec(command, {
      cwd: state.cwd,
      windowsHide: true,
      timeout: state.timeout,
      shell: state.shell,
      encoding: 'buffer',
    })

    const onData = (fd: 'stdout' | 'stderr') => (buffer: Buffer) => {
      let content = iconv.decode(buffer, state.encoding)
      content = stripVTControlCharacters(content)
      // TODO: support color
      content = session.text('.chunk', { content, fd })
      state.output += content
      state.stream && sendQueued(h('stream', content))
    }
    options.stdout && child.stdout?.on('data', onData('stdout'))
    options.stderr && child.stderr?.on('data', onData('stderr'))
    await new Promise((resolve) => {
      child.on('close', (code, signal) => {
        state.code = code
        state.signal = signal
        state.timeUsed = Date.now() - start
        let elements = session.i18n('.finished', state)
        if (state.stream)
          elements = [h('stream', { done: true }, h('br'), ...elements)]
        sendQueued(elements).then(resolve)
      })
    })
  })
}
