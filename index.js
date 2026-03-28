const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const { spawn } = require('child_process');
const { WebSocketServer } = require('ws');
const { URL } = require('url');

const app = express();
app.set('trust proxy', 1); // Trust Railway's proxy for secure cookies/headers
app.use(cors());

const httpServer = http.createServer(app);

// ========================================
// 1. WebSocket RTMP Pipeline Upgrade Handler (MOVED BEFORE SOCKET.IO)
// ========================================
const PORT = process.env.PORT || 3000;
const wss = new WebSocketServer({ noServer: true });
// Production: Render uses linux 'ffmpeg'. Local: User's temporary path.
const FFMPEG_PATH = process.env.FFMPEG_PATH || 'ffmpeg'; 

httpServer.on('upgrade', (request, socket, head) => {
  try {
    const { pathname } = new URL(request.url, `http://${request.headers.host}`);
    if (pathname === '/rtmp') {
      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit('connection', ws, request);
      });
      return; 
    }
  } catch (err) {
    console.error('[Upgrade] Error:', err.message);
  }
});

const io = socketIo(httpServer, {
  cors: { 
    origin: "*", // Simplest for production handshakes
    methods: ["GET", "POST"]
  },
  transports: ['websocket'],
  allowEIO3: true,
  pingTimeout: 60000,
  pingInterval: 25000
});



io.on('connection', (socket) => {
  console.log('[Socket.io] New connection:', socket.id);


  socket.on('join-room', (roomId) => {
    socket.join(roomId);
    console.log(`Socket ${socket.id} joined room ${roomId}`);
  });

  socket.on('signal', (data) => {
    // data: { roomId, toPeerId, type, data }
    if (data.toPeerId) {
      socket.to(data.toPeerId).emit('signal', { fromPeerId: socket.id, ...data });
    } else {
      socket.to(data.roomId).emit('signal', { fromPeerId: socket.id, ...data });
    }
  });

  socket.on('disconnect', () => {
    console.log('Socket disconnected:', socket.id);
  });
});


// ========================================
// WebSocket RTMP Pipeline (MediaRecorder -> FFmpeg)
// ========================================
// wss and FFMPEG_PATH are defined above, before io initialization

