<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { Search, X } from 'lucide-vue-next'
import { useGifs, gifPreviewUrl, gifFullUrl } from '@/composables/useGifs'

const emit = defineEmits<{ select: [value: string]; selectGif: [url: string]; close: [] }>()

const search    = ref('')
const activeTab = ref<'emojis' | 'gifs' | 'stickers'>('emojis')
const activeCategory = ref('recent')

// ── Emoji data ────────────────────────────────────────────────────────────
// Each emoji paired with searchable name keywords so the filter actually works
const emojiMap: Record<string, string[]> = {
  '👍':  ['thumbs up','like','good','yes','ok'],
  '❤️':  ['heart','love','red','red heart'],
  '😂':  ['joy','laugh','crying','lol','funny'],
  '😮':  ['wow','surprised','open mouth','shocked'],
  '😢':  ['sad','cry','tear','unhappy'],
  '😡':  ['angry','mad','rage','furious'],
  '🔥':  ['fire','hot','lit','flame'],
  '💯':  ['100','perfect','score','yes'],
  '😀':  ['grinning','happy','smile'],
  '😃':  ['smiley','happy','big eyes'],
  '😄':  ['smile','happy','grin'],
  '😁':  ['beaming','grin','happy'],
  '😆':  ['laughing','grin','haha'],
  '😅':  ['sweat smile','nervous laugh','phew'],
  '🤣':  ['rolling','floor laughing','rofl'],
  '😊':  ['blush','shy','happy','smile'],
  '😇':  ['innocent','angel','halo'],
  '🙂':  ['slightly smiling','smile'],
  '🥰':  ['hearts','smiling','love','adore'],
  '😍':  ['heart eyes','love','adore'],
  '🤩':  ['star struck','amazing','wow'],
  '😘':  ['kiss','love','blowing kiss'],
  '🥳':  ['party','celebration','birthday'],
  '😏':  ['smirk','sly','confident'],
  '😒':  ['unamused','meh','annoyed'],
  '😔':  ['pensive','sad','dejected'],
  '😟':  ['worried','concerned','sad'],
  '😣':  ['persevering','pain','frustrated'],
  '😖':  ['confounded','frustrated','annoyed'],
  '😫':  ['tired','weary','exhausted'],
  '😩':  ['weary','tired','fed up'],
  '🥺':  ['pleading','sad','puppy eyes'],
  '😭':  ['loudly crying','sob','very sad'],
  '😤':  ['triumph','hmph','annoyed','huff'],
  '😠':  ['angry','mad'],
  '🤬':  ['cursing','swearing','very angry'],
  '🤯':  ['mind blown','shocked','explosion'],
  '😳':  ['flushed','shocked','embarrassed'],
  '🥵':  ['hot','sweating','heat'],
  '🥶':  ['cold','freezing','blue'],
  '😱':  ['screaming','scared','shocked'],
  '😨':  ['fearful','scared','anxious'],
  '😰':  ['anxious','sweat','nervous'],
  '👋':  ['wave','hello','hi','bye'],
  '🤚':  ['raised hand','stop','palm'],
  '✋':  ['raised hand','stop','high five'],
  '👌':  ['ok','perfect','yes','good'],
  '✌️':  ['peace','victory','two'],
  '🤞':  ['fingers crossed','hope','luck'],
  '👎':  ['thumbs down','dislike','bad'],
  '👏':  ['clapping','applause','bravo'],
  '🙌':  ['raised hands','hooray','celebrate'],
  '🤝':  ['handshake','deal','agreement'],
  '🙏':  ['pray','please','namaste','thank you'],
  '🐶':  ['dog','puppy','woof'],
  '🐱':  ['cat','kitty','meow'],
  '🐭':  ['mouse','rat'],
  '🐰':  ['rabbit','bunny','easter'],
  '🦊':  ['fox','clever'],
  '🐻':  ['bear','teddy'],
  '🐼':  ['panda','cute'],
  '🦁':  ['lion','king','roar'],
  '🐸':  ['frog','kermit'],
  '🐵':  ['monkey','ape'],
  '⭐':  ['star','favorite','gold'],
  '🌈':  ['rainbow','colorful','pride'],
  '☀️':  ['sun','sunny','bright'],
  '🌙':  ['moon','night','crescent'],
  '❄️':  ['snowflake','cold','winter','ice'],
  '🎉':  ['party','celebrate','confetti','tada'],
  '🎊':  ['confetti','party','celebration'],
  '🎈':  ['balloon','party','birthday'],
  '🎁':  ['gift','present','birthday'],
  '🏆':  ['trophy','winner','champion','gold'],
  '🥇':  ['first place','gold medal','winner'],
  '💪':  ['muscle','strong','flex','power'],
  '🧠':  ['brain','smart','think','mind'],
  '👀':  ['eyes','look','watching','see'],
  '💀':  ['skull','dead','death','rip'],
  '🙈':  ['see no evil','monkey','hide'],
  '🙉':  ['hear no evil','monkey'],
  '🙊':  ['speak no evil','monkey','shh'],
  '🍕':  ['pizza','food','italian'],
  '🍔':  ['burger','hamburger','food'],
  '🍟':  ['fries','french fries','food'],
  '🍣':  ['sushi','japanese','food'],
  '🍜':  ['noodles','ramen','food'],
  '🍺':  ['beer','drink','cheers'],
  '☕':  ['coffee','hot drink','morning'],
  '🧋':  ['bubble tea','boba','drink'],
  '🍰':  ['cake','birthday','sweet'],
  '🍩':  ['donut','doughnut','sweet'],
  '🧡':  ['orange heart'],
  '💛':  ['yellow heart'],
  '💚':  ['green heart'],
  '💙':  ['blue heart'],
  '💜':  ['purple heart'],
  '🖤':  ['black heart','dark'],
  '💔':  ['broken heart','heartbreak','sad'],
  '💕':  ['two hearts','love'],
  '💖':  ['sparkling heart','love'],
  '✅':  ['check','done','yes','complete','ok'],
  '❌':  ['cross','no','wrong','x','cancel'],
  '⚠️':  ['warning','caution','alert'],
  '❓':  ['question','what','huh'],
  '❗':  ['exclamation','important','alert'],
  '💬':  ['speech bubble','chat','comment'],
  '💭':  ['thought bubble','thinking'],
  '🔔':  ['bell','notification','alert'],
  '📢':  ['loudspeaker','announce','megaphone'],
  '📌':  ['pin','pinned','location'],
  '🔗':  ['link','chain','url'],
  '⚡':  ['lightning','electric','zap','fast'],
  '💫':  ['dizzy','stars','sparkle'],
  '✨':  ['sparkles','magic','stars','glitter'],
  '🌟':  ['glowing star','star','amazing'],
}

