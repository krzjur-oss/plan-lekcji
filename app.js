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
function uid(){
  if(typeof crypto!=='undefined'&&crypto.randomUUID)return crypto.randomUUID().replace(/-/g,'');
  return Date.now().toString(36)+Math.random().toString(36).slice(2,10);
}
const byId=(a,id)=>a.find(x=>x.id===id);
const getClass=id=>byId(S.classes,id);
const getTeacher=id=>byId(S.teachers,id);
const getRoom=id=>byId(S.rooms,id);
const getSubject=id=>byId(S.subjects,id);
const getAssign=id=>byId(S.assignments,id);
const getSchoolGroup=id=>byId(S.schoolGroups,id);
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
  // Cross-check: nauczyciele specjalni vs. główny plan
  // Lekcje "z klasą" (withClass) nie są konfliktem — uczeń NI jest na tej samej lekcji co klasa
  if(typeof S!=='undefined'&&S.specialLessons){
    const mainSlots={};
    // Buduj mapę: teacherId/roomId -> Set slotów z głównego planu
    Object.entries(S.lessons).forEach(([k,l])=>{
      const a=getAssign(l.assignmentId);if(!a)return;
      const p=k.split('|');const sl=p[1]+'|'+p[2];
      [a.teacherId,a.roomId].filter(Boolean).forEach(id=>{
        if(!mainSlots[id])mainSlots[id]=new Set();
        mainSlots[id].add(sl+'|'+k); // zapisz też klucz lekcji klasy
      });
    });
    Object.keys(S.specialLessons).forEach(k=>{
      const l=S.specialLessons[k];
      const a=typeof getSpecialAssign==='function'?getSpecialAssign(l.assignmentId):null;
      if(!a)return;
      // Pomiń lekcje "z klasą" — nie są konfliktem z planem klasy
      if(a.withClass)return;
      const p=k.split('|');const sl=p[1]+'|'+p[2];
      // Sprawdź tylko nauczyciela wspomagającego i salę (nie prowadzącego — on jest z klasą)
      [a.supportTeacherId,a.roomId].filter(Boolean).forEach(id=>{
        if(mainSlots[id]){
          mainSlots[id].forEach(entry=>{
            if(entry.startsWith(sl+'|'))conf.add(k);
          });
        }
      });
      // Dla lekcji indywidualnych sprawdź też prowadzącego
      if(a.teacherId&&mainSlots[a.teacherId]){
        mainSlots[a.teacherId].forEach(entry=>{
          if(entry.startsWith(sl+'|'))conf.add(k);
        });
      }
    });
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
      for(const c of S.classes){const lessons=getLessonsAt(c.id,d,h);for(const l of lessons){const a=getAssign(l.assignmentId);if(a&&a.teacherId===activeViewId)return buildCard(a,l,l.key,conf.has(l.key),c.name);}}return null;
    }));
  }else if(activeView==='room'){
    wrap.innerHTML='';wrap.appendChild(buildTable((d,h)=>{
      for(const c of S.classes){const lessons=getLessonsAt(c.id,d,h);for(const l of lessons){const a=getAssign(l.assignmentId);if(a&&a.roomId===activeViewId)return buildCard(a,l,l.key,conf.has(l.key),c.name);}}return null;
    }));
  }
  updateHeader(conf);renderPool();highlightSidebar();
  injectSpecialIntoTimetable();
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
  div.className='lesson-card'+(isConf?' conflict':'');div.draggable=true;div.dataset.key=key;div.dataset.assignId=assign.id;
  if(isConf){div.title='⚠ Konflikt: nauczyciel lub sala zajęta w tej godzinie';}
  div.style.borderLeftColor=isConf?'#dc2626':color;div.style.background=isConf?'#fee2e2':hexRgba(color,0.1);
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
        // Pobierz lekcję stojącą w miejscu docelowym (może mieć inny groupId niż przenoszona)
        const existing=S.lessons[toKey];
        delete S.lessons[dragData.fromKey];
        if(existing){
          // Przywróć wypartą lekcję pod klucz źródłowy — zachowaj oryginalny groupId z fromKey
          const fromParts=dragData.fromKey.split('|');
          const fromGroupId=fromParts[3]||null;
          S.lessons[lkey(fromParts[0],+fromParts[1],+fromParts[2],fromGroupId)]={...existing};
        }
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
  if(!conf)conf=detectConflicts(); // fallback gdy wywołane standalone (np. ze Statystyk)
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
  if(!S.specialStudents)S.specialStudents=[];
  if(!S.specialAssignments)S.specialAssignments=[];
  if(!S.specialLessons)S.specialLessons={};
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
    else if(tab==='special'){specialEnsureState();renderSpecialModule();}
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
function recalcHourNums(){
  // Zachowaj num=0 jeśli pierwsza godzina ma num=0, inaczej numeruj od 1
  const base=S.hours.length&&S.hours[0].num===0?0:1;
  S.hours.forEach((h,i)=>h.num=base+i);
}
function renderHours(){
  const list=document.getElementById('hours-list');if(!list)return;
  list.innerHTML=S.hours.map((h,i)=>`<div class="hour-row">
    <button class="btn-insert-hour" onclick="insertHour(${i},'before')" title="Wstaw godzinę przed">＋</button>
    <span class="hour-num-lbl">${h.num}</span>
    <input class="time-input" type="time" value="${h.start}" onchange="S.hours[${i}].start=this.value;saveState()">
    <span class="time-sep">–</span>
    <input class="time-input" type="time" value="${h.end}" onchange="S.hours[${i}].end=this.value;saveState()">
    <button class="btn btn-danger btn-sm btn-icon" onclick="removeHour(${i})" title="Usu\u0144">\u2715</button>
  </div>`).join('');
}
function insertHour(i,pos){
  const idx=pos==='before'?i:i+1;
  // Podpowiedz czas na podstawie sąsiadów
  const prev=S.hours[idx-1],next=S.hours[idx];
  const start=next?next.start:(prev?prev.end:'00:00');
  const end=next?next.end:'00:00';
  S.hours.splice(idx,0,{num:0,start,end});
  recalcHourNums();
  saveState();renderHours();renderTimetable();
  // Przewiń do nowej pozycji
  setTimeout(()=>{
    const rows=document.querySelectorAll('#hours-list .hour-row');
    if(rows[idx])rows[idx].scrollIntoView({block:'nearest',behavior:'smooth'});
  },50);
}
function addHour(){
  // Wstaw po ostatniej godzinie
  const last=S.hours[S.hours.length-1];
  S.hours.push({num:last?last.num+1:1,start:'00:00',end:'00:00'});
  saveState();renderHours();renderTimetable();
}
function removeHour(i){S.hours.splice(i,1);recalcHourNums();saveState();renderHours();renderTimetable();}
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
    const name=document.getElementById('fc-name').value.trim();if(!name){notify('Podaj nazwę klasy','error');return;}
    const duplicate=S.classes.find(c=>c.name.toLowerCase()===name.toLowerCase()&&c.id!==id);
    if(duplicate){notify('Klasa o nazwie „'+name+'" już istnieje','error');return;}
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
    if(!first||!last){notify('Podaj imię i nazwisko','error');return;}
    const name=first+' '+last;
    const duplicate=S.teachers.find(t=>t.name.toLowerCase()===name.toLowerCase()&&t.id!==id);
    if(duplicate){notify('Nauczyciel „'+name+'" już istnieje','error');return;}
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
function deleteTeacher(id){
  if(!confirm('Usunąć nauczyciela? Wszystkie jego przypisania zostaną pozbawione nauczyciela.'))return;
  S.teachers=S.teachers.filter(t=>t.id!==id);
  // Wyczyść teacherId z przypisań — przypisanie zostaje, ale bez nauczyciela
  S.assignments.forEach(a=>{if(a.teacherId===id)a.teacherId=null;});
  saveState();renderAll();renderTableTeachers();
}
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
    const name=document.getElementById('fr-name').value.trim();if(!name){notify('Podaj nazwę sali','error');return;}
    const duplicate=S.rooms.find(r=>r.name.toLowerCase()===name.toLowerCase()&&r.id!==id);
    if(duplicate){notify('Sala o nazwie „'+name+'" już istnieje','error');return;}
    const data={name,short:document.getElementById('fr-short').value.trim(),type:document.getElementById('fr-type').value,capacity:+document.getElementById('fr-cap').value||null};
    if(id)Object.assign(getRoom(id),data);else S.rooms.push({id:uid(),...data});
    saveState();closeModal();renderAll();renderTableRooms();notify(id?'Sala zaktualizowana':'Sala dodana','success');
  });
}
function deleteRoom(id){
  if(!confirm('Usunąć salę? Wszystkie przypisania korzystające z tej sali zostaną pozbawione sali.'))return;
  S.rooms=S.rooms.filter(r=>r.id!==id);
  // Wyczyść roomId z przypisań — przypisanie zostaje, ale bez sali
  S.assignments.forEach(a=>{if(a.roomId===id)a.roomId=null;});
  saveState();renderAll();renderTableRooms();
}
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
    const name=document.getElementById('fs-name').value.trim();if(!name){notify('Podaj nazwę przedmiotu','error');return;}
    const duplicate=S.subjects.find(s=>s.name.toLowerCase()===name.toLowerCase()&&s.id!==id);
    if(duplicate){notify('Przedmiot „'+name+'" już istnieje','error');return;}
    const data={name,short:document.getElementById('fs-short').value.trim(),color:document.getElementById('fs-color').value};
    if(id)Object.assign(getSubject(id),data);else S.subjects.push({id:uid(),...data});
    saveState();closeModal();renderAll();renderTableSubjects();notify(id?'Przedmiot zaktualizowany':'Przedmiot dodany','success');
  });
}
function deleteSubject(id){
  if(!confirm('Usunąć przedmiot? Wszystkie przypisania tego przedmiotu oraz ułożone lekcje zostaną usunięte.'))return;
  S.subjects=S.subjects.filter(s=>s.id!==id);
  // Zbierz ID przypisań powiązanych z tym przedmiotem
  const affectedAssignIds=new Set(S.assignments.filter(a=>a.subjectId===id).map(a=>a.id));
  S.assignments=S.assignments.filter(a=>a.subjectId!==id);
  // Usuń lekcje tych przypisań
  for(const[k,l]of Object.entries(S.lessons)){if(affectedAssignIds.has(l.assignmentId))delete S.lessons[k];}
  saveState();renderAll();renderTableSubjects();
}
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
    if(!name){notify('Podaj nazwę grupy','error');return;}
    const duplicate=S.schoolGroups.find(g=>g.name.toLowerCase()===name.toLowerCase()&&g.id!==id);
    if(duplicate){notify('Grupa „'+name+'" już istnieje','error');return;}
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
      if(d.schedule){S.lessons={};for(const e of d.schedule){const a=S.assignments.find(x=>x.classId===e.classId&&x.subjectId===e.subjectId&&x.teacherId===e.teacherId&&(x.groupId||null)===(e.groupId||null));if(a)S.lessons[lkey(e.classId,e.day,e.hour,e.groupId||null)]={assignmentId:a.id,locked:e.locked||false};}}
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
      // Uzupełnij pola modułu Specjalne jeśli brak w starszym pliku
      if(!S.specialStudents)S.specialStudents=[];
      if(!S.specialAssignments)S.specialAssignments=[];
      if(!S.specialLessons)S.specialLessons={};
      saveState();return{ok:true,msg:'Dane zaimportowane pomyślnie'};
    }
    return{ok:false,error:'Nierozpoznany format pliku'};
  }catch(e){return{ok:false,error:e.message};}
}
function exportNative(){dl(JSON.stringify(S,null,2),`plan_${(S.meta.schoolName||'szkola').replace(/\s+/g,'_')}_${Date.now()}.json`,'application/json');}
function exportPlanSal(){
  const out={_format:'plansal-v1',_generated:new Date().toISOString(),meta:S.meta,hours:S.hours,rooms:S.rooms,teachers:S.teachers,classes:S.classes,subjects:S.subjects,schoolGroups:S.schoolGroups,assignments:S.assignments,
    schedule:Object.entries(S.lessons).map(([k,l])=>{
      const parts=k.split('|');
      const[cid,d,h]=parts;
      const groupId=parts[3]||null; // klucze grupowe mają postać classId|day|hour|groupId
      const a=getAssign(l.assignmentId);const subj=getSubject(a?a.subjectId:null);
      return{classId:cid,day:+d,hour:+h,groupId,subjectId:a?a.subjectId:null,subjectName:subj?subj.name:null,teacherId:a?a.teacherId:null,roomId:a?a.roomId:null,locked:l.locked||false};
    })
  };
  dl(JSON.stringify(out,null,2),`plan_sal_${Date.now()}.json`,'application/json');
}
function exportCSV(classId){
  const cls=getClass(classId);if(!cls)return;
  const rows=[['Lekcja',...DAYS]];
  S.hours.forEach((h,hi)=>{
    const row=[`${h.num}. ${h.start}-${h.end}`];
    DAYS.forEach((_,di)=>{const ls=getLessonsAt(classId,di,hi);if(ls.length){const parts=ls.map(l=>{const a=getAssign(l.assignmentId);const s=getSubject(a?a.subjectId:null);const t=getTeacher(a?a.teacherId:null);const r=getRoom(a?a.roomId:null);const g=l.groupId?getSchoolGroup(l.groupId):null;return`${s?s.name:''}${g?' ['+g.name+']':''}${t?' ('+t.name+')':''}${r?' ['+r.name+']':''}`;});row.push(parts.join(' | '));}else row.push('');});
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
const WIZ_STEPS = 7;
function wizUid() { return uid(); }
let wizCurrentStep = 0;
let wizDraftTimer = null;

// Dane tymczasowe kreatora
let wizData = {
  schoolName: '', schoolShort: '', year: '2025/2026',
  classes: [],    // {id, name, short}
  teachers: [],   // {id, first, last, short}
  rooms: [],      // {id, name, desc}
  subjects: [],   // {id, name, short, color}
  hours: [],      // {num, start, end}
  specialStudents: [] // {id, firstName, lastName, type, note}
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
      hours: JSON.parse(JSON.stringify(DEFAULT_HOURS)),
      specialStudents: []
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
  if (wizCurrentStep === 5) wizRenderSpecialStudents();
  if (wizCurrentStep === 6) { wizRenderHours(); wizRenderSummary(); }
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
function wizRenderSpecialStudents() {
  if (!wizData.specialStudents) wizData.specialStudents = [];
  const list = document.getElementById('wSpecialList');
  if (!list) return;
  if (!wizData.specialStudents.length) {
    list.innerHTML = '<div style="color:var(--text3);font-size:12px;padding:8px 0">Brak uczniów — krok opcjonalny. Możesz dodać uczniów specjalnych po uruchomieniu planu w zakładce 🌟 Specjalne.</div>';
  } else {
    list.innerHTML = wizData.specialStudents.map((s, i) => `
      <div class="wiz-row">
        <input value="${escH(s.firstName)}" placeholder="Imię" onchange="wizData.specialStudents[${i}].firstName=this.value">
        <input value="${escH(s.lastName)}" placeholder="Nazwisko" onchange="wizData.specialStudents[${i}].lastName=this.value">
        <select onchange="wizData.specialStudents[${i}].type=this.value">
          <option value="NI" ${s.type==='NI'?'selected':''}>NI — Nauczanie indywidualne</option>
          <option value="REW" ${s.type==='REW'?'selected':''}>Rewalidacja</option>
          <option value="WSP" ${s.type==='WSP'?'selected':''}>Wspomaganie</option>
        </select>
        <button class="wiz-row-del" onclick="wizData.specialStudents.splice(${i},1);wizRenderSpecialStudents()">✕</button>
      </div>`).join('');
  }
  document.getElementById('wSpecialCount').textContent =
    wizData.specialStudents.length + ' uczni' + (wizData.specialStudents.length === 1 ? 'eń' : wizData.specialStudents.length < 5 ? 'ów' : 'ów');
}

function wizAddSpecialStudent() {
  if (!wizData.specialStudents) wizData.specialStudents = [];
  wizData.specialStudents.push({id: wizUid(), firstName: '', lastName: '', type: 'NI', note: ''});
  wizRenderSpecialStudents();
}

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
    <div class="wiz-summary-row">🌟 <strong>Uczniowie specjalni:</strong> ${(wizData.specialStudents||[]).length}</div>
  `;
}

// ── ZAKOŃCZENIE KREATORA ─────────────────────────────────
function wizFinish() {
  wizCollectStep(6);
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
    id: uid(), firstname: t.first, lastname: t.last,
    name: (t.first + ' ' + t.last).trim(),
    short: t.short || (t.first[0]||'') + t.last.slice(0,3).toUpperCase(),
    subjects: [],
    maxHours: 18
  }));
  S.rooms = wizData.rooms.map(r => ({id: uid(), name: r.name, desc: r.desc || ''}));
  S.subjects = wizData.subjects.map((s, i) => ({
    id: uid(), name: s.name, short: s.short || s.name.slice(0,3).toUpperCase(),
    color: COLORS[i % COLORS.length]
  }));
  S.schoolGroups = [];
  S.assignments = [];
  S.lessons = {};
  // Uczniowie specjalni z kreatora
  S.specialStudents = (wizData.specialStudents || []).map(s => ({
    id: uid(), firstName: s.firstName, lastName: s.lastName,
    type: s.type, classId: null, note: s.note || ''
  }));
  S.specialAssignments = [];
  S.specialLessons = {};
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
    hours: draft.hours || JSON.parse(JSON.stringify(DEFAULT_HOURS)),
    specialStudents: draft.specialStudents || []
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
  <div class="plachta-entity" data-entity-id="${entity.id}">
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
  // Zbierz encje aktualnie widoczne (zgodnie z trybem)
  let entities = [];
  if (plachtaMode === 'class') {
    entities = alphaSort(S.classes, 'name').map(e => ({id: e.id, label: e.name, color: e.color||'#2563eb'}));
  } else if (plachtaMode === 'teacher') {
    entities = alphaSort(S.teachers, 'name').map(e => ({id: e.id, label: e.name, color: '#7c3aed'}));
  } else {
    entities = alphaSort(S.rooms, 'name').map(e => ({id: e.id, label: e.name, color: '#0891b2'}));
  }
  if (!entities.length) { notify('Brak danych do wydruku', 'info'); return; }

  const modeLabel = plachtaMode === 'class' ? 'Klasy' : plachtaMode === 'teacher' ? 'Nauczyciele' : 'Sale';
  const checkboxes = entities.map(e =>
    `<label class="print-pick-item">
      <input type="checkbox" class="print-pick-cb" value="${e.id}" checked>
      <span class="color-dot" style="background:${e.color}"></span>
      <span>${esc(e.label)}</span>
    </label>`
  ).join('');

  openModal('\uD83D\uDDA8 Wybierz do wydruku',
    `<div style="font-size:12px;color:var(--text2);margin-bottom:10px">
      Tryb: <strong>${modeLabel}</strong> &nbsp;\u00b7&nbsp;
      <a href="#" style="color:var(--accent)" onclick="document.querySelectorAll('.print-pick-cb').forEach(c=>c.checked=true);return false">Zaznacz wszystkie</a>
      &nbsp;/&nbsp;
      <a href="#" style="color:var(--accent)" onclick="document.querySelectorAll('.print-pick-cb').forEach(c=>c.checked=false);return false">Odznacz wszystkie</a>
    </div>
    <div class="print-pick-grid">${checkboxes}</div>
    <div style="margin-top:14px;display:flex;align-items:center;gap:10px;flex-wrap:wrap">
      <span style="font-size:12px;color:var(--text2);font-weight:600">Układ na stronie:</span>
      <label style="display:flex;align-items:center;gap:5px;font-size:12px;cursor:pointer">
        <input type="radio" name="print-layout" value="auto" checked> Auto (2 na stronę jeśli pasują)
      </label>
      <label style="display:flex;align-items:center;gap:5px;font-size:12px;cursor:pointer">
        <input type="radio" name="print-layout" value="one"> 1 na stronę
      </label>
    </div>
    <div style="margin-top:10px;display:flex;align-items:center;gap:10px;flex-wrap:wrap">
      <span style="font-size:12px;color:var(--text2);font-weight:600">Orientacja:</span>
      <label style="display:flex;align-items:center;gap:5px;font-size:12px;cursor:pointer">
        <input type="radio" name="print-orient" value="portrait" checked> Pionowa (portrait)
      </label>
      <label style="display:flex;align-items:center;gap:5px;font-size:12px;cursor:pointer">
        <input type="radio" name="print-orient" value="landscape"> Pozioma (landscape)
      </label>
    </div>`,
    () => {
      const selected = [...document.querySelectorAll('.print-pick-cb:checked')].map(c => c.value);
      if (!selected.length) { notify('Nic nie zaznaczono', 'info'); return; }
      const layout = document.querySelector('input[name="print-layout"]:checked').value;
      const orient = document.querySelector('input[name="print-orient"]:checked').value;
      closeModal();
      plachtaDoPrint(selected, layout, orient);
    }
  );
}

function plachtaDoPrint(selectedIds, layout, orient) {
  const allBlocks = [...document.querySelectorAll('#plachta-wrapper .plachta-entity')];
  const selectedBlocks = allBlocks.filter(el => selectedIds.includes(el.dataset.entityId));
  if (!selectedBlocks.length) return;

  const isLandscape = orient === 'landscape';
  const marginMM = 10;
  // A4 użyteczna szerokość przy 96dpi: (210mm - 2*10mm) * 3.7795px/mm
  const usableW = Math.round((isLandscape ? 277 : 190) * 3.7795);
  const usableH = Math.round((isLandscape ? 190 : 277) * 3.7795);

  // ── Krok 1: tymczasowy niewidoczny kontener do pomiaru wymiarów ──
  const probe = document.createElement('div');
  probe.style.cssText = `position:absolute;top:0;left:-9999px;width:${usableW}px;visibility:hidden;pointer-events:none`;
  document.body.appendChild(probe);

  const heights = selectedBlocks.map(el => {
    const cl = el.cloneNode(true);
    probe.appendChild(cl);
    const h = cl.getBoundingClientRect().height;
    probe.removeChild(cl);
    return h;
  });
  probe.remove();

  // ── Krok 2: algorytm pakowania na strony ──
  const pages = [];
  let i = 0;
  while (i < selectedBlocks.length) {
    if (layout === 'one') { pages.push([i]); i++; continue; }
    const h1 = heights[i], h2 = heights[i + 1];
    if (h2 !== undefined && h1 + h2 + 16 <= usableH) {
      pages.push([i, i + 1]); i += 2;
    } else {
      pages.push([i]); i++;
    }
  }

  // ── Krok 3: buduj HTML wydruku jako string, wstaw do nowego okna ──
  // Pobierz aktualne style z dokumentu (styles.css inline)
  const styleSheets = [...document.styleSheets].map(ss => {
    try { return [...ss.cssRules].map(r => r.cssText).join('\n'); }
    catch(e) { return ''; }
  }).join('\n');

  const pagesHtml = pages.map(idxArr => {
    const dir = idxArr.length === 2 ? 'vertical' : 'vertical';
    const blocks = idxArr.map(idx => selectedBlocks[idx].outerHTML).join('');
    return `<div class="ppr-page ppr-${dir}">${blocks}</div>`;
  }).join('');

  const printHtml = `<!DOCTYPE html><html><head>
  <meta charset="utf-8">
  <style>
    @page { size: A4 ${orient}; margin: ${marginMM}mm; }
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    :root {
      --bg:#f1f5f9;--bg2:#fff;--bg3:#f8fafc;--bg4:#f1f5f9;
      --border:#e2e8f0;--border2:#cbd5e1;
      --accent:#2563eb;--accent-dim:#eff6ff;--accent-mid:#bfdbfe;
      --red-dim:#fee2e2;
      --text:#0f172a;--text2:#475569;--text3:#94a3b8;
      --mono:'JetBrains Mono',monospace;--sans:'Inter',sans-serif;
      --r:6px;--r-md:8px;
    }
    body { font-family: var(--sans); font-size: 13px; background: #fff; }

    /* Strony */
    .ppr-page { display: flex; flex-direction: column; gap: 12px; page-break-after: always; break-after: page; }
    .ppr-page:last-child { page-break-after: avoid; break-after: avoid; }

    /* Encja płachty */
    .plachta-entity { background:#fff; border:1px solid #e2e8f0; border-radius:6px; overflow:hidden; break-inside:avoid; page-break-inside:avoid; }
    .plachta-entity-header { display:flex; align-items:center; gap:8px; padding:6px 10px; font-size:11px; font-weight:700; color:#fff; -webkit-print-color-adjust:exact; print-color-adjust:exact; }
    .plachta-entity-header .ph-dot { width:9px; height:9px; border-radius:50%; background:rgba(255,255,255,.5); flex-shrink:0; }
    .plachta-entity-header .ph-name { flex:1; }
    .plachta-entity-header .ph-badge { font-size:9px; font-weight:500; background:rgba(0,0,0,.15); border-radius:3px; padding:1px 5px; }

    /* Tabela */
    .plachta-scroll { overflow:visible; width:100%; }
    .plachta-tbl { width:100%; table-layout:fixed; border-collapse:collapse; font-size:8px; }
    .plachta-tbl th, .plachta-tbl td { border:1px solid #e2e8f0; padding:2px 3px; }
    .plachta-tbl thead th { background:#f8fafc; font-size:8px; font-weight:600; color:#475569; text-align:center; -webkit-print-color-adjust:exact; print-color-adjust:exact; }
    .plachta-tbl .ph-hour-col { background:#f8fafc; text-align:center; min-width:52px; vertical-align:middle; -webkit-print-color-adjust:exact; print-color-adjust:exact; }
    .ph-hour-num { font-weight:700; font-size:9px; display:block; }
    .ph-hour-time { font-size:7.5px; color:#94a3b8; display:block; }
    .ph-cell { height:42px; vertical-align:top; padding:1px; -webkit-print-color-adjust:exact; print-color-adjust:exact; }
    .ph-cell.ph-empty { background:#f8fafc; -webkit-print-color-adjust:exact; print-color-adjust:exact; }
    .ph-cell.ph-conflict { background:#fee2e2 !important; -webkit-print-color-adjust:exact; print-color-adjust:exact; }
    .ph-card { border-radius:2px; padding:2px 3px; height:40px; border-left:3px solid; overflow:hidden; position:relative; -webkit-print-color-adjust:exact; print-color-adjust:exact; }
    .ph-card .ph-s { font-weight:700; font-size:8px; line-height:1.2; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    .ph-card .ph-t { font-size:7px; color:#475569; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    .ph-card .ph-r { font-size:7px; color:#94a3b8; position:absolute; right:2px; bottom:1px; }
    .ph-card .ph-g { font-size:7.5px; font-weight:700; padding:0 2px; border-radius:2px; display:inline-block; margin-bottom:1px; max-width:100%; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; -webkit-print-color-adjust:exact; print-color-adjust:exact; }
    .ph-multi { display:flex; gap:1px; height:100%; }
    .ph-multi .ph-card { flex:1; min-width:0; }
  </style>
  </head><body>${pagesHtml}</body></html>`;

  // ── Krok 4: drukuj przez ukryty iframe (działa w PWA, nie wymaga popupów) ──
  const iframe = document.createElement('iframe');
  iframe.style.cssText = 'position:fixed;top:0;left:0;width:0;height:0;border:none;visibility:hidden';
  document.body.appendChild(iframe);

  const idoc = iframe.contentDocument || iframe.contentWindow.document;
  idoc.open();
  idoc.write(printHtml);
  idoc.close();

  let printed = false;
  const doPrint = () => {
    if (printed) return;
    printed = true;
    try {
      iframe.contentWindow.focus();
      iframe.contentWindow.print();
    } catch(e) {
      console.error('Print error:', e);
    }
    setTimeout(() => iframe.remove(), 3000);
  };

  iframe.onload = doPrint;
  setTimeout(doPrint, 800); // fallback jeśli onload nie odpali
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

// ═══════════════════════════════════════════════════════════
// MODUŁ SPECJALNE — NI / Rewalidacja / Wspomaganie
// ═══════════════════════════════════════════════════════════

// ── Inicjalizacja pól stanu ──────────────────────────────
function specialEnsureState(){
  if(!S.specialStudents)S.specialStudents=[];
  if(!S.specialAssignments)S.specialAssignments=[];
  if(!S.specialLessons)S.specialLessons={};
}

// ── Pomocniki ─────────────────────────────────────────────
function getSpecialStudent(id){return(S.specialStudents||[]).find(s=>s.id===id)||null;}
function getSpecialAssign(id){return(S.specialAssignments||[]).find(a=>a.id===id)||null;}

const SPECIAL_TYPES={
  ni:  {label:'NI',        long:'Nauczanie indywidualne', color:'#7c3aed'},
  rewa:{label:'Rewa',      long:'Rewalidacja',            color:'#0891b2'},
};

function specialTypeLabel(type){
  return SPECIAL_TYPES[type]||{label:type,long:type,color:'#94a3b8'};
}

// klucz lekcji specjalnej: studentId|day|hour|assignmentId
function slkey(sid,d,h,aid){return sid+'|'+d+'|'+h+'|'+aid;}

function getSpecialLessonsAt(studentId,d,h){
  specialEnsureState();
  return Object.entries(S.specialLessons)
    .filter(([k])=>{const p=k.split('|');return p[0]===studentId&&+p[1]===d&&+p[2]===h;})
    .map(([k,v])=>({key:k,...v}));
}

function setSpecialLesson(sid,d,h,aid,remove){
  specialEnsureState();
  const k=slkey(sid,d,h,aid);
  if(remove)delete S.specialLessons[k];
  else S.specialLessons[k]={assignmentId:aid};
  saveState();
}

// ── Widok: renderSpecialModule ────────────────────────────
window._specialActiveStudentId=null;

function renderSpecialModule(){
  specialEnsureState();
  renderSpecialStudentList();
  if(window._specialActiveStudentId){
    openSpecialDetail(window._specialActiveStudentId);
  }
}

function renderSpecialStudentList(){
  specialEnsureState();
  const el=document.getElementById('special-students-list');
  if(!el)return;
  if(!S.specialStudents.length){
    el.innerHTML='<div class="special-empty"><div style="font-size:32px;margin-bottom:8px">🎓</div><div>Brak uczniów. Kliknij <strong>+ Dodaj ucznia</strong> aby rozpocząć.</div></div>';
    return;
  }
  const sorted=[...S.specialStudents].sort((a,b)=>(a.lastName+a.firstName).localeCompare(b.lastName+b.firstName,'pl'));
  el.innerHTML='<div class="special-students-grid">'+sorted.map(s=>{
    const cls=s.classId?getClass(s.classId):null;
    const t=specialTypeLabel(s.type);
    const asgn=(S.specialAssignments||[]).filter(a=>a.studentId===s.id);
    const totalH=asgn.reduce((sum,a)=>sum+(a.hoursPerWeek||0),0);
    const placed=Object.values(S.specialLessons||{}).filter(l=>{
      const a=getSpecialAssign(l.assignmentId);return a&&a.studentId===s.id;
    }).length;
    const active=window._specialActiveStudentId===s.id;
    return`<div class="special-student-card${active?' active':''}" onclick="openSpecialDetail('${s.id}')">
      <div class="ssc-top">
        <span class="special-type-badge" style="background:${t.color}">${t.label}</span>
        <div class="ssc-actions">
          <button title="Edytuj" onclick="event.stopPropagation();modalSpecialStudent('${s.id}')">✏️</button>
          <button title="Usuń" onclick="event.stopPropagation();deleteSpecialStudent('${s.id}')">🗑</button>
        </div>
      </div>
      <div class="ssc-name">${esc(s.lastName)} ${esc(s.firstName)}</div>
      ${cls?`<div class="ssc-class">Klasa: <strong>${esc(cls.name)}</strong></div>`:'<div class="ssc-class" style="color:var(--text3)">Bez klasy</div>'}
      <div class="ssc-hours">${placed}/${totalH} godz. umieszczonych</div>
    </div>`;
  }).join('')+'</div>';
}

function openSpecialDetail(studentId){
  window._specialActiveStudentId=studentId;
  const detEl=document.getElementById('special-student-detail');
  if(!detEl)return;
  detEl.style.display='';
  const s=getSpecialStudent(studentId);
  if(!s)return;
  renderSpecialStudentList(); // odśwież active state
  const t=specialTypeLabel(s.type);
  const cls=s.classId?getClass(s.classId):null;
  document.getElementById('ssd-badge').textContent=t.long;
  document.getElementById('ssd-badge').style.background=t.color;
  document.getElementById('ssd-name').textContent=s.lastName+' '+s.firstName;
  document.getElementById('ssd-class').textContent=cls?'(klasa '+cls.name+')':'(bez klasy)';
  renderSpecialAssignmentsList(studentId);
  renderSpecialTimetable(studentId);
}

function closeSpecialDetail(){
  window._specialActiveStudentId=null;
  const detEl=document.getElementById('special-student-detail');
  if(detEl)detEl.style.display='none';
  renderSpecialStudentList();
}

function renderSpecialAssignmentsList(studentId){
  specialEnsureState();
  const el=document.getElementById('ssd-assignments');
  if(!el)return;
  const asgn=(S.specialAssignments||[]).filter(a=>a.studentId===studentId);
  if(!asgn.length){
    el.innerHTML='<div style="font-size:13px;color:var(--text3);padding:8px 0">Brak przypisań. Kliknij <strong>+ Dodaj godziny</strong>.</div>';
    return;
  }
  const pc={};
  Object.values(S.specialLessons||{}).forEach(l=>{pc[l.assignmentId]=(pc[l.assignmentId]||0)+1;});
  const s=getSpecialStudent(studentId);
  el.innerHTML='<div class="special-asgn-list">'+asgn.map(a=>{
    const subj=getSubject(a.subjectId),teacher=getTeacher(a.teacherId),room=getRoom(a.roomId);
    const supp=a.supportTeacherId?getTeacher(a.supportTeacherId):null;
    const placed=pc[a.id]||0;
    const done=placed>=a.hoursPerWeek;
    const wcTag=s&&s.type==='ni'?(a.withClass
      ?'<span class="sa-tag sa-tag-wc">z klasą</span>'
      :'<span class="sa-tag sa-tag-ind">indywidualnie</span>')
      :'<span class="sa-tag sa-tag-rewa">poza klasą</span>';
    return`<div class="special-asgn-item${done?' done':''}">
      <div class="sa-subject">${subj?esc(subj.name):'?'}${wcTag}</div>
      <div class="sa-meta">
        ${teacher?`<span>👤 ${esc(teacher.name)}</span>`:''}
        ${supp?`<span>🤝 ${esc(supp.name)} <em style="font-size:10px;color:var(--text3)">(wspomagający)</em></span>`:''}
        ${room?`<span>🚪 ${esc(room.name)}</span>`:''}
      </div>
      <div class="sa-progress">
        <span class="${done?'sa-done':'sa-todo'}">${placed}/${a.hoursPerWeek} godz.</span>
      </div>
      <div class="sa-actions">
        <button class="btn btn-ghost btn-sm" onclick="modalSpecialAssignment('${a.id}')">Edytuj</button>
        <button class="btn btn-danger btn-sm" onclick="deleteSpecialAssignment('${a.id}')">Usuń</button>
      </div>
    </div>`;
  }).join('')+'</div>';
}

// ── Plan tygodniowy ucznia NI ─────────────────────────────
let specialDragData=null;

function renderSpecialTimetable(studentId){
  const wrap=document.getElementById('ssd-timetable');
  if(!wrap)return;
  const s=getSpecialStudent(studentId);
  if(!s){wrap.innerHTML='';return;}
  const specConf=detectSpecialConflicts();
  const isNI=s.type==='ni';
  const hasClass=isNI&&s.classId;

  if(hasClass){
    const cls=getClass(s.classId);
    wrap.innerHTML=`<div class="sp-tbl-legend">
      <span class="sp-leg sp-leg-class">📚 Plan klasy ${esc(cls?cls.name:'')}</span>
      <span class="sp-leg sp-leg-wc">✅ Z klasą</span>
      <span class="sp-leg sp-leg-ind">👤 Indywidualnie</span>
      <span style="font-size:11px;color:var(--text3)">Kliknij szary kafelek klasy aby zaznaczyć "z klasą". Kliknij pustą komórkę aby dodać lekcję indywidualną.</span>
    </div>`;
  } else {
    wrap.innerHTML='';
  }

  const tbl=document.createElement('table');
  tbl.className='timetable special-timetable';
  const thead=tbl.createTHead(),hr=thead.insertRow();
  hr.innerHTML='<th>Godz.</th>'+DAYS.map(d=>`<th>${d}</th>`).join('');
  const tbody=tbl.createTBody();

  S.hours.forEach((h,hi)=>{
    const tr=tbody.insertRow();
    tr.innerHTML=`<td class="hour-col"><span class="hour-num">${h.num}</span><span class="hour-time">${h.start}–${h.end}</span></td>`;
    DAYS.forEach((_,di)=>{
      const td=tr.insertCell();
      td.dataset.day=di;td.dataset.hour=hi;td.dataset.studentId=studentId;
      const specLessons=getSpecialLessonsAt(studentId,di,hi);

      if(hasClass){
        const classLessons=getLessonsAt(s.classId,di,hi);
        const hasClassLesson=classLessons.length>0;
        const hasSpecLesson=specLessons.length>0;
        if(hasClassLesson&&!hasSpecLesson){
          td.className='cell sp-cell-class';
          classLessons.forEach(l=>{
            const card=buildClassPreviewCard(l,s,di,hi);
            if(card)td.appendChild(card);
          });
        } else if(hasSpecLesson){
          td.className='cell';
          specLessons.forEach(l=>{
            const card=buildSpecialCard(l,specConf.has(l.key));
            if(card)td.appendChild(card);
          });
        } else {
          td.className='cell sp-cell-empty';
          td.addEventListener('click',e=>{
            if(e.target.closest('.sp-card'))return;
            openSpecialIndPicker(studentId,di,hi);
          });
        }
      } else {
        td.className='cell';
        specLessons.forEach(l=>{
          const card=buildSpecialCard(l,specConf.has(l.key));
          if(card)td.appendChild(card);
        });
        td.addEventListener('click',e=>{
          if(e.target.closest('.sp-card'))return;
          openSpecialIndPicker(studentId,di,hi);
        });
      }

      td.addEventListener('dragover',e=>{e.preventDefault();td.classList.add('drag-over');});
      td.addEventListener('dragleave',()=>td.classList.remove('drag-over'));
      td.addEventListener('drop',e=>{
        e.preventDefault();td.classList.remove('drag-over');
        if(!specialDragData)return;
        const{fromKey,assignId}=specialDragData;
        if(fromKey){const fp=fromKey.split('|');setSpecialLesson(fp[0],+fp[1],+fp[2],fp[3],true);}
        setSpecialLesson(studentId,di,hi,assignId,false);
        renderSpecialTimetable(studentId);
        renderSpecialStudentList();
      });
    });
  });
  wrap.appendChild(tbl);
}

function buildClassPreviewCard(classLesson,student,day,hour){
  const a=getAssign(classLesson.assignmentId);
  if(!a)return null;
  const subj=getSubject(a.subjectId),teacher=getTeacher(a.teacherId),room=getRoom(a.roomId);
  const color=subj&&subj.color?subj.color:'#94a3b8';
  const div=document.createElement('div');
  div.className='lesson-card sp-class-preview';
  div.title='Kliknij aby zaznaczyć jako \"z klasą\"';
  div.style.borderLeftColor=color;
  div.style.background=hexRgba(color,0.06);
  div.style.opacity='0.72';
  const sname=subj?(subj.short||subj.name):'?';
  const tname=teacher?(teacher.short||teacher.name.split(' ').pop()):'';
  const rname=room?(room.short||room.name):'';
  div.innerHTML=
    `<div class="lc-subject" style="color:${color}">${esc(sname)}<span class="sp-card-tag sp-cls-hint">+ kliknij</span></div>`+
    (tname?`<div class="lc-teacher">${esc(tname)}</div>`:'')+
    (rname?`<div class="lc-room">${esc(rname)}</div>`:'');
  div.addEventListener('click',e=>{
    e.stopPropagation();
    openSpecialWithClassPicker(student,day,hour,a);
  });
  return div;
}

function openSpecialWithClassPicker(student,day,hour,classAssign){
  const subj=getSubject(classAssign.subjectId);
  const suppOpts='<option value="">— brak nauczyciela wspomagającego —</option>'+
    alphaSort(S.teachers,'name').map(t=>`<option value="${t.id}">${esc(t.name)}</option>`).join('');
  const roomOpts='<option value="">— ta sama sala co klasa —</option>'+
    alphaSort(S.rooms,'name').map(r=>`<option value="${r.id}">${esc(r.name)}</option>`).join('');
  openModal(`Lekcja z klasą — ${subj?esc(subj.name):'?'}`,`
    <div style="font-size:12px;color:var(--text3);margin-bottom:12px">
      Uczeń <strong>${esc(student.lastName+' '+student.firstName)}</strong> będzie na tej lekcji z klasą.
    </div>
    <div class="form-group"><label class="form-label">Nauczyciel wspomagający (opcjonalnie)</label>
      <select id="swc-supp" class="form-select">${suppOpts}</select>
    </div>
    <div class="form-group"><label class="form-label">Sala (jeśli inna niż klasy)</label>
      <select id="swc-room" class="form-select">${roomOpts}</select>
    </div>`,
  ()=>{
    const suppId=document.getElementById('swc-supp').value||null;
    const roomId=document.getElementById('swc-room').value||null;
    let asgn=(S.specialAssignments||[]).find(a=>
      a.studentId===student.id&&a.subjectId===classAssign.subjectId&&a.withClass);
    if(!asgn){
      asgn={id:uid(),studentId:student.id,subjectId:classAssign.subjectId,
        teacherId:classAssign.teacherId,supportTeacherId:suppId,
        roomId:roomId||classAssign.roomId,hoursPerWeek:0,withClass:true};
      S.specialAssignments.push(asgn);
    } else {
      asgn.supportTeacherId=suppId;
      if(roomId)asgn.roomId=roomId;
    }
    asgn.hoursPerWeek=(asgn.hoursPerWeek||0)+1;
    setSpecialLesson(student.id,day,hour,asgn.id,false);
    saveState();closeModal();
    renderSpecialTimetable(student.id);
    renderSpecialAssignmentsList(student.id);
    renderSpecialStudentList();
    notify('Oznaczono jako "z klasą"','success');
  });
}

function openSpecialIndPicker(studentId,day,hour){
  specialEnsureState();
  const s=getSpecialStudent(studentId);if(!s)return;
  const asgn=(S.specialAssignments||[]).filter(a=>a.studentId===studentId&&!a.withClass);
  if(!asgn.length){
    if(confirm('Brak przypisań indywidualnych. Dodać nowe?')){modalSpecialAssignment(null);}
    return;
  }
  const pc={};
  Object.values(S.specialLessons).forEach(l=>{pc[l.assignmentId]=(pc[l.assignmentId]||0)+1;});
  const alreadyIn=new Set(getSpecialLessonsAt(studentId,day,hour).map(l=>l.assignmentId));
  const rows=asgn.map(a=>{
    const subj=getSubject(a.subjectId),teacher=getTeacher(a.teacherId);
    const p=pc[a.id]||0,n=a.hoursPerWeek||0;
    if(alreadyIn.has(a.id))return'';
    const done=p>=n;
    return`<tr class="picker-row${done?' picker-done':''}" onclick="pickSpecialLesson('${studentId}',${day},${hour},'${a.id}')">
      <td>${subj?esc(subj.name):'?'}</td>
      <td>${teacher?esc(teacher.name):''}</td>
      <td style="text-align:center;${done?'color:var(--green)':''}">${p}/${n}</td>
    </tr>`;
  }).join('');
  openModal('Dodaj lekcję indywidualną',
    `<table class="picker-table"><thead><tr><th>Przedmiot</th><th>Nauczyciel</th><th>Godz.</th></tr></thead>
     <tbody>${rows||'<tr><td colspan="3" style="text-align:center;color:var(--text3)">Brak dostępnych przypisań indywidualnych</td></tr>'}</tbody></table>`,
    null,false);
}

function buildSpecialCard(lesson,isConf){
  const a=getSpecialAssign(lesson.assignmentId);
  if(!a)return null;
  const subj=getSubject(a.subjectId),teacher=getTeacher(a.teacherId),room=getRoom(a.roomId);
  const supp=a.supportTeacherId?getTeacher(a.supportTeacherId):null;
  const color=subj&&subj.color?subj.color:'#0891b2';
  const div=document.createElement('div');
  div.className='lesson-card sp-card'+(isConf?' conflict':'');
  div.draggable=true;
  div.dataset.key=lesson.key;
  div.style.borderLeftColor=color;
  div.style.background=hexRgba(color,0.1);
  const sname=subj?(subj.short||subj.name):'?';
  const tname=teacher?(teacher.short||teacher.name.split(' ').pop()):'';
  const rname=room?(room.short||room.name):'';
  const suppName=supp?(supp.short||supp.name.split(' ').pop()):'';
  const s=getSpecialStudent(a.studentId);
  let tagHtml='';
  if(s&&s.type==='ni'){
    tagHtml=a.withClass?'<span class="sp-card-tag sp-wc">z klasą</span>':'<span class="sp-card-tag sp-ind">indyw.</span>';
  }else{
    tagHtml='<span class="sp-card-tag sp-rewa">rewa</span>';
  }
  div.innerHTML=
    `<div class="lc-subject" style="color:${color}">${esc(sname)}${tagHtml}</div>`+
    (tname?`<div class="lc-teacher">${esc(tname)}</div>`:'')+
    (suppName?`<div class="lc-teacher" style="color:#7c3aed">🤝${esc(suppName)}</div>`:'')+
    (rname?`<div class="lc-room">${esc(rname)}</div>`:'')+
    '<button class="lc-remove" title="Usuń lekcję">✕</button>';
  div.querySelector('.lc-remove').addEventListener('click',e=>{
    e.stopPropagation();
    const p=lesson.key.split('|');
    if(a.withClass&&a.hoursPerWeek>0){
      a.hoursPerWeek=Math.max(0,a.hoursPerWeek-1);
      if(a.hoursPerWeek===0)S.specialAssignments=S.specialAssignments.filter(x=>x.id!==a.id);
    }
    setSpecialLesson(p[0],+p[1],+p[2],p[3],true);
    saveState();
    renderSpecialTimetable(a.studentId);
    renderSpecialAssignmentsList(a.studentId);
    renderSpecialStudentList();
  });
  div.addEventListener('dragstart',e=>{
    specialDragData={fromKey:lesson.key,assignId:lesson.assignmentId,type:'special'};
    div.classList.add('dragging');e.dataTransfer.effectAllowed='move';
  });
  div.addEventListener('dragend',()=>div.classList.remove('dragging'));
  return div;
}

function openSpecialPicker(studentId,day,hour){openSpecialIndPicker(studentId,day,hour);}

window.pickSpecialLesson=function(studentId,day,hour,assignId){
  setSpecialLesson(studentId,+day,+hour,assignId,false);
  closeModal();
  renderSpecialTimetable(studentId);
  renderSpecialAssignmentsList(studentId);
  renderSpecialStudentList();
};

// ── Detekcja konfliktów specjalnych ──────────────────────
function detectSpecialConflicts(){
  specialEnsureState();
  const seen={},conf=new Set();
  // Konflikty z głównym planem i między sobą
  Object.entries(S.specialLessons).forEach(([k,l])=>{
    const a=getSpecialAssign(l.assignmentId);if(!a)return;
    const p=k.split('|');const sl=p[1]+'|'+p[2];
    if(a.teacherId){
      const tk='t|'+a.teacherId+'|'+sl;
      if(seen[tk]){conf.add(k);conf.add(seen[tk]);}
      seen[tk]=k;
    }
    if(a.supportTeacherId){
      const stk='t|'+a.supportTeacherId+'|'+sl;
      if(seen[stk]){conf.add(k);conf.add(seen[stk]);}
      seen[stk]=k;
    }
    if(a.roomId){
      const rk='r|'+a.roomId+'|'+sl;
      if(seen[rk]){conf.add(k);conf.add(seen[rk]);}
      seen[rk]=k;
    }
  });
  return conf;
}

// detectConflicts cross-check handled inside detectSpecialConflicts()

// renderTimetable integration: injectSpecialIntoTimetable called at end of original renderTimetable

function injectSpecialIntoTimetable(){
  specialEnsureState();
  if(!S.specialLessons)return;
  const specConf=detectSpecialConflicts();
  // Plan klasy — NIE pokazujemy overlay kart (uczeń NI widoczny tylko w module Specjalne)
  // Plan nauczyciela — pokaż jego lekcje specjalne
  if(activeView==='teacher'&&activeViewId){
    Object.entries(S.specialLessons).forEach(([k,l])=>{
      const a=getSpecialAssign(l.assignmentId);if(!a)return;
      if(a.teacherId!==activeViewId&&a.supportTeacherId!==activeViewId)return;
      const s=getSpecialStudent(a.studentId);if(!s)return;
      const p=k.split('|');const[,d,h]=p;
      const wrap=document.getElementById('timetable-wrapper');
      if(!wrap)return;
      const cell=wrap.querySelector(`.cell[data-day="${d}"][data-hour="${h}"]`);
      if(!cell)return;
      const isSupport=a.supportTeacherId===activeViewId;
      const card=buildSpecialOverlayCard(a,s,k,specConf.has(k),false,isSupport);
      if(card){cell.classList.add('has-special');cell.appendChild(card);}
    });
  }
}

function buildSpecialOverlayCard(a,student,key,isConf,isWithClass,isSupport){
  const subj=getSubject(a.subjectId),room=getRoom(a.roomId);
  const t=specialTypeLabel(student.type);
  const color=t.color;
  const div=document.createElement('div');
  div.className='lesson-card sp-overlay-card'+(isConf?' conflict':'');
  div.style.borderLeftColor=color;
  div.style.background=hexRgba(color,0.08);
  div.style.borderLeft=`3px solid ${color}`;
  div.style.opacity='0.88';
  const sname=subj?(subj.short||subj.name):'?';
  const studentName=student.lastName+' '+student.firstName[0]+'.';
  let tagHtml='';
  if(isSupport){tagHtml='<span class="sp-card-tag sp-supp">wspomaganie</span>';}
  else if(isWithClass){tagHtml='<span class="sp-card-tag sp-wc">NI z klasą</span>';}
  div.innerHTML=
    `<div class="lc-subject" style="color:${color}">${esc(sname)}${tagHtml}</div>`+
    `<div class="lc-teacher" style="color:${color};opacity:.8">${esc(studentName)}</div>`+
    (room?`<div class="lc-room">${esc(room.short||room.name)}</div>`:'');
  // klik otwiera szczegóły ucznia w module Specjalne
  div.addEventListener('click',e=>{
    e.stopPropagation();
    switchTab('special');
    requestAnimationFrame(()=>openSpecialDetail(student.id));
  });
  return div;
}

// ── CRUD: Uczeń ──────────────────────────────────────────
function modalSpecialStudent(id){
  specialEnsureState();
  const s=id?getSpecialStudent(id):null;
  const classOpts=alphaSort(S.classes,'name').map(c=>`<option value="${c.id}" ${s&&s.classId===c.id?'selected':''}>${esc(c.name)}</option>`).join('');
  openModal(id?'Edytuj ucznia':'Dodaj ucznia',`
    <div class="form-row">
      <div class="form-group"><label class="form-label">Imię *</label><input id="ss-first" class="form-input" placeholder="Jan" value="${esc(s?s.firstName:'')}"></div>
      <div class="form-group"><label class="form-label">Nazwisko *</label><input id="ss-last" class="form-input" placeholder="Kowalski" value="${esc(s?s.lastName:'')}"></div>
    </div>
    <div class="form-group"><label class="form-label">Typ *</label>
      <select id="ss-type" class="form-select">
        <option value="ni"  ${!s||s.type==='ni' ?'selected':''}>Nauczanie indywidualne (NI)</option>
        <option value="rewa"${s&&s.type==='rewa'?'selected':''}>Rewalidacja</option>
      </select>
    </div>
    <div class="form-group"><label class="form-label">Klasa (opcjonalnie)</label>
      <select id="ss-cls" class="form-select"><option value="">— brak klasy —</option>${classOpts}</select>
    </div>
    <div class="form-group"><label class="form-label">Uwagi</label>
      <input id="ss-note" class="form-input" placeholder="np. orzeczenie nr …" value="${esc(s&&s.note?s.note:[].join(''))}">
    </div>`,
  ()=>{
    const first=document.getElementById('ss-first').value.trim();
    const last=document.getElementById('ss-last').value.trim();
    if(!first||!last){notify('Podaj imię i nazwisko','error');return;}
    const data={
      firstName:first,lastName:last,
      type:document.getElementById('ss-type').value,
      classId:document.getElementById('ss-cls').value||null,
      note:document.getElementById('ss-note').value.trim(),
    };
    if(id){Object.assign(getSpecialStudent(id),data);}
    else{S.specialStudents.push({id:uid(),...data});}
    saveState();closeModal();renderSpecialModule();
    notify(id?'Uczeń zaktualizowany':'Uczeń dodany','success');
  });
}

function deleteSpecialStudent(id){
  specialEnsureState();
  if(!confirm('Usunąć ucznia wraz z wszystkimi jego przypisaniami i lekcjami?'))return;
  const aIds=new Set((S.specialAssignments||[]).filter(a=>a.studentId===id).map(a=>a.id));
  S.specialStudents=S.specialStudents.filter(s=>s.id!==id);
  S.specialAssignments=(S.specialAssignments||[]).filter(a=>a.studentId!==id);
  for(const k of Object.keys(S.specialLessons)){
    if(aIds.has(S.specialLessons[k].assignmentId))delete S.specialLessons[k];
  }
  if(window._specialActiveStudentId===id){window._specialActiveStudentId=null;closeSpecialDetail();}
  saveState();renderSpecialModule();
  notify('Uczeń usunięty','success');
}

// ── CRUD: Przypisanie godzin ──────────────────────────────
function modalSpecialAssignment(id){
  specialEnsureState();
  const a=id?getSpecialAssign(id):null;
  const studentId=a?a.studentId:window._specialActiveStudentId;
  const s=studentId?getSpecialStudent(studentId):null;
  if(!s){notify('Najpierw wybierz ucznia','error');return;}
  const isNI=s.type==='ni';
  const subjOpts=alphaSort(S.subjects,'name').map(su=>`<option value="${su.id}" ${a&&a.subjectId===su.id?'selected':''}>${esc(su.name)}</option>`).join('');
  const teachOpts='<option value="">— brak —</option>'+alphaSort(S.teachers,'name').map(t=>`<option value="${t.id}" ${a&&a.teacherId===t.id?'selected':''}>${esc(t.name)}</option>`).join('');
  const suppOpts='<option value="">— brak —</option>'+alphaSort(S.teachers,'name').map(t=>`<option value="${t.id}" ${a&&a.supportTeacherId===t.id?'selected':''}>${esc(t.name)}</option>`).join('');
  const roomOpts='<option value="">— brak —</option>'+alphaSort(S.rooms,'name').map(r=>`<option value="${r.id}" ${a&&a.roomId===r.id?'selected':''}>${esc(r.name)}</option>`).join('');
  const withClassChecked=a?a.withClass:false;
  openModal(id?'Edytuj przypisanie':'Dodaj godziny',`
    <div style="font-size:12px;color:var(--text3);margin-bottom:12px">Uczeń: <strong>${esc(s.lastName+' '+s.firstName)}</strong> · ${specialTypeLabel(s.type).long}</div>
    <div class="form-group"><label class="form-label">Przedmiot *</label>
      <select id="sa-subj" class="form-select"><option value="">— wybierz —</option>${subjOpts}</select>
    </div>
    <div class="form-group"><label class="form-label">Nauczyciel (prowadzący)</label>
      <select id="sa-teach" class="form-select">${teachOpts}</select>
    </div>
    ${isNI?`<div class="form-group"><label class="form-label">Nauczyciel wspomagający</label>
      <select id="sa-supp" class="form-select">${suppOpts}</select>
      <div style="font-size:11px;color:var(--text3);margin-top:4px">Jeśli wskazany, pojawi się automatycznie w planie klasy i na jego planie nauczyciela.</div>
    </div>`:'<input type="hidden" id="sa-supp" value="">'}
    <div class="form-group"><label class="form-label">Sala</label>
      <select id="sa-room" class="form-select">${roomOpts}</select>
    </div>
    <div class="form-group"><label class="form-label">Godzin / tydzień *</label>
      <input id="sa-hrs" class="form-input" type="number" min="1" max="20" value="${a?a.hoursPerWeek||2:2}">
    </div>
    ${isNI?`<div class="form-group">
      <label class="form-checkbox" style="align-items:center;gap:8px;display:flex">
        <input type="checkbox" id="sa-wc" ${withClassChecked?'checked':''}>
        <span><strong>Lekcja z klasą</strong> — uczeń uczestniczy razem z klasą (pojawi się w planie klasy)</span>
      </label>
      <div style="font-size:11px;color:var(--text3);margin-top:4px">Odznaczone = nauczanie indywidualne poza klasą</div>
    </div>`:'<input type="hidden" id="sa-wc" value="">'}`,
  ()=>{
    const subjectId=document.getElementById('sa-subj').value;
    if(!subjectId){notify('Wybierz przedmiot','error');return;}
    const wcEl=document.getElementById('sa-wc');
    const withClass=isNI&&wcEl?(wcEl.type==='checkbox'?wcEl.checked:false):false;
    const suppEl=document.getElementById('sa-supp');
    const supportTeacherId=(suppEl&&suppEl.value)||null;
    const data={
      studentId,subjectId,
      teacherId:document.getElementById('sa-teach').value||null,
      supportTeacherId,
      roomId:document.getElementById('sa-room').value||null,
      hoursPerWeek:+document.getElementById('sa-hrs').value||1,
      withClass,
    };
    if(id){Object.assign(getSpecialAssign(id),data);}
    else{if(!S.specialAssignments)S.specialAssignments=[];S.specialAssignments.push({id:uid(),...data});}
    saveState();closeModal();
    renderSpecialAssignmentsList(studentId);
    renderSpecialTimetable(studentId);
    renderSpecialStudentList();
    renderTimetable(); // odśwież plan główny (wspomaganie)
    notify(id?'Przypisanie zaktualizowane':'Godziny dodane','success');
  });
}

function deleteSpecialAssignment(id){
  specialEnsureState();
  const a=getSpecialAssign(id);if(!a)return;
  if(!confirm('Usunąć to przypisanie i wszystkie jego lekcje?'))return;
  const sid=a.studentId;
  S.specialAssignments=S.specialAssignments.filter(x=>x.id!==id);
  for(const k of Object.keys(S.specialLessons)){
    if(S.specialLessons[k].assignmentId===id)delete S.specialLessons[k];
  }
  saveState();
  renderSpecialAssignmentsList(sid);
  renderSpecialTimetable(sid);
  renderSpecialStudentList();
  renderTimetable();
  notify('Przypisanie usunięte','success');
}

// importJSON integration: handled inside original importJSON via specialEnsureState calls

// switchTab integration: handled inside original switchTab
