/**
 * A voice channel with somebody already in it.
 *
 * Its own module rather than an export from the rail's `<script setup>`,
 * which cannot carry ES exports at all — and because two components need
 * the shape, so neither should own it.
 *
 * Resolved by ChatApp from the presence the sidebar already holds. The rail
 * does not know how to look a member up, and should not learn: that logic
 * already exists once, with all its fallbacks for members who have never
 * posted.
 */
export interface VoiceRoomChoice {
  channelId: string
  /** The channel's name, or a stand-in when we have not fetched that server. */
  name: string
  /** Empty when unknown — a room is still worth showing without it. */
  serverName: string
  people: { id: string; name: string; avatar: string }[]
}