const categories = [
  { id: 'recent',   label: '🕐', name: 'Recently Used',
    emojis: ['👍','❤️','😂','😮','😢','😡','🔥','💯','🎉','✅','👀','💀'] },
  { id: 'smileys',  label: '😀', name: 'Smileys & Emotion',
    emojis: ['😀','😃','😄','😁','😆','😅','🤣','😊','😇','🙂','😉','😌','😍','🥰','😘','😗','😙','😚','😋','😛','😝','😜','🤪','🤨','🧐','🤓','😎','🤩','🥳','😏','😒','😞','😔','😟','😕','🙁','☹️','😣','😖','😫','😩','🥺','😢','😭','😤','😠','😡','🤬','🤯','😳','🥵','🥶','😱','😨','😰','😥','😓'] },
  { id: 'people',   label: '👋', name: 'People & Body',
    emojis: ['👋','🤚','🖐','✋','🖖','👌','🤌','🤏','✌️','🤞','🤟','🤘','🤙','👈','👉','👆','🖕','👇','☝️','👍','👎','✊','👊','🤛','🤜','👏','🙌','👐','🤲','🤝','🙏','💪','🦾','🦵','🦶','👂','🦻','👃','🧠','👀','👁','👅','👄'] },
  { id: 'nature',   label: '🐶', name: 'Animals & Nature',
    emojis: ['🐶','🐱','🐭','🐹','🐰','🦊','🐻','🐼','🐨','🐯','🦁','🐮','🐷','🐸','🐵','🙈','🙉','🙊','🐔','🐧','🐦','🦅','🦆','🦉','🦇','🐺','🐗','🐴','🦄','🐝','🦋','🐌','🐞','🐜','🦟','🦗','🕷','🦂','🐢','🐍','🦎','🐙','🦑','🐡','🐠','🐟','🐬','🐳','🐋','🦈'] },
  { id: 'food',     label: '🍕', name: 'Food & Drink',
    emojis: ['🍎','🍊','🍋','🍇','🍓','🫐','🍒','🍑','🥭','🍍','🥥','🥝','🍅','🥑','🍆','🥦','🥬','🥒','🌶️','🥔','🍠','🥐','🥖','🍞','🧀','🥚','🍳','🥞','🧇','🥓','🥩','🍗','🍖','🌭','🍔','🍟','🍕','🥪','🌮','🌯','🥗','🍝','🍜','🍲','🍛','🍣','🍱','🥟','🍤','🍙','🍚','🍘','🍥','🥮','🍢','🧁','🍰','🎂','🍮','🍭','🍬','🍫','🍿','🍩','🍪','🌰','🥜','🍺','🍻','☕','🧋','🍵','🧃'] },
  { id: 'travel',   label: '✈️', name: 'Travel & Places',
    emojis: ['🚗','🚕','🚙','🚌','🚎','🏎','🚓','🚑','🚒','🚐','🚚','🚛','🚜','🏍','🛵','🚲','🛴','🛹','🛼','🚁','🛸','✈️','🚀','🛶','⛵','🚤','🛥','🛳','⛴','🚢','🚂','🚃','🚄','🚅','🚆','🚇','🚈','🚉','🚊','🚝','🚞','🚋','🚌','🚍','🚎','🚐','🏠','🏡','🏢','🏣','🏤','🏥','🏦','🏧','🏨','🏩','🏪','🏫','🏬','🏭','🏯','🏰','💒','🗼','🗽','⛪','🕌','🛕','🕍','⛩','🕋','⛲','⛺','🌁','🌃','🌄','🌅','🌆','🌇','🌉','🌌','🌠','🎇','🎆','🗺️','🧭','⛰️','🌋','🗻','🏕️','🏖️','🏜️','🏝️','🏞️','🏟️'] },
  { id: 'activity', label: '⚽', name: 'Activities',
    emojis: ['⚽','🏀','🏈','⚾','🥎','🏐','🏉','🥏','🎾','🏸','🏒','🏑','🥍','🏓','🥊','🥋','🎽','🛹','🛷','⛸️','🥅','⛳','🎣','🤿','🎿','🥌','🎯','🪃','🏹','🎱','🪀','🎮','🕹️','🎲','♟️','🎭','🎨','🎰','🎪','🤹','🎤','🎵','🎶','🎼','🎹','🥁','🪘','🎷','🎺','🎸','🪕','🎻','🎬','🎥','📽️','🎞️'] },
  { id: 'objects',  label: '💡', name: 'Objects',
    emojis: ['💡','🔦','🕯️','💰','💴','💵','💶','💷','💸','💳','🪙','💹','📈','📉','📊','📋','📌','📍','✂️','🗃️','🗄️','🗑️','🔒','🔓','🔑','🪤','🔨','🪛','🔧','🪜','🧲','🪝','🧰','🗡️','⚔️','🛡️','🚪','🪑','🚿','🛁','🧴','🧷','🧹','🧺','🧻','🪣','🧼','🫧','🪥','🧽','🧯','🛒','🚬','⚰️','⚱️','🏺','🔭','🔬','🩺','💊','💉','🩹','🩼','🩺','🩻','🧬','🦠','🧫','🧪','🌡️','🧲','🪄','🔮','🧿','🪬','💈','🔭','🔬'] },
  { id: 'symbols',  label: '❤️', name: 'Symbols',
    emojis: ['❤️','🧡','💛','💚','💙','💜','🖤','🤍','🤎','💔','❣️','💕','💞','💓','💗','💖','💘','💝','💟','☮️','✝️','☪️','🕉️','☸️','✡️','🔯','🕎','☯️','☦️','🛐','⛎','♈','♉','♊','♋','♌','♍','♎','♏','♐','♑','♒','♓','🆔','⚛️','🉑','☢️','☣️','📴','📳','🈶','🈚','🈸','🈺','🈷️','✴️','🆚','🉐','㊙️','㊗️','🈴','🈵','🈹','🈲','🅰️','🅱️','🆎','🆑','🅾️','🆘','❌','⭕','🛑','⛔','📛','🚫','✅','☑️','♻️','🆒','🆓','🆕','🆙','💯','🔚','🔙','🔛','🔝','🔜','〽️','⚠️','🔱','⚜️','🏳️','🏴','🚩','🎌','🏁'] },
]

