import { Component, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonContent, IonIcon } from '@ionic/angular/standalone';
import { Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { addIcons } from 'ionicons';
import { videocam } from 'ionicons/icons';

@Component({
  selector: 'app-landing',
  templateUrl: './landing.page.html',
  styleUrls: ['./landing.page.scss'],
  standalone: true,
  imports: [IonContent, IonIcon, CommonModule, FormsModule]
})
export class LandingPage {
  roomId: string = '';
  
  constructor(private router: Router) {
    addIcons({ videocam });
  }

  createRoom() {
    const id = Math.random().toString(36).substring(2, 8).toUpperCase();
    this.router.navigate(['/room', id, 'controller']);
  }

  joinRoom() {
    if (this.roomId) {
      this.router.navigate(['/room', this.roomId, 'camera']);
    }
  }
}
