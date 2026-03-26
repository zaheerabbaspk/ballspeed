import { Component, OnInit, signal, ViewChildren, QueryList, ElementRef, ViewChild, computed, AfterViewInit, HostListener } from '@angular/core';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { CommonModule } from '@angular/common';
import { IonContent, IonHeader, IonToolbar, IonTitle, IonButton, IonIcon, IonBadge, IonGrid, IonRow, IonCol, ModalController } from '@ionic/angular/standalone';
import { StreamingService } from '../../services/streaming.service';
import { SettingsService } from '../../services/settings.service';
import { SettingsPage } from '../settings/settings.page';
import { ActivatedRoute } from '@angular/router';
import { addIcons } from 'ionicons';
import {
  videocam, tv, shareSocial, settings, radio, timeOutline, add,
  optionsOutline, linkOutline, gridOutline, cameraOutline, browsersOutline, settingsOutline,
  radioOutline, layersOutline, closeOutline, saveOutline, globeOutline,
  lockClosedOutline, lockOpenOutline, videocamOutline, contractOutline, trashOutline
} from 'ionicons/icons';

@Component({
  selector: 'app-controller',
  templateUrl: './controller.page.html',
  styleUrls: ['./controller.page.scss'],
  standalone: true,
  imports: [IonContent, IonHeader, IonToolbar, IonTitle, IonButton, IonIcon, CommonModule]
})
export class ControllerPage implements OnInit, AfterViewInit {
  @ViewChild('mainVideo') mainVideo!: ElementRef<HTMLVideoElement>;
  @ViewChild('overlayContainer') overlayContainer!: ElementRef<HTMLDivElement>;
  cameras = signal<any[]>([]); // { id, stream }
  activeCameraId = signal<string | null>(null);
  activeStream = signal<MediaStream | null>(null);
  previewCameraId = signal<string | null>(null);
  previewStream = signal<MediaStream | null>(null);

  @ViewChild('mediaPicker') mediaPicker!: ElementRef<HTMLInputElement>;
  mediaType = signal<'video' | 'image' | 'none'>('none');

  signalingStatus = signal<string>('initializing');
  peerConnectionStates = signal<Record<string, string>>({});

  volumeLevel = signal<number>(0);
  currentTime = signal<string>('00:00:00');
  private audioCtx: AudioContext | null = null;
  private analyzer: AnalyserNode | null = null;
  private animationFrameId: number | null = null;

  currentRoomId = signal<string>('');
  shareUrl = signal<string>('');

  isOverlayLocked = signal<boolean>(true);
  private startPointerPos = { x: 0, y: 0 };
  private startOverlayPos = { x: 0, y: 0, scale: 1, width: 1920, height: 1080 };
  private currentMode: 'NONE' | 'DRAGGING' | 'RESIZING' | 'PINCHING' = 'NONE';
  private currentTarget: 'OVERLAY' | 'SCOREBOARD' | 'MEDIA' = 'OVERLAY';

  private activePointers = new Map<number, PointerEvent>();
  private initialPinchDist = 0;
  private initialOverlayScale = 1;
  sanitizedOverlayUrl = computed(() =>
    this.sanitizer.bypassSecurityTrustResourceUrl(this.studioSettings.overlayUrl())
  );

  sanitizedMediaUrl = computed(() =>
    this.sanitizer.bypassSecurityTrustResourceUrl(this.studioSettings.mediaUrl())
  );

  overlayFitScale = signal<number>(1);

  // Calculate how much to scale a 1920px canvas to fit the current video container
  updateOverlayScale(containerWidth: number) {
    const scale = containerWidth / 1920;
    this.overlayFitScale.set(scale);
  }

  sanitizedScoreboardUrl = computed(() => {
    const id = this.studioSettings.scoreboardId();
    const op = this.studioSettings.scoreboardOperator() || '11';
    if (!id) return null;
    // Dynamic CricketSasa ticker selection
    return this.sanitizer.bypassSecurityTrustResourceUrl(`https://cricketsasa.com/cricket/display_ticker_${op}.php?match_id=${id}&year=2026&op=${op}`);
  });

  constructor(
    private streamingService: StreamingService,
    private route: ActivatedRoute,
    public studioSettings: SettingsService,
    private modalCtrl: ModalController,
    private sanitizer: DomSanitizer
  ) {
    addIcons({ shareSocial, radio, timeOutline, videocamOutline, add, gridOutline, contractOutline, videocam, optionsOutline, linkOutline, cameraOutline, browsersOutline, settingsOutline, tv, settings, radioOutline, layersOutline, closeOutline, saveOutline, globeOutline, lockClosedOutline, lockOpenOutline, trashOutline });
  }

