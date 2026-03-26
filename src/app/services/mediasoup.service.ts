import { Injectable } from '@angular/core';
import { io, Socket } from 'socket.io-client';
import * as mediasoupClient from 'mediasoup-client';

@Injectable({
  providedIn: 'root'
})
export class MediasoupService {
  private socket: Socket;
  private device: mediasoupClient.Device | null = null;
  private sendTransport: mediasoupClient.types.Transport | null = null;
  private videoProducer: mediasoupClient.types.Producer | null = null;
  private audioProducer: mediasoupClient.types.Producer | null = null;

  constructor() {
    // Determine backend URL
    const backendUrl = window.location.hostname === 'localhost' ? 'http://localhost:3000' : `http://${window.location.hostname}:3000`;
    this.socket = io(backendUrl);
  }

  async init() {
    return new Promise<void>((resolve, reject) => {
      this.socket.on('connect', async () => {
        console.log('[MediasoupService] Connected to gateway');
        try {
          await this.loadDevice();
          resolve();
        } catch (err) {
          reject(err);
        }
      });
      this.socket.on('connect_error', (err) => reject(err));
    });
  }

  private async loadDevice() {
    this.socket.emit('getRouterRtpCapabilities', async (rtpCapabilities: any) => {
      this.device = new mediasoupClient.Device();
      await this.device.load({ routerRtpCapabilities: rtpCapabilities });
      console.log('[MediasoupService] Device loaded');
    });
  }

  async produce(stream: MediaStream) {
    if (!this.device) throw new Error('Device not initialized');

    // 1. Create Transport
    this.sendTransport = await this.createTransport();

    // 2. Produce Video
    const videoTrack = stream.getVideoTracks()[0];
    if (videoTrack) {
      this.videoProducer = await this.sendTransport.produce({ track: videoTrack });
      console.log('[MediasoupService] Video producer id:', this.videoProducer.id);
    }

    // 3. Produce Audio
    const audioTrack = stream.getAudioTracks()[0];
    if (audioTrack) {
      this.audioProducer = await this.sendTransport.produce({ track: audioTrack });
      console.log('[MediasoupService] Audio producer id:', this.audioProducer.id);
    }

    return this.videoProducer?.id || null;
  }

  private async createTransport() {
    return new Promise<mediasoupClient.types.Transport>((resolve, reject) => {
      this.socket.emit('createWebRtcTransport', {}, async (data: any) => {
        if (data.error) return reject(data.error);

        const transport = this.device!.createSendTransport(data);

        transport.on('connect', ({ dtlsParameters }, callback, errback) => {
          this.socket.emit('connectTransport', { transportId: transport.id, dtlsParameters }, () => callback());
        });

        transport.on('produce', ({ kind, rtpParameters }, callback, errback) => {
          this.socket.emit('produce', { kind, rtpParameters }, (idData: any) => callback({ id: idData.id }));
        });

        resolve(transport);
      });
    });
  }

  async startRtmp(rtmpUrl: string) {
    if (!this.videoProducer) throw new Error('No video producer active');
    
    return new Promise<{success?: boolean, error?: string}>((resolve) => {
      this.socket.emit('startRtmp', { 
        videoProducerId: this.videoProducer!.id,
        audioProducerId: this.audioProducer?.id || null,
        rtmpUrl 
      }, (res: any) => resolve(res));
    });
  }

  stop() {
    this.videoProducer?.close();
    this.audioProducer?.close();
    this.sendTransport?.close();
  }

  getProducerId() {
    return this.videoProducer?.id || null;
  }
}
