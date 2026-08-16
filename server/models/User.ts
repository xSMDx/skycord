import mongoose, { Document, Schema, Model, Types } from 'mongoose'
import bcrypt from 'bcrypt'
import { effectiveStatus, CHOSEN_STATUSES, type ChosenStatus } from '../state/presence'

const SALT_ROUNDS = 12

export interface IUserDocument extends Document {
  _id: Types.ObjectId
  username:      string
  email:         string
  password:      string
  displayName:   string
  discriminator: string
  avatar:        string | null
  bio:           string
  role:          'owner' | 'admin' | 'mod' | 'vip' | 'member'
  /** The user's OWN choice, persisted. Never written by connect/disconnect.
    *  What others see is derived — see server/state/presence.ts. */
  status:        ChosenStatus
  isVerified:    boolean
  tokenVersion:  number
  lastSeenAt:    Date
  bannerColor:   string | null
  banner:        string | null
  /** Render-time framing for images that can't be baked. See ICrop. */
  avatarCrop:    ICrop | null
  bannerCrop:    ICrop | null
  customStatus:  ICustomStatus | null
  convPrefs:     Map<string, IConvPref>
  createdAt:     Date
  updatedAt:     Date
  comparePassword(candidate: string): Promise<boolean>
  toPublicJSON(): PublicUser
  toSelfJSON(): PublicUser
}

/**
 * Per-user, per-conversation preferences, keyed by conversation id.
 *
 * Lives on the user rather than the conversation because 1:1 DMs have no
 * Conversation document at all — their id is synthesised from the two user ids
 * — and because pin/mute are personal either way: muting a group must not mute
 * it for the other nineteen people in it.
 *
 * `muted` and `mutedUntil` are separate on purpose. Collapsing them into one
 * nullable date makes "muted forever" and "not muted" both read as "no end
 * date", which is indistinguishable on read and on the wire.
 */
/**
 * A crop applied at RENDER time rather than baked into the image.
 *
 * Static images are cropped by canvas on upload and stored already-cropped.
 * An animated GIF cannot be: drawing it to a canvas flattens it to a single
 * frame and the animation is gone. So a GIF's framing is stored as numbers
 * and re-applied as a CSS transform wherever the image is drawn.
 *
 *   zoom  1 = fitted (cover). Above 1 magnifies.
 *   x, y  offset from centre as a PERCENTAGE of the container, so one crop
 *         renders the same at 20px in a message list and at 80px on a profile.
 */
export interface ICrop {
  zoom: number
  x:    number
  y:    number
}

export interface IConvPref {
  pinned:     boolean
  muted:      boolean
  mutedUntil: Date | null   // null while muted = indefinitely
}

/**
 * A custom status line, shown beside the name on the profile card.
 *
 * `clearAt` null means it never expires. Expiry is applied on READ (see
 * liveStatus below) rather than by a sweeper, matching how conversation mute
 * already works — a status that has run out simply stops being reported.
 */
export interface ICustomStatus {
  text:    string
  clearAt: Date | null
}

/** Null once expired, so callers never have to check the clock themselves. */
export const liveStatus = (s: ICustomStatus | null | undefined): ICustomStatus | null => {
  if (!s || !s.text) return null
  if (s.clearAt && new Date(s.clearAt).getTime() <= Date.now()) return null
  return { text: s.text, clearAt: s.clearAt ?? null }
}

export interface PublicUser {
  id:            string
  username:      string
  email:         string
  displayName:   string
  discriminator: string
  avatar:        string | null
  bio:           string
  role:          string
  status:        string
  isVerified:    boolean
  bannerColor:   string | null
  banner:        string | null
  /** Render-time framing for images that can't be baked. See ICrop. */
  avatarCrop:    ICrop | null
  bannerCrop:    ICrop | null
  customStatus:  ICustomStatus | null
  createdAt:     Date
}

interface IUserModel extends Model<IUserDocument> {
  findByIdentifier(identifier: string): Promise<IUserDocument | null>
}

