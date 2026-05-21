const state = {
  token: localStorage.getItem('police_token'),
  user: null,
  stations: [],
  users: [],
  firs: [],
  dialog: null
};

const $ = (id) => document.getElementById(id);

async function api(path, options = {}) {
  const res = await fetch(path, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(state.token ? { Authorization: `Bearer ${state.token}` } : {}),
      ...(options.headers || {})
    }
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) {
    logout(false);
    throw new Error(data.message || 'Please sign in again.');
  }
  if (!res.ok) throw new Error(data.message || 'Request failed.');
  return data;
}

function show(view) {
  ['setup-view', 'login-view', 'app-view'].forEach((id) => $(id).classList.add('hidden'));
  $(view).classList.remove('hidden');
}

function setMessage(id, text, error = false) {
  const el = $(id);
  el.textContent = text || '';
  el.classList.toggle('error', error);
}

async function start() {
  bindEvents();
  try {
    const setup = await api('/api/setup/status');
    if (setup.needsSetup) return show('setup-view');
    if (state.token) {
      const me = await api('/api/auth/me');
      state.user = me.user;
      await enterApp();
      return;
    }
    show('login-view');
  } catch (err) {
    show('login-view');
    setMessage('login-message', err.message, true);
  }
}

function bindEvents() {
  $('setup-form').addEventListener('submit', setupAdmin);
  $('login-form').addEventListener('submit', login);
  $('logout-button').addEventListener('click', () => logout(true));
  $('new-station-button').addEventListener('click', () => openStationDialog());
  $('new-user-button').addEventListener('click', () => openUserDialog());
  $('new-fir-button').addEventListener('click', () => openFirDialog());
  $('close-dialog').addEventListener('click', closeDialog);
  $('cancel-dialog').addEventListener('click', closeDialog);
  $('record-form').addEventListener('submit', saveDialog);

  document.querySelectorAll('.nav-button').forEach((button) => {
    button.addEventListener('click', () => switchTab(button.dataset.tab));
  });
}

async function setupAdmin(event) {
  event.preventDefault();
  try {
    await api('/api/setup/admin', {
      method: 'POST',
      body: JSON.stringify({
        name: $('setup-name').value,
        username: $('setup-username').value,
        password: $('setup-password').value
      })
    });
    setMessage('setup-message', 'Admin created. Please sign in.');
    show('login-view');
  } catch (err) {
    setMessage('setup-message', err.message, true);
  }
}

async function login(event) {
  event.preventDefault();
  try {
    const data = await api('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({
        username: $('login-username').value,
        password: $('login-password').value
      })
    });
    state.token = data.token;
    state.user = data.user;
    localStorage.setItem('police_token', data.token);
    await enterApp();
  } catch (err) {
    setMessage('login-message', err.message, true);
  }
}

async function logout(callServer) {
  if (callServer && state.token) {
    api('/api/auth/logout', { method: 'POST' }).catch(() => {});
  }
  state.token = null;
  state.user = null;
  localStorage.removeItem('police_token');
  show('login-view');
}

async function enterApp() {
  show('app-view');
  $('signed-in-user').textContent = `${state.user.name} (${state.user.role})`;
  document.body.classList.toggle('is-admin', state.user.role === 'ADMIN');
  await refreshAll();
  switchTab('dashboard-tab');
}

async function refreshAll() {
  state.stations = await api('/api/stations');
  state.firs = await api('/api/firs');
  if (state.user.role === 'ADMIN') {
    state.users = await api('/api/users');
  } else {
    state.users = [];
  }
  renderAll();
}

function switchTab(tabId) {
  document.querySelectorAll('.tab').forEach((tab) => tab.classList.add('hidden'));
  $(tabId).classList.remove('hidden');
  document.querySelectorAll('.nav-button').forEach((button) => {
    button.classList.toggle('active', button.dataset.tab === tabId);
  });
}

