'use client';

import React, { useState, useEffect } from 'react';
import { settingsApi } from '@/lib/api';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Building2,
  Trash2,
  Plus,
  Search,
  CheckCircle,
  AlertTriangle,
  MoveRight,
  TrendingUp,
  Globe,
  Briefcase,
  Skull
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
    description: 'Companies that trigger an automatic score boost.',
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

export default function CompaniesPage() {
  const [settings, setSettings] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<DirectoryKey>('targetCompanies');
  const [newCompanyName, setNewCompanyName] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [updating, setUpdating] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const fetchSettings = async () => {
    try {
      const data = await settingsApi.get();
      setSettings(data);
    } catch (err) {
      console.error('Failed to fetch company directories', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSettings();
  }, []);

  const handleSave = async (updatedSettings: any) => {
    setUpdating(true);
    setMessage(null);
    try {
      const saved = await settingsApi.update(updatedSettings);
      setSettings(saved);
      toast.success('Directories updated successfully!');
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
    const currentList = settings[activeTab] || [];

    // Check for duplicates
    if (currentList.some((c: string) => c.toLowerCase() === company.toLowerCase())) {
      toast.warning('Company is already in this list.');
      return;
    }

    const updated = {
      ...settings,
      [activeTab]: [...currentList, company]
    };

    setNewCompanyName('');
    handleSave(updated);
  };

  const handleRemoveCompany = (companyToRemove: string) => {
    if (!settings) return;
    const currentList = settings[activeTab] || [];
    const updated = {
      ...settings,
      [activeTab]: currentList.filter((c: string) => c !== companyToRemove)
    };
    handleSave(updated);
  };

  const handleMoveCompany = (company: string, targetKey: DirectoryKey) => {
    if (!settings) return;
    const currentList = settings[activeTab] || [];
    const targetList = settings[targetKey] || [];

    if (targetList.some((c: string) => c.toLowerCase() === company.toLowerCase())) {
      toast.warning('Company is already in target list.');
      return;
    }

    const updated = {
      ...settings,
      [activeTab]: currentList.filter((c: string) => c !== company),
      [targetKey]: [...targetList, company]
    };
    handleSave(updated);
  };

  if (loading) {
    return (
      <div className="flex h-screen w-full items-center justify-center bg-background text-foreground">
        <div className="flex flex-col items-center gap-4">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
          <p className="text-sm text-muted-foreground">Loading directories...</p>
        </div>
      </div>
    );
  }

  const companiesList = settings ? (settings[activeTab] || []) : [];
  const filteredCompanies = companiesList.filter((c: string) =>
    c.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="min-h-screen bg-background p-6 text-foreground font-sans">
      <div className="mx-auto max-w-6xl space-y-8">

        {/* Header Section */}
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
          <div>
            <h1 className="text-3xl font-extrabold tracking-tight bg-linear-to-r from-foreground via-foreground/90 to-muted-foreground bg-clip-text text-transparent">
              Company Intelligence Board
            </h1>
            <p className="text-muted-foreground mt-1.5 text-sm">
              Manage MNC, startup, and services directories to customize scoring weights and filters.
            </p>
          </div>

          {message && (
            <div className="bg-emerald-955/30 border border-emerald-900/40 text-emerald-500 rounded-lg px-4 py-2 text-xs flex items-center gap-2">
              <CheckCircle className="h-4 w-4" />
              {message}
            </div>
          )}
        </div>

        {/* Tab-based Directories Panel */}
        <Tabs value={activeTab} onValueChange={(val: string) => {
          setActiveTab(val as DirectoryKey);
          setSearchQuery('');
        }} className="space-y-6">
          <TabsList className="bg-muted border border-border p-1 flex flex-wrap h-auto gap-1 rounded-xl">
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
              <TabsContent key={dir.key} value={dir.key} className="mt-0">
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
                            className="flex items-center justify-between p-2 rounded-lg border border-border bg-card/25 group hover:border-border/80 hover:bg-card/45 transition-all duration-200 animate-in fade-in zoom-in-95"
                          >
                            <span className="text-xs font-semibold text-foreground truncate pl-1">
                              {company}
                            </span>

                            <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                              {/* Move Selector Dropdown or Action */}
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
      </div>
    </div>
  );
}
