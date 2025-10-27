// api-client.js — tiny fetch wrapper for Cloudflare D1 Worker
// Set these to your deployed Worker endpoint + API key
export const API_URL = (window.BISBUL_API_URL || localStorage.getItem('BISBUL_API_URL') || location.origin).replace(/\/$/,'')
export const API_KEY = (window.BISBUL_API_KEY || localStorage.getItem('BISBUL_API_KEY') || '')

function headers(){
  const h = {'Content-Type':'application/json'}
  if(API_KEY) h['X-API-Key'] = API_KEY
  return h
}
function q(obj){ const s=new URLSearchParams(); Object.entries(obj||{}).forEach(([k,v])=> (v!=null&&v!=='') && s.append(k,String(v))); const t=s.toString(); return t?('?'+t):'' }

export async function list(table, params={}){
  const r = await fetch(`${API_URL}/api/${encodeURIComponent(table)}${q(params)}`)
  if(!r.ok) throw new Error(await r.text())
  return r.json()
}
export async function detail(table, id){
  const r = await fetch(`${API_URL}/api/${encodeURIComponent(table)}/${id}`)
  if(!r.ok) throw new Error(await r.text())
  return r.json()
}
export async function create(table, data){
  const r = await fetch(`${API_URL}/api/${encodeURIComponent(table)}`, {method:'POST', headers:headers(), body:JSON.stringify(data)})
  if(!r.ok) throw new Error(await r.text())
  return r.json()
}
export async function update(table, id, data){
  const r = await fetch(`${API_URL}/api/${encodeURIComponent(table)}/${id}`, {method:'PUT', headers:headers(), body:JSON.stringify({...data,id})})
  if(!r.ok) throw new Error(await r.text())
  return r.json()
}
export async function removeRow(table, id){
  const r = await fetch(`${API_URL}/api/${encodeURIComponent(table)}/${id}`, {method:'DELETE', headers:headers()})
  if(!r.ok) throw new Error(await r.text())
  return r.json()
}

// ===== Project-specific helpers =====

// Save an enrolled face embedding histogram (vec float[256]) for a user/label
export async function saveFace({user_id=null, label, vec}){
  return create('faces', {user_id, label, vec: JSON.stringify(Array.from(vec||[]))})
}

// Find user by name (first exact, then LIKE). Returns row or null
export async function findUserByName(name){
  const res = await list('users', {search: name, page_size: 50})
  const items = res.items || []
  const exact = items.find(x => (x.name||'').toLowerCase() === String(name||'').toLowerCase())
  return exact || items[0] || null
}

// Add a presence event
export async function addPresence({user_id=null, label=null, score=0, status='hadir', lokasi='', meta={}}){
  return create('presensi', {
    user_id, label, score, status, lokasi,
    ts: new Date().toISOString(),
    meta: JSON.stringify(meta||{})
  })
}
