import React, { useState, useEffect } from 'react';
import { api } from '../api/client';
import { useToast } from '../App';
import {
  Radio,
  Plus,
  Trash2,
  Send,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Mail,
  Hash,
  ShieldCheck,
  ExternalLink,
  RefreshCw,
  Unlink,
  Check
} from 'lucide-react';

export default function Destinations() {
  const addToast = useToast();
  const [destinations, setDestinations] = useState([]);
  const [gmailStatus, setGmailStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [newType, setNewType] = useState('slack');
  const [testing, setTesting] = useState(null);
  const [connectingGmail, setConnectingGmail] = useState(false);
  const [testingGmail, setTestingGmail] = useState(false);

  const load = async () => {
    try {
      const [dests, gStatus] = await Promise.all([
        api.getDestinations().catch(() => []),
        api.getGmailConnectorStatus().catch(() => null),
      ]);
      setDestinations(dests);
      setGmailStatus(gStatus);
    } catch (e) {
      console.error('Error loading destinations:', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();

    // Check for OAuth callback results in query parameters
    const params = new URLSearchParams(window.location.search);
    if (params.get('connected') === 'gmail') {
      addToast('Gmail connector connected successfully via OAuth 2.0!', 'success');
      window.history.replaceState({}, document.title, window.location.pathname);
    } else if (params.get('error')) {
      addToast(`OAuth connection error: ${decodeURIComponent(params.get('error'))}`, 'error');
      window.history.replaceState({}, document.title, window.location.pathname);
    }
  }, []);

  const connectGmail = async () => {
    setConnectingGmail(true);
    try {
      const res = await api.getGmailAuthUrl();
      if (res?.authUrl) {
        window.location.href = res.authUrl;
      } else {
        addToast('Failed to generate Google authorization URL', 'error');
        setConnectingGmail(false);
      }
    } catch (e) {
      addToast(e.message || 'Google OAuth is not configured on the backend', 'error');
      setConnectingGmail(false);
    }
  };

  const handleDisconnectGmail = async () => {
    if (!confirm('Disconnect Gmail connector? Active incident routing to Gmail will be paused.')) return;
    try {
      await api.disconnectGmail(gmailStatus?.id);
      addToast('Gmail connector disconnected');
      load();
    } catch (e) {
      addToast(e.message, 'error');
    }
  };

  const testGmail = async () => {
    setTestingGmail(true);
    try {
      const res = await api.testGmailConnector();
      if (res?.success) {
        addToast(`Test email sent successfully${res.recipient ? ` to ${res.recipient}` : ''}!`, 'success');
        load();
      } else {
        addToast(`Gmail test failed: ${res?.error || 'Unknown error'}`, 'error');
      }
    } catch (e) {
      addToast(e.message, 'error');
    } finally {
      setTestingGmail(false);
    }
  };

  const testDest = async (id) => {
    setTesting(id);
    try {
      const result = await api.testDestination(id);
      if (result.success) addToast('Test notification sent successfully!');
      else addToast(`Test failed: ${result.error}`, 'error');
    } catch (e) {
      addToast(e.message, 'error');
    }
    setTesting(null);
  };

  const deleteDest = async (id) => {
    if (!confirm('Disconnect this destination?')) return;
    try {
      await api.deleteDestination(id);
      addToast('Destination disconnected');
      load();
    } catch (e) {
      addToast(e.message, 'error');
    }
  };

  const toggleDest = async (dest) => {
    try {
      await api.updateDestination(dest.id, { enabled: !dest.enabled });
      addToast(dest.enabled ? 'Destination disabled' : 'Destination enabled');
      load();
    } catch (e) {
      addToast(e.message, 'error');
    }
  };

  if (loading) return <div className="loading-spinner"><div className="spinner" /></div>;

  const isGmailConnected = gmailStatus?.connected === true;
  const hasSlackDest = destinations.some(d => d.type === 'slack' && d.enabled);

  return (
    <div>
      <div className="page-header">
        <div className="page-header-row">
          <div>
            <h1>Destinations & Direct Connectors</h1>
            <p>Direct incident notifications to Gmail and Slack without third-party routing intermediaries.</p>
          </div>
          <button className="btn btn-primary" onClick={() => setShowModal(true)}>
            <Plus size={16} /> Add Destination
          </button>
        </div>
      </div>

      {/* Direct Connectors Hero Cards */}
      <div style={{ marginBottom: 28 }}>
        <h2 style={{ fontSize: 16, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 12, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          Direct Connectors
        </h2>
        <div className="grid-auto" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))' }}>
          
          {/* Gmail OAuth Connector Card */}
          <div className="card" style={{ border: isGmailConnected ? '1px solid rgba(16, 185, 129, 0.3)' : '1px solid var(--border-color)' }}>
            <div className="flex items-center gap-3" style={{ marginBottom: 14 }}>
              <div style={{ width: 44, height: 44, borderRadius: 'var(--radius-md)', background: '#EA4335', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Mail size={22} color="white" />
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600, color: 'var(--text-primary)', fontSize: 15 }}>Gmail (Google OAuth 2.0)</div>
                <div className="text-xs text-muted">Direct Gmail API & AES-256-GCM Token Encryption</div>
              </div>
              <span className={`badge ${isGmailConnected ? 'success' : 'neutral'}`}>
                {isGmailConnected ? 'Connected' : 'Not Connected'}
              </span>
            </div>

            <p className="text-xs text-muted" style={{ lineHeight: 1.5, marginBottom: 16 }}>
              {isGmailConnected
                ? `Active account: ${gmailStatus.email}. AlertFlow dispatches incident alerts directly via Google OAuth 2.0.`
                : 'Connect your Google account to send real-time incident emails directly without SMTP passwords or third-party workflow routing.'}
            </p>

            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              {isGmailConnected ? (
                <>
                  <button
                    className="btn btn-secondary btn-sm"
                    style={{ flex: 1 }}
                    onClick={testGmail}
                    disabled={testingGmail}
                  >
                    {testingGmail ? <><RefreshCw size={14} className="spin" /> Sending...</> : <><Send size={14} /> Test Gmail</>}
                  </button>
                  <button
                    className="btn btn-ghost btn-sm"
                    onClick={handleDisconnectGmail}
                    title="Disconnect Gmail"
                  >
                    <Unlink size={14} /> Disconnect
                  </button>
                </>
              ) : (
                <button
                  className="btn btn-primary btn-sm"
                  style={{ width: '100%' }}
                  onClick={connectGmail}
                  disabled={connectingGmail}
                >
                  {connectingGmail ? <><RefreshCw size={14} className="spin" /> Initiating OAuth...</> : <><ExternalLink size={14} /> Connect with Google</>}
                </button>
              )}
            </div>
          </div>

          {/* Slack Direct Connector Card */}
          <div className="card" style={{ border: hasSlackDest ? '1px solid rgba(16, 185, 129, 0.3)' : '1px solid var(--border-color)' }}>
            <div className="flex items-center gap-3" style={{ marginBottom: 14 }}>
              <div style={{ width: 44, height: 44, borderRadius: 'var(--radius-md)', background: '#4A154B', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Hash size={22} color="white" />
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600, color: 'var(--text-primary)', fontSize: 15 }}>Slack Direct Connector</div>
                <div className="text-xs text-muted">Incoming Webhooks & Bot Tokens (Direct)</div>
              </div>
              <span className={`badge ${hasSlackDest ? 'success' : 'neutral'}`}>
                {hasSlackDest ? 'Active' : 'Configured'}
              </span>
            </div>

            <p className="text-xs text-muted" style={{ lineHeight: 1.5, marginBottom: 16 }}>
              Direct HTTP post to Slack channels with interactive Block Kit messages. Operates with zero third-party intermediaries.
            </p>

            <button
              className="btn btn-secondary btn-sm"
              style={{ width: '100%' }}
              onClick={() => { setNewType('slack'); setShowModal(true); }}
            >
              <Plus size={14} /> Add Slack Channel
            </button>
          </div>

        </div>
      </div>

      {/* Destinations List */}
      <h2 style={{ fontSize: 16, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 12, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
        Configured Notification Channels
      </h2>

      {destinations.length === 0 ? (
        <div className="card">
          <div className="empty-state">
            <div className="icon-container"><Radio size={28} /></div>
            <h3>No destinations configured</h3>
            <p>Connect Gmail or Slack to receive incident alerts and updates.</p>
            <button className="btn btn-primary" onClick={() => setShowModal(true)}><Plus size={16} /> Add Destination</button>
          </div>
        </div>
      ) : (
        <div className="grid-auto">
          {destinations.map(dest => (
            <div key={dest.id} className="card">
              <div className="flex items-center gap-3" style={{ marginBottom: 16 }}>
                <div style={{
                  width: 40,
                  height: 40,
                  borderRadius: 'var(--radius-md)',
                  background: dest.type === 'slack' ? '#4A154B' : (dest.type === 'gmail' ? '#EA4335' : '#2563EB'),
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center'
                }}>
                  {dest.type === 'slack' ? <Hash size={20} color="white" /> : <Mail size={20} color="white" />}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600, color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {dest.name}
                  </div>
                  <div className="text-xs text-muted" style={{ textTransform: 'capitalize' }}>
                    {dest.type === 'gmail' ? 'Gmail (OAuth 2.0)' : dest.type}
                  </div>
                </div>
                <span className={`badge ${dest.status === 'connected' ? 'success' : 'neutral'}`}>{dest.status}</span>
              </div>

              <div style={{ display: 'grid', gap: 8, marginBottom: 16 }}>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted">Status</span>
                  <button className={`btn btn-sm ${dest.enabled ? 'btn-success' : 'btn-secondary'}`} onClick={() => toggleDest(dest)}>
                    {dest.enabled ? 'Enabled' : 'Disabled'}
                  </button>
                </div>
                {dest.last_success_at && (
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-muted">Last Success</span>
                    <span className="text-xs" style={{ color: 'var(--success)' }}>{new Date(dest.last_success_at).toLocaleString()}</span>
                  </div>
                )}
                {dest.last_failure_at && (
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-muted">Last Failure</span>
                    <span className="text-xs" style={{ color: 'var(--critical)' }}>{new Date(dest.last_failure_at).toLocaleString()}</span>
                  </div>
                )}
              </div>

              <div className="flex gap-2">
                <button
                  className="btn btn-secondary btn-sm"
                  style={{ flex: 1 }}
                  onClick={() => testDest(dest.id)}
                  disabled={testing === dest.id}
                >
                  {testing === dest.id ? 'Sending...' : <><Send size={14} /> Test</>}
                </button>
                <button className="btn btn-ghost btn-sm" onClick={() => deleteDest(dest.id)} title="Disconnect destination">
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Add Destination Modal */}
      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Add Notification Destination</h2>
              <button className="btn btn-ghost btn-sm" onClick={() => setShowModal(false)}><XCircle size={18} /></button>
            </div>
            <div className="modal-body">
              <div className="flex gap-2" style={{ marginBottom: 16 }}>
                <button
                  className={`btn ${newType === 'slack' ? 'btn-primary' : 'btn-secondary'}`}
                  onClick={() => setNewType('slack')}
                >
                  <Hash size={16} /> Slack
                </button>
                <button
                  className={`btn ${newType === 'gmail' ? 'btn-primary' : 'btn-secondary'}`}
                  onClick={() => setNewType('gmail')}
                >
                  <Mail size={16} /> Gmail OAuth
                </button>
                <button
                  className={`btn ${newType === 'email' ? 'btn-primary' : 'btn-secondary'}`}
                  onClick={() => setNewType('email')}
                >
                  <Mail size={16} /> SMTP Email
                </button>
              </div>

              {newType === 'slack' && (
                <SlackForm onSave={() => { setShowModal(false); load(); addToast('Slack destination connected!'); }} />
              )}
              {newType === 'gmail' && (
                <GmailConnectModal
                  onConnect={connectGmail}
                  connecting={connectingGmail}
                  isConnected={isGmailConnected}
                  email={gmailStatus?.email}
                />
              )}
              {newType === 'email' && (
                <EmailForm onSave={() => { setShowModal(false); load(); addToast('SMTP Email connected!'); }} />
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function GmailConnectModal({ onConnect, connecting, isConnected, email }) {
  return (
    <div style={{ textAlign: 'center', padding: '16px 8px' }}>
      <div style={{
        width: 56,
        height: 56,
        borderRadius: '50%',
        background: 'rgba(234, 67, 53, 0.1)',
        color: '#EA4335',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        margin: '0 auto 16px auto'
      }}>
        <Mail size={28} />
      </div>

      <h3 style={{ fontSize: 16, fontWeight: 600, marginBottom: 8, color: 'var(--text-primary)' }}>
        Direct Gmail OAuth 2.0 Integration
      </h3>

      <p className="text-xs text-muted" style={{ lineHeight: 1.6, maxWidth: 360, margin: '0 auto 20px auto' }}>
        Authorize AlertFlow to dispatch critical incident alerts from your verified Google account. No app passwords or third-party webhooks required.
      </p>

      {isConnected ? (
        <div style={{ padding: '12px 16px', background: 'rgba(16, 185, 129, 0.1)', borderRadius: 'var(--radius-md)', border: '1px solid rgba(16, 185, 129, 0.2)', marginBottom: 16 }}>
          <div className="flex items-center justify-center gap-2" style={{ color: 'var(--success)', fontWeight: 500, fontSize: 14 }}>
            <Check size={16} /> Already Connected: {email}
          </div>
        </div>
      ) : null}

      <button
        className="btn btn-primary"
        style={{ width: '100%', padding: '10px 16px', fontSize: 14 }}
        onClick={onConnect}
        disabled={connecting}
      >
        {connecting ? (
          <><RefreshCw size={16} className="spin" /> Opening Google Consent...</>
        ) : (
          <><ExternalLink size={16} /> Authorize with Google</>
        )}
      </button>
    </div>
  );
}

function SlackForm({ onSave }) {
  const [name, setName] = useState('Slack — Production Alerts');
  const [webhookUrl, setWebhookUrl] = useState('');
  const [botToken, setBotToken] = useState('');
  const [channel, setChannel] = useState('#incidents');
  const [useBotToken, setUseBotToken] = useState(false);
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    try {
      const config = useBotToken
        ? { bot_token: botToken, slack_channel: channel }
        : { webhook_url: webhookUrl, slack_channel: channel };

      await api.createDestination({
        type: 'slack',
        name,
        configuration: config,
      });
      onSave();
    } catch (e) {
      console.error(e);
    }
    setSaving(false);
  };

  return (
    <div>
      <div className="form-group">
        <label className="form-label">Destination Name</label>
        <input className="form-input" value={name} onChange={e => setName(e.target.value)} />
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
        <button
          type="button"
          className={`btn btn-sm ${!useBotToken ? 'btn-primary' : 'btn-secondary'}`}
          onClick={() => setUseBotToken(false)}
        >
          Incoming Webhook
        </button>
        <button
          type="button"
          className={`btn btn-sm ${useBotToken ? 'btn-primary' : 'btn-secondary'}`}
          onClick={() => setUseBotToken(true)}
        >
          Slack Bot Token (xoxb-)
        </button>
      </div>

      {!useBotToken ? (
        <div className="form-group">
          <label className="form-label">Slack Incoming Webhook URL</label>
          <input
            className="form-input"
            value={webhookUrl}
            onChange={e => setWebhookUrl(e.target.value)}
            placeholder="https://hooks.slack.com/services/T.../B.../..."
          />
          <div className="text-xs text-muted" style={{ marginTop: 4 }}>
            Create an incoming webhook directly at <a href="https://api.slack.com/messaging/webhooks" target="_blank" rel="noreferrer">api.slack.com</a>
          </div>
        </div>
      ) : (
        <>
          <div className="form-group">
            <label className="form-label">Slack Bot User OAuth Token</label>
            <input
              className="form-input"
              type="password"
              value={botToken}
              onChange={e => setBotToken(e.target.value)}
              placeholder="xoxb-your-slack-bot-token"
            />
          </div>
          <div className="form-group">
            <label className="form-label">Slack Channel</label>
            <input
              className="form-input"
              value={channel}
              onChange={e => setChannel(e.target.value)}
              placeholder="#incidents"
            />
          </div>
        </>
      )}

      <button
        className="btn btn-primary"
        style={{ width: '100%', marginTop: 8 }}
        onClick={save}
        disabled={(!useBotToken && !webhookUrl) || (useBotToken && !botToken) || saving}
      >
        {saving ? 'Connecting...' : 'Connect Direct Slack'}
      </button>
    </div>
  );
}

function EmailForm({ onSave }) {
  const [name, setName] = useState('Email — DevOps');
  const [email, setEmail] = useState('');
  const [appPassword, setAppPassword] = useState('');
  const [toEmail, setToEmail] = useState('');
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    try {
      await api.createDestination({
        type: 'email',
        name,
        configuration: { service: 'gmail', email, app_password: appPassword, to_email: toEmail || email },
      });
      onSave();
    } catch (e) {
      console.error(e);
    }
    setSaving(false);
  };

  return (
    <div>
      <div className="form-group">
        <label className="form-label">Name</label>
        <input className="form-input" value={name} onChange={e => setName(e.target.value)} />
      </div>
      <div className="form-group">
        <label className="form-label">Sender Email Address</label>
        <input className="form-input" type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="alerts@yourcompany.com" />
      </div>
      <div className="form-group">
        <label className="form-label">SMTP / App Password</label>
        <input className="form-input" type="password" value={appPassword} onChange={e => setAppPassword(e.target.value)} placeholder="••••••••••••••••" />
      </div>
      <div className="form-group">
        <label className="form-label">Recipient Email (optional)</label>
        <input className="form-input" type="email" value={toEmail} onChange={e => setToEmail(e.target.value)} placeholder="Same as sender if empty" />
      </div>
      <button className="btn btn-primary" style={{ width: '100%' }} onClick={save} disabled={!email || !appPassword || saving}>
        {saving ? 'Connecting...' : 'Connect SMTP Email'}
      </button>
    </div>
  );
}
