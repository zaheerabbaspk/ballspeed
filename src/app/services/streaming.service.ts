import { Injectable } from '@angular/core';
import { SignalingService } from './signaling.service';
import { Subject } from 'rxjs';
import { Camera } from '@capacitor/camera';
import { Capacitor } from '@capacitor/core';

@Injectable({
  providedIn: 'root'
})
export class StreamingService {
  private peerConnections: Map<string, RTCPeerConnection> = new Map();
  public remoteStream$ = new Subject<{ peerId: string, stream: MediaStream }>();
  public connectionState$ = new Subject<{ peerId: string, state: string }>();
  private localStream: MediaStream | null = null;
  private candidateQueue: Map<string, RTCIceCandidateInit[]> = new Map();

  private rtcConfig: RTCConfiguration = {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
      { urls: 'stun:stun2.l.google.com:19302' }
    ]
  };

  constructor(private signaling: SignalingService) {}

  async init(roomId: string, customPeerId?: string) {
    console.log('[StreamingService] Initializing for room:', roomId, 'as:', customPeerId || 'RANDOM');
    await this.signaling.joinRoom(roomId, customPeerId);
    
    this.signaling.message$.subscribe(async (msg) => {
      const { from_peer_id, type, data } = msg;
      console.log('[StreamingService] Received signal:', type, 'from:', from_peer_id);

      switch (type) {
        case 'offer':
          await this.handleOffer(from_peer_id, data);
          break;
        case 'answer':
          await this.handleAnswer(from_peer_id, data);
          break;
        case 'candidate':
          await this.handleCandidate(from_peer_id, data);
          break;
      }
    });
  }

  /**
   * Called by the CAMERA to start sending video to the controller
   */
  async startProducing(targetPeerId: string = 'CONTROLLER') {
    try {
      // Request native permissions first if on mobile
      await this.requestNativePermissions();

      console.log('[StreamingService] Requesting local camera/mic...');
      this.localStream = await navigator.mediaDevices.getUserMedia({ 
        video: { 
          width: { ideal: 1280 }, 
          height: { ideal: 720 }, 
          frameRate: { ideal: 30 },
          facingMode: { ideal: 'environment' }
        }, 
        audio: true 
      });

      console.log('[StreamingService] Creating offer to:', targetPeerId);
      const pc = this.createPeer(targetPeerId);
      this.localStream.getTracks().forEach(track => {
        pc.addTrack(track, this.localStream!);
      });

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      
      await this.signaling.sendSignal(targetPeerId, 'offer', offer);
      return this.localStream;
    } catch (err) {
      console.error('[StreamingService] Error in startProducing:', err);
      throw err;
    }
  }

  private async handleOffer(from: string, offer: RTCSessionDescriptionInit) {
    console.log('[StreamingService] Handling offer from:', from);
    const pc = this.createPeer(from);
    await pc.setRemoteDescription(new RTCSessionDescription(offer));
    
    // Process queued candidates
    const queue = this.candidateQueue.get(from) || [];
    for (const cand of queue) {
      await pc.addIceCandidate(new RTCIceCandidate(cand));
    }
    this.candidateQueue.delete(from);

    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    
    await this.signaling.sendSignal(from, 'answer', answer);
  }

  private async handleAnswer(from: string, answer: RTCSessionDescriptionInit) {
    console.log('[StreamingService] Handling answer from:', from);
    const pc = this.peerConnections.get(from);
    if (pc) {
      await pc.setRemoteDescription(new RTCSessionDescription(answer));
    }
  }

  private async handleCandidate(from: string, candidate: RTCIceCandidateInit) {
    console.log('[StreamingService] Handling ICE candidate from:', from);
    const pc = this.peerConnections.get(from);
    if (pc && pc.remoteDescription) {
      await pc.addIceCandidate(new RTCIceCandidate(candidate));
    } else {
      console.log('[StreamingService] Queuing candidate for:', from);
      const queue = this.candidateQueue.get(from) || [];
      queue.push(candidate);
      this.candidateQueue.set(from, queue);
    }
  }

  private createPeer(peerId: string): RTCPeerConnection {
    // Cleanup existing connection for this peer
    const oldPc = this.peerConnections.get(peerId);
    if (oldPc) {
      console.log('[StreamingService] Closing old connection for:', peerId);
      oldPc.close();
    }

    console.log('[StreamingService] Creating RTCPeerConnection for:', peerId);
    const pc = new RTCPeerConnection(this.rtcConfig);
    this.peerConnections.set(peerId, pc);

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        this.signaling.sendSignal(peerId, 'candidate', event.candidate);
      }
    };

    pc.ontrack = (event) => {
      console.log('[StreamingService] Got remote track from:', peerId);
      if (event.streams && event.streams[0]) {
        this.remoteStream$.next({ peerId, stream: event.streams[0] });
      }
    };

    pc.onconnectionstatechange = () => {
      console.log(`[StreamingService] ${peerId} state: ${pc.connectionState}`);
      this.connectionState$.next({ peerId, state: pc.connectionState });
      if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected') {
        this.peerConnections.delete(peerId);
      }
    };

    return pc;
  }

  getPeerId() { return this.signaling.getPeerId(); }

  private async requestNativePermissions() {
    if (Capacitor.isNativePlatform()) {
      try {
        const permissions = await Camera.requestPermissions();
        console.log('[StreamingService] Native Permissions:', permissions);
        if (permissions.camera !== 'granted') {
          throw new Error('Camera permission not granted on device.');
        }
      } catch (err) {
        console.error('[StreamingService] Native Permission Error:', err);
        throw err;
      }
    }
  }
}
