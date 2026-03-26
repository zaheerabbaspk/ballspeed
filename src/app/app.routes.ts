import { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: '',
    loadComponent: () => import('./pages/landing/landing.page').then((m) => m.LandingPage),
  },
  {
    path: 'room/:id/camera',
    loadComponent: () => import('./pages/camera/camera.page').then((m) => m.CameraPage),
  },
  {
    path: 'room/:id/controller',
    loadComponent: () => import('./pages/controller/controller.page').then((m) => m.ControllerPage),
  },
  {
    path: 'settings',
    loadComponent: () => import('./pages/settings/settings.page').then( m => m.SettingsPage)
  },
];
