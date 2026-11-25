const path = require('path');
const fs = require('fs');
const { DatabaseSync } = require('node:sqlite');

const STORAGE_DIR = process.env.STORAGE_DIR
  ? path.resolve(process.cwd(), process.env.STORAGE_DIR)
  : path.resolve(process.cwd(), 'storage');

if (!fs.existsSync(STORAGE_DIR)) {
  fs.mkdirSync(STORAGE_DIR, { recursive: true });
}

const dbPath = path.join(STORAGE_DIR, 'viralcut.db');
const db = new DatabaseSync(dbPath);

// Enable WAL mode for high concurrency
db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA foreign_keys = ON;');

// Create tables
db.exec(`
CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY,
  url TEXT,
  source_type TEXT NOT NULL,
  source_name TEXT,
  source_path TEXT,
  duration REAL DEFAULT 0,
  width INTEGER DEFAULT 0,
  height INTEGER DEFAULT 0,
  fps REAL DEFAULT 0,
  has_audio INTEGER DEFAULT 1,
  status TEXT DEFAULT 'pending',
  stage TEXT DEFAULT 'queued',
  progress INTEGER DEFAULT 0,
  stage_message TEXT DEFAULT '',
  error TEXT,
  min_duration REAL DEFAULT 60,
  max_duration REAL DEFAULT 180,
  is_demo INTEGER DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS transcripts (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL,
  raw_json TEXT NOT NULL,
  full_text TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS clips (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL,
  title TEXT NOT NULL,
  hook TEXT,
  reason TEXT,
  score REAL DEFAULT 0,
  topic TEXT,
  standalone INTEGER DEFAULT 1,
  start_time REAL NOT NULL,
  end_time REAL NOT NULL,
  duration REAL NOT NULL,
  approved INTEGER DEFAULT 0,
  render_status TEXT DEFAULT 'pending',
  render_progress INTEGER DEFAULT 0,
  output_path TEXT,
  output_size INTEGER DEFAULT 0,
  caption_style TEXT,
  error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);
CREATE INDEX IF NOT EXISTS idx_clips_job_id ON clips(job_id);
`);

// Safe migrations for existing databases
try { db.exec('ALTER TABLE jobs ADD COLUMN min_duration REAL DEFAULT 60;'); } catch (e) {}
try { db.exec('ALTER TABLE jobs ADD COLUMN max_duration REAL DEFAULT 180;'); } catch (e) {}
try { db.exec('ALTER TABLE jobs ADD COLUMN is_demo INTEGER DEFAULT 0;'); } catch (e) {}

