import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { classifyProfileDependencyState } from '../src/profile.ts'

const mainSource = readFileSync(resolve(process.cwd(), 'src/main.ts'), 'utf8')

describe('zero-pnpm startup critical path', () => {
  it('defers Profile dependency repair instead of failing the boot', () => {
    expect(mainSource).toContain('deferring repair until after startup')
    expect(mainSource).toContain('scheduleDesktopProfileRepair({')
    expect(mainSource).toContain('generation.own(() => { repairSchedule.dispose() })')
    expect(mainSource).toContain('lockDir: desktopUserDataDir')
  })

  it('keeps the in-boot migration only behind the legacy escape switch', () => {
    expect(mainSource).toContain("process.env.DSH_DESKTOP_LEGACY_MIGRATION === '1'")
    const legacyBranch = mainSource.slice(
      mainSource.indexOf('DSH_DESKTOP_LEGACY_MIGRATION'),
      mainSource.indexOf('deferring repair until after startup'),
    )
    // The fail-loud migration block lives only inside the legacy branch.
    expect(legacyBranch).toContain('Profile dependency migration failed')
    expect(mainSource.indexOf('Profile dependency migration failed'))
      .toBeGreaterThan(mainSource.indexOf('DSH_DESKTOP_LEGACY_MIGRATION'))
  })

  it('classifies a healthy Profile as zero-pnpm compatible', () => {
    const home = mkdtempSync(join(tmpdir(), 'dsh-startup-zero-pnpm-'))
    const dir = join(home, 'profiles', 'desktop')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'package.json'), `${JSON.stringify({ name: 'desktop', private: true })}\n`)
    try {
      expect(classifyProfileDependencyState(dir, false, process.platform)).toEqual({
        status: 'compatible',
        reasons: [],
        workspaceDrift: false,
      })
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })
})
