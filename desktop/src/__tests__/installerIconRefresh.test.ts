/// <reference types="node" />
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'

// An update replaces Skycord.exe and its icon, but Windows keeps drawing the old
// one on pinned and Start-menu shortcuts until its icon cache is rebuilt. The
// installer (which is also what an update runs) tells the shell to refresh.
const root = resolve(__dirname, '..', '..')
const read = (f: string) => readFileSync(resolve(root, f), 'utf8')

describe('the Windows installer refreshes icons after an install or update', () => {
  it('electron-builder includes the extra installer steps', () => {
    expect(read('electron-builder.yml')).toMatch(/^\s+include: build\/installer\.nsh$/m)
  })

  it('customInstall tells the shell associations changed (SHCNE_ASSOCCHANGED)', () => {
    const nsh = read('build/installer.nsh')
    expect(nsh).toMatch(/!macro customInstall[\s\S]*shell32::SHChangeNotify\(i 0x08000000[\s\S]*!macroend/)
  })
})
