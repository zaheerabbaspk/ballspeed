const express = require('express');
const http = require('http');
console.log('--- BallSpeed RTMP Gateway v3.0 starting... ---');
const socketIo = require('socket.io');
const cors = require('cors');
const { spawn } = require('child_process');

const app = express();
app.set('trust proxy', 1);
app.use(cors());

const httpServer = http.createServer(app);
const io = socketIo(httpServer, {
  cors: { origin: "*", methods: ["GET", "POST"] },
  transports: ['websocket']
});

const PORT = process.env.PORT || 3000;
const FFMPEG_PATH = process.env.FFMPEG_PATH || 'ffmpeg';

// --- WebSocket Handlers ---
io.on('connection', (socket) => {
  console.log('[Socket.io] New streaming client:', socket.id);

  let ffmpeg = null;
  let isStreaming = false;
  let chunkCount = 0;
  let currentSessionId = null;

  // Cleanup helper to fully destroy ffmpeg
  const killFfmpeg = () => {
    if (ffmpeg) {
      console.log(`[RTMP] Killing old FFmpeg (Session: ${currentSessionId})...`);
      try {
        if (ffmpeg.stdin) {
          ffmpeg.stdin.destroy();
        }
        ffmpeg.kill('SIGKILL');
      } catch (e) {
        console.error('[RTMP] ffmpeg kill error', e);
      }
      ffmpeg = null;
    }
    isStreaming = false;
    currentSessionId = null;
  };

  socket.on('start-rtmp', (data) => {
    const { rtmpUrl, sessionId } = data;
    
    // Always clean up existing stream if client sends start abruptly
    killFfmpeg();
    
    currentSessionId = sessionId;
    chunkCount = 0;
    console.log(`[RTMP] Starting push to: ${rtmpUrl?.split('?')[0]} | Session: ${currentSessionId}`);

    // Production FFmpeg config for Facebook Live
    const ffmpegArgs = [
      '-loglevel', 'info',
      '-use_wallclock_as_timestamps', '1', // Forces smooth timestamps regardless of WebSocket jitter
      '-i', '-', // Read from stdin
      '-c:v', 'libx264', '-preset', 'veryfast', '-tune', 'zerolatency',
      '-pix_fmt', 'yuv420p',
      '-b:v', '2000k', '-maxrate', '2000k', '-bufsize', '4000k', // Slightly lowered to 2M for stability
      '-r', '30', '-g', '60', '-keyint_min', '60', '-sc_threshold', '0',
      '-c:a', 'aac', '-b:a', '128k', '-ar', '44100', '-ac', '2', // Forced stereo audio
      '-f', 'flv', rtmpUrl
    ];

    ffmpeg = spawn(FFMPEG_PATH, ffmpegArgs);
    isStreaming = true;

    let traceBuff = [];
    ffmpeg.stderr.on('data', (data) => {
      const msg = data.toString();
      if (msg.includes('frame=')) {
        const match = msg.match(/frame=\s*(\d+)/);
        if (match) socket.emit('rtmp-progress', { frame: match[1] });
      } else {
        const line = msg.trim();
        if (line) {
          console.log(`[FFmpeg] ${line}`);
          traceBuff.push(line);
          if (traceBuff.length > 5) traceBuff.shift(); // keep last 5 lines
        }
      }
    });

    ffmpeg.on('exit', (code, signal) => {
      console.log(`[FFmpeg-Exit] Code: ${code}, Signal: ${signal}`);
      if (ffmpeg) {
        let errorCause = traceBuff.join(' | ');
        if (!errorCause) errorCause = 'No internal logs (Check deploy logs)';
        socket.emit('rtmp-error', `FFmpeg terminated (Code ${code}). Reason: ${errorCause}`);
      }
      isStreaming = false;
      ffmpeg = null;
    });

    ffmpeg.stdin.on('error', (e) => {
      // Ignore EPIPE errors which happen if ffmpeg exits
      if (e.code !== 'EPIPE') {
        console.error('[FFmpeg-Stdin-Error]', e);
      }
    });
  });

  socket.on('video-chunk', (payload) => {
    // Validate the chunk belongs to the CURRENT session.
    // This drops ANY stale chunks arriving late from previous streams!
    if (!payload || payload.sessionId !== currentSessionId) {
      return; 
    }

    if (ffmpeg && ffmpeg.stdin && ffmpeg.stdin.writable && isStreaming) {
      try {
        // Simple backpressure: warning log if buffer is filling up
        if (ffmpeg.stdin.writableLength > 1024 * 1024 * 5) {
           console.warn(`[RTMP] Warning: stdin buffer large (${Math.round(ffmpeg.stdin.writableLength/1024/1024)}MB)`);
        }
        ffmpeg.stdin.write(payload.chunk);
        chunkCount++;
      } catch (err) {
        console.error('[RTMP] Stdin write error', err);
      }
    }
  });

  socket.on('stop-rtmp', () => {
    console.log('[RTMP] Received stop request from client.');
    killFfmpeg();
  });

  socket.on('disconnect', () => {
    console.log('[RTMP] Client disconnected, cleaning up...');
    killFfmpeg();
  });

  // Bitrate monitoring every 5s
  setInterval(() => {
    if (isStreaming) {
      console.log(`[Monitor] Chunks received: ${chunkCount}`);
      chunkCount = 0;
    }
  }, 5000);
});

httpServer.listen(PORT, '0.0.0.0', () => {
  console.log(`RTMP Gateway v3.0 listening on port ${PORT}`);
});
