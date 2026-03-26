import { Component, OnInit, ViewChild, ElementRef, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonContent, IonHeader, IonToolbar, IonTitle, IonButton, IonIcon, IonBadge } from '@ionic/angular/standalone';
import { StreamingService } from '../../services/streaming.service';
import { ActivatedRoute } from '@angular/router';
import { addIcons } from 'ionicons';
import { videocam, radioButtonOn, closeOutline } from 'ionicons/icons';

@Component({
  selector: 'app-camera',
  templateUrl: './camera.page.html',
  styleUrls: ['./camera.page.scss'],
  standalone: true,
  imports: [IonContent, IonHeader, IonToolbar, IonTitle, IonButton, IonIcon, IonBadge, CommonModule]
})
export class CameraPage implements OnInit {
  @ViewChild('localVideo') localVideo!: ElementRef<HTMLVideoElement>;
  isStreaming = false;
  status = 'Disconnected';
  signalingStatus = signal<string>('initializing');
  rtcStatus = signal<string>('new');
  isFullscreen = signal<boolean>(false);
  private roomId: string | null = null;

  constructor(
    private streamingService: StreamingService,
    private route: ActivatedRoute
  ) {
    addIcons({ videocam, 'radio-button-on': radioButtonOn, closeOutline });
  }

  async ngOnInit() {
    this.roomId = this.route.snapshot.paramMap.get('id');
    this.status = `Ready (Room: ${this.roomId})`;

    this.streamingService['signaling'].status$.subscribe(s => this.signalingStatus.set(s));
    this.streamingService.connectionState$.subscribe(s => this.rtcStatus.set(s.state));
  }

  async startStreaming() {
    try {
      if (!window.isSecureContext) {
        this.status = 'Error: Camera access REQUIRES a secure connection (HTTPS). Please open the https:// link.';
        return;
      }
      this.status = 'Connecting...';
      if (!this.roomId) throw new Error('No Room ID found');

      await this.logDevices();

      console.log('[CameraPage] Starting stream...');
      this.status = 'Requesting Camera...';
      try {
        await this.streamingService.init(this.roomId);
        const stream = await this.streamingService.startProducing('CONTROLLER');
        if (this.localVideo) {
          this.localVideo.nativeElement.srcObject = stream;
        }
      } catch (err: any) {
        if (err.name === 'NotAllowedError') {
          console.log('[CameraPage] Video+Audio failed, trying Video-only fallback...');
          this.status = 'Retrying Video only...';
          const stream = await navigator.mediaDevices.getUserMedia({ 
            video: { facingMode: { ideal: 'environment' } } 
          });
          if (this.localVideo) {
            this.localVideo.nativeElement.srcObject = stream;
          }
        }
        throw err;
      }
      
      this.isStreaming = true;
      this.status = 'Streaming Live';
      this.isFullscreen.set(true);
    } catch (error: any) {
      console.error('Streaming error:', error);
      if (error.name === 'NotAllowedError') {
        this.status = 'Permission Denied! Tap the [LOCK] icon next to the URL, select "Site Settings", and then click "Allow" for Camera/Mic.';
      } else if (error.name === 'NotFoundError') {
        this.status = 'Error: No camera/microphone found on this device.';
      } else {
        this.status = 'Error: ' + (error.message || error);
      }
    }
  }

  private async logDevices() {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      console.log('[CameraPage] Available devices:', devices.map(d => `${d.kind}: ${d.label} (${d.deviceId})`));
    } catch (e) {
      console.error('[CameraPage] Enumerate devices failed:', e);
    }
  }

  toggleFullscreen(show: boolean) {
    this.isFullscreen.set(show);
  }
}
