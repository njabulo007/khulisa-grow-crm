import React, { useMemo, useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { ArrowRight, Lock, Mail } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useAuth } from '@/contexts/AuthContext';
import { authService, DEV_AUTH_PASSWORD } from '@/services/authService';

export function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { login, isAuthenticated } = useAuth();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const users = useMemo(
    () => authService.getAll().filter((user) => user.isActive !== false),
    []
  );
  const redirectTo = (location.state as { from?: string } | null)?.from || '/';

  if (isAuthenticated) {
    return <Navigate to={redirectTo} replace />;
  }

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    setError('');
    setIsSubmitting(true);

    const ok = login(email, password);
    if (!ok) {
      setError('Invalid credentials or inactive account.');
      setIsSubmitting(false);
      return;
    }

    navigate(redirectTo, { replace: true });
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
            Log in or sign in to manage leads, clients, projects, invoices, and commissions from one dashboard.
          </p>
          <div className="rounded-lg border bg-card/70 p-4 text-sm text-muted-foreground">
            Dev auth is active now. Replace with Firebase Auth in `authService` for production.
          </div>
        </div>

        <Card className="border-border/80 shadow-lg">
          <CardHeader>
            <CardTitle className="text-2xl">Welcome back</CardTitle>
            <CardDescription>Log in with an active account</CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <form onSubmit={handleSubmit} className="space-y-4">
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
                    autoComplete="current-password"
                    placeholder="Your password"
                    className="pl-9"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    required
                  />
                </div>
              </div>

              {error && <p className="text-sm text-destructive">{error}</p>}

              <Button type="submit" className="w-full" disabled={isSubmitting}>
                {isSubmitting ? 'Signing in...' : 'Log In'}
                {!isSubmitting && <ArrowRight className="ml-2 h-4 w-4" />}
              </Button>
            </form>

            <div className="space-y-2 rounded-lg border bg-muted/30 p-3 text-xs text-muted-foreground">
              <p>
                Demo password for seeded users: <span className="font-semibold text-foreground">{DEV_AUTH_PASSWORD}</span>
              </p>
              <p>Quick fill (active users):</p>
              <div className="flex flex-wrap gap-2">
                {users.map((user) => (
                  <Button
                    key={user.id}
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setEmail(user.email);
                      setPassword(DEV_AUTH_PASSWORD);
                    }}
                  >
                    {user.name}
                  </Button>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