  async openSettings() {
    const modal = await this.modalCtrl.create({
      component: SettingsPage,
      cssClass: 'settings-modal'
    });
    return await modal.present();
  }

  async ngOnInit() {
    const roomId = this.route.snapshot.paramMap.get('id');
    if (!roomId) return;

    this.currentRoomId.set(roomId);
    this.shareUrl.set(`${window.location.origin}/room/${roomId}/camera`);
    await this.streamingService.init(roomId, 'CONTROLLER');

    this.streamingService.remoteStream$.subscribe(({ peerId, stream }: { peerId: string, stream: MediaStream }) => {
      console.log('Received remote stream from camera:', peerId);
      this.cameras.update(prev => {
        const exists = prev.find(c => c.id === peerId);
        if (exists) {
          // Update stream if peerId exists
          exists.stream = stream;
          return [...prev];
        }
        return [...prev, { id: peerId, stream }];
      });

      if (!this.activeCameraId()) {
        this.switchCamera(peerId);
      }
    });

    // Start Clock
    setInterval(() => {
      const now = new Date();
      this.currentTime.set(now.toLocaleTimeString([], { hour12: false }));
    }, 1000);

    // Diagnostic Subscriptions
    this.streamingService['signaling'].status$.subscribe(status => {
      this.signalingStatus.set(status);
    });

    this.streamingService.connectionState$.subscribe(({ peerId, state }) => {
      this.peerConnectionStates.update(prev => ({ ...prev, [peerId]: state }));
    });

    // Initial scale calculation
    setTimeout(() => this.calculateFitScale(), 500);
  }

  ngAfterViewInit() {
    this.calculateFitScale();
    // Auto-center scoreboard on first load to ensure it fits the current canvas
    setTimeout(() => this.centerOverlay('SCOREBOARD'), 1000);
  }

  @HostListener('window:resize')
  onResize() {
    this.calculateFitScale();
  }

  private calculateFitScale() {
    if (this.overlayContainer) {
      const containerWidth = this.overlayContainer.nativeElement.clientWidth;
      const containerHeight = this.overlayContainer.nativeElement.clientHeight;
      const canvasWidth = this.studioSettings.overlayWidth() || 1920;
      const canvasHeight = this.studioSettings.overlayHeight() || 1080;

      if (containerWidth > 0 && containerHeight > 0) {
        const scaleX = containerWidth / canvasWidth;
        const scaleY = containerHeight / canvasHeight;
        this.overlayFitScale.set(Math.min(scaleX, scaleY));
      }
    }
  }

  toggleOverlayLock() {
    this.isOverlayLocked.update(v => !v);
  }

  onOverlayPointerDown(event: PointerEvent, mode: 'DRAGGING' | 'RESIZING', target: 'OVERLAY' | 'SCOREBOARD' | 'MEDIA' = 'OVERLAY') {
    if (this.isOverlayLocked()) return;
    event.stopPropagation();

    this.activePointers.set(event.pointerId, event);
    this.currentTarget = target;

    if (this.activePointers.size === 1) {
      this.currentMode = mode;
      this.startPointerPos = { x: event.clientX, y: event.clientY };

      if (target === 'OVERLAY') {
        this.startOverlayPos = {
          x: this.studioSettings.overlayLeft(),
          y: this.studioSettings.overlayTop(),
          scale: this.studioSettings.overlayScale(),
          width: this.studioSettings.overlayWidth(),
          height: this.studioSettings.overlayHeight()
        };
      } else if (target === 'SCOREBOARD') {
        this.startOverlayPos = {
          x: this.studioSettings.scoreboardLeft(),
          y: this.studioSettings.scoreboardTop(),
          scale: this.studioSettings.scoreboardScale(),
          width: this.studioSettings.scoreboardWidth(),
          height: this.studioSettings.scoreboardHeight()
        };
      } else if (target === 'MEDIA') {
        this.startOverlayPos = {
          x: this.studioSettings.mediaLeft(),
          y: this.studioSettings.mediaTop(),
          scale: this.studioSettings.mediaScale(),
          width: this.studioSettings.mediaWidth(),
          height: this.studioSettings.mediaHeight()
        };
      }
    } else if (this.activePointers.size === 2) {
      this.currentMode = 'PINCHING';
      const pointers = Array.from(this.activePointers.values());
      this.initialPinchDist = this.getDistance(pointers[0], pointers[1]);
      if (target === 'OVERLAY') this.initialOverlayScale = this.studioSettings.overlayScale();
      else if (target === 'SCOREBOARD') this.initialOverlayScale = this.studioSettings.scoreboardScale();
      else if (target === 'MEDIA') this.initialOverlayScale = this.studioSettings.mediaScale();
    }

    const moveHandler = (e: PointerEvent) => this.onOverlayPointerMove(e);
    const stopHandler = (e: PointerEvent) => {
      this.activePointers.delete(e.pointerId);
      if (this.activePointers.size === 0) {
        this.currentMode = 'NONE';
        this.studioSettings.save();
        window.removeEventListener('pointermove', moveHandler);
        window.removeEventListener('pointerup', stopHandler);
        window.removeEventListener('pointercancel', stopHandler);
      }
    };

    window.addEventListener('pointermove', moveHandler, { passive: false });
    window.addEventListener('pointerup', stopHandler);
    window.addEventListener('pointercancel', stopHandler);
  }

