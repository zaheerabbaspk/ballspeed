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
      if (supabaseUrl.includes('your-project-url')) {
        console.warn('Supabase URL not configured correctly.');
        return;
      }
      this.supabase = createClient(supabaseUrl, supabaseKey);
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
    if (!this.supabase) return;
    const { error } = await this.supabase
      .from('signals')
      .insert({
        room_id: this.currentRoomId,
        from_peer_id: this.peerId,
        to_peer_id: toPeerId,
        type: type,
        data: data
      });
    
    if (error) {
      console.error('Error sending signal:', error);
      alert('Signaling Error: ' + error.message + '\nCheck if RLS is disabled on the "signals" table.');
    }
  }

  getPeerId() { return this.peerId; }
}
