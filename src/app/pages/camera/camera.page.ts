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
      this.status = 'Connecting...';
      if (!this.roomId) throw new Error('No Room ID found');

      await this.streamingService.init(this.roomId);
      const stream = await this.streamingService.startProducing('CONTROLLER');
      
      if (this.localVideo) {
        this.localVideo.nativeElement.srcObject = stream;
      }
      
      this.isStreaming = true;
      this.status = 'Streaming Live';
      this.isFullscreen.set(true);
    } catch (error: any) {
      console.error('Streaming error:', error);
      if (error.name === 'NotAllowedError') {
        this.status = 'Permission Denied! Please ALLOW camera/mic access in your browser settings and refresh.';
      } else {
        this.status = 'Error: ' + (error.message || error);
      }
    }
  }

  toggleFullscreen(show: boolean) {
    this.isFullscreen.set(show);
  }
}
