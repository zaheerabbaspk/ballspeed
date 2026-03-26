const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const mediasoup = require('mediasoup');
const cors = require('cors');
const { spawn } = require('child_process');
const config = require('./config');

const app = express();
app.use(cors());

const httpServer = http.createServer(app);
const io = socketIo(httpServer, {
  cors: {
    origin: '*',
  },
});

let worker;
let router;
const producers = []; // { id, producer, socketId }
const consumers = []; // { id, consumer, socketId }

const startMediasoup = async () => {
  worker = await mediasoup.createWorker(config.mediasoup.worker);
  router = await worker.createRouter(config.mediasoup.router);
  console.log('Mediasoup worker and router created');
};

startMediasoup();

io.on('connection', (socket) => {
  console.log('New connection:', socket.id);

  socket.on('getRouterRtpCapabilities', (callback) => {
    callback(router.rtpCapabilities);
  });

  socket.on('createWebRtcTransport', async (data, callback) => {
    try {
      const transport = await router.createWebRtcTransport(config.mediasoup.webRtcTransport);
      
      transport.on('dtlsstatechange', (dtlsState) => {
        if (dtlsState === 'closed') transport.close();
      });

      callback({
        id: transport.id,
        iceParameters: transport.iceParameters,
        iceCandidates: transport.iceCandidates,
        dtlsParameters: transport.dtlsParameters,
      });

      // Store transport for this socket
      socket.transport = transport;
    } catch (error) {
      console.error('Error creating transport:', error);
      callback({ error: error.message });
    }
  });

  socket.on('connectTransport', async ({ transportId, dtlsParameters }, callback) => {
    await socket.transport.connect({ dtlsParameters });
    callback();
  });

  socket.on('produce', async ({ kind, rtpParameters }, callback) => {
    const producer = await socket.transport.produce({ kind, rtpParameters });
    producers.push({ id: producer.id, producer, socketId: socket.id });
    
    producer.on('transportclose', () => {
      producer.close();
    });

    callback({ id: producer.id });
    
    // Notify all other clients about the new producer
    socket.broadcast.emit('newProducer', { producerId: producer.id });
  });

  socket.on('consume', async ({ producerId, rtpCapabilities }, callback) => {
    if (!router.canConsume({ producerId, rtpCapabilities })) {
      return callback({ error: 'Cannot consume' });
    }

    const producer = producers.find(p => p.id === producerId).producer;
    const consumer = await socket.transport.consume({
      producerId: producer.id,
      rtpCapabilities,
      paused: true,
    });

    consumers.push({ id: consumer.id, consumer, socketId: socket.id });

    consumer.on('transportclose', () => {
      consumer.close();
    });

    callback({
      id: consumer.id,
      producerId: producer.id,
      kind: consumer.kind,
      rtpParameters: consumer.rtpParameters,
    });
  });

  socket.on('resume', async ({ consumerId }, callback) => {
    const consumer = consumers.find(c => c.id === consumerId).consumer;
    await consumer.resume();
    callback();
  });

  socket.on('getProducers', (callback) => {
    callback(producers.map(p => p.id));
  });

  socket.on('startRtmp', async ({ videoProducerId, audioProducerId, rtmpUrl }, callback) => {
    try {
      console.log(`Starting RTMP: video=${videoProducerId}, audio=${audioProducerId} -> ${rtmpUrl}`);
      
      const vTrans = await router.createPlainTransport({ listenIp: '127.0.0.1', rtcpMux: false, comedia: true });
      const aTrans = await router.createPlainTransport({ listenIp: '127.0.0.1', rtcpMux: false, comedia: true });

      const vCons = await vTrans.consume({ producerId: videoProducerId, rtpCapabilities: router.rtpCapabilities });
      let aCons = null;
      if (audioProducerId) {
        aCons = await aTrans.consume({ producerId: audioProducerId, rtpCapabilities: router.rtpCapabilities });
      }

      const ffmpegArgs = [
        '-loglevel', 'info', '-protocol_whitelist', 'pipe,udp,rtp', '-fflags', '+genpts',
        '-f', 'sdp', '-i', 'pipe:0',
        '-c:v', 'libx264', '-preset', 'veryfast', '-tune', 'zerolatency', '-pix_fmt', 'yuv420p', '-g', '60',
        '-c:a', 'aac', '-b:a', '128k', '-ar', '44100',
        '-f', 'flv', rtmpUrl
      ];

      const ffmpeg = spawn('ffmpeg', ffmpegArgs);
      ffmpeg.on('error', (err) => console.error('FFmpeg error:', err));
      ffmpeg.on('exit', (code) => console.log(`FFmpeg exited: ${code}`));

      let sdp = `v=0\no=- 0 0 IN IP4 127.0.0.1\ns=Mediasoup\nc=IN IP4 127.0.0.1\nt=0 0\n`;
      sdp += `m=video ${vTrans.tuple.localPort} RTP/AVP ${vCons.rtpParameters.codecs[0].payloadType}\n`;
      sdp += `a=rtpmap:${vCons.rtpParameters.codecs[0].payloadType} VP8/90000\n`;
      
      if (aCons) {
        sdp += `m=audio ${aTrans.tuple.localPort} RTP/AVP ${aCons.rtpParameters.codecs[0].payloadType}\n`;
        sdp += `a=rtpmap:${aCons.rtpParameters.codecs[0].payloadType} opus/48000/2\n`;
      }

      ffmpeg.stdin.write(sdp);
      ffmpeg.stdin.end();

      socket.rtmpTransports = [vTrans, aTrans];
      socket.ffmpeg = ffmpeg;
      callback({ success: true });
    } catch (err) {
      console.error('RTMP Error:', err);
      callback({ error: err.message });
    }
  });

  socket.on('disconnect', () => {
    console.log('Socket disconnected:', socket.id);
    // Cleanup producers/consumers for this socket
    // (Simplified for this example)
  });
});

httpServer.listen(config.httpPort, () => {
  console.log(`Server listening on port ${config.httpPort}`);
});
