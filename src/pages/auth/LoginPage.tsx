import React, { useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { ArrowRight, Lock, Mail } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useAuth } from '@/contexts/AuthContext';

export function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { login, signup, isAuthenticated } = useAuth();

  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const redirectTo = (location.state as { from?: string } | null)?.from || '/';

  if (isAuthenticated) {
    return <Navigate to={redirectTo} replace />;
  }

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError('');
    setIsSubmitting(true);

    try {
      if (mode === 'signup') {
        if (password.length < 6) {
          setError('Password must be at least 6 characters.');
          setIsSubmitting(false);
          return;
        }
        if (password !== confirmPassword) {
          setError('Passwords do not match.');
          setIsSubmitting(false);
          return;
        }
        await signup(email, password, displayName);
      } else {
        await login(email, password);
      }
      navigate(redirectTo, { replace: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Login failed.';
      setError(message);
      setIsSubmitting(false);
    }
  };

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-background p-6">
      <div className="pointer-events-none absolute -top-24 -left-24 h-72 w-72 rounded-full bg-accent/20 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-24 -right-24 h-80 w-80 rounded-full bg-primary/20 blur-3xl" />

      <div className="grid w-full max-w-5xl items-center gap-8 lg:grid-cols-2">
        <div className="hidden space-y-6 lg:block">
          <img
            src="/images/khulisa-logo.png"
            alt="Khulisa Grow CRM"
            className="h-24 w-auto rounded-lg border border-border bg-black object-contain p-2"
          />
          <h1 className="font-display text-4xl font-bold tracking-tight text-foreground">
            Khulisa Grow CRM
          </h1>
          <p className="max-w-md text-muted-foreground">
            Manage leads, clients, projects, invoices, and commissions from one dashboard.
          </p>
        </div>

        <Card className="border-border/80 shadow-lg">
          <CardHeader>
            <CardTitle className="text-2xl">{mode === 'signup' ? 'Create account' : 'Welcome back'}</CardTitle>
            <CardDescription>
              {mode === 'signup' ? 'Create your Firebase account' : 'Log in with your Firebase account'}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <form onSubmit={handleSubmit} className="space-y-4">
              {mode === 'signup' && (
                <div className="space-y-2">
                  <Label htmlFor="displayName">Full name</Label>
                  <Input
                    id="displayName"
                    type="text"
                    autoComplete="name"
                    placeholder="Njabulo Dlamini"
                    value={displayName}
                    onChange={(event) => setDisplayName(event.target.value)}
                  />
                </div>
              )}

              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <div className="relative">
                  <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    id="email"
                    type="email"
                    autoComplete="email"
                    placeholder="njabulo@khulisamedia.co.za"
                    className="pl-9"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    required
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="password">Password</Label>
                <div className="relative">
                  <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    id="password"
                    type="password"
                    autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
                    placeholder="Your password"
                    className="pl-9"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    required
                  />
                </div>
              </div>

              {mode === 'signup' && (
                <div className="space-y-2">
                  <Label htmlFor="confirmPassword">Confirm password</Label>
                  <Input
                    id="confirmPassword"
                    type="password"
                    autoComplete="new-password"
                    placeholder="Confirm your password"
                    value={confirmPassword}
                    onChange={(event) => setConfirmPassword(event.target.value)}
                    required
                  />
                </div>
              )}

              {error && <p className="text-sm text-destructive">{error}</p>}

              <Button type="submit" className="w-full" disabled={isSubmitting}>
                {isSubmitting ? (mode === 'signup' ? 'Creating account...' : 'Signing in...') : mode === 'signup' ? 'Sign Up' : 'Log In'}
                {!isSubmitting && <ArrowRight className="ml-2 h-4 w-4" />}
              </Button>
            </form>

            <div className="text-center text-sm text-muted-foreground">
              {mode === 'signup' ? 'Already have an account?' : 'Need an account?'}{' '}
              <button
                type="button"
                className="font-semibold text-foreground underline underline-offset-4"
                onClick={() => {
                  setMode((current) => (current === 'signup' ? 'login' : 'signup'));
                  setError('');
                  setPassword('');
                  setConfirmPassword('');
                }}
              >
                {mode === 'signup' ? 'Log in' : 'Sign up'}
              </button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
