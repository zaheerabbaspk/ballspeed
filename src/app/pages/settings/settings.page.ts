import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonContent, IonHeader, IonTitle, IonToolbar, IonIcon, IonButton, ModalController } from '@ionic/angular/standalone';
import { SettingsService } from '../../services/settings.service';
import { addIcons } from 'ionicons';
import { 
  radioOutline, 
  layersOutline, 
  videocamOutline, 
  gridOutline, 
  globeOutline, 
  closeOutline, 
  saveOutline 
} from 'ionicons/icons';

@Component({
  selector: 'app-settings',
  templateUrl: './settings.page.html',
  styleUrls: ['./settings.page.scss'],
  standalone: true,
  imports: [
    IonContent, 
    IonIcon, 
    CommonModule, 
    FormsModule
  ]
})
export class SettingsPage implements OnInit {
  activeTab = 'stream';
  
  rtmpUrl = '';
  rtmpKey = '';
  gatewayUrl = '';
  showOverlay = false;
  overlayWidth = 1920;
  overlayHeight = 1080;
  overlayUrl = '';
  overlayOpacity = 1;
  overlayScale = 1;
  scoreboardId = '';
  scoreboardOperator = '11';
  mediaUrl = '';

  constructor(
    private settingsService: SettingsService,
    private modalCtrl: ModalController
  ) {
    addIcons({ 
      radioOutline, 
      layersOutline, 
      videocamOutline, 
      gridOutline, 
      globeOutline, 
      closeOutline, 
      saveOutline 
    });
  }

  ngOnInit() {
    this.rtmpUrl = this.settingsService.rtmpUrl();
    this.rtmpKey = this.settingsService.rtmpKey();
    this.gatewayUrl = this.settingsService.gatewayUrl();
    this.showOverlay = this.settingsService.showOverlay();
    this.overlayWidth = this.settingsService.overlayWidth();
    this.overlayHeight = this.settingsService.overlayHeight();
    this.overlayUrl = this.settingsService.overlayUrl();
    this.overlayOpacity = this.settingsService.overlayOpacity();
    this.overlayScale = this.settingsService.overlayScale();
    this.scoreboardId = this.settingsService.scoreboardId();
    this.scoreboardOperator = this.settingsService.scoreboardOperator();
    this.mediaUrl = this.settingsService.mediaUrl();
  }

  close() {
    this.modalCtrl.dismiss();
  }

  save() {
    this.settingsService.rtmpUrl.set(this.rtmpUrl);
    this.settingsService.rtmpKey.set(this.rtmpKey);
    this.settingsService.gatewayUrl.set(this.gatewayUrl);
    this.settingsService.showOverlay.set(this.showOverlay);
    this.settingsService.overlayWidth.set(this.overlayWidth);
    this.settingsService.overlayHeight.set(this.overlayHeight);
    this.settingsService.overlayUrl.set(this.overlayUrl);
    this.settingsService.overlayOpacity.set(this.overlayOpacity);
    this.settingsService.overlayScale.set(this.overlayScale);
    this.settingsService.scoreboardId.set(this.scoreboardId);
    this.settingsService.scoreboardOperator.set(this.scoreboardOperator);
    this.settingsService.mediaUrl.set(this.mediaUrl);
    this.settingsService.save();
    this.modalCtrl.dismiss();
  }
}
