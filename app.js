'use strict';

/* ==========================================================================
   Scrumban — app.js
   Datos en localStorage (mismas claves que la versión anterior + scrumban_settings)
   ========================================================================== */

const STATUSES = [
    { id: 'backlog',     name: 'Backlog',       color: 'var(--gray)' },
    { id: 'ready',       name: 'Listo',         color: 'var(--accent)' },
    { id: 'in-progress', name: 'En curso',      color: 'var(--orange)' },
    { id: 'testing',     name: 'Pruebas / QA',  color: 'var(--purple)' },
    { id: 'done',        name: 'Hecho',         color: 'var(--green)' }
];
const STATUS_IDS = STATUSES.map(s => s.id);
const WIP_KEYS = { ready: 'ready', 'in-progress': 'in-progress', testing: 'testing' };
const PRIO = { high: 'Alta', medium: 'Media', low: 'Baja' };
const DAY = 86400000;
const VIEW_TITLES = { board: 'Tablero', metrics: 'Métricas', docs: 'Documentos', settings: 'Ajustes' };

const ICON_TRASH = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14"/></svg>';
const ICON_DOC = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/><path d="M9 13h6M9 17h6"/></svg>';
const ICON_SYNC = '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M21 2v6h-6"/><path d="M3 12a9 9 0 0 1 15-6.7L21 8"/><path d="M3 22v-6h6"/><path d="M21 12a9 9 0 0 1-15 6.7L3 16"/></svg>';
const ICON_SYNC_BTN = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 2v6h-6"/><path d="M3 12a9 9 0 0 1 15-6.7L21 8"/><path d="M3 22v-6h6"/><path d="M21 12a9 9 0 0 1-15 6.7L3 16"/></svg>';
const ICON_CHECK = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg>';

/* ---------- Utilidades ---------- */
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
const now = () => Date.now();

function h(tag, props, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(props || {})) {
        if (v == null || v === false) continue;
        if (k === 'class') el.className = v;
        else if (k === 'text') el.textContent = v;
        else if (k === 'html') el.innerHTML = v; // solo SVG estático propio
        else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
        else el.setAttribute(k, v === true ? '' : v);
    }
    kids.flat().forEach(c => {
        if (c == null || c === false) return;
        el.append(c.nodeType ? c : document.createTextNode(String(c)));
    });
    return el;
}

function load(key, fallback) {
    try {
        const v = JSON.parse(localStorage.getItem(key));
        return v == null ? fallback : v;
    } catch (e) { return fallback; }
}

function safeUrl(u) {
    if (!u || typeof u !== 'string') return '';
    try {
        const url = new URL(u.trim());
        return (url.protocol === 'http:' || url.protocol === 'https:') ? url.href : '';
    } catch (e) { return ''; }
}

const isDay = s => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
const parseDay = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const startOfToday = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime(); };
const fmtShort = ts => new Date(ts).toLocaleDateString('es-AR', { day: 'numeric', month: 'short' });
const fmtDay = s => parseDay(s).toLocaleDateString('es-AR', { day: 'numeric', month: 'short' });

function fmtDays(x) {
    if (x < 1) return Math.max(1, Math.round(x * 24)) + ' h';
    return (x < 10 ? Math.round(x * 10) / 10 : Math.round(x)) + ' d';
}

