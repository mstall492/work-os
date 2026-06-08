import React, { useEffect, useMemo, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { supabase } from './supabase'
import './styles.css'

const ORGS = ['Penn State', 'TruStage', 'WEX', 'HCB', 'Personal']
const PRIORITIES = ['🔴 Critical', '🟠 High', '🟡 Medium', '🟢 Low']
const STATUSES = ['New', 'Meeting', 'In Progress', 'Waiting', 'Blocked', 'Done']
const FOLLOWUP_STATUSES = ['Need to Send', 'Waiting on Others', 'Escalate', 'Closed']
const INITIATIVE_STATUSES = ['Ideas', 'Active', 'Blocked', 'Completed']

// ─── AI Inbox Analyzer ───────────────────────────────────────────────────────

async function aiAnalyzeInbox(text) {
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
  const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY

  const res = await fetch(`${supabaseUrl}/functions/v1/ai-analyzer`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${supabaseKey}`
    },
    body: JSON.stringify({ text })
  })

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }))
    throw new Error(err.error || `Edge function error ${res.status}`)
  }

  const { result, error } = await res.json()
  if (error) throw new Error(error)

  const clean = result.replace(/```json|```/g, '').trim()
  return JSON.parse(clean)
}

// ─── App ─────────────────────────────────────────────────────────────────────

function App() {
  const [session, setSession] = useState(null)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState('dashboard')

  const [tasks, setTasks] = useState([])
  const [initiatives, setInitiatives] = useState([])
  const [followups, setFollowups] = useState([])
  const [logs, setLogs] = useState([])

  const [intake, setIntake] = useState('')
  const [aiPrompt, setAiPrompt] = useState('')
  const [orgFilter, setOrgFilter] = useState('All')

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setLoading(false)
    })
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session)
    })
    return () => subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (session) loadAll()
  }, [session])

  async function signIn() {
    if (!email.trim() || !password.trim()) return
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    alert(error ? error.message : 'Signed in')
  }

  async function loadAll() {
    const [t, i, f, l] = await Promise.all([
      supabase.from('tasks').select('*').order('created_at', { ascending: false }),
      supabase.from('initiatives').select('*').order('created_at', { ascending: false }),
      supabase.from('followups').select('*').order('created_at', { ascending: false }),
      supabase.from('work_log').select('*').order('created_at', { ascending: false }).limit(100)
    ])
    setTasks(t.data || [])
    setInitiatives(i.data || [])
    setFollowups(f.data || [])
    setLogs(l.data || [])
  }

  async function insert(table, row) {
    const { error } = await supabase.from(table).insert({ ...row, user_id: session.user.id })
    if (error) alert(error.message)
    else loadAll()
  }

  // Batch insert — no loadAll per item, one loadAll at the end
  async function insertBatch(rows) {
    const byTable = {}
    for (const { table, row } of rows) {
      if (!byTable[table]) byTable[table] = []
      byTable[table].push({ ...row, user_id: session.user.id })
    }
    for (const [table, items] of Object.entries(byTable)) {
      const { error } = await supabase.from(table).insert(items)
      if (error) { alert(`Error inserting into ${table}: ${error.message}`); return }
    }
    await loadAll()
  }

  async function update(table, id, patch) {
    const { error } = await supabase.from(table).update(patch).eq('id', id)
    if (error) alert(error.message)
    else loadAll()
  }

  async function remove(table, id) {
    const { error } = await supabase.from(table).delete().eq('id', id)
    if (error) alert(error.message)
    else loadAll()
  }

  async function analyzeInbox() {
    if (!intake.trim()) return alert('Paste something into the inbox first.')
    return intake  // returned so the Inbox component can drive loading state
  }

  function generatePlanningPrompt() {
    const prompt = `You are my personal work chief of staff. Organize my work across Penn State, TruStage, WEX, HCB and Personal.

RAW INBOX / CALENDAR NOTES:
${intake || '(none)'}

OPEN TASKS:
${tasks.filter(t => !t.done).map(t => `- [${t.org}] ${t.priority || ''} ${t.title} | status=${t.status || ''} | due=${t.due_date || ''} | next=${t.next_action || ''} | waiting=${t.waiting_on || ''} | workfront_needed=${t.workfront_needed || false} | added_to_workfront=${t.added_to_workfront || false}`).join('\n') || '(none)'}

INITIATIVES:
${initiatives.map(i => `- [${i.org}] ${i.title} | status=${i.status || ''} | goal=${i.goal || ''} | next=${i.next_action || ''} | waiting=${i.waiting_on || ''}`).join('\n') || '(none)'}

FOLLOW-UPS:
${followups.filter(f => f.status !== 'Closed' && f.status !== 'Done').map(f => `- [${f.org}] ${f.title} | due=${f.due_date || ''} | status=${f.status || ''}`).join('\n') || '(none)'}

RECENT WORK LOG:
${logs.slice(0, 20).map(l => `- [${new Date(l.created_at).toLocaleString()}] [${l.org}] ${l.text}`).join('\n') || '(none)'}

Please return:
1. Today's must-do priorities
2. Meetings/follow-ups I should prepare for
3. What is waiting on someone else
4. What should become a Workfront request
5. Suggested focus blocks
6. Any risks or conflicts.`

    setAiPrompt(prompt)
    navigator.clipboard?.writeText(prompt)
  }

  const counts = useMemo(() => ({
    tasks: tasks.filter(t => !t.done && t.status !== 'Done').length,
    initiatives: initiatives.filter(i => !['Completed', 'Done'].includes(i.status)).length,
    followups: followups.filter(f => !['Closed', 'Done'].includes(f.status)).length
  }), [tasks, initiatives, followups])

  const filteredTasks = orgFilter === 'All' ? tasks : tasks.filter(t => t.org === orgFilter)
  const filteredInitiatives = orgFilter === 'All' ? initiatives : initiatives.filter(i => i.org === orgFilter)
  const filteredFollowups = orgFilter === 'All' ? followups : followups.filter(f => f.org === orgFilter)
  const filteredLogs = orgFilter === 'All' ? logs : logs.filter(l => l.org === orgFilter)

  if (loading) return <Shell><p>Loading…</p></Shell>

  if (!session) {
    return (
      <Shell>
        <div className="login">
          <h1>Work OS</h1>
          <p>Sign in with email and password.</p>
          <input placeholder="Email" value={email} onChange={e => setEmail(e.target.value)} />
          <input type="password" placeholder="Password" value={password} onChange={e => setPassword(e.target.value)} />
          <button onClick={signIn}>Sign In</button>
        </div>
      </Shell>
    )
  }

  return (
    <Shell>
      <header className="top">
        <div>
          <h1>Work OS</h1>
          <p>{session.user.email}</p>
        </div>
        <button className="ghost" onClick={() => supabase.auth.signOut()}>Sign out</button>
      </header>

      <nav>
        {[
          ['dashboard', 'Dashboard'],
          ['inbox', 'Inbox'],
          ['tasks', `Tasks ${counts.tasks}`],
          ['initiatives', `Initiatives ${counts.initiatives}`],
          ['followups', `Follow-ups ${counts.followups}`],
          ['log', 'Work Log'],
          ['review', 'AI Review']
        ].map(([k, v]) => (
          <button className={tab === k ? 'active' : ''} onClick={() => setTab(k)} key={k}>{v}</button>
        ))}
      </nav>

      <div className="orgFilter">
        <label>Org:</label>
        <select value={orgFilter} onChange={e => setOrgFilter(e.target.value)}>
          <option>All</option>
          {ORGS.map(o => <option key={o}>{o}</option>)}
        </select>
      </div>

      {tab === 'dashboard' && (
        <Dashboard
          tasks={filteredTasks}
          initiatives={filteredInitiatives}
          followups={filteredFollowups}
          logs={filteredLogs}
          setTab={setTab}
        />
      )}

      {tab === 'inbox' && (
        <Inbox
          intake={intake}
          setIntake={setIntake}
          insertBatch={insertBatch}
          generatePlanningPrompt={generatePlanningPrompt}
          session={session}
        />
      )}

      {tab === 'tasks' && (
        <Tasks
          tasks={filteredTasks}
          initiatives={filteredInitiatives}
          insert={insert}
          update={update}
          remove={remove}
        />
      )}

      {tab === 'initiatives' && (
        <Initiatives
          items={filteredInitiatives}
          insert={insert}
          update={update}
          remove={remove}
        />
      )}

      {tab === 'followups' && (
        <Followups
          items={filteredFollowups}
          initiatives={filteredInitiatives}
          insert={insert}
          update={update}
          remove={remove}
        />
      )}

      {tab === 'log' && (
        <Log logs={filteredLogs} insert={insert} remove={remove} />
      )}

      {tab === 'review' && (
        <section>
          <h2>AI Review Prompt</h2>
          <button onClick={generatePlanningPrompt}>Generate & copy prompt</button>
          <textarea
            className="big"
            value={aiPrompt}
            onChange={e => setAiPrompt(e.target.value)}
            placeholder="Generated prompt will appear here…"
          />
        </section>
      )}
    </Shell>
  )
}

// ─── Inbox with AI analyze ────────────────────────────────────────────────────

function Inbox({ intake, setIntake, insertBatch, generatePlanningPrompt, session }) {
  const [analyzing, setAnalyzing] = useState(false)
  const [preview, setPreview] = useState(null)  // parsed items before confirm
  const [error, setError] = useState(null)

  async function handleAnalyze() {
    if (!intake.trim()) return alert('Paste something into the inbox first.')
    setAnalyzing(true)
    setError(null)
    setPreview(null)
    try {
      const items = await aiAnalyzeInbox(intake)
      setPreview(items)
    } catch (e) {
      setError(`AI analysis failed: ${e.message}. Try again or check your API key.`)
    } finally {
      setAnalyzing(false)
    }
  }

  async function handleConfirm() {
    const rows = preview.map(item => {
      if (item.type === 'task') {
        return {
          table: 'tasks',
          row: {
            title: item.title,
            org: item.org || 'Penn State',
            priority: item.priority || '🟡 Medium',
            status: item.status || 'New',
            next_action: item.next_action || '',
            workfront_needed: false,
            added_to_workfront: false,
            done: false,
            notes: item.notes || ''
          }
        }
      }
      if (item.type === 'followup') {
        return {
          table: 'followups',
          row: {
            title: item.title,
            org: item.org || 'Penn State',
            status: item.status || 'Need to Send',
            notes: item.notes || ''
          }
        }
      }
      // initiative
      return {
        table: 'initiatives',
        row: {
          title: item.title,
          org: item.org || 'Penn State',
          status: item.status || 'Active',
          next_action: item.next_action || 'Define next action',
          notes: item.notes || ''
        }
      }
    })

    await insertBatch(rows)
    setPreview(null)
    setIntake('')
  }

  const typeColor = { task: '#4a9ede', followup: '#ffd166', initiative: '#6fcf97' }
  const typeLabel = { task: 'Task', followup: 'Follow-up', initiative: 'Initiative' }

  return (
    <section>
      <h2>Inbox / Calendar Intake</h2>
      <p>Paste Apple Shortcut calendar output, Teams notes, Clockify notes or rough thoughts here. AI will classify each item.</p>

      <textarea
        className="big"
        value={intake}
        onChange={e => setIntake(e.target.value)}
        placeholder="TruStage: Need to test the Distributed Marketing function and emails.&#10;Follow up with Emily about journey migration sign-off.&#10;Penn State SFMC governance — long-term cleanup roadmap"
      />

      <div style={{ display: 'flex', gap: '10px', marginTop: '12px', flexWrap: 'wrap' }}>
        <button onClick={handleAnalyze} disabled={analyzing}>
          {analyzing ? 'Analyzing with AI…' : '✦ AI Analyze Inbox'}
        </button>
        <button onClick={generatePlanningPrompt} className="ghost">Copy AI planning prompt</button>
      </div>

      {error && <p style={{ color: '#ff6b6b', marginTop: '12px' }}>{error}</p>}

      {preview && (
        <div style={{ marginTop: '20px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
            <h3 style={{ margin: 0 }}>AI found {preview.length} items — review before saving</h3>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button onClick={handleConfirm}>Save all</button>
              <button className="ghost" onClick={() => setPreview(null)}>Cancel</button>
            </div>
          </div>

          <div className="grid">
            {preview.map((item, i) => (
              <article key={i} style={{ borderLeft: `3px solid ${typeColor[item.type] || '#555'}` }}>
                <div className="meta" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <span style={{
                    background: typeColor[item.type] + '22',
                    color: typeColor[item.type],
                    fontSize: '11px',
                    padding: '2px 7px',
                    borderRadius: '4px',
                    fontWeight: 600
                  }}>
                    {typeLabel[item.type]}
                  </span>
                  <span>{item.org}</span>
                  {item.priority && <span>{item.priority}</span>}
                </div>
                <h3 style={{ marginTop: '8px' }}>{item.title}</h3>
                {item.next_action && <p><b>Next:</b> {item.next_action}</p>}
                {item.notes && <p style={{ fontSize: '12px', color: '#666' }}>{item.notes}</p>}

                <div style={{ display: 'flex', gap: '6px', marginTop: '10px', flexWrap: 'wrap' }}>
                  {['task', 'followup', 'initiative'].map(t => (
                    <button
                      key={t}
                      className={item.type === t ? '' : 'ghost'}
                      style={{ fontSize: '12px', padding: '4px 10px' }}
                      onClick={() => {
                        const updated = [...preview]
                        updated[i] = { ...item, type: t }
                        setPreview(updated)
                      }}
                    >
                      {typeLabel[t]}
                    </button>
                  ))}
                  <button
                    className="ghost"
                    style={{ fontSize: '12px', padding: '4px 10px', marginLeft: 'auto' }}
                    onClick={() => setPreview(preview.filter((_, j) => j !== i))}
                  >
                    Remove
                  </button>
                </div>
              </article>
            ))}
          </div>

          <div style={{ marginTop: '16px', display: 'flex', gap: '8px' }}>
            <button onClick={handleConfirm}>Save all {preview.length} items</button>
            <button className="ghost" onClick={() => setPreview(null)}>Cancel</button>
          </div>
        </div>
      )}
    </section>
  )
}

// ─── Shell / Field ────────────────────────────────────────────────────────────

function Shell({ children }) {
  return <main>{children}</main>
}

function Field({ label, children }) {
  return (
    <label>
      <span>{label}</span>
      {children}
    </label>
  )
}

// ─── Tasks ────────────────────────────────────────────────────────────────────

function Tasks({ tasks, initiatives, insert, update, remove }) {
  const [f, setF] = useState({
    title: '', org: 'Penn State', priority: '🟡 Medium', status: 'New',
    due_date: '', next_action: '', waiting_on: '', initiative_id: '',
    workfront_needed: false, added_to_workfront: false, workfront_ref: '',
    notes: '', done: false
  })
  const [saving, setSaving] = useState(false)

  function resetForm() {
    setF(prev => ({
      ...prev, title: '', due_date: '', notes: '', next_action: '',
      waiting_on: '', initiative_id: '', workfront_needed: false,
      added_to_workfront: false, workfront_ref: ''
    }))
  }

  async function handleAdd() {
    if (!f.title) return
    setSaving(true)
    await insert('tasks', { ...f, initiative_id: f.initiative_id || null, due_date: f.due_date || null })
    resetForm()
    setSaving(false)
  }

  return (
    <section>
      <h2>Tasks</h2>
      <div className="form">
        <Field label="Title"><input value={f.title} onChange={e => setF({ ...f, title: e.target.value })} /></Field>
        <Field label="Org">
          <select value={f.org} onChange={e => setF({ ...f, org: e.target.value })}>
            {ORGS.map(o => <option key={o}>{o}</option>)}
          </select>
        </Field>
        <Field label="Priority">
          <select value={f.priority} onChange={e => setF({ ...f, priority: e.target.value })}>
            {PRIORITIES.map(p => <option key={p}>{p}</option>)}
          </select>
        </Field>
        <Field label="Status">
          <select value={f.status} onChange={e => setF({ ...f, status: e.target.value })}>
            {STATUSES.map(s => <option key={s}>{s}</option>)}
          </select>
        </Field>
        <Field label="Due Date"><input type="date" value={f.due_date || ''} onChange={e => setF({ ...f, due_date: e.target.value })} /></Field>
        <Field label="Initiative">
          <select value={f.initiative_id || ''} onChange={e => setF({ ...f, initiative_id: e.target.value })}>
            <option value="">None</option>
            {initiatives.map(i => <option key={i.id} value={i.id}>{i.title}</option>)}
          </select>
        </Field>
        <Field label="Next action"><input value={f.next_action} onChange={e => setF({ ...f, next_action: e.target.value })} /></Field>
        <Field label="Waiting on"><input value={f.waiting_on} onChange={e => setF({ ...f, waiting_on: e.target.value })} /></Field>
        <Field label="Notes"><textarea value={f.notes} onChange={e => setF({ ...f, notes: e.target.value })} /></Field>
        <label className="check">
          <input type="checkbox" checked={f.workfront_needed} onChange={e => setF({ ...f, workfront_needed: e.target.checked })} />
          Workfront needed
        </label>
        <label className="check">
          <input type="checkbox" checked={f.added_to_workfront} onChange={e => setF({ ...f, added_to_workfront: e.target.checked })} />
          Added to Workfront
        </label>
        <Field label="Workfront Ref"><input value={f.workfront_ref} onChange={e => setF({ ...f, workfront_ref: e.target.value })} /></Field>
        <button onClick={handleAdd} disabled={saving}>{saving ? 'Saving…' : 'Add task'}</button>
      </div>
      <KanbanBoard
        rows={tasks} statuses={STATUSES} table="tasks" type="task"
        initiatives={initiatives} update={update} remove={remove}
      />
    </section>
  )
}

// ─── Initiatives ──────────────────────────────────────────────────────────────

function Initiatives({ items, insert, update, remove }) {
  const [f, setF] = useState({
    title: '', org: 'Penn State', status: 'Active', goal: '',
    stakeholders: '', next_action: '', waiting_on: '', notes: ''
  })
  const [saving, setSaving] = useState(false)

  async function handleAdd() {
    if (!f.title) return
    setSaving(true)
    await insert('initiatives', f)
    setF(prev => ({ ...prev, title: '', goal: '', stakeholders: '', next_action: '', waiting_on: '', notes: '' }))
    setSaving(false)
  }

  return (
    <section>
      <h2>Initiatives</h2>
      <div className="form">
        <Field label="Title"><input value={f.title} onChange={e => setF({ ...f, title: e.target.value })} /></Field>
        <Field label="Org">
          <select value={f.org} onChange={e => setF({ ...f, org: e.target.value })}>
            {ORGS.map(o => <option key={o}>{o}</option>)}
          </select>
        </Field>
        <Field label="Status">
          <select value={f.status} onChange={e => setF({ ...f, status: e.target.value })}>
            {INITIATIVE_STATUSES.map(s => <option key={s}>{s}</option>)}
          </select>
        </Field>
        <Field label="Goal"><textarea value={f.goal} onChange={e => setF({ ...f, goal: e.target.value })} /></Field>
        <Field label="Stakeholders"><input value={f.stakeholders} onChange={e => setF({ ...f, stakeholders: e.target.value })} /></Field>
        <Field label="Next action"><input value={f.next_action} onChange={e => setF({ ...f, next_action: e.target.value })} /></Field>
        <Field label="Waiting on"><input value={f.waiting_on} onChange={e => setF({ ...f, waiting_on: e.target.value })} /></Field>
        <Field label="Notes"><textarea value={f.notes} onChange={e => setF({ ...f, notes: e.target.value })} /></Field>
        <button onClick={handleAdd} disabled={saving}>{saving ? 'Saving…' : 'Add initiative'}</button>
      </div>
      <Cards
        rows={items}
        remove={id => remove('initiatives', id)}
        update={(id, p) => update('initiatives', id, p)}
        type="initiative"
      />
    </section>
  )
}

// ─── Followups ────────────────────────────────────────────────────────────────

function Followups({ items, initiatives, insert, update, remove }) {
  const [f, setF] = useState({
    title: '', org: 'Penn State', due_date: '', status: 'Need to Send',
    initiative_id: '', notes: ''
  })
  const [saving, setSaving] = useState(false)

  async function handleAdd() {
    if (!f.title) return
    setSaving(true)
    await insert('followups', { ...f, initiative_id: f.initiative_id || null, due_date: f.due_date || null })
    setF(prev => ({ ...prev, title: '', due_date: '', notes: '', initiative_id: '' }))
    setSaving(false)
  }

  return (
    <section>
      <h2>Follow-ups / Waiting On</h2>
      <div className="form">
        <Field label="Title"><input value={f.title} onChange={e => setF({ ...f, title: e.target.value })} /></Field>
        <Field label="Org">
          <select value={f.org} onChange={e => setF({ ...f, org: e.target.value })}>
            {ORGS.map(o => <option key={o}>{o}</option>)}
          </select>
        </Field>
        <Field label="Due date"><input type="date" value={f.due_date || ''} onChange={e => setF({ ...f, due_date: e.target.value })} /></Field>
        <Field label="Status">
          <select value={f.status} onChange={e => setF({ ...f, status: e.target.value })}>
            {FOLLOWUP_STATUSES.map(s => <option key={s}>{s}</option>)}
          </select>
        </Field>
        <Field label="Initiative">
          <select value={f.initiative_id || ''} onChange={e => setF({ ...f, initiative_id: e.target.value })}>
            <option value="">None</option>
            {initiatives.map(i => <option key={i.id} value={i.id}>{i.title}</option>)}
          </select>
        </Field>
        <Field label="Notes"><textarea value={f.notes} onChange={e => setF({ ...f, notes: e.target.value })} /></Field>
        <button onClick={handleAdd} disabled={saving}>{saving ? 'Saving…' : 'Add follow-up'}</button>
      </div>
      <KanbanBoard
        rows={items} statuses={FOLLOWUP_STATUSES} table="followups" type="followup"
        initiatives={initiatives} update={update} remove={remove}
      />
    </section>
  )
}

// ─── Log ─────────────────────────────────────────────────────────────────────

function Log({ logs, insert, remove }) {
  const [f, setF] = useState({ text: '', org: 'Penn State' })
  const [saving, setSaving] = useState(false)

  async function handleLog() {
    if (!f.text) return
    setSaving(true)
    await insert('work_log', f)
    setF(prev => ({ ...prev, text: '' }))
    setSaving(false)
  }

  return (
    <section>
      <h2>Work Log</h2>
      <div className="inline">
        <input value={f.text} onChange={e => setF({ ...f, text: e.target.value })} placeholder="What did you do?" />
        <select value={f.org} onChange={e => setF({ ...f, org: e.target.value })}>
          {ORGS.map(o => <option key={o}>{o}</option>)}
        </select>
        <button onClick={handleLog} disabled={saving}>{saving ? '…' : 'Log'}</button>
      </div>
      <div className="grid" style={{ marginTop: '16px' }}>
        {logs.map(l => (
          <article key={l.id}>
            <div className="meta">{new Date(l.created_at).toLocaleString()} · {l.org}</div>
            <h3>{l.text}</h3>
            <button className="ghost" onClick={() => remove('work_log', l.id)}>Delete</button>
          </article>
        ))}
      </div>
    </section>
  )
}

// ─── Cards (Initiatives list view) ───────────────────────────────────────────

function Cards({ rows, remove, update, type }) {
  const [editing, setEditing] = useState(null)
  const [draft, setDraft] = useState({})

  function startEdit(r) {
    setEditing(r.id)
    setDraft({ ...r })
  }

  async function commitEdit() {
    const { id: _id, created_at: _ca, user_id: _uid, ...patch } = draft
    await update(editing, patch)
    setEditing(null)
    setDraft({})
  }

  return (
    <div className="grid">
      {rows.map(r => (
        <article key={r.id}>
          {editing === r.id ? (
            <>
              <Field label="Title"><input value={draft.title || ''} onChange={e => setDraft({ ...draft, title: e.target.value })} /></Field>
              <Field label="Org">
                <select value={draft.org || 'Penn State'} onChange={e => setDraft({ ...draft, org: e.target.value })}>
                  {ORGS.map(o => <option key={o}>{o}</option>)}
                </select>
              </Field>
              <Field label="Status">
                <select value={draft.status || 'Active'} onChange={e => setDraft({ ...draft, status: e.target.value })}>
                  {INITIATIVE_STATUSES.map(s => <option key={s}>{s}</option>)}
                </select>
              </Field>
              <Field label="Goal"><textarea value={draft.goal || ''} onChange={e => setDraft({ ...draft, goal: e.target.value })} /></Field>
              <Field label="Stakeholders"><input value={draft.stakeholders || ''} onChange={e => setDraft({ ...draft, stakeholders: e.target.value })} /></Field>
              <Field label="Next action"><input value={draft.next_action || ''} onChange={e => setDraft({ ...draft, next_action: e.target.value })} /></Field>
              <Field label="Waiting on"><input value={draft.waiting_on || ''} onChange={e => setDraft({ ...draft, waiting_on: e.target.value })} /></Field>
              <Field label="Notes"><textarea value={draft.notes || ''} onChange={e => setDraft({ ...draft, notes: e.target.value })} /></Field>
              <button onClick={commitEdit}>Save</button>
            </>
          ) : (
            <>
              <div className="meta">{r.org} · {r.status || ''}</div>
              <h3>{r.title}</h3>
              {r.goal && <p><b>Goal:</b> {r.goal}</p>}
              {r.stakeholders && <p><b>Stakeholders:</b> {r.stakeholders}</p>}
              {r.next_action && <p><b>Next:</b> {r.next_action}</p>}
              {r.waiting_on && <p><b>Waiting on:</b> {r.waiting_on}</p>}
              {r.notes && <p>{r.notes}</p>}
              <div className="actions">
                <button onClick={() => startEdit(r)}>Edit</button>
                <button className="ghost" onClick={() => remove(r.id)}>Delete</button>
              </div>
            </>
          )}
        </article>
      ))}
    </div>
  )
}

// ─── Kanban ───────────────────────────────────────────────────────────────────

function KanbanBoard({ rows, statuses, table, type, initiatives, update, remove }) {
  async function onDrop(e, status) {
    e.preventDefault()
    const id = e.dataTransfer.getData('id')
    if (!id) return
    const patch = { status }
    if (type === 'task') patch.done = status === 'Done'
    await update(table, id, patch)
  }

  return (
    <div className="kanban">
      {statuses.map(status => (
        <div
          className="kanbanCol"
          key={status}
          onDragOver={e => e.preventDefault()}
          onDrop={e => onDrop(e, status)}
        >
          <h3>{status}</h3>
          {rows.filter(r => (r.status || 'New') === status).map(row => (
            <WorkCard
              key={row.id} row={row} table={table} type={type}
              initiatives={initiatives} update={update} remove={remove}
            />
          ))}
        </div>
      ))}
    </div>
  )
}

// ─── WorkCard (with local draft state) ───────────────────────────────────────

function WorkCard({ row, table, type, initiatives, update, remove }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState({})
  const [saving, setSaving] = useState(false)

  function startEdit() {
    setDraft({ ...row })
    setEditing(true)
  }

  async function commitEdit() {
    setSaving(true)
    const { id: _id2, created_at: _ca2, user_id: _uid2, ...patch2 } = draft
    await update(table, row.id, patch2)
    setEditing(false)
    setSaving(false)
  }

  const linkedInitiative = initiatives?.find(i => String(i.id) === String(row.initiative_id))

  return (
    <article draggable onDragStart={e => e.dataTransfer.setData('id', row.id)} className="kanbanCard">
      {editing ? (
        <>
          <Field label="Title">
            <input value={draft.title || ''} onChange={e => setDraft({ ...draft, title: e.target.value })} />
          </Field>
          <Field label="Org">
            <select value={draft.org || 'Penn State'} onChange={e => setDraft({ ...draft, org: e.target.value })}>
              {ORGS.map(o => <option key={o}>{o}</option>)}
            </select>
          </Field>
          <Field label="Status">
            <select value={draft.status || ''} onChange={e => setDraft({ ...draft, status: e.target.value })}>
              {(type === 'followup' ? FOLLOWUP_STATUSES : STATUSES).map(s => <option key={s}>{s}</option>)}
            </select>
          </Field>
          {type === 'task' && (
            <>
              <Field label="Priority">
                <select value={draft.priority || '🟡 Medium'} onChange={e => setDraft({ ...draft, priority: e.target.value })}>
                  {PRIORITIES.map(p => <option key={p}>{p}</option>)}
                </select>
              </Field>
              <Field label="Due date">
                <input type="date" value={draft.due_date || ''} onChange={e => setDraft({ ...draft, due_date: e.target.value || null })} />
              </Field>
              <label className="check">
                <input type="checkbox" checked={draft.workfront_needed || false} onChange={e => setDraft({ ...draft, workfront_needed: e.target.checked })} />
                Workfront needed
              </label>
              <label className="check">
                <input type="checkbox" checked={draft.added_to_workfront || false} onChange={e => setDraft({ ...draft, added_to_workfront: e.target.checked })} />
                Added to Workfront
              </label>
              <Field label="Workfront Ref">
                <input value={draft.workfront_ref || ''} onChange={e => setDraft({ ...draft, workfront_ref: e.target.value })} />
              </Field>
            </>
          )}
          {type === 'followup' && (
            <Field label="Due date">
              <input type="date" value={draft.due_date || ''} onChange={e => setDraft({ ...draft, due_date: e.target.value || null })} />
            </Field>
          )}
          {type !== 'initiative' && initiatives && (
            <Field label="Initiative">
              <select value={draft.initiative_id || ''} onChange={e => setDraft({ ...draft, initiative_id: e.target.value || null })}>
                <option value="">None</option>
                {initiatives.map(i => <option key={i.id} value={i.id}>{i.title}</option>)}
              </select>
            </Field>
          )}
          <Field label="Next action">
            <input value={draft.next_action || ''} onChange={e => setDraft({ ...draft, next_action: e.target.value })} />
          </Field>
          <Field label="Waiting on">
            <input value={draft.waiting_on || ''} onChange={e => setDraft({ ...draft, waiting_on: e.target.value })} />
          </Field>
          <Field label="Notes">
            <textarea value={draft.notes || ''} onChange={e => setDraft({ ...draft, notes: e.target.value })} />
          </Field>
          <div className="actions">
            <button onClick={commitEdit} disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
            <button className="ghost" onClick={() => setEditing(false)}>Cancel</button>
          </div>
        </>
      ) : (
        <>
          <div className="meta">{row.org} · {row.status || ''} {row.priority || ''}</div>
          <h3>{row.title}</h3>
          {linkedInitiative && <p><b>Initiative:</b> {linkedInitiative.title}</p>}
          {row.next_action && <p><b>Next:</b> {row.next_action}</p>}
          {row.waiting_on && <p><b>Waiting on:</b> {row.waiting_on}</p>}
          {row.due_date && <p><b>Due:</b> {row.due_date}</p>}
          {row.workfront_needed && !row.added_to_workfront && <p className="warn">⚠ Workfront needed</p>}
          {row.added_to_workfront && <p className="good">✓ Added to Workfront</p>}
          {row.workfront_ref && <p><b>WF:</b> {row.workfront_ref}</p>}
          {row.notes && <p>{row.notes}</p>}
          <div className="actions">
            <button onClick={startEdit}>Edit</button>
            <button className="ghost" onClick={() => remove(table, row.id)}>Delete</button>
          </div>
        </>
      )}
    </article>
  )
}

// ─── Dashboard ────────────────────────────────────────────────────────────────

function Dashboard({ tasks, initiatives, followups, logs, setTab }) {
  const openTasks = tasks.filter(t => !t.done && t.status !== 'Done')

  const highPriority = openTasks.filter(t =>
    (t.priority || '').includes('Critical') || (t.priority || '').includes('High')
  )

  const waitingTasks = openTasks.filter(t =>
    (t.status || '').toLowerCase().includes('waiting') || t.waiting_on
  )

  const workfrontNeeded = openTasks.filter(t => t.workfront_needed)
  // FIX: only tasks that need Workfront but haven't been added yet
  const workfrontPending = openTasks.filter(t => t.workfront_needed && !t.added_to_workfront)

  const activeInitiatives = initiatives.filter(i => !['Completed', 'Done'].includes(i.status))
  const openFollowups = followups.filter(f => !['Closed', 'Done'].includes(f.status))
  const recentLogs = logs.slice(0, 5)

  return (
    <section>
      <h2>Daily Dashboard</h2>
      <p>Your current command center across Penn State, TruStage, WEX, HCB and Personal.</p>

      <div className="dashGrid">
        <DashBox title="High Priority" count={highPriority.length} onClick={() => setTab('tasks')}>
          {highPriority.slice(0, 5).map(t => (
            <DashItem key={t.id} org={t.org} title={t.title} meta={t.next_action || t.status} />
          ))}
        </DashBox>

        <DashBox title="Waiting On" count={waitingTasks.length + openFollowups.length} onClick={() => setTab('followups')}>
          {[...waitingTasks, ...openFollowups].slice(0, 5).map(t => (
            <DashItem key={`${t.title}-${t.id}`} org={t.org} title={t.title} meta={t.waiting_on || t.status} />
          ))}
        </DashBox>

        <DashBox title="Active Initiatives" count={activeInitiatives.length} onClick={() => setTab('initiatives')}>
          {activeInitiatives.slice(0, 5).map(i => (
            <DashItem key={i.id} org={i.org} title={i.title} meta={i.next_action || i.status} />
          ))}
        </DashBox>

        <DashBox title="Workfront Queue" count={workfrontPending.length} onClick={() => setTab('tasks')}>
          {workfrontPending.slice(0, 5).map(t => (
            <DashItem key={t.id} org={t.org} title={t.title} meta={t.next_action || 'Needs request'} />
          ))}
        </DashBox>

        <DashBox title="Open Tasks" count={openTasks.length} onClick={() => setTab('tasks')}>
          {openTasks.slice(0, 5).map(t => (
            <DashItem key={t.id} org={t.org} title={t.title} meta={t.status} />
          ))}
        </DashBox>

        <DashBox title="Recent Work Log" count={recentLogs.length} onClick={() => setTab('log')}>
          {recentLogs.map(l => (
            <DashItem key={l.id} org={l.org} title={l.text} meta={new Date(l.created_at).toLocaleString()} />
          ))}
        </DashBox>
      </div>
    </section>
  )
}

function DashBox({ title, count, children, onClick }) {
  return (
    <div className="dashBox">
      <div className="dashHead">
        <h3>{title}</h3>
        <button className="ghost" onClick={onClick}>View</button>
      </div>
      <div className="dashCount">{count}</div>
      <div>{children || <p className="empty">Nothing here.</p>}</div>
    </div>
  )
}

function DashItem({ org, title, meta }) {
  return (
    <div className="dashItem">
      <div className="meta">{org}{meta ? ` · ${meta}` : ''}</div>
      <strong>{title}</strong>
    </div>
  )
}

createRoot(document.getElementById('root')).render(<App />)