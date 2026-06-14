'use client';

import { useEffect, useState } from 'react';
import { settingsApi } from '@/lib/api';
import { Save, Plus, X, RefreshCw, User, Settings as SettingsIcon, Wand2 } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Checkbox } from '@/components/ui/checkbox';
import { Slider } from '@/components/ui/slider';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import Editor from '@monaco-editor/react';

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

interface UserProfile {
  name: string;
  email: string;
  phone: string;
  location: string;
  linkedinUrl: string;
  githubUrl: string;
  skills: string[];
  baseResumeLatex: string;
  hasEmbedding: boolean;
}

const SOURCES = ['adzuna', 'remoteok', 'wellfound', 'instahyre', 'linkedin', 'naukri', 'ycombinator', 'ats'] as const;

export default function SettingsPage() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [savingSettings, setSavingSettings] = useState(false);
  const [savingProfile, setSavingProfile] = useState(false);
  const [savedSettings, setSavedSettings] = useState(false);
  const [savedProfile, setSavedProfile] = useState(false);
  const [newRole, setNewRole] = useState('');
  const [newSkill, setNewSkill] = useState('');

  useEffect(() => {
    Promise.all([
      settingsApi.get(),
      settingsApi.getProfile(),
    ])
      .then(([settingsData, profileData]) => {
        setSettings(settingsData);
        setProfile(profileData);
      })
      .catch((err) => console.error('Failed to load settings/profile', err))
      .finally(() => setLoading(false));
  }, []);

  const handleSaveSettings = async () => {
    if (!settings) return;
    setSavingSettings(true);
    try {
      await settingsApi.update(settings as unknown as Record<string, unknown>);
      setSavedSettings(true);
      setTimeout(() => setSavedSettings(false), 2000);
    } catch (err) {
      console.error('Failed to save settings', err);
    } finally {
      setSavingSettings(false);
    }
  };

  const handleSaveProfile = async () => {
    if (!profile) return;
    setSavingProfile(true);
    try {
      await settingsApi.updateProfile(profile as unknown as Record<string, unknown>);
      setSavedProfile(true);
      setTimeout(() => setSavedProfile(false), 2000);
    } catch (err) {
      console.error('Failed to save profile', err);
    } finally {
      setSavingProfile(false);
    }
  };

  if (loading || !settings || !profile) {
    return (
      <div className="flex items-center justify-center h-full">
        <RefreshCw className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl md:text-3xl font-extrabold tracking-tight">Settings</h1>
        <p className="text-muted-foreground text-sm mt-1">Configure your job hunting filters, scraping schedules, and AI candidate profile.</p>
      </div>

      <Tabs defaultValue="scraper" className="w-full">
        <TabsList className="w-full sm:w-[400px]">
          <TabsTrigger value="scraper" className="flex items-center gap-1.5">
            <SettingsIcon className="w-3.5 h-3.5" /> Scraper Config
          </TabsTrigger>
          <TabsTrigger value="profile" className="flex items-center gap-1.5">
            <User className="w-3.5 h-3.5" /> Candidate Profile
          </TabsTrigger>
        </TabsList>

        {/* Tab 1: Scraper settings */}
        <TabsContent value="scraper" className="mt-4 space-y-6">
          <div className="flex justify-end">
            <Button
              onClick={handleSaveSettings}
              disabled={savingSettings}
              variant={savedSettings ? 'default' : 'default'}
            >
              <Save className="w-3.5 h-3.5" />
              {savedSettings ? 'Saved Scraper Config!' : savingSettings ? 'Saving...' : 'Save Scraper Config'}
            </Button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-6">
            {/* Filters */}
            <Card>
              <CardHeader>
                <CardTitle className="text-sm font-semibold">Job Filters & Thresholds</CardTitle>
                <CardDescription>Filter jobs pre-ingestion or inside the AI scoring queue.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="minSalary">Minimum Salary (LPA)</Label>
                    <Input
                      id="minSalary"
                      type="number"
                      value={settings.minSalaryLpa}
                      onChange={(e) => setSettings({ ...settings, minSalaryLpa: +e.target.value })}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="fitThreshold">Fit Score Threshold</Label>
                    <Input
                      id="fitThreshold"
                      type="number"
                      min={0} max={100}
                      value={settings.fitScoreThreshold}
                      onChange={(e) => setSettings({ ...settings, fitScoreThreshold: +e.target.value })}
                    />
                  </div>
                </div>

                <div className="flex items-center gap-3 pt-2">
                  <Switch
                    id="remoteOnly"
                    checked={settings.remoteOnly}
                    onCheckedChange={(checked) => setSettings({ ...settings, remoteOnly: checked })}
                  />
                  <Label htmlFor="remoteOnly" className="cursor-pointer">Restrict to Remote Only</Label>
                </div>
              </CardContent>
            </Card>

            {/* Target Roles */}
            <Card>
              <CardHeader>
                <CardTitle className="text-sm font-semibold">Target Roles</CardTitle>
                <CardDescription>Keywords used by scrapers to query search engines.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex flex-wrap gap-2 min-h-16 border bg-muted/50 p-3 rounded-lg">
                  {settings.targetRoles.map((role) => (
                    <Badge key={role} variant="secondary" className="gap-1.5">
                      {role}
                      <button onClick={() => setSettings({ ...settings, targetRoles: settings.targetRoles.filter((r) => r !== role) })} className="hover:text-destructive cursor-pointer">
                        <X className="w-3 h-3" />
                      </button>
                    </Badge>
                  ))}
                </div>
                <div className="flex gap-2">
                  <Input
                    value={newRole}
                    onChange={(e) => setNewRole(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && newRole.trim()) {
                        setSettings({ ...settings, targetRoles: [...settings.targetRoles, newRole.trim()] });
                        setNewRole('');
                      }
                    }}
                    placeholder="Add target role name (e.g. SDE Trainee)..."
                    className="flex-1"
                  />
                  <Button
                    size="icon"
                    onClick={() => {
                      if (newRole.trim()) {
                        setSettings({ ...settings, targetRoles: [...settings.targetRoles, newRole.trim()] });
                        setNewRole('');
                      }
                    }}
                  >
                    <Plus className="w-4 h-4" />
                  </Button>
                </div>
              </CardContent>
            </Card>

            {/* Job Sources */}
            <Card>
              <CardHeader>
                <CardTitle className="text-sm font-semibold">Enabled Job Channels</CardTitle>
                <CardDescription>Enable/disable specific scrapers from the active loop.</CardDescription>
              </CardHeader>
              <CardContent className="grid grid-cols-2 gap-3 pt-2">
                {SOURCES.map((source) => (
                  <div key={source} className="flex items-center gap-3">
                    <Checkbox
                      id={`source-${source}`}
                      checked={settings.enabledSources[source] ?? true}
                      onCheckedChange={(checked) => setSettings({
                        ...settings,
                        enabledSources: { ...settings.enabledSources, [source]: !!checked },
                      })}
                    />
                    <Label htmlFor={`source-${source}`} className="capitalize cursor-pointer">{source}</Label>
                  </div>
                ))}
              </CardContent>
            </Card>

            {/* Schedule */}
            <Card>
              <CardHeader>
                <CardTitle className="text-sm font-semibold">Scraping Interval</CardTitle>
                <CardDescription>Configure how often the scraping worker wakes up.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4 pt-2">
                <div className="space-y-4">
                  <div className="flex justify-between text-sm">
                    <Label>Wake Interval:</Label>
                    <span className="font-semibold">Every {settings.scrapeIntervalHours} Hours</span>
                  </div>
                  <Slider
                    min={1} max={24} step={1}
                    value={[settings.scrapeIntervalHours]}
                    onValueChange={(val) => setSettings({ ...settings, scrapeIntervalHours: Array.isArray(val) ? val[0] : val })}
                  />
                  <div className="flex justify-between text-[10px] text-muted-foreground">
                    <span>1h</span><span>6h</span><span>12h</span><span>24h</span>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Blacklist */}
            <Card className="lg:col-span-2">
              <CardHeader>
                <CardTitle className="text-sm font-semibold">Blacklisted Companies</CardTitle>
                <CardDescription>Employers in this list are filtered out immediately.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex flex-wrap gap-2 min-h-12 border bg-muted/50 p-3 rounded-lg">
                  {settings.blacklistedCompanies.length === 0 ? (
                    <p className="text-xs text-muted-foreground italic">No companies blacklisted yet.</p>
                  ) : settings.blacklistedCompanies.map((company) => (
                    <Badge key={company} variant="destructive" className="gap-1.5">
                      {company}
                      <button onClick={() => setSettings({
                        ...settings,
                        blacklistedCompanies: settings.blacklistedCompanies.filter((c) => c !== company),
                      })} className="hover:opacity-70 cursor-pointer">
                        <X className="w-3 h-3" />
                      </button>
                    </Badge>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* Tab 2: Profile settings */}
        <TabsContent value="profile" className="mt-4 space-y-6">
          <div className="flex justify-end">
            <Button
              onClick={handleSaveProfile}
              disabled={savingProfile}
            >
              <Save className="w-3.5 h-3.5" />
              {savedProfile ? 'Saved Profile!' : savingProfile ? 'Saving & Recomputing...' : 'Save Profile & Resume'}
            </Button>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 md:gap-6">
            {/* Contact Details */}
            <div className="lg:col-span-1 space-y-4 md:space-y-6">
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm font-semibold">Personal Info</CardTitle>
                  <CardDescription>Contact details injected into your resume drafts.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="space-y-2">
                    <Label htmlFor="fullName">Full Name</Label>
                    <Input
                      id="fullName"
                      value={profile.name}
                      onChange={(e) => setProfile({ ...profile, name: e.target.value })}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="email">Email Address</Label>
                    <Input
                      id="email"
                      type="email"
                      value={profile.email}
                      onChange={(e) => setProfile({ ...profile, email: e.target.value })}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="phone">Phone</Label>
                    <Input
                      id="phone"
                      value={profile.phone}
                      onChange={(e) => setProfile({ ...profile, phone: e.target.value })}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="location">Location</Label>
                    <Input
                      id="location"
                      value={profile.location}
                      onChange={(e) => setProfile({ ...profile, location: e.target.value })}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="linkedin">LinkedIn URL</Label>
                    <Input
                      id="linkedin"
                      value={profile.linkedinUrl}
                      onChange={(e) => setProfile({ ...profile, linkedinUrl: e.target.value })}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="github">GitHub URL</Label>
                    <Input
                      id="github"
                      value={profile.githubUrl}
                      onChange={(e) => setProfile({ ...profile, githubUrl: e.target.value })}
                    />
                  </div>
                </CardContent>
              </Card>

              {/* Skills Tags */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm font-semibold">Technical Skills</CardTitle>
                  <CardDescription>Skills list referenced by AI filters.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex flex-wrap gap-1.5 border bg-muted/50 p-3 rounded-lg max-h-32 overflow-y-auto">
                    {profile.skills.map((skill) => (
                      <Badge key={skill} variant="secondary" className="gap-1">
                        {skill}
                        <button onClick={() => setProfile({ ...profile, skills: profile.skills.filter((s) => s !== skill) })} className="hover:text-destructive cursor-pointer">
                          <X className="w-3 h-3" />
                        </button>
                      </Badge>
                    ))}
                  </div>
                  <div className="flex gap-2">
                    <Input
                      value={newSkill}
                      onChange={(e) => setNewSkill(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && newSkill.trim()) {
                          setProfile({ ...profile, skills: [...profile.skills, newSkill.trim()] });
                          setNewSkill('');
                        }
                      }}
                      placeholder="Add skill tag (e.g. AWS)..."
                      className="flex-1"
                    />
                    <Button
                      size="icon"
                      onClick={() => {
                        if (newSkill.trim()) {
                          setProfile({ ...profile, skills: [...profile.skills, newSkill.trim()] });
                          setNewSkill('');
                        }
                      }}
                    >
                      <Plus className="w-4 h-4" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* LaTeX Resume Monaco Editor */}
            <Card className="lg:col-span-2 flex flex-col h-[580px]">
              <CardHeader className="pb-3 border-b flex flex-row items-center justify-between">
                <div>
                  <CardTitle className="text-sm font-semibold">Base Resume (LaTeX)</CardTitle>
                  <CardDescription>Your core resume source. AI will adapt this to jobs.</CardDescription>
                </div>
                {profile.hasEmbedding && (
                  <Badge variant="outline" className="shrink-0 gap-1">
                    <Wand2 className="w-3 h-3" /> Vector Indexed
                  </Badge>
                )}
              </CardHeader>
              <CardContent className="flex-1 p-0 overflow-hidden relative">
                <Editor
                  height="100%"
                  language="latex"
                  theme="vs-dark"
                  value={profile.baseResumeLatex}
                  onChange={(val) => setProfile({ ...profile, baseResumeLatex: val || '' })}
                  options={{
                    minimap: { enabled: false },
                    fontSize: 11,
                    lineNumbers: 'on',
                    wordWrap: 'on',
                    scrollbar: { verticalScrollbarSize: 6, horizontalScrollbarSize: 6 }
                  }}
                />
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
