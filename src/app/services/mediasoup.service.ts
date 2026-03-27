import { Injectable } from '@angular/core';
import { Subject } from 'rxjs';
import { io, Socket } from 'socket.io-client';
import { SettingsService } from './settings.service';

@Injectable({
  providedIn: 'root'
})
export class MediasoupService {
  private socket: Socket;
  public onSignal = new Subject<any>();

  constructor(private settings: SettingsService) {
    const backendUrl = this.settings.gatewayUrl();
    console.log('[MediasoupService] Connecting to:', backendUrl);
    
    // Force websocket transport to bypass 502/CORS issues on Railway
    this.socket = io(backendUrl, {
      transports: ['websocket'],
      upgrade: false,
      reconnection: true,
      reconnectionAttempts: 10,
      reconnectionDelay: 1000
    });

    this.socket.on('connect', () => {
      console.log('[MediasoupService] Connected to gateway via WebSocket');
    });

    this.socket.on('connect_error', (err) => {
      console.error('[MediasoupService] Connection error:', err.message);
    });

    this.socket.on('signal', (data: any) => {
      console.log('[MediasoupService] Signal:', data.type);
      this.onSignal.next(data);
    });
  }

  joinRoom(roomId: string) {
    console.log('[MediasoupService] Joining room:', roomId);
    this.socket.emit('join-room', roomId);
  }

  sendSignal(roomId: string, toPeerId: string | null, type: string, data: any) {
    this.socket.emit('signal', { roomId, toPeerId, type, data });
  }

  /**
   * Mock init for backward compatibility with components still calling it
   */
  async init() {
    return new Promise<void>((resolve) => {
      if (this.socket.connected) return resolve();
      this.socket.once('connect', () => resolve());
      // Don't block if connection takes too long
      setTimeout(resolve, 3000);
    });
  }

  stop() {
    this.socket.disconnect();
  }
}

