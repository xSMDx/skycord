/// <reference types="node" />
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'

const SITES: Array<[file: string, marker: RegExp]> = [
  ['components/ui/Avatar.vue',              /<img ref="el"[^>]*>/],
  ['views/ChatApp.vue',                     /<img :src="srv\.img"[^>]*>/],
  ['components/chat/ServerInviteCard.vue',  /<img class="ic-icon ic-icon--img"[^>]*>/],
  ['components/settings/CountryFlag.vue',   /<img v-if="src" class="cf"[^>]*>/],
]

describe('identity images', () => {
  for (const [file, marker] of SITES) {
    it(`${file} handles a failed load`, () => {
      const tag = marker.exec(readFileSync(resolve(__dirname, '..', '..', file), 'utf8'))?.[0]
      expect(tag, `marker not found in ${file} — update this test`).toBeTruthy()
      expect(tag).toMatch(/@error=/)
    })
  }
})