function renderAll() {
  renderDashboard();
  renderStations();
  renderUsers();
  renderFirs();
  fillStationSelects();
}

function renderDashboard() {
  $('stat-firs').textContent = state.firs.length;
  $('stat-open').textContent = state.firs.filter((fir) => fir.status === 'Open').length;
  $('stat-stations').textContent = state.stations.length;
  $('stat-users').textContent = state.users.length;
}

function renderStations() {
  $('stations-body').innerHTML = state.stations.map((station) => `
    <tr>
      <td>${escapeHtml(station.name)}</td>
      <td>${escapeHtml(station.code)}</td>
      <td>${escapeHtml(station.city)}</td>
      <td>${escapeHtml(station.phone || '')}</td>
      <td class="actions">
        <button onclick="openStationDialog(${station.id})">Edit</button>
        <button class="danger" onclick="deleteRecord('stations', ${station.id})">Delete</button>
      </td>
    </tr>
  `).join('');
}

function renderUsers() {
  $('users-body').innerHTML = state.users.map((user) => `
    <tr>
      <td>${escapeHtml(user.name)}</td>
      <td>${escapeHtml(user.username)}</td>
      <td><span class="badge">${escapeHtml(user.role)}</span></td>
      <td>${escapeHtml(user.station_name || 'Head Office')}</td>
      <td class="actions">
        <button onclick="openUserDialog(${user.id})">Edit</button>
        <button class="danger" onclick="deleteRecord('users', ${user.id})">Delete</button>
      </td>
    </tr>
  `).join('');
}

function renderFirs() {
  $('firs-body').innerHTML = state.firs.map((fir) => `
    <tr>
      <td>${escapeHtml(fir.fir_number)}</td>
      <td>${escapeHtml(fir.complainant_name)}<br><small>${escapeHtml(fir.complainant_cnic)}</small></td>
      <td>${escapeHtml(fir.incident_type)}<br><small>${escapeHtml(fir.location)}</small></td>
      <td>${escapeHtml(fir.station_name)}</td>
      <td><span class="badge">${escapeHtml(fir.status)}</span></td>
      <td class="actions">
        <button onclick="openFirDialog(${fir.id})">Edit</button>
        <button class="danger" onclick="deleteRecord('firs', ${fir.id})">Delete</button>
      </td>
    </tr>
  `).join('');
}

function fillStationSelects() {
  document.querySelectorAll('[data-station-select]').forEach((select) => {
    const current = select.value;
    select.innerHTML = '<option value="">No station</option>' + state.stations
      .map((station) => `<option value="${station.id}">${escapeHtml(station.name)} (${escapeHtml(station.code)})</option>`)
      .join('');
    select.value = current;
  });
}

function field(name, label, value = '', type = 'text', full = false) {
  return `
    <label class="${full ? 'field-full' : ''}">
      ${label}
      <input name="${name}" type="${type}" value="${escapeAttr(value || '')}" ${type === 'password' ? '' : 'required'}>
    </label>
  `;
}

function selectField(name, label, value, options, full = false, stationSelect = false) {
  return `
    <label class="${full ? 'field-full' : ''}">
      ${label}
      <select name="${name}" ${stationSelect ? 'data-station-select' : ''}>
        ${options.map((option) => `
          <option value="${escapeAttr(option.value)}" ${String(value || '') === String(option.value) ? 'selected' : ''}>
            ${escapeHtml(option.label)}
          </option>
        `).join('')}
      </select>
    </label>
  `;
}

function textareaField(name, label, value = '') {
  return `
    <label class="field-full">
      ${label}
      <textarea name="${name}" required>${escapeHtml(value || '')}</textarea>
    </label>
  `;
}

function openStationDialog(id) {
  const station = id ? state.stations.find((item) => item.id === id) : {};
  state.dialog = { type: 'stations', id };
  $('dialog-title').textContent = id ? 'Edit Station' : 'New Station';
  $('dialog-fields').innerHTML =
    field('name', 'Station Name', station.name) +
    field('code', 'Station Code', station.code) +
    field('city', 'City', station.city) +
    field('phone', 'Phone', station.phone) +
    field('address', 'Address', station.address, 'text', true);
  openDialog();
}

