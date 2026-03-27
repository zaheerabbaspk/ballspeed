import { Injectable } from '@angular/core';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { Subject } from 'rxjs';
import { environment } from '../../environments/environment';

@Injectable({
  providedIn: 'root'
})
export class SignalingService {
  private supabase: SupabaseClient | null = null;
  public message$ = new Subject<any>();
  public status$ = new Subject<string>();
  private currentRoomId: string | null = null;
  private peerId: any = self.crypto.randomUUID();

  constructor() {
    try {
      const { supabaseUrl, supabaseKey } = environment;
      console.log('[Signaling] Initializing with URL:', supabaseUrl);
      if (supabaseUrl.includes('your-project-url')) {
        console.warn('Supabase URL not configured correctly.');
        return;
      }
      this.supabase = createClient(supabaseUrl, supabaseKey, {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
          detectSessionInUrl: false
        }
      });
      console.log('[Signaling] Supabase client created (Lock-free mode)');
    } catch (e) {
      console.error('Supabase init error:', e);
    }
  }

  async joinRoom(roomId: string, customPeerId?: string) {
    if (!this.supabase) {
      console.error('Supabase client not initialized. Cannot join room.');
      return;
    }
    if (customPeerId) this.peerId = customPeerId;
    this.currentRoomId = roomId;

    // Listen for new rows in the 'signals' table for this room
    this.supabase
      .channel('public:signals')
      .on('postgres_changes', { 
        event: 'INSERT', 
        schema: 'public', 
        table: 'signals',
        filter: `to_peer_id=eq.${this.peerId}` 
      }, payload => {
        const newMsg = payload.new as any;
        console.log('[Signaling] INCOMING:', newMsg.type, 'from:', newMsg.from_peer_id);
        if (newMsg['room_id'] === this.currentRoomId) {
          this.message$.next(newMsg);
        }
      })
      .subscribe((status) => {
        console.log('[Signaling] Channel status:', status);
        this.status$.next(status);
      });
  }

  async sendSignal(toPeerId: string, type: string, data: any) {
    // Try Local Socket first if available (via MediasoupService's socket)
    // For now, we'll stick to Supabase but add better error handling
    if (!this.supabase) return;
    try {
      const { error } = await this.supabase
        .from('signals')
        .insert({
          room_id: this.currentRoomId,
          from_peer_id: this.peerId,
          to_peer_id: toPeerId,
          type: type,
          data: data
        });
      
      if (error) throw error;
    } catch (error: any) {
      console.warn('[Signaling] Supabase failed, check internet or project status:', error.message);
      // Fallback is needed here if we had a socket reference
    }
  }

  getPeerId() { return this.peerId; }
}
