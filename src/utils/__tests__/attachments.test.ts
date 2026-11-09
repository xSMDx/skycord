import { describe, it, expect } from 'vitest'
import {
  mosaicLayout, previewText, isGifOnly, klipyGifLinks,
  formatBytes, fileTypeLabel, splitName, fileIconFor,
} from '../attachments'
import { toClientMessage } from '@/composables/useMessageAdapter'

const img = { kind: 'image' as const, name: 'IMG_2041.jpg', mime: 'image/jpeg' }
const gifImg = { kind: 'image' as const, name: 'party.gif', mime: 'image/gif' }
const vid = { kind: 'video' as const, name: 'stage.mp4', mime: 'video/mp4' }
const pdf = { kind: 'file' as const, name: 'season-3-notes.pdf', mime: 'application/octet-stream' }

describe('mosaicLayout', () => {
  it('lays out one to four, and caps at four with the rest counted', () => {
    expect(mosaicLayout(0)).toEqual({ shown: 0, extra: 0, template: 'one' })
    expect(mosaicLayout(1)).toEqual({ shown: 1, extra: 0, template: 'one' })
    expect(mosaicLayout(2)).toEqual({ shown: 2, extra: 0, template: 'two' })
    expect(mosaicLayout(3)).toEqual({ shown: 3, extra: 0, template: 'three' })
    expect(mosaicLayout(4)).toEqual({ shown: 4, extra: 0, template: 'four' })
    expect(mosaicLayout(7)).toEqual({ shown: 4, extra: 3, template: 'four' })
  })
})

describe('previewText', () => {
  it('uses the text whenever there is text', () => {
    expect(previewText({ content: 'hi', attachments: [img] })).toBe('hi')
    expect(previewText({ content: '  hi  ' })).toBe('hi')
  })

  it('says GIF for a message that is only a GIF link', () =>
    expect(previewText({ content: 'https://static.klipy.com/ii/a/b/c.gif' })).toBe('GIF'))

  it('describes files when there is no text', () => {
    expect(previewText({ content: '', attachments: [img] })).toBe('Sent a photo')
    expect(previewText({ content: '', attachments: [img, img, img] })).toBe('Sent 3 photos')
    expect(previewText({ content: '', attachments: [gifImg] })).toBe('GIF')
    expect(previewText({ content: '', attachments: [vid] })).toBe('Sent a video')
    expect(previewText({ content: '', attachments: [vid, vid] })).toBe('Sent 2 videos')
    expect(previewText({ content: '', attachments: [pdf] })).toBe('season-3-notes.pdf')
    expect(previewText({ content: '', attachments: [pdf, img] })).toBe('Sent 2 files')
  })

  it('reads a server summary the same way', () => {
    expect(previewText({ content: '', summary: { count: 2, kind: 'image', name: 'a.jpg', mime: 'image/jpeg' } })).toBe('Sent 2 photos')
    expect(previewText({ content: '', summary: { count: 1, kind: 'file', name: 'b.zip', mime: 'application/octet-stream' } })).toBe('b.zip')
    expect(previewText({ content: '', summary: { count: 1, kind: 'image', name: 'c.gif', mime: 'image/gif' } })).toBe('GIF')
    expect(previewText({ content: '', summary: null })).toBe('')
  })

  it('is empty for nothing at all', () => expect(previewText({})).toBe(''))
})

describe('GIF links', () => {
  it('knows a message that is only a GIF link, from any host', () => {
    expect(isGifOnly('https://media.giphy.com/media/x/giphy.gif')).toBe(true)
    expect(isGifOnly(' https://static.klipy.com/a.gif?x=1 ')).toBe(true)
    expect(isGifOnly('look https://static.klipy.com/a.gif')).toBe(false)
    expect(isGifOnly('https://example.com/a.png')).toBe(false)
  })

  it('finds KLIPY GIF links inside text, and only KLIPY', () => {
    expect(klipyGifLinks('look https://static.klipy.com/ii/x/y/z.gif !')).toEqual(['https://static.klipy.com/ii/x/y/z.gif'])
    expect(klipyGifLinks('https://klipy.com/a.gif')).toEqual(['https://klipy.com/a.gif'])
    expect(klipyGifLinks('https://evil-klipy.com/a.gif https://example.com/a.gif http://static.klipy.com/a.gif')).toEqual([])
    expect(klipyGifLinks('https://static.klipy.com/a.webp')).toEqual([])
  })

  it('lists each link once and at most four', () => {
    const u = (n: number) => `https://static.klipy.com/${n}.gif`
    expect(klipyGifLinks(`${u(1)} ${u(1)}`)).toEqual([u(1)])
    expect(klipyGifLinks([1, 2, 3, 4, 5, 6].map(u).join(' '))).toEqual([1, 2, 3, 4].map(u))
  })

  it('stops at punctuation that ends the sentence', () =>
    expect(klipyGifLinks('(https://static.klipy.com/a.gif).')).toEqual(['https://static.klipy.com/a.gif']))
})

describe('file details', () => {
  it('keeps the extension visible', () => {
    expect(splitName('a.b.final.zip')).toEqual({ stem: 'a.b.final', ext: '.zip' })
    expect(splitName('README')).toEqual({ stem: 'README', ext: '' })
    expect(splitName('.env')).toEqual({ stem: '.env', ext: '' })
  })

  it('formats sizes', () => {
    expect(formatBytes(900)).toBe('900 B')
    expect(formatBytes(2048)).toBe('2.0 KB')
    expect(formatBytes(2_516_582)).toBe('2.4 MB')
    expect(formatBytes(25 * 1024 * 1024)).toBe('25.0 MB')
  })

  it('labels the type from the extension', () => {
    expect(fileTypeLabel('notes.pdf')).toBe('PDF')
    expect(fileTypeLabel('stems.zip')).toBe('ZIP archive')
    expect(fileTypeLabel('set.xlsx')).toBe('Spreadsheet')
    expect(fileTypeLabel('README')).toBe('File')
    expect(fileTypeLabel('x.weird')).toBe('WEIRD file')
  })

  it('picks an icon family', () => {
    expect(fileIconFor('a.pdf')).toBe('doc')
    expect(fileIconFor('a.csv')).toBe('sheet')
    expect(fileIconFor('a.7z')).toBe('archive')
    expect(fileIconFor('a.mp3')).toBe('audio')
    expect(fileIconFor('a.ts')).toBe('code')
    expect(fileIconFor('a.bin')).toBe('file')
  })
})

describe('toClientMessage', () => {
  const wire = { _id: '6af0000000000000000000aa', kind: 'dm', authorName: 'a', authorId: 'u', content: '', createdAt: new Date().toISOString() }
  it('carries attachments through, and leaves them off when absent', () => {
    const att = { key: 'k', name: 'a.png', size: 1, mime: 'image/png', kind: 'image', width: 1, height: 1, url: '/messages/attachments/k/a.png' }
    expect(toClientMessage({ ...wire, attachments: [att] }).attachments).toEqual([att])
    expect(toClientMessage(wire).attachments).toBeUndefined()
    expect(toClientMessage({ ...wire, attachments: [] }).attachments).toBeUndefined()
  })
})
