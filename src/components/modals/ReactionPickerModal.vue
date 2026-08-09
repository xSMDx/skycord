<script setup lang="ts">
import { ref, computed } from 'vue'
import { X, Search } from 'lucide-vue-next'

const emit = defineEmits<{ select: [emoji: string]; close: [] }>()

const search = ref('')
const activeCategory = ref('recent')

const categories = [
  { id: 'recent',   label: '🕐', name: 'Recently Used',
    emojis: ['👍','❤️','😂','😮','😢','😡','🔥','💯','🎉','✅','👀','💀'] },
  { id: 'smileys',  label: '😀', name: 'Smileys',
    emojis: ['😀','😃','😄','😁','😆','😅','😂','🤣','😊','😇','🙂','🙃','😉','😌','😍','🥰','😘','😗','😙','😚','😋','😛','😝','😜','🤪','🤨','🧐','🤓','😎','🤩','🥳','😏','😒','😞','😔','😟','😕','🙁','☹️','😣','😖','😫','😩','🥺','😢','😭','😤','😠','😡','🤬','🤯','😳','🥵','🥶','😱','😨','😰','😥','😓'] },
  { id: 'people',   label: '👋', name: 'People',
    emojis: ['👋','🤚','🖐','✋','🖖','👌','🤌','🤏','✌️','🤞','🤟','🤘','🤙','👈','👉','👆','🖕','👇','☝️','👍','👎','✊','👊','🤛','🤜','👏','🙌','👐','🤲','🤝','🙏','💪','🦾','🦿','🦵','🦶','👂','🦻','👃','🧠','🫀','🫁','🦷','🦴','👀','👁','👅','👄'] },
  { id: 'nature',   label: '🐶', name: 'Animals',
    emojis: ['🐶','🐱','🐭','🐹','🐰','🦊','🐻','🐼','🐨','🐯','🦁','🐮','🐷','🐸','🐵','🙈','🙉','🙊','🐒','🐔','🐧','🐦','🦅','🦆','🦉','🦇','🐺','🐗','🐴','🦄','🐝','🪱','🐛','🦋','🐌','🐞','🐜','🪲','🦟','🦗','🪳','🕷','🦂','🐢','🐍','🦎','🦖','🦕','🐙','🦑','🦐','🦞','🦀','🐡','🐠','🐟','🐬','🐳','🐋','🦈','🐊','🐅','🐆'] },
  { id: 'food',     label: '🍕', name: 'Food',
    emojis: ['🍎','🍊','🍋','🍇','🍓','🫐','🍈','🍒','🍑','🥭','🍍','🥥','🥝','🍅','🥑','🍆','🥦','🥬','🥒','🌶️','🫑','🧄','🧅','🥔','🍠','🥐','🥖','🍞','🥨','🧀','🥚','🍳','🧈','🥞','🧇','🥓','🥩','🍗','🍖','🦴','🌭','🍔','🍟','🍕','🫓','🥪','🥙','🧆','🌮','🌯','🫔','🥗','🥘','🫕','🥫','🍝','🍜','🍲','🍛','🍣','🍱','🥟','🦪','🍤','🍙','🍚','🍘','🍥','🥮','🍢','🧁','🍰','🎂','🍮','🍭','🍬','🍫','🍿','🍩','🍪','🌰','🥜'] },
  { id: 'activity', label: '⚽', name: 'Activities',
    emojis: ['⚽','🏀','🏈','⚾','🥎','🏐','🏉','🥏','🎾','🏸','🏒','🏑','🥍','🏓','🏸','🥊','🥋','🎽','🛹','🛼','🛷','⛸️','🥅','⛳','🎣','🤿','🎽','🎿','🛷','🥌','🎯','🪃','🏹','🎱','🪀','🪁','🎮','🕹️','🎲','♟️','🎭','🎨','🖼️','🎰','🚂'] },
  { id: 'symbols',  label: '❤️', name: 'Symbols',
    emojis: ['❤️','🧡','💛','💚','💙','💜','🖤','🤍','🤎','💔','❣️','💕','💞','💓','💗','💖','💘','💝','💟','☮️','✝️','☪️','🕉️','☸️','✡️','🔯','🕎','☯️','☦️','🛐','⛎','♈','♉','♊','♋','♌','♍','♎','♏','♐','♑','♒','♓','🆔','⚛️','🉑','☢️','☣️','📴','📳','🈶','🈚','🈸','🈺','🈷️','✴️','🆚','💮','🉐','㊙️','㊗️','🈴','🈵','🈹','🈲','🅰️','🅱️','🆎','🆑','🅾️','🆘','❌','⭕','🛑','⛔','📛','🚫'] },
]

