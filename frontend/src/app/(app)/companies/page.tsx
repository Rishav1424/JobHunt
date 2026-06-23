'use client';

import React, { useState, useEffect } from 'react';
import { settingsApi } from '@/lib/api';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Checkbox } from '@/components/ui/checkbox';
import { Slider } from '@/components/ui/slider';
import { Progress } from '@/components/ui/progress';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Building2,
  Trash2,
  Plus,
  X,
  Search,
  CheckCircle,
  AlertTriangle,
  TrendingUp,
  Globe,
  Briefcase,
  Skull,
  Save,
  Play,
  Wand2,
  RefreshCw,
  Settings as SettingsIcon
} from 'lucide-react';

type DirectoryKey = 'targetCompanies' | 'mncCompanies' | 'tier1Startups' | 'serviceCompanies' | 'blacklistedCompanies';

interface DirectoryConfig {
  key: DirectoryKey;
  label: string;
  description: string;
  icon: React.ComponentType<any>;
  badgeColor: string;
}

const DIRECTORIES: DirectoryConfig[] = [
  {
    key: 'targetCompanies',
    label: 'Dream & Target',
    description: 'Companies that trigger an automatic score boost (+10 points).',
    icon: TrendingUp,
    badgeColor: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
  },
  {
    key: 'mncCompanies',
    label: 'Product MNCs',
    description: 'Large established tech firms and MNCs.',
    icon: Globe,
    badgeColor: 'bg-indigo-500/10 text-indigo-400 border-indigo-500/20'
  },
  {
    key: 'tier1Startups',
    label: 'Tier-1 Startups',
    description: 'High-growth startups, unicorn tech, and product leaders.',
    icon: Briefcase,
    badgeColor: 'bg-violet-500/10 text-violet-400 border-violet-500/20'
  },
  {
    key: 'serviceCompanies',
    label: 'Service Companies',
    description: 'IT consulting, agencies, and outsourcing firms (receive a soft penalty).',
    icon: Building2,
    badgeColor: 'bg-amber-500/10 text-amber-400 border-amber-500/20'
  },
  {
    key: 'blacklistedCompanies',
    label: 'Blacklist',
    description: 'Hard blacklist. Jobs from these companies are blocked and skipped immediately.',
    icon: Skull,
    badgeColor: 'bg-red-500/10 text-red-400 border-red-500/20'
  }
];

const SOURCES = ['adzuna', 'remoteok', 'wellfound', 'instahyre', 'linkedin', 'naukri', 'ycombinator', 'ats'] as const;