function uid(prefix) { return prefix + '-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }

/* ---------- Estado ---------- */
let projects = load('scrumban_projects', null);
let sprints = load('scrumban_sprints', null);
let tasks = load('scrumban_tasks', null);
let settings = Object.assign(
    { theme: 'auto', enforceWip: false, wip: { ready: 5, 'in-progress': 3, testing: 4 } },
    load('scrumban_settings', {})
);
settings.wip = Object.assign({ ready: 5, 'in-progress': 3, testing: 4 }, settings.wip || {});

let currentView = 'board';
let currentProjectId = 'all';
let currentSprintId = 'all';
let searchQuery = '';
let editingTaskId = null;
let editingSprintId = null;
let dragging = null;
let currentSle = null;

function seedDemo() {
    const t = now();
    projects = [{ id: 'p-default', name: 'General' }, { id: 'p-1', name: 'Rediseño del sitio' }];
    sprints = [
        { id: 's-none', name: 'Sin sprint' },
        { id: 's-1', name: 'Sprint 12', start: '', end: '', goal: '' }
    ];
    const mk = (i, o) => Object.assign({
        id: 't-demo' + i, title: '', desc: '', priority: 'medium', points: '3', status: 'backlog',
        docsLink: '', synced: false, projectId: 'p-default', sprintId: 's-none',
        tags: [], due: '', blocked: false, createdAt: t - 3 * DAY, startedAt: null, doneAt: null, order: i
    }, o);
    tasks = [
        mk(1, { title: 'Redactar documentación de la API', desc: 'Primera versión de la documentación GraphQL para la integración con Monday.', priority: 'high', points: '5', status: 'in-progress', sprintId: 's-1', tags: ['docs', 'api'], startedAt: t - 2 * DAY, synced: true }),
        mk(2, { title: 'Diseñar el tablero principal', desc: 'Interfaz limpia estilo Apple para el tablero.', points: '8', status: 'ready', projectId: 'p-1', tags: ['ui'] }),
        mk(3, { title: 'Definir límites WIP con el equipo', desc: 'Empezar conservador y revisar cada dos semanas.', priority: 'low', points: '2', status: 'backlog' })
    ];
    tasks.forEach(k => {
        k.history = [{ s: 'backlog', at: k.createdAt }];
        if (k.status !== 'backlog') k.history.push({ s: k.status, at: k.startedAt || k.createdAt });
    });
}

function normalize() {
    if (!Array.isArray(projects) || !projects.length) projects = [{ id: 'p-default', name: 'General' }];
    projects = projects.filter(p => p && typeof p === 'object' && p.id).map(p => ({ id: String(p.id), name: String(p.name || 'Sin nombre') }));
    if (!projects.length) projects = [{ id: 'p-default', name: 'General' }];

    if (!Array.isArray(sprints)) sprints = [];
    sprints = sprints.filter(s => s && typeof s === 'object' && s.id).map(s => ({
        id: String(s.id), name: String(s.name || 'Sin nombre'),
        start: isDay(s.start) ? s.start : '', end: isDay(s.end) ? s.end : '', goal: String(s.goal || '')
    }));
    if (!sprints.find(s => s.id === 's-none')) sprints.unshift({ id: 's-none', name: 'Sin sprint', start: '', end: '', goal: '' });

    if (!Array.isArray(tasks)) tasks = [];
    const t0 = now();
    tasks = tasks.filter(t => t && typeof t === 'object').map((t, i) => {
        const status = STATUS_IDS.includes(t.status) ? t.status : 'backlog';
        const createdAt = Number(t.createdAt) || t0;
        const task = {
            id: String(t.id || uid('t')),
            title: String(t.title || 'Sin título'),
            desc: String(t.desc || ''),
            priority: PRIO[t.priority] ? t.priority : 'medium',
            points: String(t.points || '3'),
            status,
            docsLink: typeof t.docsLink === 'string' ? t.docsLink : '',
            synced: !!t.synced,
            projectId: projects.find(p => p.id === t.projectId) ? t.projectId : projects[0].id,
            sprintId: sprints.find(s => s.id === t.sprintId) ? t.sprintId : 's-none',
            tags: Array.isArray(t.tags) ? t.tags.map(String).slice(0, 5) : [],
            due: isDay(t.due) ? t.due : '',
            blocked: !!t.blocked,
            createdAt,
            startedAt: Number(t.startedAt) || null,
            doneAt: Number(t.doneAt) || null,
            order: Number.isFinite(t.order) ? t.order : i,
            history: Array.isArray(t.history) ? t.history.filter(x => x && STATUS_IDS.includes(x.s) && Number(x.at)) : []
        };
        if ((status === 'in-progress' || status === 'testing') && !task.startedAt) task.startedAt = t0;
        if (status === 'done' && !task.doneAt) task.doneAt = t0;
        if (!task.history.length) task.history = [{ s: status, at: task.startedAt || task.doneAt || createdAt }];
        task.history.sort((a, b) => a.at - b.at);
        return task;
    });
}

if (!tasks && !projects && !sprints) seedDemo();
normalize();

function saveAll() {
    try {
        localStorage.setItem('scrumban_tasks', JSON.stringify(tasks));
        localStorage.setItem('scrumban_projects', JSON.stringify(projects));
        localStorage.setItem('scrumban_sprints', JSON.stringify(sprints));
        localStorage.setItem('scrumban_settings', JSON.stringify(settings));
    } catch (e) {
        toast('No se pudo guardar: el almacenamiento está lleno o bloqueado.', { type: 'error' });
    }
}

const byId = id => tasks.find(t => t.id === id);
const projName = id => (projects.find(p => p.id === id) || {}).name || 'Sin proyecto';
const sprintName = id => (sprints.find(s => s.id === id) || {}).name || 'Sin sprint';
const isActive = s => s === 'in-progress' || s === 'testing';
const wipLimit = s => (WIP_KEYS[s] ? Number(settings.wip[s]) || 0 : 0);
const globalCount = s => tasks.filter(t => t.status === s).length;

function setStatus(task, status) {
    if (task.status === status) return;
    const t = now();
    task.status = status;
    task.history.push({ s: status, at: t });
    if (isActive(status)) {
        if (!task.startedAt) task.startedAt = t;
        task.doneAt = null;
    } else if (status === 'done') {
        task.doneAt = t;
    } else {
        task.startedAt = null;
        task.doneAt = null;
    }
}

function wouldExceed(status, task) {
    const lim = wipLimit(status);
    if (!settings.enforceWip || !lim) return false;
    if (task && task.status === status) return false;
    return globalCount(status) >= lim;
}

/* ---------- Filtros ---------- */
function scopeTasks() {
    return tasks.filter(t =>
        (currentProjectId === 'all' || t.projectId === currentProjectId) &&
        (currentSprintId === 'all' || t.sprintId === currentSprintId));
}

function visibleTasks() {
    const q = searchQuery.trim().toLowerCase();
    const list = scopeTasks();
    if (!q) return list;
    return list.filter(t =>
        t.title.toLowerCase().includes(q) ||
        t.desc.toLowerCase().includes(q) ||
        t.tags.some(g => g.toLowerCase().includes(q)));
}

/* ---------- Métricas de flujo ---------- */
function percentile(arr, p) {
    if (!arr.length) return null;
    const a = arr.slice().sort((x, y) => x - y);
    return a[Math.max(0, Math.ceil(p * a.length) - 1)];
}

function cycleSamples(list) {
    return list.filter(t => t.status === 'done' && t.startedAt && t.doneAt && t.doneAt >= t.startedAt)
        .map(t => ({ t, d: (t.doneAt - t.startedAt) / DAY }));
}

function computeSle(list) {
    const s = cycleSamples(list).map(x => x.d);
    return s.length >= 5 ? percentile(s, 0.85) : null;
}

/* ---------- Toasts y confirmación ---------- */
function toast(msg, opts = {}) {
    const box = $('#toasts');
    const el = h('div', { class: 'toast' + (opts.type ? ' ' + opts.type : ''), role: 'status' }, h('span', { text: msg }));
    let timer;
    const close = () => {
        clearTimeout(timer);
        el.classList.add('out');
        setTimeout(() => el.remove(), 260);
    };
    if (opts.action) {
        el.append(h('button', { type: 'button', text: opts.label || 'Deshacer', onclick: () => { opts.action(); close(); } }));
    }
    box.append(el);
    timer = setTimeout(close, opts.action ? 6000 : 3500);
}

let confirmResolve = null;
function confirmDialog(title, message, okLabel) {
    $('#confirmTitle').textContent = title;
    $('#confirmMsg').textContent = message;
    $('#confirmOk').textContent = okLabel || 'Aceptar';
    openModal('confirmModal');
    $('#confirmCancel').focus();
    return new Promise(resolve => { confirmResolve = resolve; });
}
function settleConfirm(val) {
    if (!confirmResolve) return;
    const r = confirmResolve;
    confirmResolve = null;
    closeModal('confirmModal');
    r(val);
}

/* ---------- Modales ---------- */
function openModal(id) {
    const m = document.getElementById(id);
    m.classList.add('active');
    m.setAttribute('aria-hidden', 'false');
}
function closeModal(id) {
    if (id === 'confirmModal' && confirmResolve) { settleConfirm(false); return; }
    const m = document.getElementById(id);
    m.classList.remove('active');
    m.setAttribute('aria-hidden', 'true');
}
function topModal() {
    return $$('.overlay.active').pop() || null;
}

/* ---------- Selectores ---------- */
function fillSelect(sel, items, current, allLabel) {
    sel.replaceChildren();
    if (allLabel) sel.append(h('option', { value: 'all', text: allLabel }));
    items.forEach(it => sel.append(h('option', { value: it.id, text: it.name })));
    if (current != null) sel.value = current;
}

function renderSelectors() {
    if (currentProjectId !== 'all' && !projects.find(p => p.id === currentProjectId)) currentProjectId = 'all';
    if (currentSprintId !== 'all' && !sprints.find(s => s.id === currentSprintId)) currentSprintId = 'all';
    fillSelect($('#projectSelector'), projects, currentProjectId, 'Todos los proyectos');
    fillSelect($('#sprintSelector'), sprints, currentSprintId, 'Todos los sprints');
    $('#deleteProjectBtn').hidden = currentProjectId === 'all' || projects.length < 2;
    const sprintPicked = currentSprintId !== 'all' && currentSprintId !== 's-none';
    $('#editSprintBtn').hidden = !sprintPicked;
    $('#deleteSprintBtn').hidden = !sprintPicked;
}

function renderSprintInfo() {
    const el = $('#sprintInfo');
    const sp = sprints.find(s => s.id === currentSprintId);
    if (!sp || sp.id === 's-none') { el.hidden = true; return; }
    const list = scopeTasks();
    const done = list.filter(t => t.status === 'done').length;
    const parts = [h('strong', { text: sp.name }), ` · ${done}/${list.length} tareas hechas`];
    if (sp.start && sp.end) {
        const endTs = parseDay(sp.end).getTime() + DAY;
        const left = Math.ceil((endTs - now()) / DAY);
        parts.push(left > 0 ? ` · ${left === 1 ? 'queda 1 día' : `quedan ${left} días`}` : ` · finalizó el ${fmtDay(sp.end)}`);
    }
    if (sp.goal) parts.push(` · Objetivo: ${sp.goal}`);
    el.replaceChildren(...parts.map(p => (typeof p === 'string' ? document.createTextNode(p) : p)));
    el.hidden = false;
}

/* ---------- Tablero ---------- */
function buildBoard() {
    const board = $('#board');
    board.replaceChildren();
    STATUSES.forEach(s => {
        const col = h('div', { class: 'column' + (s.id === 'done' ? ' done' : ''), 'data-status': s.id },
            h('div', { class: 'col-header' },
                h('div', { class: 'col-title' },
                    h('span', { class: 'col-dot', style: `background:${s.color}` }),
                    h('h3', { text: s.name }),
                    h('span', { class: 'count', id: 'count-' + s.id, text: '0' })),
                h('span', { class: 'wip', id: 'wip-' + s.id })),
            h('div', { class: 'cards', id: 'col-' + s.id, 'data-status': s.id }));
        board.append(col);
    });
    board.addEventListener('dragstart', onDragStart);
    board.addEventListener('dragover', onDragOver);
    board.addEventListener('dragleave', onDragLeave);
    board.addEventListener('drop', onDrop);
    board.addEventListener('dragend', onDragEnd);
}

const byOrder = (a, b) => (a.order - b.order) || (a.createdAt - b.createdAt);

function renderBoard() {
    currentSle = computeSle(scopeTasks());
    const vis = visibleTasks();
    STATUSES.forEach(s => {
        const box = $('#col-' + s.id);
        box.replaceChildren();
        vis.filter(t => t.status === s.id).sort(byOrder).forEach(t => box.append(cardEl(t)));
        $('#count-' + s.id).textContent = box.children.length;

        const col = box.closest('.column');
        const lim = wipLimit(s.id);
        const gc = globalCount(s.id);
        const wipEl = $('#wip-' + s.id);
        wipEl.textContent = lim ? `WIP ${gc}/${lim}` : '';
        wipEl.title = lim ? 'Tareas en esta columna (todos los proyectos) / límite' : '';
        col.classList.toggle('wip-over', lim > 0 && gc > lim);
        col.classList.toggle('wip-at', lim > 0 && gc === lim);
    });
}

function chip(cls, text, title) {
    return h('span', { class: 'chip' + (cls ? ' ' + cls : ''), text, title });
}

function cardEl(t) {
    const badges = h('div', { class: 'badges' });
    if (currentProjectId === 'all') badges.append(h('span', { class: 'badge', text: projName(t.projectId) }));
    if (currentSprintId === 'all' && t.sprintId !== 's-none') badges.append(h('span', { class: 'badge blue', text: sprintName(t.sprintId) }));
    badges.append(h('span', { class: 'badge prio-' + t.priority, text: PRIO[t.priority] }));
    badges.append(h('span', { class: 'badge', text: t.points + ' pts' }));
    if (t.synced) badges.append(h('span', { class: 'badge monday', title: 'Sincronizada con Monday', html: ICON_SYNC }));

    const card = h('article', {
        class: 'card' + (t.blocked ? ' blocked' : ''),
        draggable: 'true', tabindex: '0', role: 'button', 'data-id': t.id,
        'aria-label': `${t.title}. Abrir para editar`
    }, badges, h('h4', { class: 'card-title', text: t.title }));

    if (t.desc) card.append(h('p', { class: 'card-desc', text: t.desc }));
    if (t.tags.length) card.append(h('div', { class: 'tags' }, t.tags.map(g => h('span', { class: 'tag', text: '#' + g }))));

    const meta = h('div', { class: 'meta' });
    if (t.blocked) meta.append(chip('blocked', 'Bloqueada'));
    if (t.due) {
        const overdue = t.status !== 'done' && parseDay(t.due).getTime() < startOfToday();
        meta.append(chip(overdue ? 'overdue' : '', 'Vence ' + fmtDay(t.due)));
    }
    if (isActive(t.status) && t.startedAt) {
        const age = (now() - t.startedAt) / DAY;
        const aging = currentSle != null && age > currentSle;
        meta.append(chip(aging ? 'aging' : '', 'Edad ' + fmtDays(age), aging ? 'Supera el SLE (percentil 85 del ciclo)' : 'Tiempo desde que empezó'));
    }
    if (meta.children.length) card.append(meta);

    const url = safeUrl(t.docsLink);
    const footer = h('div', { class: 'card-footer' });
    if (url) footer.append(h('a', { class: 'docs-link', href: url, target: '_blank', rel: 'noopener noreferrer', title: 'Abrir documento', html: ICON_DOC + ' Docs' }));
    footer.append(h('button', {
        type: 'button', class: 'delete-btn', title: 'Eliminar tarea', 'aria-label': 'Eliminar tarea', html: ICON_TRASH,
        onclick: e => { e.stopPropagation(); deleteTask(t.id); }
    }));
    card.append(footer);

    card.addEventListener('click', e => { if (!e.target.closest('a,button')) openTask(t.id); });
    card.addEventListener('keydown', e => {
        if (e.target === card && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); openTask(t.id); }
    });
    return card;
}

