const express = require('express');
const http = require('http');
console.log('--- BallSpeed WebRTC Gateway v1.1 starting... ---');
const socketIo = require('socket.io');
const cors = require('cors');
const { spawn } = require('child_process');
const mediasoup = require('mediasoup');
const config = require('./config');

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

// --- Mediasoup State ---
let worker;
let router;
const transports = new Map(); // transportId -> transport
const producers = new Map();  // producerId -> producer

const initMediasoup = async () => {
  worker = await mediasoup.createWorker(config.mediasoup.worker);
  worker.on('died', () => {
    console.error('Mediasoup worker died, exiting in 2 seconds...');
    setTimeout(() => process.exit(1), 2000);
  });

  router = await worker.createRouter(config.mediasoup.router);
  console.log('[Mediasoup] Worker and Router initialized');
};

initMediasoup();

// --- Socket.io Handlers ---
io.on('connection', (socket) => {
  console.log('[Socket.io] New connection:', socket.id);

  socket.on('getRouterRtpCapabilities', (callback) => {
    callback(router.rtpCapabilities);
  });

  socket.on('createWebRtcTransport', async (data, callback) => {
    try {
      const transport = await router.createWebRtcTransport(config.mediasoup.webRtcTransport);
      transports.set(transport.id, transport);

      transport.on('dtlsstatechange', (dtlsState) => {
        if (dtlsState === 'closed') transport.close();
      });

      callback({
        id: transport.id,
        iceParameters: transport.iceParameters,
        iceCandidates: transport.iceCandidates,
        dtlsParameters: transport.dtlsParameters
      });
    } catch (err) {
      console.error('CreateWebRtcTransport error:', err);
      callback({ error: err.message });
    }
  });

  socket.on('connectWebRtcTransport', async ({ transportId, dtlsParameters }, callback) => {
    const transport = transports.get(transportId);
    if (!transport) return callback({ error: 'Transport not found' });
    await transport.connect({ dtlsParameters });
    callback();
  });

  socket.on('produce', async ({ transportId, kind, rtpParameters, rtmpUrl }, callback) => {
    const transport = transports.get(transportId);
    if (!transport) return callback({ error: 'Transport not found' });

    try {
      const producer = await transport.produce({ kind, rtpParameters });
      producers.set(producer.id, producer);

      console.log(`[Mediasoup] New producer: ${producer.id} (${kind})`);

      // If we have a producer, we can start FFmpeg
      // In this version, we trigger FFmpeg when both audio and video might be present,
      // or just one if it's a single track stream.
      if (rtmpUrl) {
         startRtmpStreaming(producer, rtmpUrl, socket, transportId);
      }

      callback({ id: producer.id });
    } catch (err) {
      console.error('Produce error:', err);
      callback({ error: err.message });
    }
  });

  socket.on('disconnect', () => {
    console.log('Socket disconnected:', socket.id);
  });
});

// --- FFmpeg & RTMP Logic ---
const sessions = new Map(); // transportId -> Session

class StreamingSession {
  constructor(socket, rtmpUrl) {
    this.socket = socket;
    this.rtmpUrl = rtmpUrl;
    this.producers = { video: null, audio: null };
    this.ffmpeg = null;
    this.plainTransports = { video: null, audio: null };
  }

  async addProducer(producer) {
    this.producers[producer.kind] = producer;
    
    // Create PlainTransport for this track
    this.plainTransports[producer.kind] = await router.createPlainTransport({
      listenIp: '127.0.0.1',
      rtcpMux: false,
      comedia: false
    });

    const transport = this.plainTransports[producer.kind];
    const consumer = await transport.consume({
      producerId: producer.id,
      rtpCapabilities: router.rtpCapabilities,
      paused: false
    });

    transport.appData.consumer = consumer;

    // Wait for both tracks or a timeout to start FFmpeg
    if (this.producers.video || this.producers.audio) {
      this.maybeStartFfmpeg();
    }
  }

  async maybeStartFfmpeg() {
    if (this.ffmpeg) return;

    // Start FFmpeg if we have what we need
    console.log(`[RTMP] Starting multi-track FFmpeg for session...`);

    const videoTransport = this.plainTransports.video;
    const audioTransport = this.plainTransports.audio;

    let sdp = `v=0
o=- 0 0 IN IP4 127.0.0.1
s=Mediasoup
c=IN IP4 127.0.0.1
t=0 0\n`;

    if (videoTransport) {
      const consumer = videoTransport.appData.consumer;
      sdp += `m=video ${videoTransport.tuple.localPort} RTP/AVP ${consumer.rtpParameters.codecs[0].payloadType}\n`;
      sdp += `a=rtpmap:${consumer.rtpParameters.codecs[0].payloadType} ${consumer.rtpParameters.codecs[0].mimeType.split('/')[1]}/${consumer.rtpParameters.codecs[0].clockRate}\n`;
    }

    if (audioTransport) {
      const consumer = audioTransport.appData.consumer;
      sdp += `m=audio ${audioTransport.tuple.localPort} RTP/AVP ${consumer.rtpParameters.codecs[0].payloadType}\n`;
      sdp += `a=rtpmap:${consumer.rtpParameters.codecs[0].payloadType} ${consumer.rtpParameters.codecs[0].mimeType.split('/')[1]}/${consumer.rtpParameters.codecs[0].clockRate}\n`;
    }

    const ffmpegArgs = [
      '-loglevel', 'info',
      '-protocol_whitelist', 'file,rtp,udp,pipe',
      '-i', 'pipe:0',
      '-c:v', 'libx264', '-preset', 'ultrafast', '-tune', 'zerolatency',
      '-pix_fmt', 'yuv420p', '-b:v', '1500k', '-g', '60',
      '-c:a', 'aac', '-b:a', '128k', '-ar', '44100',
      '-f', 'flv', this.rtmpUrl
    ];

    this.ffmpeg = spawn(FFMPEG_PATH, ffmpegArgs);
    this.ffmpeg.stdin.write(sdp);
    this.ffmpeg.stdin.end();

    this.ffmpeg.stderr.on('data', (data) => {
      const msg = data.toString();
      if (msg.includes('frame=')) {
          const match = msg.match(/frame=\s*(\d+)/);
          if (match) this.socket.emit('rtmp-progress', { frame: match[1] });
      }
    });

    this.ffmpeg.on('exit', () => {
      this.stop();
    });
  }

  stop() {
    if (this.ffmpeg) this.ffmpeg.kill('SIGTERM');
    this.ffmpeg = null;
    Object.values(this.plainTransports).forEach(t => t?.close());
  }
}

async function startRtmpStreaming(producer, rtmpUrl, socket, transportId) {
  let session = sessions.get(transportId);
  if (!session) {
    session = new StreamingSession(socket, rtmpUrl);
    sessions.set(transportId, session);
  }
  await session.addProducer(producer);
}

httpServer.listen(PORT, '0.0.0.0', () => {
  console.log(`WebRTC Gateway listening on port ${PORT}`);
});
