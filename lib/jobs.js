const crypto = require('crypto');

const jobs = new Map();
const queue = [];
const busy = new Map();
let running = false;

function setBusy(uid, fid, on) {
  const key = uid + ':' + fid;
  const n = (busy.get(key) || 0) + (on ? 1 : -1);
  if (n > 0) busy.set(key, n);
  else busy.delete(key);
}

function isBusy(uid, fid) {
  return busy.has(uid + ':' + fid);
}

function prune() {
  const all = [...jobs.values()].sort((a, b) => b.createdAt - a.createdAt);
  all.slice(60).forEach((j) => jobs.delete(j.id));
}

async function pump() {
  if (running) return;
  running = true;
  while (queue.length) {
    const { job, run } = queue.shift();
    job.status = 'running';
    job.startedAt = Date.now();
    const log = (msg) => {
      job.logs.push(String(msg));
      if (job.logs.length > 300) job.logs.shift();
    };
    try {
      await run(log);
      job.status = 'done';
    } catch (err) {
      job.status = 'failed';
      job.error = err.message;
      log('ERROR: ' + err.message);
    }
    job.finishedAt = Date.now();
  }
  running = false;
}

function enqueue({ type, pid, uid, fid, run }) {
  const job = {
    id: 'j' + crypto.randomBytes(4).toString('hex'),
    type,
    pid,
    uid,
    fid: fid || '',
    status: 'queued',
    logs: [],
    error: '',
    createdAt: Date.now(),
    startedAt: 0,
    finishedAt: 0,
  };
  jobs.set(job.id, job);
  prune();
  queue.push({ job, run });
  pump();
  return job;
}

function isActive(job) {
  return job.status === 'queued' || job.status === 'running';
}

function findActive(uid, type) {
  return [...jobs.values()].find((j) => j.uid === uid && j.type === type && isActive(j)) || null;
}

function hasActive(uid) {
  return [...jobs.values()].some((j) => j.uid === uid && isActive(j));
}

function listForUser(uid) {
  return [...jobs.values()]
    .filter((j) => j.uid === uid)
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, 10)
    .map((j) => ({ ...j, logs: j.logs.slice(-40) }));
}

module.exports = { enqueue, setBusy, isBusy, findActive, hasActive, listForUser };
