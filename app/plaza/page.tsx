'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase/client';

type ParticipantRow = { user_id: string; display_name: string; joined_at: string };
type PostRow = {
  id: string;
  topic: string;
  mode: 'duo' | 'group';
  max_seats: number;
  status: string;
  post_participants: ParticipantRow[];
};
type HistoryRow = {
  id: string;
  topic: string;
  partners: string[];
  rating: number | null;
  ended_at: string;
};

const TOPICS = [
  'Is free will an illusion?',
  'Is morality objective or invented?',
  'Would you plug into an experience machine?',
  'Does life need meaning imposed from outside?',
  'Is it ever right to lie for kindness?',
  'Are we living in a simulation?',
  'Should personal identity survive teleportation?',
  'Is suffering ever justified for the greater good?',
  'Can a good end justify bad means?',
  'Is total honesty always the right policy?',
];

function seatCluster(filled: number, total: number) {
  const dots = [];
  const r = 19,
    cx = 26,
    cy = 26;
  for (let i = 0; i < total; i++) {
    const angle = (2 * Math.PI * i) / total - Math.PI / 2;
    const x = cx + r * Math.cos(angle) - 5.5;
    const y = cy + r * Math.sin(angle) - 5.5;
    dots.push(
      <div
        key={i}
        className={'seat-dot' + (i < filled ? ' filled' : '')}
        style={{ left: x, top: y }}
      />
    );
  }
  return <div className="seat-cluster">{dots}</div>;
}

