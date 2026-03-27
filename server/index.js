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
    origin: true, // Required when credentials: true in Socket.io v4 to allow all
    methods: ["GET", "POST"],
    credentials: true
  },

  transports: ['websocket'], // Force websocket on server side
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

  console.log('[RTMP-WS] New connection, target:', rtmpUrl);
  
  let ffmpeg = null;
  let chunkCount = 0;
  let totalBytes = 0;
  let buffer = [];
  let bufferSize = 0;
  const START_BUFFER_THRESHOLD = 32 * 1024; // 32 KB for clean Packet-Pure start
  let mimeType = 'video/webm;codecs=vp8,opus'; 
  let headerFound = false;

  ws.on('message', (message, isBinary) => {
    if (!isBinary) {
      try {
        const msg = JSON.parse(message.toString());
        if (msg.type === 'config') {
          mimeType = msg.mimeType;
          console.log('[RTMP-WS] Config received:', mimeType);
        }
        return;
      } catch (e) { return; }
    }

    const data = message;
    if (!data || data.length === 0) return;

    // Strict WebM/EBML header detection (0x1A 0x45 0xDF 0xA3)
    if (!headerFound) {
      const idx = data.indexOf(Buffer.from([0x1A, 0x45, 0xDF, 0xA3]));
      if (idx !== -1) {
        console.log('[RTMP-WS] EBML Header detected. Starting pure stream...');
        headerFound = true;
        const headData = data.slice(idx);
        buffer.push(headData);
        bufferSize += headData.length;
      } else {
        return; // Ignore data until we see a fresh header
      }
    } else if (!ffmpeg) {
      buffer.push(data);
      bufferSize += data.length;
    }

    // Spawn FFmpeg once buffer is sufficient for stable probing
    if (headerFound && !ffmpeg && bufferSize >= START_BUFFER_THRESHOLD) {
      console.log(`[RTMP-WS] Spawning Packet-Pure Stream (Buffer: ${bufferSize} bytes)...`);
      
      const ffmpegArgs = [
        '-loglevel', 'info',
        '-re',
        '-use_wallclock_as_timestamps', '1',
        '-fflags', '+genpts+nobuffer+igndts+flush_packets+discardcorrupt',
        '-probesize', '1M',
        '-analyzeduration', '1M',
        '-flags', '+low_delay',
        '-avoid_negative_ts', 'make_zero',
        '-f', 'matroska',
        '-i', 'pipe:0',
        '-vf', 'fps=30,scale=960:540,format=yuv420p',
        '-c:v', 'libx264',
        '-preset', 'superfast',
        '-tune', 'zerolatency',
        '-b:v', '1500k', 
        '-maxrate', '2000k',
        '-bufsize', '3000k', 
        '-g', '30',
        '-rtmp_buffer', '100',
        '-rtmp_live', 'live',
        '-af', 'aresample=async=1:min_hard_comp=0.100000:first_pts=0',
        '-c:a', 'aac',
        '-b:a', '128k',
        '-ar', '44100',
        '-flvflags', 'no_duration_filesize',
        '-flush_packets', '1',
        '-f', 'flv',
        '-tls_verify', '0', 
        rtmpUrl
      ];

      try {
        ffmpeg = spawn(FFMPEG_PATH, ffmpegArgs);
        
        ffmpeg.on('error', (err) => {
          console.error('[FFmpeg-Fatal] Spawn error:', err.message);
          ws.close(1011, 'FFmpeg failed to start');
        });

        // Flush initial stable buffer
        buffer.forEach(chunk => {
          if (ffmpeg && ffmpeg.stdin.writable) ffmpeg.stdin.write(chunk);
        });
        buffer = [];

        ffmpeg.stderr.on('data', (stderr) => {
          const msg = stderr.toString();
          if (msg.includes('frame=')) {
            const match = msg.match(/frame=\s*(\d+)/);
            if (match) ws.send(`PROGRESS: frame=${match[1]}`);
          }
          if (msg.includes('Error') || msg.includes('fatal') || msg.includes('Invalid')) {
            console.log('[FFmpeg-Log]', msg.trim());
          }
        });

        ffmpeg.on('exit', (code) => {
          console.log(`[FFmpeg-Exit] Code: ${code}`);
          ffmpeg = null;
          // Force client reconnect for new headers if FFmpeg died
          if (code !== 0 && code !== null) {
            ws.close(1011, 'FFmpeg process terminated abnormally');
          }
        });

        ffmpeg.stdin.on('error', (err) => console.error('[FFmpeg-Stdin-Error]', err.message));
      } catch (err) {
        console.error('[FFmpeg-Exception]', err.message);
        ws.close(1011, 'FFmpeg initialization exception');
      }
      return;
    }

    // Continuous piping
    if (ffmpeg && ffmpeg.stdin.writable) {
      ffmpeg.stdin.write(data);
    }
  });

  ws.on('close', () => {
    console.log('[RTMP-WS] Client disconnected');
    if (ffmpeg) {
      ffmpeg.stdin.end();
      ffmpeg.kill('SIGTERM');
      ffmpeg = null;
    }
  });

  ws.on('error', (err) => {
    console.error('[RTMP-WS] WebSocket error:', err);
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
