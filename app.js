// ─── APP INITIALIZATION ───────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  loadState();
  renderAll();
  setupServiceWorker();
  setupKeyboard();
  setupAutoSave();
  if (appState.classes.length > 0) {
    setActiveClass(appState.classes[0].id);
  }
});

function setupServiceWorker() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }
}

function setupKeyboard() {
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') closeModal();
    if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); saveState(); notify('Zapisano', 'success'); }
    if ((e.ctrlKey || e.metaKey) && e.key === 'z') { /* TODO undo */ }
  });
}

let autoSaveTimer;
function setupAutoSave() {
  // Auto-save every 30s
  setInterval(() => { saveState(); }, 30000);
}

// ─── RENDER ALL ───────────────────────────────────────────────────────────────
function renderAll() {
  renderSidebar();
  renderTimetable();
}

// ─── SIDEBAR ──────────────────────────────────────────────────────────────────
function renderSidebar() {
  renderClassesSidebar();
  renderTeachersSidebar();
  renderRoomsSidebar();
}

function renderClassesSidebar() {
  const container = document.getElementById('sidebar-classes');
  if (!container) return;
  if (appState.classes.length === 0) {
    container.innerHTML = `<div style="padding:8px 12px;font-size:11px;color:var(--text3)">Brak klas</div>`;
    return;
  }
  container.innerHTML = appState.classes.map(cls => {
    const lessonCount = Object.keys(appState.lessons).filter(k => k.startsWith(cls.id + '_')).length;
    return `<div class="sidebar-item" data-class-id="${cls.id}" onclick="setActiveClass('${cls.id}')">
      <span class="item-dot" style="background:${cls.color || '#555'}"></span>
      <span class="item-label">${cls.name}</span>
      <span class="item-badge">${lessonCount}</span>
      <span class="item-actions">
        <button onclick="event.stopPropagation();editClass('${cls.id}')" title="Edytuj">✏️</button>
        <button onclick="event.stopPropagation();deleteClass('${cls.id}')" title="Usuń">🗑</button>
      </span>
    </div>`;
  }).join('');
}

function renderTeachersSidebar() {
  const container = document.getElementById('sidebar-teachers');
  if (!container) return;
  if (appState.teachers.length === 0) {
    container.innerHTML = `<div style="padding:8px 12px;font-size:11px;color:var(--text3)">Brak nauczycieli</div>`;
    return;
  }
  const load = getTeacherLoad();
  container.innerHTML = appState.teachers.map(t => {
    const h = load[t.id] || 0;
    return `<div class="sidebar-item" data-teacher-id="${t.id}" onclick="setActiveTeacher('${t.id}')">
      <span class="item-dot" style="background:#a855f7"></span>
      <span class="item-label">${t.name}</span>
      <span class="item-badge">${h}h</span>
      <span class="item-actions">
        <button onclick="event.stopPropagation();editTeacher('${t.id}')" title="Edytuj">✏️</button>
        <button onclick="event.stopPropagation();deleteTeacher('${t.id}')" title="Usuń">🗑</button>
      </span>
    </div>`;
  }).join('');
}

function renderRoomsSidebar() {
  const container = document.getElementById('sidebar-rooms');
  if (!container) return;
  if (appState.rooms.length === 0) {
    container.innerHTML = `<div style="padding:8px 12px;font-size:11px;color:var(--text3)">Brak sal</div>`;
    return;
  }
  container.innerHTML = appState.rooms.map(r => `
    <div class="sidebar-item" data-room-id="${r.id}" onclick="setActiveRoom('${r.id}')">
      <span class="item-dot" style="background:#00bcd4"></span>
      <span class="item-label">${r.name}</span>
      <span class="item-actions">
        <button onclick="event.stopPropagation();editRoom('${r.id}')" title="Edytuj">✏️</button>
        <button onclick="event.stopPropagation();deleteRoom('${r.id}')" title="Usuń">🗑</button>
      </span>
    </div>
  `).join('');
}

// ─── NAVIGATION ───────────────────────────────────────────────────────────────
function setActiveClass(id) {
  activeClassId = id;
  activeView = 'class';
  activeViewId = null;
  renderAll();
  // Switch to timetable tab
  switchTab('timetable');
}

function setActiveTeacher(id) {
  activeViewId = id;
  activeView = 'teacher';
  renderAll();
  switchTab('timetable');
}

