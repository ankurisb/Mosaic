// lib/format.ts
// Locale/timezone-aware formatting via the Intl API. PURE and ISOMORPHIC — these
// take the locale/timezone explicitly and import nothing server-only, so the same
// helpers work in server code (reports) and client code (dashboards). Read the
// deployment settings with getLocaleSettings() (lib/locale) and pass them in; on
// the client, read them from the <html data-locale/data-timezone> attributes that
// the root layout sets (see useLocaleFormat below).

export interface FormatOpts { locale?: string; timezone?: string }

function tz(timezone?: string): string | undefined {
  return timezone && timezone.trim() ? timezone : undefined   // undefined → runtime default
}

/** Date + time, e.g. "26 Oct 2026, 22:14" (en-GB) in the configured timezone. */
export function fmtDateTime(d: Date | string | number, o: FormatOpts = {}): string {
  const date = d instanceof Date ? d : new Date(d)
  if (isNaN(date.getTime())) return String(d)
  try {
    return new Intl.DateTimeFormat(o.locale || undefined, {
      day: 'numeric', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit', timeZone: tz(o.timezone),
    }).format(date)
  } catch { return date.toISOString() }
}

/** Date only, e.g. "26 Oct 2026". */
export function fmtDate(d: Date | string | number, o: FormatOpts = {}): string {
  const date = d instanceof Date ? d : new Date(d)
  if (isNaN(date.getTime())) return String(d)
  try {
    return new Intl.DateTimeFormat(o.locale || undefined, {
      day: 'numeric', month: 'short', year: 'numeric', timeZone: tz(o.timezone),
    }).format(date)
  } catch { return date.toISOString().slice(0, 10) }
}

/** Number with locale grouping/decimal conventions, e.g. 1,234.5 vs 1.234,5. */
export function fmtNumber(n: number, o: FormatOpts & { maximumFractionDigits?: number } = {}): string {
  if (!Number.isFinite(n)) return String(n)
  try {
    return new Intl.NumberFormat(o.locale || undefined, {
      maximumFractionDigits: o.maximumFractionDigits ?? 2,
    }).format(n)
  } catch { return String(n) }
}

/** Client-only: read the deployment locale/timezone the root layout wrote onto
 *  <html>, so dashboard components can format without a round-trip. */
export function readLocaleFromDom(): FormatOpts {
  if (typeof document === 'undefined') return {}
  const el = document.documentElement
  return {
    locale: el.getAttribute('data-locale') || undefined,
    timezone: el.getAttribute('data-timezone') || undefined,
  }
}
