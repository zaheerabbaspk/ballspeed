import { Injectable, signal } from '@angular/core';
import { environment } from '../../environments/environment';

@Injectable({
  providedIn: 'root'
})
export class SettingsService {
  rtmpUrl = signal<string>('rtmps://live-api-s.facebook.com:443/rtmp/');
  rtmpKey = signal<string>('');
  gatewayUrl = signal<string>(environment.gatewayUrl);
  overlayUrl = signal<string>('');
  mediaUrl = signal<string>('');
  showOverlay = signal<boolean>(false);
  overlayOpacity = signal<number>(1);
  overlayScale = signal<number>(1);
  overlayWidth = signal<number>(1920);
  overlayHeight = signal<number>(1080);
  overlayTop = signal<number>(0);
  overlayLeft = signal<number>(0);
  
  scoreboardId = signal<string>('');
  scoreboardOperator = signal<string>('11');
  scoreboardWidth = signal<number>(1600);
  scoreboardHeight = signal<number>(120);
  scoreboardTop = signal<number>(850);
  scoreboardLeft = signal<number>(160);
  scoreboardScale = signal<number>(1);

  // Media layer properties
  mediaTop = signal<number>(50);
  mediaLeft = signal<number>(50);
  mediaWidth = signal<number>(400);
  mediaHeight = signal<number>(300);
  mediaScale = signal<number>(1);
  
  // Storage keys
  private readonly RECOVERY_KEY = 'ballspeed_settings';

  constructor() {
    this.load();
  }

  save() {
    const data = {
      rtmpUrl: this.rtmpUrl(),
      rtmpKey: this.rtmpKey(),
      gatewayUrl: this.gatewayUrl(),
      overlayUrl: this.overlayUrl(),
      mediaUrl: this.mediaUrl(),
      showOverlay: this.showOverlay(),
      overlayOpacity: this.overlayOpacity(),
      overlayScale: this.overlayScale(),
      overlayWidth: this.overlayWidth(),
      overlayHeight: this.overlayHeight(),
      overlayTop: this.overlayTop(),
      overlayLeft: this.overlayLeft(),
      scoreboardId: this.scoreboardId(),
      scoreboardOperator: this.scoreboardOperator(),
      scoreboardWidth: this.scoreboardWidth(),
      scoreboardHeight: this.scoreboardHeight(),
      scoreboardTop: this.scoreboardTop(),
      scoreboardLeft: this.scoreboardLeft(),
      scoreboardScale: this.scoreboardScale(),
      mediaTop: this.mediaTop(),
      mediaLeft: this.mediaLeft(),
      mediaWidth: this.mediaWidth(),
      mediaHeight: this.mediaHeight(),
      mediaScale: this.mediaScale()
    };
    localStorage.setItem(this.RECOVERY_KEY, JSON.stringify(data));
  }

  private load() {
    const saved = localStorage.getItem(this.RECOVERY_KEY);
    if (saved) {
      try {
        const data = JSON.parse(saved);
        this.rtmpUrl.set(data.rtmpUrl || '');
        this.rtmpKey.set(data.rtmpKey || '');
        let gateway = data.gatewayUrl || environment.gatewayUrl;
        if (gateway.includes('localhost:3000')) {
          gateway = environment.gatewayUrl;
        }
        this.gatewayUrl.set(gateway);
        this.overlayUrl.set(data.overlayUrl || '');
        this.mediaUrl.set(data.mediaUrl || '');
        this.showOverlay.set(data.showOverlay || false);
        this.overlayOpacity.set(data.overlayOpacity ?? 1);
        this.overlayScale.set(data.overlayScale ?? 1);
        this.overlayWidth.set(data.overlayWidth ?? 1920);
        this.overlayHeight.set(data.overlayHeight ?? 1080);
        this.overlayTop.set(data.overlayTop ?? 0);
        this.overlayLeft.set(data.overlayLeft ?? 0);
        this.scoreboardId.set(data.scoreboardId || '');
        this.scoreboardOperator.set(data.scoreboardOperator || '11');
        this.scoreboardWidth.set(data.scoreboardWidth ?? 1800);
        this.scoreboardHeight.set(data.scoreboardHeight ?? 120);
        this.scoreboardTop.set(data.scoreboardTop ?? 850);
        this.scoreboardLeft.set(data.scoreboardLeft ?? 60);
        this.scoreboardScale.set(data.scoreboardScale ?? 1);
        this.mediaTop.set(data.mediaTop ?? 50);
        this.mediaLeft.set(data.mediaLeft ?? 50);
        this.mediaWidth.set(data.mediaWidth ?? 400);
        this.mediaHeight.set(data.mediaHeight ?? 300);
        this.mediaScale.set(data.mediaScale ?? 1);
      } catch (e) {
        console.error('Failed to load settings:', e);
      }
    }
  }
}
