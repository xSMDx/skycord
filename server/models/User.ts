import mongoose, { Document, Schema, Model, Types } from 'mongoose'
import bcrypt from 'bcrypt'

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
  status:        'online' | 'idle' | 'dnd' | 'offline' | 'invisible'
  isVerified:    boolean
  tokenVersion:  number
  lastSeenAt:    Date
  convPrefs:     Map<string, IConvPref>
  createdAt:     Date
  updatedAt:     Date
  comparePassword(candidate: string): Promise<boolean>
  toPublicJSON(): PublicUser
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
export interface IConvPref {
  pinned:     boolean
  muted:      boolean
  mutedUntil: Date | null   // null while muted = indefinitely
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
    status: {
      type: String,
      enum: ['online', 'idle', 'dnd', 'offline', 'invisible'],
      default: 'offline',
    },
    isVerified:   { type: Boolean, default: false },
    tokenVersion: { type: Number,  default: 0, select: false },
    lastSeenAt:   { type: Date,    default: Date.now },
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
    status:        this.status,
    isVerified:    this.isVerified,
    createdAt:     this.createdAt,
  }
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