/* ---------- Drag & drop ---------- */
function afterElement(container, y) {
    const els = $$('.card:not(.dragging)', container);
    let best = { offset: Number.NEGATIVE_INFINITY, el: null };
    els.forEach(el => {
        const box = el.getBoundingClientRect();
        const offset = y - box.top - box.height / 2;
        if (offset < 0 && offset > best.offset) best = { offset, el };
    });
    return best.el;
}

function clearDragClasses() {
    $$('.column').forEach(c => c.classList.remove('drag-over', 'wip-blocked'));
}

function onDragStart(e) {
    const card = e.target.closest && e.target.closest('.card');
    if (!card) return;
    dragging = { id: card.dataset.id, from: card.closest('.cards').dataset.status, el: card, dropped: false };
    e.dataTransfer.effectAllowed = 'move';
    try { e.dataTransfer.setData('text/plain', card.dataset.id); } catch (err) { /* noop */ }
    requestAnimationFrame(() => card.classList.add('dragging'));
}

function onDragOver(e) {
    if (!dragging) return;
    const col = e.target.closest('.column');
    if (!col) return;
    const box = $('.cards', col);
    const status = col.dataset.status;
    const task = byId(dragging.id);
    clearDragClasses();
    if (wouldExceed(status, task)) {
        col.classList.add('wip-blocked');
        e.dataTransfer.dropEffect = 'none';
        return;
    }
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    col.classList.add('drag-over');
    const after = afterElement(box, e.clientY);
    if (after == null) box.appendChild(dragging.el);
    else box.insertBefore(dragging.el, after);
}

