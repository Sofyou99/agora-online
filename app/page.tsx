'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase/client';

export default function HomePage() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const saved = typeof window !== 'undefined' ? localStorage.getItem('agora_name') : null;
    if (saved) setName(saved);
  }, []);

  async function enter() {
    const trimmed = name.trim();
    if (!trimmed) return;
    setLoading(true);
    setError('');
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      if (!sessionData.session) {
        const { error: signInError } = await supabase.auth.signInAnonymously();
        if (signInError) throw signInError;
      }
      const { data: userData, error: userError } = await supabase.auth.getUser();
      if (userError || !userData.user) throw userError || new Error('Could not start a session.');

      const { error: upsertError } = await supabase
        .from('profiles')
        .upsert({ id: userData.user.id, display_name: trimmed });
      if (upsertError) throw upsertError;

      localStorage.setItem('agora_name', trimmed);
      router.push('/plaza');
    } catch (e: any) {
      setError(
        e?.message?.includes('anonymous')
          ? 'Anonymous sign-ins are not enabled on this project yet. See SETUP.md.'
          : e?.message || 'Something went wrong — please try again.'
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="app">
      <div className="lantern-string">
        {Array.from({ length: 14 }).map((_, i) => (
          <span key={i} />
        ))}
      </div>

      <div className="wordmark">
        <h1>
          Agora Online<span className="accentdot">.</span>
        </h1>
        <div className="tag">live conversation, no script</div>
      </div>

      <div className="hero">
        <div className="eyebrow">Step into the plaza</div>
        <h2>Talk it through with someone new.</h2>
        <p className="sub">
          Drop a topic on the board, or join one that&apos;s already open. When the seats fill,
          the conversation starts — live, on video, thirty minutes at a time.
        </p>
        <div className="name-form">
          <input
            type="text"
            placeholder="What should we call you?"
            maxLength={24}
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') enter();
            }}
          />
          <button className="btn btn-primary" onClick={enter} disabled={loading || !name.trim()}>
            {loading ? 'Opening the gate…' : 'Enter the plaza'}
          </button>
          {error && <div className="error-text">{error}</div>}
        </div>
      </div>
    </div>
  );
}