// ── Emoji search with real name matching ─────────────────────────────────
const filteredEmojis = computed(() => {
  const q = search.value.trim().toLowerCase()
  if (!q) return categories
  return categories.map(c => ({
    ...c,
    emojis: c.emojis.filter(e => {
      if (e.includes(q)) return true
      const keywords = emojiMap[e]
      return keywords ? keywords.some(kw => kw.includes(q)) : false
    }),
  })).filter(c => c.emojis.length > 0)
})

// ── GIF integration (shared composable, provider-neutral) ──────────────────
const { gifs, loading: gifsLoading, error: gifsError, fetchGifs } = useGifs()
let _gifDebounce: ReturnType<typeof setTimeout> | null = null

watch(activeTab, tab => {
  if (tab === 'gifs') fetchGifs(search.value)
})

watch(search, q => {
  if (activeTab.value !== 'gifs') return
  if (_gifDebounce) clearTimeout(_gifDebounce)
  _gifDebounce = setTimeout(() => fetchGifs(q), 350)
})

const sendGif = (gif: any) => {
  const url = gifFullUrl(gif)
  if (url) emit('selectGif', url)
  emit('close')
}

// ── Stickers ──────────────────────────────────────────────────────────────
// Placeholder sticker packs — will be replaced with a proper pack management
// system once the server/storage backend supports media uploads
const stickerPacks = [
  { id: 'wave',  name: 'Wave',  emojis: ['👋','🤗','😄','😎','🥳','🤩','😍','🥰','😘','💪'] },
  { id: 'moods', name: 'Moods', emojis: ['😴','🤔','😤','🥹','😵','🫠','🤭','🫡','🤫','🫤'] },
  { id: 'misc',  name: 'Misc',  emojis: ['🔥','✨','💫','⚡','🌊','🎯','🎪','🎭','🪄','🎲'] },
]

