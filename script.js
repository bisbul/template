/*******************
 * DataStore (D1 API via Worker) – tiny CRUD layer
 *******************/
const DataStore = {
  // Properti API sekarang null, akan diisi dari presets.json
  API_BASE: null,
  API_KEY: null,

  async _fetch(method, name, data = {}, id = null) {
    // Cek apakah API sudah dikonfigurasi
    if (!this.API_BASE || !this.API_KEY) throw new Error("API configuration not loaded.");

    const url = `${this.API_BASE}/${name}${id ? '/' + id : ''}`;
    const isWrite = method !== 'GET' && method !== 'OPTIONS';

    const headers = {
      'Content-Type': 'application/json',
    };
    if (isWrite && this.API_KEY) { // Menggunakan this.API_KEY
      headers['X-API-Key'] = this.API_KEY;
    }

    const config = {
      method,
      headers,
      body: (method !== 'GET' && method !== 'DELETE') ? JSON.stringify(data) : undefined,
    };

    const response = await fetch(url, config);
    const result = await response.json();

    if (!response.ok || !result.ok) {
      throw new Error(result.error || `API Error: ${response.status} ${response.statusText}`);
    }
    return result;
  },
  async load(name, search = '') {
    try {
      const url = `${this.API_BASE}/${name}${search ? '?search=' + encodeURIComponent(search) : ''}`;
      const response = await fetch(url);
      const result = await response.json();
      if (!result.ok) throw new Error(result.error || `Failed to load ${name}`);
      return result.items || [];
    } catch (e) {
      console.error(`DataStore.load(${name}) failed:`, e);
      return [];
    }
  },
  seedIfEmpty(name, rows){ console.warn('DataStore.seedIfEmpty() di frontend diabaikan untuk D1 API.') },
  nextId(rows){ return 0 },
  async upsert(name, row) {
    if (row.id) {
      const {id, ...payload} = row;
      await this._fetch('PATCH', name, payload, id);
      return row;
    } else {
      const result = await this._fetch('POST', name, row);
      return {...row, id: result.id};
    }
  },
  async remove(name, id) {
    await this._fetch('DELETE', name, {}, id);
  },
  async find(name, id) {
    try {
      const result = await this._fetch('GET', name, {}, id);
      return result.data;
    } catch (e) {
      return null;
    }
  },
  async query(name, q) {
    return this.load(name, q);
  }
};

/*******************
 * Auth – super simple (demo only)
 *******************/
const Auth = {
  get current(){ try{return JSON.parse(localStorage.getItem('presetui:currentUser'))}catch{return null} },
  set current(u){ localStorage.setItem('presetui:currentUser', JSON.stringify(u)) },
  logout(){ localStorage.removeItem('presetui:currentUser') },

  async login(email, password){
    const users = await DataStore.load('users');
    const u = users.find(x=>x.email===email && x.password===password);

    if(u){ this.current = {id:u.id, name:u.name, email:u.email, role:u.role}; return true; }
    return false;
  },
  async register({name,email,password}){
    const users = await DataStore.load('users');
    const exist = users.some(u=>u.email===email);
    if(exist) throw new Error('Email sudah terdaftar');

    const u = await DataStore.upsert('users',{name,email,password,role:'member'});
    return u;
  }
};

/*******************
 * Tiny Chart (Canvas) – pie, bar, line
 *******************/
const TinyChart = {
  draw(el, cfg){
    const c = document.createElement('canvas'); c.width=el.clientWidth; c.height=260; el.innerHTML=''; el.appendChild(c);
    const ctx = c.getContext('2d');
    const type = cfg.type||'bar';
    const values = (cfg.data||[]).map(Number);
    if(type==='pie') this.pie(ctx, c, values);
    if(type==='bar') this.bar(ctx, c, values);
    if(type==='line') this.line(ctx, c, values);
  },
  pie(ctx, c, values){
    const total = values.reduce((a,b)=>a+b,0)||1; let ang= -Math.PI/2; const R=Math.min(c.width,c.height)*0.35; const cx=c.width/2, cy=c.height/2;
    values.forEach((v,i)=>{
      const a = (v/total)*Math.PI*2; ctx.beginPath(); ctx.moveTo(cx,cy); ctx.fillStyle = this.color(i); ctx.arc(cx,cy,R,ang,ang+a); ctx.closePath(); ctx.fill(); ang+=a;
    });
  },
  bar(ctx, c, values){
    const w = c.width, h=c.height; const m=30; const W = (w-m*2)/values.length; const max=Math.max(...values,1);
    values.forEach((v,i)=>{
      const x=m+i*W + 8; const bh=(v/max)*(h-m*2); const y=h-m-bh; ctx.fillStyle=this.color(i); ctx.fillRect(x,y,W-16,bh);
    });
  },
  line(ctx, c, values){
    const w=c.width,h=c.height,m=30; const max=Math.max(...values,1);
    ctx.beginPath(); values.forEach((v,i)=>{
      const x=m + i*((w-m*2)/(values.length-1||1)); const y=h-m - (v/max)*(h-m*2); i?ctx.lineTo(x,y):ctx.moveTo(x,y);
    }); ctx.strokeStyle='#8ab4ff'; ctx.lineWidth=2; ctx.stroke();
  },
  color(i){
    const hues=[190,210,230,260,280,310,340,20,40,60]; const h=hues[i%hues.length]; return `hsl(${h} 80% 55% / .9)`;
  }
};

