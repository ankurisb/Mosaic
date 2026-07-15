'use client'
import { useState } from 'react'

// Recursive renderer for Airbyte connector specs (JSON Schema).
//
// The previous flat renderer did `if (type === 'object' || type === 'array')
// return null`, silently dropping the constructs most of Airbyte's 300+
// connectors rely on:
//   - oneOf  : "choose auth method" (OAuth vs API key vs token) — very common
//   - object : grouped/nested config (credentials, tunnel_method, ssl)
//   - array  : repeatable config (list of streams, report configs)
// Those fields never appeared, so the submitted config was incomplete and
// source creation failed downstream with an opaque error.
//
// This renderer walks the schema and produces a NESTED config value mirroring
// the schema shape — which is what Airbyte's create_source expects.

export type Schema = {
  type?: string | string[]
  title?: string
  description?: string
  default?: unknown
  enum?: unknown[]
  const?: unknown
  examples?: unknown[]
  properties?: Record<string, Schema>
  required?: string[]
  oneOf?: Schema[]
  items?: Schema
  order?: number
  airbyte_secret?: boolean
  multiline?: boolean
  format?: string
}

const lbl: React.CSSProperties = { display: 'block', fontSize: 11, fontWeight: 600, color: 'var(--text2)', marginBottom: 5 }
const inp: React.CSSProperties = { width: '100%', padding: '8px 11px', border: '1.5px solid var(--border2)', borderRadius: 8, fontSize: 13, background: 'var(--bg)', color: 'var(--text)', fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box' }
const grp: React.CSSProperties = { border: '1px solid var(--border)', borderRadius: 10, padding: 14, marginBottom: 14, background: 'var(--bg)' }

function isSecret(key: string, s: Schema) {
  return s.airbyte_secret || /password|token|secret|client_secret|api_key|private_key/i.test(key)
}

function scalarType(s: Schema): 'integer' | 'boolean' | 'string' {
  const t = Array.isArray(s.type) ? s.type[0] : s.type
  if (t === 'integer' || t === 'number') return 'integer'
  if (t === 'boolean') return 'boolean'
  return 'string'
}

function Leaf({ name, schema, value, required, onChange }: {
  name: string; schema: Schema; value: unknown; required: boolean; onChange: (v: unknown) => void
}) {
  const t = scalarType(schema)
  const secret = isSecret(name, schema)
  return (
    <div style={{ marginBottom: 14 }}>
      <label style={lbl}>{schema.title || name}{required && <span style={{ color: '#dc2626' }}> *</span>}</label>
      {schema.enum ? (
        <select value={String(value ?? schema.default ?? '')} onChange={e => onChange(e.target.value)} style={inp}>
          <option value="">— select —</option>
          {schema.enum.map(v => <option key={String(v)} value={String(v)}>{String(v)}</option>)}
        </select>
      ) : t === 'boolean' ? (
        <select value={String(value ?? schema.default ?? 'false')} onChange={e => onChange(e.target.value === 'true')} style={inp}>
          <option value="false">false</option>
          <option value="true">true</option>
        </select>
      ) : schema.multiline ? (
        <textarea value={String(value ?? '')} onChange={e => onChange(e.target.value)} rows={3} style={{ ...inp, resize: 'vertical' }} />
      ) : (
        <input
          type={secret ? 'password' : t === 'integer' ? 'number' : 'text'}
          value={String(value ?? '')}
          onChange={e => onChange(t === 'integer' ? (e.target.value === '' ? '' : Number(e.target.value)) : e.target.value)}
          placeholder={schema.examples?.[0] != null ? String(schema.examples[0]) : (schema.description || '').slice(0, 60)}
          style={inp}
        />
      )}
      {schema.description && <div style={{ fontSize: 11, color: 'var(--text4)', marginTop: 3 }}>{schema.description.slice(0, 120)}</div>}
    </div>
  )
}

export function SpecField({ name, schema, value, required, onChange }: {
  name: string; schema: Schema; value: unknown; required: boolean; onChange: (v: unknown) => void
}) {
  if (schema.const !== undefined) {
    if (value !== schema.const) onChange(schema.const)
    return null
  }
  if (schema.oneOf && schema.oneOf.length) {
    return <OneOf name={name} variants={schema.oneOf} value={value} onChange={onChange} title={schema.title} description={schema.description} />
  }
  const t = Array.isArray(schema.type) ? schema.type[0] : schema.type
  if (t === 'object' && schema.properties) {
    return (
      <div style={grp}>
        {schema.title && <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)', marginBottom: 4 }}>{schema.title}</div>}
        {schema.description && <div style={{ fontSize: 11, color: 'var(--text4)', marginBottom: 10 }}>{schema.description.slice(0, 120)}</div>}
        <ObjectFields schema={schema} value={(value as Record<string, unknown>) || {}} onChange={onChange as (v: Record<string, unknown>) => void} />
      </div>
    )
  }
  if (t === 'array') {
    return <ArrayField name={name} schema={schema} value={(value as unknown[]) || []} onChange={onChange as (v: unknown[]) => void} />
  }
  return <Leaf name={name} schema={schema} value={value} required={required} onChange={onChange} />
}

export function ObjectFields({ schema, value, onChange }: {
  schema: Schema; value: Record<string, unknown>; onChange: (v: Record<string, unknown>) => void
}) {
  const props = schema.properties || {}
  const required = schema.required || []
  const keys = Object.keys(props).sort((a, b) => (props[a].order ?? 999) - (props[b].order ?? 999))
  return (
    <>
      {keys.map(key => (
        <SpecField
          key={key}
          name={key}
          schema={props[key]}
          required={required.includes(key)}
          value={value[key]}
          onChange={v => onChange({ ...value, [key]: v })}
        />
      ))}
    </>
  )
}

function OneOf({ name, variants, value, onChange, title, description }: {
  name: string; variants: Schema[]; value: unknown; onChange: (v: unknown) => void; title?: string; description?: string
}) {
  const discriminator = (() => {
    const props0 = variants[0]?.properties || {}
    return Object.keys(props0).find(k => variants.every(v => v.properties?.[k]?.const !== undefined)) || Object.keys(props0)[0]
  })()

  const cur = (value as Record<string, unknown>) || {}
  let selectedIdx = variants.findIndex(v => discriminator != null && v.properties?.[discriminator]?.const === cur[discriminator])
  if (selectedIdx < 0) selectedIdx = 0

  const [idx, setIdx] = useState(selectedIdx)
  const variant = variants[idx]

  const labelFor = (v: Schema, i: number) =>
    v.title || String((discriminator != null && v.properties?.[discriminator]?.const) ?? `Option ${i + 1}`)

  function selectVariant(i: number) {
    setIdx(i)
    const seed: Record<string, unknown> = {}
    const disc = discriminator != null ? variants[i].properties?.[discriminator] : undefined
    if (disc?.const !== undefined && discriminator != null) seed[discriminator] = disc.const
    onChange(seed)
  }

  return (
    <div style={grp}>
      <label style={lbl}>{title || name}</label>
      {description && <div style={{ fontSize: 11, color: 'var(--text4)', marginBottom: 8 }}>{description.slice(0, 120)}</div>}
      <select value={idx} onChange={e => selectVariant(Number(e.target.value))} style={{ ...inp, marginBottom: 12 }}>
        {variants.map((v, i) => <option key={i} value={i}>{labelFor(v, i)}</option>)}
      </select>
      {variant?.properties && (
        <ObjectFields schema={variant} value={cur} onChange={v => onChange(v)} />
      )}
    </div>
  )
}

function ArrayField({ name, schema, value, onChange }: {
  name: string; schema: Schema; value: unknown[]; onChange: (v: unknown[]) => void
}) {
  const item = schema.items || { type: 'string' }
  const isScalar = !(item.type === 'object' || item.oneOf)
  return (
    <div style={grp}>
      <label style={lbl}>{schema.title || name}</label>
      {schema.description && <div style={{ fontSize: 11, color: 'var(--text4)', marginBottom: 8 }}>{schema.description.slice(0, 120)}</div>}
      {value.map((row, i) => (
        <div key={i} style={{ display: 'flex', gap: 6, alignItems: 'flex-start', marginBottom: 8 }}>
          <div style={{ flex: 1 }}>
            {isScalar
              ? <Leaf name={`${name}[${i}]`} schema={item} value={row} required={false} onChange={v => { const n = [...value]; n[i] = v; onChange(n) }} />
              : <SpecField name={`${name}[${i}]`} schema={item} value={row} required={false} onChange={v => { const n = [...value]; n[i] = v; onChange(n) }} />}
          </div>
          <button type="button" onClick={() => onChange(value.filter((_, j) => j !== i))}
            style={{ marginTop: 2, width: 28, height: 34, borderRadius: 8, border: '1px solid var(--border2)', background: 'var(--bg)', cursor: 'pointer', color: 'var(--text3)' }}>×</button>
        </div>
      ))}
      <button type="button" onClick={() => onChange([...value, isScalar ? '' : {}])}
        style={{ fontSize: 12, padding: '6px 12px', borderRadius: 8, border: '1px dashed var(--border2)', background: 'transparent', cursor: 'pointer', color: 'var(--text2)' }}>+ Add</button>
    </div>
  )
}

/** Seed a config object from a schema's defaults + const discriminators. */
export function seedConfig(schema: Schema): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  const props = schema.properties || {}
  for (const [k, s] of Object.entries(props)) {
    if (s.const !== undefined) out[k] = s.const
    else if (s.default !== undefined) out[k] = s.default
    else if (s.oneOf?.length) {
      const v0 = s.oneOf[0]
      const disc = Object.keys(v0.properties || {}).find(dk => v0.properties?.[dk]?.const !== undefined)
      if (disc) out[k] = { [disc]: v0.properties![disc].const }
    }
  }
  return out
}
