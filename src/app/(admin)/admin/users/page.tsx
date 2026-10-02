'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Modal } from '@/components/ui/modal';
import { Search, Download, ShieldCheck, ShieldOff, Trash2, UserPlus, CreditCard, Users, Eye, Package, QrCode, Tag, Pencil, KeyRound } from 'lucide-react';
import { STANDEE_PLATFORMS, getStandeePlatformById } from '@/lib/constants';
import { getFixedStandeeProfiles } from '@/config/products';
import { isPasswordCompliant, PASSWORD_POLICY_MESSAGE } from '@/lib/auth/password-policy';

interface User {
  _id: string;
  name: string;
  email: string;
  phone?: string;
  customerId?: string;
  role: string;
  status: string;
  createdAt: string;
  profile?: {
    personalInfo: { fullName: string; jobTitle: string };
    companyInfo: { companyName: string };
  };
  card?: {
    _id?: string;
    slug: string;
    status: string;
    stats?: { taps?: number };
  };
  cards?: Array<{
    _id: string;
    cardUid: string;
    slug: string;
    templateKey?: string;
    status: string;
    stats?: { taps?: number };
  }>;
}

interface CatalogProductLite {
  _id: string;
  name: string;
  category: 'card' | 'standee' | 'other';
  slug?: string;
  priceMinor: number;
  currency: string;
  active: boolean;
}

