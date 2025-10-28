// ===== Config D1 (Cloudflare) =====
// Ubah sesuai deployment Anda
const D1_BASE = "https://api.bisbul.com";
const D1_TABLE = "users";
const D1_API_KEY = "rahasiaku123"; // DEMO only. Simpan di server/env, bukan di client untuk produksi!

// ===== DOM refs & util UI =====
const $ = (id)=>document.getElementById(id);
const tabEnroll=$("tabEnroll"), tabAttend=$("tabAttend");
const secEnroll=$("sectionEnroll"), secAttend=$("sectionAttend");

const camSel=$("camera"), nthEl=$("nth"), sizeEl=$("size"), btnS=$("start"), btnT=$("stop"), showVideoCb=$("showVideo");
const nameEl=$("name"), samplesEl=$("samples"), thEl=$("th");
const statusEl=$("status"), logEl=$("log"), video=$("video"), canvas=$("canvas"), ctx=canvas.getContext('2d');
const cooldownEl=$("cooldown");
const btnEnroll=$("enroll"), btnClear=$("clearDb"), btnExport=$("exportDb"), inImport=$("importDb");
const btnExportAtt=$("exportAttend"), btnClearAtt=$("clearAttend"), attTable=$("attTable")?.querySelector("tbody"), attCount=$("attCount");
const log=(...a)=>{ console.log(...a); if(logEl){ logEl.textContent=a.join(" ")+"\n"+logEl.textContent.slice(0,2000); } };

// ===== Local DB (faces) & Attendance =====
const DB_KEY='face_db_v1';
const ATT_KEY='face_att_v1';
function loadDB(){ try{return JSON.parse(localStorage.getItem(DB_KEY)||'{"labels":[]}');}catch{return {labels:[]};} }
function saveDB(db){ localStorage.setItem(DB_KEY, JSON.stringify(db)); }
function clearDB(){ localStorage.removeItem(DB_KEY); }
function loadATT(){ try{return JSON.parse(localStorage.getItem(ATT_KEY)||'[]');}catch{return [];} }
function saveATT(arr){ localStorage.setItem(ATT_KEY, JSON.stringify(arr)); }
function pushATT(name,score){
  const arr=loadATT();
  arr.unshift({ts:new Date().toISOString(), name, score: Number(score)});
  saveATT(arr); renderATT();
}
function renderATT(){
  if(!attTable || !attCount) return;
  const arr=loadATT();
  attTable.innerHTML = arr.map((r,i)=>`<tr><td>${arr.length-i}</td><td>${r.ts}</td><td>${r.name}</td><td>${r.score.toFixed(2)}</td></tr>`).join("");
  attCount.textContent = arr.length ? `${arr.length} entri` : "Belum ada presensi";
}
function exportCSV(){
  const arr=loadATT();
  const head = ["ts","name","score"];
  const rows = [head.join(",")].concat(arr.map(r=>`${r.ts},${JSON.stringify(r.name)},${r.score}`));
  const blob = new Blob([rows.join("\n")], {type:"text/csv"});
  const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download='presensi.csv'; a.click();
}

// ===== Math & Recognition =====
let stream=null, running=false, rafId=null, enrolling=false, enrollLeft=0, enrollSum=null;
let detectEveryN=2, frameIndex=0, facesCount=0, procFPS=0, lastFPS=0, procCount=0;
let classifier=null, gray=null, rgba=null;
const cascadeURL='https://raw.githubusercontent.com/opencv/opencv/master/data/haarcascades/haarcascade_frontalface_alt2.xml';
const LBP_SIZE=100;