export default function PlazaPage() {
  const router = useRouter();
  const [myId, setMyId] = useState<string | null>(null);
  const [myName, setMyName] = useState('');
  const [posts, setPosts] = useState<PostRow[]>([]);
  const [history, setHistory] = useState<HistoryRow[]>([]);
  const [topic, setTopic] = useState('');
  const [mode, setMode] = useState<'duo' | 'group'>('duo');
  const [busy, setBusy] = useState(false);
  const channelRef = useRef<any>(null);

  const refresh = useCallback(async () => {
    const { data, error } = await supabase
      .from('posts')
      .select('id, topic, mode, max_seats, status, post_participants(user_id, display_name, joined_at)')
      .eq('status', 'open')
      .order('created_at', { ascending: false });
    if (error) {
      console.error(error);
      return;
    }
    const open = (data as any as PostRow[]).filter((p) => p.post_participants.length < p.max_seats);
    setPosts(open);
  }, []);

  const refreshHistory = useCallback(async (userId: string) => {
    const { data, error } = await supabase
      .from('session_history')
      .select('id, topic, partners, rating, ended_at')
      .eq('user_id', userId)
      .order('ended_at', { ascending: false })
      .limit(8);
    if (!error && data) setHistory(data as HistoryRow[]);
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function boot() {
      const { data } = await supabase.auth.getUser();
      if (!data.user) {
        router.push('/');
        return;
      }
      if (cancelled) return;
      setMyId(data.user.id);
      setMyName(localStorage.getItem('agora_name') || 'Someone');
      await refresh();
      await refreshHistory(data.user.id);

      const channel = supabase
        .channel('plaza-updates')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'posts' }, () => refresh())
        .on('postgres_changes', { event: '*', schema: 'public', table: 'post_participants' }, () => refresh())
        .subscribe();
      channelRef.current = channel;
    }
    boot();
    return () => {
      cancelled = true;
      if (channelRef.current) supabase.removeChannel(channelRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function createPost() {
    const trimmed = topic.trim();
    if (!trimmed || !myId) return;
    setBusy(true);
    try {
      const maxSeats = mode === 'duo' ? 2 : 5;
      const { data: post, error } = await supabase
        .from('posts')
        .insert({ topic: trimmed, mode, max_seats: maxSeats, host_id: myId })
        .select()
        .single();
      if (error || !post) throw error;

      const { error: joinError } = await supabase
        .from('post_participants')
        .insert({ post_id: post.id, user_id: myId, display_name: myName });
      if (joinError) throw joinError;

      router.push(`/room/${post.id}`);
    } catch (e: any) {
      alert(e?.message || "Couldn't open that conversation — try again.");
    } finally {
      setBusy(false);
    }
  }

  async function joinPost(postId: string) {
    if (!myId) return;
    setBusy(true);
    try {
      const { error } = await supabase
        .from('post_participants')
        .insert({ post_id: postId, user_id: myId, display_name: myName });
      if (error) throw error;
      router.push(`/room/${postId}`);
    } catch (e: any) {
      alert(e?.message || 'That seat just filled up — try another conversation.');
      refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="app">
      <div className="wordmark">
        <h1>
          Agora Online<span className="accentdot">.</span>
        </h1>
        <div className="tag">live conversation, no script</div>
      </div>

      <div className="lobby-head">
        <h2>What&apos;s being discussed</h2>
        <div className="who">
          you&apos;re {myName} ·{' '}
          <a
            href="#"
            onClick={(e) => {
              e.preventDefault();
              router.push('/');
            }}
          >
            not you?
          </a>
        </div>
      </div>

      <div className="board">
        {posts.length === 0 && (
          <div className="empty-board">
            <strong>The plaza is quiet.</strong>
            Open the floor on something below and see who wanders over.
          </div>
        )}
        {posts.map((p) => {
          const iAmIn = p.post_participants.some((pt) => pt.user_id === myId);
          const names = p.post_participants.map((pt) => pt.display_name).join(', ');
          return (
            <div className="post-card" key={p.id}>
              <div className="post-left">
                {seatCluster(p.post_participants.length, p.max_seats)}
                <div className="post-main">
                  <p className="post-topic">{p.topic}</p>
                  <div className="post-meta">
                    <span className={'mode-tag ' + p.mode}>{p.mode === 'duo' ? 'Duo' : 'Circle'}</span>
                    <span>{names}</span>
                    <span>
                      {p.post_participants.length}/{p.max_seats} seats
                    </span>
                  </div>
                </div>
              </div>
              <div className="post-side">
                {iAmIn ? (
                  <button className="btn btn-ghost" disabled>
                    you&apos;re in this one
                  </button>
                ) : (
                  <button className="btn btn-primary" disabled={busy} onClick={() => joinPost(p.id)}>
                    Take a seat
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <div className="new-post-panel">
        <h3>Start a conversation</h3>
        <p className="hint">Give it a topic. No need to declare a side — just show up curious.</p>

        <span className="field-label">Need an idea?</span>
        <div className="chips">
          {TOPICS.map((t) => (
            <button key={t} className="chip" type="button" onClick={() => setTopic(t)}>
              {t}
            </button>
          ))}
        </div>

        <div className="field-row">
          <span className="field-label">Topic</span>
          <input
            type="text"
            placeholder="e.g. Does free will exist?"
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
          />
        </div>

        <div className="field-row">
          <span className="field-label">Group size</span>
          <div className="mode-picker">
            <div
              className={'mode-card' + (mode === 'duo' ? ' selected' : '')}
              onClick={() => setMode('duo')}
            >
              <div className="m-icon">
                <div className="m-dot" style={{ left: 2, top: 8 }} />
                <div className="m-dot" style={{ left: 26, top: 8 }} />
              </div>
              <div className="m-title">Duo</div>
              <div className="m-desc">Just the two of you, one-on-one.</div>
            </div>
            <div
              className={'mode-card' + (mode === 'group' ? ' selected' : '')}
              onClick={() => setMode('group')}
            >
              <div className="m-icon">
                <div className="m-dot" style={{ left: 16, top: 0 }} />
                <div className="m-dot" style={{ left: 32, top: 10 }} />
                <div className="m-dot" style={{ left: 26, top: 24 }} />
                <div className="m-dot" style={{ left: 4, top: 24 }} />
                <div className="m-dot" style={{ left: 0, top: 10 }} />
              </div>
              <div className="m-title">Circle</div>
              <div className="m-desc">Up to five, open discussion.</div>
            </div>
          </div>
        </div>

        <button className="btn btn-primary" disabled={busy || !topic.trim()} onClick={createPost}>
          Open the floor
        </button>
      </div>

      {history.length > 0 && (
        <div className="history-section">
          <h3>Where you&apos;ve been</h3>
          <div>
            {history.map((h) => (
              <div className="history-item" key={h.id}>
                <div>
                  <div className="htopic">{h.topic}</div>
                  <div className="hmeta">
                    {h.partners?.length ? `with ${h.partners.join(', ')} · ` : ''}
                    {new Date(h.ended_at).toLocaleDateString()}
                  </div>
                </div>
                <div className="hmeta">{'★'.repeat(h.rating || 0)}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
