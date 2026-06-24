import { createApp } from 'vue'
import './styles/tokens.css'
import './style.css'
import App from './App.vue'
import { applyAppearance } from './composables/useAppearance'

applyAppearance()   // restore saved theme/accent/density before first paint
createApp(App).mount('#app')
