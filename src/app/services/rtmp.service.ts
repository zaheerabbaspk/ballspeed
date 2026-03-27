import { Injectable } from '@angular/core';
import { SettingsService } from './settings.service';

@Injectable({
  providedIn: 'root'
})
export class RtmpService {
  private ws: WebSocket | null = null;
  private recorder: MediaRecorder | null = null;
  private isStreaming = false;

  constructor(private settings: SettingsService) {}

  /**
   * Start RTMP streaming by:
   * 1. Opening a WebSocket to the gateway
   * 2. Starting MediaRecorder on the canvas stream
   * 3. Sending binary webm chunks to backend
   */
  start(canvasStream: MediaStream, rtmpUrl: string): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.isStreaming) {
        reject(new Error('Already streaming'));
        return;
      }

      const gatewayUrl = this.settings.gatewayUrl();
      // Convert http://localhost:3000 → ws://localhost:3000/rtmp
      const wsUrl = gatewayUrl.replace(/^http/, 'ws') + '/rtmp?url=' + encodeURIComponent(rtmpUrl);
      console.log('[RTMP] Connecting WebSocket:', wsUrl);

      this.ws = new WebSocket(wsUrl);
      this.ws.binaryType = 'arraybuffer';

      this.ws.onopen = () => {
        console.log('[RTMP] WebSocket connected, starting MediaRecorder...');
        try {
          this.startRecorder(canvasStream);
          this.isStreaming = true;
          resolve();
        } catch (err) {
          reject(err);
        }
      };

      this.ws.onerror = (ev) => {
        console.error('[RTMP] WebSocket error:', ev);
        reject(new Error('WebSocket connection failed'));
      };

      this.ws.onclose = (ev) => {
        console.log('[RTMP] WebSocket closed:', ev.code, ev.reason);
        this.cleanup();
      };

      this.ws.onmessage = (ev) => {
        // Server sends FFmpeg status messages
        console.log('[RTMP] Server:', ev.data);
      };

      // Timeout if connection hangs
      setTimeout(() => {
        if (this.ws?.readyState !== WebSocket.OPEN) {
          reject(new Error('WebSocket connection timeout'));
          this.cleanup();
        }
      }, 5000);
    });
  }

  private async startRecorder(stream: MediaStream) {
    const mimeTypes = [
      'video/webm;codecs=vp8,opus',
      'video/webm;codecs=vp8',
      'video/webm',
    ];
    
    let mimeType = '';
    for (const mt of mimeTypes) {
      if (MediaRecorder.isTypeSupported(mt)) {
        mimeType = mt;
        break;
      }
    }

    if (!mimeType) throw new Error('No supported MediaRecorder MIME type found');
    console.log('[RTMP] Using MIME type:', mimeType);

    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'config', mimeType }));
    }

    this.recorder = new MediaRecorder(stream, {
      mimeType,
      videoBitsPerSecond: 1000000, 
    });

    this.recorder.ondataavailable = (event) => {
      if (event.data.size > 0 && this.ws?.readyState === WebSocket.OPEN) {
        // Direct Blob send - most reliable for browser networking
        this.ws.send(event.data);
      }
    };

    this.recorder.start(1000); // 1s chunks are the most stable for browser-to-server relay
  }

  stop() {
    console.log('[RTMP] Stopping...');
    this.cleanup();
  }

  private cleanup() {
    this.isStreaming = false;
    
    if (this.recorder && this.recorder.state !== 'inactive') {
      try { this.recorder.stop(); } catch (e) {}
    }
    this.recorder = null;

    if (this.ws) {
      try { this.ws.close(); } catch (e) {}
    }
    this.ws = null;
  }

  getIsStreaming(): boolean {
    return this.isStreaming;
  }
}