function bestMatch(vec, db){
  if(!db.labels.length) return {name:"Unknown", score:0};
  let best={name:"Unknown",score:0};
  for(const r of db.labels){
    const s=cosine(vec,r.vec);
    if(s>best.score) best={name:r.name,score:s};
  }
  return best;
}
function lbpHistFromBytes(bytes,w,h){
  const hist=new Float32Array(256);
  for(let y=1;y<h-1;y++){
    const yp=y*w;
    for(let x=1;x<w-1;x++){
      const c=bytes[yp+x];
      const code=((bytes[(y-1)*w+(x-1)]>=c)<<7)|((bytes[(y-1)*w+(x  )]>=c)<<6)|((bytes[(y-1)*w+(x+1)]>=c)<<5)|((bytes[(y  )*w+(x+1)]>=c)<<4)|((bytes[(y+1)*w+(x+1)]>=c)<<3)|((bytes[(y+1)*w+(x  )]>=c)<<2)|((bytes[(y+1)*w+(x-1)]>=c)<<1)|((bytes[(y  )*w+(x-1)]>=c)<<0);
      hist[code]+=1;
    }
  }
  let norm=0; for(let i=0;i<256;i++) norm+=hist[i]*hist[i];
  norm=Math.sqrt(norm)||1; for(let i=0;i<256;i++) hist[i]/=norm; return hist;
}
function addInPlace(a,b){ for(let i=0;i<a.length;i++) a[i]+=b[i]; }
function scaleInPlace(a,s){ for(let i=0;i<a.length;i++) a[i]*=s; }
function cosine(a,b){
  let dot=0,na=0,nb=0;
  for(let i=0;i<a.length;i++){ dot+=a[i]*b[i]; na+=a[i]*a[i]; nb+=b[i]*b[i]; }
  return dot/(Math.sqrt(na)*Math.sqrt(nb)+1e-9);
}

// ===== OpenCV init
function onOpenCvReady(){ if(window.cv&&cv.getBuildInformation) initOpenCV(); else if(window.cv) cv['onRuntimeInitialized']=initOpenCV; }
async function initOpenCV(){
  try{
    statusEl.textContent='Status: memuat cascade…';
    const res=await fetch(cascadeURL); const buf=new Uint8Array(await res.arrayBuffer());
    cv.FS_createDataFile('/','haarcascade.xml',buf,true,false,false);
    classifier=new cv.CascadeClassifier(); classifier.load('haarcascade.xml');
    statusEl.textContent='Status: siap. Klik Start.';
    btnS.disabled=false; btnEnroll.disabled=false;
    if(navigator.mediaDevices?.enumerateDevices){ try{ await fillCameraList(); }catch{} }
  }catch(e){ console.error(e); statusEl.textContent='Status: gagal memuat cascade.'; }
}

// ===== Camera
async function fillCameraList(){
  const devices=await navigator.mediaDevices.enumerateDevices();
  const cams=devices.filter(d=>d.kind==='videoinput');
  camSel.innerHTML='';
  cams.forEach((d,i)=>{const o=document.createElement('option'); o.value=d.deviceId; o.textContent=d.label||`Kamera ${i+1}`; camSel.appendChild(o);});
}
function parseSize(v){ const [w,h]=v.split('x').map(n=>parseInt(n,10)); return {w,h}; }
function setCanvasSize(v){ const {w,h}=parseSize(v); canvas.width=w; canvas.height=h; }
async function startCamera(){
  const devId=camSel.value||undefined;
  const {w,h}=parseSize(sizeEl.value);
  const c={video:devId?{deviceId:{exact:devId},width:{ideal:w},height:{ideal:h}}:{width:{ideal:w},height:{ideal:h}},audio:false};
  stream=await navigator.mediaDevices.getUserMedia(c);
  video.srcObject=stream; await video.play();
  await new Promise(res=>{
    const done=()=>res();
    if(video.readyState>=2 && video.videoWidth>0) return res();
    video.onloadedmetadata=done; video.onplaying=done; setTimeout(done,3000);
  });
  if(navigator.mediaDevices?.enumerateDevices){ try{ await fillCameraList(); }catch{} }
}
function stopCamera(){ if(stream){ stream.getTracks().forEach(t=>t.stop()); stream=null; } video.srcObject=null; }

// ===== UI handlers (tabs & actions)
tabEnroll.onclick = ()=>{ tabEnroll.classList.add('active'); tabAttend.classList.remove('active'); secEnroll.classList.add('active'); secAttend.classList.remove('active'); };
tabAttend.onclick = ()=>{ tabAttend.classList.add('active'); tabEnroll.classList.remove('active'); secAttend.classList.add('active'); secEnroll.classList.remove('active'); renderATT(); };

btnS.onclick = async ()=>{
  if(!classifier){ alert('OpenCV belum siap.'); return; }
  detectEveryN=parseInt(nthEl.value,10)||2; setCanvasSize(sizeEl.value);
  await startCamera(); running=true; btnS.disabled=true; btnT.disabled=false; video.style.display = showVideoCb.checked?'block':'none';
  startLoop(); statusEl.textContent='Status: kamera aktif';
};
btnT.onclick = ()=>{ running=false; cancelAnimationFrame(rafId); rafId=null; stopCamera(); btnS.disabled=false; btnT.disabled=true; statusEl.textContent='Status: stopped'; };
showVideoCb.onchange = ()=>{ video.style.display = showVideoCb.checked?'block':'none'; };

