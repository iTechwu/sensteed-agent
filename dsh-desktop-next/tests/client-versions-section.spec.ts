import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const clientRoot = fileURLToPath(new URL('../src/client/', import.meta.url))
const read = (name: string): string => readFileSync(clientRoot + name, 'utf8')

describe('Next versions settings section', () => {
  it('registers the versions section and renames the desktop nav label', () => {
    const index = read('index.ts')
    expect(index).toContain("id: 'versions', order: 110")
    expect(index).toContain("versions: '版本管理'")
    expect(index).toContain("settings: 'Agent 设置'")
    expect(index).not.toContain('桌面设置')
  })

  it('renders update controls on the versions page only, with the shared header copy', () => {
    const settings = read('settings.tsx')
    const page = settings.slice(settings.indexOf('export function NextVersionsSettingsPage'))
    expect(page).toContain('<NextUpdateSettings')
    expect(page).toContain("t('versionsTitle')")
    expect(page).toContain("t('versionsIntro')")

    const desktopPage = settings.slice(
      settings.indexOf('export function NextDesktopSettings'),
      settings.indexOf('export function NextDesktopActions'),
    )
    expect(desktopPage).not.toContain('NextUpdateSettings')

    const options = settings.slice(settings.indexOf('function NextDesktopOptions'))
    expect(options).not.toContain('<NextUpdateSettings')
  })
})
