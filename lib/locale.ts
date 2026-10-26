// lib/locale.ts
// Deployment-wide appearance + localisation settings (admin-set, stored in
// kv_settings via Settings → Customization). SERVER-SIDE: these functions read
// the encrypted settings store, so import only from server code (route handlers,
// the root layout, prompt builders). The option lists the UI offers live in the
// client tab; the language-name map here is shared with the prompt directive.
//
// Scope decision: deployment-wide (one value per box), not per-user — Mosaic is
// one instance per customer, so a box typically shares region/language/units.

import { getKey } from './keys'

export type Units = 'metric' | 'imperial'

export interface LocaleSettings {
  fontFamily: string        // 'default' | 'system' | 'neutral' | 'serif'
  fontSize: string          // 'small' | 'medium' | 'large'
  locale: string            // BCP-47, e.g. 'en-GB' — number/date formatting
  timezone: string          // IANA, e.g. 'Europe/London' ('' = server/UTC)
  responseLanguage: string  // 'match' (mirror user) or a language code
  units: Units
}

const DEFAULTS: LocaleSettings = {
  fontFamily: 'default',
  fontSize: 'medium',
  locale: 'en-GB',
  timezone: '',
  responseLanguage: 'match',
  units: 'metric',
}

// Language code → English name, used both for the model directive and as the
// source of truth the UI mirrors. 'match' means "answer in the user's language".
export const LANGUAGE_NAMES: Record<string, string> = {
  match: "the user's language",
  en: 'English', de: 'German', fr: 'French', es: 'Spanish', it: 'Italian',
  pt: 'Portuguese', nl: 'Dutch', pl: 'Polish', sv: 'Swedish', tr: 'Turkish',
  cs: 'Czech', ro: 'Romanian', hu: 'Hungarian', ru: 'Russian', uk: 'Ukrainian',
  ar: 'Arabic', he: 'Hebrew', hi: 'Hindi', bn: 'Bengali', ta: 'Tamil',
  zh: 'Chinese (Simplified)', ja: 'Japanese', ko: 'Korean', vi: 'Vietnamese',
  th: 'Thai', id: 'Indonesian', ms: 'Malay',
}

/** Read the deployment's appearance + localisation settings (env → kv_settings),
 *  falling back to sensible defaults. Safe to call from any server context. */
export async function getLocaleSettings(): Promise<LocaleSettings> {
  const read = async (k: string) => { try { return (await getKey(k)) || '' } catch { return '' } }
  const [fontFamily, fontSize, locale, timezone, responseLanguage, units] = await Promise.all([
    read('UI_FONT_FAMILY'), read('UI_FONT_SIZE'), read('MOSAIC_LOCALE'),
    read('MOSAIC_TIMEZONE'), read('MOSAIC_RESPONSE_LANGUAGE'), read('MOSAIC_UNITS'),
  ])
  return {
    fontFamily: fontFamily || DEFAULTS.fontFamily,
    fontSize: fontSize || DEFAULTS.fontSize,
    locale: locale || DEFAULTS.locale,
    timezone: timezone || DEFAULTS.timezone,
    responseLanguage: responseLanguage || DEFAULTS.responseLanguage,
    units: (units === 'imperial' ? 'imperial' : 'metric'),
  }
}

/**
 * A compact directive appended to every AI system prompt so the model answers in
 * the configured language and units. Returns '' when nothing needs saying (mirror
 * the user's language, metric units) to avoid prompt bloat. Pre-resolved settings
 * can be passed to avoid a second settings read within one request.
 */
export async function localeSystemDirectives(pre?: LocaleSettings): Promise<string> {
  const s = pre || await getLocaleSettings()
  const parts: string[] = []
  const lang = (s.responseLanguage || 'match').toLowerCase()
  if (lang && lang !== 'match' && lang !== 'en') {
    const name = LANGUAGE_NAMES[lang] || lang
    parts.push(`Always write your responses in ${name}, regardless of the language the question is asked in. Keep data values, identifiers, codes and units unchanged.`)
  }
  if (s.units === 'imperial') {
    parts.push('Use US/imperial units (°F, psi, lb, ft, in, gal) in your prose; keep any values that are already in a specific unit as given.')
  }
  if (!parts.length) return ''
  return '\n\n' + parts.join(' ')
}
