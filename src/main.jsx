import React, { useEffect, useMemo, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { supabase } from './supabase'
import './styles.css'

const ORGS = ['Penn State', 'TruStage', 'WEX', 'HCB', 'Personal']
const PRIORITIES = ['🔴 Critical', '🟠 High', '🟡 Medium', '🟢 Low']
const STATUSES = ['New', 'Meeting', 'In Progress', 'Waiting', 'Blocked', 'Done']
const FOLLOWUP_STATUSES = ['Need to Send', 'Waiting on Others', 'Escalate', 'Closed']
const INITIATIVE_STATUSES = ['Ideas', 'Active', 'Blocked', 'Completed']

function App(){
  const [session,setSession]=useState(null)
  const [email,setEmail]=useState('')
  const [password, setPassword] = useState('')
  const [loading,setLoading]=useState(true)
  const [tab,setTab]=useState('inbox')
  const [tasks,setTasks]=useState([])
  const [initiatives,setInitiatives]=useState([])
  const [followups,setFollowups]=useState([])
  const [logs,setLogs]=useState([])
  const [intake,setIntake]=useState('')
  const [aiPrompt,setAiPrompt]=useState('')

  useEffect(()=>{
    supabase.auth.getSession().then(({data})=>{setSession(data.session);setLoading(false)})
    const {data:{subscription}}=supabase.auth.onAuthStateChange((_event,session)=>setSession(session))
    return ()=>subscription.unsubscribe()
  },[])

  useEffect(()=>{ if(session) loadAll() },[session])

async function signIn() {
  if (!email.trim() || !password.trim()) return;

  const { error } = await supabase.auth.signInWithPassword({
    email,
    password
  });

  alert(error ? error.message : "Signed in");
}

  async function loadAll(){
    const [t,i,f,l]=await Promise.all([
      supabase.from('tasks').select('*').order('created_at',{ascending:false}),
      supabase.from('initiatives').select('*').order('created_at',{ascending:false}),
      supabase.from('followups').select('*').order('created_at',{ascending:false}),
      supabase.from('work_log').select('*').order('created_at',{ascending:false}).limit(100)
    ])
    setTasks(t.data||[]); setInitiatives(i.data||[]); setFollowups(f.data||[]); setLogs(l.data||[])
  }

  async function insert(table,row){
    const {error}=await supabase.from(table).insert({...row,user_id:session.user.id})
    if(error) alert(error.message); else loadAll()
  }
  async function update(table,id,patch){
    const {error}=await supabase.from(table).update(patch).eq('id',id)
    if(error) alert(error.message); else loadAll()
  }
  async function remove(table,id){
    const {error}=await supabase.from(table).delete().eq('id',id)
    if(error) alert(error.message); else loadAll()
  }

  function generatePlanningPrompt(){
    const prompt = `You are my personal work chief of staff. Organize my work across Penn State, TruStage, WEX, HCB and Personal.\n\nRAW INBOX / CALENDAR NOTES:\n${intake || '(none)'}\n\nOPEN TASKS:\n${tasks.filter(t=>!t.done).map(t=>`- [${t.org}] ${t.priority||''} ${t.title} | status=${t.status||''} | next=${t.next_action||''} | waiting=${t.waiting_on||''}`).join('\n') || '(none)'}\n\nINITIATIVES:\n${initiatives.map(i=>`- [${i.org}] ${i.title} | status=${i.status||''} | goal=${i.goal||''} | next=${i.next_action||''} | waiting=${i.waiting_on||''}`).join('\n') || '(none)'}\n\nFOLLOW-UPS:\n${followups.filter(f=>f.status!=='Done').map(f=>`- [${f.org}] ${f.title} | due=${f.due_date||''} | status=${f.status||''}`).join('\n') || '(none)'}\n\nRECENT WORK LOG:\n${logs.slice(0,20).map(l=>`- [${new Date(l.created_at).toLocaleString()}] [${l.org}] ${l.text}`).join('\n') || '(none)'}\n\nPlease return:\n1. Today's must-do priorities\n2. Meetings/follow-ups I should prepare for\n3. What is waiting on someone else\n4. What should become a Workfront request\n5. Suggested focus blocks\n6. Any risks or conflicts.`
    setAiPrompt(prompt)
    navigator.clipboard?.writeText(prompt)
  }

  async function analyzeInbox() {
  if (!intake.trim()) return alert("Paste something into the inbox first.");

  const lines = intake.split("\n").map(l => l.trim()).filter(Boolean);
  let created = { tasks: 0, followups: 0, initiatives: 0 };

  function guessOrg(text) {
    const t = text.toLowerCase();
    if (t.includes("penn") || t.includes("psu")) return "Penn State";
    if (t.includes("wex")) return "WEX";
    if (t.includes("trustage")) return "TruStage";
    if (t.includes("hcb") || t.includes("highland")) return "HCB";
    return "Penn State";
  }

  for (const line of lines) {
    const org = guessOrg(line);

    const isMeeting = /^\d{1,2}:\d{2}/.test(line) || /\bAM\b|\bPM\b/i.test(line);
    const isFollowup = /follow[- ]?up|waiting on|check with|circle back|touch base|ask /i.test(line);
    const isInitiative = /strategy|governance|implementation|migration|roadmap|operating model|architecture/i.test(line);
    const isTask = /need to|review|update|create|fix|build|document|draft|submit|check/i.test(line);

    if (isFollowup) {
      await insert("followups", { title: line, org, status: "Open" });
      created.followups++;
    } else if (isInitiative && !isTask && !isMeeting) {
      await insert("initiatives", {
        title: line,
        org,
        status: "Active",
        next_action: "Define next action"
      });
      created.initiatives++;
    } else {
      await insert("tasks", {
        title: line,
        org,
        priority: isMeeting ? "🟢 Low" : "🟡 Medium",
        status: isMeeting ? "Meeting" : "New",
        next_action: isMeeting ? "Capture follow-ups" : "Review and prioritize",
        workfront_needed: false,
        done: false
      });
      created.tasks++;
    }
  }

  alert(`Created ${created.tasks} tasks, ${created.followups} follow-ups, and ${created.initiatives} initiatives.`);
  setIntake("");
  await loadAll();
}

  const counts=useMemo(()=>({tasks:tasks.filter(t=>!t.done).length, initiatives:initiatives.length, followups:followups.filter(f=>f.status!=='Done').length}),[tasks,initiatives,followups])

  if(loading) return <Shell><p>Loading…</p></Shell>
  if (!session)
  return (
    <Shell>
      <div className="login">
        <h1>Work OS</h1>
        <p>Sign in with email and password.</p>

        <input
          placeholder="Email"
          value={email}
          onChange={e => setEmail(e.target.value)}
        />

        <input
          type="password"
          placeholder="Password"
          value={password}
          onChange={e => setPassword(e.target.value)}
        />

        <button onClick={signIn}>
          Sign In
        </button>
      </div>
    </Shell>
  );

  return <Shell>
    <header className="top"><div><h1>Work OS</h1><p>{session.user.email}</p></div><button className="ghost" onClick={()=>supabase.auth.signOut()}>Sign out</button></header>
    <nav>{[['inbox','Inbox'],['tasks',`Tasks ${counts.tasks}`],['initiatives',`Initiatives ${counts.initiatives}`],['followups',`Follow-ups ${counts.followups}`],['log','Work Log'],['review','AI Review']].map(([k,v])=><button className={tab===k?'active':''} onClick={()=>setTab(k)} key={k}>{v}</button>)}</nav>

    {tab==='inbox' && (
  <section>
    <h2>Inbox / Calendar Intake</h2>
    <p>Paste Apple Shortcut calendar output, Teams notes, Clockify notes or rough thoughts here.</p>

    <textarea
      className="big"
      value={intake}
      onChange={e => setIntake(e.target.value)}
      placeholder="10:00 AM | Penn State | D360 meeting…"
    />

    <div style={{ display: "flex", gap: "10px", marginTop: "12px" }}>
      <button onClick={analyzeInbox}>Analyze Inbox</button>
      <button onClick={generatePlanningPrompt}>Copy AI planning prompt</button>
    </div>
  </section>
)}
    {tab==='tasks' && <Tasks tasks={tasks} initiatives={initiatives} insert={insert} update={update} remove={remove}/>}    
    {tab==='initiatives' && <Initiatives items={initiatives} insert={insert} update={update} remove={remove}/>}    
    {tab==='followups' && <Followups items={followups} initiatives={initiatives} insert={insert} update={update} remove={remove}/>}    
    {tab==='log' && <Log logs={logs} insert={insert} remove={remove}/>}    
    {tab==='review' && <section><h2>AI Review Prompt</h2><button onClick={generatePlanningPrompt}>Generate & copy prompt</button><textarea className="big" value={aiPrompt} onChange={e=>setAiPrompt(e.target.value)} placeholder="Generated prompt will appear here…"/></section>}
  </Shell>
}

function Shell({children}){return <main>{children}</main>}

function Field({label,children}){return <label><span>{label}</span>{children}</label>}

function Tasks({tasks, initiatives, insert, update, remove}){
  const [f,setF]=useState({
    title:'',
    org:'Penn State',
    priority:'🟡 Medium',
    status:'New',
    day:'',
    next_action:'',
    waiting_on:'',
    initiative_id:'',
    workfront_needed:false,
    notes:'',
    tool:''
  })

  return <section>
    <h2>Tasks</h2>

    <div className="form">
      <Field label="Title"><input value={f.title} onChange={e=>setF({...f,title:e.target.value})}/></Field>
      <Field label="Org"><select value={f.org} onChange={e=>setF({...f,org:e.target.value})}>{ORGS.map(o=><option key={o}>{o}</option>)}</select></Field>
      <Field label="Priority"><select value={f.priority} onChange={e=>setF({...f,priority:e.target.value})}>{PRIORITIES.map(p=><option key={p}>{p}</option>)}</select></Field>
      <Field label="Status"><select value={f.status} onChange={e=>setF({...f,status:e.target.value})}>{STATUSES.map(s=><option key={s}>{s}</option>)}</select></Field>

      <Field label="Initiative">
        <select value={f.initiative_id} onChange={e=>setF({...f,initiative_id:e.target.value})}>
          <option value="">None</option>
          {initiatives.map(i=><option key={i.id} value={i.id}>{i.title}</option>)}
        </select>
      </Field>

      <Field label="Next action"><input value={f.next_action} onChange={e=>setF({...f,next_action:e.target.value})}/></Field>
      <Field label="Waiting on"><input value={f.waiting_on} onChange={e=>setF({...f,waiting_on:e.target.value})}/></Field>
      <Field label="Notes"><textarea value={f.notes} onChange={e=>setF({...f,notes:e.target.value})}/></Field>

      <label className="check">
        <input type="checkbox" checked={f.workfront_needed} onChange={e=>setF({...f,workfront_needed:e.target.checked})}/> Workfront needed
      </label>

      <button onClick={()=>{
        if(f.title) insert('tasks', {...f, initiative_id: f.initiative_id || null})
        setF({...f,title:'',notes:'',next_action:'',waiting_on:'',initiative_id:''})
      }}>Add task</button>
    </div>

    <KanbanBoard
      rows={tasks}
      statuses={STATUSES}
      table="tasks"
      type="task"
      initiatives={initiatives}
      insert={insert}
      update={update}
      remove={remove}
    />
  </section>
}
function Initiatives({items,insert,update,remove}){
  const [f,setF]=useState({title:'',org:'Penn State',status:'Active',goal:'',stakeholders:'',next_action:'',waiting_on:'',notes:''})
  return <section><h2>Initiatives</h2><div className="form"><Field label="Title"><input value={f.title} onChange={e=>setF({...f,title:e.target.value})}/></Field><Field label="Org"><select value={f.org} onChange={e=>setF({...f,org:e.target.value})}>{ORGS.map(o=><option key={o}>{o}</option>)}</select></Field><Field label="Status"><input value={f.status} onChange={e=>setF({...f,status:e.target.value})}/></Field><Field label="Goal"><textarea value={f.goal} onChange={e=>setF({...f,goal:e.target.value})}/></Field><Field label="Stakeholders"><input value={f.stakeholders} onChange={e=>setF({...f,stakeholders:e.target.value})}/></Field><Field label="Next action"><input value={f.next_action} onChange={e=>setF({...f,next_action:e.target.value})}/></Field><Field label="Waiting on"><input value={f.waiting_on} onChange={e=>setF({...f,waiting_on:e.target.value})}/></Field><Field label="Notes"><textarea value={f.notes} onChange={e=>setF({...f,notes:e.target.value})}/></Field><button onClick={()=>{if(f.title)insert('initiatives',f);setF({...f,title:'',goal:'',stakeholders:'',next_action:'',waiting_on:'',notes:''})}}>Add initiative</button></div><Cards rows={items} remove={(id)=>remove('initiatives',id)} update={(id,p)=>update('initiatives',id,p)} insert={insert} type="initiative"/></section>
}
function Followups({items, initiatives, insert, update, remove}){
  const [f,setF]=useState({
    title:'',
    org:'Penn State',
    due_date:'',
    status:'Need to Send',
    initiative_id:'',
    notes:''
  })

  return <section>
    <h2>Follow-ups / Waiting On</h2>

    <div className="form">
      <Field label="Title"><input value={f.title} onChange={e=>setF({...f,title:e.target.value})}/></Field>
      <Field label="Org"><select value={f.org} onChange={e=>setF({...f,org:e.target.value})}>{ORGS.map(o=><option key={o}>{o}</option>)}</select></Field>
      <Field label="Due date"><input type="date" value={f.due_date} onChange={e=>setF({...f,due_date:e.target.value})}/></Field>
      <Field label="Status"><select value={f.status} onChange={e=>setF({...f,status:e.target.value})}>{FOLLOWUP_STATUSES.map(s=><option key={s}>{s}</option>)}</select></Field>

      <Field label="Initiative">
        <select value={f.initiative_id} onChange={e=>setF({...f,initiative_id:e.target.value})}>
          <option value="">None</option>
          {initiatives.map(i=><option key={i.id} value={i.id}>{i.title}</option>)}
        </select>
      </Field>

      <Field label="Notes"><textarea value={f.notes} onChange={e=>setF({...f,notes:e.target.value})}/></Field>

      <button onClick={()=>{
        if(f.title) insert('followups', {...f, initiative_id: f.initiative_id || null})
        setF({...f,title:'',notes:'',initiative_id:''})
      }}>Add follow-up</button>
    </div>

    <KanbanBoard
      rows={items}
      statuses={FOLLOWUP_STATUSES}
      table="followups"
      type="followup"
      initiatives={initiatives}
      insert={insert}
      update={update}
      remove={remove}
    />
  </section>
}
function Log({logs,insert,remove}){
  const [f,setF]=useState({text:'',org:'Penn State'})
  return <section><h2>Work Log</h2><div className="inline"><input value={f.text} onChange={e=>setF({...f,text:e.target.value})} placeholder="What did you do?"/><select value={f.org} onChange={e=>setF({...f,org:e.target.value})}>{ORGS.map(o=><option key={o}>{o}</option>)}</select><button onClick={()=>{if(f.text)insert('work_log',f);setF({...f,text:''})}}>Log</button></div><div className="grid">{logs.map(l=><article key={l.id}><div className="meta">{new Date(l.created_at).toLocaleString()} · {l.org}</div><h3>{l.text}</h3><button className="ghost" onClick={()=>remove('work_log',l.id)}>Delete</button></article>)}</div></section>
}
function Cards({ rows, remove, update, insert, type }) {
  const [editing, setEditing] = useState(null)

  async function moveItem(row, targetType) {
    if (!targetType || targetType === type) return

    if (targetType === 'task') {
      await insert('tasks', {
        title: row.title,
        org: row.org || 'Penn State',
        priority: row.priority || '🟡 Medium',
        status: 'New',
        next_action: row.next_action || 'Review and prioritize',
        waiting_on: row.waiting_on || '',
        notes: row.notes || row.goal || '',
        workfront_needed: false,
        done: false
      })
    }

    if (targetType === 'followup') {
      await insert('followups', {
        title: row.title,
        org: row.org || 'Penn State',
        status: 'Need to Send',
        notes: row.notes || row.next_action || ''
      })
    }

    if (targetType === 'initiative') {
      await insert('initiatives', {
        title: row.title,
        org: row.org || 'Penn State',
        status: 'Active',
        next_action: row.next_action || 'Define next action',
        waiting_on: row.waiting_on || '',
        notes: row.notes || ''
      })
    }

    remove(row.id)
  }

  return (
    <div className="grid">
      {rows.map(r => (
        <article key={r.id}>
          {editing === r.id ? (
            <>
              <Field label="Title">
                <input value={r.title || ''} onChange={e => update(r.id, { title: e.target.value })} />
              </Field>

              <Field label="Org">
                <select value={r.org || 'Penn State'} onChange={e => update(r.id, { org: e.target.value })}>
                  {ORGS.map(o => <option key={o}>{o}</option>)}
                </select>
              </Field>

              <Field label="Status">
                <input value={r.status || ''} onChange={e => update(r.id, { status: e.target.value })} />
              </Field>

              {type === 'task' && (
                <Field label="Priority">
                  <select value={r.priority || '🟡 Medium'} onChange={e => update(r.id, { priority: e.target.value })}>
                    {PRIORITIES.map(p => <option key={p}>{p}</option>)}
                  </select>
                </Field>
              )}

              <Field label="Next action">
                <input value={r.next_action || ''} onChange={e => update(r.id, { next_action: e.target.value })} />
              </Field>

              <Field label="Waiting on">
                <input value={r.waiting_on || ''} onChange={e => update(r.id, { waiting_on: e.target.value })} />
              </Field>

              <Field label="Notes">
                <textarea value={r.notes || ''} onChange={e => update(r.id, { notes: e.target.value })} />
              </Field>

              <button onClick={() => setEditing(null)}>Done editing</button>
            </>
          ) : (
            <>
              <div className="meta">{r.org} · {r.status || ''} {r.priority || ''}</div>
              <h3>{r.title}</h3>
              {r.goal && <p><b>Goal:</b> {r.goal}</p>}
              {r.next_action && <p><b>Next:</b> {r.next_action}</p>}
              {r.waiting_on && <p><b>Waiting on:</b> {r.waiting_on}</p>}
              {r.due_date && <p><b>Due:</b> {r.due_date}</p>}
              {r.workfront_needed && <p className="warn">Workfront needed</p>}
              {r.notes && <p>{r.notes}</p>}

              <div className="actions">
                {type === 'task' && (
                  <button onClick={() => update(r.id, { done: !r.done, status: !r.done ? 'Done' : 'New' })}>
                    {r.done ? 'Reopen' : 'Done'}
                  </button>
                )}

                <button onClick={() => setEditing(r.id)}>Edit</button>

                <select onChange={e => moveItem(r, e.target.value)} defaultValue="">
                  <option value="">Move to...</option>
                  <option value="task">Task</option>
                  <option value="followup">Follow-up</option>
                  <option value="initiative">Initiative</option>
                </select>

                <button className="ghost" onClick={() => remove(r.id)}>Delete</button>
              </div>
            </>
          )}
        </article>
      ))}
    </div>
  )
}

function KanbanBoard({ rows, statuses, table, type, initiatives, insert, update, remove }) {
  async function onDrop(e, status) {
    e.preventDefault()
    const id = e.dataTransfer.getData('id')
    if (!id) return

    const patch = { status }

    if (type === 'task') {
      patch.done = status === 'Done'
    }

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
              key={row.id}
              row={row}
              table={table}
              type={type}
              initiatives={initiatives}
              insert={insert}
              update={update}
              remove={remove}
            />
          ))}
        </div>
      ))}
    </div>
  )
}

