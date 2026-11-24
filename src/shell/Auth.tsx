import { useEffect, useState } from 'react';
import { MIN_PASSWORD, signIn, signUp, signupOpen } from '../lib/session';
import { useStore } from '../lib/store';
import { Button, Segmented, Switch, TextInput } from '../ui/controls';
import { Icon } from '../ui/icons';
import { confirm } from '../ui/overlay';

/** Whether this browser has signed in before; a returning person lands on "Sign in". */
const RETURNING_KEY = 'tm.returning';

export function AuthScreen() {
  const canSignUp = useStore(signupOpen);
  const [mode, setMode] = useState<'in' | 'up'>(() => (localStorage.getItem(RETURNING_KEY) ? 'in' : 'up'));
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [samples, setSamples] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const creating = mode === 'up' && canSignUp;

  useEffect(() => {
    document.documentElement.dataset.tint = 'indigo';
  }, []);

  const submit = async () => {
    if (busy) return;
    setError('');
    setBusy(true);
    try {
      if (creating) await signUp({ name, email, password, samples });
      else await signIn(email, password);
      localStorage.setItem(RETURNING_KEY, '1');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
      setBusy(false);
    }
  };

  const forgot = () =>
    void confirm({
      title: 'Reset your password',
      message:
        'TrackMate doesn’t send email, so there is no reset link. Whoever deployed this TrackMate can set a new password by running “npm run reset-password” in the project folder.',
      alert: true,
    });

  return (
    <div className="auth">
      <div className="wallpaper" />
      <form
        className="auth-col"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <img className="auth-icon" src="icons/icon.svg" alt="" />
        <h1>TrackMate</h1>
        <p className="auth-tag">Links, tasks, notes and your calendar, kept in one place.</p>

        <div className="auth-card glass">
          {canSignUp && (
            <Segmented
              label="Sign in or create an account" full value={mode}
              onChange={(next) => {
                setMode(next);
                setError('');
              }}
              options={[{ value: 'in', label: 'Sign in' }, { value: 'up', label: 'Create account' }]}
            />
          )}
          {creating && (
            <TextInput label="Name" placeholder="Name" icon={<Icon.person />} value={name} onChange={setName} autoComplete="name" name="name" />
          )}
          <TextInput label="Email" placeholder="Email" type="email" icon={<Icon.mail />} value={email} onChange={setEmail} autoComplete="username" name="email" />
          <TextInput
            label="Password" placeholder={creating ? `Password (${MIN_PASSWORD}+ characters)` : 'Password'} type="password"
            icon={<Icon.lock />} value={password} onChange={setPassword}
            autoComplete={creating ? 'new-password' : 'current-password'} name="password"
          />
          {creating && (
            <div className="auth-sample">
              <span>Start with sample content</span>
              <Switch label="Start with sample content" checked={samples} onChange={setSamples} />
            </div>
          )}
          {error && (
            <div className="auth-error" role="alert">
              <Icon.warning />
              <span>{error}</span>
            </div>
          )}
          <Button type="submit" size="lg" full disabled={busy}>
            {busy ? 'One moment…' : creating ? 'Create account' : 'Sign in'}
          </Button>
        </div>

        {!creating && (
          <button type="button" className="auth-forgot" onClick={forgot}>
            Forgot password?
          </button>
        )}
        <p className="auth-note">
          <Icon.lock />
          <span>Your data is saved to your account and syncs across your devices.</span>
        </p>
      </form>
    </div>
  );
}