// Searchable keywords per emoji — without this, search only ever matched the
// category NAME ("smileys", "food"), never what the emoji actually means.
// Typing "fire" found nothing because no category is literally named "fire".
const emojiKeywords: Record<string, string[]> = {
  '👍': ['thumbs up','like','good','yes'],      '❤️': ['heart','love'],
  '😂': ['joy','laugh','lol','funny'],          '😮': ['wow','surprised','shocked'],
  '😢': ['sad','cry','tear'],                   '😡': ['angry','mad','rage'],
  '🔥': ['fire','hot','lit','flame'],           '💯': ['100','perfect','score'],
  '🎉': ['party','celebrate','confetti'],       '✅': ['check','done','yes','complete'],
  '👀': ['eyes','look','watching'],             '💀': ['skull','dead','rip'],
  '😀': ['grinning','happy','smile'],           '😍': ['heart eyes','love','adore'],
  '🥰': ['hearts','smiling','love'],            '😭': ['crying','sob','very sad'],
  '🤣': ['rolling','floor laughing','rofl'],    '🥺': ['pleading','puppy eyes'],
  '😎': ['cool','sunglasses','awesome'],        '🥳': ['party','celebration','birthday'],
  '🤔': ['thinking','hmm','consider'],          '😴': ['sleeping','tired','zzz'],
  '🙌': ['raised hands','hooray','celebrate'],  '👏': ['clapping','applause','bravo'],
  '💪': ['muscle','strong','flex'],             '🙏': ['pray','please','thank you'],
  '⭐': ['star','favorite'],                    '✨': ['sparkles','magic','glitter'],
  '⚡': ['lightning','zap','fast'],              '🏆': ['trophy','winner','champion'],
}

const filtered = computed(() => {
  const q = search.value.trim().toLowerCase()
  if (!q) return categories
  return categories.map(c => ({
    ...c,
    emojis: c.emojis.filter(e => {
      if (e.includes(q)) return true
      const kws = emojiKeywords[e]
      return kws ? kws.some(kw => kw.includes(q)) : false
    })
  })).filter(c => c.emojis.length > 0)
})

const select = (emoji: string) => {
  emit('select', emoji)
  emit('close')
}
</script>

<template>
  <Teleport to="body">
    <div class="rp-overlay" @mousedown.self="emit('close')">
      <div class="rp-modal" @click.stop>
        <!-- Header -->
        <div class="rp-header">
          <h3>Pick a Reaction</h3>
          <button class="rp-close" @click="emit('close')">
            <X :size="18" :stroke-width="1.5" />
          </button>
        </div>

        <!-- Search -->
        <div class="rp-search">
          <Search :size="14" :stroke-width="1.5" class="rp-search-icon" />
          <input v-model="search" type="text" placeholder="Find the perfect emoji…" autofocus />
        </div>

        <!-- Category tabs -->
        <div class="rp-cats">
          <button
            v-for="c in categories" :key="c.id"
            class="rp-cat-btn"
            :class="{ active: activeCategory === c.id }"
            v-tip="c.name"
            @click="activeCategory = c.id; search = ''"
          >{{ c.label }}</button>
        </div>

        <!-- Emoji grid -->
        <div class="rp-grid-wrap">
          <div v-for="cat in filtered" :key="cat.id" class="rp-section">
            <div class="rp-section-label">{{ cat.name }}</div>
            <div class="rp-grid">
              <button
                v-for="emoji in cat.emojis" :key="emoji"
                class="rp-emoji-btn"
                @click="select(emoji)"
              >{{ emoji }}</button>
            </div>
          </div>
          <div v-if="filtered.length === 0" class="rp-empty">
            <div>🔍</div>
            <p>No emoji found for "{{ search }}"</p>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