function onDragLeave(e) {
    const col = e.target.closest && e.target.closest('.column');
    if (col && !col.contains(e.relatedTarget)) col.classList.remove('drag-over', 'wip-blocked');
}

function onDrop(e) {
    if (!dragging) return;
    const col = e.target.closest('.column');
    if (!col) return;
    e.preventDefault();
    const status = col.dataset.status;
    const task = byId(dragging.id);
    if (!task || wouldExceed(status, task)) { dragging.dropped = false; return; }
    dragging.dropped = true;
    const changed = task.status !== status;
    setStatus(task, status);
    $$('.card', $('.cards', col)).forEach((el, i) => {
        const t = byId(el.dataset.id);
        if (t) t.order = i;
    });
    dragging = null;
    clearDragClasses();
    saveAll();
    refresh();
    const lim = wipLimit(status);
    if (changed && lim && globalCount(status) > lim) {
        toast(`Superaste el límite WIP de «${STATUSES.find(s => s.id === status).name}» (${globalCount(status)}/${lim}).`, { type: 'warn' });
    }
}

function onDragEnd() {
    clearDragClasses();
    const wasDropped = dragging && dragging.dropped;
    dragging = null;
    if (!wasDropped) renderBoard();
}

/* ---------- Tareas ---------- */
function openTask(id) {
    editingTaskId = id || null;
    const t = id ? byId(id) : null;
    const form = $('#taskForm');
    form.reset();
    fillSelect($('#fProject'), projects);
    fillSelect($('#fSprint'), sprints);
    fillSelect($('#fStatus'), STATUSES.map(s => ({ id: s.id, name: s.name })));

    $('#modalTitle').textContent = t ? 'Editar tarea' : 'Nueva tarea';
    $('#saveTaskBtn').textContent = t ? 'Guardar' : 'Crear';
    $('#deleteTaskBtn').hidden = !t;

    if (t) {
        $('#fTitle').value = t.title;
        $('#fDesc').value = t.desc;
        $('#fStatus').value = t.status;
        $('#fPriority').value = t.priority;
        $('#fPoints').value = t.points;
        $('#fProject').value = t.projectId;
        $('#fSprint').value = t.sprintId;
        $('#fDue').value = t.due;
        $('#fTags').value = t.tags.join(', ');
        $('#fDocs').value = t.docsLink;
        $('#fBlocked').checked = t.blocked;
    } else {
        $('#fStatus').value = 'backlog';
        $('#fProject').value = currentProjectId !== 'all' ? currentProjectId : projects[0].id;
        $('#fSprint').value = currentSprintId !== 'all' ? currentSprintId : 's-none';
    }
    openModal('taskModal');
    setTimeout(() => $('#fTitle').focus(), 50);
}

function parseTags(str) {
    const seen = new Set();
    return str.split(',').map(s => s.trim().replace(/^#/, '').slice(0, 20)).filter(s => {
        const k = s.toLowerCase();
        if (!s || seen.has(k)) return false;
        seen.add(k);
        return true;
    }).slice(0, 5);
}