btnEnroll.onclick = async ()=>{
  const nm=(nameEl.value||'').trim();
  if(!nm){ alert('Isi nama.'); return; }
  enrolling=true; enrollLeft=parseInt(samplesEl.value,10)||20; enrollSum=new Float32Array(256);
  statusEl.textContent=`Enroll "${nm}" — ambil ${enrollLeft} sampel…`;
};
btnClear.onclick = ()=>{ if(confirm('Yakin hapus seluruh DB wajah?')){ clearDB(); alert('DB cleared.'); } };
btnExport.onclick = ()=>{
  const blob=new Blob([JSON.stringify(loadDB(),null,2)],{type:'application/json'});
  const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download='face_db.json'; a.click();
};
inImport.onchange = async e=>{
  const f=e.target.files[0]; if(!f) return; const txt=await f.text();
  try{
    const obj=JSON.parse(txt);
    if(!obj||!Array.isArray(obj.labels)) throw 0;
    localStorage.setItem(DB_KEY, JSON.stringify(obj)); alert('Import DB ok.');
  }catch{ alert('File JSON tidak valid.'); }
};
btnExportAtt.onclick = exportCSV;
btnClearAtt.onclick = ()=>{ if(confirm('Yakin hapus seluruh presensi?')){ saveATT([]); renderATT(); } };

// ===== D1 helpers (users upsert) =====
async function ensureUsersTable() {
  // Membuat tabel users jika belum ada (butuh API key), via /sql allow_write
  const sql = `CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT,
    email TEXT UNIQUE,
    password TEXT,
    role TEXT DEFAULT 'member',
    face_data TEXT
  )`;
  try{
    const res = await fetch(`${D1_BASE}/sql`, {
      method: "POST",
      headers: {"Content-Type":"application/json","X-API-Key": D1_API_KEY},
      body: JSON.stringify({ sql, allow_write: true })
    });
    await res.json().catch(()=> ({}));
  }catch(e){ console.warn("ensureUsersTable warn:", e); }
}

async function findUserByEmail(email){
  const url = new URL(`${D1_BASE}/api/${D1_TABLE}`);
  url.searchParams.set("search", email);
  const r = await fetch(url.toString());
  const j = await r.json();
  if(j?.ok && Array.isArray(j.items)){
    // Cari yang email-nya persis match
    return j.items.find(x => x.email === email) || null;
  }
  return null;
}

async function createUser(payload){
  const r = await fetch(`${D1_BASE}/api/${D1_TABLE}`, {
    method: "POST",
    headers: {"Content-Type":"application/json","X-API-Key": D1_API_KEY},
    body: JSON.stringify(payload)
  });
  return await r.json();
}

async function updateUser(id, payload){
  const r = await fetch(`${D1_BASE}/api/${D1_TABLE}/${id}`, {
    method: "PUT",
    headers: {"Content-Type":"application/json","X-API-Key": D1_API_KEY},
    body: JSON.stringify(payload)
  });
  return await r.json();
}

function makeDemoEmail(name){
  return (name||"").toLowerCase().replace(/\s+/g, "") + "@demo.local";
}

async function saveUserToD1(name, faceVector){
  await ensureUsersTable();
  const email = makeDemoEmail(name);
  const payload = {
    name,
    email,
    password: "123456", // DEMO only. PRODUKSI: simpan HASH!
    role: "member",
    face_data: JSON.stringify(faceVector)
  };
  // Upsert: jika ada -> update, else -> create
  try{
    const existing = await findUserByEmail(email);
    if(existing){
      const resUp = await updateUser(existing.id, payload);
      if(resUp?.ok){ log("✅ Update D1 users id:", existing.id); return existing.id; }
      else { log("❌ Update D1 gagal:", resUp?.error||resUp); return null; }
    }else{
      const resCr = await createUser(payload);
      if(resCr?.ok){ log("✅ Create D1 users id:", resCr.id); return resCr.id; }
      else { log("❌ Create D1 gagal:", resCr?.error||resCr); return null; }
    }
  }catch(e){
    log("⚠️ Error saveUserToD1:", e);
    return null;
  }
}

