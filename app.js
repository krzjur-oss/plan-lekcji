'use strict';
// ═══ CONSTANTS ═══
const DB_KEY='planlekcji_v2';
const DAYS=['Poniedziałek','Wtorek','Środa','Czwartek','Piątek'];
const COLORS=['#2563eb','#16a34a','#d97706','#dc2626','#7c3aed','#0891b2','#ea580c','#059669','#db2777','#65a30d','#0284c7','#9333ea'];
const DEFAULT_HOURS=[
  {num:0,start:'07:10',end:'07:55'},
  {num:1,start:'08:00',end:'08:45'},{num:2,start:'08:50',end:'09:35'},
  {num:3,start:'09:45',end:'10:30'},{num:4,start:'10:45',end:'11:30'},
  {num:5,start:'11:40',end:'12:25'},{num:6,start:'12:30',end:'13:15'},
  {num:7,start:'13:20',end:'14:05'},{num:8,start:'14:10',end:'14:55'},
  {num:9,start:'15:00',end:'15:45'}
];
// ═══ STATE ═══
let S={
  meta:{schoolName:'',year:'2024/2025'},
  hours:JSON.parse(JSON.stringify(DEFAULT_HOURS)),
  classes:[],teachers:[],rooms:[],subjects:[],
  schoolGroups:[],  // katalog grup szkolnych: {id,name,color}
  assignments:[],   // groupId:null|id, linkedGroupIds:[]
  lessons:{}        // key classId|day|hour -> {assignmentId} OR dla grup: classId|day|hour|groupId
};
// ═══ PERSISTENCE ═══
function saveState(){S.meta.modifiedAt=new Date().toISOString();try{localStorage.setItem(DB_KEY,JSON.stringify(S));}catch(e){console.warn(e);}}
function loadState(){try{const r=localStorage.getItem(DB_KEY);if(r){const d=JSON.parse(r);Object.assign(S,d);}}catch(e){console.warn(e);}}
// ═══ HELPERS ═══
function uid(){return Date.now().toString(36)+Math.random().toString(36).slice(2,6);}
const byId=(a,id)=>a.find(x=>x.id===id);
const getClass=id=>byId(S.classes,id);
const getTeacher=id=>byId(S.teachers,id);
const getRoom=id=>byId(S.rooms,id);
const getSubject=id=>byId(S.subjects,id);
const getAssign=id=>byId(S.assignments,id);
const getSchoolGroup=id=>byId(S.schoolGroups,id);
// Grupy przypisane do danej klasy (z jej assignments groupId)
function classGroupIds(classId){
  const ids=new Set();
  S.assignments.filter(a=>a.classId===classId&&a.groupId).forEach(a=>ids.add(a.groupId));
  return [...ids];
}
// Etykieta grupy z opcjonalnie połączonymi grupami z innych klas
function groupLabel(a){
  if(!a.groupId)return '';
  const g=getSchoolGroup(a.groupId);
  const gname=g?g.name:'?';
  if(a.linkedGroupIds&&a.linkedGroupIds.length){
    const linkedClasses=a.linkedGroupIds.map(lid=>{const[lcid]=lid.split(':');const lc=getClass(lcid);return lc?lc.name:'?';});
    const allSameGroup=a.linkedGroupIds.every(lid=>lid.split(':')[1]===a.groupId);
    if(allSameGroup){
      const ownClass=getClass(a.classId);
      const allClasses=(ownClass?[ownClass.name]:[]).concat(linkedClasses);
      return gname+'·'+allClasses.join('+');
    }
    const linked=a.linkedGroupIds.map(lid=>{const[lcid,lgid]=lid.split(':');const lc=getClass(lcid),lg=getSchoolGroup(lgid);return(lc?lc.name:'?')+'/'+(lg?lg.name:'?');});
    return gname+'+'+linked.join('+');
  }
  return gname;
}
// Klucz lekcji — dla grup dodajemy groupId żeby wiele grup mogło być w tej samej godzinie
function lkey(c,d,h,groupId){
  return groupId?c+'|'+d+'|'+h+'|'+groupId:c+'|'+d+'|'+h;
}
function getLesson(c,d,h,groupId){return S.lessons[lkey(c,d,h,groupId)]||null;}
function setLesson(c,d,h,aid,groupId){
  const k=lkey(c,d,h,groupId);
  if(aid===null)delete S.lessons[k];
  else S.lessons[k]={assignmentId:aid,locked:false};
  saveState();
}
// Zwraca WSZYSTKIE lekcje dla danej klasy/dnia/godziny (może być wiele przy grupach)
function getLessonsAt(c,d,h){
  const prefix=c+'|'+d+'|'+h;
  return Object.entries(S.lessons)
    .filter(([k])=>k===prefix||k.startsWith(prefix+'|'))
    .map(([k,v])=>({key:k,groupId:k.split('|')[3]||null,...v}));
}
function placedCount(){const m={};for(const l of Object.values(S.lessons))m[l.assignmentId]=(m[l.assignmentId]||0)+1;return m;}
function teacherLoad(){const m={};for(const l of Object.values(S.lessons)){const a=getAssign(l.assignmentId);if(a&&a.teacherId)m[a.teacherId]=(m[a.teacherId]||0)+1;}return m;}
function detectConflicts(){
  const seen={},conf=new Set();
  for(const[k,l]of Object.entries(S.lessons)){
    const parts=k.split('|');const classId=parts[0],d=parts[1],h=parts[2];
    const a=getAssign(l.assignmentId);if(!a)continue;
    const sl=d+'|'+h;
    // Konflikt nauczyciela
    if(a.teacherId){const tk='t|'+a.teacherId+'|'+sl;if(seen[tk]){conf.add(k);conf.add(seen[tk]);}seen[tk]=k;}
    // Konflikt sali
    if(a.roomId){const rk='r|'+a.roomId+'|'+sl;if(seen[rk]){conf.add(k);conf.add(seen[rk]);}seen[rk]=k;}
    // Konflikt grupy — ta sama grupa (schoolGroup) nie może być w dwóch miejscach naraz
    if(a.groupId){const gk='g|'+a.groupId+'|'+sl;if(seen[gk]){conf.add(k);conf.add(seen[gk]);}seen[gk]=k;}
    // Konflikt klas połączonych przez linkedGroupIds
    // WAŻNE: klucz musi zawierać classId żeby odróżnić 'cls1 ma gr1' od 'cls2 ma gr1'
    // i nie powodować self-konfliktu z własnym groupId (który ma ten sam groupId)
    if(a.groupId&&a.linkedGroupIds&&a.linkedGroupIds.length){
      a.linkedGroupIds.forEach(lid=>{
        const[lcid,lgid]=lid.split(':');
        // Pomiń jeśli linkedGroup odnosi się do tej samej klasy (zabezpieczenie)
        if(lcid===classId)return;
        const lgk='g|'+lcid+'|'+lgid+'|'+sl;
        if(seen[lgk]){conf.add(k);conf.add(seen[lgk]);}seen[lgk]=k;
      });
    }
    // Konflikt grupy — ta sama klasa nie może mieć lekcji grupowej i lekcji całej klasy w tym samym slocie
    if(a.groupId){
      // sprawdź czy istnieje lekcja "cała klasa" dla tej samej klasy i slotu
      const wholeClassKey=classId+'|'+sl;
      if(seen['wc|'+wholeClassKey]){conf.add(k);conf.add(seen['wc|'+wholeClassKey]);}
    } else {
      // lekcja całej klasy — sprawdź kolizję z istniejącymi lekcjami grupowymi tej klasy
      const wholeClassKey=classId+'|'+sl;
      seen['wc|'+wholeClassKey]=k;
      // oznacz już zarejestrowane lekcje grupowe tej klasy w tym slocie jako konflikt
      const prefix='gc|'+classId+'|'+sl+'|';
      for(const sk of Object.keys(seen)){if(sk.startsWith(prefix)){conf.add(k);conf.add(seen[sk]);}}
    }
    // Rejestruj lekcję grupową dla potrzeb wykrywania kolizji z "całą klasą"
    if(a.groupId){
      const gcKey='gc|'+classId+'|'+sl+'|'+a.groupId;
      seen[gcKey]=k;
      // sprawdź czy wcześniej zarejestrowano lekcję "cała klasa" dla tej klasy
      if(seen['wc|'+classId+'|'+sl]){conf.add(k);conf.add(seen['wc|'+classId+'|'+sl]);}
    }
  }
  return conf;
}
function hexRgba(hex,a){
  // Normalizuj skrócony zapis (#fff -> #ffffff)
  if(hex&&hex.length===4)hex='#'+hex[1]+hex[1]+hex[2]+hex[2]+hex[3]+hex[3];
  if(!hex||hex.length<7)return`rgba(148,163,184,${a})`;
  const r=parseInt(hex.slice(1,3),16),g=parseInt(hex.slice(3,5),16),b=parseInt(hex.slice(5,7),16);
  return`rgba(${r},${g},${b},${a})`;
}
function esc(s){return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}
// ═══ TIMETABLE ═══
let activeClassId=null,activeView='class',activeViewId=null,dragData=null;
function renderTimetable(){
  const wrap=document.getElementById('timetable-wrapper');if(!wrap)return;
  const conf=detectConflicts();
  if(activeView==='class'){
    if(!activeClassId){wrap.innerHTML='<div class="empty-state"><div class="empty-icon">📅</div>Wybierz klasę z lewego panelu</div>';updateHeader(conf);renderPool();return;}
    wrap.innerHTML='';wrap.appendChild(buildTable((d,h)=>{
      const lessons=getLessonsAt(activeClassId,d,h);
      if(!lessons.length)return null;
      // Jedna lekcja (cała klasa lub jedna grupa) — zwykła karta
      if(lessons.length===1){
        const l=lessons[0];
        return buildCard(getAssign(l.assignmentId),l,l.key,conf.has(l.key));
      }
      // Wiele grup w tej samej godzinie — kontener z wieloma kartami
      const wrap2=document.createElement('div');
      wrap2.className='cell-groups';
      lessons.forEach(l=>{
        const card=buildCard(getAssign(l.assignmentId),l,l.key,conf.has(l.key));
        if(card)wrap2.appendChild(card);
      });
      return wrap2;
    },activeClassId,'class'));
    attachDrop(wrap,activeClassId);
  }else if(activeView==='teacher'){
    wrap.innerHTML='';wrap.appendChild(buildTable((d,h)=>{
      for(const c of S.classes){const l=getLesson(c.id,d,h);if(!l)continue;const a=getAssign(l.assignmentId);if(a&&a.teacherId===activeViewId)return buildCard(a,l,lkey(c.id,d,h),conf.has(lkey(c.id,d,h)),c.name);}return null;
    }));
  }else if(activeView==='room'){
    wrap.innerHTML='';wrap.appendChild(buildTable((d,h)=>{
      for(const c of S.classes){const l=getLesson(c.id,d,h);if(!l)continue;const a=getAssign(l.assignmentId);if(a&&a.roomId===activeViewId)return buildCard(a,l,lkey(c.id,d,h),conf.has(lkey(c.id,d,h)),c.name);}return null;
    }));
  }
  updateHeader(conf);renderPool();highlightSidebar();
}
function buildTable(cellFn,viewId,viewType){
  const tbl=document.createElement('table');tbl.className='timetable';
  const thead=tbl.createTHead(),hr=thead.insertRow();
  hr.innerHTML='<th>Godz.</th>'+DAYS.map(d=>`<th>${d}</th>`).join('');
  const tbody=tbl.createTBody();
  S.hours.forEach((h,hi)=>{
    const tr=tbody.insertRow();
    const _h0=h.num===0?'<span style="font-size:9px;color:var(--text3);display:block;line-height:1;margin-top:1px">nieob.</span>':'';
    tr.innerHTML=`<td class="hour-col"${h.num===0?' title="Godzina nieobowi\u0105zkowa"':''}><span class="hour-num">${h.num}${_h0}</span><span class="hour-time">${h.start}\u2013${h.end}</span></td>`;
    DAYS.forEach((_,di)=>{
      const td=tr.insertCell();td.className='cell';td.dataset.day=di;td.dataset.hour=hi;
      if(viewId)td.dataset.viewId=viewId;if(viewType)td.dataset.viewType=viewType;
      const content=cellFn(di,hi);if(content)td.appendChild(content);
      if(viewType==='class'){
        td.addEventListener('click',e=>{if(e.target.classList.contains('lc-remove')||e.target.closest('.lesson-card'))return;openPicker(viewId,di,hi);});
      }
    });
  });
  return tbl;
}
function buildCard(assign,lesson,key,isConf,extra){
  if(!assign)return null;
  const subj=getSubject(assign.subjectId),teacher=getTeacher(assign.teacherId),room=getRoom(assign.roomId);
  const color=subj&&subj.color?subj.color:'#94a3b8';
  const div=document.createElement('div');
  div.className='lesson-card';div.draggable=true;div.dataset.key=key;div.dataset.assignId=assign.id;
  div.style.borderLeftColor=color;div.style.background=hexRgba(color,0.1);
  const sname=subj?(subj.short||subj.name):'?';
  const tname=teacher?(teacher.short||teacher.name.split(' ').pop()):'';
  const rname=room?(room.short||room.name):'';
  const glabel=groupLabel(assign);
  const sepIdx=glabel?glabel.indexOf('·'):-1;
  const glabelHtml=glabel?(sepIdx>-1?'<div class="lc-group" style="background:'+color+';color:#fff"><span class="lc-group-name">'+esc(glabel.slice(0,sepIdx))+'</span><span class="lc-group-classes">'+esc(glabel.slice(sepIdx+1))+'</span></div>':'<div class="lc-group" style="background:'+color+';color:#fff">'+esc(glabel)+'</div>'):'';
  div.innerHTML=
    glabelHtml+
    '<div class="lc-subject" style="color:'+color+'">'+(extra?'<small style="color:var(--text3);font-weight:400">['+esc(extra)+'] </small>':'')+esc(sname)+'</div>'+
    (tname?'<div class="lc-teacher" style="color:var(--text2)">'+esc(tname)+'</div>':'')+
    (rname?'<div class="lc-room" style="color:var(--text3)">'+esc(rname)+'</div>':'')+
    '<button class="lc-remove" title="Usuń lekcję">\u2715</button>';
  div.querySelector('.lc-remove').addEventListener('click',e=>{
    e.stopPropagation();const parts=key.split('|');const[cid,d,h]=parts;const gid=parts[3]||null;
    setLesson(cid,+d,+h,null,gid);renderTimetable();renderSidebar();
  });
  div.addEventListener('dragstart',e=>{dragData={assignId:assign.id,fromKey:key,type:'grid'};div.classList.add('dragging');e.dataTransfer.effectAllowed='move';e.dataTransfer.setData('text/plain',assign.id);});
  div.addEventListener('dragend',()=>div.classList.remove('dragging'));
  return div;
}
function attachDrop(wrap,classId){
  wrap.querySelectorAll('.cell').forEach(td=>{
    td.addEventListener('dragover',e=>{e.preventDefault();td.classList.add('drag-over');});
    td.addEventListener('dragleave',()=>td.classList.remove('drag-over'));
    td.addEventListener('drop',e=>{
      e.preventDefault();td.classList.remove('drag-over');if(!dragData)return;
      const d=+td.dataset.day,h=+td.dataset.hour;
      const dropAssign=getAssign(dragData.assignId);
      const dropGroupId=dropAssign&&dropAssign.groupId?dropAssign.groupId:null;
      const toKey=lkey(classId,d,h,dropGroupId);
      if(dragData.type==='grid'&&dragData.fromKey&&dragData.fromKey!==toKey){
        const existing=S.lessons[toKey];
        // Przy wymianie przywróć źródłową lekcję pod oryginalny klucz
        const fromAssign=getAssign((S.lessons[dragData.fromKey]||{}).assignmentId);
        const fromGroupId=fromAssign&&fromAssign.groupId?fromAssign.groupId:null;
        const restoredKey=lkey(classId,d,h,fromGroupId);
        if(existing){S.lessons[restoredKey]={...existing};}
        else{delete S.lessons[dragData.fromKey];}
      }
      setLesson(classId,d,h,dragData.assignId,dropGroupId);dragData=null;
      renderTimetable();renderSidebar();notify('Lekcja umieszczona','success');
    });
  });
}
function openPicker(classId,day,hour){
  const cls=getClass(classId),assigns=S.assignments.filter(a=>a.classId===classId);
  if(!assigns.length){notify('Brak przypisań – dodaj je w Dane → Przypisania','info');return;}
  const pc=placedCount(),h=S.hours[hour];
  const rows=assigns.map(a=>{
    const subj=getSubject(a.subjectId),t=getTeacher(a.teacherId),r=getRoom(a.roomId);
    const p=pc[a.id]||0,n=a.hoursPerWeek||0,col=p>=n?'var(--green)':'var(--accent)';
    const grp=a.groupId?getSchoolGroup(a.groupId):null;
    const glbl=groupLabel(a);
    return`<tr class="picker-row" onclick="pickLesson('${classId}',${day},${hour},'${a.id}')">
      <td><span class="color-dot" style="background:${subj&&subj.color?subj.color:'#94a3b8'}"></span></td>
      <td style="font-weight:600;color:${subj&&subj.color?subj.color:'inherit'}">${esc(subj?subj.name:'?')}</td>
      <td style="color:var(--text2)">${esc(t?t.name:'—')}</td>
      <td style="color:var(--text2);font-family:var(--mono)">${esc(r?r.name:'—')}</td>
      <td>${glbl?'<span class="group-chip">'+esc(glbl)+'</span>':'<span style="color:var(--text3)">cała klasa</span>'}</td>
      <td style="color:${col};font-family:var(--mono);font-weight:600">${p}/${n}</td>
    </tr>`;
  }).join('');
  openModal('Wybierz lekcję',
    `<div style="font-size:12px;color:var(--text3);margin-bottom:10px">${esc(cls?cls.name:'')} \u00b7 ${DAYS[day]} \u00b7 lekcja ${h?h.num:''} (${h?h.start+'\u2013'+h.end:''})</div>
    <table class="data-table" style="min-width:440px"><thead><tr><th></th><th>Przedmiot</th><th>Nauczyciel</th><th>Sala</th><th>Grupa</th><th>Godz.</th></tr></thead><tbody>${rows}</tbody></table>`,
    null,false);
}
window.buildGroupOpts=function(classId,selId){
  // Stub — właściwa implementacja uruchamiana przez onchange w kontekście modalAssignment
  // Bezpośrednie wywołanie: budujemy opcje bez kontekstu aktualnego przypisania
  const cls=getClass(classId);
  const grpIds=(cls?(cls.groupIds||[]):[]);
  const sorted=[...grpIds].map(gid=>{const g=getSchoolGroup(gid);return{gid,name:g?g.name:''};}).sort((a,b)=>a.name.localeCompare(b.name,'pl'));
  const opts='<option value="">cała klasa</option>'+sorted.map(({gid})=>{const g=getSchoolGroup(gid);return g?`<option value="${g.id}">${esc(g.name)}</option>`:''}).join('');
  const el=document.getElementById(selId);if(el)el.innerHTML=opts;
  // Wywołaj buildLinkedOpts jeśli istnieje w bieżącym kontekście
  if(typeof window._modalBuildLinkedOpts==='function')window._modalBuildLinkedOpts();
};
window.buildLinkedOpts=function(){if(typeof window._modalBuildLinkedOpts==='function')window._modalBuildLinkedOpts();};
window.pickLesson=function(cid,d,h,aid){
  const a=getAssign(aid);
  const groupId=a&&a.groupId?a.groupId:null;
  setLesson(cid,+d,+h,aid,groupId);
  closeModal();renderTimetable();renderSidebar();
};
function renderPool(){
  const pool=document.getElementById('lesson-pool');if(!pool)return;
  if(activeView!=='class'||!activeClassId){pool.innerHTML='<div class="pool-empty">Wybierz klasę aby zobaczyć lekcje</div>';return;}
  const assigns=S.assignments.filter(a=>a.classId===activeClassId);
  if(!assigns.length){pool.innerHTML='<div class="pool-empty">Brak przypisań dla tej klasy.<br>Dodaj w Dane \u2192 Przypisania</div>';return;}
  const pc=placedCount(),bySubj={};
  assigns.forEach(a=>{(bySubj[a.subjectId]=bySubj[a.subjectId]||[]).push(a);});
  let html='';
  for(const[sid,arr]of Object.entries(bySubj)){
    const subj=getSubject(sid);
    html+='<div class="pool-section"><div class="pool-sec-title">'+esc(subj?subj.name:'?')+'</div><div class="pool-items">';
    arr.forEach(a=>{
      const t=getTeacher(a.teacherId),r=getRoom(a.roomId),color=subj&&subj.color?subj.color:'#94a3b8';
      const p=pc[a.id]||0,n=a.hoursPerWeek||0,cls2=p>=n?'done':p>n?'over':'';
      const ts=t?(t.short||t.name.split(' ').map(w=>w[0]).join('')):'—';
      html+=`<div class="pool-item" draggable="true" data-assign-id="${a.id}" title="${esc(subj?subj.name:'')} \u00b7 ${esc(t?t.name:'brak')} \u00b7 ${esc(r?r.name:'brak')}">
        <span class="pool-dot" style="background:${color}"></span>
        <span class="pool-subj" style="color:${color}">${esc(subj?(subj.short||subj.name):'?')}</span>
        <span class="pool-meta">${esc(ts)}</span>
        <span class="pool-meta">${esc(r?r.name:'—')}</span>
        <span class="pool-count ${cls2}">${p}/${n}</span>
      </div>`;
    });
    html+='</div></div>';
  }
  pool.innerHTML=html;
  pool.querySelectorAll('.pool-item').forEach(el=>{
    el.addEventListener('dragstart',e=>{dragData={assignId:el.dataset.assignId,fromKey:null,type:'pool'};e.dataTransfer.effectAllowed='copy';e.dataTransfer.setData('text/plain',el.dataset.assignId);});
  });
}
function updateHeader(conf){
  const title=document.getElementById('view-title'),meta=document.getElementById('view-meta'),badge=document.getElementById('conflict-badge');
  if(activeView==='class'&&activeClassId){
    const cls=getClass(activeClassId);title.textContent=cls?'Klasa '+cls.name:'Plan lekcji';
    const placed=Object.keys(S.lessons).filter(k=>k.startsWith(activeClassId+'|')).length;
    const needed=S.assignments.filter(a=>a.classId===activeClassId).reduce((s,a)=>s+(a.hoursPerWeek||0),0);
    meta.textContent=placed+' / '+needed+' godz. umieszczono';
  }else if(activeView==='teacher'&&activeViewId){
    const t=getTeacher(activeViewId);title.textContent=t?'Nauczyciel: '+t.name:'Plan nauczyciela';
    const load=teacherLoad();meta.textContent=(load[activeViewId]||0)+' / '+(t?t.maxHours||18:18)+' godz/tyg';
  }else if(activeView==='room'&&activeViewId){
    const r=getRoom(activeViewId);title.textContent=r?'Sala: '+r.name:'Plan sali';meta.textContent='';
  }else{title.textContent='Plan lekcji';meta.textContent='';}
  if(!conf)conf=detectConflicts();
  if(badge){
    if(conf.size>0)badge.innerHTML='<span class="badge-conflict">\u26a0 '+conf.size+' konflikt'+(conf.size===1?'':'ów')+'</span>';
    else if(activeClassId||activeViewId)badge.innerHTML='<span class="badge-ok">\u2713 Brak konfliktów</span>';
    else badge.innerHTML='';
  }
}
function highlightSidebar(){
  document.querySelectorAll('#sb-classes .sb-item').forEach(el=>el.classList.toggle('active',el.dataset.id===activeClassId&&activeView==='class'));
  document.querySelectorAll('#sb-teachers .sb-item').forEach(el=>el.classList.toggle('active',el.dataset.id===activeViewId&&activeView==='teacher'));
  document.querySelectorAll('#sb-rooms .sb-item').forEach(el=>el.classList.toggle('active',el.dataset.id===activeViewId&&activeView==='room'));
}
// ═══ APP ═══
let currentTab='timetable',dataSubTab='classes',modalOkFn=null;
// ═══ PWA INSTALL ═══
let _installPrompt = null;