function submitTask(e) {
    e.preventDefault();
    const title = $('#fTitle').value.trim();
    if (!title) { $('#fTitle').focus(); return; }
    const status = $('#fStatus').value;
    const existing = editingTaskId ? byId(editingTaskId) : null;

    if (wouldExceed(status, existing)) {
        toast(`«${STATUSES.find(s => s.id === status).name}» alcanzó su límite WIP (${wipLimit(status)}).`, { type: 'error' });
        return;
    }

    const data = {
        title,
        desc: $('#fDesc').value.trim(),
        priority: $('#fPriority').value,
        points: $('#fPoints').value,
        projectId: $('#fProject').value,
        sprintId: $('#fSprint').value,
        due: $('#fDue').value,
        tags: parseTags($('#fTags').value),
        docsLink: $('#fDocs').value.trim(),
        blocked: $('#fBlocked').checked
    };

    if (existing) {
        Object.assign(existing, data);
        if (existing.status !== status) {
            setStatus(existing, status);
            existing.order = Date.now();
        }
    } else {
        const t = now();
        const task = Object.assign({
            id: uid('t'), synced: false, createdAt: t, startedAt: null, doneAt: null,
            order: t, status: 'backlog', history: [{ s: 'backlog', at: t }]
        }, data);
        tasks.push(task);
        setStatus(task, status);
    }
    saveAll();
    closeModal('taskModal');
    refresh();
}

function deleteTask(id) {
    const idx = tasks.findIndex(t => t.id === id);
    if (idx < 0) return;
    const [removed] = tasks.splice(idx, 1);
    saveAll();
    refresh();
    toast('Tarea eliminada', {
        action: () => { tasks.splice(Math.min(idx, tasks.length), 0, removed); saveAll(); refresh(); }
    });
}

/* ---------- Proyectos y sprints ---------- */
function submitProject(e) {
    e.preventDefault();
    const name = $('#projectName').value.trim();
    if (!name) return;
    const p = { id: uid('p'), name };
    projects.push(p);
    currentProjectId = p.id;
    saveAll();
    closeModal('projectModal');
    refresh();
}

async function deleteCurrentProject() {
    if (currentProjectId === 'all' || projects.length < 2) return;
    const n = tasks.filter(t => t.projectId === currentProjectId).length;
    const ok = await confirmDialog('¿Eliminar proyecto?',
        `Se eliminará «${projName(currentProjectId)}» y sus ${n} tarea${n === 1 ? '' : 's'}. No se puede deshacer.`, 'Eliminar');
    if (!ok) return;
    projects = projects.filter(p => p.id !== currentProjectId);
    tasks = tasks.filter(t => t.projectId !== currentProjectId);
    currentProjectId = 'all';
    saveAll();
    refresh();
}

function openSprintModal(id) {
    editingSprintId = id || null;
    const sp = id ? sprints.find(s => s.id === id) : null;
    $('#sprintForm').reset();
    $('#sprintModalTitle').textContent = sp ? 'Editar sprint' : 'Nuevo sprint';
    $('#saveSprintBtn').textContent = sp ? 'Guardar' : 'Crear';
    if (sp) {
        $('#sprintName').value = sp.name;
        $('#sprintStart').value = sp.start || '';
        $('#sprintEnd').value = sp.end || '';
        $('#sprintGoal').value = sp.goal || '';
    }
    openModal('sprintModal');
    setTimeout(() => $('#sprintName').focus(), 50);
}

function submitSprint(e) {
    e.preventDefault();
    const name = $('#sprintName').value.trim();
    if (!name) return;
    const start = $('#sprintStart').value;
    const end = $('#sprintEnd').value;
    if (start && end && end < start) {
        toast('La fecha de fin no puede ser anterior al inicio.', { type: 'error' });
        return;
    }
    const goal = $('#sprintGoal').value.trim();
    if (editingSprintId) {
        Object.assign(sprints.find(s => s.id === editingSprintId), { name, start, end, goal });
    } else {
        const sp = { id: uid('s'), name, start, end, goal };
        sprints.push(sp);
        currentSprintId = sp.id;
    }
    saveAll();
    closeModal('sprintModal');
    refresh();
}

async function deleteCurrentSprint() {
    if (currentSprintId === 'all' || currentSprintId === 's-none') return;
    const ok = await confirmDialog('¿Eliminar sprint?',
        `Las tareas de «${sprintName(currentSprintId)}» pasarán a «Sin sprint».`, 'Eliminar');
    if (!ok) return;
    tasks.forEach(t => { if (t.sprintId === currentSprintId) t.sprintId = 's-none'; });
    sprints = sprints.filter(s => s.id !== currentSprintId);
    currentSprintId = 'all';
    saveAll();
    refresh();
}

/* ---------- Métricas (vista) ---------- */
function svgBars(vals, labels) {
    const W = 560, H = 190, pad = { l: 30, r: 8, t: 14, b: 26 };
    const iw = W - pad.l - pad.r, ih = H - pad.t - pad.b;
    const nice = Math.max(2, Math.ceil(Math.max(...vals) / 2) * 2);
    const bw = iw / vals.length;
    let s = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Tareas terminadas por semana">`;
    [0, 0.5, 1].forEach(f => {
        const y = pad.t + ih - ih * f;
        s += `<line class="grid" x1="${pad.l}" x2="${W - pad.r}" y1="${y}" y2="${y}"/><text class="axis" x="${pad.l - 6}" y="${y + 3}" text-anchor="end">${Math.round(nice * f)}</text>`;
    });
    vals.forEach((v, i) => {
        const bh = ih * v / nice;
        const x = pad.l + i * bw + bw * 0.16;
        const w = bw * 0.68;
        s += `<rect class="bar" x="${x.toFixed(1)}" y="${(pad.t + ih - bh).toFixed(1)}" width="${w.toFixed(1)}" height="${bh.toFixed(1)}" rx="5"/>`;
        if (v > 0) s += `<text class="val" x="${(x + w / 2).toFixed(1)}" y="${(pad.t + ih - bh - 4).toFixed(1)}" text-anchor="middle">${v}</text>`;
        s += `<text class="axis" x="${(x + w / 2).toFixed(1)}" y="${H - 8}" text-anchor="middle">${labels[i]}</text>`;
    });
    return s + '</svg>';
}

function statusAt(task, ts) {
    if (task.createdAt > ts && (!task.history.length || task.history[0].at > ts)) return null;
    let cur = null;
    for (const hh of task.history) { if (hh.at <= ts) cur = hh.s; else break; }
    return cur;
}

