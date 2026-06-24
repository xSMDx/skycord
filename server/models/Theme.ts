import mongoose, { Document, Schema, Types } from 'mongoose'
import { randomBytes } from 'crypto'

// A shared appearance theme. `data` holds the client's themeable subset
// (accent, surfaces, fonts, sizing, etc.) — stored opaque/Mixed because the
// shape is owned by the client (useAppearance THEME_FIELDS). Sanitized on write.
export interface ITheme extends Document {
  _id:        Types.ObjectId
  slug:       string
  name:       string
  author:     Types.ObjectId
  authorName: string
  data:       Record<string, unknown>
  createdAt:  Date
}

const ThemeSchema = new Schema<ITheme>(
  {
    slug:       { type: String, required: true, unique: true, index: true },
    name:       { type: String, required: true, maxlength: 60 },
    author:     { type: Schema.Types.ObjectId, ref: 'User', required: true },
    authorName: { type: String, required: true },
    data:       { type: Schema.Types.Mixed, required: true },
  },
  { timestamps: { createdAt: true, updatedAt: false }, versionKey: false }
)

// Short, URL-safe slug (e.g. "438CGkAe"); collision-checked by the caller.
export const generateThemeSlug = (): string => randomBytes(6).toString('base64url')

export const Theme = mongoose.model<ITheme>('Theme', ThemeSchema)
