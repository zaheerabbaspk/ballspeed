import { Injectable } from '@angular/core';
import { io, Socket } from 'socket.io-client';
import * as mediasoupClient from 'mediasoup-client';
import { SettingsService } from './settings.service';

@Injectable({
  providedIn: 'root'
})
export class MediasoupService {
  private socket: Socket;
  private device: mediasoupClient.Device | null = null;
  private sendTransport: mediasoupClient.types.Transport | null = null;
  private videoProducer: mediasoupClient.types.Producer | null = null;
  private audioProducer: mediasoupClient.types.Producer | null = null;

  constructor(private settings: SettingsService) {
    const backendUrl = this.settings.gatewayUrl();
    console.log('[MediasoupService] Connecting to:', backendUrl);
    this.socket = io(backendUrl, { transports: ['websocket'] });
  }

  async init() {
    if (this.device) return;

    return new Promise<void>((resolve, reject) => {
      if (this.socket.connected) {
        this.loadDevice().then(resolve).catch(reject);
      } else {
        this.socket.once('connect', async () => {
          console.log('[MediasoupService] Connected to gateway');
          try {
            await this.loadDevice();
            resolve();
          } catch (err) {
            reject(err);
          }
        });
        this.socket.once('connect_error', (err) => {
          console.error('[MediasoupService] Connection error:', err);
          reject(new Error('Backend Gateway Connection Failed'));
        });
      }
    });
  }

  private async loadDevice(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.socket.emit('getRouterRtpCapabilities', async (rtpCapabilities: any) => {
        try {
          this.device = new mediasoupClient.Device();
          await this.device.load({ routerRtpCapabilities: rtpCapabilities });
          console.log('[MediasoupService] Device loaded successfully');
          resolve();
        } catch (err) {
          console.error('[MediasoupService] Device load failed:', err);
          reject(err);
        }
      });
      
      setTimeout(() => reject(new Error('Mediasoup Capabilities Timeout')), 5000);
    });
  }

  async produce(stream: MediaStream) {
    if (!this.device) throw new Error('Device not initialized');

    this.sendTransport = await this.createTransport();

    const videoTrack = stream.getVideoTracks()[0];
    if (videoTrack) {
      this.videoProducer = await this.sendTransport.produce({ track: videoTrack });
    }

    const audioTrack = stream.getAudioTracks()[0];
    if (audioTrack) {
      this.audioProducer = await this.sendTransport.produce({ track: audioTrack });
    }

    return this.videoProducer?.id || null;
  }

  private async createTransport(): Promise<mediasoupClient.types.Transport> {
    return new Promise((resolve, reject) => {
      this.socket.emit('createWebRtcTransport', {}, async (data: any) => {
        if (data.error) return reject(new Error(data.error));

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
    this.videoProducer = null;
    this.audioProducer = null;
    this.sendTransport = null;
  }
}
