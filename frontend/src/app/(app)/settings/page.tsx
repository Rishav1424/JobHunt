'use client';

import { useEffect, useState } from 'react';
import { settingsApi } from '@/lib/api';
import { Save, Plus, X, RefreshCw } from 'lucide-react';
import { clsx } from 'clsx';

interface Settings {
  minSalaryLpa: number;
  targetRoles: string[];
  targetLocations: string[];
  remoteOnly: boolean;
  fitScoreThreshold: number;
  scrapeIntervalHours: number;
  enabledSources: Record<string, boolean>;
  blacklistedCompanies: string[];
}

export default function SettingsPage() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [newRole, setNewRole] = useState('');
  const [newLocation, setNewLocation] = useState('');

  useEffect(() => {
    settingsApi.get().then(setSettings).finally(() => setLoading(false));
  }, []);

  const handleSave = async () => {
    if (!settings) return;
    setSaving(true);
    try {
      await settingsApi.update(settings as unknown as Record<string, unknown>);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } finally {
      setSaving(false);
    }
  };

  if (loading || !settings) {
    return (
      <div className="flex items-center justify-center h-full">
        <RefreshCw className="w-6 h-6 animate-spin text-blue-500" />
      </div>
    );
  }

  const SOURCES = ['adzuna', 'remoteok', 'wellfound', 'instahyre', 'linkedin'];

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Settings</h1>
          <p className="text-gray-400 text-sm mt-0.5">Configure your job hunting preferences</p>
        </div>
        <button
          onClick={handleSave}
          disabled={saving}
          className={clsx(
            'flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all',
            saved ? 'bg-green-600 text-white' :
            saving ? 'bg-gray-700 text-gray-400' :
            'bg-blue-600 hover:bg-blue-500 text-white'
          )}
        >
          <Save className="w-4 h-4" />
          {saved ? 'Saved!' : saving ? 'Saving...' : 'Save Changes'}
        </button>
      </div>

      {/* Job Filters */}
      <section className="glass rounded-xl p-5 border border-gray-800 space-y-4">
        <h2 className="text-sm font-semibold text-white">Job Filters</h2>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="text-xs text-gray-400 mb-1.5 block">Min Salary (LPA)</label>
            <input
              type="number"
              value={settings.minSalaryLpa}
              onChange={(e) => setSettings({ ...settings, minSalaryLpa: +e.target.value })}
              className="w-full px-3 py-2 bg-gray-900 border border-gray-700 rounded-lg text-sm text-white focus:outline-none focus:border-blue-500"
            />
          </div>
          <div>
            <label className="text-xs text-gray-400 mb-1.5 block">Fit Score Threshold</label>
            <input
              type="number"
              min={0} max={100}
              value={settings.fitScoreThreshold}
              onChange={(e) => setSettings({ ...settings, fitScoreThreshold: +e.target.value })}
              className="w-full px-3 py-2 bg-gray-900 border border-gray-700 rounded-lg text-sm text-white focus:outline-none focus:border-blue-500"
            />
          </div>
        </div>

        <div className="flex items-center gap-3">
          <input
            type="checkbox"
            id="remoteOnly"
            checked={settings.remoteOnly}
            onChange={(e) => setSettings({ ...settings, remoteOnly: e.target.checked })}
            className="w-4 h-4 accent-blue-500"
          />
          <label htmlFor="remoteOnly" className="text-sm text-gray-300">Remote only</label>
        </div>
      </section>

      {/* Target Roles */}
      <section className="glass rounded-xl p-5 border border-gray-800 space-y-3">
        <h2 className="text-sm font-semibold text-white">Target Roles</h2>
        <div className="flex flex-wrap gap-2">
          {settings.targetRoles.map((role) => (
            <span key={role} className="flex items-center gap-1.5 px-2.5 py-1 bg-blue-600/20 border border-blue-600/30 text-blue-400 text-xs rounded-full">
              {role}
              <button onClick={() => setSettings({ ...settings, targetRoles: settings.targetRoles.filter((r) => r !== role) })}>
                <X className="w-3 h-3" />
              </button>
            </span>
          ))}
        </div>
        <div className="flex gap-2">
          <input
            type="text"
            value={newRole}
            onChange={(e) => setNewRole(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && newRole.trim()) {
                setSettings({ ...settings, targetRoles: [...settings.targetRoles, newRole.trim()] });
                setNewRole('');
              }
            }}
            placeholder="Add role and press Enter..."
            className="flex-1 px-3 py-1.5 bg-gray-900 border border-gray-700 rounded-lg text-xs text-white focus:outline-none focus:border-blue-500"
          />
          <button onClick={() => {
            if (newRole.trim()) {
              setSettings({ ...settings, targetRoles: [...settings.targetRoles, newRole.trim()] });
              setNewRole('');
            }
          }} className="p-1.5 bg-blue-600 hover:bg-blue-500 text-white rounded-lg transition-colors">
            <Plus className="w-4 h-4" />
          </button>
        </div>
      </section>

      {/* Job Sources */}
      <section className="glass rounded-xl p-5 border border-gray-800 space-y-3">
        <h2 className="text-sm font-semibold text-white">Job Sources</h2>
        <div className="grid grid-cols-2 gap-2">
          {SOURCES.map((source) => (
            <div key={source} className="flex items-center gap-3">
              <input
                type="checkbox"
                id={source}
                checked={settings.enabledSources[source] ?? true}
                onChange={(e) => setSettings({
                  ...settings,
                  enabledSources: { ...settings.enabledSources, [source]: e.target.checked },
                })}
                className="w-4 h-4 accent-blue-500"
              />
              <label htmlFor={source} className="text-sm text-gray-300 capitalize">{source}</label>
            </div>
          ))}
        </div>
      </section>

      {/* Schedule */}
      <section className="glass rounded-xl p-5 border border-gray-800 space-y-3">
        <h2 className="text-sm font-semibold text-white">Scraping Schedule</h2>
        <div>
          <label className="text-xs text-gray-400 mb-1.5 block">
            Interval (hours): every {settings.scrapeIntervalHours}h
          </label>
          <input
            type="range"
            min={1} max={24} step={1}
            value={settings.scrapeIntervalHours}
            onChange={(e) => setSettings({ ...settings, scrapeIntervalHours: +e.target.value })}
            className="w-full accent-blue-500"
          />
          <div className="flex justify-between text-xs text-gray-600 mt-1">
            <span>1h</span><span>6h</span><span>12h</span><span>24h</span>
          </div>
        </div>
      </section>

      {/* Blacklist */}
      <section className="glass rounded-xl p-5 border border-gray-800 space-y-3">
        <h2 className="text-sm font-semibold text-white">Blacklisted Companies</h2>
        <div className="flex flex-wrap gap-2">
          {settings.blacklistedCompanies.length === 0 ? (
            <p className="text-xs text-gray-600">No companies blacklisted yet.</p>
          ) : settings.blacklistedCompanies.map((company) => (
            <span key={company} className="flex items-center gap-1.5 px-2.5 py-1 bg-red-600/20 border border-red-600/30 text-red-400 text-xs rounded-full">
              {company}
              <button onClick={() => setSettings({
                ...settings,
                blacklistedCompanies: settings.blacklistedCompanies.filter((c) => c !== company),
              })}>
                <X className="w-3 h-3" />
              </button>
            </span>
          ))}
        </div>
      </section>
    </div>
  );
}
