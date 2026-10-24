import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import Agents, { AgentModel, agentEvents, modelSelectionProjectionDefinition, type Agent, type ModelSelection } from '@deepseek-ai/dsh-agent'
import AgentDefaultModelConfig from '@deepseek-ai/dsh-agent-default-model'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import type {} from '@deepseek-ai/dsh-working-directory'
import Sessions, { SessionId } from '@deepseek-ai/dsh-session'
import { createUserMessage, ToolCallId } from '@deepseek-ai/dsh-llm'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import Tools from '@deepseek-ai/dsh-tools'
import * as NativeToolExecutor from '@deepseek-ai/dsh-tool-executor-native'
import Skills from '@deepseek-ai/dsh-skill'
import * as SkillFilesystem from '@deepseek-ai/dsh-skill-filesystem'
import * as ToolSkill from '@deepseek-ai/dsh-tool-skill'
import * as ToolSchedule from '@deepseek-ai/dsh-tool-schedule'
import Storage from '@deepseek-ai/dsh-storage'
import * as StorageJson from '@deepseek-ai/dsh-storage-json'
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain'
import Schedule from '@deepseek-ai/dsh-schedule'
import { expect, it } from 'vitest'

/** Real bundled discovery, tool admission and durable JSON storage in an isolated home. */
async function runtime(home: string): Promise<Context> {
  const ctx = new Context()
  try {
    ctx.provide('workingDirectory', { ensure: async () => home } as never)
    await ctx.plugin(Sessions)
    await ctx.plugin(SessionProjectionRegistry)
    await ctx.plugin(Agents)
    await ctx.plugin(AgentDefaultModelConfig, { provider: 'test-provider', model: 'test-model' })
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(Tools)
    await ctx.plugin(NativeToolExecutor)
    await ctx.plugin(Storage)
    await ctx.plugin(StorageJson, { root: join(home, 'storage') })
    await ctx.plugin(StorageDomain, { backend: 'json' })
    ctx.provide('sessionController', { resolveAgent: async () => { throw new Error('delivery is outside this creation test') } } as never)
    ctx.provide('sessionPersistence', {} as never)
    ctx.on('session/flush', async () => {})
    await ctx.plugin(Schedule, {})
    await ctx.plugin(Skills)
    await ctx.plugin(SkillFilesystem, {
      providerName: 'bundled', includeDefaultRoots: false, watch: false,
      customSkillDirs: [resolve(import.meta.dirname, '../bundled/skills')],
    })
    await ctx.plugin(ToolSkill)
    await ctx.plugin(ToolSchedule)
    return ctx
  } catch (error) { await ctx.fiber.dispose(); throw error }
}

it('loads the bundled automation skill from an explicit invocation and persists its example through the real scheduling tools', async () => {
  const home = await mkdtemp(join(tmpdir(), 'sensteed-automation-'))
  let ctx: Context | undefined
  try {
    ctx = await runtime(home)
    const session = ctx.sessions.create(SessionId('automation-creation'))
    const projection = await ctx.sessionProjections.register(modelSelectionProjectionDefinition)
    const agent: Agent = {
      ctx: ctx.extend(), id: session.id, session, options: {}, status: 'idle', inbox: {} as never,
      // 本测试只走技能调用与工具执行边界；模型面挂真实 AgentModel，由投影喂默认选择。
      model: new AgentModel(() => projection.stateOf(session), session, {}),
      send() {}, followup() {}, steer() {}, inject() {}, cancel() {},
      whenIdle: async () => {}, runMaintenance: operation => operation(new AbortController().signal),
    }
    await (ctx as unknown as { agents: { register(a: Agent): Promise<void> } }).agents.register(agent)
    const messages = [createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text',
      text: '/sensteed-automation 帮我新建自动化任务，我的时区为 Asia/Shanghai。',
    }] })]
    const decision = await agentEvents(ctx, agent).waterfall('agent/pre-step', {
      messages, turn: 1, step: 1, signal: new AbortController().signal,
      modelSelection: undefined as unknown as ModelSelection,
    }, async () => ({ kind: 'enter' as const, messages }))
    expect(decision.kind).toBe('enter')
    if (decision.kind !== 'enter') throw new Error('skill invocation was refused')
    const invocation = decision.messages.find(message => message.source.kind === 'skill-invocation')
    expect(invocation?.source).toMatchObject({ name: 'sensteed-automation', form: 'instructions' })
    expect(JSON.stringify(invocation?.content)).toContain('schedule_create')

    const skill = await readFile(resolve(import.meta.dirname, '../bundled/skills/sensteed-automation/SKILL.md'), 'utf8')
    const example = skill.match(/```json\n([\s\S]+?)\n```/)?.[1]
    if (example === undefined) throw new Error('missing runnable scheduling example')
    const execute = async (name: string, args: unknown) => {
      const batch = await ctx!.tools.execute({
        calls: [{ type: 'tool-call' as const, id: ToolCallId(`automation-${name}`), name, arguments: JSON.stringify(args) }],
        signal: new AbortController().signal, agent,
      })
      return batch.results[0]!.result
    }
    const invalid = await execute('schedule_create', { title: '检查进展', prompt: '检查项目进展', every_seconds: 10 })
    expect(invalid.value).toMatchObject({ code: 'frequency_too_high' })
    expect(await ctx.schedule.catalog()).toEqual([])

    // This represents the next model action after the user supplies the requested content and timing.
    const created = await execute('schedule_create', JSON.parse(example))
    expect(created.isError).toBe(false)
    expect(created.value).toMatchObject({ title: '整理项目进展', kind: 'weekly', timeZone: 'Asia/Shanghai',
      weekdays: [1, 2, 3, 4, 5], id: expect.any(String), scheduledAt: expect.any(String),
    })
    const listed = await execute('schedule_list', {})
    expect(listed.value).toEqual([created.value])
    const catalog = await ctx.schedule.catalog()
    expect(catalog).toHaveLength(1)
    expect(catalog[0]).toMatchObject({ sessionId: session.id, status: 'active', title: '整理项目进展' })
    await ctx.fiber.dispose(); ctx = undefined
    ctx = await runtime(home)
    expect(await ctx.schedule.catalog()).toEqual(catalog)
  } finally {
    await ctx?.fiber.dispose()
    await rm(home, { recursive: true, force: true })
  }
})