function svgCfd(list) {
    const W = 560, H = 210, pad = { l: 30, r: 8, t: 12, b: 26 };
    const iw = W - pad.l - pad.r, ih = H - pad.t - pad.b;
    const N = 30;
    const order = ['done', 'testing', 'in-progress', 'ready', 'backlog'];
    const base = startOfToday() + DAY - 1;
    const series = [];
    for (let j = 0; j < N; j++) {
        const ts = base - (N - 1 - j) * DAY;
        const c = { done: 0, testing: 0, 'in-progress': 0, ready: 0, backlog: 0 };
        list.forEach(t => { const st = statusAt(t, ts); if (st) c[st]++; });
        series.push(c);
    }
    const max = Math.max(1, ...series.map(c => order.reduce((a, k) => a + c[k], 0)));
    const nice = Math.max(2, Math.ceil(max / 2) * 2);
    const X = j => pad.l + iw * j / (N - 1);
    const Y = v => pad.t + ih - ih * v / nice;
    let s = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Diagrama de flujo acumulado, últimos 30 días">`;
    [0, 0.5, 1].forEach(f => {
        const y = pad.t + ih - ih * f;
        s += `<line class="grid" x1="${pad.l}" x2="${W - pad.r}" y1="${y}" y2="${y}"/><text class="axis" x="${pad.l - 6}" y="${y + 3}" text-anchor="end">${Math.round(nice * f)}</text>`;
    });
    const cum = series.map(() => 0);
    order.forEach(k => {
        const bottom = cum.slice();
        series.forEach((c, j) => { cum[j] += c[k]; });
        let d = '';
        for (let j = 0; j < N; j++) d += `${j ? 'L' : 'M'}${X(j).toFixed(1)},${Y(cum[j]).toFixed(1)}`;
        for (let j = N - 1; j >= 0; j--) d += `L${X(j).toFixed(1)},${Y(bottom[j]).toFixed(1)}`;
        s += `<path class="cfd-${k}" d="${d}Z"/>`;
    });
    [0, 14, 29].forEach(j => {
        const ts = base - (N - 1 - j) * DAY;
        s += `<text class="axis" x="${X(j).toFixed(1)}" y="${H - 8}" text-anchor="${j === 0 ? 'start' : j === 29 ? 'end' : 'middle'}">${fmtShort(ts)}</text>`;
    });
    return s + '</svg>';
}

function svgScatter(samples, sle) {
    const W = 560, H = 190, pad = { l: 30, r: 8, t: 14, b: 26 };
    const iw = W - pad.l - pad.r, ih = H - pad.t - pad.b;
    const t1 = now(), t0 = t1 - 30 * DAY;
    const maxY = Math.max(1, ...samples.map(x => x.d), sle || 0);
    const nice = Math.max(1, Math.ceil(maxY));
    const Y = v => pad.t + ih - ih * v / nice;
    let s = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Tiempo de ciclo por tarea terminada">`;
    [0, 0.5, 1].forEach(f => {
        const y = pad.t + ih - ih * f;
        s += `<line class="grid" x1="${pad.l}" x2="${W - pad.r}" y1="${y}" y2="${y}"/><text class="axis" x="${pad.l - 6}" y="${y + 3}" text-anchor="end">${(nice * f).toFixed(nice * f % 1 ? 1 : 0)}</text>`;
    });
    samples.forEach(x => {
        const px = pad.l + iw * Math.min(1, Math.max(0, (x.t.doneAt - t0) / (t1 - t0)));
        s += `<circle class="dot" cx="${px.toFixed(1)}" cy="${Y(x.d).toFixed(1)}" r="4.5"/>`;
    });
    if (sle != null) {
        s += `<line class="sle-line" x1="${pad.l}" x2="${W - pad.r}" y1="${Y(sle).toFixed(1)}" y2="${Y(sle).toFixed(1)}"/>`;
        s += `<text class="sle-label" x="${W - pad.r}" y="${(Y(sle) - 5).toFixed(1)}" text-anchor="end">SLE 85% · ${fmtDays(sle)}</text>`;
    }
    s += `<text class="axis" x="${pad.l}" y="${H - 8}">${fmtShort(t0)}</text><text class="axis" x="${W - pad.r}" y="${H - 8}" text-anchor="end">${fmtShort(t1)}</text>`;
    return s + '</svg>';
}

