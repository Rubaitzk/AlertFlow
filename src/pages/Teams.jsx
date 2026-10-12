import React, { useState, useEffect } from 'react';
import { api } from '../api/client';
import { Users, BellRing, Search, Shield, Terminal, Clock, Tag, Briefcase, CheckCircle2 } from 'lucide-react';

export default function Teams() {
  const [activeTab, setActiveTab] = useState('teams'); // 'teams' | 'directory'
  const [teams, setTeams] = useState([]);
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedDept, setSelectedDept] = useState('All');
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    Promise.all([api.getTeams(), api.getUsers()])
      .then(([teamsData, usersData]) => {
        setTeams(teamsData || []);
        setUsers(usersData || []);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return <div className="loading-spinner"><div className="spinner" /></div>;
  }

  const departments = ['All', 'Frontend', 'Backend', 'DevOps', 'Database', 'Security'];

  const filteredUsers = users.filter(user => {
    const matchesDept = selectedDept === 'All' || (user.department && user.department.toLowerCase() === selectedDept.toLowerCase());
    const query = searchQuery.toLowerCase().trim();
    if (!query) return matchesDept;

    const matchesName = user.name?.toLowerCase().includes(query);
    const matchesEmail = user.email?.toLowerCase().includes(query);
    const matchesTitle = user.title?.toLowerCase().includes(query);
    const matchesTag = Array.isArray(user.tags) && user.tags.some(t => t.toLowerCase().includes(query));

    return matchesDept && (matchesName || matchesEmail || matchesTitle || matchesTag);
  });

  const onCallCount = users.filter(u => u.status === 'on_call').length;

  return (
    <div>
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 16 }}>
        <div>
          <h1>Engineering & Teams</h1>
          <p>Organization directory, response pods, skills, and active on-call rosters.</p>
        </div>

        {/* View Switcher */}
        <div style={{ display: 'flex', background: 'var(--bg-tertiary)', padding: 4, borderRadius: 'var(--radius-md)', border: '1px solid var(--border-secondary)', gap: 4 }}>
          <button
            className={`btn btn-sm ${activeTab === 'teams' ? 'btn-primary' : 'btn-ghost'}`}
            onClick={() => setActiveTab('teams')}
            style={{ display: 'flex', alignItems: 'center', gap: 6 }}
          >
            <Users size={14} /> Teams & Pods ({teams.length})
          </button>
          <button
            className={`btn btn-sm ${activeTab === 'directory' ? 'btn-primary' : 'btn-ghost'}`}
            onClick={() => setActiveTab('directory')}
            style={{ display: 'flex', alignItems: 'center', gap: 6 }}
          >
            <Briefcase size={14} /> Personnel Directory ({users.length})
          </button>
        </div>
      </div>

      {/* Quick stats strip */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16, marginBottom: 24 }}>
        <div className="card" style={{ padding: '14px 18px', display: 'flex', alignItems: 'center', gap: 14 }}>
          <div style={{ width: 40, height: 40, borderRadius: 8, background: 'rgba(99, 102, 241, 0.12)', color: 'var(--brand-primary)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Users size={20} />
          </div>
          <div>
            <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--text-primary)', lineHeight: 1.2 }}>{users.length}</div>
            <div className="text-xs text-muted">Total Engineers</div>
          </div>
        </div>

        <div className="card" style={{ padding: '14px 18px', display: 'flex', alignItems: 'center', gap: 14 }}>
          <div style={{ width: 40, height: 40, borderRadius: 8, background: 'rgba(16, 185, 129, 0.12)', color: 'var(--success)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <BellRing size={20} />
          </div>
          <div>
            <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--success)', lineHeight: 1.2 }}>{onCallCount}</div>
            <div className="text-xs text-muted">Active On-Call Responders</div>
          </div>
        </div>

        <div className="card" style={{ padding: '14px 18px', display: 'flex', alignItems: 'center', gap: 14 }}>
          <div style={{ width: 40, height: 40, borderRadius: 8, background: 'rgba(245, 158, 11, 0.12)', color: 'var(--warning)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Shield size={20} />
          </div>
          <div>
            <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--text-primary)', lineHeight: 1.2 }}>{teams.length}</div>
            <div className="text-xs text-muted">Functional Engineering Pods</div>
          </div>
        </div>
      </div>

      {activeTab === 'teams' ? (
        /* TEAMS VIEW */
        <div className="grid-auto">
          {teams.map(team => (
            <div key={team.id} className="card" style={{ display: 'flex', flexDirection: 'column' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 4 }}>
                <div style={{ fontWeight: 600, fontSize: 17, color: 'var(--text-primary)' }}>{team.name}</div>
                {team.open_incidents > 0 ? (
                  <span className="badge critical" style={{ fontSize: 11 }}>{team.open_incidents} active</span>
                ) : (
                  <span className="badge success" style={{ fontSize: 11 }}>Nominal</span>
                )}
              </div>
              <div className="text-xs text-muted" style={{ marginBottom: 16 }}>{team.description}</div>

              <div className="flex gap-4" style={{ marginBottom: 16, padding: '10px 14px', background: 'var(--bg-tertiary)', borderRadius: 'var(--radius-sm)' }}>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 18, color: 'var(--text-primary)' }}>{team.member_count}</div>
                  <div className="text-xs text-muted">Members</div>
                </div>
                <div style={{ borderLeft: '1px solid var(--border-secondary)', paddingLeft: 16 }}>
                  <div style={{ fontWeight: 700, fontSize: 18, color: team.open_incidents > 0 ? 'var(--critical)' : 'var(--text-primary)' }}>
                    {team.open_incidents}
                  </div>
                  <div className="text-xs text-muted">Open Incidents</div>
                </div>
              </div>

              {/* On-call primary */}
              {team.oncall && (
                <div style={{ marginBottom: 16, padding: '10px 12px', background: 'rgba(16, 185, 129, 0.06)', border: '1px solid var(--success-border)', borderRadius: 'var(--radius-md)' }}>
                  <div className="text-xs flex items-center justify-between" style={{ marginBottom: 6, color: 'var(--success)' }}>
                    <span className="flex items-center gap-1"><BellRing size={12} /> Current On-Call</span>
                    <span className="badge success" style={{ fontSize: 9 }}>Primary</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div style={{ width: 26, height: 26, borderRadius: '50%', background: team.oncall.primary?.avatar_color || 'var(--brand-primary)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontSize: 11, fontWeight: 600 }}>
                      {team.oncall.primary?.name?.split(' ').map(n => n[0]).join('')}
                    </div>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>{team.oncall.primary?.name}</div>
                      <div className="text-xs text-muted">{team.oncall.primary?.title || team.oncall.primary?.email}</div>
                    </div>
                  </div>
                </div>
              )}

              {/* Members */}
              <div style={{ marginTop: 'auto' }}>
                <div className="text-xs text-muted" style={{ marginBottom: 8, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Team Members</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {(team.members || []).map(m => (
                    <div key={m.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 10px', background: 'var(--bg-tertiary)', borderRadius: 'var(--radius-sm)', fontSize: 12 }}>
                      <div className="flex items-center gap-2" style={{ overflow: 'hidden' }}>
                        <div style={{ width: 22, height: 22, borderRadius: '50%', background: m.avatar_color, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontSize: 9, fontWeight: 600, flexShrink: 0 }}>
                          {m.name?.split(' ').map(n => n[0]).join('')}
                        </div>
                        <div style={{ textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' }}>
                          <span style={{ fontWeight: 500, color: 'var(--text-primary)' }}>{m.name}</span>
                          {m.title && <span className="text-xs text-muted" style={{ marginLeft: 6 }}>({m.title})</span>}
                        </div>
                      </div>
                      <div className="flex items-center gap-1" style={{ flexShrink: 0 }}>
                        {m.team_role === 'lead' && <span className="badge brand" style={{ fontSize: 9, padding: '1px 5px' }}>Lead</span>}
                        {m.team_role === 'manager' && <span className="badge warning" style={{ fontSize: 9, padding: '1px 5px' }}>Manager</span>}
                        {m.status === 'on_call' && <span className="badge success" style={{ fontSize: 9, padding: '1px 5px' }}>On-Call</span>}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        /* PERSONNEL DIRECTORY VIEW */
        <div>
          {/* Controls: Department filter chips + search input */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12, marginBottom: 16 }}>
            <div className="filter-bar" style={{ margin: 0 }}>
              {departments.map(dept => (
                <button
                  key={dept}
                  className={`filter-chip ${selectedDept === dept ? 'active' : ''}`}
                  onClick={() => setSelectedDept(dept)}
                >
                  {dept}
                  <span style={{ opacity: 0.65, marginLeft: 4 }}>
                    ({dept === 'All' ? users.length : users.filter(u => u.department?.toLowerCase() === dept.toLowerCase()).length})
                  </span>
                </button>
              ))}
            </div>

            <div style={{ position: 'relative', minWidth: 260 }}>
              <Search size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
              <input
                className="form-input"
                style={{ paddingLeft: 32, fontSize: 13, height: 34 }}
                placeholder="Search by name, role, or tag..."
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
              />
            </div>
          </div>

          {/* Directory Cards Grid */}
          <div className="grid-auto">
            {filteredUsers.map(user => {
              const tags = Array.isArray(user.tags) ? user.tags : [];
              const isDemo = user.is_demo === 1 || !user.password_hash;

              return (
                <div key={user.id} className="card" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  {/* Top user header */}
                  <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                      <div style={{ width: 42, height: 42, borderRadius: '50%', background: user.avatar_color || 'var(--brand-primary)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontWeight: 700, fontSize: 15, flexShrink: 0 }}>
                        {user.name?.split(' ').map(n => n[0]).join('')}
                      </div>
                      <div>
                        <div style={{ fontWeight: 600, fontSize: 15, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: 6 }}>
                          {user.name}
                          {isDemo ? (
                            <span className="badge neutral" style={{ fontSize: 9, padding: '1px 5px' }}>Demo</span>
                          ) : (
                            <span className="badge brand" style={{ fontSize: 9, padding: '1px 5px' }}>Active Account</span>
                          )}
                        </div>
                        <div className="text-xs text-muted" style={{ marginTop: 2 }}>{user.title || user.role}</div>
                      </div>
                    </div>

                    {user.status === 'on_call' ? (
                      <span className="badge success" style={{ fontSize: 10, display: 'flex', alignItems: 'center', gap: 4 }}>
                        <BellRing size={10} /> On-Call
                      </span>
                    ) : (
                      <span className="badge neutral" style={{ fontSize: 10 }}>Available</span>
                    )}
                  </div>

                  {/* Metadata fields */}
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, padding: '8px 12px', background: 'var(--bg-tertiary)', borderRadius: 'var(--radius-sm)', fontSize: 12 }}>
                    <div>
                      <span className="text-muted" style={{ display: 'block', fontSize: 10, textTransform: 'uppercase' }}>Department</span>
                      <span style={{ fontWeight: 500, color: 'var(--text-primary)' }}>{user.department || 'Engineering'}</span>
                    </div>
                    <div>
                      <span className="text-muted" style={{ display: 'block', fontSize: 10, textTransform: 'uppercase' }}>Current Shift</span>
                      <span style={{ fontWeight: 500, color: 'var(--text-primary)' }}>{user.shift || '09:00 - 17:00 UTC'}</span>
                    </div>
                  </div>

                  {/* Email */}
                  <div className="text-xs text-muted" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ opacity: 0.7 }}>Email:</span>
                    <span style={{ color: 'var(--text-secondary)', fontFamily: 'monospace' }}>{user.email}</span>
                  </div>

                  {/* Tags and skills */}
                  {tags.length > 0 && (
                    <div style={{ marginTop: 'auto' }}>
                      <div className="text-xs text-muted" style={{ marginBottom: 6, display: 'flex', alignItems: 'center', gap: 4 }}>
                        <Tag size={11} /> Skills & Focus
                      </div>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                        {tags.map((tag, idx) => (
                          <span
                            key={idx}
                            style={{
                              padding: '2px 7px',
                              background: 'rgba(99, 102, 241, 0.09)',
                              border: '1px solid rgba(99, 102, 241, 0.2)',
                              color: 'var(--brand-primary)',
                              borderRadius: 4,
                              fontSize: 11,
                              fontWeight: 500,
                            }}
                          >
                            {tag}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {filteredUsers.length === 0 && (
            <div className="card" style={{ textAlign: 'center', padding: 40 }}>
              <Users size={32} style={{ color: 'var(--text-muted)', margin: '0 auto 12px' }} />
              <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>No engineers match filter</div>
              <div className="text-xs text-muted" style={{ marginTop: 4 }}>Try clearing search criteria or selecting 'All' departments.</div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
