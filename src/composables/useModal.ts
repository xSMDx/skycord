import { ref, shallowRef } from 'vue'
import type { Friend, DM, Member } from '@/types'

type ModalType =
  | 'settings'
  | 'userProfile'
  | 'newDM'
  | 'addFriend'
  | 'emojiPicker'
  | 'pinnedMessages'
  | 'messageRequests'
  | null

interface ModalData {
  friend?:   Friend | Member
  dm?:       DM
  msgId?:    number
  dmId?:     string
  onSelect?: (emoji: string) => void
}

const activeModal = ref<ModalType>(null)
const modalData   = ref<ModalData>({})

export const useModal = () => {
  const open = (type: ModalType, data: ModalData = {}) => {
    activeModal.value = type
    modalData.value   = data
  }

  const close = () => {
    activeModal.value = null
    modalData.value   = {}
  }

  const is = (type: ModalType) => activeModal.value === type

  return { activeModal, modalData, open, close, is }
}