window.addEventListener('beforeinstallprompt', e => {
  // Chrome fires this when app CAN be installed
  e.preventDefault();
  _installPrompt = e;
  const btn = document.getElementById('btn-install');
  if (btn) btn.style.display = 'inline-flex';
});

window.addEventListener('appinstalled', () => {
  _installPrompt = null;
  const btn = document.getElementById('btn-install');
  if (btn) btn.style.display = 'none';
  notify('Aplikacja zainstalowana ✓', 'success');
});

function installPWA() {
  if (!_installPrompt) {
    notify('Instalacja niedostępna. Otwórz przez HTTPS i odświeź stronę.', 'info');
    return;
  }
  _installPrompt.prompt();
  _installPrompt.userChoice.then(choice => {
    if (choice.outcome === 'accepted') {
      notify('Instalowanie...', 'success');
    }
    _installPrompt = null;
    const btn = document.getElementById('btn-install');
    if (btn) btn.style.display = 'none';
  });
}

document.addEventListener('DOMContentLoaded',()=>{
  loadState();
  if(!S.schoolGroups)S.schoolGroups=[];
  renderAll();renderHours();applySettings();
  requestAnimationFrame(()=>switchDataTab('classes'));
  if(S.classes.length)setActiveClass(S.classes[0].id);
  if('serviceWorker'in navigator)navigator.serviceWorker.register('./sw.js').catch(()=>{});
  setInterval(()=>{saveState();},30000);
  document.addEventListener('keydown',e=>{
    if(e.key==='Escape'){
      if(document.getElementById('aboutModal').classList.contains('open')){
        document.getElementById('aboutModal').classList.remove('open');return;
      }
      if(document.getElementById('wizardOverlay').classList.contains('open')){
        wizardClose();return;
      }
      closeModal();
    }
    if((e.ctrlKey||e.metaKey)&&e.key==='s'){e.preventDefault();doSave();}
  });
  // Pokaż stronę startową przy pierwszym uruchomieniu lub braku danych
  const hasData = S.classes.length > 0 || S.teachers.length > 0 || S.rooms.length > 0;
  if(!hasData){
    showWelcomeScreen();
  }
  // Sprawdź szkic kreatora (tylko gdy nie ma danych i nie otwieramy kreatora)
});
function doSave(){saveState();notify('Zapisano \u2713','success');}
function renderAll(){renderSidebar();renderTimetable();}
function renderSidebar(){
  // classes
  const sc=document.getElementById('sb-classes');
  if(!S.classes.length){sc.innerHTML='<div class="sb-empty">Brak klas</div>';}
  else{const lkeys=Object.keys(S.lessons);sc.innerHTML=alphaSort(S.classes,'name').map(c=>{
    const cnt=lkeys.filter(k=>k.startsWith(c.id+'|')).length;
    return`<div class="sb-item" data-id="${c.id}" onclick="setActiveClass('${c.id}')">
      <span class="sb-dot" style="background:${c.color||'#94a3b8'}"></span>
      <span class="sb-label">${esc(c.name)}</span><span class="sb-badge">${cnt}</span>
      <span class="sb-actions">
        <button onclick="event.stopPropagation();modalClass('${c.id}')" title="Edytuj">\u270f\ufe0f</button>
        <button onclick="event.stopPropagation();deleteClass('${c.id}')" title="Usu\u0144">\uD83D\uDDD1</button>
      </span></div>`;}).join('');}
  // teachers
  const st=document.getElementById('sb-teachers');
  if(!S.teachers.length){st.innerHTML='<div class="sb-empty">Brak nauczycieli</div>';}
  else{const load=teacherLoad();st.innerHTML=alphaSort(S.teachers,'name').map(t=>`
    <div class="sb-item" data-id="${t.id}" onclick="setActiveTeacher('${t.id}')">
      <span class="sb-dot" style="background:#7c3aed"></span>
      <span class="sb-label">${esc(t.name)}</span><span class="sb-badge">${load[t.id]||0}h</span>
      <span class="sb-actions">
        <button onclick="event.stopPropagation();modalTeacher('${t.id}')" title="Edytuj">\u270f\ufe0f</button>
        <button onclick="event.stopPropagation();deleteTeacher('${t.id}')" title="Usu\u0144">\uD83D\uDDD1</button>
      </span></div>`).join('');}
  // rooms
  const sr=document.getElementById('sb-rooms');
  if(!S.rooms.length){sr.innerHTML='<div class="sb-empty">Brak sal</div>';}
  else{sr.innerHTML=alphaSort(S.rooms,'name').map(r=>`
    <div class="sb-item" data-id="${r.id}" onclick="setActiveRoom('${r.id}')">
      <span class="sb-dot" style="background:#0891b2"></span>
      <span class="sb-label">${esc(r.name)}</span>
      <span class="sb-actions">
        <button onclick="event.stopPropagation();modalRoom('${r.id}')" title="Edytuj">\u270f\ufe0f</button>
        <button onclick="event.stopPropagation();deleteRoom('${r.id}')" title="Usu\u0144">\uD83D\uDDD1</button>
      </span></div>`).join('');}
  highlightSidebar();
}
function setActiveClass(id){activeClassId=id;activeView='class';activeViewId=null;switchTab('timetable');renderAll();}
function setActiveTeacher(id){activeViewId=id;activeView='teacher';switchTab('timetable');renderAll();}
function setActiveRoom(id){activeViewId=id;activeView='room';switchTab('timetable');renderAll();}
function switchTab(tab){
  currentTab=tab;
  document.querySelectorAll('.top-tab').forEach(t=>t.classList.toggle('active',t.dataset.tab===tab));
  document.querySelectorAll('.page').forEach(p=>p.classList.toggle('active',p.id==='page-'+tab));
  // Prawy panel tylko w zakładce Plan lekcji
  const sr=document.getElementById('sidebar-right');
  if(sr){sr.style.display=tab==='timetable'?'':'none';}
  document.getElementById('app').classList.toggle('no-right-panel',tab!=='timetable');
  // Odśwież zawartość aktywnej zakładki po zmianie widoczności DOM
  requestAnimationFrame(()=>{
    if(tab==='data')switchDataTab(dataSubTab);
    else if(tab==='stats')renderStats();
    else if(tab==='settings')applySettings();
    else if(tab==='plachta')renderPlachta();
  });
}
const ADD_LABELS={classes:'+ Klasa',teachers:'+ Nauczyciel',rooms:'+ Sala',subjects:'+ Przedmiot',assignments:'+ Przypisanie',groups:'+ Grupa',hours:'+ Lekcja'};
function switchDataTab(tab){
  dataSubTab=tab;
  document.querySelectorAll('.tab-btn[data-dtab]').forEach(b=>b.classList.toggle('active',b.dataset.dtab===tab));
  document.querySelectorAll('.data-sub').forEach(d=>d.classList.toggle('show',d.id==='dsub-'+tab));
  const btn=document.getElementById('data-add-btn');if(btn)btn.textContent=ADD_LABELS[tab]||'+ Dodaj';
  if(tab==='classes')renderTableClasses();
  else if(tab==='teachers')renderTableTeachers();
  else if(tab==='rooms')renderTableRooms();
  else if(tab==='subjects')renderTableSubjects();
  else if(tab==='assignments')renderTableAssignments();
  else if(tab==='groups')renderTableGroups();
  else if(tab==='hours')renderHours();
}
function dataAddAction(){({classes:modalClass,teachers:modalTeacher,rooms:modalRoom,subjects:modalSubject,assignments:modalAssignment,groups:modalSchoolGroup,hours:addHour}[dataSubTab]||function(){})();}
// TABLE RENDERERS
const alphaSort=(arr,key)=>[...arr].sort((a,b)=>String(a[key]||'').localeCompare(String(b[key]||''),'pl',{sensitivity:'base'}));
let assignSortBy='class';
function renderTableClasses(){
  const tb=document.getElementById('tbody-classes');if(!tb)return;
  if(!S.classes.length){tb.innerHTML='<tr class="empty-row"><td colspan="5">Brak klas. Kliknij + Klasa aby dodać.</td></tr>';return;}
  tb.innerHTML=alphaSort(S.classes,'name').map(c=>{
    const grpNames=(c.groupIds||[]).map(id=>{const g=getSchoolGroup(id);return g?g.name:id;}).join(', ');
    return`<tr>
      <td><span class="color-dot" style="background:${c.color||'#94a3b8'}"></span></td>
      <td style="font-weight:600">${esc(c.name)}</td>
      <td style="color:var(--text2)">${c.year||'—'}</td>
      <td style="color:var(--text2)">${c.students||'—'}</td>
      <td style="font-size:11.5px;color:var(--text2)">${grpNames||'<span style="color:var(--text3)">brak grup</span>'}</td>
      <td><div class="td-actions"><button class="btn btn-ghost btn-sm" onclick="modalClass('${c.id}')">Edytuj</button><button class="btn btn-danger btn-sm" onclick="deleteClass('${c.id}')">Usuń</button></div></td>
    </tr>`;}).join('');
}
function renderTableTeachers(){
  const tb=document.getElementById('tbody-teachers');if(!tb)return;
  if(!S.teachers.length){tb.innerHTML='<tr class="empty-row"><td colspan="6">Brak nauczycieli.</td></tr>';return;}
  const load=teacherLoad();
  // Sortuj po nazwisku (lastname), fallback na name
  const sorted=[...S.teachers].sort((a,b)=>{const la=(a.lastname||a.name||'').toLowerCase(),lb=(b.lastname||b.name||'').toLowerCase();return la.localeCompare(lb,'pl');});
  tb.innerHTML=sorted.map(t=>{
    const first=t.firstname||t.name.split(' ')[0]||'';
    const last=t.lastname||t.name.split(' ').slice(1).join(' ')||t.name||'';
    const subjs=(t.subjects||[]).map(id=>{const s=getSubject(id);return s?s.name:id;}).join(', ');
    return`<tr>
      <td>${esc(first)}</td>
      <td style="font-weight:600">${esc(last)}</td>
      <td style="font-family:var(--mono);color:var(--text2)">${esc(t.short||'—')}</td>
      <td style="color:var(--text2);font-size:11.5px">${esc(subjs)||'—'}</td>
      <td style="font-family:var(--mono)">${load[t.id]||0} / ${t.maxHours||18}</td>
      <td><div class="td-actions"><button class="btn btn-ghost btn-sm" onclick="modalTeacher('${t.id}')">Edytuj</button><button class="btn btn-danger btn-sm" onclick="deleteTeacher('${t.id}')">Usuń</button></div></td>
    </tr>`;}).join('');
}
function renderTableRooms(){
  const tb=document.getElementById('tbody-rooms');if(!tb)return;
  if(!S.rooms.length){tb.innerHTML='<tr class="empty-row"><td colspan="5">Brak sal.</td></tr>';return;}
  const types={classroom:'Sala lekcyjna',lab:'Laboratorium',gym:'Hala/Si\u0142ownia',computer:'Informatyczna',music:'Muzyczna',art:'Plastyczna',other:'Inna'};
  tb.innerHTML=alphaSort(S.rooms,'name').map(r=>`<tr>
    <td style="font-weight:600">${esc(r.name)}</td>
    <td style="font-family:var(--mono);color:var(--text2)">${esc(r.short||'—')}</td>
    <td style="color:var(--text2)">${types[r.type]||r.type||'—'}</td>
    <td style="font-family:var(--mono)">${r.capacity||'—'}</td>
    <td><div class="td-actions"><button class="btn btn-ghost btn-sm" onclick="modalRoom('${r.id}')">Edytuj</button><button class="btn btn-danger btn-sm" onclick="deleteRoom('${r.id}')">Usuń</button></div></td>
  </tr>`).join('');
}
function renderTableSubjects(){
  const tb=document.getElementById('tbody-subjects');if(!tb)return;
  if(!S.subjects.length){tb.innerHTML='<tr class="empty-row"><td colspan="4">Brak przedmiotów.</td></tr>';return;}
  tb.innerHTML=alphaSort(S.subjects,'name').map(s=>`<tr>
    <td><span class="color-dot" style="background:${s.color||'#94a3b8'}"></span></td>
    <td style="font-weight:600;color:${s.color||'inherit'}">${esc(s.name)}</td>
    <td style="font-family:var(--mono);color:var(--text2)">${esc(s.short||'—')}</td>
    <td><div class="td-actions"><button class="btn btn-ghost btn-sm" onclick="modalSubject('${s.id}')">Edytuj</button><button class="btn btn-danger btn-sm" onclick="deleteSubject('${s.id}')">Usuń</button></div></td>
  </tr>`).join('');
}
function renderTableAssignments(){
  const tb=document.getElementById('tbody-assignments');if(!tb)return;
  document.querySelectorAll('.assign-sort-btn').forEach(b=>b.classList.toggle('active',b.dataset.sort===assignSortBy));
  if(!S.assignments.length){tb.innerHTML='<tr class="empty-row"><td colspan="9">Brak przypisań.</td></tr>';return;}
  const pc=placedCount();
  const sorted=[...S.assignments].sort((a,b)=>{
    let ka='',kb='';
    if(assignSortBy==='class'){const ca=getClass(a.classId),cb=getClass(b.classId);ka=ca?ca.name:'';kb=cb?cb.name:'';}
    else if(assignSortBy==='teacher'){const ta=getTeacher(a.teacherId),tb2=getTeacher(b.teacherId);ka=ta?ta.name:'';kb=tb2?tb2.name:'';}
    else if(assignSortBy==='room'){const ra=getRoom(a.roomId),rb=getRoom(b.roomId);ka=ra?ra.name:'';kb=rb?rb.name:'';}
    const r=ka.localeCompare(kb,'pl',{sensitivity:'base'});
    if(r!==0)return r;
    const ca=getClass(a.classId),cb=getClass(b.classId);
    return(ca?ca.name:'').localeCompare(cb?cb.name:'','pl',{sensitivity:'base'});
  });
  tb.innerHTML=sorted.map(a=>{
    const cls=getClass(a.classId),subj=getSubject(a.subjectId),t=getTeacher(a.teacherId),r=getRoom(a.roomId);
    const grp=a.groupId?getSchoolGroup(a.groupId):null;
    const glbl=groupLabel(a);
    const p=pc[a.id]||0,n=a.hoursPerWeek||0;
    const col=p>=n?'var(--green)':p>0?'var(--yellow)':'var(--text3)';
    return`<tr>
      <td><span class="color-dot" style="background:${cls&&cls.color?cls.color:'#94a3b8'}"></span> <strong>${esc(cls?cls.name:'?')}</strong></td>
      <td style="font-weight:600;color:${subj&&subj.color?subj.color:'inherit'}">${esc(subj?subj.name:'?')}</td>
      <td style="color:var(--text2)">${esc(t?t.name:'—')}</td>
      <td style="font-family:var(--mono);color:var(--text2)">${esc(r?r.name:'—')}</td>
      <td>${grp?'<span class="group-chip">'+esc(grp.name)+'</span>':'<span style="color:var(--text3);font-size:11px">cała klasa</span>'}</td>
      <td style="font-size:11px;color:var(--text2)">${(a.linkedGroupIds&&a.linkedGroupIds.length)?a.linkedGroupIds.map(lid=>{const[lc,lg]=lid.split(':');const cc=getClass(lc),gg=getSchoolGroup(lg);return(cc?cc.name:'?')+'/'+(gg?gg.name:'?');}).join(', '):'—'}</td>
      <td style="font-family:var(--mono);font-weight:600">${n}</td>
      <td style="font-family:var(--mono);color:${col};font-weight:600">${p}/${n}</td>
      <td><div class="td-actions"><button class="btn btn-ghost btn-sm" onclick="modalAssignment('${a.id}')">Edytuj</button><button class="btn btn-danger btn-sm" onclick="deleteAssignment('${a.id}')">Usuń</button></div></td>
    </tr>`;}).join('');
}
// HOURS
function renderHours(){
  const list=document.getElementById('hours-list');if(!list)return;
  list.innerHTML=S.hours.map((h,i)=>`<div class="hour-row">
    <span class="hour-num-lbl">${h.num}</span>
    <input class="time-input" type="time" value="${h.start}" onchange="S.hours[${i}].start=this.value;saveState()">
    <span class="time-sep">–</span>
    <input class="time-input" type="time" value="${h.end}" onchange="S.hours[${i}].end=this.value;saveState()">
    <button class="btn btn-danger btn-sm btn-icon" onclick="removeHour(${i})" title="Usu\u0144">\u2715</button>
  </div>`).join('');
}
function addHour(){const last=S.hours[S.hours.length-1];const nextNum=last?last.num+1:1;S.hours.push({num:nextNum,start:'00:00',end:'00:00'});saveState();renderHours();renderTimetable();}
function removeHour(i){S.hours.splice(i,1);const base=S.hours.length&&S.hours[0].num===0?0:1;S.hours.forEach((h,idx)=>h.num=base+idx);saveState();renderHours();renderTimetable();}
// STATS
function renderStats(){
  const el=document.getElementById('stats-content');if(!el)return;
  const conf=detectConflicts(),load=teacherLoad();
  el.innerHTML=`<div class="stat-cards">
    ${sc('Klasy',S.classes.length,'#2563eb')}${sc('Nauczyciele',S.teachers.length,'#7c3aed')}
    ${sc('Sale',S.rooms.length,'#0891b2')}${sc('Konflikty',conf.size,conf.size>0?'#dc2626':'#16a34a')}
  </div>
  <div class="stats-grid">
    <div class="stats-block"><div class="stats-block-title">Kompletno\u015b\u0107 planu – klasy</div>
    ${S.classes.map(c=>{
      const n=S.assignments.filter(a=>a.classId===c.id).reduce((s,a)=>s+(a.hoursPerWeek||0),0);
      const p=Object.keys(S.lessons).filter(k=>k.startsWith(c.id+'|')).length;
      const pct=n>0?Math.round(p/n*100):0,col=pct===100?'#16a34a':pct>50?'#d97706':'#2563eb';
      return`<div class="progress-row"><div class="progress-row-head"><span style="font-weight:600;color:${c.color||'inherit'}">${esc(c.name)}</span><span style="font-family:var(--mono);color:var(--text2)">${p}/${n}</span></div><div class="progress-bar"><div class="progress-fill" style="width:${pct}%;background:${col}"></div></div></div>`;
    }).join('')||'<div style="color:var(--text3);font-size:12px">Brak klas</div>'}
    </div>
    <div class="stats-block"><div class="stats-block-title">Obci\u0105\u017cenie nauczycieli</div>
    ${S.teachers.map(t=>{
      const h=load[t.id]||0,max=t.maxHours||18,pct=Math.min(100,Math.round(h/max*100));
      const col=h>max?'#dc2626':h>=max*.9?'#d97706':'#16a34a';
      return`<div class="progress-row"><div class="progress-row-head"><span>${esc(t.name)}</span><span style="font-family:var(--mono);color:${col};font-weight:600">${h}/${max}h</span></div><div class="progress-bar"><div class="progress-fill" style="width:${pct}%;background:${col}"></div></div></div>`;
    }).join('')||'<div style="color:var(--text3);font-size:12px">Brak nauczycieli</div>'}
    </div>
  </div>`;
}
function sc(lbl,val,color){return`<div class="stat-card" style="border-top-color:${color}"><div class="stat-val" style="color:${color}">${val}</div><div class="stat-lbl">${lbl}</div></div>`;}
// SETTINGS
function applySettings(){
  const e1=document.getElementById('set-school'),e2=document.getElementById('set-year');
  if(e1)e1.value=S.meta.schoolName||'';if(e2)e2.value=S.meta.year||'';
}
function saveSettings(){
  S.meta.schoolName=document.getElementById('set-school').value||'';
  S.meta.year=document.getElementById('set-year').value||'';
  saveState();notify('Ustawienia zapisane','success');
}
function clearAllData(){if(!confirm('Usun\u0105\u0107 WSZYSTKIE dane? Operacja nieodwracalna!'))return;localStorage.removeItem(DB_KEY);location.reload();}
// MODAL
function openModal(title,bodyHtml,onOk,showFooter=true){
  modalOkFn=onOk;
  document.getElementById('modal-title').textContent=title;
  document.getElementById('modal-body').innerHTML=bodyHtml;
  document.getElementById('modal-footer').style.display=showFooter?'flex':'none';
  document.getElementById('modal-overlay').classList.add('open');
  setTimeout(()=>{const first=document.querySelector('#modal-body input,#modal-body select');if(first)first.focus();},50);
}
function closeModal(){document.getElementById('modal-overlay').classList.remove('open');modalOkFn=null;window._modalBuildLinkedOpts=null;}
function confirmModal(){if(modalOkFn)modalOkFn();}
// CRUD: CLASSES
function modalClass(id){
  const c=id?getClass(id):null,color=c?c.color:COLORS[S.classes.length%COLORS.length];
  const allGroups=S.schoolGroups;
  const classGroupIdSet=new Set(c?c.groupIds||[]:[]);
  const groupCheckboxes=allGroups.length
    ?allGroups.map(g=>`<label class="form-checkbox"><input type="checkbox" value="${g.id}" ${classGroupIdSet.has(g.id)?'checked':''}><span class="group-chip" style="border-color:${g.color}">${esc(g.name)}</span></label>`).join('')
    :'<span style="color:var(--text3);font-size:12px">Brak grup szkolnych. Dodaj je w Dane \u2192 Grupy.</span>';
  openModal(id?'Edytuj klas\u0119':'Dodaj klas\u0119',`
    <div class="form-group"><label class="form-label">Nazwa klasy *</label><input id="fc-name" class="form-input" placeholder="np. 1A, 2B" value="${esc(c?c.name:'')}"></div>
    <div class="form-row">
      <div class="form-group"><label class="form-label">Poziom</label><input id="fc-year" class="form-input" type="number" min="1" max="8" placeholder="1" value="${c?c.year||'':''}"></div>
      <div class="form-group"><label class="form-label">Uczniowie</label><input id="fc-students" class="form-input" type="number" min="1" placeholder="30" value="${c?c.students||'':''}"></div>
    </div>
    <div class="form-group"><label class="form-label">Kolor</label><div class="color-row"><input id="fc-color" class="form-color" type="color" value="${color}"><span style="font-size:12px;color:var(--text2)">Kolor identyfikacyjny klasy</span></div></div>
    <div class="form-group"><label class="form-label">Grupy w tej klasie</label><div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:4px" id="fc-groups">${groupCheckboxes}</div></div>`,
  ()=>{
    const name=document.getElementById('fc-name').value.trim();if(!name){notify('Podaj nazw\u0119 klasy','error');return;}
    const groupIds=[...document.querySelectorAll('#fc-groups input:checked')].map(cb=>cb.value);
    const data={name,year:+document.getElementById('fc-year').value||null,students:+document.getElementById('fc-students').value||null,color:document.getElementById('fc-color').value,groupIds};
    if(id)Object.assign(getClass(id),data);else S.classes.push({id:uid(),...data});
    saveState();closeModal();renderAll();renderTableClasses();notify(id?'Klasa zaktualizowana':'Klasa dodana','success');
  });
}
function deleteClass(id){
  if(!confirm('Usun\u0105\u0107 klas\u0119? Wszystkie jej lekcje zostan\u0105 usuni\u0119te.'))return;
  S.classes=S.classes.filter(c=>c.id!==id);S.assignments=S.assignments.filter(a=>a.classId!==id);
  for(const k of Object.keys(S.lessons))if(k.startsWith(id+'|'))delete S.lessons[k];
  if(activeClassId===id)activeClassId=S.classes[0]?S.classes[0].id:null;
  saveState();renderAll();renderTableClasses();
}
// CRUD: TEACHERS
function genTeacherShort(first,last){
  // Algorytm skrótu:
  // Nazwisko jednoczłonowe: pierwsza litera imienia + 3 pierwsze litery nazwiska → "JKow"
  // Nazwisko dwuczłonowe (Kowalski-Nowak): pierwsza litera imienia + pierwsza litera każdego członu → "JKN"
  const f=(first||'').trim();
  const l=(last||'').trim();
  if(!f||!l)return '';
  const fi=f[0].toUpperCase();
  const parts=l.split(/[-\s]+/).filter(Boolean);
  if(parts.length>=2){
    // Dwuczłonowe: inicjały każdego członu
    return fi+parts.map(p=>p[0].toUpperCase()).join('');
  }
  // Jednoczłonowe: pierwsza litera imienia + 3 pierwsze litery nazwiska
  return fi+(l.slice(0,3).charAt(0).toUpperCase()+l.slice(1,3).toLowerCase());
}
function modalTeacher(id){
  const t=id?getTeacher(id):null;
  // Rozdziel istniejące imię i nazwisko (wsteczna kompatybilność: t.name = "Jan Kowalski")
  let initFirst='',initLast='';
  if(t){
    if(t.firstname!==undefined){initFirst=t.firstname||'';initLast=t.lastname||'';}
    else{const parts=(t.name||'').trim().split(/\s+/);initFirst=parts[0]||'';initLast=parts.slice(1).join(' ');}
  }
  const subjOpts=alphaSort(S.subjects,"name").map(s=>`<option value="${s.id}" ${t&&(t.subjects||[]).includes(s.id)?'selected':''}>${esc(s.name)}</option>`).join('');
  openModal(id?'Edytuj nauczyciela':'Dodaj nauczyciela',`
    <div class="form-row">
      <div class="form-group"><label class="form-label">Imi\u0119 *</label><input id="ft-first" class="form-input" placeholder="Jan" value="${esc(initFirst)}"></div>
      <div class="form-group"><label class="form-label">Nazwisko *</label><input id="ft-last" class="form-input" placeholder="Kowalski" value="${esc(initLast)}"></div>
    </div>
    <div class="form-group" style="margin-top:-4px">
      <label class="form-label">Skr\u00f3t <small style="text-transform:none;font-weight:400;color:var(--text3)">— generowany automatycznie, mo\u017cesz zmieni\u0107</small></label>
      <div style="display:flex;gap:6px;align-items:center">
        <input id="ft-short" class="form-input" placeholder="JKow" value="${esc(t?t.short||'':'')}" style="font-family:var(--mono);max-width:90px">
        <button type="button" class="btn btn-ghost btn-sm" onclick="document.getElementById('ft-short').value=genTeacherShort(document.getElementById('ft-first').value,document.getElementById('ft-last').value)" title="Odśwież skrót" style="flex-shrink:0">\u21bb Generuj</button>
      </div>
    </div>
    <div class="form-group"><label class="form-label">Nauczane przedmioty <small style="text-transform:none;font-weight:400">(Ctrl+klik = wiele)</small></label>
      <select id="ft-subjects" class="form-select" multiple size="5">${subjOpts||'<option disabled>Najpierw dodaj przedmioty</option>'}</select></div>
    <div class="form-group"><label class="form-label">Pensum (godz/tyg)</label><input id="ft-max" class="form-input" type="number" min="1" max="40" value="${t?t.maxHours||18:18}"></div>`,
  ()=>{
    const first=document.getElementById('ft-first').value.trim();
    const last=document.getElementById('ft-last').value.trim();
    if(!first||!last){notify('Podaj imi\u0119 i nazwisko','error');return;}
    const name=first+' '+last;
    let short=document.getElementById('ft-short').value.trim();
    if(!short)short=genTeacherShort(first,last);
    const subjects=Array.from(document.getElementById('ft-subjects').selectedOptions).map(o=>o.value);
    const data={name,firstname:first,lastname:last,short,subjects,maxHours:+document.getElementById('ft-max').value||18};
    if(id)Object.assign(getTeacher(id),data);else S.teachers.push({id:uid(),...data});
    saveState();closeModal();renderAll();renderTableTeachers();notify(id?'Nauczyciel zaktualizowany':'Nauczyciel dodany','success');
  });
  // Auto-generuj skrót przy otwieraniu formularza (tylko dla nowego nauczyciela)
  if(!id)setTimeout(()=>{const fi=document.getElementById('ft-first'),la=document.getElementById('ft-last'),sh=document.getElementById('ft-short');if(fi&&la&&sh){fi.addEventListener('input',()=>{if(!sh._userEdited)sh.value=genTeacherShort(fi.value,la.value);});la.addEventListener('input',()=>{if(!sh._userEdited)sh.value=genTeacherShort(fi.value,la.value);});sh.addEventListener('input',()=>{sh._userEdited=sh.value!==genTeacherShort(fi.value,la.value);});}},50);
}
function deleteTeacher(id){if(!confirm('Usun\u0105\u0107 nauczyciela?'))return;S.teachers=S.teachers.filter(t=>t.id!==id);saveState();renderAll();renderTableTeachers();}
// CRUD: ROOMS
function modalRoom(id){
  const r=id?getRoom(id):null;
  const types=[['classroom','Sala lekcyjna'],['lab','Laboratorium'],['gym','Hala/Si\u0142ownia'],['computer','Informatyczna'],['music','Muzyczna'],['art','Plastyczna'],['other','Inna']];
  openModal(id?'Edytuj sal\u0119':'Dodaj sal\u0119',`
    <div class="form-row">
      <div class="form-group"><label class="form-label">Nazwa sali *</label><input id="fr-name" class="form-input" placeholder="101, Chemiczna" value="${esc(r?r.name:'')}"></div>
      <div class="form-group"><label class="form-label">Skr\u00f3t</label><input id="fr-short" class="form-input" placeholder="101" value="${esc(r?r.short||'':'')}"></div>
    </div>
    <div class="form-row">
      <div class="form-group"><label class="form-label">Typ sali</label><select id="fr-type" class="form-select">${types.map(([v,l])=>`<option value="${v}" ${r&&r.type===v?'selected':''}>${l}</option>`).join('')}</select></div>
      <div class="form-group"><label class="form-label">Pojemno\u015b\u0107</label><input id="fr-cap" class="form-input" type="number" min="1" placeholder="30" value="${r?r.capacity||'':''}"></div>
    </div>`,
  ()=>{
    const name=document.getElementById('fr-name').value.trim();if(!name){notify('Podaj nazw\u0119 sali','error');return;}
    const data={name,short:document.getElementById('fr-short').value.trim(),type:document.getElementById('fr-type').value,capacity:+document.getElementById('fr-cap').value||null};
    if(id)Object.assign(getRoom(id),data);else S.rooms.push({id:uid(),...data});
    saveState();closeModal();renderAll();renderTableRooms();notify(id?'Sala zaktualizowana':'Sala dodana','success');
  });
}
function deleteRoom(id){if(!confirm('Usun\u0105\u0107 sal\u0119?'))return;S.rooms=S.rooms.filter(r=>r.id!==id);saveState();renderAll();renderTableRooms();}
// CRUD: SUBJECTS
function modalSubject(id){
  const s=id?getSubject(id):null,color=s?s.color:COLORS[S.subjects.length%COLORS.length];
  openModal(id?'Edytuj przedmiot':'Dodaj przedmiot',`
    <div class="form-row">
      <div class="form-group"><label class="form-label">Nazwa *</label><input id="fs-name" class="form-input" placeholder="Matematyka" value="${esc(s?s.name:'')}"></div>
      <div class="form-group"><label class="form-label">Skr\u00f3t</label><input id="fs-short" class="form-input" placeholder="Mat" value="${esc(s?s.short||'':'')}"></div>
    </div>
    <div class="form-group"><label class="form-label">Kolor na planie</label><div class="color-row"><input id="fs-color" class="form-color" type="color" value="${color}"><span style="font-size:12px;color:var(--text2)">Kolor wyró\u017cniaj\u0105cy przedmiot na siatce</span></div></div>`,
  ()=>{
    const name=document.getElementById('fs-name').value.trim();if(!name){notify('Podaj nazw\u0119 przedmiotu','error');return;}
    const data={name,short:document.getElementById('fs-short').value.trim(),color:document.getElementById('fs-color').value};
    if(id)Object.assign(getSubject(id),data);else S.subjects.push({id:uid(),...data});
    saveState();closeModal();renderAll();renderTableSubjects();notify(id?'Przedmiot zaktualizowany':'Przedmiot dodany','success');
  });
}
function deleteSubject(id){if(!confirm('Usun\u0105\u0107 przedmiot?'))return;S.subjects=S.subjects.filter(s=>s.id!==id);saveState();renderAll();renderTableSubjects();}
// CRUD: ASSIGNMENTS
function modalAssignment(id){
  const a=id?getAssign(id):null;
  const co=alphaSort(S.classes,"name").map(c=>`<option value="${c.id}" ${a&&a.classId===c.id?'selected':''}>${esc(c.name)}</option>`).join('');
  const so=alphaSort(S.subjects,"name").map(s=>`<option value="${s.id}" ${a&&a.subjectId===s.id?'selected':''}>${esc(s.name)}</option>`).join('');
  const to='<option value="">\u2014 brak \u2014</option>'+alphaSort(S.teachers,'name').map(t=>`<option value="${t.id}" ${a&&a.teacherId===t.id?'selected':''}>${esc(t.name)}</option>`).join('');
  const ro='<option value="">\u2014 brak \u2014</option>'+alphaSort(S.rooms,'name').map(r=>`<option value="${r.id}" ${a&&a.roomId===r.id?'selected':''}>${esc(r.name)}</option>`).join('');
  // Buduj opcje grup dynamicznie po wyborze klasy
  const buildGroupOpts=(classId,selId)=>{
    const cls=getClass(classId);
    const grpIds=cls?cls.groupIds||[]:[];
    const opts='<option value="">cała klasa</option>'+grpIds.map(gid=>{const g=getSchoolGroup(gid);return g?`<option value="${g.id}" ${a&&a.groupId===g.id?'selected':''}>${esc(g.name)}</option>`:''}).join('');
    const el=document.getElementById(selId);if(el)el.innerHTML=opts;
  };
  // Buduj opcje połączonych grup (inne klasy × ich grupy)
  const buildLinkedOpts=()=>{
    const selCls=document.getElementById('fa-cls');
    const selGrp=document.getElementById('fa-grp');
    if(!selCls||!selGrp)return;
    const curClassId=selCls.value,curGroupId=selGrp.value;
    if(!curGroupId){document.getElementById('fa-linked-wrap').style.display='none';return;}
    document.getElementById('fa-linked-wrap').style.display='';
    const curGroup=getSchoolGroup(curGroupId);
    const linked=new Set(a?(a.linkedGroupIds||[]):[]);
    // Pokaż wszystkie klasy które mają tę samą grupę, oprócz bieżącej klasy
    const rows=S.classes.filter(c=>c.id!==curClassId&&(c.groupIds||[]).includes(curGroupId)).map(c=>{
      const lid=c.id+':'+curGroupId;
      return`<label class="form-checkbox"><input type="checkbox" class="fa-linked-cb" value="${lid}" ${linked.has(lid)?'checked':''}><span>${esc(c.name)} / ${esc(curGroup?curGroup.name:'?')}</span></label>`;
    });
    document.getElementById('fa-linked-list').innerHTML=rows.length?rows.join(''):'<span style="color:var(--text3);font-size:11px">Brak innych klas z tą grupą</span>';
  };
  const gopts='<option value="">cała klasa</option>'+(a&&a.classId?((getClass(a.classId)||{}).groupIds||[]).map(gid=>{const g=getSchoolGroup(gid);return g?`<option value="${g.id}" ${a.groupId===g.id?'selected':''}>${esc(g.name)}</option>`:''}).join(''):'');
  openModal(id?'Edytuj przypisanie':'Dodaj przypisanie',`
    <div class="form-group"><label class="form-label">Klasa *</label><select id="fa-cls" class="form-select" onchange="buildGroupOpts(this.value,'fa-grp');buildLinkedOpts()">${co||'<option disabled>Brak klas</option>'}</select></div>
    <div class="form-group"><label class="form-label">Przedmiot *</label><select id="fa-subj" class="form-select">${so||'<option disabled>Brak przedmiot\u00f3w</option>'}</select></div>
    <div class="form-group"><label class="form-label">Nauczyciel</label><select id="fa-teach" class="form-select">${to}</select></div>
    <div class="form-group"><label class="form-label">Sala</label><select id="fa-room" class="form-select">${ro}</select></div>
    <div class="form-group"><label class="form-label">Dotyczy grupy</label><select id="fa-grp" class="form-select" onchange="buildLinkedOpts()">${gopts}</select><div style="font-size:11px;color:var(--text3);margin-top:4px">Zostaw puste jeśli lekcja dotyczy całej klasy</div></div>
    <div id="fa-linked-wrap" style="display:none">
      <div class="form-group"><label class="form-label">Połącz z grupami z innych klas</label><div id="fa-linked-list" style="display:flex;flex-direction:column;gap:6px;margin-top:4px"></div><div style="font-size:11px;color:var(--text3);margin-top:4px">Zaznacz klasy których ta sama grupa uczestniczy razem (np. WF chłopcy z 1A+1B)</div></div>
    </div>
    <div class="form-group"><label class="form-label">Godzin / tydzie\u0144 *</label><input id="fa-hrs" class="form-input" type="number" min="1" max="30" value="${a?a.hoursPerWeek||2:2}"></div>`,
  ()=>{
    const classId=document.getElementById('fa-cls').value,subjectId=document.getElementById('fa-subj').value;
    if(!classId||!subjectId){notify('Wybierz klas\u0119 i przedmiot','error');return;}
    const groupId=document.getElementById('fa-grp').value||null;
    const linkedGroupIds=[...document.querySelectorAll('.fa-linked-cb:checked')].map(cb=>cb.value);
    const data={classId,subjectId,teacherId:document.getElementById('fa-teach').value||null,roomId:document.getElementById('fa-room').value||null,groupId,linkedGroupIds,hoursPerWeek:+document.getElementById('fa-hrs').value||1};
    if(id)Object.assign(getAssign(id),data);else S.assignments.push({id:uid(),...data});
    saveState();closeModal();renderPool();renderTableAssignments();notify(id?'Przypisanie zaktualizowane':'Przypisanie dodane','success');
  });
  // Rejestruj lokalne funkcje budowania opcji dla globalnych stubów
  window._modalBuildLinkedOpts=buildLinkedOpts;
  // Inicjuj opcje grup i połączeń po otwarciu modalu
  setTimeout(()=>{
    const cls=document.getElementById('fa-cls');
    if(cls&&cls.value)buildGroupOpts(cls.value,'fa-grp');
    buildLinkedOpts();
  },30);
}
// ── GRUPY SZKOLNE ──────────────────────────────────────────────────
function renderTableGroups(){
  const tb=document.getElementById('tbody-groups');if(!tb)return;
  if(!S.schoolGroups.length){tb.innerHTML='<tr class="empty-row"><td colspan="4">Brak grup szkolnych. Kliknij + Grupa aby dodać.</td></tr>';return;}
  tb.innerHTML=alphaSort(S.schoolGroups,'name').map(g=>{
    // Zbierz klasy używające tej grupy
    const usedIn=S.classes.filter(c=>(c.groupIds||[]).includes(g.id)).map(c=>c.name).join(', ');
    return`<tr>
      <td><span class="color-dot" style="background:${g.color||'#94a3b8'}"></span></td>
      <td style="font-weight:600">${esc(g.name)}</td>
      <td style="color:var(--text2);font-size:11.5px">${usedIn||'<span style="color:var(--text3)">—</span>'}</td>
      <td><div class="td-actions"><button class="btn btn-ghost btn-sm" onclick="modalSchoolGroup('${g.id}')">Edytuj</button><button class="btn btn-danger btn-sm" onclick="deleteSchoolGroup('${g.id}')">Usuń</button></div></td>
    </tr>`;}).join('');
}
function modalSchoolGroup(id){
  const g=id?getSchoolGroup(id):null;
  const color=g?g.color:COLORS[S.schoolGroups.length%COLORS.length];
  openModal(id?'Edytuj grup\u0119':'Dodaj grup\u0119 szkoln\u0105',`
    <div class="form-group"><label class="form-label">Nazwa grupy *</label>
      <input id="fsg-name" class="form-input" placeholder="np. gr.1, gr.2, ch\u0142opcy, j.ang-A" value="${esc(g?g.name:'')}">
      <div style="font-size:11px;color:var(--text3);margin-top:4px">Nazwa b\u0119dzie wida\u0107 na kartach lekcji i w planie</div>
    </div>
    <div class="form-group"><label class="form-label">Kolor grupy</label>
      <div class="color-row"><input id="fsg-color" class="form-color" type="color" value="${color}">
      <span style="font-size:12px;color:var(--text2)">Kolor paska grupy na karcie lekcji</span></div>
    </div>`,
  ()=>{
    const name=document.getElementById('fsg-name').value.trim();
    if(!name){notify('Podaj nazw\u0119 grupy','error');return;}
    const data={name,color:document.getElementById('fsg-color').value};
    if(id)Object.assign(getSchoolGroup(id),data);
    else S.schoolGroups.push({id:uid(),...data});
    saveState();closeModal();renderTableGroups();
    notify(id?'Grupa zaktualizowana':'Grupa dodana','success');
  });
}
function deleteSchoolGroup(id){
  const usedIn=S.classes.filter(c=>(c.groupIds||[]).includes(id));
  const usedAssign=S.assignments.filter(a=>a.groupId===id||(a.linkedGroupIds||[]).some(l=>l.includes(id)));
  if(usedIn.length||usedAssign.length){
    if(!confirm('Ta grupa jest używana w klasach i/lub przypisaniach. Usunąć mimo to?'))return;
    // Wyćzyś z klas
    S.classes.forEach(c=>{c.groupIds=(c.groupIds||[]).filter(g=>g!==id);});
    // Wyćzyś z przypisań
    S.assignments.forEach(a=>{
      if(a.groupId===id)a.groupId=null;
      a.linkedGroupIds=(a.linkedGroupIds||[]).filter(l=>!l.includes(id));
    });
  }else{
    if(!confirm('Usunąć grupę?'))return;
  }
  S.schoolGroups=S.schoolGroups.filter(g=>g.id!==id);
  saveState();renderAll();renderTableGroups();renderTableClasses();
}
function deleteAssignment(id){
  if(!confirm('Usun\u0105\u0107 przypisanie?'))return;
  S.assignments=S.assignments.filter(a=>a.id!==id);
  for(const[k,l]of Object.entries(S.lessons))if(l.assignmentId===id)delete S.lessons[k];
  saveState();renderAll();renderTableAssignments();
}
// ══════════════════════════════════════════════════════════
// KOPIUJ PLAN — nowy rok lub korekta w ciągu roku
// ══════════════════════════════════════════════════════════
function nextYearString(year){
  const m=String(year||'').match(/(\d{4})\s*\/\s*(\d{4})/);
  if(m){const y=parseInt(m[1])+1;return y+'/'+(y+1);}
  const y=parseInt(year);if(!isNaN(y))return(y+1)+''+(y+2);
  return '';
}

