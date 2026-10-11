import React, { useState } from 'react';
import { useNavigate, useLocation, Navigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { api } from '../api/client';
import {
  Shield,
  Eye,
  EyeOff,
  AlertCircle,
  CheckCircle2,
  Lock,
  Mail,
  User,
  ArrowRight,
  KeyRound,
  Activity,
  Layers,
  BellRing
} from 'lucide-react';

export default function Login() {
  const { user, login, register, authConfig } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const [mode, setMode] = useState('login'); // 'login' | 'register' | 'forgot'
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [successMessage, setSuccessMessage] = useState('');

  // Destination after successful login
  const from = location.state?.from?.pathname || '/';

  // If already authenticated, redirect
  if (user) {
    return <Navigate to={from} replace />;
  }

  const minPasswordLength = authConfig?.passwordMinLength || 12;
  const isRegistrationEnabled = authConfig?.registrationEnabled !== false;

  const validateLoginForm = () => {
    if (!email.trim()) {
      setError('Please enter your email address');
      return false;
    }
    if (!password) {
      setError('Please enter your password');
      return false;
    }
    return true;
  };

  const validateRegisterForm = () => {
    if (!name.trim()) {
      setError('Please enter your full name');
      return false;
    }
    if (!email.trim() || !/^\S+@\S+\.\S+$/.test(email.trim())) {
      setError('Please enter a valid email address');
      return false;
    }
    if (password.length < minPasswordLength) {
      setError(`Password must be at least ${minPasswordLength} characters long`);
      return false;
    }
    if (!/[A-Z]/.test(password) || !/[a-z]/.test(password) || !/[0-9\W_]/.test(password)) {
      setError('Password must contain uppercase, lowercase, and a number or special character');
      return false;
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match');
      return false;
    }
    return true;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setSuccessMessage('');

    if (mode === 'login') {
      if (!validateLoginForm()) return;
      setLoading(true);
      try {
        await login(email.trim(), password);
        navigate(from, { replace: true });
      } catch (err) {
        setError(err.message || 'Invalid email or password');
      } finally {
        setLoading(false);
      }
    } else if (mode === 'register') {
      if (!validateRegisterForm()) return;
      setLoading(true);
      try {
        await register(name.trim(), email.trim(), password);
        navigate(from, { replace: true });
      } catch (err) {
        setError(err.message || 'Registration failed');
      } finally {
        setLoading(false);
      }
    } else if (mode === 'forgot') {
      if (!email.trim()) {
        setError('Please enter your email address');
        return;
      }
      setLoading(true);
      try {
        const res = await api.forgotPassword(email.trim());
        setSuccessMessage(res.message || 'If an account exists with that email, instructions have been sent.');
      } catch (err) {
        setError(err.message || 'Unable to process password reset request');
      } finally {
        setLoading(false);
      }
    }
  };

  // Password requirement indicators
  const hasMinLength = password.length >= minPasswordLength;
  const hasUpper = /[A-Z]/.test(password);
  const hasLower = /[a-z]/.test(password);
  const hasDigitOrSpecial = /[0-9\W_]/.test(password);

  return (
    <div className="login-page-container">
      <div className="login-card-wrapper">
        {/* Left / Top Branding Panel */}
        <div className="login-branding-panel">
          <div className="branding-header">
            <div className="branding-logo">
              <div className="sidebar-logo-icon">A</div>
              <span className="branding-title">AlertFlow</span>
            </div>
            <div className="branding-badge">v1.0 Enterprise</div>
          </div>

          <div className="branding-hero">
            <h2>Unified Incident Management & Operations</h2>
            <p>
              Real-time alert correlation, intelligent escalation routing, and resilient on-call orchestration designed for mission-critical infrastructure.
            </p>
          </div>

          <div className="branding-features">
            <div className="branding-feature-item">
              <div className="feature-icon"><Activity size={18} /></div>
              <div>
                <strong>Automated Alert Correlation</strong>
                <span>Deduplicate alarms and suppress background noise</span>
              </div>
            </div>
            <div className="branding-feature-item">
              <div className="feature-icon"><BellRing size={18} /></div>
              <div>
                <strong>Dynamic Escalation Policies</strong>
                <span>Never miss high-severity critical production outages</span>
              </div>
            </div>
            <div className="branding-feature-item">
              <div className="feature-icon"><Layers size={18} /></div>
              <div>
                <strong>Real-Time Team Orchestration</strong>
                <span>Synchronized WebSockets and audit-trailed triage</span>
              </div>
            </div>
          </div>

          <div className="branding-footer">
            <span>Enterprise Security • Encrypted Sessions • SOC2 Compliant Architecture</span>
          </div>
        </div>

        {/* Right Form Panel */}
        <div className="login-form-panel">
          <div className="form-card-inner">
            <div className="form-header">
              <h3>
                {mode === 'login' && 'Sign in to your account'}
                {mode === 'register' && 'Create your account'}
                {mode === 'forgot' && 'Reset your password'}
              </h3>
              <p>
                {mode === 'login' && 'Enter your credentials to access your operations dashboard.'}
                {mode === 'register' && 'Register your profile to join your engineering team.'}
                {mode === 'forgot' && 'Enter your email address to receive reset instructions.'}
              </p>
            </div>

            {/* Error & Success Messages */}
            {error && (
              <div className="auth-alert error">
                <AlertCircle size={16} />
                <span>{error}</span>
              </div>
            )}

            {successMessage && (
              <div className="auth-alert success">
                <CheckCircle2 size={16} />
                <span>{successMessage}</span>
              </div>
            )}

            <form onSubmit={handleSubmit} className="auth-form" noValidate>
              {/* Name (Registration Only) */}
              {mode === 'register' && (
                <div className="auth-field">
                  <label htmlFor="auth-name">Full Name</label>
                  <div className="auth-input-container">
                    <User size={16} className="auth-input-icon" />
                    <input
                      id="auth-name"
                      type="text"
                      placeholder="e.g. Alex Morgan"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      disabled={loading}
                      autoFocus
                      required
                    />
                  </div>
                </div>
              )}

              {/* Email (All modes) */}
              <div className="auth-field">
                <label htmlFor="auth-email">Email Address</label>
                <div className="auth-input-container">
                  <Mail size={16} className="auth-input-icon" />
                  <input
                    id="auth-email"
                    type="email"
                    placeholder="name@company.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    disabled={loading}
                    autoComplete="email"
                    autoFocus={mode !== 'register'}
                    required
                  />
                </div>
              </div>

              {/* Password (Login & Register) */}
              {mode !== 'forgot' && (
                <div className="auth-field">
                  <div className="auth-field-header">
                    <label htmlFor="auth-password">Password</label>
                    {mode === 'login' && (
                      <button
                        type="button"
                        className="auth-link-subtle"
                        onClick={() => {
                          setMode('forgot');
                          setError('');
                          setSuccessMessage('');
                        }}
                      >
                        Forgot password?
                      </button>
                    )}
                  </div>
                  <div className="auth-input-container">
                    <Lock size={16} className="auth-input-icon" />
                    <input
                      id="auth-password"
                      type={showPassword ? 'text' : 'password'}
                      placeholder={mode === 'register' ? `Minimum ${minPasswordLength} characters` : '••••••••••••'}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      disabled={loading}
                      autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                      required
                    />
                    <button
                      type="button"
                      className="auth-toggle-pwd"
                      onClick={() => setShowPassword(!showPassword)}
                      tabIndex="-1"
                      aria-label={showPassword ? 'Hide password' : 'Show password'}
                    >
                      {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  </div>

                  {/* Password Strength Checklist for Registration */}
                  {mode === 'register' && password && (
                    <div className="password-checklist">
                      <div className={`check-item ${hasMinLength ? 'met' : ''}`}>
                        <span className="bullet">{hasMinLength ? '✓' : '•'}</span>
                        At least {minPasswordLength} characters
                      </div>
                      <div className={`check-item ${hasUpper ? 'met' : ''}`}>
                        <span className="bullet">{hasUpper ? '✓' : '•'}</span>
                        At least one uppercase letter
                      </div>
                      <div className={`check-item ${hasLower ? 'met' : ''}`}>
                        <span className="bullet">{hasLower ? '✓' : '•'}</span>
                        At least one lowercase letter
                      </div>
                      <div className={`check-item ${hasDigitOrSpecial ? 'met' : ''}`}>
                        <span className="bullet">{hasDigitOrSpecial ? '✓' : '•'}</span>
                        At least one number or symbol
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Confirm Password (Register Only) */}
              {mode === 'register' && (
                <div className="auth-field">
                  <label htmlFor="auth-confirm-password">Confirm Password</label>
                  <div className="auth-input-container">
                    <KeyRound size={16} className="auth-input-icon" />
                    <input
                      id="auth-confirm-password"
                      type={showPassword ? 'text' : 'password'}
                      placeholder="Re-enter password"
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      disabled={loading}
                      required
                    />
                  </div>
                </div>
              )}

              {/* Submit Button */}
              <button
                type="submit"
                className="btn btn-primary auth-submit-btn"
                disabled={loading}
              >
                {loading ? (
                  <span className="btn-spinner-content">
                    <span className="spinner-dot" />
                    {mode === 'login' && 'Signing in...'}
                    {mode === 'register' && 'Creating account...'}
                    {mode === 'forgot' && 'Sending instructions...'}
                  </span>
                ) : (
                  <span className="btn-label-content">
                    {mode === 'login' && 'Sign In to AlertFlow'}
                    {mode === 'register' && 'Create Account'}
                    {mode === 'forgot' && 'Send Recovery Instructions'}
                    <ArrowRight size={16} />
                  </span>
                )}
              </button>
            </form>

            {/* Mode Switchers */}
            <div className="auth-mode-switch">
              {mode === 'login' && isRegistrationEnabled && (
                <p>
                  Don't have an account?{' '}
                  <button
                    type="button"
                    className="auth-link-bold"
                    onClick={() => {
                      setMode('register');
                      setError('');
                      setSuccessMessage('');
                    }}
                  >
                    Create an account
                  </button>
                </p>
              )}

              {mode === 'register' && (
                <p>
                  Already have an account?{' '}
                  <button
                    type="button"
                    className="auth-link-bold"
                    onClick={() => {
                      setMode('login');
                      setError('');
                      setSuccessMessage('');
                    }}
                  >
                    Sign in here
                  </button>
                </p>
              )}

              {mode === 'forgot' && (
                <p>
                  Remember your password?{' '}
                  <button
                    type="button"
                    className="auth-link-bold"
                    onClick={() => {
                      setMode('login');
                      setError('');
                      setSuccessMessage('');
                    }}
                  >
                    Back to sign in
                  </button>
                </p>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