function setActiveRoom(id) {
  activeViewId = id;
  activeView = 'room';
  renderAll();
  switchTab('timetable');
}

let currentTab = 'timetable';
function switchTab(tab) {
  currentTab = tab;
  document.querySelectorAll('.topbar-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tab));
  document.querySelectorAll('.page').forEach(p => p.classList.toggle('active', p.id === `page-${tab}`));

  if (tab === 'data') renderDataPage();
  if (tab === 'stats') renderStatsPage();
  if (tab === 'settings') renderSettingsPage();
}

// ─── DATA PAGE ────────────────────────────────────────────────────────────────
function renderDataPage() {
  // Already rendered via sub-tabs
}

let dataSubTab = 'classes';
function switchDataTab(tab) {
  dataSubTab = tab;
  document.querySelectorAll('.data-tab-btn').forEach(b => b.classList.toggle('active', b.dataset.dtab === tab));
  // visibility is managed by the wrapper in index.html
  if (tab === 'classes') renderClassesTable();
  else if (tab === 'teachers') renderTeachersTable();
  else if (tab === 'rooms') renderRoomsTable();
  else if (tab === 'subjects') renderSubjectsTable();
  else if (tab === 'assignments') renderAssignmentsTable();
  else if (tab === 'hours') renderHoursEditor();
}

function renderClassesTable() {
  const tbody = document.getElementById('classes-tbody');
  if (!tbody) return;
  if (appState.classes.length === 0) {
    tbody.innerHTML = `<tr><td colspan="5" class="empty-state">Brak klas. <a href="#" onclick="addClassModal()">Dodaj pierwszą klasę.</a></td></tr>`;
    return;
  }
  tbody.innerHTML = appState.classes.map(c => `
    <tr>
      <td><span class="color-dot" style="background:${c.color || '#555'}"></span></td>
      <td style="font-weight:600">${c.name}</td>
      <td style="color:var(--text2)">${c.year || '—'}</td>
      <td style="color:var(--text2);font-family:var(--mono)">${c.students || '—'}</td>
      <td><div class="actions">
        <button class="btn btn-ghost btn-sm" onclick="editClass('${c.id}')">Edytuj</button>
        <button class="btn btn-danger btn-sm" onclick="deleteClass('${c.id}')">Usuń</button>
      </div></td>
    </tr>
  `).join('');
}

function renderTeachersTable() {
  const tbody = document.getElementById('teachers-tbody');
  if (!tbody) return;
  if (appState.teachers.length === 0) {
    tbody.innerHTML = `<tr><td colspan="5" class="empty-state">Brak nauczycieli.</td></tr>`;
    return;
  }
  const load = getTeacherLoad();
  tbody.innerHTML = appState.teachers.map(t => {
    const subjNames = (t.subjects || []).map(id => getSubject(id)?.short || getSubject(id)?.name || id).join(', ');
    const h = load[t.id] || 0;
    return `<tr>
      <td style="font-weight:600">${t.name}</td>
      <td style="font-family:var(--mono);color:var(--text2)">${t.short || '—'}</td>
      <td style="color:var(--text2);font-size:11px">${subjNames || '—'}</td>
      <td style="font-family:var(--mono)">${h} / ${t.maxHours || 18}</td>
      <td><div class="actions">
        <button class="btn btn-ghost btn-sm" onclick="editTeacher('${t.id}')">Edytuj</button>
        <button class="btn btn-danger btn-sm" onclick="deleteTeacher('${t.id}')">Usuń</button>
      </div></td>
    </tr>`;
  }).join('');
}

function renderRoomsTable() {
  const tbody = document.getElementById('rooms-tbody');
  if (!tbody) return;
  if (appState.rooms.length === 0) {
    tbody.innerHTML = `<tr><td colspan="5" class="empty-state">Brak sal.</td></tr>`;
    return;
  }
  tbody.innerHTML = appState.rooms.map(r => `
    <tr>
      <td style="font-weight:600">${r.name}</td>
      <td style="font-family:var(--mono);color:var(--text2)">${r.short || '—'}</td>
      <td style="color:var(--text2)">${r.type || 'sala'}</td>
      <td style="font-family:var(--mono)">${r.capacity || '—'}</td>
      <td><div class="actions">
        <button class="btn btn-ghost btn-sm" onclick="editRoom('${r.id}')">Edytuj</button>
        <button class="btn btn-danger btn-sm" onclick="deleteRoom('${r.id}')">Usuń</button>
      </div></td>
    </tr>
  `).join('');
}

function renderSubjectsTable() {
  const tbody = document.getElementById('subjects-tbody');
  if (!tbody) return;
  if (appState.subjects.length === 0) {
    tbody.innerHTML = `<tr><td colspan="5" class="empty-state">Brak przedmiotów.</td></tr>`;
    return;
  }
  tbody.innerHTML = appState.subjects.map(s => `
    <tr>
      <td><span class="color-dot" style="background:${s.color || '#555'}"></span></td>
      <td style="font-weight:600">${s.name}</td>
      <td style="font-family:var(--mono);color:var(--text2)">${s.short || '—'}</td>
      <td><div class="actions">
        <button class="btn btn-ghost btn-sm" onclick="editSubject('${s.id}')">Edytuj</button>
        <button class="btn btn-danger btn-sm" onclick="deleteSubject('${s.id}')">Usuń</button>
      </div></td>
    </tr>
  `).join('');
}

function renderAssignmentsTable() {
  const tbody = document.getElementById('assignments-tbody');
  if (!tbody) return;
  if (appState.assignments.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" class="empty-state">Brak przypisań. Przypisania łączą klasę, przedmiot, nauczyciela i salę.</td></tr>`;
    return;
  }
  const placed = getAssignmentStats();
  tbody.innerHTML = appState.assignments.map(a => {
    const cls = getClass(a.classId);
    const subj = getSubject(a.subjectId);
    const teacher = getTeacher(a.teacherId);
    const room = getRoom(a.roomId);
    const p = placed[a.id] || 0;
    const n = a.hoursPerWeek || 0;
    const statusColor = p >= n ? 'var(--green)' : 'var(--accent2)';
    return `<tr>
      <td><span class="color-dot" style="background:${cls ? (cls.color||'#555') : '#555'}"></span> ${cls?.name || '?'}</td>
      <td style="font-weight:600;color:${subj?.color || 'inherit'}">${subj?.name || '?'}</td>
      <td>${teacher?.name || '—'}</td>
      <td style="font-family:var(--mono)">${room?.name || '—'}</td>
      <td style="font-family:var(--mono);color:${statusColor}">${p}/${n}</td>
      <td><div class="actions">
        <button class="btn btn-ghost btn-sm" onclick="editAssignment('${a.id}')">Edytuj</button>
        <button class="btn btn-danger btn-sm" onclick="deleteAssignment('${a.id}')">Usuń</button>
      </div></td>
    </tr>`;
  }).join('');
}

function renderHoursEditor() {
  const container = document.getElementById('hours-editor');
  if (!container) return;
  container.innerHTML = `
    <div style="margin-bottom:12px;color:var(--text2);font-size:12px">Ustaw czasy trwania poszczególnych lekcji.</div>
    <div class="hours-grid">
      ${appState.hours.map((h, i) => `
        <div class="hour-row">
          <span class="hour-num-label">${h.num}</span>
          <input class="time-input" type="time" value="${h.start}" onchange="updateHour(${i},'start',this.value)">
          <span class="separator">–</span>
          <input class="time-input" type="time" value="${h.end}" onchange="updateHour(${i},'end',this.value)">
          <button class="btn btn-danger btn-sm btn-icon" onclick="removeHour(${i})" title="Usuń" style="margin-left:4px">✕</button>
        </div>
      `).join('')}
    </div>
    <button class="btn btn-ghost" style="margin-top:10px" onclick="addHour()">+ Dodaj lekcję</button>
  `;
}

function updateHour(idx, field, value) {
  appState.hours[idx][field] = value;
  saveState();
}

function removeHour(idx) {
  appState.hours.splice(idx, 1);
  appState.hours.forEach((h, i) => h.num = i + 1);
  saveState();
  renderHoursEditor();
  renderTimetable();
}

function addHour() {
  const last = appState.hours[appState.hours.length - 1];
  appState.hours.push({ num: appState.hours.length + 1, start: '00:00', end: '00:00' });
  saveState();
  renderHoursEditor();
}

// ─── STATS PAGE ───────────────────────────────────────────────────────────────
function renderStatsPage() {
  const container = document.getElementById('stats-content');
  if (!container) return;

  const conflicts = detectConflicts();
  const conflictCount = Object.keys(conflicts).length;
  const placed = getAssignmentStats();
  const load = getTeacherLoad();

  const totalNeeded = appState.assignments.reduce((s, a) => s + (a.hoursPerWeek || 0), 0);
  const totalPlaced = Object.keys(appState.lessons).length;

  // Per-class completion
  const classStats = appState.classes.map(c => {
    const needed = appState.assignments.filter(a => a.classId === c.id).reduce((s, a) => s + (a.hoursPerWeek || 0), 0);
    const p = Object.keys(appState.lessons).filter(k => k.startsWith(c.id + '_')).length;
    const pct = needed > 0 ? Math.round(p / needed * 100) : 0;
    return { cls: c, needed, placed: p, pct };
  });

  container.innerHTML = `
    <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:20px">
      ${statCard('Klasy', appState.classes.length, '#1a6bff')}
      ${statCard('Nauczyciele', appState.teachers.length, '#a855f7')}
      ${statCard('Sale', appState.rooms.length, '#00bcd4')}
      ${statCard('Konflikty', conflictCount, conflictCount > 0 ? '#ff4d4d' : '#00c97a')}
    </div>
    <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:12px">
      <div>
        <div style="font-size:11px;font-weight:600;color:var(--text3);text-transform:uppercase;letter-spacing:.08em;margin-bottom:8px">Kompletność planu klas</div>
        ${classStats.map(s => `
          <div style="margin-bottom:8px">
            <div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:3px">
              <span style="font-weight:600;color:${s.cls.color || 'inherit'}">${s.cls.name}</span>
              <span style="color:var(--text2);font-family:var(--mono)">${s.placed}/${s.needed}</span>
            </div>
            <div class="progress-bar"><div class="progress-fill" style="width:${s.pct}%;background:${s.pct === 100 ? 'var(--green)' : 'var(--accent)'}"></div></div>
          </div>
        `).join('')}
      </div>
      <div>
        <div style="font-size:11px;font-weight:600;color:var(--text3);text-transform:uppercase;letter-spacing:.08em;margin-bottom:8px">Obciążenie nauczycieli</div>
        ${appState.teachers.map(t => {
          const h = load[t.id] || 0;
          const max = t.maxHours || 18;
          const pct = Math.min(100, Math.round(h / max * 100));
          const color = h > max ? 'var(--red)' : h >= max * 0.9 ? 'var(--yellow)' : 'var(--green)';
          return `<div style="margin-bottom:8px">
            <div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:3px">
              <span>${t.name}</span>
              <span style="color:${color};font-family:var(--mono)">${h}/${max}h</span>
            </div>
            <div class="progress-bar"><div class="progress-fill" style="width:${pct}%;background:${color}"></div></div>
          </div>`;
        }).join('')}
      </div>
    </div>
  `;
}

function statCard(label, value, color) {
  return `<div style="background:var(--bg2);border:1px solid var(--border);border-radius:var(--radius2);padding:14px 16px;border-top:3px solid ${color}">
    <div style="font-size:24px;font-weight:700;font-family:var(--mono);color:${color}">${value}</div>
    <div style="font-size:11px;color:var(--text3);margin-top:2px">${label}</div>
  </div>`;
}

// ─── SETTINGS PAGE ────────────────────────────────────────────────────────────
function renderSettingsPage() {
  const nameEl = document.getElementById('setting-school-name');
  const yearEl = document.getElementById('setting-year');
  if (nameEl) nameEl.value = appState.meta.schoolName || '';
  if (yearEl) yearEl.value = appState.meta.year || '';
}

// ─── MODALS ───────────────────────────────────────────────────────────────────
let modalCallback = null;

function openModal(title, bodyHtml, onConfirm, showFooter = true) {
  modalCallback = onConfirm;
  document.getElementById('modal-title').textContent = title;
  document.getElementById('modal-body').innerHTML = bodyHtml;
  const footer = document.getElementById('modal-footer');
  footer.style.display = showFooter ? 'flex' : 'none';
  document.getElementById('modal-overlay').style.display = 'flex';
}

function closeModal() {
  document.getElementById('modal-overlay').style.display = 'none';
  modalCallback = null;
}

function confirmModal() {
  if (modalCallback) modalCallback();
  closeModal();
}

// ─── ADD/EDIT CLASS ───────────────────────────────────────────────────────────
function addClassModal(id) {
  const cls = id ? getClass(id) : null;
  const color = cls?.color || SUBJECT_COLORS[appState.classes.length % SUBJECT_COLORS.length];
  openModal(id ? 'Edytuj klasę' : 'Dodaj klasę', `
    <div class="form-group">
      <label class="form-label">Nazwa klasy</label>
      <input id="fc-name" class="form-input" placeholder="np. 1A, 2B, klasa 3" value="${cls?.name || ''}">
    </div>
    <div class="form-row">
      <div class="form-group">
        <label class="form-label">Rok/poziom</label>
        <input id="fc-year" class="form-input" placeholder="np. 1" type="number" min="1" max="8" value="${cls?.year || ''}">
      </div>
      <div class="form-group">
        <label class="form-label">Liczba uczniów</label>
        <input id="fc-students" class="form-input" placeholder="30" type="number" min="1" value="${cls?.students || ''}">
      </div>
    </div>
    <div class="form-group form-row-color">
      <div style="flex:1">
        <label class="form-label">Kolor</label>
        <input id="fc-color" class="form-input form-color" type="color" value="${color}">
      </div>
    </div>
  `, () => {
    const name = document.getElementById('fc-name').value.trim();
    if (!name) { notify('Podaj nazwę klasy', 'error'); return; }
    if (id) {
      const c = getClass(id);
      c.name = name;
      c.year = parseInt(document.getElementById('fc-year').value) || null;
      c.students = parseInt(document.getElementById('fc-students').value) || null;
      c.color = document.getElementById('fc-color').value;
    } else {
      appState.classes.push({
        id: genId(), name,
        year: parseInt(document.getElementById('fc-year').value) || null,
        students: parseInt(document.getElementById('fc-students').value) || null,
        color: document.getElementById('fc-color').value,
      });
    }
    saveState(); renderAll();
    if (dataSubTab === 'classes') renderClassesTable();
    notify(id ? 'Klasa zaktualizowana' : 'Klasa dodana', 'success');
  });
}
function editClass(id) { addClassModal(id); }
function deleteClass(id) {
  if (!confirm('Usunąć klasę? Wszystkie jej lekcje zostaną usunięte.')) return;
  appState.classes = appState.classes.filter(c => c.id !== id);
  appState.assignments = appState.assignments.filter(a => a.classId !== id);
  Object.keys(appState.lessons).filter(k => k.startsWith(id + '_')).forEach(k => delete appState.lessons[k]);
  if (activeClassId === id) { activeClassId = appState.classes[0]?.id || null; }
  saveState(); renderAll();
  if (dataSubTab === 'classes') renderClassesTable();
}

// ─── ADD/EDIT TEACHER ─────────────────────────────────────────────────────────
function addTeacherModal(id) {
  const t = id ? getTeacher(id) : null;
  const subjOptions = appState.subjects.map(s =>
    `<option value="${s.id}" ${(t?.subjects||[]).includes(s.id) ? 'selected' : ''}>${s.name}</option>`
  ).join('');
  openModal(id ? 'Edytuj nauczyciela' : 'Dodaj nauczyciela', `
    <div class="form-row">
      <div class="form-group">
        <label class="form-label">Imię i nazwisko</label>
        <input id="ft-name" class="form-input" placeholder="Jan Kowalski" value="${t?.name || ''}">
      </div>
      <div class="form-group">
        <label class="form-label">Skrót</label>
        <input id="ft-short" class="form-input" placeholder="JKow" value="${t?.short || ''}">
      </div>
    </div>
    <div class="form-group">
      <label class="form-label">Przedmioty (Ctrl+klik = wiele)</label>
      <select id="ft-subjects" class="form-select" multiple size="4" style="height:auto">${subjOptions}</select>
    </div>
    <div class="form-group">
      <label class="form-label">Maks. godzin / tydzień</label>
      <input id="ft-maxhours" class="form-input" type="number" min="1" max="40" value="${t?.maxHours || 18}" placeholder="18">
    </div>
  `, () => {
    const name = document.getElementById('ft-name').value.trim();
    if (!name) { notify('Podaj imię i nazwisko', 'error'); return; }
    const sel = document.getElementById('ft-subjects');
    const subjects = Array.from(sel.selectedOptions).map(o => o.value);
    if (id) {
      const teacher = getTeacher(id);
      teacher.name = name;
      teacher.short = document.getElementById('ft-short').value.trim();
      teacher.subjects = subjects;
      teacher.maxHours = parseInt(document.getElementById('ft-maxhours').value) || 18;
    } else {
      appState.teachers.push({ id: genId(), name, short: document.getElementById('ft-short').value.trim(), subjects, maxHours: parseInt(document.getElementById('ft-maxhours').value) || 18 });
    }
    saveState(); renderAll();
    if (dataSubTab === 'teachers') renderTeachersTable();
    notify(id ? 'Nauczyciel zaktualizowany' : 'Nauczyciel dodany', 'success');
  });
}
function editTeacher(id) { addTeacherModal(id); }
function deleteTeacher(id) {
  if (!confirm('Usunąć nauczyciela?')) return;
  appState.teachers = appState.teachers.filter(t => t.id !== id);
  saveState(); renderAll();
  if (dataSubTab === 'teachers') renderTeachersTable();
}

// ─── ADD/EDIT ROOM ────────────────────────────────────────────────────────────
function addRoomModal(id) {
  const r = id ? getRoom(id) : null;
  openModal(id ? 'Edytuj salę' : 'Dodaj salę', `
    <div class="form-row">
      <div class="form-group">
        <label class="form-label">Nazwa sali</label>
        <input id="fr-name" class="form-input" placeholder="101, Sala gym, Chemiczna" value="${r?.name || ''}">
      </div>
      <div class="form-group">
        <label class="form-label">Skrót</label>
        <input id="fr-short" class="form-input" placeholder="101" value="${r?.short || ''}">
      </div>
    </div>
    <div class="form-row">
      <div class="form-group">
        <label class="form-label">Typ</label>
        <select id="fr-type" class="form-select">
          <option value="classroom" ${r?.type==='classroom'?'selected':''}>Klasa</option>
          <option value="lab" ${r?.type==='lab'?'selected':''}>Laboratorium</option>
          <option value="gym" ${r?.type==='gym'?'selected':''}>Hala/siłownia</option>
          <option value="computer" ${r?.type==='computer'?'selected':''}>Informatyczna</option>
          <option value="music" ${r?.type==='music'?'selected':''}>Muzyczna</option>
          <option value="art" ${r?.type==='art'?'selected':''}>Plastyczna</option>
          <option value="other" ${r?.type==='other'?'selected':''}>Inna</option>
        </select>
      </div>
      <div class="form-group">
        <label class="form-label">Pojemność</label>
        <input id="fr-capacity" class="form-input" type="number" min="1" placeholder="30" value="${r?.capacity || ''}">
      </div>
    </div>
  `, () => {
    const name = document.getElementById('fr-name').value.trim();
    if (!name) { notify('Podaj nazwę sali', 'error'); return; }
    if (id) {
      const room = getRoom(id);
      room.name = name;
      room.short = document.getElementById('fr-short').value.trim();
      room.type = document.getElementById('fr-type').value;
      room.capacity = parseInt(document.getElementById('fr-capacity').value) || null;
    } else {
      appState.rooms.push({ id: genId(), name, short: document.getElementById('fr-short').value.trim(), type: document.getElementById('fr-type').value, capacity: parseInt(document.getElementById('fr-capacity').value) || null });
    }
    saveState(); renderAll();
    if (dataSubTab === 'rooms') renderRoomsTable();
    notify(id ? 'Sala zaktualizowana' : 'Sala dodana', 'success');
  });
}
function editRoom(id) { addRoomModal(id); }
function deleteRoom(id) {
  if (!confirm('Usunąć salę?')) return;
  appState.rooms = appState.rooms.filter(r => r.id !== id);
  saveState(); renderAll();
  if (dataSubTab === 'rooms') renderRoomsTable();
}

// ─── ADD/EDIT SUBJECT ─────────────────────────────────────────────────────────
function addSubjectModal(id) {
  const s = id ? getSubject(id) : null;
  const color = s?.color || SUBJECT_COLORS[appState.subjects.length % SUBJECT_COLORS.length];
  openModal(id ? 'Edytuj przedmiot' : 'Dodaj przedmiot', `
    <div class="form-row">
      <div class="form-group">
        <label class="form-label">Nazwa przedmiotu</label>
        <input id="fs-name" class="form-input" placeholder="Matematyka" value="${s?.name || ''}">
      </div>
      <div class="form-group">
        <label class="form-label">Skrót</label>
        <input id="fs-short" class="form-input" placeholder="Mat" value="${s?.short || ''}">
      </div>
    </div>
    <div class="form-group form-row-color">
      <div style="flex:1">
        <label class="form-label">Kolor</label>
        <input id="fs-color" class="form-input form-color" type="color" value="${color}">
      </div>
    </div>
  `, () => {
    const name = document.getElementById('fs-name').value.trim();
    if (!name) { notify('Podaj nazwę przedmiotu', 'error'); return; }
    if (id) {
      const subj = getSubject(id);
      subj.name = name;
      subj.short = document.getElementById('fs-short').value.trim();
      subj.color = document.getElementById('fs-color').value;
    } else {
      appState.subjects.push({ id: genId(), name, short: document.getElementById('fs-short').value.trim(), color: document.getElementById('fs-color').value });
    }
    saveState(); renderAll();
    if (dataSubTab === 'subjects') renderSubjectsTable();
    notify(id ? 'Przedmiot zaktualizowany' : 'Przedmiot dodany', 'success');
  });
}
function editSubject(id) { addSubjectModal(id); }
function deleteSubject(id) {
  if (!confirm('Usunąć przedmiot?')) return;
  appState.subjects = appState.subjects.filter(s => s.id !== id);
  saveState(); renderAll();
  if (dataSubTab === 'subjects') renderSubjectsTable();
}

// ─── ADD/EDIT ASSIGNMENT ──────────────────────────────────────────────────────
function addAssignmentModal(id) {
  const a = id ? getAssign(id) : null;
  const classOpts = appState.classes.map(c => `<option value="${c.id}" ${a?.classId===c.id?'selected':''}>${c.name}</option>`).join('');
  const subjOpts = appState.subjects.map(s => `<option value="${s.id}" ${a?.subjectId===s.id?'selected':''}>${s.name}</option>`).join('');
  const teacherOpts = `<option value="">— brak —</option>` + appState.teachers.map(t => `<option value="${t.id}" ${a?.teacherId===t.id?'selected':''}>${t.name}</option>`).join('');
  const roomOpts = `<option value="">— brak —</option>` + appState.rooms.map(r => `<option value="${r.id}" ${a?.roomId===r.id?'selected':''}>${r.name}</option>`).join('');

  openModal(id ? 'Edytuj przypisanie' : 'Dodaj przypisanie', `
    <div class="form-group">
      <label class="form-label">Klasa</label>
      <select id="fa-class" class="form-select">${classOpts || '<option>Brak klas</option>'}</select>
    </div>
    <div class="form-group">
      <label class="form-label">Przedmiot</label>
      <select id="fa-subj" class="form-select">${subjOpts || '<option>Brak przedmiotów</option>'}</select>
    </div>
    <div class="form-group">
      <label class="form-label">Nauczyciel</label>
      <select id="fa-teacher" class="form-select">${teacherOpts}</select>
    </div>
    <div class="form-group">
      <label class="form-label">Sala</label>
      <select id="fa-room" class="form-select">${roomOpts}</select>
    </div>
    <div class="form-group">
      <label class="form-label">Godzin / tydzień</label>
      <input id="fa-hours" class="form-input" type="number" min="1" max="30" value="${a?.hoursPerWeek || 2}" placeholder="2">
    </div>
  `, () => {
    const classId = document.getElementById('fa-class').value;
    const subjectId = document.getElementById('fa-subj').value;
    if (!classId || !subjectId) { notify('Wybierz klasę i przedmiot', 'error'); return; }
    const data = {
      classId, subjectId,
      teacherId: document.getElementById('fa-teacher').value || null,
      roomId: document.getElementById('fa-room').value || null,
      hoursPerWeek: parseInt(document.getElementById('fa-hours').value) || 1,
    };
    if (id) {
      Object.assign(getAssign(id), data);
    } else {
      appState.assignments.push({ id: genId(), ...data });
    }
    saveState(); renderPool();
    if (dataSubTab === 'assignments') renderAssignmentsTable();
    notify(id ? 'Przypisanie zaktualizowane' : 'Przypisanie dodane', 'success');
  });
}
function editAssignment(id) { addAssignmentModal(id); }
function deleteAssignment(id) {
  if (!confirm('Usunąć przypisanie?')) return;
  appState.assignments = appState.assignments.filter(a => a.id !== id);
  // Remove placed lessons
  for (const [k, l] of Object.entries(appState.lessons)) {
    if (l.assignmentId === id) delete appState.lessons[k];
  }
  saveState(); renderAll();
  if (dataSubTab === 'assignments') renderAssignmentsTable();
}

// ─── IMPORT / EXPORT ──────────────────────────────────────────────────────────
function showImportExport() {
  openModal('Import / Eksport danych', `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">
      <div>
        <div style="font-size:12px;font-weight:600;color:var(--text2);margin-bottom:10px;text-transform:uppercase;letter-spacing:.06em">Eksport</div>
        <div style="display:flex;flex-direction:column;gap:8px">
          <button class="btn btn-primary" onclick="exportNative()">💾 Zapisz plan (.json)</button>
          <button class="btn btn-ghost" onclick="exportPlanSal()">🔄 Eksport do Plan-sal (.json)</button>
          <button class="btn btn-ghost" onclick="exportAllCSV()">📊 Eksport CSV (wszystkie klasy)</button>
          ${activeClassId ? `<button class="btn btn-ghost" onclick="exportCSV('${activeClassId}')">📋 CSV – bieżąca klasa</button>` : ''}
        </div>
      </div>
      <div>
        <div style="font-size:12px;font-weight:600;color:var(--text2);margin-bottom:10px;text-transform:uppercase;letter-spacing:.06em">Import</div>
        <div class="drop-zone" id="drop-zone" onclick="document.getElementById('file-input').click()">
          <div style="font-size:24px;margin-bottom:8px">📂</div>
          Przeciągnij plik JSON lub kliknij, aby wybrać
          <div style="font-size:11px;color:var(--text3);margin-top:4px">Obsługiwane: PlanLekcji .json, Plan-sal .json</div>
        </div>
        <input type="file" id="file-input" accept=".json" style="display:none" onchange="handleFileImport(event)">
      </div>
    </div>
  `, null, false);

  // Setup drop zone
  setTimeout(() => {
    const dz = document.getElementById('drop-zone');
    if (dz) {
      dz.addEventListener('dragover', e => { e.preventDefault(); dz.classList.add('drag-active'); });
      dz.addEventListener('dragleave', () => dz.classList.remove('drag-active'));
      dz.addEventListener('drop', e => {
        e.preventDefault();
        dz.classList.remove('drag-active');
        const file = e.dataTransfer.files[0];
        if (file) readImportFile(file);
      });
    }
  }, 50);
}

function handleFileImport(e) {
  const file = e.target.files[0];
  if (file) readImportFile(file);
}

function readImportFile(file) {
  const reader = new FileReader();
  reader.onload = e => {
    const result = importPlanSal(e.target.result);
    if (result.ok) {
      closeModal();
      renderAll();
      notify(result.msg || 'Dane zaimportowane pomyślnie', 'success');
    } else {
      notify('Błąd importu: ' + result.error, 'error');
    }
  };
  reader.readAsText(file);
}

function exportAllCSV() {
  appState.classes.forEach(c => exportCSV(c.id));
}

// ─── NOTIFICATIONS ────────────────────────────────────────────────────────────
function notify(msg, type = 'info') {
  const el = document.createElement('div');
  el.className = `notif ${type}`;
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => { el.style.opacity = '0'; el.style.transition = 'opacity 0.3s'; setTimeout(() => el.remove(), 300); }, 2500);
}

// ─── SETTINGS SAVE ────────────────────────────────────────────────────────────
function saveSettings() {
  appState.meta.schoolName = document.getElementById('setting-school-name')?.value || '';
  appState.meta.year = document.getElementById('setting-year')?.value || '';
  saveState();
  notify('Ustawienia zapisane', 'success');
}

function clearAllData() {
  if (!confirm('Czy na pewno chcesz usunąć WSZYSTKIE dane? Tej operacji nie można cofnąć!')) return;
  localStorage.removeItem(DB_KEY);
  location.reload();
}
