import validator from 'validator'

export interface ValidationResult {
  valid:  boolean
  errors: Record<string, string>
}

export const validateRegister = (d: {
  username?:    unknown
  email?:       unknown
  password?:    unknown
  displayName?: unknown
}): ValidationResult => {
  const errors: Record<string, string> = {}

  if (!d.username || typeof d.username !== 'string')
    errors.username = 'Username is required'
  else if (!/^[a-zA-Z0-9_-]{3,32}$/.test(d.username))
    errors.username = 'Username: 3–32 chars, letters/numbers/_ or -'

  if (!d.email || typeof d.email !== 'string')
    errors.email = 'Email is required'
  else if (!validator.isEmail(d.email))
    errors.email = 'Enter a valid email address'

  if (!d.password || typeof d.password !== 'string')
    errors.password = 'Password is required'
  else if (d.password.length < 8)
    errors.password = 'Password must be at least 8 characters'
  else if (!/[A-Z]/.test(d.password))
    errors.password = 'Password needs at least one uppercase letter'
  else if (!/[0-9]/.test(d.password))
    errors.password = 'Password needs at least one number'
  else if (!/[!@#$%^&*(),.?":{}|<>]/.test(d.password))
    errors.password = 'Password needs at least one special character'

  if (d.displayName && typeof d.displayName === 'string' && d.displayName.length > 50)
    errors.displayName = 'Display name max 50 characters'

  return { valid: Object.keys(errors).length === 0, errors }
}

export const validateLogin = (d: {
  identifier?: unknown
  password?:   unknown
}): ValidationResult => {
  const errors: Record<string, string> = {}
  if (!d.identifier || typeof d.identifier !== 'string' || !d.identifier.trim())
    errors.identifier = 'Username or email is required'
  if (!d.password || typeof d.password !== 'string')
    errors.password = 'Password is required'
  return { valid: Object.keys(errors).length === 0, errors }
}