function renderMetrics() {
    const box = $('#view-metrics');
    const list = scopeTasks();
    const t = now();
    const wip = list.filter(x => isActive(x.status));
    const doneAll = list.filter(x => x.status === 'done' && x.doneAt);
    const thr7 = doneAll.filter(x => t - x.doneAt <= 7 * DAY).length;
    const samples = cycleSamples(list);
    const cts = samples.map(x => x.d);
    const median = percentile(cts, 0.5);
    const sle = computeSle(list);

    const kpi = (label, value, sub) => h('div', { class: 'kpi' },
        h('div', { class: 'kpi-label', text: label }), h('div', { class: 'kpi-value', text: value }), h('div', { class: 'kpi-sub', text: sub }));

    const kpis = h('div', { class: 'kpis' },
        kpi('WIP actual', String(wip.length), 'En curso + pruebas'),
        kpi('Throughput 7 días', String(thr7), 'Tareas terminadas'),
        kpi('Ciclo mediano', median == null ? '—' : fmtDays(median), `${cts.length} tarea${cts.length === 1 ? '' : 's'} con ciclo medido`),
        kpi('SLE (85%)', sle == null ? '—' : fmtDays(sle), sle == null ? 'Requiere 5+ tareas terminadas' : 'El 85% termina en este tiempo o menos'));

    // Throughput semanal
    const weeks = [];
    const labels = [];
    for (let i = 7; i >= 0; i--) {
        const hi = t - i * 7 * DAY, lo = hi - 7 * DAY;
        weeks.push(doneAll.filter(x => x.doneAt > lo && x.doneAt <= hi).length);
        labels.push(i === 0 ? 'ahora' : '−' + i + 's');
    }
    const thrPanel = h('div', { class: 'panel' }, h('h2', { text: 'Throughput semanal' }),
        h('p', { class: 'sub', text: 'Tareas terminadas por semana, últimas 8 semanas.' }));
    const thrWrap = h('div');
    thrWrap.innerHTML = svgBars(weeks, labels);
    thrPanel.append(thrWrap);

    // Ciclo
    const cycPanel = h('div', { class: 'panel' }, h('h2', { text: 'Tiempo de ciclo' }),
        h('p', { class: 'sub', text: 'Días desde que la tarea empieza hasta que termina (últimos 30 días).' }));
    const recent = samples.filter(x => t - x.t.doneAt <= 30 * DAY);
    if (recent.length) {
        const w = h('div'); w.innerHTML = svgScatter(recent, sle); cycPanel.append(w);
    } else {
        cycPanel.append(h('p', { class: 'empty', text: 'Todavía no hay tareas terminadas con ciclo medido.' }));
    }

    // CFD
    const cfdPanel = h('div', { class: 'panel' }, h('h2', { text: 'Flujo acumulado' }),
        h('p', { class: 'sub', text: 'Cuántas tareas hay en cada estado, día a día. Una banda que se ensancha marca un cuello de botella.' }));
    const cw = h('div'); cw.innerHTML = svgCfd(list); cfdPanel.append(cw);
    cfdPanel.append(h('div', { class: 'legend' }, [['done', 'Hecho', 'var(--green)'], ['testing', 'Pruebas', 'var(--purple)'], ['in-progress', 'En curso', 'var(--orange)'], ['ready', 'Listo', 'var(--accent)'], ['backlog', 'Backlog', 'var(--gray)']]
        .map(([, name, col]) => h('span', {}, h('i', { style: `background:${col}` }), name))));

    // Aging
    const agingPanel = h('div', { class: 'panel' }, h('h2', { text: 'Edad de las tareas en curso' }),
        h('p', { class: 'sub', text: sle == null ? 'Tiempo que lleva cada tarea activa. Con 5+ tareas terminadas se marca el SLE.' : 'La marca vertical es el SLE: pasarla significa que la tarea tarda más de lo habitual.' }));
    const aged = wip.filter(x => x.startedAt).map(x => ({ x, age: (t - x.startedAt) / DAY })).sort((a, b) => b.age - a.age);
    if (aged.length) {
        const top = Math.max(...aged.map(a => a.age), sle || 0) * 1.15 || 1;
        agingPanel.append(h('div', { class: 'aging-list' }, aged.map(({ x, age }) => {
            const warn = sle != null && age > sle;
            const track = h('div', { class: 'aging-track' },
                h('div', { class: 'aging-fill' + (warn ? ' warn' : ''), style: `width:${Math.max(2, age / top * 100).toFixed(1)}%` }));
            if (sle != null) track.append(h('div', { class: 'aging-mark', style: `left:${(sle / top * 100).toFixed(1)}%`, title: 'SLE' }));
            return h('div', { class: 'aging-row' },
                h('div', { class: 'aging-name' }, x.title, h('small', { text: STATUSES.find(s => s.id === x.status).name })),
                h('div', { class: 'aging-age' + (warn ? ' warn' : ''), text: fmtDays(age) }),
                track);
        })));
    } else {
        agingPanel.append(h('p', { class: 'empty', text: 'No hay tareas en curso ni en pruebas.' }));
    }

    box.replaceChildren(h('div', { class: 'metrics' }, kpis, h('div', { class: 'panels' }, thrPanel, cycPanel), cfdPanel, agingPanel));
}

/* ---------- Documentos (vista) ---------- */
function renderDocs() {
    const box = $('#view-docs');
    const list = visibleTasks().filter(t => safeUrl(t.docsLink));
    if (!list.length) {
        box.replaceChildren(h('p', { class: 'empty', text: 'Ninguna tarea tiene un documento vinculado. Agregá un enlace al editar una tarea.' }));
        return;
    }
    box.replaceChildren(h('div', { class: 'docs-list' }, list.map(t => h('div', { class: 'doc-row' },
        h('div', { class: 'doc-icon', html: ICON_DOC }),
        h('div', { class: 'doc-main' },
            h('div', { class: 'doc-title', text: t.title }),
            h('div', { class: 'doc-meta', text: `${projName(t.projectId)} · ${STATUSES.find(s => s.id === t.status).name}` })),
        h('div', { class: 'doc-actions' },
            h('button', { type: 'button', class: 'btn secondary small', text: 'Editar', onclick: () => openTask(t.id) }),
            h('a', { class: 'btn primary small', href: safeUrl(t.docsLink), target: '_blank', rel: 'noopener noreferrer', text: 'Abrir' }))))));
}

/* ---------- Vistas ---------- */
function setView(v) {
    currentView = v;
    $$('.nav-item').forEach(b => {
        const on = b.dataset.view === v;
        b.classList.toggle('active', on);
        if (on) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
    });
    ['board', 'metrics', 'docs', 'settings'].forEach(name => { $('#view-' + name).hidden = name !== v; });
    $('#viewTitle').textContent = VIEW_TITLES[v];
    $('#toolbar').hidden = v === 'settings';
    $('#addTaskBtn').hidden = v === 'settings';
    if (v === 'settings') $('#sprintInfo').hidden = true;
    refresh();
}

function refresh() {
    renderSelectors();
    if (currentView !== 'settings') renderSprintInfo();
    if (currentView === 'board') renderBoard();
    else if (currentView === 'metrics') renderMetrics();
    else if (currentView === 'docs') renderDocs();
    else renderSettings();
}

