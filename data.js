// Helper: add minutes to time string (HH:MM)
function addMinutes(time, minutes) {
  const [h, m] = time.split(':').map(Number);
  const total = h * 60 + m + minutes;
  const nh = Math.floor(total / 60) % 24;
  const nm = total % 60;
  return `${nh.toString().padStart(2,'0')}:${nm.toString().padStart(2,'0')}`;
}

// ─── DATA STORE ──────────────────────────────────────────────────────────────
const DB_KEY = 'planlekcji_data';

const DEFAULT_HOURS = [
  { num: 1, start: '08:00', end: '08:45' },
  { num: 2, start: '08:50', end: '09:35' },
  { num: 3, start: '09:45', end: '10:30' },
  { num: 4, start: '10:45', end: '11:30' },
  { num: 5, start: '11:40', end: '12:25' },
  { num: 6, start: '12:30', end: '13:15' },
  { num: 7, start: '13:20', end: '14:05' },
  { num: 8, start: '14:10', end: '14:55' },
  { num: 9, start: '15:00', end: '15:45' },
];

const DAYS = ['Poniedziałek','Wtorek','Środa','Czwartek','Piątek'];
const DAY_SHORT = ['Pon','Wt','Śr','Czw','Pt'];

let appState = {
  meta: {
    schoolName: 'Szkoła',
    year: '2024/2025',
    createdAt: new Date().toISOString(),
    modifiedAt: new Date().toISOString(),
  },
  hours: JSON.parse(JSON.stringify(DEFAULT_HOURS)),
  classes: [],       // { id, name, color, year, students }
  teachers: [],      // { id, name, short, subjects[], maxHours, unavailable[] }
  rooms: [],         // { id, name, short, capacity, type }
  subjects: [],      // { id, name, short, color, weeklyHours }
  groups: [],        // { id, name, classId, students }
  assignments: [],   // { id, classId, subjectId, teacherId, roomId, groupId?, hoursPerWeek }
  lessons: {},       // { "classId_day_hour": { assignmentId, locked } }
  version: 1,
};

// ─── PERSISTENCE ─────────────────────────────────────────────────────────────
function saveState() {
  appState.meta.modifiedAt = new Date().toISOString();
  try {
    localStorage.setItem(DB_KEY, JSON.stringify(appState));
  } catch(e) { console.error('Save failed', e); }
}

function loadState() {
  try {
    const raw = localStorage.getItem(DB_KEY);
    if (raw) {
      const loaded = JSON.parse(raw);
      appState = { ...appState, ...loaded };
      return true;
    }
  } catch(e) { console.error('Load failed', e); }
  return false;
}

// ─── ID GENERATOR ─────────────────────────────────────────────────────────────
function genId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

// ─── LOOKUP HELPERS ───────────────────────────────────────────────────────────
const byId = (arr, id) => arr.find(x => x.id === id);

function getClass(id)    { return byId(appState.classes, id); }
function getTeacher(id)  { return byId(appState.teachers, id); }
function getRoom(id)     { return byId(appState.rooms, id); }
function getSubject(id)  { return byId(appState.subjects, id); }
function getAssign(id)   { return byId(appState.assignments, id); }

function lessonKey(classId, day, hour) { return `${classId}_${day}_${hour}`; }

function getLessonAt(classId, day, hour) {
  return appState.lessons[lessonKey(classId, day, hour)] || null;
}

function setLesson(classId, day, hour, assignmentId) {
  const key = lessonKey(classId, day, hour);
  if (assignmentId === null) {
    delete appState.lessons[key];
  } else {
    appState.lessons[key] = { assignmentId, locked: false };
  }
  saveState();
}

// ─── CONFLICT DETECTION ───────────────────────────────────────────────────────
function detectConflicts() {
  const conflicts = {};
  const bySlot = {}; // "teacherId_day_hour" → [keys], "roomId_day_hour" → [keys]

  for (const [key, lesson] of Object.entries(appState.lessons)) {
    const [classId, day, hour] = key.split('_');
    const assign = getAssign(lesson.assignmentId);
    if (!assign) continue;

    // Teacher conflict
    if (assign.teacherId) {
      const tk = `t_${assign.teacherId}_${day}_${hour}`;
      if (!bySlot[tk]) bySlot[tk] = [];
      bySlot[tk].push(key);
    }
    // Room conflict
    if (assign.roomId) {
      const rk = `r_${assign.roomId}_${day}_${hour}`;
      if (!bySlot[rk]) bySlot[rk] = [];
      bySlot[rk].push(key);
    }
  }

  for (const [slot, keys] of Object.entries(bySlot)) {
    if (keys.length > 1) {
      keys.forEach(k => conflicts[k] = true);
    }
  }
  return conflicts;
}

// ─── STATS ────────────────────────────────────────────────────────────────────
function getAssignmentStats() {
  // Count placed lessons per assignment
  const placed = {};
  for (const lesson of Object.values(appState.lessons)) {
    placed[lesson.assignmentId] = (placed[lesson.assignmentId] || 0) + 1;
  }
  return placed;
}

function getTeacherLoad() {
  const load = {};
  for (const lesson of Object.values(appState.lessons)) {
    const assign = getAssign(lesson.assignmentId);
    if (!assign || !assign.teacherId) continue;
    load[assign.teacherId] = (load[assign.teacherId] || 0) + 1;
  }
  return load;
}

// ─── SUBJECT COLOR ────────────────────────────────────────────────────────────
const SUBJECT_COLORS = [
  '#1a6bff','#00c97a','#ffb800','#ff4d4d','#a855f7','#00bcd4','#ff6b35','#4caf50',
  '#e91e63','#ff9800','#607d8b','#795548','#00acc1','#7cb342','#e53935','#8e24aa'
];
let _colorIdx = 0;
function nextColor() { return SUBJECT_COLORS[_colorIdx++ % SUBJECT_COLORS.length]; }