/*******************
 * PresetUI – Reusable JSON-preset components
 *******************/
const PresetUI = {
  async render(target, preset){
    const root = (typeof target==='string')? document.querySelector(target): target;
    root.innerHTML = '';
    const componentPromises = (preset.components||[]).map(async (comp)=>{
      const el = document.createElement('section');
      if (comp.kind === 'toolbar') {
        el.className = 'section-toolbar';
      } else {
        el.className = 'panel';
      }
      root.appendChild(el);
      await this[comp.kind]?.(el, comp, preset)
    });
    await Promise.all(componentPromises);
  },

  header(el, comp){
    const buttonHtml = (comp.actions||[]).map(a=>{
      const dataAttrs = (a.action === 'state:set' && a.key && a.value)
        ? `data-key="${a.key}" data-value="${a.value}"`
        : '';
      return `<button class="btn ${a.variant||'ghost'}" data-action="${a.action}" ${dataAttrs}>${a.label}</button>`;
    }).join('');

    el.innerHTML = `<div class="header"><div style="display:flex;gap:12px;align-items:center"><div class="avatar"></div><div><div class="title">${comp.title||''}</div><div class="subtle">${comp.subtitle||''}</div></div></div><div class="toolbar">${buttonHtml}</div></div>`;

    el.addEventListener('click', (e)=>{
      const b=e.target.closest('button[data-action]'); if(!b) return;

      const payload = {component:comp};
      if (b.dataset.key && b.dataset.value) {
          payload.key = b.dataset.key;
          payload.value = b.dataset.value;
      }

      EventBus.emit(b.dataset.action, payload);
    });
  },

  _renderToolbarButtons: function(comp){
    return (comp.actions||[]).map(a=>{
      const attrs = Object.entries(a).map(([k, v]) => {
        if (a.action === 'state:set' && (k === 'key' || k === 'value')) {
          return `data-${k}="${v}"`;
        }
        return '';
      }).join(' ');

      return `<button class="btn ${a.variant||'ghost'}" data-action="${a.action}" ${attrs}>${a.label}</button>`;
    }).join('');
  },

  toolbar(el, comp){
    const buttonHtml = PresetUI._renderToolbarButtons(comp);

    // Menambahkan title jika ada (untuk Sidebar)
    let titleHtml = comp.title ? `<div class="title" style="margin-bottom:8px">${comp.title}</div>` : '';

    // Menambahkan class 'sidebar' untuk hook CSS vertikal
    el.innerHTML = `${titleHtml}<div class="toolbar ${comp.className || ''}">${buttonHtml}</div>`;

    el.addEventListener('click', (e)=>{
      const b=e.target.closest('button[data-action]');
      if(!b) return;

      const payload = {component:comp};
      if (b.dataset.key && b.dataset.value) {
        payload.key = b.dataset.key;
        payload.value = b.dataset.value;
      }

      EventBus.emit(b.dataset.action, payload);
    })
  },

  async table(el, comp){
    let rows = await DataStore.load(comp.table) || [];
    const cols = comp.columns || this._inferColumns(rows);
    const searchBox = comp.search!==false;
    const toolbar = document.createElement('div'); toolbar.className='toolbar';

    const searchInput = document.createElement('input');
    if(searchBox){
      searchInput.className='input'; searchInput.placeholder='Cari...'; searchInput.style.maxWidth='260px';

      const table = comp.table;
      const renderer = (r) => this._renderTableBody(tbody, r, cols, comp);

      searchInput.addEventListener('input', async (e)=>{
        const queryRows = await DataStore.query(table, e.target.value);
        renderer(queryRows);
      })
      toolbar.appendChild(searchInput);
    }

    const addBtn = (comp.onAdd!==false);
    if(addBtn){
      const b=document.createElement('button');
      b.className='btn hi';
      b.textContent=comp.addLabel||'Tambah';
      // Menggunakan comp.onAdd sebagai action generik 'table:add'
      b.onclick=()=>EventBus.emit(comp.onAdd||'table:add', {table:comp.table, schema:comp.schema});
      toolbar.appendChild(b)
    }
    el.appendChild(toolbar);

    const tableEl=document.createElement('table'); tableEl.className='table';
    tableEl.innerHTML = `<thead><tr>${cols.map(c=>`<th>${c.label||c.key}</th>`).join('')}<th></th></tr></thead><tbody></tbody>`
    const tbody=tableEl.querySelector('tbody');

    this._renderTableBody(tbody, rows, cols, comp);
    el.appendChild(tableEl);
  },

  form(el, comp){
    const model = comp.model || {};
    const schema = comp.schema || this._inferSchema(model);
    el.innerHTML = `<div class="title" style="margin-bottom:8px">${comp.title||'Form'}</div>`;
    const grid=document.createElement('div'); grid.className='grid';
    schema.forEach(f=>{
      const inputId = `form-input-${comp.table}-${f.key}`;
      const col=document.createElement('div'); col.className = f.fullWidth? 'g-12':'g-6';
      // Menggunakan atribut 'for'
      col.innerHTML = `<label for="${inputId}" class="subtle" style="display:block;margin-bottom:6px">${f.label||f.key}</label>${this._inputFor(f, model[f.key], inputId)}`;
      grid.appendChild(col);
    });
    el.appendChild(grid);
    const row=document.createElement('div'); row.className='toolbar'; row.style.marginTop='12px';
    (comp.actions||[{label:'Batal',action:'form:cancel',variant:'ghost'},{label:'Simpan',action:'form:save',variant:'ok'}]).forEach(a=>{
      const b=document.createElement('button'); b.className=`btn ${a.variant||''}`; b.textContent=a.label; b.onclick=()=>{
        const data = this._collectForm(el, schema, model.id);
        EventBus.emit(a.action, {data, component:comp, table:comp.table});
      }; row.appendChild(b)
    })
    el.appendChild(row);
  },

  async chart(el, comp){
    const resolvedData = (await this._resolveData(comp)||[]);
    const vals = resolvedData.map(d => Number(d.value));

    el.innerHTML = `<div class="header"><div class="title">${comp.title||'Chart'}</div><span class="chip">${comp.type||'bar'}</span></div>`;
    TinyChart.draw(el, {type:comp.type||'bar', data: vals});
  },

  async legend(el, comp){
    const data = (await this._resolveData(comp)||[]);
    el.innerHTML = `<div class="title" style="margin-bottom:12px">${comp.title||'Legend'}</div>`;

    const total = data.reduce((sum, item) => sum + item.value, 0);

    const listHtml = data.map((item, i) => {
        const percent = total > 0 ? (item.value / total * 100).toFixed(1) : 0;
        const color = TinyChart.color(i);
        return `
            <div style="display:flex;align-items:center;gap:10px;margin-bottom:8px">
                <span style="width:10px;height:10px;border-radius:50%;background:${color}"></span>
                <div>
                    <strong style="color:var(--text);">${item.label}</strong>
                    <span class="subtle">(${item.value} | ${percent}%)</span>
                </div>
            </div>
        `;
    }).join('');

    el.innerHTML += `<div class="grid">${listHtml}</div>`;
  },

  object(el, comp){
    el.innerHTML = `<div class="header"><div class="title">${comp.title||'Object'}</div></div>`;
    const t = comp.media||'image';
    const src = comp.src;
    // FIX: Menambahkan atribut title pada iframe untuk aksesibilitas
    const iframeTitle = comp.title ? `${comp.title}` : 'Konten Tersemat (PDF)';

    if(t==='image') el.innerHTML += `<img src="${src}" style="max-width:100%;border-radius:12px;border:1px solid var(--border)"/>`;
    if(t==='video') el.innerHTML += `<video controls style="width:100%;border-radius:12px;border:1px solid var(--border)"><source src="${src}"></video>`;
    if(t==='pdf') el.innerHTML += `<iframe title="${iframeTitle}" style="width:100%;height:520px;border:1px solid var(--border);border-radius:12px" src="${src}"></iframe>`;
  },

  // --- BARU: KOMPONEN KUESIONER ---
  kuisioner_form: function(el, comp){
    const { title, questions, options, table } = comp;

    el.innerHTML = `<div class="title" style="margin-bottom:12px">${title||'Kuesioner'}</div>`;

    const formEl = document.createElement('div');
    formEl.className = 'grid'; // Gunakan grid untuk layout pertanyaan

    questions.forEach((q, index) => {
        const col = document.createElement('div');
        col.className = 'g-12 panel' // Setiap pertanyaan menjadi satu panel penuh

        // Label Pertanyaan
        // Tidak perlu for karena label ini hanya label heading pertanyaan
        col.innerHTML = `<label class="subtle" style="display:block;margin-bottom:10px; font-weight: bold;">${index + 1}. ${q.label}</label>`;

        // Input Radio/Select untuk Jawaban
        const radioGroup = document.createElement('div');
        radioGroup.style.display = 'flex';
        radioGroup.style.gap = '15px';
        radioGroup.style.flexWrap = 'wrap';

        options.forEach(opt => {
            const radioId = `${q.key}-${opt.value}`; // Unique ID untuk input radio
            const radioHtml = `
                <div style="display:flex;align-items:center;gap:4px;">
                    <input type="radio" id="${radioId}" name="${q.key}" data-key="${q.key}" value="${opt.value}" required>
                    <label for="${radioId}" class="subtle" style="margin:0">${opt.label}</label>
                </div>
            `;
            radioGroup.innerHTML += radioHtml;
        });

        col.appendChild(radioGroup);
        formEl.appendChild(col);
    });

    el.appendChild(formEl);

    // Tombol Submit
    const row = document.createElement('div');
    row.className = 'toolbar';
    row.style.marginTop = '20px';

    const submitBtn = document.createElement('button');
    submitBtn.className = 'btn hi';
    submitBtn.textContent = 'Kirim Jawaban';
    submitBtn.onclick = () => {
        const data = PresetUI._collectKuisionerForm(formEl, questions, table);
        if (data) {
            EventBus.emit('kuisioner:submit', { data, table: table });
        } else {
            alert('Mohon jawab semua pertanyaan.');
        }
    };

    row.appendChild(submitBtn);
    el.appendChild(row);
  },

  _collectKuisionerForm: function(scope, questions, kuesionerId) {
      const responses = [];
      const userId = Auth.current?.id;
      if (!userId) { alert('Anda harus login untuk mengisi kuesioner.'); return null; } // Tambahkan alert login

      let allAnswered = true;

      questions.forEach(q => {
          const selectedRadio = scope.querySelector(`input[name="${q.key}"]:checked`);

          if (!selectedRadio) {
              allAnswered = false;
              return;
          }

          responses.push({
              kuesioner_id: Number(kuesionerId),
              user_id: userId,
              pertanyaan_key: q.key,
              jawaban_value: selectedRadio.value,
              submitted_at: new Date().toISOString() // Tambahkan timestamp
          });
      });

      return allAnswered ? responses : null;
  },
  // --- AKHIR KOMPONEN KUESIONER ---

  _renderTableBody(tbody, rows, cols, comp){
    const data = rows;
    tbody.innerHTML='';
    data.forEach(r=>{
      const tr=document.createElement('tr');
      cols.forEach(c=>{
        const v = r[c.key];
        tr.innerHTML += `<td>${c.format? c.format(v,r): (v==null?'':this._escape(String(v)))}</td>`
      })
      const actions = document.createElement('td'); actions.style.textAlign='right';
      const edit=document.createElement('button'); edit.className='btn'; edit.textContent='Edit'; edit.onclick=()=>EventBus.emit(comp.onRowClick||'table:edit', {table:comp.table, row:r, schema:comp.schema});
      const del=document.createElement('button'); del.className='btn bad'; del.style.marginLeft='8px'; del.textContent='Hapus'; del.onclick=()=>EventBus.emit('table:delete', {table:comp.table, row:r});
      actions.appendChild(edit); actions.appendChild(del); tr.appendChild(actions);
      tbody.appendChild(tr);
    })
  },
  _inferColumns(rows){
    const keys = rows[0]? Object.keys(rows[0]): ['id'];
    return keys.map(k=>({key:k,label:k}))
  },
  _inferSchema(model){
    const keys = Object.keys(model||{}).filter(k=>k!=='id');
    return keys.map(k=>({key:k,label:k,type:'text'}))
  },

  // Memperbaiki _inputFor untuk menerima dan menerapkan ID
  _inputFor(f, val, inputId){
    const t = f.type||'text'; const v= (val==null?'':val);
    const idAttr = inputId ? `id="${inputId}"` : '';

    if(t==='select') return `<select ${idAttr} data-key="${f.key}" class="input">${(f.options||[]).map(o=>`<option ${String(o.value)==String(v)?'selected':''} value="${o.value}">${o.label}</option>`).join('')}</select>`
    if(t==='textarea') return `<textarea ${idAttr} data-key="${f.key}" class="input" rows="4">${this._escape(String(v))}</textarea>`
    if(t==='number') return `<input ${idAttr} data-key="${f.key}" class="input" type="number" value="${this._escape(String(v))}"/>`
    if(t==='date') return `<input ${idAttr} data-key="${f.key}" class="input" type="date" value="${this._escape(String(v))}"/>`
    if(t==='email') return `<input ${idAttr} data-key="${f.key}" class="input" type="email" value="${this._escape(String(v))}"/>`
    if(t==='password') return `<input ${idAttr} data-key="${f.key}" class="input" type="password" value="${this._escape(String(v))}"/>`
    return `<input ${idAttr} data-key="${f.key}" class="input" type="text" value="${this._escape(String(v))}"/>`
  },

  _collectForm(scope, schema, id){
    const data = {id};
    schema.forEach(f=>{
      const el = scope.querySelector(`[data-key="${f.key}"]`);
      if(!el) return; let v = el.value;
      if(f.type==='number') v = Number(v);
      data[f.key]=v;
    });
    return data;
  },
  async _resolveData(comp){
    if(Array.isArray(comp.data)) return comp.data;
    if(comp.table) return DataStore.load(comp.table);
    if(typeof comp.dataFn==='function') return await comp.dataFn();
    if(typeof comp.sourceDataFn==='function') return await comp.sourceDataFn();
    return [];
  },
  _escape(s){ return s.replace(/[&<>"']/g, m=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[m])) },

  // --- KOMPONEN WRAPPER LAYOUT (Untuk Sidebar) ---
  layout_wrapper: async function(el, comp){
    // Ini akan menjadi kontainer layout 2 kolom
    el.className = 'dashboard-layout-container';
    el.innerHTML = '';
    const componentPromises = (comp.components||[]).map(async (innerComp)=>{
        const innerEl = document.createElement('div');
        innerEl.className = innerComp.className || 'layout-col';
        el.appendChild(innerEl);
        // Render komponen di dalamnya
        await PresetUI[innerComp.kind]?.(innerEl, innerComp, comp);
    });
    await Promise.all(componentPromises);
  },

  content_wrapper: async function(el, comp){
    // Ini akan menampung konten utama (tabel, chart, dll)
    el.className = 'main-content-area';
    el.innerHTML = '';
    // Kita panggil ulang PresetUI.render untuk merender list komponen di dalam wrapper
    const root = el; // Ganti root ke elemen wrapper
    const componentPromises = (comp.components||[]).map(async (innerComp)=>{
        const innerEl = document.createElement('section');
        // 'grid_layout' akan menjadi panel tersendiri, sisanya mengikuti
        innerEl.className = (innerComp.kind === 'toolbar' || innerComp.kind === 'header') ? 'section-toolbar' : 'panel';
        root.appendChild(innerEl);
        await PresetUI[innerComp.kind]?.(innerEl, innerComp, comp);
    });
    await Promise.all(componentPromises);
  },

  // --- KOMPONEN GRID LAYOUT (Untuk Hasil Kuesioner) ---
  grid_layout: async function(el, comp){
    // el.className = 'grid panel'; // Kita biarkan panel di level content_wrapper, ini cukup 'grid'
    el.className = 'grid';
    el.innerHTML = '';
    const componentPromises = (comp.components||[]).map(async (innerComp)=>{
        const innerEl = document.createElement('section');
        // Gunakan class g-6 untuk membagi 2 kolom, dan jadikan panel.
        innerEl.className = `${innerComp.className || 'g-12'} panel`;
        el.appendChild(innerEl);
        await PresetUI[innerComp.kind]?.(innerEl, innerComp, comp);
    });
    await Promise.all(componentPromises);
  }
};


/*******************
 * EventBus – decouple buttons & actions
 *******************/
const EventBus = {
  _:{},
  on(ev, fn){ (this._[ev]||(this._[ev]=[])).push(fn); },
  emit(ev, payload){ (this._[ev]||[]).forEach(f=>f(payload)); }
};


/*******************
 * App Presets – Login & Dashboard built from components
 *******************/
const Presets = {
  // Config dimuat dari presets.json saat aplikasi di-mount
  _config: null,

  async load() {
    if (this._config) return this._config;
    try {
      const response = await fetch('presets.json');
      if (!response.ok) throw new Error(`Gagal memuat presets.json: ${response.statusText}`);
      const config = await response.json();
      this._config = config;

      // Mengisi konfigurasi API dari JSON
      DataStore.API_BASE = config.api.base;
      DataStore.API_KEY = config.api.key;

      return config;
    } catch (e) {
      console.error("Kesalahan saat memuat konfigurasi:", e);
      alert("Gagal memuat konfigurasi aplikasi. Pastikan file presets.json ada dan valid.");
      throw e;
    }
  },

  login(){
    return this._config.login;
  },

  async dashboard(state){
      const user = Auth.current;
      const view = state.view;
      const chartType = state.chartType || 'pie';
      const config = this._config;

      let mainComponents = [];
      const tableConfigs = config.tables;
      const navViews = config.dashboard.nav_views;

      // 1. Logika Tampilan Utama (Kuesioner, Chart atau Table)
      if (view === 'isi_kuesioner' || view === 'hasil_kuesioner') {
          // Fecth the Kuesioner Metadata dynamically (mengambil kuesioner pertama/aktif, ID 1)
          const kuisionerData = await DataStore.find('kuesioner_meta', 1);

          let skemaKuisioner = null;
          if (kuisionerData) {
              try {
                  // Parse JSON strings fetched from D1
                  skemaKuisioner = {
                      id: kuisionerData.id,
                      judul: kuisionerData.name,
                      questions: JSON.parse(kuisionerData.questions || '[]'),
                      options: JSON.parse(kuisionerData.options || '[]')
                  };
              } catch (e) {
                  console.error("Failed to parse kuesioner JSON from API:", e);
              }
          }

          // Fallback: If no dynamic data, use the static schema from config (for initial demo)
          if (!skemaKuisioner) {
              const staticSkema = config.kuesioner_skema?.q_kepuasan;
              if (staticSkema) {
                   try {
                         skemaKuisioner = {
                              id: staticSkema.id,
                              judul: staticSkema.judul,
                              questions: JSON.parse(staticSkema.questions || '[]'),
                              options: JSON.parse(staticSkema.options || '[]')
                         };
                   } catch (e) {
                         console.error("Failed to parse static kuesioner JSON:", e);
                   }
              }
          }

          // --- Start Building Components ---

          if (!skemaKuisioner) {
              mainComponents = [{ kind: 'header', title: 'Error', subtitle: 'Kuesioner aktif (ID 1) tidak ditemukan atau gagal dimuat.' }];

          } else if (view === 'isi_kuesioner') {
              // 2. Tampilan Isi Kuesioner (Responder)
              mainComponents = [
                  {
                      kind: 'kuisioner_form',
                      title: skemaKuisioner.judul,
                      table: skemaKuisioner.id,
                      questions: skemaKuisioner.questions, // DYNAMICALLY PULLED FROM kuesioner_meta
                      options: skemaKuisioner.options    // DYNAMICALLY PULLED FROM kuesioner_meta
                  }
              ];
          } else if (view === 'hasil_kuesioner') {
              // 3. Tampilan Hasil Kuesioner (Chart)
              const questions = skemaKuisioner.questions;
              const kuisionerId = skemaKuisioner.id;

              // Membuat Chart dan Legend untuk setiap pertanyaan
              const questionComponents = questions.map((q, i) => {
                  const chartDataFn = async () => {
                      const rows = await DataStore.load('kuesioner_respons');
                      // Filter by kuesioner_id AND pertanyaan_key
                      const filtered = rows.filter(r =>
                          Number(r.kuesioner_id) === Number(kuisionerId) && r.pertanyaan_key === q.key
                      );

                      // Hitung frekuensi jawaban
                      const groups = filtered.reduce((m, r) => {
                          m[r.jawaban_value] = (m[r.jawaban_value] || 0) + 1;
                          return m;
                      }, {});

                      // Petakan nilai numerik jawaban ke label (DIPULLED DARI kuesioner_meta.options)
                      const answerLabels = skemaKuisioner.options.reduce((m, o) => { m[o.value] = o.label; return m; }, {});

                      // Urutkan dan format data untuk chart
                      const chartData = skemaKuisioner.options.map(opt => ({
                          label: answerLabels[opt.value],
                          value: groups[opt.value] || 0
                      }));
                      return chartData;
                  };

                  return [
                      { kind: 'chart', title: `Hasil Pertanyaan ${i+1}: ${q.label}`, type: chartType, dataFn: chartDataFn, className: 'g-6' },
                      { kind: 'legend', title: 'Rincian Jawaban', sourceDataFn: chartDataFn, className: 'g-6' }
                  ];
              }).flat();

              // Load total responses to display in header
              const totalResponses = await DataStore.load('kuesioner_respons').then(rows =>
                  rows.filter(r => Number(r.kuesioner_id) === Number(kuisionerId)).length
              );

              mainComponents = [
                  { kind: 'toolbar', actions: [
                      {label:'Pie', action:'state:set', key: 'chartType', value: 'pie', variant: chartType === 'pie' ? 'ok' : 'ghost'},
                      {label:'Bar', action:'state:set', key: 'chartType', value: 'bar', variant: chartType === 'bar' ? 'ok' : 'ghost'},
                  ]},
                  { kind: 'content_wrapper', components: [
                      { kind: 'header', title: `Hasil Kuesioner: ${skemaKuisioner.judul}`, subtitle: `Total ${totalResponses} Respon. Visualisasi Respons per Pertanyaan` },
                      { kind: 'grid_layout', components: questionComponents }
                  ]}
              ];
          }

      } else if (view === 'chart') {
          // Logika Chart Presensi (Existing)
          const chartConfig = config.dashboard.chart_view;
          const tableSource = chartConfig.table;
          const sourceTableConf = tableConfigs[tableSource] || {};

          const chartTypeActions = [
            {label:'Pie', action:'state:set', key: 'chartType', value: 'pie', variant: chartType === 'pie' ? 'ok' : 'ghost'},
            {label:'Bar', action:'state:set', key: 'chartType', value: 'bar', variant: chartType === 'bar' ? 'ok' : 'ghost'},
            {label:'Line', action:'state:set', key: 'chartType', value: 'line', variant: chartType === 'line' ? 'ok' : 'ghost'}
          ];

          mainComponents = [
            {kind: 'toolbar', actions: chartTypeActions},
            {kind:'chart', title: chartConfig.title, type: chartType, dataFn: async ()=>{
              const rows=await DataStore.load(tableSource);
              const groups = rows.reduce((m,r)=>{m[r.status]=(m[r.status]||0)+1;return m},{})
              return Object.entries(groups).map(([label, value]) => ({label, value}));
            }},
            {kind: 'legend', title: 'Rincian Status', sourceDataFn: async ()=>{
              const rows=await DataStore.load(tableSource);
              const groups = rows.reduce((m,r)=>{m[r.status]=(m[r.status]||0)+1;return m},{})
              return Object.entries(groups).map(([label, value]) => ({label, value}));
            }},
            {kind:'table', title:`Ringkas ${sourceTableConf.label || tableSource}`, table:tableSource, onAdd:false}
          ];
      } else {
          // Tampilan Tabel Admin (Users/Presensi/Menu/Review/Kuesioner Admin)
          const tableKey = tableConfigs[view] ? view : 'users';
          const tableConf = tableConfigs[tableKey];

          // 1. Tampilan Admin Kuesioner (CRUD)
          if (tableKey === 'kuesioner_meta') {
             // Kustomisasi kolom agar JSON tidak terlalu panjang di tabel
             const adminKuisionerConf = { ...tableConf, columns: [
                 { key: 'id', label: 'ID' },
                 { key: 'name', label: 'Nama Kuesioner' },
                 {
                   key: 'questions',
                   label: 'Questions',
                   format: (v) => {
                     try {
                       return `Total: ${JSON.parse(v).length} Q`;
                     } catch {
                       return 'Invalid JSON';
                     }
                   }
                 },
                 {
                   key: 'options',
                   label: 'Options',
                   format: (v) => {
                     try {
                       return `Total: ${JSON.parse(v).length} Opt`;
                     } catch {
                       return 'Invalid JSON';
                     }
                   }
                 }
             ]};
             mainComponents = [
                 {kind:'table', ...adminKuisionerConf, onAdd: 'table:add'}
             ];
          } else {
             // Default table view for other tables (users, presensi, kuesioner_respons, etc.)
             mainComponents = [
                 {kind:'table', ...tableConf, onAdd: 'table:add'}
             ];
          }
      }

      // 2. Logika Navigasi (Menu Kiri)
      // Membuat tombol navigasi dari JSON
      const tableNavActions = navViews.map(nav => {
        return {
          label: nav.label,
          action: 'state:set',
          key: 'view',
          value: nav.table,
          variant: nav.table === view ? 'ok' : 'ghost'
        }
      });

      // Pisahkan tombol Logout
      const logoutAction = {label:'Keluar', action:'auth:logout', variant:'warn'};


      return {
        components:[
          // A. Header hanya berisi Title dan Logout
          { kind:'header', title:`Halo, ${user?.name||'User'}`, subtitle:`${user?.email||''}`, actions: [logoutAction] },

          // B. Layout 2-kolom
          { kind: 'layout_wrapper', components: [
              // B1. Sidebar Navigasi (Kolom Kiri)
              {
                  kind:'toolbar',
                  actions: tableNavActions,
                  title: 'Navigasi',
                  className: 'sidebar-nav'
              },
              // B2. Konten Utama (Kolom Kanan)
              { kind: 'content_wrapper', components: mainComponents }
          ]}
        ]
      }
    },

  editorFor(table, row, schema){
    // Tetap generik, menggunakan schema yang diteruskan
    return {
      components:[
        {kind:'header', title:`Edit ${table}`, subtitle:`ID: ${row?.id??'-'}`},
        {kind:'form', title:'Form', table, model: row||{}, schema, actions:[
          {label:'Batal', action:'form:cancel'},
          {label:'Simpan', action:'form:save', variant:'ok'}
        ]}
      ]
    }
  }
};




/*******************
 * App Controller – glue everything together
 *******************/
const App = {
  state:{ view:'users', chartType: 'pie' },
  async mount(){
    // Memuat presets sebelum melanjutkan
    try {
      await Presets.load();
      this.goto(Auth.current? 'dashboard':'login');
      this._bindEvents();
    } catch (e) {
      // Error sudah ditangani di Presets.load, aplikasi berhenti.
    }
  },
  async goto(page, payload){
    const root = document.querySelector('#app');
    if(page==='login'){ await PresetUI.render(root, Presets.login()); this.page='login'; return; }
    if(page==='dashboard'){
      const st = payload?.state || this.state; this.state=st; await PresetUI.render(root, await Presets.dashboard(st)); this.page='dashboard'; return;
    }
    if(page==='editor'){ await PresetUI.render(root, Presets.editorFor(payload.table, payload.row, payload.schema)); this.page='editor'; return; }
  },
  _bindEvents(){
    EventBus.on('auth:login', async ()=>{
      const email = document.querySelector('[data-key="email"]').value.trim();
      const password = document.querySelector('[data-key="password"]').value;
      if(await Auth.login(email,password)) this.goto('dashboard'); else alert('Email/Password salah');
    });
    EventBus.on('auth:register', async ()=>{
      const name = prompt('Nama lengkap?'); const email = prompt('Email?'); const password = prompt('Password?');
      if(!name || !email || !password) return alert('Semua field harus diisi');
      try{ await Auth.register({name,email,password, role:'member'}); alert('Registrasi sukses. Silakan login.'); }
      catch(e){ alert(e.message) }
    });
    EventBus.on('auth:logout', ()=>{ Auth.logout(); this.goto('login') });

    // HANDLER STATE GENERIK (untuk navigasi dashboard)
    EventBus.on('state:set', ({key, value})=>{
        if (key) {
            this.state[key] = value;
            this.goto('dashboard');
        }
    });

    // --- HANDLER KUESIONER BARU ---
    EventBus.on('kuisioner:submit', async ({data, table}) => {
        try {
            // Data adalah array of objects (jawaban per pertanyaan)
            for (const response of data) {
                // table di sini adalah ID Kuesioner (misal: 1), tapi DataStore.upsert
                // akan menggunakan nama tabel 'kuesioner_respons'
                await DataStore.upsert('kuesioner_respons', response);
            }
            alert('Jawaban kuesioner berhasil disimpan! Terima kasih.');
            // Perbarui state untuk menampilkan hasil kuesioner
            App.state.view = 'hasil_kuesioner';
            App.goto('dashboard');
        } catch (e) {
            alert(`Gagal menyimpan jawaban: ${e.message}`);
        }
    });
    // --- AKHIR HANDLER KUESIONER BARU ---

    // CRUD Actions
    EventBus.on('table:add', ({table, schema})=>{
        this.goto('editor', {table, row:{}, schema})
    });

    EventBus.on('table:edit', ({table,row,schema})=>{ this.goto('editor', {table,row,schema}) });

    EventBus.on('table:delete', async ({table,row})=>{
      if(confirm('Hapus data ini?')){
        try {
          await DataStore.remove(table, row.id);
          this.goto('dashboard');
        } catch(e) {
          alert(`Gagal menghapus: ${e.message}`);
        }
      }
    });

    // Form actions
    EventBus.on('form:cancel', ()=>{ this.goto('dashboard') });

    EventBus.on('form:save', async ({data, table})=>{
      try {
          await DataStore.upsert(table, data);
          this.goto('dashboard');
      } catch(e) {
          alert(`Gagal menyimpan: ${e.message}`);
      }
    });
  }
};

// boot
App.mount();