const UserSchema = new Schema<IUserDocument, IUserModel>(
  {
    username: {
      type: String, required: true, unique: true,
      trim: true, minlength: 3, maxlength: 32,
      match: /^[a-zA-Z0-9_-]+$/,
    },
    email: {
      type: String, required: true, unique: true,
      trim: true, lowercase: true,
    },
    password: {
      type: String, required: true, select: false,
    },
    displayName: {
      type: String, trim: true, maxlength: 50,
      default: function (this: IUserDocument) { return this.username },
    },
    discriminator: {
      type: String,
      default: () => String(Math.floor(1000 + Math.random() * 9000)),
    },
    avatar:     { type: String, default: null },
    bio:        { type: String, default: '', maxlength: 190 },
    role: {
      type: String,
      enum: ['owner', 'admin', 'mod', 'vip', 'member'],
      default: 'member',
    },
    // 'offline' is deliberately NOT in this enum. Offline is a fact about
    // whether a socket is open, not something a person selects; storing it
    // here is what let a disconnect erase someone's Do Not Disturb.
    status: {
      type: String,
      enum: CHOSEN_STATUSES,
      default: 'online',
    },
    isVerified:   { type: Boolean, default: false },
    tokenVersion: { type: Number,  default: 0, select: false },
    lastSeenAt:   { type: Date,    default: Date.now },
    // Solid hex (#rrggbb) behind the profile card. null = the app's default.
    bannerColor:  { type: String,  default: null },
    // An image or GIF banner. When set it WINS over bannerColor, which stays
    // stored so removing the image falls back to the colour you had rather
    // than to the default.
    banner:       { type: String,  default: null },
    // null means "no crop", which is what every existing row has and what a
    // baked static image needs — so this is additive, with no migration.
    avatarCrop:   { type: { zoom: Number, x: Number, y: Number }, default: null, _id: false },
    bannerCrop:   { type: { zoom: Number, x: Number, y: Number }, default: null, _id: false },
    customStatus: {
      type: new Schema<ICustomStatus>({
        text:    { type: String, default: '', maxlength: 128 },
        clearAt: { type: Date,   default: null },
      }, { _id: false }),
      default: null,
    },
    // select:false — these are private settings, and User docs are also read to
    // build OTHER people's public profiles (search, friends, group members).
    // Excluding them by default means they can only ever leave via the /me
    // routes that opt in explicitly.
    convPrefs: {
      type: Map,
      of: new Schema<IConvPref>({
        pinned:     { type: Boolean, default: false },
        muted:      { type: Boolean, default: false },
        mutedUntil: { type: Date,    default: null },
      }, { _id: false }),
      default: () => new Map(),
      select: false,
    },
  },
  { timestamps: true, versionKey: false }
)

// Indexes are created automatically from unique:true on username and email fields above

// Hash password before save
UserSchema.pre('save', async function (next) {
  if (!this.isModified('password')) return next()
  this.password = await bcrypt.hash(this.password, SALT_ROUNDS)
  next()
})

UserSchema.methods.comparePassword = async function (candidate: string): Promise<boolean> {
  return bcrypt.compare(candidate, this.password)
}

UserSchema.methods.toPublicJSON = function (): PublicUser {
  return {
    id:            this._id.toString(),
    username:      this.username,
    email:         this.email,
    displayName:   this.displayName,
    discriminator: this.discriminator,
    avatar:        this.avatar,
    bio:           this.bio,
    role:          this.role,
    // DERIVED, not stored: offline when they have no socket, and offline
    // (never "invisible") when they've chosen to be invisible. This method
    // feeds every payload that reaches another user, so the mapping lives
    // here rather than at each call site where one could be forgotten.
    status:        effectiveStatus(this.status, this._id.toString()),
    isVerified:    this.isVerified,
    bannerColor:   this.bannerColor ?? null,
    avatarCrop:    this.avatarCrop ?? null,
    bannerCrop:    this.bannerCrop ?? null,
    banner:        this.banner ?? null,
    // Expired statuses are filtered here, so no caller can render a stale one.
    customStatus:  liveStatus(this.customStatus),
    createdAt:     this.createdAt,
  }
}

/**
 * Your own view of yourself. Identical to toPublicJSON except that `status`
 * is your actual choice, so the status picker can show "Invisible" ticked
 * while everyone else is being told you're offline.
 */
UserSchema.methods.toSelfJSON = function () {
  return { ...this.toPublicJSON(), status: this.status as ChosenStatus }
}

// Find by email OR username — includes password + tokenVersion for auth
UserSchema.statics.findByIdentifier = function (identifier: string) {
  return this.findOne({
    $or: [
      { email:    identifier.toLowerCase() },
      { username: identifier },
    ],
  }).select('+password +tokenVersion')
}

export const User = mongoose.model<IUserDocument, IUserModel>('User', UserSchema)