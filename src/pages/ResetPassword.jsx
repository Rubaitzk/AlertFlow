import React, { useState } from 'react';
import { useSearchParams, useNavigate, Link } from 'react-router-dom';
import { api } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { Lock, KeyRound, Eye, EyeOff, AlertCircle, CheckCircle2, ArrowRight } from 'lucide-react';

export default function ResetPassword() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token') || '';
  const navigate = useNavigate();
  const { authConfig } = useAuth();

  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  const minPasswordLength = authConfig?.passwordMinLength || 12;

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    if (!token) {
      setError('Missing password reset token. Please request a new password reset link.');
      return;
    }

    if (password.length < minPasswordLength) {
      setError(`Password must be at least ${minPasswordLength} characters long`);
      return;
    }

    if (!/[A-Z]/.test(password) || !/[a-z]/.test(password) || !/[0-9\W_]/.test(password)) {
      setError('Password must contain uppercase, lowercase, and a number or special character');
      return;
    }

    if (password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    setLoading(true);
    try {
      await api.resetPassword({ token, password });
      setSuccess(true);
    } catch (err) {
      setError(err.message || 'Password reset failed. The link may have expired or is invalid.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-page-container">
      <div className="login-card-wrapper" style={{ maxWidth: 540 }}>
        <div className="login-form-panel" style={{ width: '100%', padding: '48px 36px' }}>
          <div className="form-card-inner">
            <div className="form-header" style={{ textAlign: 'center' }}>
              <div className="sidebar-logo-icon" style={{ margin: '0 auto 16px', width: 44, height: 44, fontSize: 20 }}>
                A
              </div>
              <h3>Set New Password</h3>
              <p>Choose a secure password for your AlertFlow account.</p>
            </div>

            {error && (
              <div className="auth-alert error">
                <AlertCircle size={16} />
                <span>{error}</span>
              </div>
            )}

            {success ? (
              <div style={{ textAlign: 'center', padding: '16px 0' }}>
                <div style={{ display: 'inline-flex', padding: 12, borderRadius: '50%', background: 'rgba(16, 185, 129, 0.12)', color: 'var(--success)', marginBottom: 16 }}>
                  <CheckCircle2 size={36} />
                </div>
                <h4 style={{ fontSize: 18, color: 'var(--text-primary)', marginBottom: 8 }}>Password Reset Complete</h4>
                <p style={{ color: 'var(--text-secondary)', fontSize: 14, marginBottom: 24 }}>
                  Your password has been securely updated. You can now log in to AlertFlow.
                </p>
                <Link to="/login" className="btn btn-primary" style={{ display: 'inline-flex', width: '100%', justifyContent: 'center' }}>
                  Proceed to Sign In
                </Link>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="auth-form" noValidate>
                <div className="auth-field">
                  <label htmlFor="reset-password">New Password</label>
                  <div className="auth-input-container">
                    <Lock size={16} className="auth-input-icon" />
                    <input
                      id="reset-password"
                      type={showPassword ? 'text' : 'password'}
                      placeholder={`At least ${minPasswordLength} characters`}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      disabled={loading}
                      autoFocus
                      required
                    />
                    <button
                      type="button"
                      className="auth-toggle-pwd"
                      onClick={() => setShowPassword(!showPassword)}
                      tabIndex="-1"
                    >
                      {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  </div>
                </div>

                <div className="auth-field">
                  <label htmlFor="reset-confirm">Confirm New Password</label>
                  <div className="auth-input-container">
                    <KeyRound size={16} className="auth-input-icon" />
                    <input
                      id="reset-confirm"
                      type={showPassword ? 'text' : 'password'}
                      placeholder="Re-enter new password"
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      disabled={loading}
                      required
                    />
                  </div>
                </div>

                <button
                  type="submit"
                  className="btn btn-primary auth-submit-btn"
                  disabled={loading || !token}
                >
                  {loading ? 'Updating password...' : 'Reset Password'}
                </button>

                <div className="auth-mode-switch" style={{ textAlign: 'center', marginTop: 16 }}>
                  <Link to="/login" className="auth-link-bold">
                    Back to Sign In
                  </Link>
                </div>
              </form>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