function showNewYear(){
  const hasData=S.classes.length>0;
  const suggestedYear=nextYearString(S.meta.year)||'';

  function buildPromoteGrid(){
    return alphaSort(S.classes,'name').map(c=>{
      const levels=[1,2,3,4,5,6,7,8];
      const levelOpts='<option value="keep">bez zmiany ('+( c.year||'?')+')</option>'+
        '<option value="drop">— usuń klasę —</option>'+
        levels.map(l=>`<option value="${l}" ${(c.year||0)+1===l?'selected':''}>${l}. poziom</option>`).join('');
      return`<div class="ny-promote-row">
        <span class="cls-dot" style="background:${c.color||'#94a3b8'}"></span>
        <span style="font-weight:600;color:${c.color||'inherit'};min-width:44px;flex-shrink:0">${esc(c.name)}</span>
        <span class="arrow">→</span>
        <select data-cls-id="${c.id}" class="ny-cls-level">${levelOpts}</select>
      </div>`;
    }).join('');
  }

  const body=`
    <div class="ny-section">
      <div class="ny-section-title"><span class="ny-icon">🎯</span> Cel operacji</div>
      <div class="ny-options">
        <label class="ny-option selected" id="ny-goal-nextyear">
          <input type="radio" name="ny-goal" value="nextyear" checked>
          <div class="ny-option-body">
            <div class="ny-option-label">Nowy rok szkolny</div>
            <div class="ny-option-desc">Tworzysz kopię planu na kolejny rok. Możesz awansować klasy, zmienić rok szkolny i wybrać co przenieść.</div>
          </div>
        </label>
        <label class="ny-option" id="ny-goal-midyear">
          <input type="radio" name="ny-goal" value="midyear">
          <div class="ny-option-body">
            <div class="ny-option-label">Korekta planu w ciągu roku</div>
            <div class="ny-option-desc">Tworzysz kopię bieżącego planu bez żadnych zmian — identyczny rok, klasy i lekcje. Modyfikujesz kopię, oryginał zostaje.</div>
          </div>
        </label>
      </div>
    </div>

    <div id="ny-nextyear-cfg">
      <div class="ny-section">
        <div class="ny-section-title"><span class="ny-icon">🗓</span> Rok szkolny</div>
        <div class="ny-year-input">
          <input id="ny-year" class="form-input" placeholder="np. 2025/2026" value="${esc(suggestedYear)}" style="max-width:150px">
          <span style="font-size:11px;color:var(--text3)">Rok szkolny w kopii</span>
        </div>
      </div>

      <div class="ny-section">
        <div class="ny-section-title"><span class="ny-icon">📋</span> Co przenieść?</div>
        <div class="ny-options">
          <label class="ny-option selected" id="ny-opt-full">
            <input type="radio" name="ny-mode" value="full" checked>
            <div class="ny-option-body">
              <div class="ny-option-label">Pełny szablon — struktura + plan lekcji</div>
              <div class="ny-option-desc">Kopiuje klasy, nauczycieli, sale, przedmioty, przypisania i ułożone lekcje.</div>
            </div>
          </label>
          <label class="ny-option" id="ny-opt-struct">
            <input type="radio" name="ny-mode" value="struct">
            <div class="ny-option-body">
              <div class="ny-option-label">Tylko struktura — bez układu lekcji</div>
              <div class="ny-option-desc">Kopiuje klasy, nauczycieli, przedmioty i przypisania, ale <strong>czyści plan</strong>. Układasz od nowa.</div>
            </div>
          </label>
          <label class="ny-option" id="ny-opt-bare">
            <input type="radio" name="ny-mode" value="bare">
            <div class="ny-option-body">
              <div class="ny-option-label">Tylko zasoby — nauczyciele, sale, przedmioty</div>
              <div class="ny-option-desc">Klasy i przypisania dodajesz od nowa.</div>
            </div>
          </label>
        </div>
      </div>

      ${hasData?`
      <div class="ny-section" id="ny-promote-section">
        <div class="ny-section-title" style="justify-content:space-between">
          <span><span class="ny-icon">🎓</span> Promocja klas</span>
          <label style="display:flex;align-items:center;gap:5px;font-size:11px;font-weight:400;text-transform:none;letter-spacing:0;cursor:pointer;color:var(--text2)">
            <input type="checkbox" id="ny-promote-on" style="accent-color:var(--accent)">
            włącz promocję
          </label>
        </div>
        <div id="ny-promote-body" style="display:none">
          <div style="font-size:11px;color:var(--text3);margin-bottom:8px">Ustaw poziom każdej klasy w nowym roku. Domyślnie każda awansuje o jeden poziom.</div>
          <div class="ny-promote-grid">${buildPromoteGrid()}</div>
        </div>
        <div id="ny-promote-off-msg" style="font-size:11px;color:var(--text3);padding:6px 0">Klasy zostaną skopiowane bez zmian poziomów. Zaznacz powyżej aby edytować awanse.</div>
      </div>`:''}
    </div>

    <div class="ny-section">
      <div class="ny-section-title"><span class="ny-icon">💾</span> Opcje zapisu</div>
      <div class="ny-options">
        <label class="ny-option selected" id="ny-save-export">
          <input type="radio" name="ny-save" value="export" checked>
          <div class="ny-option-body">
            <div class="ny-option-label">Eksportuj jako plik JSON</div>
            <div class="ny-option-desc">Pobierz kopię jako plik. Bieżący plan pozostaje bez zmian.</div>
          </div>
        </label>
        <label class="ny-option" id="ny-save-load">
          <input type="radio" name="ny-save" value="load">
          <div class="ny-option-body">
            <div class="ny-option-label">Załaduj od razu i zastąp bieżące dane</div>
            <div class="ny-option-desc"><span class="ny-warn">⚠ Zastąpi aktualny plan!</span> Wyeksportuj go najpierw jeśli chcesz zachować.</div>
          </div>
        </label>
      </div>
    </div>`;

  openModal('📆 Kopiuj plan', body, ()=>{
    const goal=document.querySelector('input[name="ny-goal"]:checked')?.value||'nextyear';
    const saveMode=document.querySelector('input[name="ny-save"]:checked')?.value||'export';

    let newState;
    if(goal==='midyear'){
      // Tryb korekty: identyczna głęboka kopia bez żadnych zmian
      newState=JSON.parse(JSON.stringify(S));
      newState.meta.modifiedAt=new Date().toISOString();
    } else {
      const newYear=document.getElementById('ny-year').value.trim();
      if(!newYear){notify('Podaj rok szkolny','error');return;}
      const mode=document.querySelector('input[name="ny-mode"]:checked')?.value||'full';
      const promoteOn=document.getElementById('ny-promote-on')?.checked||false;

      // Zbierz awanse — jeśli promocja wyłączona, każda klasa dostaje 'keep'
      const promotions={};
      if(promoteOn){
        document.querySelectorAll('.ny-cls-level').forEach(sel=>{
          promotions[sel.dataset.clsId]=sel.value;
        });
      } else {
        S.classes.forEach(c=>{promotions[c.id]='keep';});
      }
      newState=buildNextYearState(mode, newYear, promotions);
    }

    const label=goal==='midyear'?'kopia_planu':
      (document.getElementById('ny-year')?.value||'nowy_rok').replace(/[\s\/]/g,'_');
    const fname=`plan_${label}_${(S.meta.schoolName||'szkola').replace(/\s+/g,'_')}.json`;

    if(saveMode==='export'){
      dl(JSON.stringify(newState,null,2),fname,'application/json');
      closeModal();
      notify('Plan wyeksportowany jako JSON ✓','success');
    } else {
      closeModal();
      setTimeout(()=>{
        Object.assign(S,newState);
        activeClassId=S.classes.length?S.classes[0].id:null;
        activeView='class';activeViewId=null;
        saveState();renderAll();renderHours();applySettings();
        notify('Plan załadowany ✓','success');
      },50);
    }
  });

  // Interaktywność modalu
  setTimeout(()=>{
    // Przełącznik celu
    document.querySelectorAll('input[name="ny-goal"]').forEach(r=>{
      r.addEventListener('change',()=>{
        syncOptionHighlight('ny-goal');
        const cfg=document.getElementById('ny-nextyear-cfg');
        if(cfg)cfg.style.display=r.value==='midyear'?'none':'';
      });
    });
    // Tryb co przenieść
    document.querySelectorAll('input[name="ny-mode"]').forEach(r=>{
      r.addEventListener('change',()=>{
        syncOptionHighlight('ny-mode');
        const sec=document.getElementById('ny-promote-section');
        if(sec)sec.style.display=r.value==='bare'?'none':'';
      });
    });
    // Checkbox promocji
    const promCb=document.getElementById('ny-promote-on');
    if(promCb){
      promCb.addEventListener('change',()=>{
        const on=promCb.checked;
        document.getElementById('ny-promote-body').style.display=on?'':'none';
        document.getElementById('ny-promote-off-msg').style.display=on?'none':'';
      });
    }
    // Zapis
    document.querySelectorAll('input[name="ny-save"]').forEach(r=>{
      r.addEventListener('change',()=>syncOptionHighlight('ny-save','ny-save'));
    });
    function syncOptionHighlight(name,idPrefix){
      const checked=document.querySelector(`input[name="${name}"]:checked`);
      if(!checked)return;
      // Podświetl parent .ny-option
      const allOpts=checked.closest('.ny-options')?.querySelectorAll('.ny-option');
      if(allOpts)allOpts.forEach(o=>o.classList.remove('selected'));
      checked.closest('.ny-option')?.classList.add('selected');
    }
  },30);
}

