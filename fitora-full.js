/* Complete training, calendar, cardio and native health improvements. */
const FITORA_FULL_SCHEDULE = 'fitora_schedule_v1';
let fitoraCalendarMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1);

function fitoraLocalDate(date) {
  const d = new Date(date);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function fitoraSaveSessions() {
  sessions.sort((a, b) => new Date(b.date) - new Date(a.date));
  saveStore('fitora_sessions', sessions);
  fitoraScheduleCloudSync?.();
  renderHome();
  renderProgress();
}
function fitoraCycleNeedsDeload() {
  const recent = sessions.filter(s => (s.exerciseLogs || []).some(e => (e.sets || []).some(set => set.done))).slice(0, 3);
  if (recent.length < 3) return false;
  if (Date.now() - new Date(recent[0].date).getTime() > 14 * 86400000) return false;
  const demanding = recent.filter(s => (s.exerciseLogs || []).some(e => {
    const done = (e.sets || []).filter(set => set.done && set.kind !== 'warmup');
    const rpe = fitoraEffort(done);
    return done.length >= 2 && (rpe >= 9 || done.filter(set => Number(set.reps) >= fitoraPlanSetTarget().reps).length < done.length / 2);
  }));
  return demanding.length >= 2;
}

const fitoraAdviceBeforeFull = fitoraNextSessionAdvice;
fitoraNextSessionAdvice = function (id) {
  const advice = fitoraAdviceBeforeFull(id);
  if (!advice) return advice;
  const exposures = advice.history || [];
  const latest = advice.last;
  const target = advice.target || fitoraPlanSetTarget().reps;
  const completed = latest.done.filter(set => Number(set.reps) >= target).length;
  const highEffort = advice.effort >= 9;
  if (Date.now() - new Date(latest.session.date).getTime() > 30 * 86400000 && advice.nextWeight > 0) {
    advice.action = 'reingreso';
    advice.nextWeight = Math.max(0, Math.floor(advice.nextWeight * 0.9 * 2) / 2);
    advice.reason = `Pasaron más de 30 días desde que entrenaste este ejercicio. Retomá con ${advice.nextWeight} kg y una técnica cómoda; la carga volverá a progresar con tus nuevos registros.`;
    return advice;
  }
  if (exposures.length >= 2 && highEffort && completed < latest.done.length && advice.nextWeight > 0) {
    advice.action = 'bajar';
    advice.nextWeight = Math.max(0, Math.floor(advice.nextWeight * 0.95 * 2) / 2);
    advice.reason = `En las últimas sesiones el objetivo costó mucho (RPE ${advice.effort.toFixed(1)}). Bajá a ${advice.nextWeight} kg y volvé a completar las series con margen.`;
  }
  if (fitoraCycleNeedsDeload()) advice.reason += ' El esfuerzo de varias sesiones seguidas fue alto; el plan reduce el volumen esta semana.';
  return advice;
};

const fitoraPrescriptionBeforeFull = fitoraCyclePrescription;
fitoraCyclePrescription = function () {
  const plan = fitoraPrescriptionBeforeFull();
  const last = sessions.find(s => (s.exerciseLogs || []).some(e => (e.sets || []).some(set => set.done && set.kind !== 'warmup')));
  if (last && Date.now() - new Date(last.date).getTime() > 30 * 86400000) return { ...plan, sets: 2, deload: true, label: '2 series · regreso gradual' };
  if (plan.deload || !fitoraCycleNeedsDeload()) return plan;
  return { ...plan, sets: 2, deload: true, label: '2 series · descarga automática' };
};

function fitoraScheduleMap() { return loadStore(FITORA_FULL_SCHEDULE, {}); }
function fitoraMovePlanDate(dayIndex, value) {
  const date = String(value || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return;
  const key = `${fitoraEnsureCycle().cycle}-${fitoraEnsureCycle().week}-${dayIndex}`;
  const map = fitoraScheduleMap();
  map[key] = date;
  saveStore(FITORA_FULL_SCHEDULE, map);
  fitoraScheduleCloudSync?.();
  fitoraRenderTrainingCalendar();
  toast('Sesión reprogramada');
}
function fitoraPlanDate(dayIndex) {
  const c = fitoraEnsureCycle(), key = `${c.cycle}-${c.week}-${dayIndex}`;
  const saved = fitoraScheduleMap()[key];
  if (saved) return saved;
  const next = new Date();
  next.setDate(next.getDate() + Math.min(6, dayIndex + 1));
  return fitoraLocalDate(next);
}

const fitoraRenderPlanBeforeFull = renderFitoraPlan;
renderFitoraPlan = function () {
  fitoraRenderPlanBeforeFull();
  const root = $('fitora-plan-card'), list = root?.querySelector('.fitora-plan-days');
  if (!root || !list) return;
  list.querySelectorAll('.fitora-plan-day').forEach((row, i) => {
    if (row.querySelector('.fitora-reschedule')) return;
    const label = row.querySelector('div');
    label?.insertAdjacentHTML('beforeend', `<label class="fitora-reschedule">Próxima fecha<input type="date" min="${fitoraLocalDate(new Date())}" value="${fitoraPlanDate(i)}" onchange="fitoraMovePlanDate(${i},this.value)"></label>`);
  });
  fitoraRenderTrainingCalendar();
};

function fitoraCalendarEntries() {
  const days = new Map();
  for (const session of sessions) {
    const date = fitoraLocalDate(session.date);
    days.set(date, [...(days.get(date) || []), { type: 'session', session }]);
  }
  const c = fitoraEnsureCycle(), scheduled = fitoraScheduleMap();
  const plan = fitoraPlanTargets(Number(fitoraProfile.days) || 3);
  plan.forEach((day, i) => {
    if (c.completedDays.includes(i)) return;
    const date = scheduled[`${c.cycle}-${c.week}-${i}`] || fitoraPlanDate(i);
    days.set(date, [...(days.get(date) || []), { type: 'planned', day, dayIndex: i }]);
  });
  return days;
}
function fitoraRenderTrainingCalendar() {
  const root = $('fitora-training-calendar');
  if (!root) return;
  const month = fitoraCalendarMonth, year = month.getFullYear(), m = month.getMonth();
  const first = new Date(year, m, 1), offset = (first.getDay() + 6) % 7, last = new Date(year, m + 1, 0).getDate();
  const entries = fitoraCalendarEntries(), cells = [];
  for (let i = 0; i < offset; i++) cells.push('<span class="fitora-calendar-empty"></span>');
  for (let day = 1; day <= last; day++) {
    const date = fitoraLocalDate(new Date(year, m, day)), values = entries.get(date) || [];
    cells.push(`<button class="fitora-calendar-day ${values.length ? 'has-entry' : ''}" onclick="fitoraShowCalendarDay('${date}')"><b>${day}</b>${values.length ? `<small>${values.length} actividad${values.length === 1 ? '' : 'es'}</small>` : ''}</button>`);
  }
  root.innerHTML = `<article class="card fitora-calendar"><div class="sectionhead"><div><small class="eyebrow">PLANIFICACIÓN</small><h2>Calendario de entrenamiento</h2></div><div class="fitora-calendar-nav"><button class="quiet" onclick="fitoraChangeCalendarMonth(-1)">‹</button><b>${new Intl.DateTimeFormat('es-AR', { month: 'long', year: 'numeric' }).format(month)}</b><button class="quiet" onclick="fitoraChangeCalendarMonth(1)">›</button></div></div><div class="fitora-calendar-grid">${['Lun','Mar','Mié','Jue','Vie','Sáb','Dom'].map(d => `<small>${d}</small>`).join('')}${cells.join('')}</div><div id="fitora-calendar-day"></div></article>`;
}
function fitoraChangeCalendarMonth(delta) { fitoraCalendarMonth = new Date(fitoraCalendarMonth.getFullYear(), fitoraCalendarMonth.getMonth() + delta, 1); fitoraRenderTrainingCalendar(); }
function fitoraShowCalendarDay(date) {
  const root = $('fitora-calendar-day'), rows = fitoraCalendarEntries().get(date) || [];
  if (!root) return;
  root.innerHTML = `<h3>${new Intl.DateTimeFormat('es-AR', { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date(`${date}T12:00:00`))}</h3>${rows.length ? rows.map(row => row.type === 'session' ? `<p>✓ ${fitoraEsc(row.session.name)} · ${row.session.duration || 0} min</p>` : `<p>Plan: ${fitoraEsc(row.day.label)} <button class="quiet" onclick="startFitoraPlanWorkout(${row.dayIndex})">Empezar</button></p>`).join('') : '<p class="muted">Sin sesiones ni entrenamientos planeados.</p>'}`;
}
window.fitoraMovePlanDate = fitoraMovePlanDate;
window.fitoraChangeCalendarMonth = fitoraChangeCalendarMonth;
window.fitoraShowCalendarDay = fitoraShowCalendarDay;

function fitoraAddCardio(activity) {
  const activityNames = { walk: 'Caminata', run: 'Carrera', bike: 'Bicicleta', other: 'Cardio libre' };
  const ex = { id: `cardio-${activity}`, name_es: activityNames[activity] || activityNames.other, body_part: 'cardio', images: { flat: {} } };
  startSession(activityNames[activity] || activityNames.other, [ex], `cardio-${activity}`, 'cardio');
  if (!state.activeWorkout) return;
  state.activeWorkout.exercises[0].sets = [{ durationMinutes: 0, distanceKm: 0, done: false, kind: 'normal' }];
  persistWorkout(); renderWorkout();
}
window.fitoraAddCardio = fitoraAddCardio;

const fitoraRenderWorkoutBeforeFull = renderWorkout;
renderWorkout = function () {
  fitoraRenderWorkoutBeforeFull();
  const workout = state.activeWorkout;
  if (!workout) return;
  document.querySelectorAll('#workout-list .workout-ex').forEach((card, i) => {
    const exercise = workout.exercises[i];
    if (!exercise) return;
    if (workout.category === 'cardio') {
      const table = card.querySelector('table');
      if (table) {
        table.querySelector('thead').innerHTML = '<tr><th>Intervalo</th><th>Tiempo (min)</th><th>Distancia (km)</th><th>Hecha</th></tr>';
        table.querySelectorAll('tbody tr').forEach((row, j) => {
          const set = exercise.sets[j];
          row.innerHTML = `<td>${j + 1}</td><td><input type="number" min="0" step="0.1" value="${Number(set.durationMinutes) || 0}" onchange="updateSet(${i},${j},'durationMinutes',this.value)"></td><td><input type="number" min="0" step="0.01" value="${Number(set.distanceKm) || 0}" onchange="updateSet(${i},${j},'distanceKm',this.value)"></td><td><input type="checkbox" ${set.done ? 'checked' : ''} onchange="updateSet(${i},${j},'done',this.checked)"></td>`;
        });
      }
      const warmup = card.querySelector('.fitora-warmup-button'); warmup?.remove();
    } else if (workout.category === 'strength' && !card.querySelector('.fitora-warmup-button')) {
      card.querySelector('div')?.insertAdjacentHTML('beforeend', `<button class="addset fitora-warmup-button" onclick="fitoraAddWarmupSet(${i})">＋ Calcular calentamiento</button>`);
    } else if (workout.category !== 'strength') {
      card.querySelector('.fitora-warmup-button')?.remove();
    }
  });
  fitoraRenderPlateCalculator();
};

function fitoraAddWarmupSet(exerciseIndex) {
  const exercise = state.activeWorkout?.exercises?.[exerciseIndex];
  if (!exercise) return;
  const workWeight = Number(exercise.sets.find(set => set.kind !== 'warmup')?.weight) || 0;
  if (!workWeight) { toast('Ingresá primero el peso de trabajo para calcular el calentamiento'); return; }
  const warmups = [0.4, 0.6, 0.8].map((ratio, index) => ({ reps: index ? 5 : 8, weight: Math.round(workWeight * ratio * 2) / 2, done: false, kind: 'warmup', rpe: '' }));
  exercise.sets = [...warmups, ...exercise.sets];
  persistWorkout(); renderWorkout();
}
window.fitoraAddWarmupSet = fitoraAddWarmupSet;

function fitoraRenderPlateCalculator() {
  const root = $('fitora-plate-calculator');
  if (!root) return;
  if (state.activeWorkout?.category !== 'strength') { root.innerHTML = ''; return; }
  root.innerHTML = `<article class="time-tool fitora-plate-tool"><div><small>Discos por lado</small><strong id="fitora-plate-result">—</strong></div><div class="timer-custom"><label>Objetivo kg <input id="fitora-target-weight" type="number" min="0" step="0.5" value="60" oninput="fitoraCalculatePlates()"></label><label>Barra kg <input id="fitora-bar-weight" type="number" min="0" step="0.5" value="20" oninput="fitoraCalculatePlates()"></label></div><small id="fitora-plate-note" class="muted">Usá discos de 20, 15, 10, 5, 2,5 y 1,25 kg.</small></article>`;
  fitoraCalculatePlates();
}
function fitoraCalculatePlates() {
  const output = $('fitora-plate-result'), target = Number($('fitora-target-weight')?.value), bar = Number($('fitora-bar-weight')?.value);
  if (!output || !Number.isFinite(target) || !Number.isFinite(bar) || target < bar) { if (output) output.textContent = 'El objetivo debe ser ≥ a la barra'; return; }
  let remaining = (target - bar) / 2; const discs = [20, 15, 10, 5, 2.5, 1.25], side = [];
  for (const disc of discs) while (remaining >= disc - 0.001) { side.push(disc); remaining = Math.round((remaining - disc) * 100) / 100; }
  output.textContent = remaining ? `No exacto: ${side.length ? side.join(' + ') : 'sin discos'} kg/lado` : `${side.length ? side.join(' + ') : 'sin discos'} kg/lado`;
}
window.fitoraCalculatePlates = fitoraCalculatePlates;

const fitoraUpdateSetBeforePR = window.updateSet;
window.updateSet = function (i, j, key, value) {
  fitoraUpdateSetBeforePR(i, j, key, value);
  const set = state.activeWorkout?.exercises?.[i]?.sets?.[j];
  if (key !== 'done' || value !== true || !set || set.kind === 'warmup' || state.activeWorkout?.category === 'cardio') return;
  const exercise = state.activeWorkout.exercises[i], e1rm = fitoraEstimateOneRepMax(set.weight, set.reps);
  if (!e1rm) return;
  const previous = Math.max(0, ...sessions.flatMap(session => (session.exerciseLogs || []).filter(log => log.id === exercise.id).flatMap(log => (log.sets || []).filter(item => item.done).map(item => fitoraEstimateOneRepMax(item.weight, item.reps)))));
  const currentMax = Math.max(0, ...state.activeWorkout.exercises.flatMap(log => log.id === exercise.id ? log.sets.filter(item => item.done).map(item => fitoraEstimateOneRepMax(item.weight, item.reps)) : []));
  if (e1rm > previous && e1rm >= currentMax && !state.activeWorkout.fitoraPrNotified?.includes(exercise.id)) {
    state.activeWorkout.fitoraPrNotified = [...(state.activeWorkout.fitoraPrNotified || []), exercise.id];
    persistWorkout(); toast(`Récord estimado en ${exercise.name}: ${Math.round(e1rm * 10) / 10} kg de 1RM`);
  }
};

const fitoraFinishWorkoutBeforeFull = window.finishWorkout;
window.finishWorkout = function () {
  const active = state.activeWorkout;
  if (active?.category === 'cardio') {
    if (!active.exercises.some(ex => ex.sets.some(set => set.done))) { toast('Completá al menos un intervalo antes de guardar el cardio'); return; }
    const distance = active.exercises.flatMap(ex => ex.sets).reduce((sum, set) => sum + (set.done ? Number(set.distanceKm) || 0 : 0), 0);
    const minutes = active.exercises.flatMap(ex => ex.sets).reduce((sum, set) => sum + (set.done ? Number(set.durationMinutes) || 0 : 0), 0);
    const priorId = sessions[0]?.id;
    fitoraFinishWorkoutBeforeFull();
    const saved = sessions[0];
    if (saved && saved.id !== priorId) { saved.distanceKm = distance; saved.cardioMinutes = minutes; fitoraSaveSessions(); }
    return;
  }
  fitoraFinishWorkoutBeforeFull();
};

function fitoraEditSession(id) {
  const session = sessions.find(item => item.id === id); if (!session) return;
  const local = new Date(new Date(session.date).getTime() - new Date(session.date).getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  $('modal-content').innerHTML = `<div class="modalhead"><div><small class="eyebrow">HISTORIAL</small><h2>Editar sesión</h2></div><button class="close" onclick="closeModal()">×</button></div><form class="fitora-edit-session" onsubmit="fitoraSaveEditedSession(event,'${fitoraEsc(id)}')"><label>Nombre<input name="name" maxlength="80" value="${fitoraEsc(session.name)}" required></label><label>Fecha y hora<input name="date" type="datetime-local" value="${local}" required></label><label>Duración en minutos<input name="duration" type="number" min="1" max="600" value="${Number(session.duration) || 1}" required></label><button class="primary fullbtn">Guardar cambios</button></form>`;
  $('modal').classList.add('show');
}
function fitoraSaveEditedSession(event, id) {
  event.preventDefault(); const form = new FormData(event.currentTarget), session = sessions.find(item => item.id === id); if (!session) return;
  session.name = String(form.get('name')).trim(); session.date = new Date(form.get('date')).toISOString(); session.duration = Number(form.get('duration')) || session.duration;
  fitoraSaveSessions(); closeModal(); toast('Sesión actualizada');
}
function fitoraDeleteSession(id) {
  if (!confirm('¿Eliminar esta sesión del historial?')) return;
  sessions = sessions.filter(item => item.id !== id); fitoraSaveSessions(); toast('Sesión eliminada');
}
window.fitoraEditSession = fitoraEditSession; window.fitoraSaveEditedSession = fitoraSaveEditedSession; window.fitoraDeleteSession = fitoraDeleteSession;

function fitoraAddHistoryControls() {
  document.querySelectorAll('#history .history-detail').forEach((row, index) => {
    const session = sessions[index]; if (!session || row.querySelector('.fitora-session-actions')) return;
    row.insertAdjacentHTML('beforeend', `<div class="fitora-session-actions"><button class="quiet" onclick="fitoraEditSession('${fitoraEsc(session.id)}')">Editar fecha/datos</button><button class="quiet fitora-delete-session" onclick="fitoraDeleteSession('${fitoraEsc(session.id)}')">Eliminar</button></div>`);
    if (session.distanceKm || session.cardioMinutes) row.querySelector('summary span')?.insertAdjacentHTML('beforeend', `<small>${Number(session.distanceKm || 0).toFixed(2)} km · ${Number(session.cardioMinutes || 0)} min</small>`);
  });
}
const fitoraRenderProgressBeforeFull = window.renderProgress;
window.renderProgress = function () {
  fitoraRenderProgressBeforeFull(); fitoraWeeklyReport(); fitoraAddHistoryControls(); fitoraRenderTrainingCalendar();
  const summary = document.querySelector('[data-progress-panel="summary"]');
  if (summary && !$('fitora-training-calendar')) { const slot = document.createElement('div'); slot.id = 'fitora-training-calendar'; summary.append(slot); }
  fitoraRenderTrainingCalendar();
  const current = sessions.filter(s => { const age = Date.now() - new Date(s.date).getTime(); return age >= 0 && age < 7 * 86400000; });
  const cardioDistance = current.reduce((n, s) => n + (Number(s.distanceKm) || 0), 0);
  const cardioMinutes = current.reduce((n, s) => n + (Number(s.cardioMinutes) || (s.source === 'health' && s.category === 'cardio' ? Number(s.duration) || 0 : 0)), 0);
  const grid = $('fitora-weekly-report')?.querySelector('.record-grid');
  if (grid && !grid.querySelector('.fitora-cardio-weekly')) grid.insertAdjacentHTML('beforeend', `<div class="fitora-cardio-weekly"><small>Cardio</small><b>${cardioDistance.toFixed(1)} km</b><span>${cardioMinutes} min esta semana</span></div>`);
};

function fitoraNativeHealthCard() {
  const panel = document.querySelector('[data-profile-panel="account"]'); if (!panel || $('fitora-native-health')) return;
  const native = Boolean(window.Capacitor?.isNativePlatform?.());
  panel.insertAdjacentHTML('beforeend', `<article class="card" id="fitora-native-health"><div class="sectionhead"><div><small class="eyebrow">SALUD Y ACTIVIDAD</small><h2>Conectar ${/ios/i.test(window.Capacitor?.getPlatform?.() || '') ? 'Apple Health' : 'Health Connect'}</h2></div></div><p class="muted">${native ? 'Importá entrenamientos de relojes y aplicaciones sincronizados con Salud. Fitora pedirá acceso solo a entrenamientos; podés revocarlo cuando quieras.' : 'La conexión con Apple Health y Health Connect está disponible en la app móvil nativa de Fitora.'}</p>${native ? '<button class="secondary" onclick="fitoraConnectHealth()">Conectar y elegir permisos</button><button class="quiet" onclick="fitoraRefreshHealth()">Actualizar actividad</button><button class="quiet" onclick="fitoraShowHealthPrivacy()">Privacidad</button>' : ''}<div id="fitora-health-status" class="muted"></div></article>`);
}
async function fitoraHealthPlugin() {
  if (!window.Capacitor?.isNativePlatform?.()) throw new Error('Instalá la app nativa de Fitora para conectar Salud.');
  if (!window.FitoraHealth) { const module = await import('./native-health.js'); window.FitoraHealth = module.Health; }
  return window.FitoraHealth;
}
async function fitoraConnectHealth() {
  const status = $('fitora-health-status');
  try {
    const health = await fitoraHealthPlugin(), available = await health.isAvailable();
    if (!available.available) throw new Error('Este dispositivo no tiene disponible el servicio de Salud.');
    const authorization = await health.requestAuthorization({ read: ['workouts'], write: [] });
    if (authorization.readDenied?.includes('workouts')) { status.textContent = 'No se autorizó la lectura de entrenamientos. Podés habilitarla después desde los ajustes de Salud.'; return; }
    status.textContent = 'Conexión autorizada. Fitora consultará los entrenamientos compatibles cuando actualices.';
    await fitoraRefreshHealth();
  } catch (error) { if (status) status.textContent = error.message || 'No se pudo conectar Salud.'; }
}
async function fitoraRefreshHealth() {
  const status = $('fitora-health-status');
  try {
    const health = await fitoraHealthPlugin(), endDate = new Date().toISOString(), startDate = new Date(Date.now() - 30 * 86400000).toISOString();
    const workouts = []; let anchor;
    do {
      const page = await health.queryWorkouts({ startDate, endDate, limit: 100, ...(anchor ? { anchor } : {}) });
      workouts.push(...(page.workouts || [])); anchor = page.anchor;
    } while (anchor && workouts.length < 1000);
    let imported = 0;
    for (const item of workouts) {
      const id = `health-${item.platformId || item.id || `${item.startDate}-${item.workoutType}`}`;
      if (sessions.some(session => session.id === id)) continue;
      const type = String(item.workoutType || ''), cardio = /run|walk|cycl|swim|hike|rowing|elliptical|stairs|dance/i.test(type) || Number(item.totalDistance) > 0;
      const labels = { running: 'Carrera', walking: 'Caminata', cycling: 'Bicicleta', strengthTraining: 'Fuerza', traditionalStrengthTraining: 'Fuerza', weightlifting: 'Levantamiento de pesas', swimming: 'Natación', hiking: 'Senderismo', rowing: 'Remo', elliptical: 'Elíptico' };
      const name = labels[type] || type.replace(/([a-z])([A-Z])/g, '$1 $2') || 'Entrenamiento';
      sessions.push({ id, name: `Importado · ${name}`, category: cardio ? 'cardio' : 'strength', date: item.startDate, duration: Math.max(1, Math.round(Number(item.duration || ((new Date(item.endDate) - new Date(item.startDate)) / 1000)) / 60)), distanceKm: Number(item.totalDistance) ? Number(item.totalDistance) / 1000 : 0, source: 'health', exercises: 0, sets: 0, exerciseLogs: [] }); imported++;
    }
    sessions.sort((a, b) => new Date(b.date) - new Date(a.date));
    if (imported) fitoraSaveSessions();
    if (status) status.textContent = imported ? `Se importaron ${imported} actividades desde Salud.` : 'No hay actividades nuevas para importar.';
  } catch (error) { if (status) status.textContent = error.message || 'No se pudo actualizar Salud.'; }
}
window.fitoraConnectHealth = fitoraConnectHealth; window.fitoraRefreshHealth = fitoraRefreshHealth;
async function fitoraShowHealthPrivacy() { try { const health = await fitoraHealthPlugin(); if (window.Capacitor?.getPlatform?.() === 'android') await health.showPrivacyPolicy(); else window.open('https://fitora.fitsystem.com.ar/privacypolicy.html', '_blank', 'noopener'); } catch { window.open('https://fitora.fitsystem.com.ar/privacypolicy.html', '_blank', 'noopener'); } }
window.fitoraShowHealthPrivacy = fitoraShowHealthPrivacy;
const fitoraRenderProfileBeforeFull = window.renderFitoraProfile;
window.renderFitoraProfile = function (...args) { const result = fitoraRenderProfileBeforeFull(...args); fitoraNativeHealthCard(); return result; };
const fitoraBackupDataBeforeFull = window.fitoraBackupData;
window.fitoraBackupData = function () { return { ...fitoraBackupDataBeforeFull(), trainingSchedule: fitoraScheduleMap(), trainingCycle: fitoraCycle, readiness: fitoraReadiness }; };
const fitoraMergeCloudBeforeFull = window.fitoraMergeCloud;
window.fitoraMergeCloud = function (data) { fitoraMergeCloudBeforeFull(data); if (data?.trainingSchedule) saveStore(FITORA_FULL_SCHEDULE, data.trainingSchedule); if (data?.trainingCycle) { fitoraCycle = data.trainingCycle; saveStore(FITORA_CYCLE_KEY, fitoraCycle); } if (data?.readiness) { fitoraReadiness = data.readiness; saveStore(FITORA_READY_KEY, fitoraReadiness); } renderFitoraPlan(); };
document.addEventListener('DOMContentLoaded', () => { renderProgress(); renderFitoraPlan(); renderFitoraProfile(); });
