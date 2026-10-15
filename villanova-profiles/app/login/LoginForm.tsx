'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition, type FormEvent } from 'react';
import { sendCode, verifyCode } from '../actions';
import { buttonClass, Field, Message, TextInput } from '../ui';

export function LoginForm() {
  const router = useRouter();
  const [step, setStep] = useState<'email' | 'code'>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function onSendCode(e: FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const res = await sendCode(email);
      if (res.ok) setStep('code');
      else setError(res.error);
    });
  }

  function onVerify(e: FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const res = await verifyCode(email, code);
      if (res.ok) router.replace('/profile');
      else setError(res.error);
    });
  }

  if (step === 'email') {
    return (
      <form onSubmit={onSendCode} className="space-y-4">
        <Field label="Villanova email" htmlFor="email">
          <TextInput id="email" type="email" required autoComplete="email" placeholder="you@villanova.edu" value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        {error ? <Message kind="error">{error}</Message> : null}
        <button type="submit" className={`${buttonClass} w-full`} disabled={pending}>
          {pending ? 'Sending…' : 'Email me a code'}
        </button>
      </form>
    );
  }

  return (
    <form onSubmit={onVerify} className="space-y-4">
      <p className="text-sm text-soft">
        We sent a 6-digit code to <span className="font-medium text-ink">{email.trim().toLowerCase()}</span>.
      </p>
      <Field label="6-digit code" htmlFor="code">
        <TextInput id="code" inputMode="numeric" autoComplete="one-time-code" pattern="\d{6}" maxLength={6} required placeholder="123456" autoFocus value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} />
      </Field>
      {error ? <Message kind="error">{error}</Message> : null}
      <button type="submit" className={`${buttonClass} w-full`} disabled={pending}>
        {pending ? 'Checking…' : 'Verify and continue'}
      </button>
      <button
        type="button"
        onClick={() => {
          setStep('email');
          setCode('');
          setError(null);
        }}
        className="w-full text-sm text-soft underline-offset-4 hover:underline"
      >
        Use a different email
      </button>
    </form>
  );
}