function openUserDialog(id) {
  const user = id ? state.users.find((item) => item.id === id) : {};
  state.dialog = { type: 'users', id };
  $('dialog-title').textContent = id ? 'Edit User' : 'New User';
  $('dialog-fields').innerHTML =
    field('name', 'Full Name', user.name) +
    field('username', 'Username', user.username) +
    field('password', id ? 'New Password (leave blank to keep old)' : 'Password', '', 'password') +
    selectField('role', 'Role', user.role || 'OFFICER', [
      { value: 'OFFICER', label: 'Officer' },
      { value: 'ADMIN', label: 'Admin' }
    ]) +
    selectField('station_id', 'Station', user.station_id || '', [{ value: '', label: 'No station' }], true, true);
  fillStationSelects();
  openDialog();
}

function openFirDialog(id) {
  const fir = id ? state.firs.find((item) => item.id === id) : {};
  state.dialog = { type: 'firs', id };
  $('dialog-title').textContent = id ? 'Edit FIR' : 'New FIR';
  const stationOptions = state.user.role === 'ADMIN'
    ? [{ value: '', label: 'Select station' }]
    : [{ value: state.user.station_id, label: state.user.station_name || 'My station' }];
  $('dialog-fields').innerHTML =
    field('fir_number', 'FIR Number', fir.fir_number) +
    selectField('station_id', 'Station', fir.station_id || state.user.station_id || '', stationOptions, false, state.user.role === 'ADMIN') +
    field('complainant_name', 'Complainant Name', fir.complainant_name) +
    field('complainant_cnic', 'Complainant CNIC', fir.complainant_cnic) +
    field('complainant_phone', 'Complainant Phone', fir.complainant_phone) +
    field('incident_type', 'Incident Type', fir.incident_type) +
    field('incident_datetime', 'Incident Date/Time', toLocalDateTime(fir.incident_datetime), 'datetime-local') +
    selectField('status', 'Status', fir.status || 'Open', [
      { value: 'Open', label: 'Open' },
      { value: 'Investigating', label: 'Investigating' },
      { value: 'Closed', label: 'Closed' }
    ]) +
    field('location', 'Location', fir.location, 'text', true) +
    textareaField('description', 'Description', fir.description);
  fillStationSelects();
  openDialog();
}

function openDialog() {
  setMessage('dialog-message', '');
  $('record-dialog').showModal();
}

function closeDialog() {
  $('record-dialog').close();
}

async function saveDialog(event) {
  event.preventDefault();
  const formData = new FormData($('record-form'));
  const payload = Object.fromEntries(formData.entries());
  const { type, id } = state.dialog;
  try {
    await api(`/api/${type}${id ? `/${id}` : ''}`, {
      method: id ? 'PUT' : 'POST',
      body: JSON.stringify(payload)
    });
    closeDialog();
    setMessage('global-message', 'Saved successfully.');
    await refreshAll();
  } catch (err) {
    setMessage('dialog-message', err.message, true);
  }
}

async function deleteRecord(type, id) {
  if (!confirm('Delete this record?')) return;
  try {
    await api(`/api/${type}/${id}`, { method: 'DELETE' });
    setMessage('global-message', 'Deleted successfully.');
    await refreshAll();
  } catch (err) {
    setMessage('global-message', err.message, true);
  }
}

function toLocalDateTime(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value).slice(0, 16);
  const pad = (number) => String(number).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  }[char]));
}

function escapeAttr(value) {
  return escapeHtml(value).replace(/`/g, '&#096;');
}

window.openStationDialog = openStationDialog;
window.openUserDialog = openUserDialog;
window.openFirDialog = openFirDialog;
window.deleteRecord = deleteRecord;

start();