// ===== D1 helpers (presensi insert) =====
async function ensurePresensiTable(){
  const sql = `CREATE TABLE IF NOT EXISTS presensi (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    uid INTEGER,
    tanggal TEXT,
    status TEXT,
    lokasi TEXT,
    waktu TEXT
  )`;
  try{
    const res = await fetch(`${D1_BASE}/sql`, {
      method: "POST",
      headers: {"Content-Type":"application/json","X-API-Key": D1_API_KEY},
      body: JSON.stringify({ sql, allow_write: true })
    });
    await res.json().catch(()=> ({}));
  }catch(e){ console.warn("ensurePresensiTable warn:", e); }
}

// Geolocation (best-effort)
let GEO_CACHE = null;
function captureGeoOnce(){
  if(!navigator.geolocation) return;
  navigator.geolocation.getCurrentPosition(
    pos => {
      const {latitude, longitude} = pos.coords||{};
      if(typeof latitude === "number" && typeof longitude === "number"){
        GEO_CACHE = `${latitude.toFixed(6)},${longitude.toFixed(6)}`;
      }
    },
    _err => {},
    {enableHighAccuracy:false, timeout:3000, maximumAge:60000}
  );
}
// Try to capture on load
captureGeoOnce();

function ymdHmsJakarta(){
  try{
    const tz = 'Asia/Jakarta';
    const d = new Date();
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year:'numeric', month:'2-digit', day:'2-digit',
                                                      hour:'2-digit', minute:'2-digit', second:'2-digit', hour12:false }).formatToParts(d);
    const get = t => (parts.find(p=>p.type===t)||{}).value || "";
    const tanggal = `${get('year')}-${get('month')}-${get('day')}`;
    const waktu   = `${get('hour')}:${get('minute')}:${get('second')}`;
    return { tanggal, waktu };
  }catch{
    // Fallback: UTC ISO
    const iso = new Date().toISOString();
    return { tanggal: iso.slice(0,10), waktu: iso.slice(11,19) };
  }
}

async function savePresensiToD1(name, opts={}){
  await ensurePresensiTable();
  // Resolve uid by email (if exists)
  const email = makeDemoEmail(name);
  let uid = null;
  try{
    const user = await findUserByEmail(email);
    if(user && typeof user.id !== "undefined") uid = user.id;
  }catch{}

  const { tanggal, waktu } = ymdHmsJakarta();
  const payload = {
    uid,
    tanggal,
    status: opts.status || "hadir",
    lokasi: typeof opts.lokasi === "string" ? opts.lokasi : (GEO_CACHE || ""),
    waktu
  };
  try{
    const r = await fetch(`${D1_BASE}/api/presensi`, {
      method: "POST",
      headers: {"Content-Type":"application/json","X-API-Key": D1_API_KEY},
      body: JSON.stringify(payload)
    });
    const j = await r.json();
    if(j?.ok){ log("✅ Presensi tersimpan id:", j.id); return j.id; }
    else { log("❌ Gagal simpan presensi:", j?.error||j); return null; }
  }catch(e){
    log("⚠️ Error savePresensiToD1:", e);
    return null;
  }
}

