// ─── TIMETABLE RENDERER ──────────────────────────────────────────────────────
let activeClassId = null;
let activeView = 'class'; // 'class' | 'teacher' | 'room'
let activeViewId = null;

let dragData = null; // { assignmentId, fromKey, type:'pool'|'grid' }

function renderTimetable() {
  const wrapper = document.getElementById('timetable-wrapper');
  if (!wrapper) return;

  const conflicts = detectConflicts();

  if (activeView === 'class') {
    if (!activeClassId) {
      wrapper.innerHTML = `<div class="empty-state"><div class="empty-icon">📅</div><div>Wybierz klasę z lewego panelu, aby zobaczyć jej plan lekcji.</div></div>`;
      return;
    }
    renderClassView(wrapper, activeClassId, conflicts);
  } else if (activeView === 'teacher') {
    if (!activeViewId) {
      wrapper.innerHTML = `<div class="empty-state"><div class="empty-icon">👨‍🏫</div><div>Wybierz nauczyciela z lewego panelu.</div></div>`;
      return;
    }
    renderTeacherView(wrapper, activeViewId, conflicts);
  } else if (activeView === 'room') {
    if (!activeViewId) {
      wrapper.innerHTML = `<div class="empty-state"><div class="empty-icon">🏫</div><div>Wybierz salę z lewego panelu.</div></div>`;
      return;
    }
    renderRoomView(wrapper, activeViewId, conflicts);
  }

  updateViewHeader();
  renderPool();
  highlightSidebar();
}

function renderClassView(wrapper, classId, conflicts) {
  const table = buildTable(conflicts, (day, hourIdx) => {
    const lesson = getLessonAt(classId, day, hourIdx);
    if (!lesson) return null;
    const assign = getAssign(lesson.assignmentId);
    if (!assign) return null;
    return buildLessonCard(assign, lesson, `${classId}_${day}_${hourIdx}`, conflicts[`${classId}_${day}_${hourIdx}`]);
  }, classId, 'class');
  wrapper.innerHTML = '';
  wrapper.appendChild(table);
  attachCellListeners(wrapper, classId);
}

function renderTeacherView(wrapper, teacherId, conflicts) {
  const table = buildTable(conflicts, (day, hourIdx) => {
    // Find any class where this teacher is teaching at this slot
    for (const cls of appState.classes) {
      const lesson = getLessonAt(cls.id, day, hourIdx);
      if (!lesson) continue;
      const assign = getAssign(lesson.assignmentId);
      if (!assign || assign.teacherId !== teacherId) continue;
      return buildLessonCard(assign, lesson, `${cls.id}_${day}_${hourIdx}`, conflicts[`${cls.id}_${day}_${hourIdx}`], cls.name);
    }
    return null;
  }, teacherId, 'teacher');
  wrapper.innerHTML = '';
  wrapper.appendChild(table);
}

function renderRoomView(wrapper, roomId, conflicts) {
  const table = buildTable(conflicts, (day, hourIdx) => {
    for (const cls of appState.classes) {
      const lesson = getLessonAt(cls.id, day, hourIdx);
      if (!lesson) continue;
      const assign = getAssign(lesson.assignmentId);
      if (!assign || assign.roomId !== roomId) continue;
      return buildLessonCard(assign, lesson, `${cls.id}_${day}_${hourIdx}`, conflicts[`${cls.id}_${day}_${hourIdx}`], cls.name);
    }
    return null;
  }, roomId, 'room');
  wrapper.innerHTML = '';
  wrapper.appendChild(table);
}