const select = (v: string) => { emit('select', v); emit('close') }
</script>

<template>
  <div class="picker" @keydown.esc="emit('close')">

    <!-- Tabs -->
    <div class="picker-tabs">
      <button class="ptab" :class="{active: activeTab==='emojis'}"   @click="activeTab='emojis'">Emoji</button>
      <button class="ptab" :class="{active: activeTab==='gifs'}"     @click="activeTab='gifs'">GIF</button>
      <button class="ptab" :class="{active: activeTab==='stickers'}" @click="activeTab='stickers'">Stickers</button>
    </div>

    <!-- Search -->
    <div class="picker-search">
      <Search :size="13" :stroke-width="1.5" class="ps-icon" />
      <input
        v-model="search"
        type="text"
        :placeholder="activeTab === 'gifs' ? 'Search GIFs…' : activeTab === 'stickers' ? 'Search stickers…' : 'Find the perfect emoji…'"
        autofocus
      />
      <button v-if="search" class="ps-clear" @click="search = ''">
        <X :size="12" :stroke-width="2.25" />
      </button>
    </div>

    <!-- ── EMOJI TAB ───────────────────────────────────────────────────── -->
    <template v-if="activeTab === 'emojis'">
      <div class="picker-cats">
        <button
          v-for="c in categories" :key="c.id"
          class="cat-btn" :class="{ active: activeCategory === c.id }"
          v-tip="c.name"
          @click="activeCategory = c.id; search = ''"
        >{{ c.label }}</button>
      </div>

      <div class="picker-grid">
        <div v-if="filteredEmojis.length === 0" class="picker-empty">
          <div>🔍</div>
          <p>No results for "{{ search }}"</p>
        </div>
        <div v-for="cat in filteredEmojis" :key="cat.id" class="cat-section">
          <div class="cat-label">{{ cat.name }}</div>
          <div class="emoji-grid">
            <button
              v-for="e in cat.emojis" :key="e"
              class="emoji-btn" v-tip="e"
              @click="select(e)"
            >{{ e }}</button>
          </div>
        </div>
      </div>
    </template>

    <!-- ── GIF TAB ─────────────────────────────────────────────────────── -->
    <template v-else-if="activeTab === 'gifs'">
      <div class="picker-grid gif-grid-wrap">
        <div v-if="gifsLoading" class="picker-loading">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#5865f2" stroke-width="2.5" class="spin"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>
          Loading GIFs…
        </div>
        <div v-else-if="gifsError" class="picker-empty">
          <div>😕</div>
          <p>Couldn’t reach the GIF service</p>
          <span>Check your connection and try again</span>
        </div>
        <div v-else-if="gifs.length === 0" class="picker-empty">
          <div>🔍</div>
          <p>No GIFs found</p>
        </div>
        <template v-else>
          <div class="gif-masonry">
            <div
              v-for="gif in gifs" :key="gif.id"
              class="gif-item"
              @click="sendGif(gif)"
            >
              <img
                :src="gifPreviewUrl(gif)"
                :alt="gif.title"
                loading="lazy"
              />
            </div>
          </div>
          <!-- Provider attribution — required by the GIF API terms whenever their content is shown -->
          <div class="gif-attribution">Powered by KLIPY</div>
        </template>
      </div>
    </template>

    <!-- ── STICKERS TAB ───────────────────────────────────────────────── -->
    <template v-else>
      <div class="picker-grid">
        <div v-if="stickerPacks.length === 0" class="picker-empty">
          <div>🎨</div>
          <p>No sticker packs yet</p>
          <span>Sticker creation is coming soon</span>
        </div>
        <div v-for="pack in stickerPacks" :key="pack.id" class="cat-section">
          <div class="cat-label">{{ pack.name }}</div>
          <div class="emoji-grid">
            <button
              v-for="s in pack.emojis" :key="s"
              class="emoji-btn sticker-btn"
              @click="select(s)"
            >{{ s }}</button>
          </div>
        </div>
      </div>
    </template>

  </div>
