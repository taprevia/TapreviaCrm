'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { useToast } from '@/components/ui/toast';
import {
  Check,
  LayoutTemplate,
  Loader2,
  Pencil,
  SearchX,
  Users,
} from 'lucide-react';
import { DEFAULT_ALLOWED_TEMPLATES } from '@/lib/card-templates';
import { cn } from '@/lib/utils';

interface TemplateMeta {
  key: string;
  name: string;
  description: string;
}

interface UserRow {
  _id: string;
  name: string;
  email: string;
  profile?: { allowedTemplates?: string[] } | null;
}

export default function AdminTemplateAccessPage() {
  const { toast } = useToast();

  const [templates, setTemplates] = useState<TemplateMeta[]>([]);
  const [users, setUsers] = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [grants, setGrants] = useState<Record<string, Set<string>>>({});
  const [defaultUsers, setDefaultUsers] = useState<Set<string>>(new Set());
  const [savingId, setSavingId] = useState<string | null>(null);

  // Inline per-card rename (PATCH /api/admin/templates/:key)
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState('');
  const [savingKey, setSavingKey] = useState<string | null>(null);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [tplRes, usersRes] = await Promise.all([
        fetch('/api/admin/card-templates'),
        fetch('/api/admin/users'),
      ]);
      if (!tplRes.ok || !usersRes.ok) throw new Error('Failed to load template access data');
      const tplData: { templates?: TemplateMeta[] } = await tplRes.json();
      const usersData: { users?: UserRow[] } = await usersRes.json();

      const rows = usersData.users ?? [];
      setTemplates(tplData.templates ?? []);
      setUsers(rows);

      const next: Record<string, Set<string>> = {};
      const defaults = new Set<string>();
      for (const u of rows) {
        const allowed = u.profile?.allowedTemplates;
        const explicit = Array.isArray(allowed) && allowed.length > 0;
        next[u._id] = new Set(explicit ? allowed : DEFAULT_ALLOWED_TEMPLATES);
        if (!explicit) defaults.add(u._id);
      }
      setGrants(next);
      setDefaultUsers(defaults);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load template access data');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchAll();
  }, [fetchAll]);

  const startEditName = (tpl: TemplateMeta) => {
    setEditingKey(tpl.key);
    setEditDraft(tpl.name);
  };

  const cancelEditName = () => {
    setEditingKey(null);
    setEditDraft('');
  };

  const saveName = async (tpl: TemplateMeta) => {
    const name = editDraft.trim();
    if (!name) {
      toast({
        title: 'Name required',
        description: 'Template name cannot be empty.',
        variant: 'error',
      });
      return;
    }
    setSavingKey(tpl.key);
    try {
      const res = await fetch(`/api/admin/templates/${encodeURIComponent(tpl.key)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      const data: { error?: string } = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || 'Failed to update template name');
      // Local state update only — no page refresh.
      setTemplates((prev) => prev.map((t) => (t.key === tpl.key ? { ...t, name } : t)));
      setEditingKey(null);
      setEditDraft('');
      toast({ title: 'Saved', description: 'Template name updated.', variant: 'success' });
    } catch (err) {
      toast({
        title: 'Could not update',
        description: err instanceof Error ? err.message : 'Something went wrong.',
        variant: 'error',
      });
    } finally {
      setSavingKey(null);
    }
  };

  const toggle = useCallback((userId: string, key: string) => {
    setGrants((prev) => {
      const nextSet = new Set(prev[userId] ?? []);
      if (nextSet.has(key)) nextSet.delete(key);
      else nextSet.add(key);
      return { ...prev, [userId]: nextSet };
    });
  }, []);

  const saveGrants = async (userId: string) => {
    const keys = Array.from(grants[userId] ?? []);
    setSavingId(userId);
    try {
      const res = await fetch(`/api/admin/users/${userId}/templates`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ allowedTemplates: keys }),
      });
      const data: { error?: string } = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || 'Failed to save grants');
      setDefaultUsers((prev) => {
        const nextSet = new Set(prev);
        nextSet.delete(userId);
        return nextSet;
      });
      toast({ title: 'Saved', description: 'Template access updated.', variant: 'success' });
    } catch (err) {
      toast({
        title: 'Could not save',
        description: err instanceof Error ? err.message : 'Something went wrong.',
        variant: 'error',
      });
    } finally {
      setSavingId(null);
    }
  };

  const filteredUsers = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return users;
    return users.filter(
      (u) => u.name?.toLowerCase().includes(q) || u.email?.toLowerCase().includes(q)
    );
  }, [users, search]);

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-ink tracking-tight">Template Access</h1>
          <p className="text-ink-mute text-sm mt-0.5">
            Grant each customer the card templates they can switch between.
          </p>
          <p className="text-ink-mute/80 text-xs mt-1 max-w-2xl">
            Templates are TSX layouts registered in code. Customers with no explicit grant keep the
            default set ({DEFAULT_ALLOWED_TEMPLATES.join(', ')}).
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void fetchAll()} disabled={loading}>
          <Loader2 className={cn('h-4 w-4 mr-1.5', loading && 'animate-spin')} />
          Refresh
        </Button>
      </div>

      {/* Template catalog reference */}
      <div className="grid gap-4 sm:grid-cols-3">
        {templates.map((tpl) => {
          const isEditing = editingKey === tpl.key;
          return (
            <Card
              key={tpl.key}
              className="p-4 bg-surface border-transparent ring-1 ring-line-subtle"
            >
              <div className="flex items-start gap-2 mb-1">
                <LayoutTemplate
                  className="h-4 w-4 text-accent-400 mt-0.5 shrink-0"
                  aria-hidden="true"
                />
                <div className="min-w-0 flex-1">
                  {isEditing ? (
                    <Input
                      value={editDraft}
                      maxLength={40}
                      autoFocus
                      onChange={(e) => setEditDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') void saveName(tpl);
                        if (e.key === 'Escape') cancelEditName();
                      }}
                      aria-label="Template name"
                    />
                  ) : (
                    <h3 className="font-semibold text-ink truncate" title={tpl.name}>
                      {tpl.name}
                    </h3>
                  )}
                </div>
              </div>
              <p className="text-xs font-mono text-ink-faint">/{tpl.key}</p>
              <p className="text-sm text-ink-mute mt-1.5 line-clamp-2">{tpl.description}</p>
              <div className="mt-3 flex justify-end gap-2">
                {isEditing ? (
                  <>
                    <Button variant="outline" size="sm" onClick={cancelEditName}>
                      Cancel
                    </Button>
                    <Button
                      size="sm"
                      onClick={() => void saveName(tpl)}
                      isLoading={savingKey === tpl.key}
                    >
                      Save
                    </Button>
                  </>
                ) : (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => startEditName(tpl)}
                    title="Edit name"
                  >
                    <Pencil className="h-3.5 w-3.5 mr-1.5" />
                    Edit Name
                  </Button>
                )}
              </div>
            </Card>
          );
        })}
      </div>

      {/* Grant matrix */}
      <Card className="overflow-hidden bg-surface border-transparent ring-1 ring-line-subtle">
        <div className="p-4 sm:p-5 border-b border-line-subtle">
          <h2 className="text-base font-semibold text-ink">Customer permissions</h2>
          <div className="mt-3 max-w-sm">
            <Input
              placeholder="Search by name or email…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </div>

        {error && (
          <div className="flex items-center justify-between gap-4 p-4">
            <p className="text-sm text-red-400">{error}</p>
            <Button variant="outline" size="sm" onClick={() => void fetchAll()}>
              Retry
            </Button>
          </div>
        )}

        {loading ? (
          <div className="space-y-3 p-5">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="skeleton h-12 rounded-lg" />
            ))}
          </div>
        ) : filteredUsers.length === 0 ? (
          <div className="p-12 text-center">
            <SearchX className="h-8 w-8 text-ink-faint mx-auto mb-3" />
            <p className="text-sm font-medium text-ink">No customers found</p>
            <p className="text-sm text-ink-mute mt-1">Create a customer to manage template access.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line-subtle text-left text-xs uppercase tracking-wide text-ink-faint">
                  <th className="px-4 py-3 font-medium min-w-[220px]">Customer</th>
                  {templates.map((tpl) => (
                    <th key={tpl.key} className="px-3 py-3 font-medium text-center whitespace-nowrap">
                      {tpl.name}
                    </th>
                  ))}
                  <th className="px-4 py-3 font-medium text-right min-w-[96px]">Save</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line-subtle">
                {filteredUsers.map((user) => {
                  const grantSet = grants[user._id] ?? new Set<string>();
                  const isDefault = defaultUsers.has(user._id);
                  const isDirty =
                    !isDefault &&
                    Array.from(grantSet).sort().join() !==
                      Array.from(new Set(user.profile?.allowedTemplates ?? [])).sort().join();
                  return (
                    <tr key={user._id} className="hover:bg-bg-raised/60">
                      <td className="px-4 py-3">
                        <p className="font-medium text-ink truncate max-w-[220px]">{user.name || '—'}</p>
                        <p className="text-xs text-ink-mute truncate max-w-[220px]">{user.email || ''}</p>
                        {isDefault && (
                          <Badge variant="default" className="mt-1.5 bg-field text-ink-faint ring-line-subtle">
                            Default set
                          </Badge>
                        )}
                      </td>
                      {templates.map((tpl) => {
                        const checked = grantSet.has(tpl.key);
                        return (
                          <td key={tpl.key} className="px-3 py-3 text-center">
                            <button
                              type="button"
                              role="checkbox"
                              aria-checked={checked}
                              aria-label={`${tpl.name} for ${user.name || user.email}`}
                              onClick={() => toggle(user._id, tpl.key)}
                              className={cn(
                                'inline-flex h-6 w-6 items-center justify-center rounded-md border transition-colors',
                                checked
                                  ? 'border-accent-600 bg-accent-600 text-white'
                                  : 'border-line-subtle bg-field text-transparent hover:border-accent-500/40'
                              )}
                            >
                              <Check className="h-4 w-4" aria-hidden="true" />
                            </button>
                          </td>
                        );
                      })}
                      <td className="px-4 py-3 text-right">
                        <Button
                          size="sm"
                          variant={isDirty ? 'primary' : 'outline'}
                          onClick={() => saveGrants(user._id)}
                          disabled={savingId === user._id}
                          isLoading={savingId === user._id}
                        >
                          {!isDirty && savingId !== user._id && <Users className="h-4 w-4 mr-1.5" />}
                          Save
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}