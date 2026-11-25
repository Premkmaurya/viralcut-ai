require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const { STORAGE_DIR } = require('./db');
const jobsRouter = require('./routes/jobs');
const { getMediaTools } = require('./ffmpegResolver');
const { checkDependencies } = require('./preflight');

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors({
  origin: true,
  credentials: true
}));

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Health Check & Tool Diagnostic Endpoint
app.get('/api/health', (req, res) => {
  const dependencies = checkDependencies();

  res.json({
    status: 'ok',
    app: 'ViralCut AI',
    version: '1.0.0',
    mode: 'local-only',
    security_warning: 'Notice: This local MVP server does not include authentication and MUST NOT be exposed publicly.',
    dependencies,
    media_tools: {
      ffmpeg: dependencies.ffmpeg.path,
      ffprobe: dependencies.ffprobe.path,
      error: dependencies.ffmpeg.error || dependencies.ffprobe.error
    },
    storage_dir: STORAGE_DIR,
    timestamp: new Date().toISOString()
  });
});

// Mount Job Routes
app.use('/api', jobsRouter);

// Serve static frontend in production if built
const clientDist = path.join(__dirname, '..', 'client', 'dist');
if (fs.existsSync(clientDist)) {
  app.use(express.static(clientDist));
  app.use((req, res, next) => {
    if (!req.path.startsWith('/api') && req.method === 'GET') {
      res.sendFile(path.join(clientDist, 'index.html'));
    } else {
      next();
    }
  });
}

// Global Error Handler
app.use((err, req, res, next) => {
  console.error('[Global Error]', err);
  if (res.headersSent) {
    return next(err);
  }
  res.status(err.status || 500).json({
    error: err.message || 'Internal server error occurred.'
  });
});

const server = app.listen(PORT, '127.0.0.1', () => {
  console.log(`=======================================================`);
  console.log(` ViralCut AI Server running at http://127.0.0.1:${PORT}`);
  console.log(` Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(` Storage Path: ${STORAGE_DIR}`);
  console.log(` Local only: Do NOT expose this server publicly.`);
  console.log(`=======================================================`);

  // Run preflight dependency check on startup
  try {
    const deps = checkDependencies();
    console.log(`[Preflight] FFmpeg: ${deps.ffmpeg.available ? deps.ffmpeg.path : 'NOT FOUND (' + deps.ffmpeg.error + ')'}`);
    console.log(`[Preflight] FFprobe: ${deps.ffprobe.available ? deps.ffprobe.path : 'NOT FOUND (' + deps.ffprobe.error + ')'}`);
    console.log(`[Preflight] Python: ${deps.python.available ? deps.python.path + ' (' + deps.python.version + ')' : 'NOT FOUND (' + deps.python.error + ')'}`);
    if (deps.faster_whisper.available) {
      console.log(`[Preflight] faster-whisper: Available (${deps.faster_whisper.version})`);
    } else {
      console.warn(`[Preflight Warning] faster-whisper not available: ${deps.faster_whisper.error}`);
      console.warn(`[Preflight Guidance] ${deps.faster_whisper.guidance}`);
    }
  } catch (err) {
    console.warn(`[Warning] Preflight dependency check: ${err.message}`);
  }
});

module.exports = { app, server };
