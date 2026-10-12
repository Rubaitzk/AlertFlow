import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api, onWsMessage } from '../api/client';
import { useToast } from '../App';
import {
  ArrowLeft, CheckCircle2, AlertTriangle, Clock, User, Users,
  Send, XCircle, RefreshCw, MessageSquare, TrendingUp, Zap, Shield
} from 'lucide-react';

function formatTime(ts) {
  if (!ts) return '—';
  return new Date(ts).toLocaleTimeString();
}

function formatDuration(start, end) {
  if (!start) return '—';
  const s = Math.floor((new Date(end || Date.now()) - new Date(start)) / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

export default function IncidentDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const addToast = useToast();
  const [incident, setIncident] = useState(null);
  const [loading, setLoading] = useState(true);
  const [noteText, setNoteText] = useState('');
  const [showResolve, setShowResolve] = useState(false);
  const [showAssign, setShowAssign] = useState(false);
  const [showPostmortem, setShowPostmortem] = useState(false);
  const [users, setUsers] = useState([]);
  const [teams, setTeams] = useState([]);
  const [resolveData, setResolveData] = useState({ root_cause: '', impact: '', resolution: '', followup: '' });

  const load = async () => {
    try {
      const data = await api.getIncident(id);
      setIncident(data);
      if (data.root_cause || data.impact || data.resolution) {
        setResolveData({
          root_cause: data.root_cause || '',
          impact: data.impact || '',
          resolution: data.resolution || '',
          followup: data.followup || '',
        });
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [id]);
  useEffect(() => {
    api.getUsers().then(setUsers).catch(() => {});
    api.getTeams().then(setTeams).catch(() => {});
  }, []);

  useEffect(() => {
    return onWsMessage((msg) => {
      if ((msg.type === 'incident_updated' || msg.type === 'incident_created') && msg.incident?.id === id) {
        load();
      }
    });
  }, [id]);

  const doAck = async () => {
    try {
      await api.acknowledgeIncident(id);
      addToast('Incident acknowledged');
      load();
    } catch (e) { addToast(e.message, 'error'); }
  };

  const doResolve = async () => {
    try {
      await api.resolveIncident(id, resolveData);
      addToast('Incident resolved');
      setShowResolve(false);
      load();
    } catch (e) { addToast(e.message, 'error'); }
  };

  const doEscalate = async () => {
    try {
      await api.escalateIncident(id);
      addToast('Incident escalated');
      load();
    } catch (e) { addToast(e.message, 'error'); }
  };

  const doReopen = async () => {
    try {
      await api.reopenIncident(id);
      addToast('Incident reopened');
      load();
    } catch (e) { addToast(e.message, 'error'); }
  };

  const doAssign = async (assignee_id, team_id) => {
    try {
      await api.assignIncident(id, { assignee_id, team_id });
      addToast('Incident assigned');
      setShowAssign(false);
      load();
    } catch (e) { addToast(e.message, 'error'); }
  };

  const doAddNote = async () => {
    if (!noteText.trim()) return;
    try {
      await api.addIncidentNote(id, noteText);
      setNoteText('');
      addToast('Note added');
      load();
    } catch (e) { addToast(e.message, 'error'); }
  };

  const doSavePostmortem = async () => {
    try {
      await api.updatePostmortem(id, resolveData);
      addToast('Post-incident review saved');
      setShowPostmortem(false);
    } catch (e) { addToast(e.message, 'error'); }
  };

  const doStatusChange = async (status) => {
    try {
      await api.updateIncidentStatus(id, status);
      addToast(`Status changed to ${status}`);
      load();
    } catch (e) { addToast(e.message, 'error'); }
  };

  if (loading) return <div className="loading-spinner"><div className="spinner" /></div>;
  if (!incident) return <div className="empty-state"><h3>Incident not found</h3></div>;

  const isResolved = incident.status === 'resolved';
  const isAcked = incident.status === 'acknowledged' || incident.status === 'mitigating';

  return (
    <div>
      {/* Header */}
      <div style={{ marginBottom: 24 }}>
        <button className="btn btn-ghost btn-sm" onClick={() => navigate('/incidents')} style={{ marginBottom: 12 }}>
          <ArrowLeft size={16} /> Back to Incidents
        </button>

        <div className="page-header-row">
          <div>
            <div className="flex items-center gap-3">
              <span className="font-mono" style={{ fontSize: 14, color: 'var(--text-muted)' }}>INC-{incident.incident_number}</span>
              <span className={`badge ${incident.severity}`}>{incident.severity}</span>
              <span className="badge brand">{incident.priority}</span>
              <span className={`badge ${isResolved ? 'success' : incident.status === 'triggered' ? 'critical' : 'info'}`}>{incident.status}</span>
            </div>
            <h1 style={{ fontSize: 20, marginTop: 6 }}>{incident.title}</h1>
          </div>

          <div className="flex gap-2">
            {!isResolved && !isAcked && (
              <button className="btn btn-primary" onClick={doAck}>
                <CheckCircle2 size={16} /> Acknowledge
              </button>
            )}
            {!isResolved && incident.status === 'acknowledged' && (
              <button className="btn btn-warning btn-sm" onClick={() => doStatusChange('mitigating')}>Mitigating</button>
            )}
            {!isResolved && (
              <>
                <button className="btn btn-secondary" onClick={() => setShowAssign(true)}>
                  <User size={16} /> Assign
                </button>
                <button className="btn btn-warning" onClick={doEscalate}>
                  <TrendingUp size={16} /> Escalate
                </button>
                <button className="btn btn-success" onClick={() => setShowResolve(true)}>
                  <CheckCircle2 size={16} /> Resolve
                </button>
              </>
            )}
            {isResolved && (
              <button className="btn btn-secondary" onClick={doReopen}>
                <RefreshCw size={16} /> Reopen
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="grid-2">
        {/* Left: Details + Timeline */}
        <div>
          {/* Incident details card */}
          <div className="card" style={{ marginBottom: 16 }}>
            <div className="card-title" style={{ marginBottom: 12 }}>Incident Details</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px 24px' }}>
              <div><span className="text-xs text-muted">Service</span><div style={{ fontWeight: 500 }}>{incident.service_name || '—'}</div></div>
              <div><span className="text-xs text-muted">Environment</span><div>{incident.environment}</div></div>
              <div><span className="text-xs text-muted">Team</span><div>{incident.team_name || '—'}</div></div>
              <div><span className="text-xs text-muted">Assignee</span><div>{incident.assignee_name || 'Unassigned'}</div></div>
              <div><span className="text-xs text-muted">Started</span><div className="font-mono text-sm">{new Date(incident.started_at).toLocaleString()}</div></div>
              <div><span className="text-xs text-muted">Duration</span><div className="font-mono text-sm">{formatDuration(incident.started_at, incident.resolved_at)}</div></div>
              {incident.acknowledged_at && <div><span className="text-xs text-muted">Acknowledged</span><div className="font-mono text-sm">{new Date(incident.acknowledged_at).toLocaleString()}</div></div>}
              {incident.resolved_at && <div><span className="text-xs text-muted">Resolved</span><div className="font-mono text-sm">{new Date(incident.resolved_at).toLocaleString()}</div></div>}
            </div>
          </div>

          {/* Post-incident review */}
          {isResolved && (
            <div className="card" style={{ marginBottom: 16 }}>
              <div className="card-header">
                <div className="card-title">Post-Incident Review</div>
                <button className="btn btn-ghost btn-sm" onClick={() => setShowPostmortem(true)}>Edit</button>
              </div>
              {incident.root_cause || incident.impact || incident.resolution ? (
                <div style={{ display: 'grid', gap: 12 }}>
                  {incident.root_cause && <div><span className="text-xs text-muted">Root Cause</span><div>{incident.root_cause}</div></div>}
                  {incident.impact && <div><span className="text-xs text-muted">Impact</span><div>{incident.impact}</div></div>}
                  {incident.resolution && <div><span className="text-xs text-muted">Resolution</span><div>{incident.resolution}</div></div>}
                  {incident.followup && <div><span className="text-xs text-muted">Follow-up Actions</span><div>{incident.followup}</div></div>}
                </div>
              ) : (
                <p className="text-muted">No post-incident review yet. <button className="btn btn-ghost btn-sm" onClick={() => setShowPostmortem(true)}>Add one</button></p>
              )}
            </div>
          )}

          {/* Related alerts */}
          {incident.alerts?.length > 0 && (
            <div className="card" style={{ marginBottom: 16 }}>
              <div className="card-title" style={{ marginBottom: 12 }}>
                <div className="flex items-center gap-2"><Zap size={16} /> Related Alerts ({incident.alerts.length})</div>
              </div>
              {incident.alerts.map(alert => (
                <div key={alert.id} style={{ padding: '8px 0', borderBottom: '1px solid var(--border-secondary)', display: 'flex', alignItems: 'center', gap: 12 }}>
                  <span className={`badge ${alert.severity}`}>{alert.severity}</span>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 13 }}>{alert.description}</div>
                    <div className="text-xs text-muted">{alert.event_type} · {alert.metric ? `${alert.metric}: ${alert.value}` : alert.source}</div>
                  </div>
                  <span className="text-xs font-mono text-muted">{formatTime(alert.timestamp)}</span>
                  {alert.is_duplicate ? <span className="badge neutral">DUP</span> : null}
                </div>
              ))}
            </div>
          )}

          {/* Deliveries */}
          {incident.deliveries?.length > 0 && (
            <div className="card">
              <div className="card-title" style={{ marginBottom: 12 }}>Notification Deliveries</div>
              {incident.deliveries.map(del => (
                <div key={del.id} style={{ padding: '8px 0', borderBottom: '1px solid var(--border-secondary)', display: 'flex', alignItems: 'center', gap: 12 }}>
                  <span style={{ fontWeight: 500, textTransform: 'capitalize', minWidth: 60, color: 'var(--text-primary)' }}>
                    {del.destination_type}
                  </span>
                  <span className={`badge ${del.status === 'delivered' ? 'success' : del.status === 'failed' ? 'critical' : 'neutral'}`}>
                    {del.status === 'delivered' ? '✓ Delivered' : del.status === 'failed' ? '✕ Failed' : del.status}
                  </span>
                  {del.is_fallback ? <span className="badge warning">Fallback</span> : null}
                  {del.attempts > 1 && <span className="text-xs text-muted">{del.attempts} attempts</span>}
                  {del.last_error && <span className="text-xs" style={{ color: 'var(--critical)' }}>{del.last_error}</span>}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Right: Timeline + Notes */}
        <div>
          <div className="card">
            <div className="card-title" style={{ marginBottom: 16 }}>
              <div className="flex items-center gap-2"><Clock size={16} /> Timeline</div>
            </div>

            {/* Add note */}
            {!isResolved && (
              <div style={{ marginBottom: 16, display: 'flex', gap: 8 }}>
                <input className="form-input" placeholder="Add a note..."
                  value={noteText} onChange={(e) => setNoteText(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && doAddNote()}
                />
                <button className="btn btn-primary btn-sm" onClick={doAddNote} disabled={!noteText.trim()}>
                  <Send size={14} />
                </button>
              </div>
            )}

            <div className="timeline">
              {(incident.timeline || []).map(event => (
                <div key={event.id} className="timeline-item">
                  <div className={`timeline-dot ${event.type}`} />
                  <div className="timeline-time">{formatTime(event.timestamp)}</div>
                  <div className="timeline-message">{event.message}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Resolve modal */}
      {showResolve && (
        <div className="modal-overlay" onClick={() => setShowResolve(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Resolve Incident</h2>
              <button className="btn btn-ghost btn-sm" onClick={() => setShowResolve(false)}><XCircle size={18} /></button>
            </div>
            <div className="modal-body">
              <div className="form-group">
                <label className="form-label">Root Cause</label>
                <textarea className="form-textarea" value={resolveData.root_cause} onChange={e => setResolveData(d => ({ ...d, root_cause: e.target.value }))} placeholder="What caused this incident?" />
              </div>
              <div className="form-group">
                <label className="form-label">Impact</label>
                <textarea className="form-textarea" value={resolveData.impact} onChange={e => setResolveData(d => ({ ...d, impact: e.target.value }))} placeholder="What was the customer impact?" />
              </div>
              <div className="form-group">
                <label className="form-label">Resolution</label>
                <textarea className="form-textarea" value={resolveData.resolution} onChange={e => setResolveData(d => ({ ...d, resolution: e.target.value }))} placeholder="How was it resolved?" />
              </div>
              <div className="form-group">
                <label className="form-label">Follow-up Actions</label>
                <textarea className="form-textarea" value={resolveData.followup} onChange={e => setResolveData(d => ({ ...d, followup: e.target.value }))} placeholder="What follow-up actions are needed?" />
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setShowResolve(false)}>Cancel</button>
              <button className="btn btn-success" onClick={doResolve}><CheckCircle2 size={16} /> Resolve Incident</button>
            </div>
          </div>
        </div>
      )}

      {/* Assign modal */}
      {showAssign && (
        <div className="modal-overlay" onClick={() => setShowAssign(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Assign Incident</h2>
              <button className="btn btn-ghost btn-sm" onClick={() => setShowAssign(false)}><XCircle size={18} /></button>
            </div>
            <div className="modal-body">
              <div className="form-group">
                <label className="form-label">Team</label>
                <select className="form-select" defaultValue={incident.team_id || ''} id="assign-team">
                  <option value="">Select team...</option>
                  {teams.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label className="form-label">Assignee</label>
                <select className="form-select" defaultValue={incident.assignee_id || ''} id="assign-user">
                  <option value="">Select responder...</option>
                  {(() => {
                    const depts = [...new Set(users.map(u => u.department || 'Other'))];
                    return depts.map(dept => (
                      <optgroup key={dept} label={`${dept} Pod`}>
                        {users
                          .filter(u => (u.department || 'Other') === dept)
                          .map(u => (
                            <option key={u.id} value={u.id}>
                              {u.name} — {u.title || u.role} {u.is_demo ? '(Demo)' : '(Active)'}
                            </option>
                          ))}
                      </optgroup>
                    ));
                  })()}
                </select>
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setShowAssign(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={() => {
                const teamId = document.getElementById('assign-team').value;
                const userId = document.getElementById('assign-user').value;
                doAssign(userId || null, teamId || null);
              }}><User size={16} /> Assign</button>
            </div>
          </div>
        </div>
      )}

      {/* Postmortem modal */}
      {showPostmortem && (
        <div className="modal-overlay" onClick={() => setShowPostmortem(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Post-Incident Review</h2>
              <button className="btn btn-ghost btn-sm" onClick={() => setShowPostmortem(false)}><XCircle size={18} /></button>
            </div>
            <div className="modal-body">
              <div className="form-group">
                <label className="form-label">Root Cause</label>
                <textarea className="form-textarea" value={resolveData.root_cause} onChange={e => setResolveData(d => ({ ...d, root_cause: e.target.value }))} />
              </div>
              <div className="form-group">
                <label className="form-label">Impact</label>
                <textarea className="form-textarea" value={resolveData.impact} onChange={e => setResolveData(d => ({ ...d, impact: e.target.value }))} />
              </div>
              <div className="form-group">
                <label className="form-label">Resolution</label>
                <textarea className="form-textarea" value={resolveData.resolution} onChange={e => setResolveData(d => ({ ...d, resolution: e.target.value }))} />
              </div>
              <div className="form-group">
                <label className="form-label">Follow-up Actions</label>
                <textarea className="form-textarea" value={resolveData.followup} onChange={e => setResolveData(d => ({ ...d, followup: e.target.value }))} />
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setShowPostmortem(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={doSavePostmortem}>Save Review</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