// Job Repository Helper
const JobRepo = {
  create(job) {
    const now = new Date().toISOString();
    const stmt = db.prepare(`
      INSERT INTO jobs (
        id, url, source_type, source_name, source_path,
        duration, width, height, fps, has_audio,
        status, stage, progress, stage_message, error,
        min_duration, max_duration, is_demo,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      job.id,
      job.url || null,
      job.source_type,
      job.source_name || null,
      job.source_path || null,
      job.duration || 0,
      job.width || 0,
      job.height || 0,
      job.fps || 0,
      job.has_audio !== undefined ? (job.has_audio ? 1 : 0) : 1,
      job.status || 'pending',
      job.stage || 'queued',
      job.progress || 0,
      job.stage_message || 'Job queued',
      job.error || null,
      job.min_duration || 60,
      job.max_duration || 180,
      job.is_demo ? 1 : 0,
      now,
      now
    );
    return this.findById(job.id);
  },

  findById(id) {
    const stmt = db.prepare('SELECT * FROM jobs WHERE id = ?');
    return stmt.get(id);
  },

  findAll(limit = 50) {
    const stmt = db.prepare('SELECT * FROM jobs ORDER BY created_at DESC LIMIT ?');
    return stmt.all(limit);
  },

  update(id, fields) {
    const sets = [];
    const values = [];
    for (const [key, val] of Object.entries(fields)) {
      sets.push(`${key} = ?`);
      values.push(val);
    }
    sets.push('updated_at = ?');
    values.push(new Date().toISOString());
    values.push(id);

    const query = `UPDATE jobs SET ${sets.join(', ')} WHERE id = ?`;
    const stmt = db.prepare(query);
    stmt.run(...values);
    return this.findById(id);
  },

  delete(id) {
    const stmt = db.prepare('DELETE FROM jobs WHERE id = ?');
    stmt.run(id);
    return true;
  },

  findStuckJobs() {
    const stmt = db.prepare("SELECT * FROM jobs WHERE status IN ('processing', 'rendering')");
    return stmt.all();
  },

  findStuckProcessing() {
    return this.findStuckJobs();
  }
};

// Transcript Repository Helper
const TranscriptRepo = {
  save(jobId, rawJson, fullText) {
    const id = `tr_${jobId}`;
    const now = new Date().toISOString();
    // Delete old if exists
    db.prepare('DELETE FROM transcripts WHERE job_id = ?').run(jobId);
    const stmt = db.prepare(`
      INSERT INTO transcripts (id, job_id, raw_json, full_text, created_at)
      VALUES (?, ?, ?, ?, ?)
    `);
    stmt.run(id, jobId, typeof rawJson === 'string' ? rawJson : JSON.stringify(rawJson), fullText, now);
    return this.findByJobId(jobId);
  },

  findByJobId(jobId) {
    const stmt = db.prepare('SELECT * FROM transcripts WHERE job_id = ?');
    const row = stmt.get(jobId);
    if (!row) return null;
    return {
      ...row,
      parsed: JSON.parse(row.raw_json)
    };
  }
};

// Clip Repository Helper
const ClipRepo = {
  createMany(clips) {
    const now = new Date().toISOString();
    const stmt = db.prepare(`
      INSERT INTO clips (
        id, job_id, title, hook, reason, score, topic, standalone,
        start_time, end_time, duration, approved, render_status,
        render_progress, output_path, output_size, caption_style, error,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    for (const clip of clips) {
      stmt.run(
        clip.id,
        clip.job_id,
        clip.title,
        clip.hook || null,
        clip.reason || null,
        clip.score || 0,
        clip.topic || 'General',
        clip.standalone !== undefined ? (clip.standalone ? 1 : 0) : 1,
        clip.start_time,
        clip.end_time,
        clip.duration || (clip.end_time - clip.start_time),
        clip.approved ? 1 : 0,
        clip.render_status || 'pending',
        clip.render_progress || 0,
        clip.output_path || null,
        clip.output_size || 0,
        clip.caption_style ? (typeof clip.caption_style === 'string' ? clip.caption_style : JSON.stringify(clip.caption_style)) : null,
        clip.error || null,
        now,
        now
      );
    }
  },

  findById(id) {
    const stmt = db.prepare('SELECT * FROM clips WHERE id = ?');
    return stmt.get(id);
  },

  findByJobId(jobId) {
    const stmt = db.prepare('SELECT * FROM clips WHERE job_id = ? ORDER BY score DESC');
    return stmt.all(jobId);
  },

  update(id, fields) {
    const sets = [];
    const values = [];
    for (const [key, val] of Object.entries(fields)) {
      sets.push(`${key} = ?`);
      values.push(val);
    }
    sets.push('updated_at = ?');
    values.push(new Date().toISOString());
    values.push(id);

    const query = `UPDATE clips SET ${sets.join(', ')} WHERE id = ?`;
    const stmt = db.prepare(query);
    stmt.run(...values);
    return this.findById(id);
  },

  delete(id) {
    const stmt = db.prepare('DELETE FROM clips WHERE id = ?');
    stmt.run(id);
  },

  findStuckRendering(jobId) {
    const stmt = db.prepare("SELECT * FROM clips WHERE job_id = ? AND render_status = 'rendering'");
    return stmt.all(jobId);
  },

  resetStuckRendering(jobId) {
    const stmt = db.prepare("UPDATE clips SET render_status = 'pending', render_progress = 0 WHERE job_id = ? AND render_status = 'rendering'");
    return stmt.run(jobId);
  }
};

module.exports = {
  db,
  JobRepo,
  TranscriptRepo,
  ClipRepo,
  STORAGE_DIR
};
