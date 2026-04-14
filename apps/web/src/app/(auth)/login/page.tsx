"use client";

import { useState, FormEvent } from "react";
import { useRouter } from "next/navigation";
import { authApi } from "@/lib/api-client";
import { saveToken } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { FormField, Input } from "@/components/ui/form";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await authApi.login(email, password);
      saveToken(res.token);
      router.push("/dashboard");
    } catch (err) {
      setError((err as Error).message ?? "Login failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm">
        {/* Brand */}
        <div className="text-center mb-8">
          <h1 className="text-xl font-bold text-primary">Treasury OS</h1>
          <p className="text-sm text-muted-foreground mt-1">Stablecoin Operations Platform</p>
        </div>

        {/* Form */}
        <div className="rounded-lg border border-border bg-card p-6 shadow-sm">
          <form onSubmit={handleSubmit} className="space-y-4">
            <FormField label="Email">
              <Input
                type="email"
                placeholder="ops@treasury.io"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </FormField>
            <FormField label="Password">
              <Input
                type="password"
                placeholder="••••••••"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </FormField>
            {error && (
              <p className="text-xs text-critical rounded bg-critical/10 px-3 py-2">{error}</p>
            )}
            <Button type="submit" className="w-full" loading={loading}>
              Sign In
            </Button>
          </form>
        </div>

        <p className="text-center text-xs text-muted-foreground mt-6">
          Authorized personnel only · All activity is logged
        </p>
      </div>
    </div>
  );
}
