'use client';

import { useState } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Lock, Save, AlertCircle, CheckCircle } from 'lucide-react';
import { isPasswordCompliant, PASSWORD_POLICY_MESSAGE } from '@/lib/auth/password-policy';

export function ChangePasswordForm() {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState({ type: '', text: '' });

  const handlePasswordChange = async (e: React.FormEvent) => {
    e.preventDefault();
    setMessage({ type: '', text: '' });

    if (newPassword !== confirmPassword) {
      setMessage({ type: 'error', text: 'New passwords do not match' });
      return;
    }

    if (!isPasswordCompliant(newPassword)) {
      setMessage({ type: 'error', text: PASSWORD_POLICY_MESSAGE });
      return;
    }

    setLoading(true);

    try {
      const res = await fetch('/api/profile/change-password', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPassword, newPassword }),
      });

      const data = await res.json();

      if (res.ok) {
        setMessage({ type: 'success', text: 'Password changed successfully!' });
        setCurrentPassword('');
        setNewPassword('');
        setConfirmPassword('');
      } else {
        setMessage({ type: 'error', text: data.error || 'Failed to change password' });
      }
    } catch {
      setMessage({ type: 'error', text: 'An error occurred' });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card className="p-6 max-w-md">
      <h2 className="text-base font-semibold text-gray-900 mb-5 flex items-center gap-2">
        <div className="rounded-lg bg-gray-100 p-2">
          <Lock className="h-4 w-4 text-gray-600" />
        </div>
        Change Password
      </h2>

      {message.text && (
        <div
          className={`mb-5 rounded-xl p-3.5 flex items-center gap-2.5 ring-1 animate-fade-in ${
            message.type === 'success'
              ? 'bg-emerald-50 text-emerald-700 ring-emerald-200'
              : 'bg-red-50 text-red-700 ring-red-200'
          }`}
        >
          {message.type === 'success' ? (
            <CheckCircle className="h-4 w-4 shrink-0" />
          ) : (
            <AlertCircle className="h-4 w-4 shrink-0" />
          )}
          <span className="text-sm font-medium">{message.text}</span>
        </div>
      )}

      <form onSubmit={handlePasswordChange} className="space-y-4">
        <Input
          label="Current Password"
          type="password"
          value={currentPassword}
          onChange={(e) => setCurrentPassword(e.target.value)}
          required
        />

        <Input
          label="New Password"
          type="password"
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
          placeholder="8+ characters incl. letter and number"
          required
        />

        <Input
          label="Confirm New Password"
          type="password"
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          required
        />

        <div className="pt-2">
          <Button type="submit" isLoading={loading}>
            <Save className="mr-2 h-4 w-4" />
            Update Password
          </Button>
        </div>
      </form>
    </Card>
  );
}