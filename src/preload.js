'use strict';
const { contextBridge, ipcRenderer } = require('electron');

const call = async (channel, ...args) => {
  const r = await ipcRenderer.invoke(channel, ...args);
  if (!r.ok) throw new Error(r.error);
  return r.data;
};

contextBridge.exposeInMainWorld('api', {
  info: () => call('app:info'),
  windowControl: (a) => call('window:control', a),
  getSettings: () => call('settings:get'),
  setSettings: (patch) => call('settings:set', patch),
  resetSettingsPart: (key) => call('settings:resetPart', key),
  setApiKey: (k) => call('apikey:set', k),
  testAi: (id) => call('ai:test', id),
  setAiMode: (mode) => call('ai:mode', mode),
  accountStatus: (id) => call('account:status', id),
  accountInstall: (id) => call('account:install', id),
  accountLogin: (id, mode) => call('account:login', id, mode),
  accountCode: (id, code) => call('account:code', id, code),
  accountCancel: (id) => call('account:cancel', id),
  accountLogout: (id) => call('account:logout', id),
  accountPlan: (id, value) => call('account:plan', id, value),
  accountBrowse: (id) => call('account:browse', id),
  localStatus: () => call('local:status'),
  localStart: () => call('local:start'),
  localInstall: () => call('local:install'),
  localPull: (model) => call('local:pull', model),
  localCancelPull: () => call('local:cancelPull'),
  localBrowse: () => call('local:browse'),
  getWorkshops: () => call('workshops:get'),
  setWorkshops: (list) => call('workshops:set', list),
  resetWorkshops: () => call('workshops:reset'),
  exportWorkshops: (ids) => call('workshops:export', ids),
  importWorkshops: () => call('workshops:import'),
  listParticipants: () => call('participants:list'),
  saveParticipant: (p) => call('participants:save', p),
  removeParticipant: (id) => call('participants:remove', id),
  importParticipantsFile: (workshopId) => call('participants:importFile', workshopId),
  importParticipantsText: (text, workshopId) => call('participants:importText', text, workshopId),
  getMarks: (q) => call('marks:get', q),
  setMarks: (entries) => call('marks:set', entries),
  listPlans: () => call('plans:list'),
  getPlan: (id) => call('plans:get', id),
  createPlan: (opts) => call('plans:create', opts),
  savePlan: (plan, refresh) => call('plans:save', plan, !!refresh),
  regeneratePlan: (id, date) => call('plans:regenerate', id, date || null),
  duplicatePlan: (id) => call('plans:duplicate', id),
  removePlan: (id) => call('plans:remove', id),
  validatePlan: (id) => call('plans:validate', id),
  previewPlan: (id) => call('plans:preview', id),
  exportPlan: (id, format) => call('plans:export', id, format),
  listAssessments: () => call('assessments:list'),
  getAssessment: (id) => call('assessments:get', id),
  createAssessment: (opts) => call('assessments:create', opts),
  saveAssessment: (a, refresh) => call('assessments:save', a, !!refresh),
  assessmentStats: (id) => call('assessments:stats', id),
  duplicateAssessment: (id) => call('assessments:duplicate', id),
  removeAssessment: (id) => call('assessments:remove', id),
  previewAssessment: (id) => call('assessments:preview', id),
  exportAssessment: (id, format) => call('assessments:export', id, format),
  aiPolishAssessment: (id) => call('ai:polishAssessment', id),
  aiConclusions: (id) => call('ai:conclusions', id),
  aiPlan: (id) => call('ai:plan', id),
  aiProfile: (opts) => call('ai:profile', opts),
  clipboardImage: () => call('clipboard:image'),
  docParse: (type, text, participantId) => call('docs:parse', type, text, participantId || null),
  docAnonymize: (text, person, participantId) => call('docs:anonymize', text, person, participantId || null),
  docGuard: (text, person, participantId) => call('docs:guard', text, person, participantId || null),
  docSave: (opts) => call('docs:save', opts),
  docAnalyze: (participantId, docId, anonText) => call('docs:analyze', participantId, docId, anonText),
  docApply: (participantId, opts) => call('docs:apply', participantId, opts),
  docRemove: (participantId, docId) => call('docs:remove', participantId, docId),
  docOpenScan: (participantId, file) => call('docs:openScan', participantId, file),
  showFile: (p) => call('shell:showFile', p),
  openFile: (p) => call('shell:openFile', p),
  openExternal: (u) => call('shell:openExternal', u),
  on: (channel, fn) => {
    const allowed = ['window:state', 'account:log', 'account:login', 'local:log', 'local:pull'];
    if (!allowed.includes(channel)) return () => {};
    const h = (_e, payload) => fn(payload);
    ipcRenderer.on(channel, h);
    return () => ipcRenderer.removeListener(channel, h);
  }
});
