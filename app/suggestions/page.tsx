'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

export default function SuggestionsPage() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [message, setMessage] = useState('');
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    const saved = localStorage.getItem('agora_name');
    if (saved) setName(saved);
  }, []);

  async function send() {
    const trimmed = message.trim();
    if (!trimmed) return;
    setStatus('sending');
    setErrorMsg('');
    try {
      const res = await fetch('/api/suggestions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, message: trimmed }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Something went wrong.');
      setStatus('sent');
      setMessage('');
    } catch (e: any) {
      setStatus('error');
      setErrorMsg(e?.message || 'Something went wrong — please try again.');
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
        <h2>Suggestions</h2>
        <div className="who">
          <a
            href="#"
            onClick={(e) => {
              e.preventDefault();
              router.push('/plaza');
            }}
          >
            back to the plaza
          </a>
        </div>
      </div>

      <div className="new-post-panel" style={{ maxWidth: 520 }}>
        <h3>Got an idea, a bug, or a complaint?</h3>
        <p className="hint">
          This goes straight to the person building the app — no ticket system, no queue, just an
          honest note.
        </p>

        {status === 'sent' ? (
          <div className="overtime-banner" style={{ background: 'var(--accent-soft)', borderColor: 'var(--accent)' }}>
            <span>Sent — thank you. If it needs a reply, mention how to reach you in the message next time.</span>
          </div>
        ) : (
          <>
            <div className="field-row">
              <span className="field-label">Your name (optional)</span>
              <input
                type="text"
                placeholder="So we know who to thank"
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={60}
              />
            </div>
            <div className="field-row">
              <span className="field-label">Your suggestion</span>
              <textarea
                placeholder="What would make this better?"
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                maxLength={2000}
                style={{ minHeight: 140 }}
              />
            </div>
            {status === 'error' && <div className="error-text" style={{ marginBottom: 12 }}>{errorMsg}</div>}
            <button
              className="btn btn-primary"
              disabled={status === 'sending' || !message.trim()}
              onClick={send}
            >
              {status === 'sending' ? 'Sending…' : 'Send suggestion'}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