// ===== Main loop (detect + recognize + enroll/attend)
const seenAt = new Map(); // name -> last timestamp (ms)
function startLoop(){
  rgba && rgba.delete(); gray && gray.delete();
  rgba=new cv.Mat(canvas.height,canvas.width,cv.CV_8UC4);
  gray=new cv.Mat();
  const faces=new cv.RectVector();
  procFPS=0; lastFPS=performance.now(); procCount=0; frameIndex=0;

  const step=()=>{
    if(!running){ rgba.delete(); gray.delete(); faces.delete(); return; }

    if(video.readyState>=2 && video.videoWidth>0){
      try{
        const {width,height}=canvas;
        ctx.drawImage(video,0,0,width,height);
        frameIndex++;
        if(frameIndex % detectEveryN === 0){
          const data=ctx.getImageData(0,0,width,height);
          rgba.data.set(data.data);
          cv.cvtColor(rgba,gray,cv.COLOR_RGBA2GRAY);
          cv.equalizeHist(gray,gray);
          classifier.detectMultiScale(gray,faces,1.1,5,0,new cv.Size(60,60));
          facesCount=faces.size();

          let displayText='';
          if(faces.size()>0){
            // pilih wajah terbesar
            let bi=0, ba=0;
            for(let i=0;i<faces.size();i++){ const r=faces.get(i), a=r.width*r.height; if(a>ba){ba=a; bi=i;} }
            const r=faces.get(bi);
            // ROI -> 100x100
            let roi=gray.roi(r), res=new cv.Mat();
            cv.resize(roi,res,new cv.Size(LBP_SIZE,LBP_SIZE),0,0,cv.INTER_AREA);
            const desc=lbpHistFromBytes(res.data,res.cols,res.rows);

            if(enrolling){
              addInPlace(enrollSum,desc); enrollLeft--; statusEl.textContent=`Enroll "${nameEl.value.trim()}" — tersisa ${enrollLeft}`;
              if(enrollLeft<=0){
                scaleInPlace(enrollSum,1/parseInt(samplesEl.value,10));
                const db=loadDB();
                const nm=nameEl.value.trim();
                // replace if exists with same name
                db.labels = db.labels.filter(x=>x.name!==nm);
                db.labels.push({name:nm, vec:Array.from(enrollSum)});
                saveDB(db);
                // ===== Integrasi D1: simpan users
                (async ()=>{
                  statusEl.textContent=`Enroll selesai untuk "${nm}", simpan ke D1...`;
                  await saveUserToD1(nm, Array.from(enrollSum));
                  statusEl.textContent=`Enroll & simpan D1 selesai untuk "${nm}".`;
                })();
                enrolling=false;
              }
            }else{
              const db=loadDB(); const match=bestMatch(desc,db);
              const thr=parseFloat(thEl.value||'0.9')||0.9;
              if(match.score>=thr){
                displayText=`${match.name} (${match.score.toFixed(2)})`;
                // only log if user is on "Presensi Wajah" tab
                if(secAttend.classList.contains('active')){
                  const now=Date.now();
                  const cdSec = Math.max(0, parseInt(cooldownEl.value||'10',10));
                  const last = seenAt.get(match.name)||0;
                  if(now - last >= cdSec*1000){
                    pushATT(match.name, match.score);
                    seenAt.set(match.name, now);
                    // ===== Simpan presensi ke D1
                    (async ()=>{
                      statusEl.textContent=`Presensi: simpan D1 untuk "${match.name}"...`;
                      await savePresensiToD1(match.name, { status: "hadir" });
                      statusEl.textContent=`Presensi: tersimpan untuk "${match.name}".`;
                    })();
                  }
                }
              } else {
                displayText=`Unknown (${match.score.toFixed(2)})`;
              }
            }

            // draw faces
            ctx.lineWidth=Math.max(2,Math.round(width/200));
            for(let i=0;i<faces.size();i++){ const rr=faces.get(i); ctx.strokeStyle=i===bi?'#00ff66':'#66a3ff'; ctx.strokeRect(rr.x,rr.y,rr.width,rr.height); }
            if(displayText){ const rr=faces.get(bi); ctx.fillStyle='rgba(0,0,0,.5)'; const w=ctx.measureText(displayText).width+14; ctx.fillRect(rr.x, rr.y-22, w, 20); ctx.fillStyle='#fff'; ctx.fillText(displayText, rr.x+7, rr.y-7); }
            roi.delete(); res.delete();
          }

          // FPS
          procCount++; const now=performance.now(); if(now-lastFPS>1000){ procFPS=procCount/((now-lastFPS)/1000); procCount=0; lastFPS=now; }
        }
      }catch(e){ console.error(e); }
    }

    drawHUD();
    schedule();
  };

  const schedule=()=>{
    if("requestVideoFrameCallback" in HTMLVideoElement.prototype){
      video.requestVideoFrameCallback(()=>{ step(); });
    } else {
      rafId=requestAnimationFrame(step);
    }
  };
  schedule();
}

function drawHUD(){
  const pad=10,line=18; const t1=`FPS: ${Math.round(procFPS)}`, t2=`Faces: ${facesCount}`, t3=enrolling?`Enrolling: ${nameEl.value.trim()} (${enrollLeft} left)`:"";
  ctx.save(); ctx.font='14px system-ui,Segoe UI,Roboto,Arial';
  const w=Math.max(ctx.measureText(t1).width,ctx.measureText(t2).width,ctx.measureText(t3).width)+pad*2; const lines=enrolling?3:2; const h=lines*line+pad*2;
  ctx.fillStyle='rgba(0,0,0,.35)'; ctx.fillRect(pad,pad,w,h);
  ctx.fillStyle='#e6eef6'; ctx.fillText(t1,pad*2,pad+line); ctx.fillText(t2,pad*2,pad+line*2); if(enrolling) ctx.fillText(t3,pad*2,pad+line*3);
  ctx.restore();
}

// Kick OpenCV init after page load
window.addEventListener('load', onOpenCvReady);
// Pre-render attendance (if any)
renderATT();