  private onOverlayPointerMove(event: PointerEvent) {
    if (this.currentMode === 'NONE') return;
    event.preventDefault(); // Prevent accidental scroll/zoom
    this.activePointers.set(event.pointerId, event);

    if (this.currentMode === 'PINCHING' && this.activePointers.size === 2) {
      const pointers = Array.from(this.activePointers.values());
      const currentDist = this.getDistance(pointers[0], pointers[1]);
      if (this.initialPinchDist > 0) {
        const factor = currentDist / this.initialPinchDist;
        const newScale = Math.max(0.1, this.initialOverlayScale * factor);
        if (this.currentTarget === 'OVERLAY') {
          this.studioSettings.overlayScale.set(newScale);
        } else if (this.currentTarget === 'SCOREBOARD') {
          this.studioSettings.scoreboardScale.set(newScale);
        } else if (this.currentTarget === 'MEDIA') {
          this.studioSettings.mediaScale.set(newScale);
        }
      }
      return;
    }

    const dx = (event.clientX - this.startPointerPos.x) / this.overlayFitScale();
    const dy = (event.clientY - this.startPointerPos.y) / this.overlayFitScale();

    if (this.currentMode === 'DRAGGING') {
      if (this.currentTarget === 'OVERLAY') {
        this.studioSettings.overlayLeft.set(this.startOverlayPos.x + dx);
        this.studioSettings.overlayTop.set(this.startOverlayPos.y + dy);
      } else if (this.currentTarget === 'SCOREBOARD') {
        this.studioSettings.scoreboardLeft.set(this.startOverlayPos.x + dx);
        this.studioSettings.scoreboardTop.set(this.startOverlayPos.y + dy);
      } else if (this.currentTarget === 'MEDIA') {
        this.studioSettings.mediaLeft.set(this.startOverlayPos.x + dx);
        this.studioSettings.mediaTop.set(this.startOverlayPos.y + dy);
      }
    } else if (this.currentMode === 'RESIZING') {
      // For resizing width/height, we also account for the current scale
      const currentScale = this.startOverlayPos.scale;
      const normalizedDx = dx / currentScale;
      const normalizedDy = dy / currentScale;

      const newWidth = Math.max(100, this.startOverlayPos.width + normalizedDx);
      const newHeight = Math.max(20, this.startOverlayPos.height + normalizedDy);

      if (this.currentTarget === 'OVERLAY') {
        this.studioSettings.overlayWidth.set(Math.round(newWidth));
        this.studioSettings.overlayHeight.set(Math.round(newHeight));
      } else if (this.currentTarget === 'SCOREBOARD') {
        this.studioSettings.scoreboardWidth.set(Math.round(newWidth));
        this.studioSettings.scoreboardHeight.set(Math.round(newHeight));
      } else if (this.currentTarget === 'MEDIA') {
        this.studioSettings.mediaWidth.set(Math.round(newWidth));
        this.studioSettings.mediaHeight.set(Math.round(newHeight));
      }
    }
  }

  private getDistance(p1: PointerEvent, p2: PointerEvent): number {
    const dx = p1.clientX - p2.clientX;
    const dy = p1.clientY - p2.clientY;
    return Math.sqrt(dx * dx + dy * dy);
  }