</template>

<style scoped>
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
button { background: none; border: none; cursor: pointer; color: inherit; font: inherit; }
input  { background: none; border: none; outline: none; color: inherit; font: inherit; }
img    { display: block; width: 100%; object-fit: cover; }

.picker {
  width: 360px; background: var(--bg-panel);
  border: 1px solid rgba(255,255,255,.08); border-radius: 10px;
  display: flex; flex-direction: column; overflow: hidden;
  box-shadow: 0 8px 32px rgba(0,0,0,.5);
  max-height: 420px;
}

.picker-tabs { display: flex; border-bottom: 1px solid rgba(255,255,255,.06); padding: 0 8px; flex-shrink: 0; }
.ptab {
  padding: 10px 14px; font-size: 13px; font-weight: 600; color: var(--text-3);
  border-bottom: 2px solid transparent; margin-bottom: -1px;
  transition: color .12s, border-color .12s;
}
.ptab:hover { color: var(--text-1); }
.ptab.active { color: var(--text-on-accent); border-color: var(--accent); }

.picker-search {
  display: flex; align-items: center; gap: 8px;
  margin: 8px; background: rgba(0,0,0,.3); border-radius: 6px;
  padding: 7px 10px; border: 1px solid rgba(255,255,255,.06);
  flex-shrink: 0; transition: border-color .15s;
}
.picker-search:focus-within { border-color: rgba(var(--accent-rgb),.5); }
.ps-icon { color: var(--text-faint); flex-shrink: 0; }
.picker-search input { flex: 1; font-size: 13px; color: var(--text-1); }
.picker-search input::placeholder { color: var(--text-faint); }
.ps-clear { color: var(--text-faint); width: 18px; height: 18px; border-radius: 50%; display: flex; align-items: center; justify-content: center; transition: background .12s, color .12s; flex-shrink: 0; }
.ps-clear:hover { background: var(--hover-strong); color: var(--text-strong); }