export default function AdminUsersPage() {
  const router = useRouter();
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ name: '', email: '', password: '', urlSlug: '' });
  const [catalogItems, setCatalogItems] = useState<CatalogProductLite[]>([]);
  const [selectedProductIds, setSelectedProductIds] = useState<string[]>([]);
  const [productCardUids, setProductCardUids] = useState<Record<string, string>>({});
  const [productPlatforms, setProductPlatforms] = useState<Record<string, string[]>>({});
  const [skipCardUids, setSkipCardUids] = useState<Record<string, boolean>>({});
  const [formError, setFormError] = useState('');

  // Edit credentials modal
  const [showEditModal, setShowEditModal] = useState(false);
  const [editTarget, setEditTarget] = useState<User | null>(null);
  const [editForm, setEditForm] = useState({ name: '', email: '', phone: '' });
  const [editError, setEditError] = useState('');
  const [savingEdit, setSavingEdit] = useState(false);

  // Reset password modal
  const [showResetModal, setShowResetModal] = useState(false);
  const [resetTarget, setResetTarget] = useState<User | null>(null);
  const [resetMode, setResetMode] = useState<'email' | 'temp'>('email');
  const [tempPassword, setTempPassword] = useState('');
  const [resetError, setResetError] = useState('');
  const [resetResult, setResetResult] = useState<null | 'email' | 'temp'>(null);
  const [savingReset, setSavingReset] = useState(false);

  const toggleProduct = (product: CatalogProductLite) => {
    setSelectedProductIds((prev) => {
      if (prev.includes(product._id)) {
        return prev.filter((id) => id !== product._id);
      }
      if (product.category === 'standee') {
        const preset =
          product.slug ? getFixedStandeeProfiles(product.slug) : null;
        setProductPlatforms((m) => ({
          ...m,
          [product._id]:
            m[product._id] ??
            (preset
              ? preset.profiles
              : STANDEE_PLATFORMS.map((p) => p.id as string)),
        }));
      }
      if (product.category === 'card') {
        setProductCardUids((m) => ({ ...m, [product._id]: m[product._id] ?? '' }));
      }
      return [...prev, product._id];
    });
  };

  const toggleCreatePlatform = (productId: string, id: string) => {
    setProductPlatforms((m) => ({
      ...m,
      [productId]: (m[productId] ?? []).includes(id)
        ? (m[productId] ?? []).filter((p) => p !== id)
        : [...(m[productId] ?? []), id],
    }));
  };

  const fetchUsers = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (search) params.set('search', search);
      const res = await fetch(`/api/admin/users?${params}`);
      if (res.ok) {
        const data = await res.json();
        setUsers(data.users);
      }
    } catch (error) {
      console.error('Failed to fetch users:', error);
    } finally {
      setLoading(false);
    }
  }, [search]);

  useEffect(() => {
    fetchUsers();
  }, [fetchUsers]);

  const fetchActiveCatalog = async () => {
    try {
      const res = await fetch('/api/admin/catalog');
      if (res.ok) {
        const data = await res.json();
        setCatalogItems((data.catalog || []).filter((p: CatalogProductLite) => p.active));
      }
    } catch (error) {
      console.error('Failed to fetch catalog:', error);
    }
  };

  const openCreateModal = () => {
    setForm({ name: '', email: '', password: '', urlSlug: '' });
    setSelectedProductIds([]);
    setProductCardUids({});
    setProductPlatforms({});
    setSkipCardUids({});
    setFormError('');
    setShowCreateModal(true);
    fetchActiveCatalog();
  };

  const handleCreate = async () => {
    setFormError('');
    if (!form.name.trim() || !form.email.trim() || !form.password.trim()) {
      setFormError('Name, email, and password are required');
      return;
    }
    if (!isPasswordCompliant(form.password)) {
      setFormError(PASSWORD_POLICY_MESSAGE);
      return;
    }
    for (const id of selectedProductIds) {
      const item = catalogItems.find((c) => c._id === id);
      if (!item) continue;
      if (item.category === 'card' && !skipCardUids[id] && !(productCardUids[id] ?? '').trim()) {
        setFormError(`Enter the NFC Card UID for ${item.name}`);
        return;
      }
      if (item.category === 'standee' && (productPlatforms[id] ?? []).length === 0) {
        setFormError(`Select at least one platform for ${item.name}`);
        return;
      }
    }

    const products = selectedProductIds
      .map((id) => {
        const item = catalogItems.find((c) => c._id === id);
        if (!item) return null;
        return {
          catalogProductId: id,
          ...(item.category === 'card' && !skipCardUids[id] ? { cardUid: productCardUids[id].trim() } : {}),
          ...(item.category === 'standee' ? { platforms: productPlatforms[id] ?? [] } : {}),
        };
      })
      .filter(Boolean);

    setCreating(true);
    try {
      const res = await fetch('/api/admin/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, products }),
      });

      const data = await res.json();
      if (!res.ok) {
        const message =
          data.error ||
          (data.details && typeof data.details.fieldErrors === 'object'
            ? Object.values(data.details.fieldErrors)
                .flat()
                .filter(Boolean)
                .join('. ')
            : undefined) ||
          'Failed to create customer';
        setFormError(message);
        return;
      }

      setShowCreateModal(false);
      fetchUsers();
    } catch (error) {
      setFormError('An error occurred');
      console.error('Create user failed:', error);
    } finally {
      setCreating(false);
    }
  };

  const handleExport = async () => {
    try {
      const res = await fetch('/api/admin/export?type=users');
      if (res.ok) {
        const blob = await res.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'users-export.csv';
        a.click();
        window.URL.revokeObjectURL(url);
      }
    } catch (error) {
      console.error('Export failed:', error);
    }
  };

  const handleStatusToggle = async (user: User) => {
    const newStatus = user.status === 'active' ? 'suspended' : 'active';
    if (!confirm(`Are you sure you want to ${newStatus === 'suspended' ? 'suspend' : 'activate'} ${user.name}?`)) return;

    try {
      const res = await fetch(`/api/admin/users/${user._id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'updateStatus', status: newStatus }),
      });
      if (res.ok) fetchUsers();
    } catch (error) {
      console.error('Status update failed:', error);
    }
  };

  const handleDelete = async (user: User) => {
    if (!confirm(`Are you sure you want to DELETE ${user.name}? This cannot be undone.`)) return;

    try {
      const res = await fetch(`/api/admin/users/${user._id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'delete' }),
      });
      if (res.ok) fetchUsers();
    } catch (error) {
      console.error('Delete failed:', error);
    }
  };

  const openEditModal = (user: User) => {
    setEditTarget(user);
    setEditForm({ name: user.name, email: user.email, phone: user.phone ?? '' });
    setEditError('');
    setShowEditModal(true);
  };

  const handleSaveCredentials = async () => {
    if (!editTarget) return;
    if (!editForm.name.trim()) {
      setEditError('Name is required');
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(editForm.email.trim())) {
      setEditError('Enter a valid email address');
      return;
    }
    setSavingEdit(true);
    setEditError('');
    try {
      const res = await fetch(`/api/admin/users/${editTarget._id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: editForm.name.trim(),
          email: editForm.email.trim(),
          phone: editForm.phone.trim(),
        }),
      });
      const data = (await res.json().catch(() => null)) as ({ error?: string } & Record<string, unknown>) | null;
      if (!res.ok) {
        setEditError(data?.error || 'Failed to save credentials');
        return;
      }
      setShowEditModal(false);
      fetchUsers();
    } catch (error) {
      console.error('Save credentials failed:', error);
      setEditError('An error occurred');
    } finally {
      setSavingEdit(false);
    }
  };

  const openResetModal = (user: User) => {
    setResetTarget(user);
    setResetMode('email');
    setTempPassword('');
    setResetError('');
    setResetResult(null);
    setShowResetModal(true);
  };

  const handleResetPassword = async () => {
    if (!resetTarget) return;
    if (resetMode === 'temp' && !isPasswordCompliant(tempPassword)) {
      setResetError(PASSWORD_POLICY_MESSAGE);
      return;
    }
    setSavingReset(true);
    setResetError('');
    setResetResult(null);
    try {
      const res = await fetch(`/api/admin/users/${resetTarget._id}/reset-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          resetMode === 'temp' ? { mode: 'temp', password: tempPassword } : { mode: 'email' }
        ),
      });
      const data = (await res.json().catch(() => null)) as ({ error?: string } & Record<string, unknown>) | null;
      if (!res.ok) {
        setResetError(data?.error || 'Failed to reset password');
        return;
      }
      setResetResult(resetMode);
      setTempPassword('');
    } catch (error) {
      console.error('Reset password failed:', error);
      setResetError('An error occurred');
    } finally {
      setSavingReset(false);
    }
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-ink tracking-tight">Users Management</h1>
          <p className="text-ink-mute text-sm mt-0.5">Create and manage customer accounts</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={handleExport}>
            <Download className="mr-2 h-4 w-4" />
            Export CSV
          </Button>
          <Button onClick={openCreateModal}>
            <UserPlus className="mr-2 h-4 w-4" />
            Create Customer
          </Button>
        </div>
      </div>

      <Card className="p-4 bg-surface border-transparent ring-1 ring-line-subtle">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-faint" />
          <Input
            placeholder="Search users by name or email..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-10 bg-field border-line text-ink placeholder:text-ink-faint hover:border-line-strong focus:border-accent-500 focus:ring-accent-500/25"
          />
        </div>
      </Card>

      <Card className="bg-surface border-transparent ring-1 ring-line-subtle">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-line-subtle">
                <th className="px-5 py-3.5 text-left text-xs font-semibold text-ink-faint uppercase tracking-wider">User</th>
                <th className="px-5 py-3.5 text-left text-xs font-semibold text-ink-faint uppercase tracking-wider">Company</th>
                <th className="px-5 py-3.5 text-left text-xs font-semibold text-ink-faint uppercase tracking-wider">Card</th>
                <th className="px-5 py-3.5 text-left text-xs font-semibold text-ink-faint uppercase tracking-wider">Status</th>
                <th className="px-5 py-3.5 text-left text-xs font-semibold text-ink-faint uppercase tracking-wider">Taps</th>
                <th className="px-5 py-3.5 text-left text-xs font-semibold text-ink-faint uppercase tracking-wider">Joined</th>
                <th className="px-5 py-3.5 text-left text-xs font-semibold text-ink-faint uppercase tracking-wider">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line-subtle">
              {loading ? (
                Array.from({ length: 4 }).map((_, i) => (
                  <tr key={i}>
                    <td colSpan={7} className="px-5 py-4">
                      <div className="flex items-center gap-3">
                        <div className="skeleton h-10 w-10 rounded-full" />
                        <div className="space-y-2">
                          <div className="skeleton h-3 w-24" />
                          <div className="skeleton h-3 w-32" />
                        </div>
                      </div>
                    </td>
                  </tr>
                ))
              ) : users.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-5 py-16 text-center">
                    <div className="flex flex-col items-center">
                      <div className="rounded-full bg-field p-4 mb-4">
                        <Users className="h-8 w-8 text-ink-faint" />
                      </div>
                      <p className="text-sm font-medium text-ink">No customers yet</p>
                      <p className="text-sm text-ink-mute mt-1">Create your first customer account to get started</p>
                      <Button size="sm" className="mt-4" onClick={openCreateModal}>
                        <UserPlus className="mr-2 h-4 w-4" />
                        Create Customer
                      </Button>
                    </div>
                  </td>
                </tr>
              ) : (
                users.map((user) => (
                  <tr key={user._id} className="hover:bg-white/5 transition-colors cursor-pointer" onClick={() => router.push(`/admin/users/${user._id}`)}>
                    <td className="px-5 py-3.5">
                      <div className="flex items-center gap-3">
                        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-accent-600/15 text-sm font-semibold text-accent-400 ring-1 ring-accent-500/25">
                          {user.name.charAt(0).toUpperCase()}
                        </div>
                        <div>
                          <p className="font-medium text-ink">{user.name}</p>
                          <p className="text-sm text-ink-mute">{user.email}</p>
                          {user.customerId && (
                            <p className="font-mono text-[11px] text-ink-faint pt-0.5">
                              {user.customerId}
                            </p>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="px-5 py-3.5 text-sm text-ink-mute">
                      {user.profile?.companyInfo?.companyName || <span className="text-ink-faint">-</span>}
                    </td>
                    <td className="px-5 py-3.5">
                      {(() => {
                        const userCards = user.cards?.length ? user.cards : user.card ? [user.card] : [];
                        return userCards.length ? (
                          <div className="flex flex-col items-start gap-1">
                            {userCards.map((c) => (
                              <span key={c._id || c.slug} className="font-mono text-sm text-accent-400 bg-accent-600/15 px-2 py-0.5 rounded">
                                /c/{c.slug}
                              </span>
                            ))}
                          </div>
                        ) : (
                          <span className="text-sm text-ink-faint italic">No card</span>
                        );
                      })()}
                    </td>
                    <td className="px-5 py-3.5">
                      <div className="flex items-center gap-1.5">
                        <Badge
                          variant={user.role === 'admin' ? 'warning' : 'default'}
                          className={user.role === 'admin'
                            ? 'bg-warn/15 text-warn ring-line-subtle'
                            : 'ring-line-subtle'}
                        >
                          {user.role}
                        </Badge>
                        <Badge
                          variant={user.status === 'active' ? 'success' : 'danger'}
                          className={user.status === 'active'
                            ? 'bg-ok/15 text-ok ring-line-subtle'
                            : 'bg-bad/15 text-bad ring-line-subtle'}
                        >
                          {user.status}
                        </Badge>
                      </div>
                    </td>
                    <td className="px-5 py-3.5 text-sm font-semibold text-ink tabular-nums">
                      {(() => {
                        const userCards = user.cards?.length ? user.cards : user.card ? [user.card] : [];
                        return userCards.reduce((sum, c) => sum + (c.stats?.taps ?? 0), 0);
                      })()}
                    </td>
                    <td className="px-5 py-3.5 text-sm text-ink-mute">
                      {new Date(user.createdAt).toLocaleDateString()}
                    </td>
                    <td className="px-5 py-3.5">
                      <div className="flex gap-1.5" onClick={(e) => e.stopPropagation()}>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => router.push(`/admin/users/${user._id}`)}
                          title="View details"
                          className="border-line-strong bg-transparent hover:bg-white/5 hover:border-line-strong focus:ring-accent-500"
                        >
                          <Eye className="h-3.5 w-3.5 text-accent-400" />
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => openEditModal(user)}
                          title="Edit credentials"
                          className="border-line-strong bg-transparent hover:bg-white/5 hover:border-line-strong focus:ring-accent-500"
                        >
                          <Pencil className="h-3.5 w-3.5 text-ink-mute" />
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => openResetModal(user)}
                          title="Reset password"
                          className="border-line-strong bg-transparent hover:bg-white/5 hover:border-line-strong focus:ring-accent-500"
                        >
                          <KeyRound className="h-3.5 w-3.5 text-ink-mute" />
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleStatusToggle(user)}
                          title={user.status === 'active' ? 'Suspend' : 'Activate'}
                          className="border-line-strong bg-transparent hover:bg-white/5 hover:border-line-strong focus:ring-accent-500"
                        >
                          {user.status === 'active' ? (
                            <ShieldOff className="h-3.5 w-3.5 text-warn" />
                          ) : (
                            <ShieldCheck className="h-3.5 w-3.5 text-ok" />
                          )}
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleDelete(user)}
                          title="Delete user"
                          className="border-line-strong bg-transparent hover:bg-bad/10 hover:border-bad/40 focus:ring-accent-500"
                        >
                          <Trash2 className="h-3.5 w-3.5 text-bad" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Card>

      <Modal isOpen={showCreateModal} onClose={() => setShowCreateModal(false)} title="Create Customer Account">
        <div className="space-y-4">
          {formError && (
            <div className="rounded-lg bg-red-50 p-3 text-sm text-red-600 ring-1 ring-red-200">{formError}</div>
          )}

          <Input
            label="Full Name"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            placeholder="John Doe"
            required
          />

          <Input
            label="URL Slug"
            value={form.urlSlug}
            onChange={(e) => setForm({ ...form, urlSlug: e.target.value })}
            placeholder="abc-electronics"
          />

          <p className="text-xs text-ink-faint -mt-2">
            Public URL prefix shown to customers. Lowercase letters, numbers and hyphens; e.g.{' '}
            /abc-electronics/instagram. Leave blank to derive it from the name.
          </p>

          <Input
            label="Email"
            type="email"
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
            placeholder="john@example.com"
            required
          />

          <Input
            label="Password"
            type="password"
            value={form.password}
            onChange={(e) => setForm({ ...form, password: e.target.value })}
            placeholder="8+ characters incl. letter and number"
            required
          />

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Products Purchased</label>
            {catalogItems.length === 0 ? (
              <div className="flex items-center gap-3 rounded-lg border border-line-subtle bg-field p-3.5 text-sm text-ink-mute">
                <Package className="h-4 w-4 text-ink-faint" />
                No active catalog products. Add products from the Products page.
              </div>
            ) : (
              <div className="space-y-2">
                {catalogItems.map((product) => {
                  const checked = selectedProductIds.includes(product._id);
                  const ProductIcon = product.category === 'card' ? CreditCard : product.category === 'standee' ? QrCode : Tag;
                  return (
                    <div key={product._id}>
                      <label className="flex items-center gap-2.5 rounded-lg border border-line-subtle bg-field px-3 py-2.5 text-sm text-ink cursor-pointer hover:border-line-strong transition-colors">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleProduct(product)}
                          className="h-4 w-4 rounded border-line-strong text-accent-600 focus:ring-accent-500"
                        />
                        <ProductIcon className={`h-4 w-4 ${checked ? 'text-accent-400' : 'text-ink-faint'}`} />
                        <span className="flex-1">{product.name}</span>
                        <span className="text-xs text-ink-faint tabular-nums">
                          ₹{(product.priceMinor / 100).toLocaleString('en-IN')}
                        </span>
                      </label>

                      {checked && product.category === 'card' && (
                        <div className="mt-1.5 pl-9 pr-2">
                          <label className="mb-1 flex cursor-pointer items-center gap-2 text-xs text-ink">
                            <input
                              type="checkbox"
                              checked={skipCardUids[product._id] ?? false}
                              onChange={(e) =>
                                setSkipCardUids((m) => ({ ...m, [product._id]: e.target.checked }))
                              }
                              className="h-3.5 w-3.5 rounded border-line-strong text-accent-600 focus:ring-accent-500"
                            />
                            Assign without a physical card (link later)
                          </label>
                          {skipCardUids[product._id] ? (
                            <p className="text-xs text-ink-faint">
                              The product is created without a physical card. The customer can configure it now; a
                              card can be linked later.
                            </p>
                          ) : (
                            <>
                              <Input
                                value={productCardUids[product._id] ?? ''}
                                onChange={(e) =>
                                  setProductCardUids((m) => ({ ...m, [product._id]: e.target.value }))
                                }
                                placeholder="Enter NFC Card UID (e.g. 04A1B2C3D4E5)"
                                className="font-mono bg-field border-line text-ink placeholder:text-ink-faint hover:border-line-strong focus:border-accent-500 focus:ring-accent-500/25"
                              />
                              <p className="mt-1 text-xs text-ink-faint">
                                The physical card is bound directly by its UID — no pre-registration needed.
                              </p>
                            </>
                          )}
                        </div>
                      )}

                      {checked && product.category === 'standee' && (() => {
  const preset = product.slug ? getFixedStandeeProfiles(product.slug) : null;
  if (preset) {
    return (
      <div className="mt-1.5 ml-9 mr-2 rounded-lg border border-line-subtle bg-field p-3">
        <p className="text-xs font-medium text-ink-mute mb-1.5">Standee QR Platform</p>
        <p className="text-sm text-ink">
          {preset.maxProfiles} fixed QR —{' '}
          {preset.profiles.map((p) => getStandeePlatformById(p)?.name ?? p).join(', ')}
        </p>
        <p className="mt-1 text-xs text-ink-faint">
          {preset.maxProfiles === 1
            ? 'This standee has 1 fixed QR code — the platform is set by the product.'
            : 'The platforms are set by the product.'}
        </p>
      </div>
    );
  }
  return (
    <div className="mt-1.5 ml-9 mr-2 rounded-lg border border-line-subtle bg-field p-3">
      <p className="text-xs font-medium text-ink-mute mb-2">Standee QR Platforms</p>
      <div className="grid grid-cols-2 gap-2">
        {STANDEE_PLATFORMS.map((platform) => (
          <label
            key={platform.id}
            className="flex items-center gap-2 rounded-md px-2 py-1.5 text-xs text-ink cursor-pointer hover:bg-white/5 transition-colors"
          >
            <input
              type="checkbox"
              checked={(productPlatforms[product._id] ?? []).includes(platform.id)}
              onChange={() => toggleCreatePlatform(product._id, platform.id)}
              className="h-3.5 w-3.5 rounded border-line-strong text-accent-600 focus:ring-accent-500"
            />
            {platform.name}
          </label>
        ))}
      </div>
    </div>
  );
})()}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => setShowCreateModal(false)}>Cancel</Button>
            <Button onClick={handleCreate} isLoading={creating}>Create Customer</Button>
          </div>
        </div>
      </Modal>

      <Modal isOpen={showEditModal} onClose={() => setShowEditModal(false)} title="Edit Credentials">
        <div className="space-y-4">
          {editError && (
            <div className="rounded-lg bg-red-50 p-3 text-sm text-red-600 ring-1 ring-red-200">{editError}</div>
          )}

          <Input
            label="Full Name"
            value={editForm.name}
            onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
            placeholder="John Doe"
            required
          />

          <Input
            label="Email"
            type="email"
            value={editForm.email}
            onChange={(e) => setEditForm({ ...editForm, email: e.target.value })}
            placeholder="john@example.com"
            required
          />

          <Input
            label="Phone"
            type="tel"
            value={editForm.phone}
            onChange={(e) => setEditForm({ ...editForm, phone: e.target.value })}
            placeholder="+91 98765 43210"
          />

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => setShowEditModal(false)}>Cancel</Button>
            <Button onClick={() => void handleSaveCredentials()} isLoading={savingEdit}>
              Save Changes
            </Button>
          </div>
        </div>
      </Modal>

      <Modal isOpen={showResetModal} onClose={() => setShowResetModal(false)} title="Reset Password">
        <div className="space-y-4">
          {resetResult ? (
            <div className="space-y-3">
              <div className="flex items-start gap-3 rounded-lg bg-ok/10 p-4 ring-1 ring-ok/30">
                <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-ok" />
                <div>
                  <p className="text-sm font-semibold text-ink">Password reset initiated</p>
                  <p className="text-sm text-ink-mute mt-0.5">
                    {resetResult === 'email'
                      ? `A reset link was sent to ${resetTarget?.email}. It is valid for 30 minutes.`
                      : `A temporary password was set for ${resetTarget?.name}. Share it securely and ask them to change it after first login.`}
                  </p>
                </div>
              </div>
              <div className="flex justify-end">
                <Button variant="outline" onClick={() => setShowResetModal(false)}>Done</Button>
              </div>
            </div>
          ) : (
            <>
              {resetError && (
                <div className="rounded-lg bg-red-50 p-3 text-sm text-red-600 ring-1 ring-red-200">{resetError}</div>
              )}

              <div className="space-y-2">
                <label className="flex cursor-pointer items-center gap-2.5 rounded-lg border border-line-subtle bg-field px-3 py-2.5 text-sm text-ink hover:border-line-strong transition-colors">
                  <input
                    type="radio"
                    name="reset-mode"
                    checked={resetMode === 'email'}
                    onChange={() => setResetMode('email')}
                    className="h-4 w-4 border-line-strong text-accent-600 focus:ring-accent-500"
                  />
                  Send reset email
                  <span className="text-xs text-ink-faint ml-auto">Customer chooses a new password</span>
                </label>

                <label className="flex cursor-pointer items-center gap-2.5 rounded-lg border border-line-subtle bg-field px-3 py-2.5 text-sm text-ink hover:border-line-strong transition-colors">
                  <input
                    type="radio"
                    name="reset-mode"
                    checked={resetMode === 'temp'}
                    onChange={() => setResetMode('temp')}
                    className="h-4 w-4 border-line-strong text-accent-600 focus:ring-accent-500"
                  />
                  Set a temporary password
                </label>
              </div>

              {resetMode === 'temp' && (
                <Input
                  label="Temporary Password"
                  type="text"
                  value={tempPassword}
                  onChange={(e) => setTempPassword(e.target.value)}
                  placeholder="8+ characters incl. letter and number"
                  autoComplete="off"
                />
              )}

              <p className="text-xs text-ink-faint">
                {resetMode === 'email'
                  ? 'A one-time link is emailed to the customer (dev builds print it to the server console).'
                  : 'The customer must change this after signing in. It is stored hashed, never in plaintext.'}
              </p>

              <div className="flex justify-end gap-2 pt-2">
                <Button variant="outline" onClick={() => setShowResetModal(false)}>Cancel</Button>
                <Button onClick={() => void handleResetPassword()} isLoading={savingReset}>
                  {resetMode === 'email' ? 'Send Reset Email' : 'Set Temporary Password'}
                </Button>
              </div>
            </>
          )}
        </div>
      </Modal>
    </div>
  );
}
