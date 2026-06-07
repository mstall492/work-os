import React, { useEffect, useMemo, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { supabase } from './supabase'
import './styles.css'

const ORGS = ['Penn State', 'TruStage', 'WEX', 'HCB', 'Personal']
const PRIORITIES = ['🔴 Critical', '🟠 High', '🟡 Medium', '🟢 Low']
const STATUSES = ['New', 'In Progress', 'Waiting', 'Blocked', 'Done']

function App(){
  const [session,setSession]=useState(null)
  const [email,setEmail]=useState('')
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

  async function signIn(){
    if(!email.trim()) return
    const {error}=await supabase.auth.signInWithOtp({email, options:{emailRedirectTo: window.location.origin}})
    alert(error ? error.message : 'Check your email for the login link.')
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

  const counts=useMemo(()=>({tasks:tasks.filter(t=>!t.done).length, initiatives:initiatives.length, followups:followups.filter(f=>f.status!=='Done').length}),[tasks,initiatives,followups])

  if(loading) return <Shell><p>Loading…</p></Shell>
  if(!session) return <Shell><div className="login"><h1>Work OS</h1><p>Sign in with your email magic link.</p><input placeholder="email" value={email} onChange={e=>setEmail(e.target.value)} /><button onClick={signIn}>Send login link</button></div></Shell>

  return <Shell>
    <header className="top"><div><h1>Work OS</h1><p>{session.user.email}</p></div><button className="ghost" onClick={()=>supabase.auth.signOut()}>Sign out</button></header>
    <nav>{[['inbox','Inbox'],['tasks',`Tasks ${counts.tasks}`],['initiatives',`Initiatives ${counts.initiatives}`],['followups',`Follow-ups ${counts.followups}`],['log','Work Log'],['review','AI Review']].map(([k,v])=><button className={tab===k?'active':''} onClick={()=>setTab(k)} key={k}>{v}</button>)}</nav>

    {tab==='inbox' && <section><h2>Inbox / Calendar Intake</h2><p>Paste Apple Shortcut calendar output, Teams notes, Clockify notes or rough thoughts here.</p><textarea className="big" value={intake} onChange={e=>setIntake(e.target.value)} placeholder="10:00 AM | Penn State | D360 meeting…"/><button onClick={generatePlanningPrompt}>Copy AI planning prompt</button></section>}

    {tab==='tasks' && <Tasks tasks={tasks} insert={insert} update={update} remove={remove}/>}    
    {tab==='initiatives' && <Initiatives items={initiatives} insert={insert} update={update} remove={remove}/>}    
    {tab==='followups' && <Followups items={followups} insert={insert} update={update} remove={remove}/>}    
    {tab==='log' && <Log logs={logs} insert={insert} remove={remove}/>}    
    {tab==='review' && <section><h2>AI Review Prompt</h2><button onClick={generatePlanningPrompt}>Generate & copy prompt</button><textarea className="big" value={aiPrompt} onChange={e=>setAiPrompt(e.target.value)} placeholder="Generated prompt will appear here…"/></section>}
  </Shell>
}

function Shell({children}){return <main>{children}</main>}

function Field({label,children}){return <label><span>{label}</span>{children}</label>}

function Tasks({tasks,insert,update,remove}){
  const [f,setF]=useState({title:'',org:'Penn State',priority:'🟡 Medium',status:'New',day:'',next_action:'',waiting_on:'',workfront_needed:false,notes:'',tool:''})
  return <section><h2>Tasks</h2><div className="form"><Field label="Title"><input value={f.title} onChange={e=>setF({...f,title:e.target.value})}/></Field><Field label="Org"><select value={f.org} onChange={e=>setF({...f,org:e.target.value})}>{ORGS.map(o=><option key={o}>{o}</option>)}</select></Field><Field label="Priority"><select value={f.priority} onChange={e=>setF({...f,priority:e.target.value})}>{PRIORITIES.map(p=><option key={p}>{p}</option>)}</select></Field><Field label="Status"><select value={f.status} onChange={e=>setF({...f,status:e.target.value})}>{STATUSES.map(s=><option key={s}>{s}</option>)}</select></Field><Field label="Next action"><input value={f.next_action} onChange={e=>setF({...f,next_action:e.target.value})}/></Field><Field label="Waiting on"><input value={f.waiting_on} onChange={e=>setF({...f,waiting_on:e.target.value})}/></Field><Field label="Notes"><textarea value={f.notes} onChange={e=>setF({...f,notes:e.target.value})}/></Field><label className="check"><input type="checkbox" checked={f.workfront_needed} onChange={e=>setF({...f,workfront_needed:e.target.checked})}/> Workfront needed</label><button onClick={()=>{if(f.title)insert('tasks',f);setF({...f,title:'',notes:'',next_action:'',waiting_on:''})}}>Add task</button></div><Cards rows={tasks} remove={(id)=>remove('tasks',id)} update={(id,p)=>update('tasks',id,p)} type="task"/></section>
}
function Initiatives({items,insert,update,remove}){
  const [f,setF]=useState({title:'',org:'Penn State',status:'Active',goal:'',stakeholders:'',next_action:'',waiting_on:'',notes:''})
  return <section><h2>Initiatives</h2><div className="form"><Field label="Title"><input value={f.title} onChange={e=>setF({...f,title:e.target.value})}/></Field><Field label="Org"><select value={f.org} onChange={e=>setF({...f,org:e.target.value})}>{ORGS.map(o=><option key={o}>{o}</option>)}</select></Field><Field label="Status"><input value={f.status} onChange={e=>setF({...f,status:e.target.value})}/></Field><Field label="Goal"><textarea value={f.goal} onChange={e=>setF({...f,goal:e.target.value})}/></Field><Field label="Stakeholders"><input value={f.stakeholders} onChange={e=>setF({...f,stakeholders:e.target.value})}/></Field><Field label="Next action"><input value={f.next_action} onChange={e=>setF({...f,next_action:e.target.value})}/></Field><Field label="Waiting on"><input value={f.waiting_on} onChange={e=>setF({...f,waiting_on:e.target.value})}/></Field><Field label="Notes"><textarea value={f.notes} onChange={e=>setF({...f,notes:e.target.value})}/></Field><button onClick={()=>{if(f.title)insert('initiatives',f);setF({...f,title:'',goal:'',stakeholders:'',next_action:'',waiting_on:'',notes:''})}}>Add initiative</button></div><Cards rows={items} remove={(id)=>remove('initiatives',id)} update={(id,p)=>update('initiatives',id,p)} /></section>
}
function Followups({items,insert,update,remove}){
  const [f,setF]=useState({title:'',org:'Penn State',due_date:'',status:'Open',notes:''})
  return <section><h2>Follow-ups / Waiting On</h2><div className="form"><Field label="Title"><input value={f.title} onChange={e=>setF({...f,title:e.target.value})}/></Field><Field label="Org"><select value={f.org} onChange={e=>setF({...f,org:e.target.value})}>{ORGS.map(o=><option key={o}>{o}</option>)}</select></Field><Field label="Due date"><input type="date" value={f.due_date} onChange={e=>setF({...f,due_date:e.target.value})}/></Field><Field label="Status"><input value={f.status} onChange={e=>setF({...f,status:e.target.value})}/></Field><Field label="Notes"><textarea value={f.notes} onChange={e=>setF({...f,notes:e.target.value})}/></Field><button onClick={()=>{if(f.title)insert('followups',f);setF({...f,title:'',notes:''})}}>Add follow-up</button></div><Cards rows={items} remove={(id)=>remove('followups',id)} update={(id,p)=>update('followups',id,p)} /></section>
}
function Log({logs,insert,remove}){
  const [f,setF]=useState({text:'',org:'Penn State'})
  return <section><h2>Work Log</h2><div className="inline"><input value={f.text} onChange={e=>setF({...f,text:e.target.value})} placeholder="What did you do?"/><select value={f.org} onChange={e=>setF({...f,org:e.target.value})}>{ORGS.map(o=><option key={o}>{o}</option>)}</select><button onClick={()=>{if(f.text)insert('work_log',f);setF({...f,text:''})}}>Log</button></div><div className="grid">{logs.map(l=><article key={l.id}><div className="meta">{new Date(l.created_at).toLocaleString()} · {l.org}</div><h3>{l.text}</h3><button className="ghost" onClick={()=>remove('work_log',l.id)}>Delete</button></article>)}</div></section>
}
function Cards({rows,remove,update,type}){return <div className="grid">{rows.map(r=><article key={r.id}><div className="meta">{r.org} · {r.status||''} {r.priority||''}</div><h3>{r.title}</h3>{r.goal&&<p><b>Goal:</b> {r.goal}</p>}{r.next_action&&<p><b>Next:</b> {r.next_action}</p>}{r.waiting_on&&<p><b>Waiting on:</b> {r.waiting_on}</p>}{r.due_date&&<p><b>Due:</b> {r.due_date}</p>}{r.workfront_needed&&<p className="warn">Workfront needed</p>}{r.notes&&<p>{r.notes}</p>}<div className="actions">{type==='task'&&<button onClick={()=>update(r.id,{done:!r.done,status:!r.done?'Done':'New'})}>{r.done?'Reopen':'Done'}</button>}<button className="ghost" onClick={()=>remove(r.id)}>Delete</button></div></article>)}</div>}

createRoot(document.getElementById('root')).render(<App />)