/* ---------- Ajustes ---------- */
function applyTheme() {
    const r = document.documentElement;
    if (settings.theme === 'auto') r.removeAttribute('data-theme');
    else r.setAttribute('data-theme', settings.theme);
    $$('#themeSeg button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.theme === settings.theme)));
}

function renderSettings() {
    $('#wipReady').value = settings.wip.ready;
    $('#wipProgress').value = settings.wip['in-progress'];
    $('#wipTesting').value = settings.wip.testing;
    $('#enforceWip').checked = !!settings.enforceWip;
    applyTheme();
}

function bindWip(id, key) {
    $(id).addEventListener('change', e => {
        const n = Math.min(99, Math.max(0, parseInt(e.target.value, 10) || 0));
        settings.wip[key] = n;
        e.target.value = n;
        saveAll();
    });
}

function exportData() {
    const payload = { version: 2, exportedAt: new Date().toISOString(), projects, sprints, tasks, settings };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = h('a', { href: url, download: `scrumban-${new Date().toISOString().slice(0, 10)}.json` });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast('Copia exportada');
}

function importFile(file) {
    const reader = new FileReader();
    reader.onload = async ev => {
        let data;
        try { data = JSON.parse(ev.target.result); } catch (err) { toast('El archivo no es un JSON válido.', { type: 'error' }); return; }
        if (!data || typeof data !== 'object' || !Array.isArray(data.tasks)) {
            toast('No parece un archivo de Scrumban (falta la lista de tareas).', { type: 'error' });
            return;
        }
        const ok = await confirmDialog('¿Importar datos?',
            `Se reemplazarán tus datos actuales por ${data.tasks.length} tarea${data.tasks.length === 1 ? '' : 's'} del archivo.`, 'Importar');
        if (!ok) return;
        if (Array.isArray(data.projects)) projects = data.projects;
        if (Array.isArray(data.sprints)) sprints = data.sprints;
        tasks = data.tasks;
        if (data.settings && data.settings.wip && typeof data.settings.wip === 'object') {
            ['ready', 'in-progress', 'testing'].forEach(k => {
                const n = parseInt(data.settings.wip[k], 10);
                if (Number.isFinite(n) && n >= 0 && n <= 99) settings.wip[k] = n;
            });
        }
        normalize();
        currentProjectId = 'all';
        currentSprintId = 'all';
        saveAll();
        refresh();
        toast('Datos importados');
    };
    reader.readAsText(file);
}

/* ---------- Sync Monday (simulado, como en la versión original) ---------- */
function simulateMondaySync() {
    const btn = $('#syncMondayBtn');
    if (btn.classList.contains('syncing')) return;
    const icon = $('.sync-icon', btn), label = $('.sync-label', btn);
    btn.classList.add('syncing');
    label.textContent = 'Sincronizando…';
    setTimeout(() => {
        tasks.forEach(t => { t.synced = true; });
        saveAll();
        refresh();
        btn.classList.remove('syncing');
        icon.innerHTML = ICON_CHECK;
        label.textContent = 'Sincronizado';
        setTimeout(() => { icon.innerHTML = ICON_SYNC_BTN; label.textContent = 'Sync Monday'; }, 3000);
    }, 1800);
}

/* ---------- Eventos ---------- */
function bindEvents() {
    $$('.nav-item').forEach(b => b.addEventListener('click', () => setView(b.dataset.view)));

    $('#addTaskBtn').addEventListener('click', () => openTask());
    $('#addProjectBtn').addEventListener('click', () => { $('#projectForm').reset(); openModal('projectModal'); setTimeout(() => $('#projectName').focus(), 50); });
    $('#deleteProjectBtn').addEventListener('click', deleteCurrentProject);
    $('#addSprintBtn').addEventListener('click', () => openSprintModal());
    $('#editSprintBtn').addEventListener('click', () => openSprintModal(currentSprintId));
    $('#deleteSprintBtn').addEventListener('click', deleteCurrentSprint);

    $('#projectSelector').addEventListener('change', e => { currentProjectId = e.target.value; refresh(); });
    $('#sprintSelector').addEventListener('change', e => { currentSprintId = e.target.value; refresh(); });
    $('#search').addEventListener('input', e => { searchQuery = e.target.value; refresh(); });

    $('#taskForm').addEventListener('submit', submitTask);
    $('#projectForm').addEventListener('submit', submitProject);
    $('#sprintForm').addEventListener('submit', submitSprint);
    $('#deleteTaskBtn').addEventListener('click', () => {
        const id = editingTaskId;
        closeModal('taskModal');
        if (id) deleteTask(id);
    });

    $$('[data-close]').forEach(b => b.addEventListener('click', () => closeModal(b.dataset.close)));
    $$('.overlay').forEach(o => o.addEventListener('mousedown', e => { if (e.target === o) closeModal(o.id); }));
    $('#confirmOk').addEventListener('click', () => settleConfirm(true));
    $('#confirmCancel').addEventListener('click', () => settleConfirm(false));

    $$('#themeSeg button').forEach(b => b.addEventListener('click', () => { settings.theme = b.dataset.theme; saveAll(); applyTheme(); }));
    bindWip('#wipReady', 'ready');
    bindWip('#wipProgress', 'in-progress');
    bindWip('#wipTesting', 'testing');
    $('#enforceWip').addEventListener('change', e => { settings.enforceWip = e.target.checked; saveAll(); });
    $('#exportBtn').addEventListener('click', exportData);
    $('#importDataBtn').addEventListener('click', () => $('#fileInput').click());
    $('#fileInput').addEventListener('change', e => {
        const f = e.target.files[0];
        if (f) importFile(f);
        e.target.value = '';
    });
    $('#syncMondayBtn').addEventListener('click', simulateMondaySync);

    document.addEventListener('keydown', e => {
        if (e.key === 'Escape') {
            const m = topModal();
            if (m) { e.preventDefault(); closeModal(m.id); }
            return;
        }
        if (e.metaKey || e.ctrlKey || e.altKey) return;
        const tag = (e.target.tagName || '').toLowerCase();
        if (tag === 'input' || tag === 'textarea' || tag === 'select' || e.target.isContentEditable) return;
        if (topModal()) return;
        if (e.key === 'n' || e.key === 'N') { e.preventDefault(); openTask(); }
        else if (e.key === '/') { e.preventDefault(); if (currentView !== 'settings') $('#search').focus(); }
        else if (e.key >= '1' && e.key <= '4') setView(['board', 'metrics', 'docs', 'settings'][Number(e.key) - 1]);
    });

    // Refresca edades y vencimientos con la pestaña abierta
    setInterval(() => { if (currentView === 'board' && !dragging && !topModal()) renderBoard(); }, 5 * 60 * 1000);
}

function init() {
    buildBoard();
    bindEvents();
    applyTheme();
    saveAll();
    setView('board');
}

document.addEventListener('DOMContentLoaded', init);
