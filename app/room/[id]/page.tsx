'use client';

import { useEffect, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase/client';
import { getIceServers, hasTurnConfigured } from '@/lib/iceServers';

type Participant = { id: string; name: string; joinedAt: number };
type PostRow = {
  id: string;
  topic: string;
  mode: 'duo' | 'group';
  max_seats: number;
  status: string;
  started_at: string | null;
  duration_minutes: number;
  extended_minutes: number;
};
type PeerEntry = { pc: RTCPeerConnection; isCaller: boolean; answerApplied: boolean };

export default function RoomPage() {
  const params = useParams<{ id: string }>();
  const postId = params.id;
  const router = useRouter();

  const [post, setPost] = useState<PostRow | null>(null);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [connText, setConnText] = useState('requesting camera & microphone…');
  const [live, setLive] = useState(false);
  const [error, setError] = useState('');
  const [timerText, setTimerText] = useState('30:00');
  const [overtime, setOvertime] = useState(false);
  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(true);
  const [showWrapup, setShowWrapup] = useState(false);
  const [wrapupSummary, setWrapupSummary] = useState('');
  const [stars, setStars] = useState(0);
  const [reflection, setReflection] = useState('');

  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const videoRefs = useRef<Record<string, HTMLVideoElement | null>>({});
  const localStreamRef = useRef<MediaStream | null>(null);
  const peersRef = useRef<Record<string, PeerEntry>>({});
  const roomChannelRef = useRef<any>(null);
  const postChannelRef = useRef<any>(null);
  const myIdRef = useRef<string | null>(null);
  const myNameRef = useRef<string>('Someone');
  const postRef = useRef<PostRow | null>(null);
  const partnerNamesRef = useRef<string[]>([]);

  useEffect(() => {
    postRef.current = post;
  }, [post]);

  // ---------- boot ----------
  useEffect(() => {
    let cancelled = false;

    async function boot() {
      const { data: userData } = await supabase.auth.getUser();
      if (!userData.user) {
        router.push('/');
        return;
      }
      const userId = userData.user.id;
      const name = localStorage.getItem('agora_name') || 'Someone';
      myIdRef.current = userId;
      myNameRef.current = name;

      const { data: postData, error: postErr } = await supabase
        .from('posts')
        .select('*')
        .eq('id', postId)
        .single();
      if (postErr || !postData) {
        router.push('/plaza');
        return;
      }
      if (cancelled) return;
      setPost(postData as PostRow);

      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        localStreamRef.current = stream;
        if (localVideoRef.current) localVideoRef.current.srcObject = stream;
      } catch (e) {
        setError(
          "We couldn't access your camera or microphone. Check your browser's permission icon in the address bar, allow access, then rejoin from the plaza."
        );
        setConnText('media blocked');
        return;
      }

      setupPostSubscription(userId);
      setupRoomChannel(userId, name);
    }

    boot();
    return () => {
      cancelled = true;
      cleanupAll();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [postId]);

  function setupPostSubscription(userId: string) {
    const ch = supabase
      .channel(`post-row-${postId}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'posts', filter: `id=eq.${postId}` },
        (payload: any) => setPost(payload.new as PostRow)
      )
      .subscribe();
    postChannelRef.current = ch;
  }

  function setupRoomChannel(userId: string, name: string) {
    const room = supabase.channel(`room-${postId}`, { config: { presence: { key: userId } } });

    room.on('presence', { event: 'sync' }, () => {
      const state = room.presenceState() as Record<string, any[]>;
      const list: Participant[] = Object.entries(state).map(([key, metas]) => {
        const meta: any = metas[0];
        return { id: key, name: meta.name, joinedAt: meta.joinedAt };
      });
      setParticipants(list);
      partnerNamesRef.current = list.filter((p) => p.id !== userId).map((p) => p.name);
      reconcilePeers(list, userId);
    });

    room.on('broadcast', { event: 'signal' }, ({ payload }: any) => {
      if (payload.to !== userId) return;
      handleSignal(payload, userId);
    });

    room.subscribe(async (status: string) => {
      if (status === 'SUBSCRIBED') {
        await room.track({ name, joinedAt: Date.now() });
      }
    });

    roomChannelRef.current = room;
  }

  function reconcilePeers(list: Participant[], userId: string) {
    const me = list.find((p) => p.id === userId);
    if (!me) return;

    list.forEach((p) => {
      if (p.id === userId) return;
      if (!peersRef.current[p.id]) {
        const isCaller = p.joinedAt < me.joinedAt || (p.joinedAt === me.joinedAt && p.id < userId);
        createPeerConnection(p.id, isCaller, userId);
      }
    });

    Object.keys(peersRef.current).forEach((pid) => {
      if (!list.some((p) => p.id === pid)) {
        try {
          peersRef.current[pid].pc.close();
        } catch (e) {}
        delete peersRef.current[pid];
      }
    });

    const connectedCount = Object.values(peersRef.current).filter(
      (p: PeerEntry) => p.pc.connectionState === 'connected'
    ).length;
    if (list.length < 2) {
      setLive(false);
      setConnText('waiting for someone to join…');
    } else if (connectedCount > 0) {
      setLive(true);
      setConnText(`live · ${list.length} here`);
    } else {
      setLive(false);
      setConnText('connecting…');
    }
  }

  async function createPeerConnection(peerId: string, isCaller: boolean, userId: string) {
    const pc = new RTCPeerConnection({ iceServers: getIceServers() });
    peersRef.current[peerId] = { pc, isCaller, answerApplied: false };

    localStreamRef.current?.getTracks().forEach((t) => pc.addTrack(t, localStreamRef.current as MediaStream));

    pc.ontrack = (ev) => {
      const v = videoRefs.current[peerId];
      if (v) v.srcObject = ev.streams[0];
    };

    pc.onicecandidate = (ev) => {
      if (ev.candidate) {
        roomChannelRef.current?.send({
          type: 'broadcast',
          event: 'signal',
          payload: { kind: 'ice', from: userId, to: peerId, candidate: ev.candidate.toJSON() },
        });
      }
    };

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'connected') {
        setLive(true);
        setConnText(`live · ${participants.length} here`);
      }
      if (pc.connectionState === 'failed') {
        setError(
          `Couldn't establish a direct video connection with someone in this room. This can happen on networks that block peer-to-peer traffic${
            hasTurnConfigured ? '.' : ' — no TURN relay is configured for this deployment, which makes that more likely. See SETUP.md.'
          }`
        );
      }
    };

    if (isCaller) {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      roomChannelRef.current?.send({
        type: 'broadcast',
        event: 'signal',
        payload: { kind: 'offer', from: userId, to: peerId, sdp: offer },
      });
    }
  }

  async function handleSignal(payload: any, userId: string) {
    const peerId = payload.from;
    const entry = peersRef.current[peerId];
    if (!entry) return;
    const pc = entry.pc;

    if (payload.kind === 'offer') {
      await pc.setRemoteDescription(new RTCSessionDescription(payload.sdp));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      roomChannelRef.current?.send({
        type: 'broadcast',
        event: 'signal',
        payload: { kind: 'answer', from: userId, to: peerId, sdp: answer },
      });
    } else if (payload.kind === 'answer') {
      if (!entry.answerApplied) {
        await pc.setRemoteDescription(new RTCSessionDescription(payload.sdp));
        entry.answerApplied = true;
      }
    } else if (payload.kind === 'ice') {
      try {
        await pc.addIceCandidate(new RTCIceCandidate(payload.candidate));
      } catch (e) {}
    }
  }

  // ---------- timer ----------
  useEffect(() => {
    const tick = () => {
      const p = postRef.current;
      if (!p || !p.started_at) {
        setTimerText('30:00');
        setOvertime(false);
        return;
      }
      const totalMs = (p.duration_minutes + (p.extended_minutes || 0)) * 60000;
      const remaining = new Date(p.started_at).getTime() + totalMs - Date.now();
      if (remaining <= 0) {
        setTimerText('00:00');
        setOvertime(true);
      } else {
        const m = Math.floor(remaining / 60000)
          .toString()
          .padStart(2, '0');
        const s = Math.floor((remaining % 60000) / 1000)
          .toString()
          .padStart(2, '0');
        setTimerText(`${m}:${s}`);
        setOvertime(false);
      }
    };
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, [post]);

  async function extendTime() {
    const { error } = await supabase.rpc('extend_time', { p_post_id: postId });
    if (error) alert(error.message);
  }

  // ---------- controls ----------
  function toggleMic() {
    if (!localStreamRef.current) return;
    const next = !micOn;
    localStreamRef.current.getAudioTracks().forEach((t) => (t.enabled = next));
    setMicOn(next);
  }
  function toggleCam() {
    if (!localStreamRef.current) return;
    const next = !camOn;
    localStreamRef.current.getVideoTracks().forEach((t) => (t.enabled = next));
    setCamOn(next);
  }

  function cleanupAll() {
    Object.values(peersRef.current).forEach((p: PeerEntry) => {
      try {
        p.pc.close();
      } catch (e) {}
    });
    peersRef.current = {};
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((t) => t.stop());
      localStreamRef.current = null;
    }
    if (roomChannelRef.current) supabase.removeChannel(roomChannelRef.current);
    if (postChannelRef.current) supabase.removeChannel(postChannelRef.current);
  }

  async function leaveRoom() {
    const topic = postRef.current?.topic || '';
    const partners = partnerNamesRef.current;
    cleanupAll();

    const userId = myIdRef.current;
    if (userId) {
      await supabase.from('post_participants').delete().eq('post_id', postId).eq('user_id', userId);
    }

    setWrapupSummary(
      partners.length ? `You talked through "${topic}" with ${partners.join(', ')}.` : `You opened the floor on "${topic}".`
    );
    setStars(0);
    setReflection('');
    setShowWrapup(true);
  }

  async function finishWrapup() {
    const userId = myIdRef.current;
    const p = postRef.current;
    if (userId && p) {
      await supabase.from('session_history').insert({
        user_id: userId,
        topic: p.topic,
        mode: p.mode,
        partners: partnerNamesRef.current,
        rating: stars,
        reflection: reflection.trim() || null,
      });
    }
    router.push('/plaza');
  }

  const modeLabel = post?.mode === 'duo' ? 'Duo conversation' : 'Circle conversation';
  const stageClass = 'video-stage ' + (post?.mode === 'duo' ? 'mode-duo' : 'mode-group');
  const others = participants.filter((p) => p.id !== myIdRef.current);
  const openSeats = post ? Math.max(0, post.max_seats - participants.length) : 0;

  return (
    <div className="app">
      <div className="wordmark">
        <h1>
          Agora Online<span className="accentdot">.</span>
        </h1>
        <div className="tag">live conversation, no script</div>
      </div>

      <div className="room-head">
        <div className="room-topic-wrap">
          <div className="eyebrow">{modeLabel}</div>
          <h2 className="room-topic">{post?.topic || '—'}</h2>
          <div className="room-status">
            <span className={'dot' + (live ? ' live' : '')} />
            <span>{connText}</span>
          </div>
        </div>
        <div className="timer-panel">
          <div className={'timer-value' + (overtime ? ' overtime' : '')}>{timerText}</div>
          <div className="timer-caption">time remaining</div>
          <button className="btn btn-ghost btn-sm" onClick={extendTime}>
            +15 min
          </button>
        </div>
      </div>

      {overtime && post?.started_at && (
        <div className="overtime-banner">
          <span>Time&apos;s up — the conversation can keep going if you want it to.</span>
          <button className="btn btn-primary btn-sm" onClick={extendTime}>
            Add 15 more minutes
          </button>
        </div>
      )}

      {error && <div className="error-banner">{error}</div>}

      <div className={stageClass}>
        <div className="video-pane">
          <video ref={localVideoRef} autoPlay playsInline muted />
          <div className="video-label">you</div>
        </div>

        {others.map((p) => (
          <div className="video-pane" key={p.id}>
            <div className="video-placeholder" style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
              <div className="initial-badge">
                {p.name
                  .trim()
                  .split(/\s+/)
                  .map((w) => w[0])
                  .join('')
                  .slice(0, 2)
                  .toUpperCase()}
              </div>
              connecting to {p.name}…
            </div>
            <video
              ref={(el) => {
                videoRefs.current[p.id] = el;
              }}
              autoPlay
              playsInline
              onPlay={(e) => {
                const holder = (e.target as HTMLVideoElement).previousSibling as HTMLElement;
                if (holder) holder.style.display = 'none';
              }}
            />
            <div className="video-label">{p.name}</div>
          </div>
        ))}

        {post?.mode === 'group' &&
          Array.from({ length: openSeats }).map((_, i) => (
            <div className="video-pane empty-seat" key={'empty-' + i}>
              open seat
            </div>
          ))}
      </div>

      <div className="controls-row">
        <button className={'ctrl-btn' + (micOn ? '' : ' off')} onClick={toggleMic} title="Mute / unmute">
          🎙️
        </button>
        <button className={'ctrl-btn' + (camOn ? '' : ' off')} onClick={toggleCam} title="Camera on / off">
          📷
        </button>
        <button className="btn btn-coral" onClick={leaveRoom}>
          Leave the conversation
        </button>
      </div>

      {showWrapup && (
        <div className="wrapup-overlay">
          <div className="wrapup-box">
            <div className="eyebrow">Conversation over</div>
            <h2>How did that feel?</h2>
            <p>{wrapupSummary}</p>
            <div className="stars">
              {[1, 2, 3, 4, 5].map((v) => (
                <button key={v} className={'star' + (v <= stars ? ' on' : '')} onClick={() => setStars(v)}>
                  ★
                </button>
              ))}
            </div>
            <textarea
              placeholder="One line on what stuck with you (optional)"
              value={reflection}
              onChange={(e) => setReflection(e.target.value)}
            />
            <div className="wrapup-actions">
              <button className="btn btn-primary" onClick={finishWrapup}>
                Back to the plaza
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
