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

  socket.on('start-rtmp', (data) => {
    const { rtmpUrl } = data;
    if (isStreaming) return;

    console.log(`[RTMP] Starting push to: ${rtmpUrl.split('?')[0]}`);

    // Production FFmpeg config for Facebook Live
    const ffmpegArgs = [
      '-loglevel', 'info',
      '-analyzeduration', '10M',
      '-probesize', '10M',
      '-i', '-', // Read from stdin
      '-c:v', 'libx264', '-preset', 'veryfast', '-tune', 'zerolatency',
      '-pix_fmt', 'yuv420p',
      '-b:v', '2500k', '-maxrate', '2500k', '-bufsize', '5000k',
      '-r', '30', '-g', '60', '-keyint_min', '60', '-sc_threshold', '0',
      '-c:a', 'aac', '-b:a', '128k', '-ar', '44100',
      '-f', 'flv', rtmpUrl
    ];

    ffmpeg = spawn(FFMPEG_PATH, ffmpegArgs);
    isStreaming = true;

    ffmpeg.stderr.on('data', (data) => {
      const msg = data.toString();
      if (msg.includes('frame=')) {
        const match = msg.match(/frame=\s*(\d+)/);
        if (match) socket.emit('rtmp-progress', { frame: match[1] });
      } else {
        // Log actual FFmpeg errors so we can debug why it died!
        console.log(`[FFmpeg] ${msg.trim()}`);
      }
    });

    ffmpeg.on('exit', (code, signal) => {
      console.log(`[FFmpeg-Exit] Code: ${code}, Signal: ${signal}`);
      isStreaming = false;
      ffmpeg = null;
      socket.emit('rtmp-error', `FFmpeg process terminated (Code: ${code})`);
    });

    ffmpeg.stdin.on('error', (e) => {
      console.error('[FFmpeg-Stdin-Error]', e);
    });
  });

  socket.on('video-chunk', (chunk) => {
    if (ffmpeg && ffmpeg.stdin.writable) {
      ffmpeg.stdin.write(chunk);
      chunkCount++;
    }
  });

  socket.on('stop-rtmp', () => {
    console.log('[RTMP] Stopping push...');
    if (ffmpeg) {
      ffmpeg.kill('SIGTERM');
      ffmpeg = null;
    }
    isStreaming = false;
  });

  socket.on('disconnect', () => {
    console.log('[RTMP] Client disconnected, cleaning up...');
    if (ffmpeg) {
      ffmpeg.kill('SIGTERM');
      ffmpeg = null;
    }
    isStreaming = false;
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
