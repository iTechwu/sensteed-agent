/** Local, model-free proof that each shipped finance gesture loads its actual skill body. */
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry, { AgentModel, agentEvents, modelSelectionProjectionDefinition, type Agent } from '@deepseek-ai/dsh-agent'
import AgentDefaultModelConfig from '@deepseek-ai/dsh-agent-default-model'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { Session, SessionId, SESSION_FORMAT_VERSION } from '@deepseek-ai/dsh-session'
import SkillRegistry from '@deepseek-ai/dsh-skill'
import * as SkillFileSystem from '@deepseek-ai/dsh-skill-filesystem'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import * as NativeToolExecutor from '@deepseek-ai/dsh-tool-executor-native'
import * as ToolSkill from '@deepseek-ai/dsh-tool-skill'
import { describe, expect, it } from 'vitest'

const root = resolve(import.meta.dirname, '../..')
const skillsRoot = join(root, 'dsh-plugin-desktop/bundled/skills')
const head = await readFile(join(root, '.ci/dsh-sensteed-finance/src/head.js'), 'utf8')
const entries = new Function(head.slice(head.indexOf('const ANALYSIS_ENTRIES'), head.indexOf('\nconst copy =')) + '\nreturn ANALYSIS_ENTRIES')() as Array<{ skill: string; prompt: string | ((year: number, org: string) => string) }>
const view = await readFile(join(root, '.ci/dsh-sensteed-finance/src/views/analyze.js'), 'utf8')
const analysisPrompt = new Function(view + '\nreturn analysisPrompt')() as (entry: typeof entries[number], year: number, org: string, id: string) => string

async function harness(run: (ctx: Context, home: string) => Promise<void>) {
  const home = await mkdtemp(join(tmpdir(), 'finance-runtime-'))
  const ctx = new Context()
  try {
    ctx.provide('workingDirectory', { ensure: async () => home } as never)
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(NativeToolExecutor)
    await ctx.plugin(SessionProjectionRegistry)
    await ctx.plugin(AgentRegistry)
    await ctx.plugin(AgentDefaultModelConfig, { provider: 'test-provider', model: 'test-model' })
    await ctx.plugin(SkillRegistry)
    await ctx.plugin(SkillFileSystem, { dshHome: join(home, '.dsh'), agentsHome: join(home, '.agents'), bundledSkillDir: skillsRoot, watch: false })
    await ctx.plugin(ToolSkill)
    await run(ctx, home)
  } finally {
    await ctx.fiber.dispose()
    await rm(home, { recursive: true, force: true })
  }
}

async function agent(ctx: Context, home: string, name: string): Promise<Agent> {
  const id = SessionId(`finance-${name}`)
  const session = Session.create(id, [], { version: SESSION_FORMAT_VERSION, id, createdAt: 0, cwd: home, isSeeded: false })
  const projection = await ctx.sessionProjections.register(modelSelectionProjectionDefinition)
  return {
    id, ctx: ctx.extend(), session, status: 'idle', options: {}, inbox: {} as never,
    model: new AgentModel(() => projection.stateOf(session), session, {}),
  } as unknown as Agent
}

async function propose(ctx: Context, current: Agent, text: string) {
  const messages = [createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } })]
  return agentEvents(ctx, current).waterfall('agent/pre-step', { messages, turn: 1, step: 1, signal: new AbortController().signal, modelSelection: undefined as unknown as never }, () => Promise.resolve({ kind: 'enter' as const, messages }))
}

describe('default finance skills at the Host step boundary', () => {
  it('discovers all nine shipped finance skills as user-invocable bundled content', async () => {
    await harness(async (ctx, home) => {
      const catalog = await ctx.skills.list({ cwd: home })
      expect(entries).toHaveLength(9)
      for (const { skill } of entries) {
        expect(catalog.find(item => item.name === skill)).toMatchObject({ source: 'bundled', invocation: { userInvocable: true } })
      }
    })
  })

  it.each(entries)('loads the full $skill instructions from the actual button prompt', async entry => {
    await harness(async (ctx, home) => {
      const prompt = analysisPrompt(entry, 2026, '合成主体', 'fixture-org')
      const decision = await propose(ctx, await agent(ctx, home, entry.skill), prompt)
      expect(decision.kind).toBe('enter')
      if (decision.kind !== 'enter') return
      const injections = decision.messages.filter(message => message.source.kind === 'skill-invocation')
      expect(injections).toHaveLength(1)
      const injection = injections[0], original = decision.messages[0]
      if (!injection || !original) throw new Error('Expected the skill injection and original user message')
      expect(injection.source).toMatchObject({ kind: 'skill-invocation', name: entry.skill })
      const expected = (await readFile(join(skillsRoot, entry.skill, 'SKILL.md'), 'utf8')).replace(/^---[\s\S]*?\n---\s*/, '').trim()
      expect(injection.content[0]).toMatchObject({ type: 'text', text: expect.stringContaining(expected) })
      expect(original.content[0]).toMatchObject({ type: 'text', text: prompt })
      expect(decision.messages.at(-1)).toBe(injection)
    })
  })

  it('does not inject a stale or missing skill name', async () => {
    await harness(async (ctx, home) => {
      const decision = await propose(ctx, await agent(ctx, home, 'missing'), '/finance-missing-fixture\n只读分析')
      expect(decision.kind).toBe('enter')
      if (decision.kind === 'enter') expect(decision.messages.filter(message => message.source.kind === 'skill-invocation')).toEqual([])
    })
  })
})
