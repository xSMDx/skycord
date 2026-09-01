/**
 * IP → ISO-3166 alpha-2 country code, for the flag on the devices screen.
 *
 * Offline, by a deliberate choice. Every hosted "what country is this IP"
 * service works by being sent the IP, which means shipping the home address of
 * every user of a self-hosted, privacy-oriented chat server to a third party
 * on each login — to draw a 16-pixel flag. The database lives on disk instead.
 *
 * Bundled data: DB-IP Lite (CC-BY-4.0), via @ip-location-db/dbip-country-mmdb,
 * covering IPv4 and IPv6. Attribution is required by that licence and is on the
 * devices screen itself. It is a *lite* database: accurate to the country for
 * the overwhelming majority of addresses, and wrong for some VPNs, satellite
 * links and recently reassigned ranges. The screen says so, because a flag is
 * exactly the sort of detail people over-trust.
 *
 * Operators can point GEOIP_DB at their own .mmdb (a MaxMind GeoLite2-Country
 * file works — both record shapes are handled below), or set GEOIP=off to
 * disable lookups entirely and never load the file.
 */
import { open, type Reader, type CountryResponse } from 'maxmind'
import { config } from '../config/env'
import { isPrivateIp } from './clientIp'

/**
 * DB-IP Lite stores a flat `country_code`; MaxMind's GeoLite2-Country stores a
 * nested `country.iso_code`. The reader is generic over MaxMind's shape because
 * that is what its types allow, and the flat field is read off the same record
 * at runtime — the file decides, not the annotation.
 */
type DbIpRecord = { country_code?: string }

/**
 * Memoised promise, not a value: `open()` is async, several logins can race the
 * first one, and each should await the same read rather than starting its own.
 * Resolves to null when lookups are off or the file cannot be read.
 */
let readerPromise: Promise<Reader<CountryResponse> | null> | null = null

const resolveDbPath = (): string | null => {
  if (config.geoip.dbPath) return config.geoip.dbPath
  try {
    return require.resolve('@ip-location-db/dbip-country-mmdb/dbip-country.mmdb')
  } catch { return null }
}

const loadReader = (): Promise<Reader<CountryResponse> | null> => {
  if (readerPromise) return readerPromise
  readerPromise = (async () => {
    if (!config.geoip.enabled) return null
    const path = resolveDbPath()
    try {
      if (!path) throw new Error('no database file found')
      return await open<CountryResponse>(path)
    } catch (err) {
      // A missing or corrupt database costs you flags, not logins. Said once,
      // because this sits on the login path.
      console.warn(`[geoip] disabled — ${(err as Error).message}. Sessions will have no country.`)
      return null
    }
  })()
  return readerPromise
}

/**
 * @returns an uppercase ISO-3166 alpha-2 code, or null when the address is
 *          private, unknown to the database, or lookups are off.
 */
export const lookupCountry = async (ip: string): Promise<string | null> => {
  if (!ip || isPrivateIp(ip)) return null
  const reader = await loadReader()
  if (!reader) return null
  try {
    const rec = reader.get(ip) as (CountryResponse & DbIpRecord) | null
    if (!rec) return null
    const code = rec.country_code ?? rec.country?.iso_code
    // The database carries a few non-ISO placeholders. Two letters or nothing —
    // anything else has no flag and means nothing to a reader.
    return code && /^[A-Za-z]{2}$/.test(code) ? code.toUpperCase() : null
  } catch { return null }
}

/** Tests only — forces the next lookup to re-read config and reopen. */
export const _resetGeoipForTests = (): void => { readerPromise = null }