wss.on('connection', (ws, request) => {
  const params = new URL(request.url, 'http://localhost').searchParams;
  const rtmpUrl = params.get('url');
  
  if (!rtmpUrl) {
    ws.send('ERROR: No RTMP URL provided');
    ws.close();
    return;
  }

  console.log('[RTMP-WS] New connection established');
  
  let ffmpeg = null;
  let buffer = [];
  let bufferSize = 0;
  const START_BUFFER_THRESHOLD = 32 * 1024; // 32 KB for clean start
  let headerFound = false;
  let isRestarting = false;

  const startFfmpeg = () => {
    if (ffmpeg) return;
    
    console.log(`[RTMP-WS] Spawning Production FFmpeg Pipeline to: ${rtmpUrl.split('?')[0]}...`);
    
    // Production-grade settings for Facebook Live (720p, 30fps, 2s keyframes)
    const ffmpegArgs = [
      '-loglevel', 'info',
      '-f', 'matroska',
      '-i', 'pipe:0',
      '-c:v', 'libx264',
      '-preset', 'veryfast',
      '-tune', 'zerolatency',
      '-pix_fmt', 'yuv420p',
      '-b:v', '2500k',
      '-maxrate', '2500k',
      '-bufsize', '5000k',
      '-g', '60', // 2s keyframe interval for 30fps
      '-keyint_min', '60',
      '-sc_threshold', '0',
      '-c:a', 'aac',
      '-b:a', '128k',
      '-ar', '44100',
      '-f', 'flv',
      '-tls_verify', '0',
      '-flvflags', 'no_duration_filesize',
      rtmpUrl
    ];

    try {
      ffmpeg = spawn(FFMPEG_PATH, ffmpegArgs);
      
      ffmpeg.on('error', (err) => {
        console.error('[FFmpeg-Fatal] Spawn error:', err.message);
        ws.send('FFMPEG-ERROR: Spawn failed: ' + err.message);
      });

      // Flush current buffer
      if (buffer.length > 0) {
        console.log(`[RTMP-WS] Flushing ${buffer.length} chunks to new FFmpeg instance`);
        buffer.forEach(chunk => {
          if (ffmpeg && ffmpeg.stdin.writable) ffmpeg.stdin.write(chunk);
        });
      }

      ffmpeg.stderr.on('data', (stderr) => {
        const msg = stderr.toString();
        if (msg.includes('frame=')) {
          const match = msg.match(/frame=\s*(\d+)/);
          if (match) ws.send(`PROGRESS: frame=${match[1]}`);
        }
        if (msg.includes('Error') || msg.includes('fatal') || msg.includes('Invalid')) {
          console.log('[FFmpeg-Log]', msg.trim());
          ws.send('FFMPEG-ERROR: ' + msg.trim());
        }
      });

      ffmpeg.on('exit', (code) => {
        console.log(`[FFmpeg-Exit] Code: ${code}`);
        ffmpeg = null;
        if (code !== 0 && !isRestarting) {
            console.log('[RTMP-WS] FFmpeg died unexpectedly. Attempting auto-restart...');
            ws.send('SYSTEM-NOTICE: RTMP connection lost, restarting...');
            setTimeout(() => {
                if (headerFound) startFfmpeg();
            }, 2000);
        }
      });

      ffmpeg.stdin.on('error', (err) => {
        console.error('[FFmpeg-Stdin-Error]', err.message);
        // Don't kill the whole process on broken pipe
      });

    } catch (err) {
      console.error('[FFmpeg-Exception]', err.message);
      ws.send('FFMPEG-ERROR: Exception: ' + err.message);
    }
  };

  ws.on('message', (message, isBinary) => {
    if (!isBinary) return; // Ignore non-binary setup messages for simplicity now

    const data = message;
    if (!data || data.length === 0) return;

    // 1. Always keep a small rolling buffer of the last few seconds for restarts
    buffer.push(data);
    if (buffer.length > 5) buffer.shift(); // Keep last ~5 seconds (assuming 1s chunks)

    // 2. Header Detection (Only once per WebSocket session)
    if (!headerFound) {
      const idx = data.indexOf(Buffer.from([0x1A, 0x45, 0xDF, 0xA3]));
      if (idx !== -1) {
        console.log('[RTMP-WS] EBML Header detected. Stream session active.');
        headerFound = true;
        buffer = [data.slice(idx)]; // Reset buffer to start from header
        bufferSize = buffer[0].length;
      } else {
        return; // Ignore data until we see a fresh header
      }
    } else {
        bufferSize += data.length;
    }

    // 3. Start/Pipe
    if (headerFound) {
        if (!ffmpeg && !isRestarting) {
            if (bufferSize >= START_BUFFER_THRESHOLD) {
                startFfmpeg();
            }
        } else if (ffmpeg && ffmpeg.stdin.writable) {
            ffmpeg.stdin.write(data);
        }
    }
  });

  ws.on('close', () => {
    console.log('[RTMP-WS] Client disconnected');
    isRestarting = true; // Prevent auto-restart
    if (ffmpeg) {
      ffmpeg.stdin.end();
      ffmpeg.kill('SIGTERM');
      ffmpeg = null;
    }
  });

  ws.on('error', (err) => {
    console.error('[RTMP-WS] WebSocket error:', err);
    isRestarting = true;
    if (ffmpeg) {
      ffmpeg.stdin.end();
      ffmpeg.kill('SIGTERM');
      ffmpeg = null;
    }
  });

  ws.send('CONNECTED: Ready to receive media chunks');
});

httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`Server listening on port ${PORT} (PROD-READY)`);
});
