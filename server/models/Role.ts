import mongoose, { Document, Schema, Types } from 'mongoose'
import { DEFAULT_EVERYONE, serializeBits } from '../permissions'

/**
 * A named set of permissions inside one server.
 *
 * ── Why permissions is a String ──────────────────────────────────────────
 * BSON has no BigInt, and the model is BigInt precisely because JavaScript's
 * bitwise operators coerce to 32-bit SIGNED integers — `1 << 31` is negative,
 * so the 32nd permission would corrupt the 31 below it. A decimal string
 * round-trips exactly at any width and is what the API already sends, since
 * JSON has no BigInt either. Same choice server/permissions.ts documents.
 *
 * ── Why position matters ─────────────────────────────────────────────────
 * Position IS authority. canManageRole() requires a strictly higher position,
 * which is what stops the lowest moderator rewriting the top role and granting
 * themselves the server. Equal positions deliberately do NOT pass.
 *
 * Note it does not govern channel permissions: overwrites accumulate across
 * every role a member holds, so ordering has no effect there. Position decides
 * who may EDIT what, not what resolves.
 *
 * ── @everyone ────────────────────────────────────────────────────────────
 * Every server has exactly one role with `isEveryone`, created with it. It sits
 * at position 0, cannot be deleted or renamed, and is the role every member
 * holds implicitly — membership is not stored against it, which is why
 * memberRoles only ever lists the others.
 */
export const MAX_ROLES = 100
export const MAX_ROLE_NAME = 100

export interface IRole extends Document {
  _id:      Types.ObjectId
  server:   Types.ObjectId
  name:     string
  /** Hex, or null for "no colour" — members then inherit the next role down. */
  color:    string | null
  /** Higher outranks lower. @everyone is pinned at 0. */
  position: number
  /** Decimal string of the permission bitfield. See parseBits/serializeBits. */
  permissions: string
  /** Show holders under their own heading in the member list. */
  hoist:       boolean
  /** Anyone may @mention this role, not only those who can mention everyone. */
  mentionable: boolean
  /** The implicit role every member has. Exactly one per server. */
  isEveryone:  boolean
  createdAt: Date
  updatedAt: Date
}

const RoleSchema = new Schema<IRole>(
  {
    server:      { type: Schema.Types.ObjectId, ref: 'Server', required: true },
    name:        { type: String, required: true, maxlength: MAX_ROLE_NAME },
    color:       { type: String, default: null },
    position:    { type: Number, default: 0 },
    // Stored as the serialized default rather than '0': a role that grants
    // nothing is never what anyone meant to create, and @everyone in
    // particular would make the server look broken to every member but the
    // owner, with no error to explain it.
    permissions: { type: String, default: () => serializeBits(DEFAULT_EVERYONE) },
    hoist:       { type: Boolean, default: false },
    mentionable: { type: Boolean, default: false },
    isEveryone:  { type: Boolean, default: false },
  },
  { timestamps: true, versionKey: false }
)

// The role list is always read per server, ordered by rank.
RoleSchema.index({ server: 1, position: -1 })
// One @everyone per server, enforced by the database rather than by carefully
// remembering to check. Partial, so it constrains nothing for ordinary roles.
RoleSchema.index(
  { server: 1 },
  { unique: true, partialFilterExpression: { isEveryone: true } },
)

export const Role = mongoose.model<IRole>('Role', RoleSchema)
