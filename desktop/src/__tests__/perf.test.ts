import { describe, it, expect } from 'vitest'
import { readShellPerf, flagsFor, readTrimMinutes } from '../perf'

describe('readShellPerf', () => {
  it('is the full experience when nothing is stored', () => {
    expect(readShellPerf(undefined)).toEqual({ skycordTitleBar: true, hardwareAcceleration: true, heapCapMb: null })
  })

  it('reads the three switches it cares about', () => {
    expect(readShellPerf({ skycordTitleBar: false, hardwareAcceleration: false, heapCapMb: 192 }))
      .toEqual({ skycordTitleBar: false, hardwareAcceleration: false, heapCapMb: 192 })
  })

  it('refuses nonsense rather than trusting the file', () => {
    expect(readShellPerf({ skycordTitleBar: 'no', hardwareAcceleration: 1, heapCapMb: 'lots' }))
      .toEqual({ skycordTitleBar: true, hardwareAcceleration: true, heapCapMb: null })
  })

  it('keeps a heap cap inside a sane range', () => {
    expect(readShellPerf({ heapCapMb: 8 }).heapCapMb).toBeNull()
    expect(readShellPerf({ heapCapMb: 9000 }).heapCapMb).toBeNull()
    expect(readShellPerf({ heapCapMb: 256 }).heapCapMb).toBe(256)
  })
})

describe('flagsFor', () => {
  it('asks for nothing at the full experience', () => {
    expect(flagsFor({ skycordTitleBar: true, hardwareAcceleration: true, heapCapMb: null }))
      .toEqual({ disableHardwareAcceleration: false, jsFlags: null })
  })

  it('turns off the graphics card and caps the heap for Light', () => {
    expect(flagsFor({ skycordTitleBar: false, hardwareAcceleration: false, heapCapMb: 192 }))
      .toEqual({ disableHardwareAcceleration: true, jsFlags: '--max-old-space-size=192' })
  })
})

describe('readTrimMinutes', () => {
  it('reads a positive trim interval', () => {
    expect(readTrimMinutes({ imageTrimMinutes: 5 })).toBe(5)
  })

  it('treats zero as never', () => {
    expect(readTrimMinutes({ imageTrimMinutes: 0 })).toBeNull()
  })

  it('treats nothing stored as never', () => {
    expect(readTrimMinutes(undefined)).toBeNull()
  })
})