.picker-cats {
  display: flex; gap: 2px; padding: 4px 8px 6px; flex-shrink: 0;
  border-bottom: 1px solid rgba(255,255,255,.06);
}
.cat-btn {
  width: 28px; height: 28px; border-radius: 5px; font-size: 16px;
  display: flex; align-items: center; justify-content: center;
  transition: background .1s; opacity: .7;
}
.cat-btn:hover, .cat-btn.active { background: var(--hover-strong); opacity: 1; }

.picker-grid { flex: 1; overflow-y: auto; padding: 8px; }
.cat-section  { margin-bottom: 12px; }
.cat-label { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: .4px; color: var(--text-3); margin-bottom: 6px; padding: 0 4px; }
.emoji-grid { display: flex; flex-wrap: wrap; gap: 1px; }
.emoji-btn {
  width: 34px; height: 34px; border-radius: 5px; font-size: 20px;
  display: flex; align-items: center; justify-content: center;
  transition: background .1s, transform .1s;
}
.emoji-btn:hover { background: var(--hover-strong); transform: scale(1.2); }
.sticker-btn { font-size: 26px; width: 48px; height: 48px; }

/* GIF masonry layout */
.gif-grid-wrap { padding: 8px; }
.gif-masonry { columns: 2; gap: 6px; }
.gif-item {
  break-inside: avoid; margin-bottom: 6px; border-radius: 6px; overflow: hidden;
  cursor: pointer; transition: opacity .12s, transform .12s;
  background: rgba(255,255,255,.04);
}
.gif-item:hover { opacity: .85; transform: scale(1.02); }
.gif-item img { border-radius: 6px; width: 100%; height: auto; display: block; }
.gif-attribution {
  text-align: center; font-size: 10px; color: var(--text-faint);
  padding: 6px 0 2px; letter-spacing: .2px;
}

.picker-loading, .picker-empty {
  display: flex; flex-direction: column; align-items: center;
  justify-content: center; gap: 8px; padding: 32px 16px; color: var(--text-faint);
  text-align: center; min-height: 180px;
}
.picker-loading { flex-direction: row; }
.picker-empty > div { font-size: 32px; }
.picker-empty p    { font-size: 14px; font-weight: 600; color: var(--text-1); }
.picker-empty span { font-size: 12px; line-height: 1.5; }

@keyframes spin { to { transform: rotate(360deg) } }
.spin { animation: spin .8s linear infinite; }

.picker-grid::-webkit-scrollbar { width: 4px; }
.picker-grid::-webkit-scrollbar-track { background: transparent; }
.picker-grid::-webkit-scrollbar-thumb { background: rgba(255,255,255,.1); border-radius: 2px; }
</style>