// ─── EXPORT / IMPORT ─────────────────────────────────────────────────────────

// Export as PlanLekcji native JSON
function exportNative() {
  const data = JSON.parse(JSON.stringify(appState));
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  downloadBlob(blob, `plan_lekcji_${appState.meta.schoolName.replace(/\s+/g,'_')}_${Date.now()}.json`);
}

// Import native JSON
function importNative(jsonText) {
  try {
    const data = JSON.parse(jsonText);
    if (!data.classes || !data.teachers) throw new Error('Nieprawidłowy format pliku');
    appState = { ...appState, ...data };
    saveState();
    return { ok: true };
  } catch(e) {
    return { ok: false, error: e.message };
  }
}

// ─── PLAN-SAL EXPORT FORMAT ───────────────────────────────────────────────────
// Plan-sal expects JSON with: rooms, teachers, classes, lessons, schedule
function exportPlanSal() {
  const rooms = appState.rooms.map(r => ({
    id: r.id,
    name: r.name,
    short: r.short || r.name,
    capacity: r.capacity || 30,
    type: r.type || 'classroom',
  }));

  const teachers = appState.teachers.map(t => ({
    id: t.id,
    name: t.name,
    short: t.short || t.name.split(' ').map(w=>w[0]).join(''),
    subjects: t.subjects || [],
    maxHours: t.maxHours || 18,
  }));

  const classes = appState.classes.map(c => ({
    id: c.id,
    name: c.name,
    year: c.year || 1,
    students: c.students || 30,
  }));

  // Build schedule: array of lesson entries
  const schedule = [];
  for (const [key, lesson] of Object.entries(appState.lessons)) {
    const [classId, day, hour] = key.split('_');
    const assign = getAssign(lesson.assignmentId);
    if (!assign) continue;
    const subj = getSubject(assign.subjectId);
    schedule.push({
      classId,
      day: parseInt(day),
      hour: parseInt(hour),
      subjectId: assign.subjectId,
      subjectName: subj ? subj.name : '',
      teacherId: assign.teacherId || null,
      roomId: assign.roomId || null,
      groupId: assign.groupId || null,
      locked: lesson.locked || false,
    });
  }

  const out = {
    _format: 'plansal-v1',
    _generated: new Date().toISOString(),
    meta: appState.meta,
    hours: appState.hours,
    rooms,
    teachers,
    classes,
    subjects: appState.subjects,
    groups: appState.groups,
    assignments: appState.assignments,
    schedule,
  };

  const blob = new Blob([JSON.stringify(out, null, 2)], { type: 'application/json' });
  downloadBlob(blob, `plan_sal_export_${Date.now()}.json`);
  return true;
}

// Import from Plan-sal format
function importPlanSal(jsonText) {
  try {
    const data = JSON.parse(jsonText);
    if (data._format && data._format.startsWith('plansal')) {
      // Native plan-sal format
      if (data.rooms) appState.rooms = data.rooms;
      if (data.teachers) appState.teachers = data.teachers;
      if (data.classes) appState.classes = data.classes;
      if (data.subjects) appState.subjects = data.subjects;
      if (data.groups) appState.groups = data.groups;
      if (data.assignments) appState.assignments = data.assignments;
      if (data.hours) appState.hours = data.hours;
      if (data.meta) appState.meta = { ...appState.meta, ...data.meta };
      // Rebuild lessons from schedule
      if (data.schedule) {
        appState.lessons = {};
        for (const entry of data.schedule) {
          const key = lessonKey(entry.classId, entry.day, entry.hour);
          // Find or create assignment
          let assignId = entry.assignmentId;
          if (!assignId) {
            // Try to match existing assignment
            const existing = appState.assignments.find(a =>
              a.classId === entry.classId &&
              a.subjectId === entry.subjectId &&
              a.teacherId === entry.teacherId
            );
            assignId = existing ? existing.id : null;
          }
          if (assignId) {
            appState.lessons[key] = { assignmentId: assignId, locked: entry.locked || false };
          }
        }
      }
      saveState();
      return { ok: true, msg: 'Zaimportowano dane z Plan-sal' };
    } else if (data.classes && data.teachers) {
      // Try native format
      return importNative(jsonText);
    }
    throw new Error('Nierozpoznany format pliku');
  } catch(e) {
    return { ok: false, error: e.message };
  }
}

// Export to CSV (for spreadsheets)
function exportCSV(classId) {
  const cls = getClass(classId);
  if (!cls) return;

  const rows = [['Lekcja', ...DAYS]];
  appState.hours.forEach((h, i) => {
    const row = [`${h.num}. ${h.start}-${h.end}`];
    DAYS.forEach((_, d) => {
      const lesson = getLessonAt(classId, d, i);
      if (lesson) {
        const assign = getAssign(lesson.assignmentId);
        const subj = assign ? getSubject(assign.subjectId) : null;
        const teacher = assign ? getTeacher(assign.teacherId) : null;
        const room = assign ? getRoom(assign.roomId) : null;
        let cell = subj ? subj.name : '';
        if (teacher) cell += ` (${teacher.short || teacher.name})`;
        if (room) cell += ` [${room.name}]`;
        row.push(cell);
      } else {
        row.push('');
      }
    });
    rows.push(row);
  });

  const csv = rows.map(r => r.map(c => `"${String(c).replace(/"/g,'""')}"`).join(',')).join('\n');
  const BOM = '\uFEFF';
  const blob = new Blob([BOM + csv], { type: 'text/csv;charset=utf-8;' });
  downloadBlob(blob, `plan_${cls.name}_${Date.now()}.csv`);
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