function buildNextYearState(mode, newYear, promotions){
  const deep=obj=>JSON.parse(JSON.stringify(obj));

  const ns={
    meta:{...deep(S.meta), year:newYear, modifiedAt:new Date().toISOString()},
    hours:deep(S.hours),
    rooms:deep(S.rooms),
    teachers:deep(S.teachers),
    subjects:deep(S.subjects),
    schoolGroups:deep(S.schoolGroups),
    classes:[],
    assignments:[],
    lessons:{}
  };

  if(mode==='bare') return ns;

  // Mapuj stare ID klas → nowe ID; 'drop' pomija klasę, 'keep' zachowuje poziom
  const classIdMap={};
  S.classes.forEach(c=>{
    const action=promotions[c.id]||'keep';
    if(action==='drop')return;
    const newLevel=(!action||action==='keep')
      ? (c.year||null)
      : +action;
    const newCls={...deep(c), id:uid(), year:newLevel};
    ns.classes.push(newCls);
    classIdMap[c.id]=newCls.id;
  });

  // Przypisania — tylko dla klas które przetrwały
  S.assignments.forEach(a=>{
    const newClassId=classIdMap[a.classId];
    if(!newClassId)return;
    const newAssign={...deep(a), id:uid(), classId:newClassId};
    if(newAssign.linkedGroupIds&&newAssign.linkedGroupIds.length){
      newAssign.linkedGroupIds=newAssign.linkedGroupIds
        .filter(lid=>!!classIdMap[lid.split(':')[0]])
        .map(lid=>{const[lcid,lgid]=lid.split(':');return classIdMap[lcid]+':'+lgid;});
    }
    ns.assignments.push(newAssign);
    classIdMap['assign:'+a.id]=newAssign.id;
  });

  if(mode==='full'){
    Object.entries(S.lessons).forEach(([key,lesson])=>{
      const parts=key.split('|');
      const newClassId=classIdMap[parts[0]];if(!newClassId)return;
      const newAssignId=classIdMap['assign:'+lesson.assignmentId];if(!newAssignId)return;
      const newKey=parts[3]?newClassId+'|'+parts[1]+'|'+parts[2]+'|'+parts[3]:newClassId+'|'+parts[1]+'|'+parts[2];
      ns.lessons[newKey]={assignmentId:newAssignId,locked:lesson.locked||false};
    });
  }
  return ns;
}
// IMPORT/EXPORT
function showImportExport(){
  openModal('Import / Eksport',`
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">
      <div><div style="font-size:11px;font-weight:600;color:var(--text2);text-transform:uppercase;letter-spacing:.06em;margin-bottom:10px">Eksport</div>
        <div style="display:flex;flex-direction:column;gap:7px">
          <button class="btn btn-primary" onclick="exportNative();closeModal()">💾 Zapisz plan (.json)</button>
          <button class="btn btn-ghost" onclick="exportPlanSal();closeModal()">\uD83D\uDD04 Eksport do Plan-sal</button>
          <button class="btn btn-ghost" onclick="exportAllCSV();closeModal()">📊 Eksport wszystkich klas CSV</button>
          ${activeClassId?`<button class="btn btn-ghost" onclick="exportCSV('${activeClassId}');closeModal()">📋 CSV \u2013 bieżąca klasa</button>`:''}
        </div>
      </div>
      <div><div style="font-size:11px;font-weight:600;color:var(--text2);text-transform:uppercase;letter-spacing:.06em;margin-bottom:10px">Import</div>
        <div class="drop-zone" id="drop-zone" onclick="document.getElementById('file-imp').click()">
          <div style="font-size:28px;margin-bottom:6px">\uD83D\uDCC2</div>
          <div>Kliknij lub przeci\u0105gnij plik JSON</div>
          <div style="font-size:11px;margin-top:4px;color:var(--text3)">PlanLekcji .json \u00b7 Plan-sal .json</div>
        </div>
        <input type="file" id="file-imp" accept=".json" style="display:none" onchange="doImport(event)">
      </div>
    </div>`,null,false);
  setTimeout(()=>{
    const dz=document.getElementById('drop-zone');if(!dz)return;
    dz.addEventListener('dragover',e=>{e.preventDefault();dz.classList.add('drag-on');});
    dz.addEventListener('dragleave',()=>dz.classList.remove('drag-on'));
    dz.addEventListener('drop',e=>{e.preventDefault();dz.classList.remove('drag-on');const f=e.dataTransfer.files[0];if(f)readFile(f);});
  },50);
}
function doImport(e){const f=e.target.files[0];if(f)readFile(f);}
function readFile(file){
  const r=new FileReader();
  r.onload=e=>{const res=importJSON(e.target.result);closeModal();if(res.ok){renderAll();if(currentTab!=='data')switchTab('data');else switchDataTab('classes');notify(res.msg||'Zaimportowano ✓ — dane widoczne w zakładce Dane','success');}else notify('Błąd importu: '+res.error,'error');};
  r.readAsText(file);
}
function importJSON(text){
  try{
    const d=JSON.parse(text);
    if(d._format&&d._format.startsWith('plansal')){
      // Reset stanu przed importem
      S.classes=[];S.teachers=[];S.rooms=[];S.subjects=[];
      S.schoolGroups=[];S.assignments=[];S.lessons={};S.hours=JSON.parse(JSON.stringify(DEFAULT_HOURS));S.meta={schoolName:'',year:'2024/2025'};
      if(d.rooms)S.rooms=d.rooms;if(d.teachers)S.teachers=d.teachers;if(d.classes)S.classes=d.classes;
      if(d.subjects)S.subjects=d.subjects;if(d.schoolGroups)S.schoolGroups=d.schoolGroups;if(d.assignments)S.assignments=d.assignments;if(d.hours)S.hours=d.hours;
      if(d.meta)Object.assign(S.meta,d.meta);
      if(d.schedule){S.lessons={};for(const e of d.schedule){const a=S.assignments.find(x=>x.classId===e.classId&&x.subjectId===e.subjectId&&x.teacherId===e.teacherId);if(a)S.lessons[lkey(e.classId,e.day,e.hour)]={assignmentId:a.id,locked:e.locked||false};}}
      saveState();return{ok:true,msg:'Zaimportowano dane z Plan-sal'};
    }
    if(d.classes&&d.teachers){
      // Migracja: uzupełnij brakujące pola dla starszych plików
      if(!d.schoolGroups)d.schoolGroups=[];
      if(!d.assignments)d.assignments=[];
      if(!d.lessons)d.lessons={};
      if(!d.hours||!d.hours.length)d.hours=JSON.parse(JSON.stringify(DEFAULT_HOURS));
      // Reset stanu przed importem — zapobiega mieszaniu starych i nowych danych
      S.classes=[];S.teachers=[];S.rooms=[];S.subjects=[];
      S.schoolGroups=[];S.assignments=[];S.lessons={};S.hours=JSON.parse(JSON.stringify(DEFAULT_HOURS));S.meta={schoolName:'',year:'2024/2025'};
      Object.assign(S,d);
      saveState();return{ok:true,msg:'Dane zaimportowane pomyślnie'};
    }
    return{ok:false,error:'Nierozpoznany format pliku'};
  }catch(e){return{ok:false,error:e.message};}
}
function exportNative(){dl(JSON.stringify(S,null,2),`plan_${(S.meta.schoolName||'szkola').replace(/\s+/g,'_')}_${Date.now()}.json`,'application/json');}
function exportPlanSal(){
  const out={_format:'plansal-v1',_generated:new Date().toISOString(),meta:S.meta,hours:S.hours,rooms:S.rooms,teachers:S.teachers,classes:S.classes,subjects:S.subjects,schoolGroups:S.schoolGroups,assignments:S.assignments,
    schedule:Object.entries(S.lessons).map(([k,l])=>{const[cid,d,h]=k.split('|');const a=getAssign(l.assignmentId);const subj=getSubject(a?a.subjectId:null);return{classId:cid,day:+d,hour:+h,subjectId:a?a.subjectId:null,subjectName:subj?subj.name:null,teacherId:a?a.teacherId:null,roomId:a?a.roomId:null,locked:l.locked||false};})
  };
  dl(JSON.stringify(out,null,2),`plan_sal_${Date.now()}.json`,'application/json');
}
function exportCSV(classId){
  const cls=getClass(classId);if(!cls)return;
  const rows=[['Lekcja',...DAYS]];
  S.hours.forEach((h,hi)=>{
    const row=[`${h.num}. ${h.start}-${h.end}`];
    DAYS.forEach((_,di)=>{const l=getLesson(classId,di,hi);if(l){const a=getAssign(l.assignmentId);const s=getSubject(a?a.subjectId:null);const t=getTeacher(a?a.teacherId:null);const r=getRoom(a?a.roomId:null);row.push(`${s?s.name:''}${t?' ('+t.name+')':''}${r?' ['+r.name+']':''}`);}else row.push('');});
    rows.push(row);
  });
  dl('\uFEFF'+rows.map(r=>r.map(c=>'"'+String(c).replace(/"/g,'""')+'"').join(',')).join('\n'),`plan_${cls.name}_${Date.now()}.csv`,'text/csv;charset=utf-8');
}
function exportAllCSV(){S.classes.forEach(c=>exportCSV(c.id));}
function doExportCSV(){if(activeClassId)exportCSV(activeClassId);}
function dl(content,filename,mime){const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([content],{type:mime}));a.download=filename;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);}
// SIDEBAR SECTION COLLAPSE
(function initSbSections(){
  const STORE_KEY='pl_sb_collapsed';
  function loadState(){try{return JSON.parse(localStorage.getItem(STORE_KEY))||{};}catch{return {};}}
  function saveState2(s){try{localStorage.setItem(STORE_KEY,JSON.stringify(s));}catch{}}
  window.toggleSbSection=function(name,e){
    if(e&&e.target.closest('.sb-add'))return;
    const sec=document.getElementById('sbsec-'+name);
    if(!sec)return;
    sec.classList.toggle('collapsed');
    const s=loadState();
    s[name]=sec.classList.contains('collapsed');
    saveState2(s);
  };
  // Restore collapsed state on load
  document.addEventListener('DOMContentLoaded',function(){
    const s=loadState();
    ['classes','teachers','rooms'].forEach(name=>{
      if(s[name]){
        const sec=document.getElementById('sbsec-'+name);
        if(sec)sec.classList.add('collapsed');
      }
    });
  });
})();
// MOBILE SIDEBAR
function toggleMobileSidebar(){
  const sb=document.getElementById('sidebar-left');
  const ov=document.getElementById('sidebar-overlay');
  if(!sb||!ov)return;
  const open=sb.classList.toggle('mobile-open');
  ov.style.display=open?'block':'none';
}
function closeMobileSidebar(){
  const sb=document.getElementById('sidebar-left');
  const ov=document.getElementById('sidebar-overlay');
  if(sb)sb.classList.remove('mobile-open');
  if(ov)ov.style.display='none';
}

// ═══════════════════════════════════════════════════════
// STRONA POWITALNA + KREATOR
// ═══════════════════════════════════════════════════════
const WIZ_DRAFT_KEY = 'planlekcji_wiz_draft';
const WIZ_STEPS = 6;
let wizCurrentStep = 0;
let wizDraftTimer = null;

// Dane tymczasowe kreatora
let wizData = {
  schoolName: '', schoolShort: '', year: '2025/2026',
  classes: [],    // {id, name, short}
  teachers: [],   // {id, first, last, short}
  rooms: [],      // {id, name, desc}
  subjects: [],   // {id, name, short, color}
  hours: []       // {num, start, end}
};

// ── STRONA POWITALNA ────────────────────────────────────
function showWelcomeScreen() {
  const ws = document.getElementById('welcomeScreen');
  ws.classList.add('open');
  // Pokaż "Aktualny plan" jeśli są dane
  const hasData = S.classes.length > 0 || S.teachers.length > 0;
  document.getElementById('wlCurrentPlanBtn').style.display = hasData ? '' : 'none';
  // Pokaż "Nowy rok szkolny" jeśli są dane
  document.getElementById('wlCardCopy').style.display = hasData ? '' : 'none';
}

function hideWelcomeScreen() {
  document.getElementById('welcomeScreen').classList.remove('open');
}

function showAboutModal() {
  document.getElementById('aboutModal').classList.add('open');
}

function welcomeStartNew() {
  // Sprawdź czy jest szkic
  const draft = wizLoadDraft();
  if (draft) {
    document.getElementById('wizDraftMeta').textContent =
      'Ostatni zapis: ' + (draft.savedAt ? new Date(draft.savedAt).toLocaleString('pl') : '—');
    document.getElementById('wizDraftModal').classList.add('open');
    return;
  }
  wizOpen(false);
}

function welcomeCopyYear() {
  // Ukryj stronę powitalną i otwórz właściwy modal "Kopiuj plan"
  hideWelcomeScreen();
  showNewYear();
}

function welcomeImportClick() {
  document.getElementById('wlFileInput').click();
}

function welcomeHandleFile(file) {
  if (!file) return;
  const r = new FileReader();
  r.onerror = () => notify('Błąd odczytu pliku', 'error');
  r.onload = e => {
    const res = importJSON(e.target.result);
    if (res.ok) {
      hideWelcomeScreen();
      renderAll();
      notify(res.msg || 'Zaimportowano ✓', 'success');
    } else {
      notify('Błąd importu: ' + (res.error || '?'), 'error');
    }
  };
  r.readAsText(file);
}

function welcomeDemo() {
  // Załaduj przykładowe dane demo
  const demoData = buildDemoData();
  Object.assign(S, demoData);
  hideWelcomeScreen();
  renderAll();
  if (S.classes.length) setActiveClass(S.classes[0].id);
  notify('🎬 Tryb demo — dane fikcyjne, niezapisywane', 'info');
}

function buildDemoData() {
  const colors = COLORS;
  const teachers = [
    {id:'dt1', first:'Anna', last:'Kowalska', name:'Anna Kowalska', short:'AKOW'},
    {id:'dt2', first:'Jan', last:'Nowak', name:'Jan Nowak', short:'JNOW'},
    {id:'dt3', first:'Maria', last:'Wiśniewska', name:'Maria Wiśniewska', short:'MWIS'},
    {id:'dt4', first:'Piotr', last:'Wójcik', name:'Piotr Wójcik', short:'PWOJ'},
  ];
  const rooms = [
    {id:'dr1', name:'101', desc:'Sala ogólna'},
    {id:'dr2', name:'102', desc:'Sala języków'},
    {id:'dr3', name:'201', desc:'Sala informatyczna'},
    {id:'dr4', name:'Gym', desc:'Sala gimnastyczna'},
  ];
  const subjects = [
    {id:'ds1', name:'Matematyka', short:'MAT', color:colors[0]},
    {id:'ds2', name:'Język Polski', short:'POL', color:colors[1]},
    {id:'ds3', name:'Angielski', short:'ANG', color:colors[3]},
    {id:'ds4', name:'Wychowanie Fizyczne', short:'WF', color:colors[2]},
    {id:'ds5', name:'Historia', short:'HIS', color:colors[4]},
  ];
  const classes = [
    {id:'dc1', name:'1A', short:'1A', color:colors[0]},
    {id:'dc2', name:'1B', short:'1B', color:colors[1]},
  ];
  const schoolGroups = [];
  const assignments = [
    {id:'da1', classId:'dc1', teacherId:'dt1', subjectId:'ds1', roomId:'dr1', groupId:null, linkedGroupIds:[], hoursPerWeek:4},
    {id:'da2', classId:'dc1', teacherId:'dt2', subjectId:'ds2', roomId:'dr1', groupId:null, linkedGroupIds:[], hoursPerWeek:4},
    {id:'da3', classId:'dc1', teacherId:'dt3', subjectId:'ds3', roomId:'dr2', groupId:null, linkedGroupIds:[], hoursPerWeek:3},
    {id:'da4', classId:'dc1', teacherId:'dt4', subjectId:'ds4', roomId:'dr4', groupId:null, linkedGroupIds:[], hoursPerWeek:2},
    {id:'da5', classId:'dc2', teacherId:'dt1', subjectId:'ds1', roomId:'dr1', groupId:null, linkedGroupIds:[], hoursPerWeek:4},
    {id:'da6', classId:'dc2', teacherId:'dt2', subjectId:'ds5', roomId:'dr1', groupId:null, linkedGroupIds:[], hoursPerWeek:2},
  ];
  // Place some lessons
  const lessons = {
    'dc1|1|1':{assignmentId:'da1',locked:false},
    'dc1|1|2':{assignmentId:'da2',locked:false},
    'dc1|2|1':{assignmentId:'da3',locked:false},
    'dc1|3|1':{assignmentId:'da4',locked:false},
    'dc2|1|1':{assignmentId:'da5',locked:false},
    'dc2|2|2':{assignmentId:'da6',locked:false},
  };
  return {
    meta:{schoolName:'Liceum Demo nr 1', schoolShort:'LD1', year:'2025/2026', modifiedAt:new Date().toISOString()},
    hours: JSON.parse(JSON.stringify(DEFAULT_HOURS)),
    classes, teachers, rooms, subjects, schoolGroups, assignments, lessons
  };
}

// ── KREATOR ─────────────────────────────────────────────

function wizOpen(fromCopy) {
  if (!fromCopy) {
    wizData = {
      schoolName: '', schoolShort: '', year: '2025/2026',
      classes: [], teachers: [], rooms: [], subjects: [],
      hours: JSON.parse(JSON.stringify(DEFAULT_HOURS))
    };
  }
  wizCurrentStep = 0;
  wizRenderStep();
  document.getElementById('wizardOverlay').classList.add('open');
  hideWelcomeScreen();
  // Autosave
  wizDraftTimer = setInterval(wizSaveDraft, 30000);
}

function wizardClose() {
  if (wizCurrentStep > 0 || wizData.classes.length || wizData.teachers.length) {
    if (!confirm('Zamknąć kreator? Możesz go wznowić później.')) return;
    wizSaveDraft();
  }
  document.getElementById('wizardOverlay').classList.remove('open');
  clearInterval(wizDraftTimer);
  showWelcomeScreen();
}

function wizBackdropClick(e) {
  if (e.target === document.getElementById('wizardOverlay')) wizardClose();
}

function wizardBack() {
  if (wizCurrentStep > 0) { wizCurrentStep--; wizRenderStep(); }
}

function wizardNext() {
  if (wizCurrentStep < WIZ_STEPS - 1) {
    wizCollectStep(wizCurrentStep);
    wizCurrentStep++;
    wizRenderStep();
    wizSaveDraft();
  } else {
    wizFinish();
  }
}

function wizRenderStep() {
  // Steps visibility
  for (let i = 0; i < WIZ_STEPS; i++) {
    const el = document.getElementById('wStep' + i);
    if (el) el.classList.toggle('active', i === wizCurrentStep);
    const ws = document.getElementById('ws' + i);
    if (ws) {
      ws.classList.toggle('active', i === wizCurrentStep);
      ws.classList.toggle('done', i < wizCurrentStep);
    }
    const wl = document.getElementById('wl' + i);
    if (wl) wl.classList.toggle('done', i < wizCurrentStep);
  }
  document.getElementById('wizFooterInfo').textContent = 'Krok ' + (wizCurrentStep + 1) + ' z ' + WIZ_STEPS;
  document.getElementById('wBtnBack').style.display = wizCurrentStep > 0 ? '' : 'none';
  document.getElementById('wBtnNext').textContent = wizCurrentStep === WIZ_STEPS - 1 ? '✓ Zakończ i uruchom' : 'Dalej →';
  // Fill fields from wizData
  if (wizCurrentStep === 0) {
    document.getElementById('wSchoolName').value = wizData.schoolName;
    document.getElementById('wSchoolShort').value = wizData.schoolShort;
    document.getElementById('wYear').value = wizData.year;
  }
  if (wizCurrentStep === 1) wizRenderClasses();
  if (wizCurrentStep === 2) wizRenderTeachers();
  if (wizCurrentStep === 3) wizRenderRooms();
  if (wizCurrentStep === 4) wizRenderSubjects();
  if (wizCurrentStep === 5) { wizRenderHours(); wizRenderSummary(); }
}

function wizCollectStep(step) {
  if (step === 0) {
    wizData.schoolName = document.getElementById('wSchoolName').value.trim();
    wizData.schoolShort = document.getElementById('wSchoolShort').value.trim();
    wizData.year = document.getElementById('wYear').value.trim() || '2025/2026';
  }
  if (step === 1) wizCollectClasses();
  if (step === 2) wizCollectTeachers();
  if (step === 3) wizCollectRooms();
  if (step === 4) wizCollectSubjects();
  if (step === 5) wizCollectHours();
}

// ── KLASY ────────────────────────────────────────────────
function wizRenderClasses() {
  const list = document.getElementById('wClassList');
  list.innerHTML = wizData.classes.map((c,i) => `
    <div class="wiz-row" style="grid-template-columns:1fr 80px auto">
      <input value="${escH(c.name)}" placeholder="np. 1A" onchange="wizData.classes[${i}].name=this.value;wizAutoShort(${i})">
      <input value="${escH(c.short)}" placeholder="Skrót" onchange="wizData.classes[${i}].short=this.value">
      <button class="wiz-row-del" onclick="wizData.classes.splice(${i},1);wizRenderClasses()">✕</button>
    </div>`).join('');
  document.getElementById('wClassCount').textContent = wizData.classes.length + ' klas' + (wizData.classes.length === 1 ? 'a' : wizData.classes.length < 5 ? 'y' : '');
}

function wizAutoShort(i) {
  if (!wizData.classes[i].short) wizData.classes[i].short = wizData.classes[i].name;
  wizRenderClasses();
}

function wizAddClass() {
  wizData.classes.push({id: wizUid(), name: '', short: ''});
  wizRenderClasses();
  setTimeout(() => {
    const inputs = document.querySelectorAll('#wClassList .wiz-row input');
    if (inputs.length) inputs[inputs.length - 2].focus();
  }, 50);
}

function wizCollectClasses() {
  document.querySelectorAll('#wClassList .wiz-row').forEach((row, i) => {
    const inputs = row.querySelectorAll('input');
    if (wizData.classes[i]) {
      wizData.classes[i].name = inputs[0].value.trim();
      wizData.classes[i].short = inputs[1].value.trim() || inputs[0].value.trim();
    }
  });
  wizData.classes = wizData.classes.filter(c => c.name);
}

function wizHandleClassDrop(e) {
  e.preventDefault();
  document.getElementById('wClassDropZone').classList.remove('drag-over');
  const file = e.dataTransfer.files[0];
  if (file) wizReadClassFile({files:[file]});
}

function wizReadClassFile(input) {
  const file = input.files[0]; if (!file) return;
  const r = new FileReader();
  r.onerror = () => notify('Błąd odczytu pliku','error');
  r.onload = e => {
    const lines = e.target.result.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    wizData.classes = lines.map(l => {
      const parts = l.split(/[;,]/);
      return {id: wizUid(), name: parts[0].trim(), short: (parts[1]||parts[0]).trim()};
    });
    wizRenderClasses();
    notify('Wczytano ' + wizData.classes.length + ' klas', 'success');
  };
  r.readAsText(file, 'utf-8');
}

// ── NAUCZYCIELE ──────────────────────────────────────────
function wizRenderTeachers() {
  const list = document.getElementById('wTeacherList');
  list.innerHTML = wizData.teachers.map((t,i) => `
    <div class="wiz-row" style="grid-template-columns:1fr 1fr 80px auto">
      <input value="${escH(t.first)}" placeholder="Imię" onchange="wizData.teachers[${i}].first=this.value;wizAutoTeacherShort(${i})">
      <input value="${escH(t.last)}" placeholder="Nazwisko" onchange="wizData.teachers[${i}].last=this.value;wizAutoTeacherShort(${i})">
      <input value="${escH(t.short)}" placeholder="Skrót" onchange="wizData.teachers[${i}].short=this.value">
      <button class="wiz-row-del" onclick="wizData.teachers.splice(${i},1);wizRenderTeachers()">✕</button>
    </div>`).join('');
  document.getElementById('wTeacherCount').textContent = wizData.teachers.length + ' nauczyciel' + (wizData.teachers.length === 1 ? '' : wizData.teachers.length < 5 ? 'i' : 'i');
}

function wizAutoTeacherShort(i) {
  const t = wizData.teachers[i];
  if (!t.short && t.first && t.last) {
    t.short = (t.first[0] + t.last.slice(0,3)).toUpperCase();
    wizRenderTeachers();
  }
}

function wizAddTeacher() {
  wizData.teachers.push({id: wizUid(), first: '', last: '', short: ''});
  wizRenderTeachers();
  setTimeout(() => {
    const rows = document.querySelectorAll('#wTeacherList .wiz-row');
    if (rows.length) rows[rows.length-1].querySelector('input').focus();
  }, 50);
}

function wizCollectTeachers() {
  document.querySelectorAll('#wTeacherList .wiz-row').forEach((row, i) => {
    const inputs = row.querySelectorAll('input');
    if (wizData.teachers[i]) {
      wizData.teachers[i].first = inputs[0].value.trim();
      wizData.teachers[i].last = inputs[1].value.trim();
      const full = (wizData.teachers[i].first + ' ' + wizData.teachers[i].last).trim();
      wizData.teachers[i].short = inputs[2].value.trim() || (wizData.teachers[i].first[0]||'') + wizData.teachers[i].last.slice(0,3).toUpperCase();
      wizData.teachers[i].name = full;
    }
  });
  wizData.teachers = wizData.teachers.filter(t => t.first || t.last);
}

function wizHandleTeacherDrop(e) {
  e.preventDefault();
  document.getElementById('wTeacherDropZone').classList.remove('drag-over');
  const file = e.dataTransfer.files[0];
  if (file) wizReadTeacherFile({files:[file]});
}

function wizReadTeacherFile(input) {
  const file = input.files[0]; if (!file) return;
  const r = new FileReader();
  r.onerror = () => notify('Błąd odczytu pliku','error');
  r.onload = e => {
    const lines = e.target.result.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    wizData.teachers = lines.map(l => {
      const parts = l.split(' ');
      const first = parts[0] || '';
      const last = parts.slice(1).join(' ') || '';
      const short = (first[0]||'') + last.slice(0,3).toUpperCase();
      return {id: wizUid(), first, last, name: l, short};
    });
    wizRenderTeachers();
    notify('Wczytano ' + wizData.teachers.length + ' nauczycieli', 'success');
  };
  r.readAsText(file, 'utf-8');
}

// ── SALE ─────────────────────────────────────────────────
function wizRenderRooms() {
  const list = document.getElementById('wRoomList');
  list.innerHTML = wizData.rooms.map((rm,i) => `
    <div class="wiz-row" style="grid-template-columns:120px 1fr auto">
      <input value="${escH(rm.name)}" placeholder="np. 101" onchange="wizData.rooms[${i}].name=this.value">
      <input value="${escH(rm.desc)}" placeholder="Opis (opcjonalnie)" onchange="wizData.rooms[${i}].desc=this.value">
      <button class="wiz-row-del" onclick="wizData.rooms.splice(${i},1);wizRenderRooms()">✕</button>
    </div>`).join('');
  document.getElementById('wRoomCount').textContent = wizData.rooms.length + ' sal' + (wizData.rooms.length === 1 ? 'a' : wizData.rooms.length < 5 ? 'e' : '');
}

function wizAddRoom() {
  wizData.rooms.push({id: wizUid(), name: '', desc: ''});
  wizRenderRooms();
  setTimeout(() => {
    const rows = document.querySelectorAll('#wRoomList .wiz-row');
    if (rows.length) rows[rows.length-1].querySelector('input').focus();
  }, 50);
}

function wizCollectRooms() {
  document.querySelectorAll('#wRoomList .wiz-row').forEach((row, i) => {
    const inputs = row.querySelectorAll('input');
    if (wizData.rooms[i]) {
      wizData.rooms[i].name = inputs[0].value.trim();
      wizData.rooms[i].desc = inputs[1].value.trim();
    }
  });
  wizData.rooms = wizData.rooms.filter(r => r.name);
}

function wizHandleRoomDrop(e) {
  e.preventDefault();
  document.getElementById('wRoomDropZone').classList.remove('drag-over');
  const file = e.dataTransfer.files[0];
  if (file) wizReadRoomFile({files:[file]});
}

function wizReadRoomFile(input) {
  const file = input.files[0]; if (!file) return;
  const r = new FileReader();
  r.onerror = () => notify('Błąd odczytu pliku','error');
  r.onload = e => {
    const lines = e.target.result.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    wizData.rooms = lines.map(l => {
      const parts = l.split(/[;,]/);
      return {id: wizUid(), name: parts[0].trim(), desc: (parts[1]||'').trim()};
    });
    wizRenderRooms();
    notify('Wczytano ' + wizData.rooms.length + ' sal', 'success');
  };
  r.readAsText(file, 'utf-8');
}

// ── PRZEDMIOTY ───────────────────────────────────────────
function wizRenderSubjects() {
  const list = document.getElementById('wSubjectList');
  list.innerHTML = wizData.subjects.map((s,i) => `
    <div class="wiz-row" style="grid-template-columns:1fr 80px auto">
      <input value="${escH(s.name)}" placeholder="np. Matematyka" onchange="wizData.subjects[${i}].name=this.value">
      <input value="${escH(s.short)}" placeholder="Skrót" onchange="wizData.subjects[${i}].short=this.value">
      <button class="wiz-row-del" onclick="wizData.subjects.splice(${i},1);wizRenderSubjects()">✕</button>
    </div>`).join('');
  document.getElementById('wSubjectCount').textContent = wizData.subjects.length + ' przedmiot' + (wizData.subjects.length === 1 ? '' : wizData.subjects.length < 5 ? 'y' : 'ów');
}

function wizAddSubject() {
  wizData.subjects.push({id: wizUid(), name: '', short: '', color: COLORS[wizData.subjects.length % COLORS.length]});
  wizRenderSubjects();
  setTimeout(() => {
    const rows = document.querySelectorAll('#wSubjectList .wiz-row');
    if (rows.length) rows[rows.length-1].querySelector('input').focus();
  }, 50);
}

function wizCollectSubjects() {
  document.querySelectorAll('#wSubjectList .wiz-row').forEach((row, i) => {
    const inputs = row.querySelectorAll('input');
    if (wizData.subjects[i]) {
      wizData.subjects[i].name = inputs[0].value.trim();
      wizData.subjects[i].short = inputs[1].value.trim();
    }
  });
  wizData.subjects = wizData.subjects.filter(s => s.name);
}

function wizHandleSubjectDrop(e) {
  e.preventDefault();
  document.getElementById('wSubjectDropZone').classList.remove('drag-over');
  const file = e.dataTransfer.files[0];
  if (file) wizReadSubjectFile({files:[file]});
}

function wizReadSubjectFile(input) {
  const file = input.files[0]; if (!file) return;
  const r = new FileReader();
  r.onerror = () => notify('Błąd odczytu pliku','error');
  r.onload = e => {
    const lines = e.target.result.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    wizData.subjects = lines.map((l, i) => {
      const parts = l.split(/[;,]/);
      return {id: wizUid(), name: parts[0].trim(), short: (parts[1]||parts[0].slice(0,3)).trim().toUpperCase(), color: COLORS[i % COLORS.length]};
    });
    wizRenderSubjects();
    notify('Wczytano ' + wizData.subjects.length + ' przedmiotów', 'success');
  };
  r.readAsText(file, 'utf-8');
}

// ── GODZINY ──────────────────────────────────────────────
function wizRenderHours() {
  if (!wizData.hours.length) wizData.hours = JSON.parse(JSON.stringify(DEFAULT_HOURS));
  const list = document.getElementById('wHoursList');
  list.innerHTML = wizData.hours.map((h, i) => `
    <div class="wiz-hour-row">
      <div class="wiz-hour-num">${h.num}</div>
      <input class="wiz-time-input" type="time" value="${h.start}" onchange="wizData.hours[${i}].start=this.value">
      <div class="wiz-hour-sep">—</div>
      <input class="wiz-time-input" type="time" value="${h.end}" onchange="wizData.hours[${i}].end=this.value">
      <button class="wiz-row-del" onclick="wizData.hours.splice(${i},1);wizRenderHours()">✕</button>
    </div>`).join('');
}

function wizAddHour() {
  const last = wizData.hours[wizData.hours.length - 1];
  const nextNum = last ? last.num + 1 : 1;
  wizData.hours.push({num: nextNum, start: '00:00', end: '00:00'});
  wizRenderHours();
}

function wizCollectHours() {
  document.querySelectorAll('#wHoursList .wiz-hour-row').forEach((row, i) => {
    const inputs = row.querySelectorAll('input');
    if (wizData.hours[i]) {
      wizData.hours[i].start = inputs[0].value;
      wizData.hours[i].end = inputs[1].value;
    }
  });
}

// ── PODSUMOWANIE ─────────────────────────────────────────
function wizRenderSummary() {
  const el = document.getElementById('wizSummary');
  el.innerHTML = `
    <div class="wiz-summary-row">🏫 <strong>Szkoła:</strong> ${escH(wizData.schoolName || '(nie podano)')} ${wizData.schoolShort ? '(' + escH(wizData.schoolShort) + ')' : ''}</div>
    <div class="wiz-summary-row">🗓 <strong>Rok szkolny:</strong> ${escH(wizData.year)}</div>
    <div class="wiz-summary-row">🎓 <strong>Klasy:</strong> ${wizData.classes.length} (${wizData.classes.map(c=>escH(c.name)).join(', ') || '—'})</div>
    <div class="wiz-summary-row">👨‍🏫 <strong>Nauczyciele:</strong> ${wizData.teachers.length}</div>
    <div class="wiz-summary-row">🏫 <strong>Sale:</strong> ${wizData.rooms.length}</div>
    <div class="wiz-summary-row">📚 <strong>Przedmioty:</strong> ${wizData.subjects.length}</div>
    <div class="wiz-summary-row">⏱ <strong>Godziny lekcyjne:</strong> ${wizData.hours.length} (${wizData.hours.map(h=>h.num).join(', ')})</div>
  `;
}

// ── ZAKOŃCZENIE KREATORA ─────────────────────────────────
function wizFinish() {
  wizCollectStep(5);
  // Apply to S
  S.meta.schoolName = wizData.schoolName;
  S.meta.schoolShort = wizData.schoolShort;
  S.meta.year = wizData.year;
  S.hours = wizData.hours;
  S.classes = wizData.classes.map(c => ({
    id: uid(), name: c.name, short: c.short || c.name,
    color: COLORS[Math.floor(Math.random() * COLORS.length)]
  }));
  S.teachers = wizData.teachers.map(t => ({
    id: uid(), first: t.first, last: t.last,
    name: (t.first + ' ' + t.last).trim(),
    short: t.short || (t.first[0]||'') + t.last.slice(0,3).toUpperCase()
  }));
  S.rooms = wizData.rooms.map(r => ({id: uid(), name: r.name, desc: r.desc || ''}));
  S.subjects = wizData.subjects.map((s, i) => ({
    id: uid(), name: s.name, short: s.short || s.name.slice(0,3).toUpperCase(),
    color: COLORS[i % COLORS.length]
  }));
  S.schoolGroups = [];
  S.assignments = [];
  S.lessons = {};
  saveState();
  wizClearDraft();
  clearInterval(wizDraftTimer);
  document.getElementById('wizardOverlay').classList.remove('open');
  renderAll();
  renderHours();
  if (S.classes.length) setActiveClass(S.classes[0].id);
  notify('✓ Konfiguracja zapisana — plan gotowy do uzupełnienia', 'success');
}

// ── DRAFT (AUTOSAVE KREATORA) ────────────────────────────
function wizSaveDraft() {
  wizCollectStep(wizCurrentStep);
  const draft = {...wizData, step: wizCurrentStep, savedAt: new Date().toISOString()};
  try { localStorage.setItem(WIZ_DRAFT_KEY, JSON.stringify(draft)); } catch(e) {}
  document.getElementById('wizAutosaveStatus').textContent = '💾 Zapisano ' + new Date().toLocaleTimeString('pl');
}

function wizLoadDraft() {
  try {
    const d = localStorage.getItem(WIZ_DRAFT_KEY);
    return d ? JSON.parse(d) : null;
  } catch(e) { return null; }
}

function wizClearDraft() {
  try { localStorage.removeItem(WIZ_DRAFT_KEY); } catch(e) {}
}

function wizDraftResume() {
  const draft = wizLoadDraft();
  if (!draft) return;
  document.getElementById('wizDraftModal').classList.remove('open');
  wizData = {
    schoolName: draft.schoolName || '', schoolShort: draft.schoolShort || '',
    year: draft.year || '2025/2026',
    classes: draft.classes || [], teachers: draft.teachers || [],
    rooms: draft.rooms || [], subjects: draft.subjects || [],
    hours: draft.hours || JSON.parse(JSON.stringify(DEFAULT_HOURS))
  };
  wizCurrentStep = draft.step || 0;
  wizRenderStep();
  document.getElementById('wizardOverlay').classList.add('open');
  hideWelcomeScreen();
  wizDraftTimer = setInterval(wizSaveDraft, 30000);
}

function wizDraftDiscard() {
  wizClearDraft();
  document.getElementById('wizDraftModal').classList.remove('open');
  wizOpen(false);
}

// ── HELPER ───────────────────────────────────────────────
function escH(str) {
  return String(str||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ── PŁACHTA ─────────────────────────────────────────────
let plachtaMode = 'class'; // 'class' | 'teacher' | 'room'

function plachtaSetMode(mode) {
  plachtaMode = mode;
  ['class','teacher','room'].forEach(m => {
    const btn = document.getElementById('plachta-mode-' + m);
    if (btn) btn.classList.toggle('active', m === mode);
  });
  renderPlachta();
}

function renderPlachta() {
  const wrap = document.getElementById('plachta-wrapper');
  if (!wrap) return;
  const dayFilter = +document.getElementById('plachta-day-filter').value;
  const search = (document.getElementById('plachta-search').value || '').toLowerCase().trim();
  const conf = detectConflicts();

  const days = dayFilter === -1 ? DAYS.map((_,i) => i) : [dayFilter];

  let entities = [];
  if (plachtaMode === 'class') {
    entities = alphaSort(S.classes, 'name').filter(c => !search || c.name.toLowerCase().includes(search));
  } else if (plachtaMode === 'teacher') {
    entities = alphaSort(S.teachers, 'name').filter(t => !search || t.name.toLowerCase().includes(search) || (t.short||'').toLowerCase().includes(search));
  } else {
    entities = alphaSort(S.rooms, 'name').filter(r => !search || r.name.toLowerCase().includes(search));
  }

  if (!entities.length) {
    wrap.innerHTML = '<div class="empty-state"><div class="empty-icon">📄</div>Brak danych do wyświetlenia</div>';
    return;
  }

  // Legend for class mode (subject colors)
  let legendHtml = '';
  if (plachtaMode === 'class' && S.subjects.length) {
    const legendItems = alphaSort(S.subjects, 'name').map(s =>
      `<span class="plachta-legend-item"><span class="plachta-legend-dot" style="background:${s.color||'#94a3b8'}"></span><span>${esc(s.short||s.name)}</span></span>`
    ).join('');
    legendHtml = `<div class="plachta-legend"><strong style="font-size:10.5px;color:var(--text3);text-transform:uppercase;letter-spacing:.06em">Przedmioty:</strong>${legendItems}</div>`;
  }

  const blocks = entities.map(entity => buildPlachtaBlock(entity, days, conf)).join('');
  wrap.innerHTML = `<div class="plachta-container">${legendHtml}${blocks}</div>`;
}

function buildPlachtaBlock(entity, days, conf) {
  const isClass = plachtaMode === 'class';
  const isTeacher = plachtaMode === 'teacher';
  const isRoom = plachtaMode === 'room';

  let headerColor, headerName, headerBadge;
  if (isClass) {
    headerColor = entity.color || '#2563eb';
    headerName = 'Klasa ' + entity.name;
    const cnt = S.assignments.filter(a => a.classId === entity.id).reduce((s,a) => s+(a.hoursPerWeek||0), 0);
    const placed = Object.keys(S.lessons).filter(k => k.startsWith(entity.id + '|')).length;
    headerBadge = `${placed}/${cnt} godz.`;
  } else if (isTeacher) {
    headerColor = '#7c3aed';
    headerName = entity.name;
    const load = teacherLoad();
    headerBadge = `${load[entity.id]||0}h / ${entity.maxHours||18}h`;
  } else {
    headerColor = '#0891b2';
    headerName = 'Sala ' + entity.name;
    const usedSlots = [];
    for (const [k, l] of Object.entries(S.lessons)) {
      const parts = k.split('|');
      const a = getAssign(l.assignmentId);
      if (a && a.roomId === entity.id) usedSlots.push(k);
    }
    headerBadge = `${usedSlots.length} zajęć`;
  }

  // Column headers: days
  const dayHeaders = days.map(di => `<th colspan="1">${DAYS[di]}</th>`).join('');

  // Rows: hours × days
  const rows = S.hours.map((h, hi) => {
    const cells = days.map(di => {
      if (isClass) {
        const lessons = getLessonsAt(entity.id, di, hi);
        if (!lessons.length) return `<td class="ph-cell ph-empty"></td>`;
        if (lessons.length === 1) {
          const l = lessons[0];
          const hasConf = conf.has(l.key);
          return `<td class="ph-cell${hasConf?' ph-conflict':''}">${buildPhCard(getAssign(l.assignmentId), l, hasConf)}</td>`;
        }
        // Multi-group
        const cards = lessons.map(l => buildPhCard(getAssign(l.assignmentId), l, conf.has(l.key))).join('');
        return `<td class="ph-cell"><div class="ph-multi">${cards}</div></td>`;
      } else if (isTeacher) {
        for (const c of S.classes) {
          const lessons = getLessonsAt(c.id, di, hi);
          for (const l of lessons) {
            const a = getAssign(l.assignmentId);
            if (a && a.teacherId === entity.id) {
              const hasConf = conf.has(l.key);
              return `<td class="ph-cell${hasConf?' ph-conflict':''}">${buildPhCard(a, l, hasConf, c.name)}</td>`;
            }
          }
        }
        return `<td class="ph-cell ph-empty"></td>`;
      } else {
        for (const c of S.classes) {
          const lessons = getLessonsAt(c.id, di, hi);
          for (const l of lessons) {
            const a = getAssign(l.assignmentId);
            if (a && a.roomId === entity.id) {
              const hasConf = conf.has(l.key);
              return `<td class="ph-cell${hasConf?' ph-conflict':''}">${buildPhCard(a, l, hasConf, c.name)}</td>`;
            }
          }
        }
        return `<td class="ph-cell ph-empty"></td>`;
      }
    }).join('');
    return `<tr>
      <td class="ph-hour-col"><span class="ph-hour-num">${h.num}</span><br><span class="ph-hour-time">${h.start}–${h.end}</span></td>
      ${cells}
    </tr>`;
  }).join('');

  return `
  <div class="plachta-entity">
    <div class="plachta-entity-header" style="background:${headerColor}">
      <div class="ph-dot"></div>
      <div class="ph-name">${esc(headerName)}</div>
      <div class="ph-badge">${esc(headerBadge)}</div>
    </div>
    <div class="plachta-scroll">
      <table class="plachta-tbl">
        <thead><tr><th>Godz.</th>${dayHeaders}</tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  </div>`;
}

function buildPhCard(assign, lesson, isConf, extraLabel) {
  if (!assign) return '';
  const subj = getSubject(assign.subjectId);
  const teacher = getTeacher(assign.teacherId);
  const room = getRoom(assign.roomId);
  const color = subj && subj.color ? subj.color : '#94a3b8';
  const sname = subj ? (subj.short || subj.name) : '?';
  const tname = teacher ? (teacher.short || teacher.name.split(' ').pop()) : '';
  const rname = room ? (room.short || room.name) : '';
  const glabel = lesson && lesson.groupId ? (() => { const g = getSchoolGroup(lesson.groupId); return g ? g.name : ''; })() : '';
  const groupHtml = glabel ? `<div class="ph-g" style="background:${color};color:#fff">${esc(glabel)}</div>` : '';
  const extraHtml = extraLabel ? `<span style="color:var(--text3);font-weight:400;font-size:9px">[${esc(extraLabel)}] </span>` : '';
  return `<div class="ph-card" style="border-left-color:${color};background:${hexRgba(color,0.08)}">
    ${groupHtml}
    <div class="ph-s" style="color:${color}">${extraHtml}${esc(sname)}</div>
    ${tname ? `<div class="ph-t">${esc(tname)}</div>` : ''}
    ${rname ? `<div class="ph-r">${esc(rname)}</div>` : ''}
  </div>`;
}

function plachtaPrint() {
  window.print();
}

// ── TOPBAR: przycisk "Strona główna" ─────────────────────
function goHome() {
  showWelcomeScreen();
}

// NOTIFICATIONS
function notify(msg,type='info'){
  const el=document.createElement('div');el.className='notif '+type;el.textContent=msg;
  document.body.appendChild(el);
  setTimeout(()=>{el.style.opacity='0';el.style.transition='opacity .3s';setTimeout(()=>el.remove(),350);},2500);
}