  centerOverlay(target: 'OVERLAY' | 'SCOREBOARD' | 'MEDIA') {
    if (target === 'OVERLAY') {
      this.studioSettings.overlayLeft.set((1920 - this.studioSettings.overlayWidth()) / 2);
      this.studioSettings.overlayTop.set((1080 - this.studioSettings.overlayHeight()) / 2);
    } else if (target === 'SCOREBOARD') {
      this.studioSettings.scoreboardLeft.set((1920 - this.studioSettings.scoreboardWidth()) / 2);
      this.studioSettings.scoreboardTop.set((1080 - this.studioSettings.scoreboardHeight()) / 2);
    } else if (target === 'MEDIA') {
      this.studioSettings.mediaLeft.set((1920 - this.studioSettings.mediaWidth()) / 2);
      this.studioSettings.mediaTop.set((1080 - this.studioSettings.mediaHeight()) / 2);
    }
    this.studioSettings.save();
  }

  switchCamera(id: string) {
    this.previewCameraId.set(id);
    this.takeLive(id);
  }

  switchMedia() {
    this.previewCameraId.set('MEDIA');
    this.activeCameraId.set('MEDIA');
    this.activeStream.set(null);
  }

  removeMedia() {
    this.studioSettings.mediaUrl.set('');
    this.mediaType.set('none');
    if (this.activeCameraId() === 'MEDIA') {
      const firstCam = this.cameras()[0];
      if (firstCam) this.switchCamera(firstCam.id);
      else this.activeCameraId.set(null);
    }
    this.studioSettings.save();
  }

  openMediaPicker() {
    this.mediaPicker.nativeElement.click();
  }

  onMediaFileSelected(event: any) {
    const file = event.target.files[0];
    if (!file) return;

    const url = URL.createObjectURL(file);
    this.studioSettings.mediaUrl.set(url);
    
    if (file.type.startsWith('image/')) {
      this.mediaType.set('image');
    } else if (file.type.startsWith('video/')) {
      this.mediaType.set('video');
    }
    
    this.switchMedia();
  }

  takeLive(targetId?: string) {
    const id = targetId || this.previewCameraId();
    if (!id) return;

    this.activeCameraId.set(id);
    const cam = this.cameras().find(c => c.id === id);
    if (cam && this.mainVideo) {
      this.activeStream.set(cam.stream);
      this.setupAudioAnalysis(cam.stream);
      // Ensure playback starts
      setTimeout(() => {
        this.mainVideo.nativeElement.play().catch(e => console.warn('Autoplay blocked:', e));
      }, 100);
    }
  }

  private setupAudioAnalysis(stream: MediaStream) {
    if (!this.audioCtx) {
      this.audioCtx = new AudioContext();
    }

    if (this.audioCtx.state === 'suspended') {
      this.audioCtx.resume();
    }

    const source = this.audioCtx.createMediaStreamSource(stream);
    this.analyzer = this.audioCtx.createAnalyser();
    this.analyzer.fftSize = 256;
    source.connect(this.analyzer);

    const dataArray = new Uint8Array(this.analyzer.frequencyBinCount);

    const updateVolume = () => {
      if (!this.analyzer) return;
      this.analyzer.getByteFrequencyData(dataArray);
      let sum = 0;
      for (let i = 0; i < dataArray.length; i++) {
        sum += dataArray[i];
      }
      const average = sum / dataArray.length;
      this.volumeLevel.set(Math.min(100, (average / 128) * 100));
      this.animationFrameId = requestAnimationFrame(updateVolume);
    };

    if (this.animationFrameId) cancelAnimationFrame(this.animationFrameId);
    updateVolume();
  }

  async startRtmp() {
    alert('Direct P2P Streaming is active. Use OBS on this device to capture the Program View for RTMP streaming.');
  }

  async copyInviteLink() {
    try {
      await navigator.clipboard.writeText(this.shareUrl());
      alert('Invite link copied! Open this on your mobile device.');
    } catch (err) {
      console.error('Copy failed:', err);
    }
  }

  async testSignaling() {
    console.log('[Test] Sending dummy signal to self...');
    const peerId = this.streamingService.getPeerId();
    await this.streamingService['signaling'].sendSignal(peerId, 'test-ping', { time: Date.now() });
  }

  async retrySignaling() {
    const roomId = this.route.snapshot.paramMap.get('id');
    if (roomId) {
      await this.streamingService.init(roomId, 'CONTROLLER');
    }
  }
}