function WorkCard({ row, table, type, initiatives, insert, update, remove }) {
  const [editing, setEditing] = useState(false)

  async function moveItem(targetType) {
    if (!targetType || targetType === type) return

    if (targetType === 'task') {
      await insert('tasks', {
        title: row.title,
        org: row.org || 'Penn State',
        priority: row.priority || '🟡 Medium',
        status: 'New',
        next_action: row.next_action || 'Review and prioritize',
        waiting_on: row.waiting_on || '',
        initiative_id: row.initiative_id || null,
        notes: row.notes || row.goal || '',
        workfront_needed: false,
        done: false
      })
    }

    if (targetType === 'followup') {
      await insert('followups', {
        title: row.title,
        org: row.org || 'Penn State',
        status: 'Need to Send',
        initiative_id: row.initiative_id || null,
        notes: row.notes || row.next_action || ''
      })
    }

    if (targetType === 'initiative') {
      await insert('initiatives', {
        title: row.title,
        org: row.org || 'Penn State',
        status: 'Active',
        next_action: row.next_action || 'Define next action',
        waiting_on: row.waiting_on || '',
        notes: row.notes || ''
      })
    }

    await remove(table, row.id)
  }

  const linkedInitiative = initiatives.find(i => String(i.id) === String(row.initiative_id))

  return (
    <article
      draggable
      onDragStart={e => e.dataTransfer.setData('id', row.id)}
      className="kanbanCard"
    >
      {editing ? (
        <>
          <Field label="Title"><input value={row.title || ''} onChange={e=>update(table,row.id,{title:e.target.value})}/></Field>

          <Field label="Org">
            <select value={row.org || 'Penn State'} onChange={e=>update(table,row.id,{org:e.target.value})}>
              {ORGS.map(o=><option key={o}>{o}</option>)}
            </select>
          </Field>

          {type !== 'initiative' && (
            <Field label="Initiative">
              <select value={row.initiative_id || ''} onChange={e=>update(table,row.id,{initiative_id:e.target.value || null})}>
                <option value="">None</option>
                {initiatives.map(i=><option key={i.id} value={i.id}>{i.title}</option>)}
              </select>
            </Field>
          )}

          <Field label="Next action"><input value={row.next_action || ''} onChange={e=>update(table,row.id,{next_action:e.target.value})}/></Field>
          <Field label="Waiting on"><input value={row.waiting_on || ''} onChange={e=>update(table,row.id,{waiting_on:e.target.value})}/></Field>
          <Field label="Notes"><textarea value={row.notes || ''} onChange={e=>update(table,row.id,{notes:e.target.value})}/></Field>

          <button onClick={()=>setEditing(false)}>Done</button>
        </>
      ) : (
        <>
          <div className="meta">{row.org} {row.priority || ''}</div>
          <h3>{row.title}</h3>

          {linkedInitiative && <p><b>Initiative:</b> {linkedInitiative.title}</p>}
          {row.next_action && <p><b>Next:</b> {row.next_action}</p>}
          {row.waiting_on && <p><b>Waiting on:</b> {row.waiting_on}</p>}
          {row.due_date && <p><b>Due:</b> {row.due_date}</p>}
          {row.workfront_needed && <p className="warn">Workfront needed</p>}
          {row.notes && <p>{row.notes}</p>}

          <div className="actions">
            <button onClick={()=>setEditing(true)}>Edit</button>

            <select onChange={e=>moveItem(e.target.value)} defaultValue="">
              <option value="">Move to...</option>
              <option value="task">Task</option>
              <option value="followup">Follow-up</option>
              <option value="initiative">Initiative</option>
            </select>

            <button className="ghost" onClick={()=>remove(table,row.id)}>Delete</button>
          </div>
        </>
      )}
    </article>
  )
}

createRoot(document.getElementById('root')).render(<App />)