function buildTable(conflicts, cellContentFn, viewId, viewType) {
  const table = document.createElement('table');
  table.className = 'timetable';

  // Header
  const thead = document.createElement('thead');
  const headerRow = document.createElement('tr');
  headerRow.innerHTML = `<th>Godz.</th>` + DAYS.map(d => `<th>${d}</th>`).join('');
  thead.appendChild(headerRow);
  table.appendChild(thead);

  const tbody = document.createElement('tbody');
  appState.hours.forEach((h, i) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td class="hour-col"><span class="hour-num">${h.num}</span><span class="hour-time">${h.start}–${h.end}</span></td>`;

    DAYS.forEach((_, d) => {
      const td = document.createElement('td');
      td.className = 'cell';
      td.dataset.day = d;
      td.dataset.hour = i;
      td.dataset.viewId = viewId;
      td.dataset.viewType = viewType;

      const content = cellContentFn(d, i);
      if (content) {
        td.appendChild(content);
        const key = viewType === 'class' ? `${viewId}_${d}_${i}` : null;
        if (key && conflicts[key]) td.classList.add('conflict');
      }

      // Drop target only in class view
      if (viewType === 'class') {
        td.addEventListener('dragover', onDragOver);
        td.addEventListener('dragleave', onDragLeave);
        td.addEventListener('drop', onDrop);
      }
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  return table;
}

function buildLessonCard(assign, lesson, key, isConflict, extraLabel) {
  const subj = getSubject(assign.subjectId);
  const teacher = getTeacher(assign.teacherId);
  const room = getRoom(assign.roomId);
  const color = subj ? subj.color : '#555';

  const card = document.createElement('div');
  card.className = 'lesson-card';
  card.style.borderLeftColor = color;
  card.style.background = hexToRgba(color, 0.12);
  card.draggable = true;
  card.dataset.key = key;
  card.dataset.assignmentId = assign.id;

  const subjName = subj ? subj.short || subj.name : '?';
  const teacherStr = teacher ? (teacher.short || teacher.name.split(' ')[1] || teacher.name) : '';
  const roomStr = room ? room.name : '';

  card.innerHTML = `
    <div class="lesson-subject" style="color:${color}">${extraLabel ? `<span style="color:var(--text3);font-weight:400">[${extraLabel}] </span>` : ''}${subjName}</div>
    ${teacherStr ? `<div class="lesson-teacher">${teacherStr}</div>` : ''}
    ${roomStr ? `<div class="lesson-room">${roomStr}</div>` : ''}
    <button class="lesson-remove" title="Usuń lekcję" onclick="removeLesson(event,'${key}')">✕</button>
  `;

  card.addEventListener('dragstart', onCardDragStart);
  card.addEventListener('dragend', onCardDragEnd);
  return card;
}

function attachCellListeners(wrapper, classId) {
  wrapper.querySelectorAll('td.cell').forEach(td => {
    td.addEventListener('click', (e) => {
      if (e.target.classList.contains('lesson-remove') || e.target.closest('.lesson-card')) return;
      const day = parseInt(td.dataset.day);
      const hour = parseInt(td.dataset.hour);
      showLessonPicker(classId, day, hour);
    });
  });
}

// ─── DRAG & DROP ──────────────────────────────────────────────────────────────
function onCardDragStart(e) {
  const card = e.currentTarget;
  dragData = {
    assignmentId: card.dataset.assignmentId,
    fromKey: card.dataset.key,
    type: 'grid',
  };
  card.classList.add('dragging');
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', card.dataset.assignmentId);
}

function onCardDragEnd(e) {
  e.currentTarget.classList.remove('dragging');
}

function onPoolItemDragStart(e) {
  const item = e.currentTarget;
  dragData = {
    assignmentId: item.dataset.assignmentId,
    fromKey: null,
    type: 'pool',
  };
  e.dataTransfer.effectAllowed = 'copy';
  e.dataTransfer.setData('text/plain', item.dataset.assignmentId);
}

function onDragOver(e) {
  e.preventDefault();
  e.dataTransfer.dropEffect = dragData?.type === 'pool' ? 'copy' : 'move';
  e.currentTarget.classList.add('drag-over');
}

function onDragLeave(e) {
  e.currentTarget.classList.remove('drag-over');
}

function onDrop(e) {
  e.preventDefault();
  const td = e.currentTarget;
  td.classList.remove('drag-over');
  if (!dragData) return;

  const classId = td.dataset.viewId;
  const day = parseInt(td.dataset.day);
  const hour = parseInt(td.dataset.hour);

  // Check if there's already a lesson here
  const existing = getLessonAt(classId, day, hour);

  if (dragData.type === 'grid' && dragData.fromKey) {
    // Remove from old position
    const [fromClass, fromDay, fromHour] = dragData.fromKey.split('_');
    if (existing && dragData.fromKey !== `${classId}_${day}_${hour}`) {
      // Swap
      setLesson(fromClass, parseInt(fromDay), parseInt(fromHour), existing.assignmentId);
    } else {
      setLesson(fromClass, parseInt(fromDay), parseInt(fromHour), null);
    }
  }

  setLesson(classId, day, hour, dragData.assignmentId);
  dragData = null;
  renderTimetable();
  notify('Lekcja umieszczona', 'success');
}

// ─── LESSON MANAGEMENT ───────────────────────────────────────────────────────
function removeLesson(e, key) {
  e.stopPropagation();
  const [classId, day, hour] = key.split('_');
  setLesson(classId, parseInt(day), parseInt(hour), null);
  renderTimetable();
}

function showLessonPicker(classId, day, hour) {
  // Show modal to pick an assignment for this slot
  const cls = getClass(classId);
  const classAssignments = appState.assignments.filter(a => a.classId === classId);

  if (classAssignments.length === 0) {
    notify('Brak przypisań dla tej klasy. Najpierw dodaj przypisania w zakładce "Dane".', 'info');
    return;
  }

  const placed = getAssignmentStats();
  const dayName = DAYS[day];
  const h = appState.hours[hour];

  const rows = classAssignments.map(a => {
    const subj = getSubject(a.subjectId);
    const teacher = getTeacher(a.teacherId);
    const room = getRoom(a.roomId);
    const placedCount = placed[a.id] || 0;
    const needed = a.hoursPerWeek || 0;
    const statusColor = placedCount >= needed ? 'var(--green)' : 'var(--accent2)';
    return `<tr class="picker-row" data-assign="${a.id}" style="cursor:pointer">
      <td><span class="color-dot" style="background:${subj?.color || '#555'}"></span></td>
      <td style="font-weight:600">${subj?.name || '?'}</td>
      <td style="color:var(--text2)">${teacher?.name || '—'}</td>
      <td style="color:var(--text2);font-family:var(--mono)">${room?.name || '—'}</td>
      <td><span style="color:${statusColor};font-family:var(--mono)">${placedCount}/${needed}</span></td>
    </tr>`;
  }).join('');

  openModal('Wybierz lekcję', `
    <div style="color:var(--text2);font-size:12px;margin-bottom:10px">${cls?.name} · ${dayName} · lekcja ${h?.num} (${h?.start}–${h?.end})</div>
    <table class="data-table" style="min-width:400px">
      <thead><tr><th></th><th>Przedmiot</th><th>Nauczyciel</th><th>Sala</th><th>Godz.</th></tr></thead>
      <tbody id="picker-tbody">${rows}</tbody>
    </table>
  `, null, false);

  document.getElementById('picker-tbody')?.querySelectorAll('.picker-row').forEach(row => {
    row.addEventListener('click', () => {
      setLesson(classId, day, hour, row.dataset.assign);
      closeModal();
      renderTimetable();
    });
  });
}

// ─── VIEW HEADER UPDATE ───────────────────────────────────────────────────────
function updateViewHeader() {
  const title = document.getElementById('view-title');
  const meta = document.getElementById('view-meta');
  if (!title) return;

  if (activeView === 'class') {
    const cls = getClass(activeClassId);
    title.textContent = cls ? `Klasa ${cls.name}` : 'Plan lekcji';
    if (cls && meta) {
      const placed = Object.keys(appState.lessons).filter(k => k.startsWith(cls.id + '_')).length;
      const total = appState.assignments.filter(a => a.classId === cls.id).reduce((s, a) => s + (a.hoursPerWeek || 0), 0);
      meta.textContent = `${placed} / ${total} godzin umieszczono`;
    }
  } else if (activeView === 'teacher') {
    const t = getTeacher(activeViewId);
    title.textContent = t ? `Nauczyciel: ${t.name}` : 'Plan nauczyciela';
    if (t && meta) {
      const load = getTeacherLoad();
      meta.textContent = `${load[t.id] || 0} / ${t.maxHours || '?'} godz/tyg`;
    }
  } else if (activeView === 'room') {
    const r = getRoom(activeViewId);
    title.textContent = r ? `Sala: ${r.name}` : 'Plan sali';
    if (meta) meta.textContent = '';
  }

  // Conflict count
  const conflicts = detectConflicts();
  const cCount = Object.keys(conflicts).length;
  const conflictEl = document.getElementById('conflict-indicator');
  if (conflictEl) {
    if (cCount > 0) {
      conflictEl.innerHTML = `<span class="conflict-badge">⚠ ${cCount} konflikt${cCount === 1 ? '' : cCount < 5 ? 'y' : 'ów'}</span>`;
    } else {
      conflictEl.innerHTML = `<span class="ok-badge">✓ Brak konfliktów</span>`;
    }
  }
}

// ─── POOL (right panel) ───────────────────────────────────────────────────────
function renderPool() {
  const pool = document.getElementById('lesson-pool');
  if (!pool) return;

  if (activeView !== 'class' || !activeClassId) {
    pool.innerHTML = `<div class="empty-state" style="padding:20px;font-size:12px">Wybierz klasę, aby zobaczyć dostępne lekcje.</div>`;
    return;
  }

  const classAssignments = appState.assignments.filter(a => a.classId === activeClassId);
  if (classAssignments.length === 0) {
    pool.innerHTML = `<div class="empty-state" style="padding:20px;font-size:12px"><div class="empty-icon">📋</div>Brak przypisań. Dodaj przypisania w "Dane → Przypisania".</div>`;
    return;
  }

  const placed = getAssignmentStats();

  // Group by subject
  const bySubj = {};
  classAssignments.forEach(a => {
    if (!bySubj[a.subjectId]) bySubj[a.subjectId] = [];
    bySubj[a.subjectId].push(a);
  });

  let html = '';
  for (const [subjId, assigns] of Object.entries(bySubj)) {
    const subj = getSubject(subjId);
    html += `<div class="pool-section"><div class="pool-section-title">${subj?.name || '?'}</div><div class="pool-items">`;

    assigns.forEach(a => {
      const teacher = getTeacher(a.teacherId);
      const room = getRoom(a.roomId);
      const placedCount = placed[a.id] || 0;
      const needed = a.hoursPerWeek || 0;
      const countClass = placedCount >= needed ? 'done' : placedCount > needed ? 'over' : '';
      const color = subj?.color || '#555';

      html += `<div class="pool-item" draggable="true" data-assignment-id="${a.id}" 
        title="${subj?.name || ''} · ${teacher?.name || 'brak nauczyciela'} · ${room?.name || 'brak sali'}">
        <span class="pool-dot" style="background:${color}"></span>
        <span class="pool-subject" style="color:${color}">${subj?.short || subj?.name || '?'}</span>
        <span class="pool-meta">${teacher?.short || (teacher ? teacher.name.split(' ').map(w=>w[0]).join('') : '—')}</span>
        <span class="pool-meta" style="color:var(--text3)">${room?.name || '—'}</span>
        <span class="pool-count ${countClass}">${placedCount}/${needed}</span>
      </div>`;
    });

    html += `</div></div>`;
  }

  pool.innerHTML = html;

  pool.querySelectorAll('.pool-item').forEach(item => {
    item.addEventListener('dragstart', onPoolItemDragStart);
  });
}

// ─── HIGHLIGHT SIDEBAR ────────────────────────────────────────────────────────
function highlightSidebar() {
  document.querySelectorAll('.sidebar-item[data-class-id]').forEach(el => {
    el.classList.toggle('active', el.dataset.classId === activeClassId && activeView === 'class');
  });
  document.querySelectorAll('.sidebar-item[data-teacher-id]').forEach(el => {
    el.classList.toggle('active', el.dataset.teacherId === activeViewId && activeView === 'teacher');
  });
  document.querySelectorAll('.sidebar-item[data-room-id]').forEach(el => {
    el.classList.toggle('active', el.dataset.roomId === activeViewId && activeView === 'room');
  });
}

// ─── UTILITIES ────────────────────────────────────────────────────────────────
function hexToRgba(hex, alpha) {
  const r = parseInt(hex.slice(1,3), 16);
  const g = parseInt(hex.slice(3,5), 16);
  const b = parseInt(hex.slice(5,7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}
