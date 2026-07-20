// -- /api/integrations/scheduler ------------------------------
// Called every minute by the built-in scheduler in lib/setup.ts (self-hosted),
// or by any external scheduler presenting the bearer secret.
// Checks all active rules whose next_run_at has passed,
// executes them, sends notifications, updates run timestamps.

import { getDb, nowExpr } from '@/lib/db'
import { log } from '@/lib/logger'
import { runTool }         from '@/lib/tools'
import { ensureCronSecret } from '@/lib/keys'
import { sendNotification, sendReportEmail, renderTemplate } from '@/lib/notify'
import { runReport }       from '@/lib/report-runner'
export const runtime = 'nodejs'

export async function POST(req: Request) {
  // Fail CLOSED. Previously the guard was `if (CRON_SECRET && ...)`, so an
  // unset secret skipped verification entirely — and this route has no session
  // check, meaning any unauthenticated caller could fire every due rule.
  // ensureCronSecret() generates and persists one on first use, so there is no
  // configuration state in which this endpoint is unprotected.
  const authHeader = req.headers.get('authorization')
  const cronSecret = await ensureCronSecret()
  if (!cronSecret) {
    return Response.json({ error: 'Scheduler secret unavailable' }, { status: 503 })
  }
  if (authHeader !== `Bearer ${cronSecret}`) {
    return Response.json({ error: 'Unauthorised' }, { status: 401 })
  }

  const sql   = getDb()
  const now   = new Date()
  const fired: string[] = []
  const errors: string[] = []

  // Load all active rules due to run
  const rules = await sql`
    SELECT r.*, c.type AS channel_type, c.config AS channel_config, c.name AS channel_name
    FROM   integration_rules r
    JOIN   integration_channels c ON c.id = r.channel_id
    WHERE  r.active = true
    AND    c.active = true
    AND    (r.next_run_at IS NULL OR r.next_run_at <= ${now.toISOString()})`

  for (const rule of rules) {
    const r = rule as Record<string, unknown>
    const ruleId     = r.id as string
    const startTime  = Date.now()
    let   status     = 'skipped'
    let   messageSent: string | null = null
    let   errorMsg:   string | null = null
    let   valueSnap:  unknown = null

    try {
      const condition = r.condition as Record<string, unknown>
      const channel   = {
        id:     ruleId,
        name:   r.channel_name as string,
        type:   r.channel_type as string,
        config: r.channel_config as Record<string, unknown>,
      }

      // -- THRESHOLD rule --------------------------------------
      if (r.trigger_type === 'threshold') {
        const queryStr = r.query as string
        const srcType  = r.source_type as string
        const srcId    = r.source_id as string

        if (!queryStr || !srcId) { status = 'skipped'; }
        else {
          // Run the query via the same tool infrastructure as chat
          let data: unknown
          if (srcType === 'database') {
            data = await runTool('query_database', { connection_id: srcId, sql: queryStr })
          } else if (srcType === 'api') {
            data = await runTool('call_api', { connection_id: srcId, method: 'GET', path: queryStr })
          } else if (srcType === 'file_server') {
            data = await runTool('read_file_server', { server_id: srcId, file_hint: queryStr })
          }

          // Extract the value from the result
          const rows = (data as Record<string,unknown>)?.rows as Record<string,unknown>[] | undefined
          const firstRow = rows?.[0]
          const valueCol = condition.column as string
          const rawValue = firstRow ? Number(firstRow[valueCol] ?? firstRow[Object.keys(firstRow)[0]]) : null

          valueSnap = { value: rawValue, column: valueCol, rows_returned: rows?.length ?? 0 }

          // Check threshold condition
          const op  = condition.operator as string || '<'
          const thr = Number(condition.value)
          const triggered =
            op === '<'  ? (rawValue !== null && rawValue < thr)  :
            op === '<=' ? (rawValue !== null && rawValue <= thr) :
            op === '>'  ? (rawValue !== null && rawValue > thr)  :
            op === '>=' ? (rawValue !== null && rawValue >= thr) :
            op === '==' ? (rawValue !== null && rawValue === thr) : false

          if (triggered) {
            messageSent = renderTemplate(r.message_template as string || '{source} value is {value}', {
              value:     rawValue ?? 'N/A',
              threshold: thr,
              source:    r.name as string,
              column:    valueCol,
              date:      now.toLocaleDateString(),
              time:      now.toLocaleTimeString(),
            })
            const result = await sendNotification(channel, messageSent)
            status   = result.ok ? 'sent' : 'error'
            errorMsg = result.error ?? null
          } else {
            status = 'skipped' // condition not met -- no notification
          }
        }
      }

      // -- SCHEDULE rule ---------------------------------------
      else if (r.trigger_type === 'schedule') {
        const queryStr = r.query as string
        const srcType  = r.source_type as string
        const srcId    = r.source_id as string

        let data: unknown
        if (srcType === 'database' && srcId && queryStr) {
          data = await runTool('query_database', { connection_id: srcId, sql: queryStr })
        } else if (srcType === 'api' && srcId && queryStr) {
          data = await runTool('call_api', { connection_id: srcId, method: 'GET', path: queryStr })
        }

        const rows = (data as Record<string,unknown>)?.rows as Record<string,unknown>[] | undefined
        valueSnap  = { rows_returned: rows?.length ?? 0 }

        // Format result as a simple text table
        let tableText = ''
        if (rows?.length) {
          const keys  = Object.keys(rows[0])
          const header = keys.join(' | ')
          const sep    = keys.map(k => '-'.repeat(Math.max(k.length, 8))).join('-+-')
          const body   = rows.slice(0, 20).map(row => keys.map(k => String(row[k] ?? '')).join(' | ')).join('\n')
          tableText    = `\n${header}\n${sep}\n${body}${rows.length > 20 ? `\n...and ${rows.length - 20} more rows` : ''}`
        }

        messageSent = renderTemplate(r.message_template as string || 'Scheduled report: {name}\n{table}', {
          name:  r.name as string,
          date:  now.toLocaleDateString(),
          time:  now.toLocaleTimeString(),
          rows:  String(rows?.length ?? 0),
          table: tableText,
        })

        const result = await sendNotification(channel, messageSent)
        status   = result.ok ? 'sent' : 'error'
        errorMsg = result.error ?? null
      }

      // -- RCA COMPLETE rule -----------------------------------
      else if (r.trigger_type === 'rca_complete') {
        // Find RCA sessions completed since last run
        const since = (r.last_run_at as string) || new Date(0).toISOString()
        const sessions = await sql`
          SELECT m.id, m.content, m.rca_block, m.created_at, c.title
          FROM   messages m
          JOIN   conversations c ON c.id = m.conversation_id
          WHERE  m.role = 'assistant'
          AND    m.rca_block IS NOT NULL
          AND    m.created_at > ${since}
          ORDER  BY m.created_at DESC
          LIMIT  5`

        if (sessions.length > 0) {
          const s   = sessions[0] as Record<string, unknown>
          valueSnap = { rca_sessions_found: sessions.length }
          messageSent = renderTemplate(r.message_template as string ||
            'RCA completed: {title}\n{summary}', {
            title:    s.title as string,
            summary:  (s.content as string)?.slice(0, 500) ?? '',
            count:    String(sessions.length),
            date:     now.toLocaleDateString(),
            time:     now.toLocaleTimeString(),
          })
          const result = await sendNotification(channel, messageSent)
          status   = result.ok ? 'sent' : 'error'
          errorMsg = result.error ?? null
        } else {
          status = 'skipped'
        }
      }

    } catch (err) {
      status   = 'error'
      errorMsg = err instanceof Error ? err.message : 'Unknown error'
      errors.push(`${ruleId}: ${errorMsg}`)
    }

    // -- Log the run ---------------------------------------------
    const latency = Date.now() - startTime
    await sql`
      INSERT INTO integration_runs (rule_id, status, value_snapshot, message_sent, error, latency_ms)
      VALUES (${ruleId}, ${status}, ${JSON.stringify(valueSnap)}, ${messageSent}, ${errorMsg}, ${latency})`
    .catch(() => {})

    // -- Update rule timestamps ----------------------------------
    const condition    = r.condition as Record<string, unknown>
    const intervalSec  = Number(condition?.interval_sec || 300)
    const nextRun      = r.trigger_type === 'schedule'
      ? new Date(Date.now() + intervalSec * 1000).toISOString()
      : new Date(Date.now() + 60_000).toISOString() // threshold/rca: recheck in 1 min

    await sql`
      UPDATE integration_rules
      SET last_run_at = ${now.toISOString()}, next_run_at = ${nextRun}
      WHERE id = ${ruleId}`
    .catch(() => {})

    if (status === 'sent') fired.push(ruleId)
  }

  // ============================================================
  // RULE GROUPS evaluation (new Rules module)
  // ============================================================

  const groups = await sql`
    SELECT * FROM rule_groups
    WHERE  active = true`

  for (const grp of groups) {
    const g          = grp as Record<string, unknown>
    const groupId    = g.id as string
    const trigger    = g.trigger    as Record<string, unknown>
    const conditions = g.conditions as Record<string, unknown>[]
    const controls   = g.controls   as Record<string, unknown>
    const actions    = g.actions    as Record<string, unknown>[]
    const recipients = g.recipients as Record<string, unknown>[]
    const logic      = (g.logic as string) || 'OR'
    const startTime  = Date.now()

    try {
      // -- 1. Check trigger timing -------------------------------
      const triggerType   = trigger.type as string
      const intervalSec   = Number(trigger.interval_sec || 300)
      const lastFiredAt   = g.last_fired_at as string | null
      const cooldownSec   = Number(controls.cooldown_sec || 0)

      if (triggerType === 'schedule') {
        const nextRun = lastFiredAt
          ? new Date(new Date(lastFiredAt).getTime() + intervalSec * 1000)
          : new Date(0)
        if (now < nextRun) continue  // Not due yet
      }

      // -- 2. Cooldown check -------------------------------------
      if (cooldownSec > 0 && lastFiredAt) {
        const elapsed = (now.getTime() - new Date(lastFiredAt).getTime()) / 1000
        if (elapsed < cooldownSec) continue
      }

      // -- 3. Active hours check ---------------------------------
      const activeHours = (controls.active_hours as string) || '00:00-23:59'
      const [startHHMM, endHHMM] = activeHours.split('-')
      if (startHHMM && endHHMM) {
        const [sh, sm] = startHHMM.split(':').map(Number)
        const [eh, em] = endHHMM.split(':').map(Number)
        const nowMins  = now.getHours() * 60 + now.getMinutes()
        const startMin = (sh || 0) * 60 + (sm || 0)
        const endMin   = (eh || 23) * 60 + (em || 59)
        if (nowMins < startMin || nowMins > endMin) continue
      }

      // -- 4. Max fires per day check ----------------------------
      const maxPerDay       = Number(controls.max_per_day || 99)
      const fireCountToday  = Number(g.fire_count_today || 0)
      if (fireCountToday >= maxPerDay) continue

      // -- 5. Evaluate conditions --------------------------------
      // Skip condition evaluation for rca_complete and manual triggers
      let shouldFire  = triggerType === 'rca_complete' || triggerType === 'manual'
      const triggeredConditions: string[] = []
      const conditionValues: Record<string, unknown> = {}

      if (!shouldFire && conditions.length > 0) {
        // Evaluate each condition and track its result
        const results: boolean[] = []

        for (const cond of conditions) {
          const srcType = cond.source_type as string || 'database'
          const srcId   = cond.source_id   as string
          const field   = cond.field       as string
          const op      = cond.op          as string || '<'
          const thr     = Number(cond.value)

          if (!srcId || !field) { log.info({ service: 'integrations-scheduler', data: { srcId, field } }, '[rulegroup] skip: no srcId or field'); results.push(false); continue }

          try {
            let data: unknown
            if (srcType === 'database') {
              // Use the condition's own query if configured; fall back to a simple avg query
              const condQuery = (cond.query as string | undefined)?.trim()
              const sql = condQuery || `SELECT avg(${field}) as ${field} FROM ${field}`
              data = await runTool('query_database', { connection_id: srcId, sql })
            } else if (srcType === 'api') {
              const condPath = (cond.query as string | undefined)?.trim() || `/${field}`
              data = await runTool('call_api', { connection_id: srcId, method: 'GET', path: condPath })
            }

            const rows     = (data as Record<string, unknown>)?.rows as Record<string, unknown>[] | undefined
            const firstRow = rows?.[0]
            const rawValue = firstRow ? Number(firstRow[field] ?? firstRow[Object.keys(firstRow)[0]]) : null

            conditionValues[field] = rawValue

            const met =
              op === '<'  ? (rawValue !== null && rawValue <  thr) :
              op === '<=' ? (rawValue !== null && rawValue <= thr) :
              op === '>'  ? (rawValue !== null && rawValue >  thr) :
              op === '>=' ? (rawValue !== null && rawValue >= thr) :
              op === '==' ? (rawValue !== null && rawValue === thr) :
              op === '!=' ? (rawValue !== null && rawValue !== thr) : false

            results.push(met)
            if (met) triggeredConditions.push(`${field} ${op} ${thr} (was ${rawValue})`)
          } catch {
            results.push(false)
          }
        }

        // Apply per-condition logic (each condition has its own AND/OR connector)
        // First condition always counts; subsequent ones use their `logic` field
        if (results.length > 0) {
          let combined = results[0]
          for (let i = 1; i < results.length; i++) {
            const condLogic = (conditions[i].logic as string) || 'AND'
            if (condLogic === 'OR')  combined = combined || results[i]
            else                     combined = combined && results[i]
          }
          shouldFire = combined
        }
      } else if (!shouldFire && conditions.length === 0) {
        // No conditions = always fire on trigger
        shouldFire = triggerType === 'schedule'
      }

      if (!shouldFire) continue

      // -- 6. Consecutive breach check ---------------------------
      const consecutive = Number(controls.consecutive || 1)
      if (consecutive > 1) {
        // Check run log for consecutive fires
        const recentRuns = await sql`
          SELECT status FROM integration_runs
          WHERE  rule_id = ${groupId}
          ORDER  BY triggered_at DESC
          LIMIT  ${consecutive - 1}`
        const priorFired = (recentRuns as Record<string,unknown>[]).every(r => r.status === 'sent')
        if (!priorFired) {
          // Log this as a pending breach and skip actual notification
          await sql`
            INSERT INTO integration_runs (rule_id, status, message_sent, latency_ms)
            VALUES (${groupId}, 'consecutive_pending', 'Breach detected, waiting for consecutive count', 0)`
          .catch(() => {})
          continue
        }
      }

      // -- 7. Build template variables ---------------------------
      const firstTriggered = triggeredConditions[0] || ''
      const firstValue     = Object.values(conditionValues)[0] ?? 'N/A'
      const firstThreshold = conditions[0] ? String(conditions[0].value) : 'N/A'

      const templateVars = {
        group_name:           g.name as string,
        triggered_conditions: triggeredConditions.join(', ') || 'trigger condition met',
        value:                String(firstValue),
        threshold:            firstThreshold,
        date:                 now.toLocaleDateString(),
        time:                 now.toLocaleTimeString(),
        user:                 'system',
        rca_title:            '',
        rca_summary:          '',
      }

      // -- 8. Dispatch all actions in order ----------------------
      for (const action of actions) {
        const actionType = action.type as string
        const actionRecipients = (action.recipients as Record<string,unknown>[]) || recipients

        try {
          // -- Notify action --------------------------------------
          if (actionType === 'notify') {
            const channelId = action.channel_id as string
            if (!channelId) continue

            const [chanRow] = await sql`
              SELECT * FROM integration_channels WHERE id = ${channelId} AND active = true`
            if (!chanRow) continue

            const ch     = chanRow as Record<string, unknown>
            const chConfigRaw = ch.config
            const chConfig: Record<string, unknown> = typeof chConfigRaw === 'string'
              ? (() => { try { return JSON.parse(chConfigRaw) } catch { return {} } })()
              : (chConfigRaw as Record<string, unknown>) || {}
            const channel: import('@/lib/notify').Channel = {
              id:     ch.id     as string,
              name:   ch.name   as string,
              type:   ch.type   as string,
              config: chConfig,
            }

            const msgTemplate = (action.message_template as string) || (g.message_template as string) || '{{group_name}}: {{triggered_conditions}}'
            const message = renderTemplate(
              msgTemplate.replace(/\{\{(\w+)\}\}/g, '{$1}'),
              templateVars
            )

            const result = await sendNotification(channel, message)

            await sql`
              INSERT INTO integration_runs (rule_id, status, message_sent, error, latency_ms)
              VALUES (${groupId}, ${result.ok ? 'sent' : 'error'}, ${message}, ${result.error ?? null}, ${Date.now() - startTime})`
            .catch(() => {})

            if (result.ok) fired.push(`${groupId}:${actionType}`)
            else errors.push(`${groupId}/${channelId}: ${result.error}`)

            // -- Dispatch to notification group members ----------
            const emailChId = (g.email_channel_id as string | null) ?? null
            const smsChId   = (g.sms_channel_id   as string | null) ?? null
            // Use group-level recipients (not action-level) for group dispatch
            const groupRecipients = recipients.filter(r => r.type === 'group')
            for (const grpRef of groupRecipients) {
              const grpId = grpRef.group_id as string
              if (!grpId) continue
              const [grpRow] = await sql`SELECT members FROM notification_groups WHERE id = ${grpId}`
              if (!grpRow) continue
              const members: Record<string, unknown>[] = typeof grpRow.members === 'string'
                ? (() => { try { return JSON.parse(grpRow.members as string) } catch { return [] } })()
                : (grpRow.members as Record<string, unknown>[]) || []
              for (const member of members) {
                const mtype = member.type as string
                let mChId: string | null = null
                if (mtype === 'email') mChId = emailChId
                else if (mtype === 'phone') mChId = smsChId
                if (!mChId) continue
                const [mChanRow] = await sql`SELECT * FROM integration_channels WHERE id = ${mChId} AND active = true`
                if (!mChanRow) continue
                const mCh = mChanRow as Record<string, unknown>
                const mChConfig: Record<string, unknown> = typeof mCh.config === 'string'
                  ? (() => { try { return JSON.parse(mCh.config as string) } catch { return {} } })()
                  : (mCh.config as Record<string, unknown>) || {}
                const mChannel: import('@/lib/notify').Channel = {
                  id: mCh.id as string, name: mCh.name as string,
                  type: mCh.type as string, config: mChConfig,
                }
                // Override recipients field for SMS/email with individual member address
                if (mtype === 'email' && member.address) mChannel.config = { ...mChConfig, recipients: [member.address] }
                if (mtype === 'phone'  && member.number)  mChannel.config = { ...mChConfig, to_number: member.number }
                const mResult = await sendNotification(mChannel, message)
                if (!mResult.ok) errors.push(`${groupId}/group-member: ${mResult.error}`)
              }
            }
          }

          // -- API call action ------------------------------------
          else if (actionType === 'api_call') {
            const serviceId = action.service_id as string
            const path      = action.path       as string || '/'
            const payloadTpl = action.payload_template as string || '{}'

            const payload = renderTemplate(
              payloadTpl.replace(/\{\{(\w+)\}\}/g, '{$1}'),
              templateVars
            )

            try {
              JSON.parse(payload) // validate
              await runTool('call_api', {
                connection_id: serviceId,
                method: 'POST',
                path,
                body: JSON.parse(payload),
              })
              fired.push(`${groupId}:api_call`)
            } catch (e) {
              errors.push(`${groupId}/api_call: ${e}`)
            }
          }

          // -- n8n webhook action --------------------------------
          else if (actionType === 'n8n_webhook') {
            const webhookUrl  = (action.path as string || '').trim()
            const payloadTpl  = (action.payload_template as string) || '{}'

            if (!webhookUrl) {
              errors.push(`${groupId}/n8n_webhook: no webhook URL configured`)
            } else {
              // Render payload template with rule variables
              const renderedPayload = renderTemplate(
                payloadTpl.replace(/{{(\w+)}}/g, '{$1}'),
                templateVars
              )

              let body: Record<string, unknown>
              try {
                body = JSON.parse(renderedPayload)
              } catch {
                // If template produces invalid JSON, wrap as plain message
                body = { message: renderedPayload }
              }

              // Enrich with standard Mosaic context fields
              const enrichedBody = {
                ...body,
                _mosaic: {
                  rule_id:    groupId,
                  rule_name:  g.name as string,
                  fired_at:   now.toISOString(),
                  conditions: templateVars.triggered_conditions || '',
                  value:      templateVars.value ?? null,
                }
              }

              try {
                const res = await fetch(webhookUrl, {
                  method:  'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body:    JSON.stringify(enrichedBody),
                  signal:  AbortSignal.timeout(10000),
                })

                const ok = res.ok || res.status < 400
                await sql`
                  INSERT INTO integration_runs (rule_id, status, message_sent, error, latency_ms)
                  VALUES (${groupId}, ${ok ? 'sent' : 'error'}, ${JSON.stringify(enrichedBody)}, ${ok ? null : 'HTTP ' + String(res.status)}, ${Date.now() - startTime})`

                if (ok) fired.push(`${groupId}:n8n_webhook`)
                else    errors.push(`${groupId}/n8n_webhook: HTTP ${res.status}`)
              } catch (e) {
                errors.push(`${groupId}/n8n_webhook: ${(e as Error).message}`)
              }
            }
          }

          // -- Start RCA action -----------------------------------
          else if (actionType === 'rca') {
            const contextTpl = (action.rca_context as string) || 'Automated trigger: {{group_name}} -- {{triggered_conditions}}'
            const context    = renderTemplate(
              contextTpl.replace(/\{\{(\w+)\}\}/g, '{$1}'),
              templateVars
            )

            // Create a new conversation pre-seeded with the RCA context
            await sql`
              INSERT INTO conversations (title, system_prompt, created_by)
              VALUES (
                ${'Auto RCA: ' + (g.name as string)},
                ${'You are performing root cause analysis. Context: ' + context},
                ${'system'}
              )`
            fired.push(`${groupId}:rca`)
          }

          // -- Run query action -----------------------------------
          else if (actionType === 'query') {
            const srcId   = action.query_source_id as string
            const query   = action.query           as string
            const onComplete = action.query_on_complete as string || 'discard'

            if (srcId && query) {
              const qResult = await runTool('query_database', { connection_id: srcId, sql: query })

              if (onComplete === 'log') {
                await sql`
                  INSERT INTO integration_runs (rule_id, status, message_sent, latency_ms)
                  VALUES (${groupId}, 'query_result', ${JSON.stringify((qResult as Record<string,unknown>)?.rows)}, ${Date.now() - startTime})`
                .catch(() => {})
              }
              fired.push(`${groupId}:query`)
            }
          }
        } catch (actionErr) {
          errors.push(`${groupId}/${actionType}: ${actionErr instanceof Error ? actionErr.message : 'Unknown'}`)
        }
      } // end actions loop

      // -- 9. Update group fire timestamp ------------------------
      await sql`
        UPDATE rule_groups
        SET last_fired_at    = ${now.toISOString()},
            fire_count_today = fire_count_today + 1,
            updated_at       = ${nowExpr()}
        WHERE id = ${groupId}`
      .catch(() => {})

    } catch (grpErr) {
      errors.push(`group ${groupId}: ${grpErr instanceof Error ? grpErr.message : 'Unknown'}`)
    }
  } // end groups loop


  // ============================================================
  // SCHEDULED REPORT TEMPLATES
  // ============================================================

  const reportTemplates = await sql`
    SELECT * FROM report_templates
    WHERE active = true
    AND   schedule IS NOT NULL
    AND   schedule != ''`

  let reportsRun = 0
  const reportErrors: string[] = []

  for (const tmpl of reportTemplates) {
    const t = tmpl as Record<string, unknown>
    const templateId = t.id as string
    const schedule   = t.schedule as string
    // Recipients stored as RecipientEntry objects or legacy plain strings
    const recipientRaw: unknown[] = (() => {
      try { return JSON.parse(String(t.recipients || '[]')) } catch { return [] }
    })()
    const recipients: string[] = recipientRaw.flatMap(r => {
      if (typeof r === 'string') return [r]
      const entry = r as Record<string, unknown>
      if (entry.type === 'email' && typeof entry.label === 'string') return [entry.label]
      // group recipients — resolve members at send time (for now, skip groups in scheduler)
      return []
    }).filter(Boolean)

    try {
      // Parse cron expression and check if due
      const { CronExpressionParser } = await import('cron-parser')
      const interval = CronExpressionParser.parse(schedule, { currentDate: now })
      const prev     = interval.prev().toDate()
      const lastRun  = t.last_scheduled_run as string | null

      // Due if: never run OR last run was before the most recent cron tick
      const isDue = !lastRun || new Date(lastRun) < prev

      if (!isDue) continue

      // Generate the report
      const result = await runReport(templateId, null, 'scheduled')

      if (result.ok) {
        reportsRun++

        // Update last_scheduled_run
        await sql`
          UPDATE report_templates
          SET last_scheduled_run = ${now.toISOString()}
          WHERE id = ${templateId}`

        // Email PDF to recipients if any
        if (recipients.length > 0 && result.pdf_buffer) {
          const subject = `Mosaic Report: ${String(t.name)} — ${now.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}`
          const body    = `Your scheduled report "${String(t.name)}" has been generated.\n\nGenerated: ${now.toLocaleString()}\nSections: ${result.sections_rendered || 0}\n\nPlease find the full report attached as a PDF.`
          const emailResult = await sendReportEmail({
            recipients,
            subject,
            body,
            pdfBuffer: result.pdf_buffer,
            pdfName:   `${String(t.name).replace(/[^a-z0-9]/gi, '_')}_${now.toISOString().slice(0,10)}.pdf`,
          })
          if (!emailResult.ok) {
            reportErrors.push(`${templateId} email: ${emailResult.error}`)
          }
        }
      } else {
        reportErrors.push(`${templateId}: ${result.error}`)
      }
    } catch (e) {
      reportErrors.push(`${templateId}: ${(e as Error).message}`)
    }
  }

  // ============================================================
  // NIGHTLY DATA RETENTION PURGE
  // Run once per day — only if last purge was > 20 hours ago
  // ============================================================
  let retentionPurged = 0
  try {
    const { runDataRetentionPurge } = await import('@/lib/data-retention')
    const retResults = await runDataRetentionPurge()
    retentionPurged = retResults.reduce((s, r) => s + r.purged, 0)
  } catch { /* non-blocking — never fail the scheduler */ }

  return Response.json({
    ok:              true,
    rules_checked:   rules.length,
    groups_checked:  groups.length,
    reports_run:     reportsRun,
    retention_purged: retentionPurged,
    fired:           fired.length,
    errors:          errors.length,
    fired_ids:       fired,
    error_details:   [...errors, ...reportErrors],
    ran_at:          now.toISOString(),
  })
}

// Also allow GET for manual trigger during development
export async function GET(req: Request) {
  return POST(req)
}