export default function CompaniesPage() {
  const [settings, setSettings] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [activeDirectoryTab, setActiveDirectoryTab] = useState<DirectoryKey>('targetCompanies');
  const [newCompanyName, setNewCompanyName] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [updating, setUpdating] = useState(false);
  const [newRole, setNewRole] = useState('');

  // Simulator States
  const [simTitle, setSimTitle] = useState('');
  const [simCompany, setSimCompany] = useState('');
  const [simDescription, setSimDescription] = useState('');
  const [simResult, setSimResult] = useState<any>(null);
  const [simulating, setSimulating] = useState(false);

  const fetchSettings = async () => {
    try {
      const data = await settingsApi.get();
      setSettings(data);
    } catch (err) {
      console.error('Failed to fetch settings', err);
      toast.error('Failed to load settings data.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSettings();
  }, []);

  const handleSave = async (updatedSettings: any, successMessage = 'Settings saved successfully!') => {
    setUpdating(true);
    try {
      const saved = await settingsApi.update(updatedSettings);
      setSettings(saved);
      toast.success(successMessage);
    } catch (err) {
      console.error('Failed to update settings', err);
      toast.error('Failed to save changes.');
    } finally {
      setUpdating(false);
    }
  };

  const handleAddCompany = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCompanyName.trim() || !settings) return;

    const company = newCompanyName.trim();
    const currentList = settings[activeDirectoryTab] || [];

    if (currentList.some((c: string) => c.toLowerCase() === company.toLowerCase())) {
      toast.warning('Company is already in this list.');
      return;
    }

    const updated = {
      ...settings,
      [activeDirectoryTab]: [...currentList, company]
    };

    setNewCompanyName('');
    handleSave(updated, `Added ${company} to ${activeDirectoryTab === 'blacklistedCompanies' ? 'Blacklist' : 'Directory'}`);
  };

  const handleRemoveCompany = (companyToRemove: string) => {
    if (!settings) return;
    const currentList = settings[activeDirectoryTab] || [];
    const updated = {
      ...settings,
      [activeDirectoryTab]: currentList.filter((c: string) => c !== companyToRemove)
    };
    handleSave(updated, `Removed ${companyToRemove}`);
  };

  const handleMoveCompany = (company: string, targetKey: DirectoryKey) => {
    if (!settings) return;
    const currentList = settings[activeDirectoryTab] || [];
    const targetList = settings[targetKey] || [];

    if (targetList.some((c: string) => c.toLowerCase() === company.toLowerCase())) {
      toast.warning('Company is already in target list.');
      return;
    }

    const updated = {
      ...settings,
      [activeDirectoryTab]: currentList.filter((c: string) => c !== company),
      [targetKey]: [...targetList, company]
    };
    handleSave(updated, `Moved ${company} to ${targetKey}`);
  };

  const handleSimulate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!simTitle || !simDescription) return;
    setSimulating(true);
    setSimResult(null);
    try {
      const res = await settingsApi.simulateScore({
        title: simTitle,
        company: simCompany,
        description: simDescription
      });
      setSimResult(res);
      toast.success('Simulation scoring completed successfully!');
    } catch (err) {
      console.error('Simulation failed', err);
      toast.error('Simulation failed. Check backend logs.');
    } finally {
      setSimulating(false);
    }
  };

  if (loading || !settings) {
    return (
      <div className="flex h-screen w-full items-center justify-center bg-background text-foreground">
        <div className="flex flex-col items-center gap-4">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
          <p className="text-sm text-muted-foreground">Loading settings & directory configurations...</p>
        </div>
      </div>
    );
  }

  const companiesList = settings ? (settings[activeDirectoryTab] || []) : [];
  const filteredCompanies = companiesList.filter((c: string) =>
    c.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="min-h-screen bg-background p-4 md:p-6 text-foreground font-sans">
      <div className="mx-auto max-w-6xl space-y-6">

        {/* Header Section */}
        <div>
          <h1 className="text-2xl md:text-3xl font-extrabold tracking-tight bg-linear-to-r from-foreground via-foreground/90 to-muted-foreground bg-clip-text text-transparent">
            Company Settings & Intelligence
          </h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Manage target directories, configure scraper thresholds, and run scoring simulations.
          </p>
        </div>

        {/* Global Tabs */}
        <Tabs defaultValue="directories" className="w-full space-y-6">
          <TabsList className="w-full justify-start overflow-x-auto h-auto p-1 bg-muted rounded-xl border flex gap-1 sm:w-[500px]">
            <TabsTrigger value="directories" className="flex items-center gap-1.5 text-xs py-2 cursor-pointer">
              <Building2 className="w-3.5 h-3.5" /> Company Directories
            </TabsTrigger>
            <TabsTrigger value="scraper" className="flex items-center gap-1.5 text-xs py-2 cursor-pointer">
              <SettingsIcon className="w-3.5 h-3.5" /> Scraper Config
            </TabsTrigger>
            <TabsTrigger value="simulator" className="flex items-center gap-1.5 text-xs py-2 cursor-pointer">
              <Wand2 className="w-3.5 h-3.5" /> Scoring Simulator
            </TabsTrigger>
          </TabsList>

          {/* Tab 1: Company Directories */}
          <TabsContent value="directories" className="space-y-6 outline-none">
            {/* Tab-based Directories Panel */}
            <Tabs value={activeDirectoryTab} onValueChange={(val: string) => {
              setActiveDirectoryTab(val as DirectoryKey);
              setSearchQuery('');
            }} className="space-y-6">
              <TabsList className="bg-muted/50 border border-border p-1 flex flex-wrap h-auto gap-1 rounded-xl">
                {DIRECTORIES.map((dir) => {
                  const Icon = dir.icon;
                  const count = settings ? (settings[dir.key] || []).length : 0;
                  return (
                    <TabsTrigger
                      key={dir.key}
                      value={dir.key}
                      className="rounded-lg text-xs py-2 px-3 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground text-muted-foreground cursor-pointer"
                    >
                      <Icon className="h-3.5 w-3.5 mr-1.5 inline" />
                      {dir.label}
                      <span className="ml-1.5 bg-card/65 text-muted-foreground text-[10px] px-1.5 py-0.5 rounded-full">
                        {count}
                      </span>
                    </TabsTrigger>
                  );
                })}
              </TabsList>

              {DIRECTORIES.map((dir) => {
                const Icon = dir.icon;
                return (
                  <TabsContent key={dir.key} value={dir.key} className="mt-0 outline-none">
                    <Card className="border border-border bg-card/40 backdrop-blur-md">
                      <CardHeader className="pb-4">
                        <div className="flex flex-col sm:flex-row justify-between sm:items-center gap-3">
                          <div>
                            <CardTitle className="text-lg font-bold text-foreground flex items-center gap-2">
                              <Icon className="h-5 w-5 text-primary" />
                              {dir.label} Directory
                            </CardTitle>
                            <CardDescription className="text-xs text-muted-foreground mt-1 max-w-xl">
                              {dir.description}
                            </CardDescription>
                          </div>
                        </div>
                      </CardHeader>

                      <CardContent className="space-y-6">
                        {/* Add & Filter Controls */}
                        <div className="flex flex-col sm:flex-row gap-3">
                          <form onSubmit={handleAddCompany} className="flex-1 flex gap-2">
                            <Input
                              placeholder="e.g. Google, Stripe, TCS..."
                              value={newCompanyName}
                              onChange={(e) => setNewCompanyName(e.target.value)}
                              className="bg-background border-border text-foreground text-xs rounded-lg placeholder-muted-foreground"
                            />
                            <Button
                              type="submit"
                              disabled={updating || !newCompanyName.trim()}
                              className="bg-primary hover:bg-primary/90 text-primary-foreground rounded-lg text-xs cursor-pointer px-4 h-9"
                            >
                              <Plus className="h-3.5 w-3.5 mr-1.5" />
                              Add Company
                            </Button>
                          </form>

                          <div className="relative w-full sm:w-64">
                            <span className="absolute inset-y-0 left-0 flex items-center pl-3 text-muted-foreground">
                              <Search className="h-3.5 w-3.5" />
                            </span>
                            <Input
                              placeholder="Filter companies..."
                              value={searchQuery}
                              onChange={(e) => setSearchQuery(e.target.value)}
                              className="pl-9 bg-background border-border text-foreground text-xs rounded-lg"
                            />
                          </div>
                        </div>

                        {/* Companies List */}
                        {filteredCompanies.length === 0 ? (
                          <div className="text-center py-10 border border-dashed border-border rounded-lg">
                            <Building2 className="h-8 w-8 text-muted-foreground/60 mx-auto mb-2" />
                            <p className="text-muted-foreground text-xs">
                              {searchQuery ? 'No matching companies found.' : 'No companies in this directory.'}
                            </p>
                          </div>
                        ) : (
                          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2">
                            {filteredCompanies.map((company: string) => (
                              <div
                                key={company}
                                className="flex items-center justify-between p-2 rounded-lg border border-border bg-card/25 group hover:border-border/80 hover:bg-card/45 transition-all duration-200"
                              >
                                <span className="text-xs font-semibold text-foreground truncate pl-1">
                                  {company}
                                </span>

                                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                  <div className="flex gap-1">
                                    {DIRECTORIES.filter((d) => d.key !== dir.key).map((d) => {
                                      const MoveIcon = d.icon;
                                      return (
                                        <button
                                          key={d.key}
                                          onClick={() => handleMoveCompany(company, d.key)}
                                          title={`Move to ${d.label}`}
                                          className="h-6 w-6 rounded hover:bg-accent flex items-center justify-center text-muted-foreground hover:text-primary transition-all cursor-pointer"
                                        >
                                          <MoveIcon className="h-3 w-3" />
                                        </button>
                                      );
                                    })}
                                  </div>

                                  <button
                                    onClick={() => handleRemoveCompany(company)}
                                    title="Delete"
                                    className="h-6 w-6 rounded hover:bg-destructive/15 flex items-center justify-center text-muted-foreground hover:text-destructive transition-all cursor-pointer"
                                  >
                                    <Trash2 className="h-3.5 w-3.5" />
                                  </button>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </CardContent>
                    </Card>
                  </TabsContent>
                );
              })}
            </Tabs>
          </TabsContent>

          {/* Tab 2: Scraper Settings */}
          <TabsContent value="scraper" className="space-y-6 outline-none">
            <div className="flex justify-end">
              <Button
                onClick={() => handleSave(settings, 'Scraper configuration saved successfully!')}
                disabled={updating}
              >
                <Save className="w-3.5 h-3.5 mr-1.5" />
                {updating ? 'Saving...' : 'Save Scraper Config'}
              </Button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
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
                      onCheckedChange={(checked: boolean) => setSettings({ ...settings, remoteOnly: checked })}
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
                    {settings.targetRoles.map((role: string) => (
                      <Badge key={role} variant="secondary" className="gap-1.5 text-xs">
                        {role}
                        <button onClick={() => setSettings({ ...settings, targetRoles: settings.targetRoles.filter((r: string) => r !== role) })} className="hover:text-destructive cursor-pointer">
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
                        onCheckedChange={(checked: any) => setSettings({
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
                      onValueChange={(val: number[]) => setSettings({ ...settings, scrapeIntervalHours: val[0] })}
                    />
                    <div className="flex justify-between text-[10px] text-muted-foreground">
                      <span>1h</span><span>6h</span><span>12h</span><span>24h</span>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          {/* Tab 3: Scoring Simulator */}
          <TabsContent value="simulator" className="space-y-6 outline-none">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Input Form */}
              <Card className="border border-border bg-card/40 backdrop-blur-md">
                <CardHeader>
                  <CardTitle className="text-sm font-semibold">Simulate Scoring Criteria</CardTitle>
                  <CardDescription>Paste job details to run our scoring algorithms and preview the RAG and Gemini assessment.</CardDescription>
                </CardHeader>
                <CardContent>
                  <form onSubmit={handleSimulate} className="space-y-4">
                    <div className="space-y-1.5">
                      <Label htmlFor="simTitle" className="text-xs">Job Title</Label>
                      <Input
                        id="simTitle"
                        placeholder="e.g. Backend SDE-II"
                        value={simTitle}
                        onChange={(e) => setSimTitle(e.target.value)}
                        className="bg-background border-border text-xs rounded-lg"
                        required
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="simCompany" className="text-xs">Company Name (Optional)</Label>
                      <Input
                        id="simCompany"
                        placeholder="e.g. Google"
                        value={simCompany}
                        onChange={(e) => setSimCompany(e.target.value)}
                        className="bg-background border-border text-xs rounded-lg"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="simDescription" className="text-xs">Job Description (Text)</Label>
                      <textarea
                        id="simDescription"
                        placeholder="Paste the full job requirements and details here..."
                        value={simDescription}
                        onChange={(e) => setSimDescription(e.target.value)}
                        className="w-full bg-background border border-border rounded-lg p-2.5 h-44 text-xs placeholder-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                        required
                      />
                    </div>
                    <Button
                      type="submit"
                      disabled={simulating || !simTitle || !simDescription}
                      className="w-full bg-primary hover:bg-primary/90 text-primary-foreground rounded-lg text-xs font-semibold cursor-pointer h-10 flex items-center justify-center gap-1.5"
                    >
                      {simulating ? (
                        <>
                          <RefreshCw className="h-4 w-4 animate-spin" />
                          Running Simulation...
                        </>
                      ) : (
                        <>
                          <Play className="h-4 w-4" />
                          Simulate Scoring
                        </>
                      )}
                    </Button>
                  </form>
                </CardContent>
              </Card>

              {/* Simulation Results Output */}
              <Card className="border border-border bg-card/40 backdrop-blur-md min-h-[350px]">
                <CardHeader>
                  <CardTitle className="text-sm font-semibold">Simulation Report</CardTitle>
                  <CardDescription>Live results compiled using local pgvector similarity searches and LLM scoring modules.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                  {!simResult ? (
                    <div className="flex flex-col items-center justify-center py-20 text-center border border-dashed border-border rounded-lg h-full">
                      <Wand2 className="h-10 w-10 text-muted-foreground/60 mb-3" />
                      <p className="text-xs text-muted-foreground">Submit the form on the left to see the simulation score report.</p>
                    </div>
                  ) : (
                    <div className="space-y-6">
                      {/* Score header */}
                      <div className="flex items-center justify-between pb-4 border-b border-border">
                        <div>
                          <h3 className="text-base font-bold text-foreground">{simResult.title || simTitle}</h3>
                          <p className="text-xs text-primary font-medium uppercase tracking-wider">{simResult.company || simCompany || 'Simulation Corp'}</p>
                        </div>
                        <Badge className={`text-sm font-extrabold h-12 w-12 rounded-full flex items-center justify-center ${simResult.score >= 80
                          ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                          : simResult.score >= 60
                            ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
                            : 'bg-red-500/10 text-red-400 border border-red-500/20'
                          }`}>
                          {simResult.score}%
                        </Badge>
                      </div>

                      {/* Verdict */}
                      <div className="space-y-1.5">
                        <span className="text-[10px] text-muted-foreground uppercase tracking-widest font-bold">Fit Verdict</span>
                        <p className="text-xs text-muted-foreground italic">"{simResult.verdict || simResult.recommendation}"</p>
                      </div>

                      {/* Dimension Breakdown */}
                      {simResult.dimensions && (
                        <div className="space-y-3">
                          <span className="text-[10px] text-muted-foreground uppercase tracking-widest font-bold">Dimension Score breakdown</span>
                          <div className="space-y-2">
                            {Object.entries(simResult.dimensions).map(([key, val]: any) => (
                              <div key={key} className="space-y-1">
                                <div className="flex justify-between text-[11px]">
                                  <span className="capitalize text-muted-foreground">{key.replace(/([A-Z])/g, ' $1')}</span>
                                  <span className="font-bold text-foreground">{val}%</span>
                                </div>
                                <Progress value={val} className="h-1 bg-muted" />
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Strengths & Gaps */}
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        {simResult.strengths && simResult.strengths.length > 0 && (
                          <div className="space-y-1.5">
                            <span className="text-[10px] text-emerald-400 uppercase tracking-widest font-bold">Strengths Matches</span>
                            <ul className="text-[11px] text-muted-foreground list-disc pl-4 space-y-1">
                              {simResult.strengths.slice(0, 4).map((s: string) => (
                                <li key={s}>{s}</li>
                              ))}
                            </ul>
                          </div>
                        )}
                        {simResult.gaps && simResult.gaps.length > 0 && (
                          <div className="space-y-1.5">
                            <span className="text-[10px] text-amber-400 uppercase tracking-widest font-bold">Profile Gaps</span>
                            <ul className="text-[11px] text-muted-foreground list-disc pl-4 space-y-1">
                              {simResult.gaps.slice(0, 4).map((g: string) => (
                                <li key={g}>{g}</li>
                              ))}
                            </ul>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
