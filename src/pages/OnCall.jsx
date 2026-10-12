import React, { useState, useEffect } from 'react';
import { api } from '../api/client';
import { BellRing, Clock, User, Shield, Tag, Calendar } from 'lucide-react';

export default function OnCall() {
  const [schedules, setSchedules] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.getOnCall().then(setSchedules).catch(console.error).finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="loading-spinner"><div className="spinner" /></div>;

  return (
    <div>
      <div className="page-header">
        <h1>On-Call Rotations</h1>
        <p>Active responder schedules, shift hours, and escalation coverage across engineering pods.</p>
      </div>

      {schedules.length === 0 ? (
        <div className="card">
          <div className="empty-state">
            <div className="icon-container"><BellRing size={28} /></div>
            <h3>No on-call schedules configured</h3>
            <p>On-call schedules determine who receives notifications for each team.</p>
          </div>
        </div>
      ) : (
        <div className="grid-auto">
          {schedules.map(oc => (
            <div key={oc.id} className="card" style={{ display: 'flex', flexDirection: 'column' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 2 }}>
                <div style={{ fontWeight: 600, fontSize: 16, color: 'var(--text-primary)' }}>{oc.team_name}</div>
                <span className="badge brand" style={{ fontSize: 10, textTransform: 'capitalize' }}>
                  {oc.rotation_type || 'Weekly'} Rotation
                </span>
              </div>
              <div className="text-xs text-muted" style={{ marginBottom: 14 }}>{oc.name}</div>

              {/* Current on-call */}
              <div style={{ marginBottom: 12 }}>
                <div className="text-xs text-muted flex items-center justify-between" style={{ marginBottom: 6 }}>
                  <span className="flex items-center gap-1"><BellRing size={12} color="var(--success)" /> Primary Responder</span>
                  <span className="badge success" style={{ fontSize: 9 }}>Active Now</span>
                </div>
                {oc.primary ? (
                  <div style={{ padding: '10px 12px', background: 'rgba(16, 185, 129, 0.08)', border: '1px solid var(--success-border)', borderRadius: 'var(--radius-md)' }}>
                    <div className="flex items-center gap-3">
                      <div style={{ width: 34, height: 34, borderRadius: '50%', background: oc.primary.avatar_color || 'var(--brand-primary)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontWeight: 600, fontSize: 13, flexShrink: 0 }}>
                        {oc.primary.name?.split(' ').map(n => n[0]).join('')}
                      </div>
                      <div style={{ overflow: 'hidden' }}>
                        <div style={{ fontWeight: 600, color: 'var(--text-primary)', fontSize: 13, display: 'flex', alignItems: 'center', gap: 6 }}>
                          {oc.primary.name}
                          {oc.primary.department && (
                            <span style={{ fontSize: 10, padding: '1px 5px', borderRadius: 4, background: 'rgba(99, 102, 241, 0.1)', color: 'var(--brand-primary)' }}>
                              {oc.primary.department}
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-muted" style={{ marginTop: 2 }}>{oc.primary.title || oc.primary.email}</div>
                      </div>
                    </div>
                    {Array.isArray(oc.primary.tags) && oc.primary.tags.length > 0 && (
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 8 }}>
                        {oc.primary.tags.slice(0, 3).map((t, i) => (
                          <span key={i} style={{ fontSize: 10, padding: '1px 5px', borderRadius: 3, background: 'var(--bg-tertiary)', color: 'var(--text-secondary)' }}>{t}</span>
                        ))}
                      </div>
                    )}
                  </div>
                ) : <span className="text-muted">Not configured</span>}
              </div>

              {/* Next on-call */}
              {oc.secondary && (
                <div style={{ marginBottom: 12 }}>
                  <div className="text-xs text-muted" style={{ marginBottom: 6 }}>Secondary / Next in Rotation</div>
                  <div style={{ padding: '8px 12px', background: 'var(--bg-tertiary)', border: '1px solid var(--border-secondary)', borderRadius: 'var(--radius-md)' }}>
                    <div className="flex items-center gap-3">
                      <div style={{ width: 28, height: 28, borderRadius: '50%', background: oc.secondary.avatar_color || 'var(--text-muted)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontWeight: 600, fontSize: 11, flexShrink: 0 }}>
                        {oc.secondary.name?.split(' ').map(n => n[0]).join('')}
                      </div>
                      <div>
                        <div style={{ fontWeight: 500, color: 'var(--text-primary)', fontSize: 12 }}>
                          {oc.secondary.name}
                          {oc.secondary.department && <span className="text-muted" style={{ marginLeft: 6, fontSize: 11 }}>• {oc.secondary.department}</span>}
                        </div>
                        <div className="text-xs text-muted">{oc.secondary.title || oc.secondary.email}</div>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Shift info */}
              <div className="flex items-center gap-2" style={{ fontSize: 12, color: 'var(--text-secondary)', padding: '6px 0', borderTop: '1px solid var(--border-secondary)', marginTop: 'auto' }}>
                <Clock size={13} />
                <span>Coverage Shift: <strong>{oc.shift_start} — {oc.shift_end} UTC</strong></span>
              </div>

              {/* Rotation Members list */}
              <div style={{ marginTop: 8 }}>
                <div className="text-xs text-muted" style={{ marginBottom: 6 }}>Rotation Pool ({oc.resolved_members?.length || 0})</div>
                <div className="flex gap-2" style={{ flexWrap: 'wrap' }}>
                  {(oc.resolved_members || []).map(m => (
                    <div key={m.id} className="flex items-center gap-2" style={{ padding: '3px 8px', background: 'var(--bg-tertiary)', borderRadius: 'var(--radius-sm)', fontSize: 11 }}>
                      <div style={{ width: 18, height: 18, borderRadius: '50%', background: m.avatar_color, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontSize: 8, fontWeight: 600 }}>
                        {m.name?.split(' ').map(n => n[0]).join('')}
                      </div>
                      <span style={{ color: 'var(--text-primary)' }}>{m.name}</span>
                      {m.department && <span className="text-muted" style={{ fontSize: 10 }}>({m.department})</span>}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
