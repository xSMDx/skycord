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
  createdAt:     Date
  updatedAt:     Date
  comparePassword(candidate: string): Promise<boolean>
  toPublicJSON(): PublicUser
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