button { background: none; border: none; cursor: pointer; color: inherit; font: inherit; }
input  { background: none; border: none; outline: none; color: inherit; font: inherit; }

.rp-overlay {
  position: fixed; inset: 0;
  background: rgba(0,0,0,.65);
  display: flex; align-items: center; justify-content: center;
  z-index: 2000;
  animation: fade .12s ease;
}
@keyframes fade { from{opacity:0} to{opacity:1} }

.rp-modal {
  width: 420px; max-width: 95vw;
  background: var(--bg-panel); border-radius: 12px;
  display: flex; flex-direction: column;
  max-height: 80vh; overflow: hidden;
  box-shadow: 0 24px 80px rgba(0,0,0,.8);
  animation: pop .15s cubic-bezier(.4,0,.2,1);
}
@keyframes pop { from{opacity:0;transform:scale(.92) translateY(12px)} to{opacity:1;transform:scale(1) translateY(0)} }

.rp-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 16px 16px 0;
}
.rp-header h3 { font-size: 15px; font-weight: 700; color: var(--text-strong); }
.rp-close {
  width: 28px; height: 28px; border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  color: var(--text-3); transition: background .12s, color .12s;
}
.rp-close:hover { background: var(--hover-strong); color: var(--text-strong); }

.rp-search {
  display: flex; align-items: center; gap: 8px;
  margin: 12px 12px 0; background: rgba(0,0,0,.3);
  border: 1.5px solid rgba(255,255,255,.08);
  border-radius: 8px; padding: 8px 12px;
  transition: border-color .15s;
}
.rp-search:focus-within { border-color: var(--accent); }
.rp-search-icon { color: var(--text-faint); flex-shrink: 0; }
.rp-search input { flex: 1; font-size: 14px; color: var(--text-strong); }
.rp-search input::placeholder { color: var(--text-faint); }

.rp-cats {
  display: flex; gap: 2px; padding: 10px 12px 8px;
  border-bottom: 1px solid rgba(255,255,255,.06); flex-wrap: wrap;
}
.rp-cat-btn {
  width: 34px; height: 34px; border-radius: 6px; font-size: 18px;
  display: flex; align-items: center; justify-content: center;
  transition: background .1s, transform .1s;
}
.rp-cat-btn:hover  { background: var(--hover-strong); transform: scale(1.15); }
.rp-cat-btn.active { background: rgba(var(--accent-rgb),.25); }

.rp-grid-wrap {
  flex: 1; overflow-y: auto; padding: 8px 8px 12px;
}
.rp-section { margin-bottom: 12px; }
.rp-section-label {
  font-size: 11px; font-weight: 700; letter-spacing: .5px;
  text-transform: uppercase; color: var(--text-3);
  padding: 4px 6px 6px;
}
.rp-grid { display: flex; flex-wrap: wrap; gap: 1px; }
.rp-emoji-btn {
  width: 38px; height: 38px; border-radius: 6px; font-size: 22px;
  display: flex; align-items: center; justify-content: center;
  transition: background .1s, transform .12s;
}
.rp-emoji-btn:hover { background: var(--hover-strong); transform: scale(1.25); }
.rp-emoji-btn:active { transform: scale(.9); }

.rp-empty {
  display: flex; flex-direction: column; align-items: center;
  gap: 8px; padding: 32px 20px; color: var(--text-faint); text-align: center;
}
.rp-empty div { font-size: 36px; }
.rp-empty p   { font-size: 14px; }

.rp-grid-wrap::-webkit-scrollbar { width: 4px; }
.rp-grid-wrap::-webkit-scrollbar-track { background: transparent; }
.rp-grid-wrap::-webkit-scrollbar-thumb { background: rgba(255,255,255,.1); border-radius: 2px; }
</style>