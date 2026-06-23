'use client';

import React, { useState, useEffect } from 'react';
import { settingsApi } from '@/lib/api';
import { useSocket } from '@/lib/socket';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ScrollArea } from '@/components/ui/scroll-area';
import { toast } from 'sonner';
import Editor from '@monaco-editor/react';
import {
  Heart,
  RefreshCw,
  Database,
  FileText,
  CheckCircle2,
  AlertTriangle,
  Brain,
  Shield,
  Activity,
  UserCheck,
  Save,
  Plus,
  X,
  Upload
} from 'lucide-react';

interface CategoryCheck {
  category: string;
  exists: boolean;
  count: number;
}

interface ProfileHealthData {
  profileSeeded: boolean;
  profileName: string;
  knowledgeChunksCount: number;
  answerBankCount: number;
  categoryCounts: Record<string, number>;
  checklist: CategoryCheck[];
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
  profileJson?: any;
}

const CATEGORY_LABELS: Record<string, { title: string; desc: string }> = {
  education: {
    title: 'Education & Academic History',
    desc: 'Degrees, GPA, courses, and honors'
  },
  technical_strength: {
    title: 'Skills & Technical Strengths',
    desc: 'Programming languages, tools, frameworks, and architectures'
  },
  experience: {
    title: 'Work Experience & Roles',
    desc: 'Chronological employment, key accomplishments, and impact'
  },
  project: {
    title: 'Projects & Open Source',
    desc: 'Personal or team projects, tech stacks, and scale'
  },
  behavioral: {
    title: 'Behavioral Stories & Soft Skills',
    desc: 'STAR-formatted conflict, leadership, and collaboration narratives'
  },
  career_narrative: {
    title: 'Career Narrative & Vision',
    desc: 'Why software engineering, long-term goals, and growth path'
  },
  company_motivation: {
    title: 'Company Motivations & Fit',
    desc: 'Direct reasoning for applying, target company preferences'
  },
  opinions: {
    title: 'Opinions & Industry Perspectives',
    desc: 'Beliefs on agile, codebase management, and technology trends'
  }
};

export default function ProfileHealthPage() {
  const [data, setData] = useState<ProfileHealthData | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [profileMarkdown, setProfileMarkdown] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [seeding, setSeeding] = useState(false);

  // Editing states
  const [savingProfile, setSavingProfile] = useState(false);
  const [savedProfile, setSavedProfile] = useState(false);
  const [newSkill, setNewSkill] = useState('');
  const [savingMarkdown, setSavingMarkdown] = useState(false);
  const [savedMarkdown, setSavedMarkdown] = useState(false);

  const fetchHealth = async (showToast = false) => {
    try {
      if (showToast) setRefreshing(true);
      const res = await settingsApi.getProfileHealth();
      setData(res);
      if (showToast) {
        toast.success('Profile health stats updated.');
      }
    } catch (err) {
      console.error('Failed to load profile health', err);
      toast.error('Failed to retrieve profile health metrics.');
    } finally {
      if (showToast) setRefreshing(false);
    }
  };

  useEffect(() => {
    async function init() {
      try {
        const [healthData, profileData, markdownData] = await Promise.all([
          settingsApi.getProfileHealth(),
          settingsApi.getProfile(),
          settingsApi.getProfileData().catch(() => ({ content: '' }))
        ]);
        setData(healthData);
        setProfile(profileData);
        setProfileMarkdown(markdownData?.content || '');
      } catch (err) {
        console.error('Failed to load profile health/data', err);
        toast.error('Failed to retrieve profile data.');
      } finally {
        setLoading(false);
      }
    }
    init();
  }, []);

  // Listen to live system logs for profile seeding logs
  useSocket('system:log', (log: any) => {
    if (log && log.message) {
      if (log.message.includes('Profile Document Seeding completed')) {
        setSeeding(false);
        fetchHealth(false);
        toast.success('Profile document re-seeded successfully!');
      } else if (log.message.includes('Profile Document Seeding failed')) {
        setSeeding(false);
        toast.error('Failed to complete background profile seeding.');
      }
    }
  });

  const handleSeedProfile = async () => {
    setSeeding(true);
    try {
      const res = await settingsApi.seedProfile();
      if (res.success) {
        toast.info(res.message || 'Seeding initiated. Processing markdown and embeddings...');
      } else {
        toast.error(res.message || 'Seeding failed to start.');
        setSeeding(false);
      }
    } catch (err) {
      console.error('Failed to trigger seeding', err);
      toast.error('Error starting profile seeding.');
      setSeeding(false);
    }
  };

  const updateProfileJsonField = (section: string | null, field: string, value: any) => {
    if (!profile) return;
    const currentJson = profile.profileJson || {};
    if (section) {
      const sectionData = currentJson[section] || {};
      setProfile({
        ...profile,
        profileJson: {
          ...currentJson,
          [section]: {
            ...sectionData,
            [field]: value
          }
        }
      });
    } else {
      setProfile({
        ...profile,
        profileJson: {
          ...currentJson,
          [field]: value
        }
      });
    }
  };

  const handleCommaSeparatedChange = (section: string | null, field: string, text: string) => {
    const arr = text.split(',').map(s => s.trim()).filter(Boolean);
    updateProfileJsonField(section, field, arr);
  };

  const handleSaveProfile = async () => {
    if (!profile) return;
    setSavingProfile(true);
    try {
      await settingsApi.updateProfile(profile as unknown as Record<string, unknown>);
      setSavedProfile(true);
      toast.success('Profile and resume saved successfully! Recomputing embeddings...');
      setTimeout(() => setSavedProfile(false), 2000);
      fetchHealth(false);
    } catch (err) {
      console.error('Failed to save profile', err);
      toast.error('Failed to save candidate profile.');
    } finally {
      setSavingProfile(false);
    }
  };

  const handleSaveMarkdown = async () => {
    setSavingMarkdown(true);
    try {
      const res = await settingsApi.updateProfileData(profileMarkdown);
      if (res.success) {
        setSavedMarkdown(true);
        toast.success(res.message || 'ProfileData.md updated and RAG sync completed successfully!');
        setTimeout(() => setSavedMarkdown(false), 2000);
        fetchHealth(false);
      } else {
        toast.error(res.message || 'Failed to save ProfileData.md');
      }
    } catch (err) {
      console.error('Failed to save ProfileData.md', err);
      toast.error('Failed to update ProfileData.md. Check server logs.');
    } finally {
      setSavingMarkdown(false);
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (evt) => {
      const text = evt.target?.result;
      if (typeof text === 'string') {
        setProfileMarkdown(text);
        toast.success(`Loaded "${file.name}" content. Click "Save & Sync" to apply.`);
      }
    };
    reader.onerror = () => {
      toast.error('Failed to read file.');
    };
    reader.readAsText(file);
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-background p-6 flex flex-col items-center justify-center space-y-4">
        <RefreshCw className="h-8 w-8 text-primary animate-spin" />
        <p className="text-muted-foreground text-sm font-medium">Analyzing profile and health metrics...</p>
      </div>
    );
  }

  const missingCategories = data?.checklist.filter(c => !c.exists) || [];
  const overallScore = data
    ? Math.round((data.checklist.filter(c => c.exists).length / data.checklist.length) * 100)
    : 0;

  return (
    <div className="min-h-screen bg-background p-4 md:p-6 text-foreground font-sans">
      <div className="mx-auto max-w-6xl space-y-6">

        {/* Header Section */}
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
          <div>
            <h1 className="text-2xl md:text-3xl font-extrabold tracking-tight bg-linear-to-r from-foreground via-foreground/90 to-muted-foreground bg-clip-text text-transparent">
              Profile Studio & Health
            </h1>
            <p className="text-muted-foreground mt-1 text-sm">
              Manage RAG knowledge bases, edit LaTeX resume templates, update profile settings, and monitor semantic search health.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => fetchHealth(true)}
              disabled={refreshing || seeding}
            >
              <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${refreshing ? 'animate-spin' : ''}`} />
              Refresh Health
            </Button>

            <Button
              size="sm"
              disabled={seeding}
              onClick={handleSeedProfile}
              className="bg-primary hover:bg-primary/90 text-primary-foreground font-semibold"
            >
              <Database className={`h-3.5 w-3.5 mr-1.5 ${seeding ? 'animate-pulse' : ''}`} />
              {seeding ? 'Seeding Profile...' : 'Sync ProfileData.md'}
            </Button>
          </div>
        </div>

        {/* Health Score Overview */}
        <Card className="border border-border/80 bg-card/30 backdrop-blur-md">
          <CardContent className="p-4 md:p-6">
            <div className="flex flex-col md:flex-row justify-between items-center gap-6">
              <div className="flex items-center gap-4 md:gap-6">
                <div className="relative flex items-center justify-center shrink-0">
                  <Activity className={`h-12 w-12 md:h-16 md:w-16 ${overallScore === 100 ? 'text-emerald-500' : 'text-amber-500'} stroke-[1.5]`} />
                  <span className="absolute text-sm md:text-lg font-extrabold">{overallScore}%</span>
                </div>
                <div>
                  <h3 className="text-lg md:text-xl font-bold">RAG Completion Health</h3>
                  <p className="text-muted-foreground text-xs md:text-sm max-w-md mt-1">
                    Your profile covers <strong>{data?.checklist.filter(c => c.exists).length} out of {data?.checklist.length}</strong> critical categories needed for form fills.
                  </p>
                </div>
              </div>

              <div className="w-full md:w-80 space-y-2">
                <div className="flex justify-between text-xs font-semibold">
                  <span className="text-muted-foreground">Category Coverage</span>
                  <span>{overallScore}%</span>
                </div>
                <Progress value={overallScore} className="h-2" />
                <p className="text-[11px] text-muted-foreground text-right">
                  Target: 100% (All 8 core categories)
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Tabs Interface */}
        <Tabs defaultValue="health" className="w-full space-y-6">
          <TabsList className="w-full justify-start overflow-x-auto h-auto p-1 bg-muted rounded-xl border flex gap-1">
            <TabsTrigger value="health" className="flex items-center gap-1.5 text-xs py-2 cursor-pointer">
              <Heart className="w-3.5 h-3.5" /> Health Overview
            </TabsTrigger>
            <TabsTrigger value="fields" className="flex items-center gap-1.5 text-xs py-2 cursor-pointer">
              <UserCheck className="w-3.5 h-3.5" /> Profile Fields
            </TabsTrigger>
            <TabsTrigger value="latex" className="flex items-center gap-1.5 text-xs py-2 cursor-pointer">
              <FileText className="w-3.5 h-3.5" /> LaTeX Resume
            </TabsTrigger>
            <TabsTrigger value="markdown" className="flex items-center gap-1.5 text-xs py-2 cursor-pointer">
              <Brain className="w-3.5 h-3.5" /> Profile Markdown
            </TabsTrigger>
          </TabsList>

          {/* Tab 1: Health Overview */}
          <TabsContent value="health" className="space-y-6 outline-none">
            {/* Warning if categories are missing */}
            {missingCategories.length > 0 && (
              <Alert variant="destructive" className="border-amber-500/20 bg-amber-500/5 text-amber-200">
                <AlertTriangle className="h-5 w-5 text-amber-500 shrink-0" />
                <div className="ml-2">
                  <AlertTitle className="font-bold text-amber-400">Missing Profile Categories Detected</AlertTitle>
                  <AlertDescription className="mt-1.5 text-sm text-amber-300/90 leading-relaxed">
                    The auto-filler needs knowledge in the following areas: <strong>{missingCategories.map(c => CATEGORY_LABELS[c.category]?.title || c.category).join(', ')}</strong>.
                    Please ensure you have structured headings in ProfileData.md (e.g. <code className="bg-amber-950/60 px-1.5 py-0.5 rounded text-xs text-amber-300">## SECTION 6: BEHAVIORAL STORIES</code>) and click the "Sync ProfileData.md" button.
                  </AlertDescription>
                </div>
              </Alert>
            )}

            {/* Metrics Cards Grid */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {/* Card 1: User Profile Profile Name */}
              <Card className="border border-border/40 bg-card/25 shadow-md">
                <CardHeader className="pb-2">
                  <CardDescription className="text-[10px] font-medium uppercase tracking-wider">Candidate Profile</CardDescription>
                  <CardTitle className="text-lg font-bold flex items-center justify-between mt-1">
                    <span>{data?.profileName}</span>
                    <UserCheck className="h-4.5 w-4.5 text-primary" />
                  </CardTitle>
                </CardHeader>
                <CardContent className="pt-1">
                  <Badge variant={data?.profileSeeded ? 'secondary' : 'destructive'} className="rounded-full text-[10px]">
                    {data?.profileSeeded ? 'Active Database Profile' : 'Not Seeded'}
                  </Badge>
                  <p className="text-[11px] text-muted-foreground mt-3 leading-relaxed">
                    Parsed metadata is extracted from Section 1 (Static Facts) and is injected directly into standard form fields.
                  </p>
                </CardContent>
              </Card>

              {/* Card 2: Knowledge Chunks */}
              <Card className="border border-border/40 bg-card/25 shadow-md">
                <CardHeader className="pb-2">
                  <CardDescription className="text-[10px] font-medium uppercase tracking-wider">Knowledge Chunks</CardDescription>
                  <CardTitle className="text-lg font-bold flex items-center justify-between mt-1">
                    <span>{data?.knowledgeChunksCount} Chunks</span>
                    <Brain className="h-4.5 w-4.5 text-purple-400" />
                  </CardTitle>
                </CardHeader>
                <CardContent className="pt-1">
                  <Badge variant="secondary" className="bg-purple-500/10 text-purple-400 border border-purple-500/20 rounded-full text-[10px]">
                    768-D Vector Indexed
                  </Badge>
                  <p className="text-[11px] text-muted-foreground mt-3 leading-relaxed">
                    Markdown blocks containing resume details, projects, and narratives stored as high-dimensional vectors for similarity searches.
                  </p>
                </CardContent>
              </Card>

              {/* Card 3: AnswerBank Cache */}
              <Card className="border border-border/40 bg-card/25 shadow-md">
                <CardHeader className="pb-2">
                  <CardDescription className="text-[10px] font-medium uppercase tracking-wider">AnswerBank Cache</CardDescription>
                  <CardTitle className="text-lg font-bold flex items-center justify-between mt-1">
                    <span>{data?.answerBankCount} Q&A Pairs</span>
                    <Database className="h-4.5 w-4.5 text-emerald-400" />
                  </CardTitle>
                </CardHeader>
                <CardContent className="pt-1">
                  <Badge variant="secondary" className="bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 rounded-full text-[10px]">
                    Semantic Cache
                  </Badge>
                  <p className="text-[11px] text-muted-foreground mt-3 leading-relaxed">
                    Pre-answered and highly rated Q&A pairs. Injections check the AnswerBank first to reuse high-quality manual answers.
                  </p>
                </CardContent>
              </Card>
            </div>

            {/* Checklist and Categories Details */}
            <div className="space-y-4">
              <div>
                <h2 className="text-lg font-bold text-foreground">Category Coverage Breakdown</h2>
                <p className="text-muted-foreground text-xs mt-0.5">
                  Detailed review of active knowledge bases parsed from ProfileData.md.
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {data?.checklist.map(({ category, exists, count }) => {
                  const label = CATEGORY_LABELS[category] || { title: category, desc: 'User custom category' };
                  return (
                    <Card
                      key={category}
                      className={`border transition-all duration-300 ${exists
                        ? 'border-border/40 bg-card/20 hover:bg-card/50'
                        : 'border-amber-500/10 bg-amber-500/5 hover:bg-amber-500/10'
                        }`}
                    >
                      <CardHeader className="p-4">
                        <div className="flex justify-between items-start">
                          <div className="space-y-1">
                            <CardTitle className="text-sm font-bold flex items-center gap-1.5">
                              {label.title}
                              {exists ? (
                                <Badge variant="secondary" className="bg-emerald-500/10 text-emerald-400 border-none rounded-full px-2 py-0 text-[10px]">
                                  {count} {count === 1 ? 'chunk' : 'chunks'}
                                </Badge>
                              ) : (
                                <Badge variant="destructive" className="bg-amber-500/15 text-amber-500 border-none rounded-full px-2 py-0 text-[10px]">
                                  Missing
                                </Badge>
                              )}
                            </CardTitle>
                            <CardDescription className="text-xs text-muted-foreground leading-normal">
                              {label.desc}
                            </CardDescription>
                          </div>
                          {exists ? (
                            <CheckCircle2 className="h-4.5 w-4.5 text-emerald-500 shrink-0 mt-0.5" />
                          ) : (
                            <AlertTriangle className="h-4.5 w-4.5 text-amber-500 shrink-0 mt-0.5" />
                          )}
                        </div>
                      </CardHeader>
                    </Card>
                  );
                })}
              </div>
            </div>

            {/* Help & Guide Box */}
            <Card className="border border-border bg-card/15 shadow-sm">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-bold flex items-center gap-2">
                  <Shield className="h-4 w-4 text-primary" />
                  Markdown Syntax & Customizing ProfileData.md
                </CardTitle>
                <CardDescription className="text-[11px]">
                  How the parser segments markdown headings and embeds chunks
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4 text-xs text-muted-foreground leading-relaxed">
                <p>
                  The RAG system parses your ProfileData.md using standard heading format boundaries.
                  The backend searches for capitalized Section headers to split the document into clean semantic records:
                </p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 bg-muted/30 p-3 rounded-lg border border-border/40 font-mono text-[10px] text-foreground">
                  <div>
                    <span className="text-primary font-bold"># User Profile Parsing Schema:</span>
                    <ul className="mt-1 space-y-0.5">
                      <li>## SECTION 1: STATIC FACTS</li>
                      <li>## SECTION 2: EDUCATION</li>
                      <li>## SECTION 3: SKILLS</li>
                      <li>## SECTION 4: WORK EXPERIENCE</li>
                      <li>## SECTION 5: PROJECTS</li>
                    </ul>
                  </div>
                  <div>
                    <span className="text-primary font-bold"># RAG Q&A Mapping Schema:</span>
                    <ul className="mt-1 space-y-0.5">
                      <li>## SECTION 6: BEHAVIORAL STORIES</li>
                      <li>## SECTION 7: CAREER NARRATIVE</li>
                      <li>## SECTION 8: COMPANY MOTIVATIONS</li>
                      <li>## SECTION 9: OPINIONS</li>
                      <li>## SECTION 10: PRE-ANSWERED QUESTIONS</li>
                    </ul>
                  </div>
                </div>
                <p>
                  Whenever you update your profile, click the <strong>Sync ProfileData.md</strong> button to trigger re-compilation of embeddings. In-flight jobs and autofill agents will immediately use the updated facts.
                </p>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Tab 2: Profile Fields */}
          <TabsContent value="fields" className="space-y-6 outline-none">
            {profile && (
              <>
                <div className="flex justify-end">
                  <Button
                    onClick={handleSaveProfile}
                    disabled={savingProfile}
                  >
                    <Save className="w-3.5 h-3.5 mr-1.5" />
                    {savedProfile ? 'Saved Profile!' : savingProfile ? 'Saving & Recomputing...' : 'Save Profile & Resume'}
                  </Button>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  {/* Column 1 */}
                  <div className="space-y-6">
                    {/* Personal Info */}
                    <Card>
                      <CardHeader className="pb-3">
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

                    {/* Technical Skills */}
                    <Card>
                      <CardHeader className="pb-3">
                        <CardTitle className="text-sm font-semibold">Technical Skills</CardTitle>
                        <CardDescription>Skills list referenced by AI filters.</CardDescription>
                      </CardHeader>
                      <CardContent className="space-y-4">
                        <ScrollArea className="max-h-32">
                          <div className="flex flex-wrap gap-1.5 border bg-muted/50 p-3 rounded-lg mr-2">
                            {profile.skills.map((skill) => (
                              <Badge key={skill} variant="secondary" className="gap-1 text-[11px] py-0.5">
                                {skill}
                                <button onClick={() => setProfile({ ...profile, skills: profile.skills.filter((s) => s !== skill) })} className="hover:text-destructive cursor-pointer">
                                  <X className="w-2.5 h-2.5" />
                                </button>
                              </Badge>
                            ))}
                          </div>
                        </ScrollArea>
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

                  {/* Column 2 */}
                  <div className="space-y-6">
                    {/* Academic & Professional Facts */}
                    <Card>
                      <CardHeader className="pb-3">
                        <CardTitle className="text-sm font-semibold">Academic & Professional Facts</CardTitle>
                        <CardDescription>Basic facts parsed from your resume, used for form pre-filling.</CardDescription>
                      </CardHeader>
                      <CardContent className="space-y-3">
                        <div className="grid grid-cols-2 gap-3">
                          <div className="space-y-1.5">
                            <Label htmlFor="fact-college" className="text-xs">University/College</Label>
                            <Input
                              id="fact-college"
                              value={profile.profileJson?.facts?.college || ''}
                              onChange={(e) => updateProfileJsonField('facts', 'college', e.target.value)}
                              className="bg-background border-border text-xs rounded-lg"
                            />
                          </div>
                          <div className="space-y-1.5">
                            <Label htmlFor="fact-degree" className="text-xs">Degree</Label>
                            <Input
                              id="fact-degree"
                              value={profile.profileJson?.facts?.degree || ''}
                              onChange={(e) => updateProfileJsonField('facts', 'degree', e.target.value)}
                              className="bg-background border-border text-xs rounded-lg"
                            />
                          </div>
                        </div>

                        <div className="grid grid-cols-2 gap-3">
                          <div className="space-y-1.5">
                            <Label htmlFor="fact-cgpa" className="text-xs">CGPA/Percentage</Label>
                            <Input
                              id="fact-cgpa"
                              value={profile.profileJson?.facts?.cgpa || ''}
                              onChange={(e) => updateProfileJsonField('facts', 'cgpa', e.target.value)}
                              className="bg-background border-border text-xs rounded-lg"
                            />
                          </div>
                          <div className="space-y-1.5">
                            <Label htmlFor="fact-grad" className="text-xs">Graduation Date</Label>
                            <Input
                              id="fact-grad"
                              value={profile.profileJson?.facts?.graduationDate || ''}
                              onChange={(e) => updateProfileJsonField('facts', 'graduationDate', e.target.value)}
                              className="bg-background border-border text-xs rounded-lg"
                            />
                          </div>
                        </div>

                        <div className="grid grid-cols-2 gap-3">
                          <div className="space-y-1.5">
                            <Label htmlFor="fact-role" className="text-xs">Current Role</Label>
                            <Input
                              id="fact-role"
                              value={profile.profileJson?.facts?.currentRole || ''}
                              onChange={(e) => updateProfileJsonField('facts', 'currentRole', e.target.value)}
                              className="bg-background border-border text-xs rounded-lg"
                            />
                          </div>
                          <div className="space-y-1.5">
                            <Label htmlFor="fact-notice" className="text-xs">Notice Period</Label>
                            <Input
                              id="fact-notice"
                              value={profile.profileJson?.facts?.noticePeriod || ''}
                              onChange={(e) => updateProfileJsonField('facts', 'noticePeriod', e.target.value)}
                              className="bg-background border-border text-xs rounded-lg"
                            />
                          </div>
                        </div>
                      </CardContent>
                    </Card>

                    {/* Preferences & Deal Breakers */}
                    <Card>
                      <CardHeader className="pb-3">
                        <CardTitle className="text-sm font-semibold">AI Targeting Preferences</CardTitle>
                        <CardDescription>Roles and domain indicators used during AI scoring calibration.</CardDescription>
                      </CardHeader>
                      <CardContent className="space-y-3">
                        <div className="space-y-1.5">
                          <Label className="text-xs">Primary Roles (comma separated)</Label>
                          <Input
                            value={(profile.profileJson?.preferences?.rolePreferences?.primary || []).join(', ')}
                            onChange={(e) => {
                              const arr = e.target.value.split(',').map(s => s.trim()).filter(Boolean);
                              const currentJson = profile.profileJson || {};
                              const currentPref = currentJson.preferences || {};
                              const currentRoles = currentPref.rolePreferences || {};
                              setProfile({
                                ...profile,
                                profileJson: {
                                  ...currentJson,
                                  preferences: {
                                    ...currentPref,
                                    rolePreferences: {
                                      ...currentRoles,
                                      primary: arr
                                    }
                                  }
                                }
                              });
                            }}
                            className="bg-background border-border text-xs rounded-lg"
                            placeholder="e.g. Backend SDE, Systems Engineer"
                          />
                          <div className="flex flex-wrap gap-1 mt-1">
                            {(profile.profileJson?.preferences?.rolePreferences?.primary || []).map((role: string) => (
                              <Badge key={role} variant="secondary" className="text-[10px] py-0 px-1.5">{role}</Badge>
                            ))}
                          </div>
                        </div>

                        <div className="space-y-1.5">
                          <Label className="text-xs">Avoid Roles (comma separated)</Label>
                          <Input
                            value={(profile.profileJson?.preferences?.rolePreferences?.avoid || []).join(', ')}
                            onChange={(e) => {
                              const arr = e.target.value.split(',').map(s => s.trim()).filter(Boolean);
                              const currentJson = profile.profileJson || {};
                              const currentPref = currentJson.preferences || {};
                              const currentRoles = currentPref.rolePreferences || {};
                              setProfile({
                                ...profile,
                                profileJson: {
                                  ...currentJson,
                                  preferences: {
                                    ...currentPref,
                                    rolePreferences: {
                                      ...currentRoles,
                                      avoid: arr
                                    }
                                  }
                                }
                              });
                            }}
                            className="bg-background border-border text-xs rounded-lg"
                            placeholder="e.g. Frontend, QA, Support"
                          />
                          <div className="flex flex-wrap gap-1 mt-1">
                            {(profile.profileJson?.preferences?.rolePreferences?.avoid || []).map((role: string) => (
                              <Badge key={role} variant="secondary" className="text-[10px] py-0 px-1.5 bg-destructive/10 text-destructive border-destructive/20">{role}</Badge>
                            ))}
                          </div>
                        </div>

                        <div className="space-y-1.5">
                          <Label className="text-xs">Domain Interests (comma separated)</Label>
                          <Input
                            value={(profile.profileJson?.preferences?.domainInterests || []).join(', ')}
                            onChange={(e) => handleCommaSeparatedChange('preferences', 'domainInterests', e.target.value)}
                            className="bg-background border-border text-xs rounded-lg"
                            placeholder="e.g. Fintech, Real-time Systems"
                          />
                          <div className="flex flex-wrap gap-1 mt-1">
                            {(profile.profileJson?.preferences?.domainInterests || []).map((dom: string) => (
                              <Badge key={dom} variant="secondary" className="text-[10px] py-0 px-1.5">{dom}</Badge>
                            ))}
                          </div>
                        </div>

                        <div className="space-y-1.5">
                          <Label className="text-xs">Deal Breakers (comma separated)</Label>
                          <Input
                            value={(profile.profileJson?.preferences?.dealBreakers || []).join(', ')}
                            onChange={(e) => handleCommaSeparatedChange('preferences', 'dealBreakers', e.target.value)}
                            className="bg-background border-border text-xs rounded-lg"
                            placeholder="e.g. WITCH companies, Pure QA"
                          />
                          <div className="flex flex-wrap gap-1 mt-1">
                            {(profile.profileJson?.preferences?.dealBreakers || []).map((db: string) => (
                              <Badge key={db} variant="secondary" className="text-[10px] py-0 px-1.5 bg-destructive/10 text-destructive border-destructive/20">{db}</Badge>
                            ))}
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  </div>
                </div>

                {/* Narrative Context Overrides */}
                <Card className="w-full mt-6">
                  <CardHeader className="pb-3">
                    <CardTitle className="text-sm font-semibold">Narrative Context Overrides</CardTitle>
                    <CardDescription>Custom summaries sent to Gemini for resume tailoring and fit scoring.</CardDescription>
                  </CardHeader>
                  <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <Label htmlFor="over-edge" className="text-xs font-semibold">Your Competitive Edge</Label>
                      <textarea
                        id="over-edge"
                        value={profile.profileJson?.competitiveEdge || ''}
                        onChange={(e) => updateProfileJsonField(null, 'competitiveEdge', e.target.value)}
                        className="w-full bg-background border border-border rounded-lg p-2.5 h-24 text-xs placeholder-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                        placeholder="Highlight what makes you stand out..."
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="over-goals" className="text-xs font-semibold">Career Goals</Label>
                      <textarea
                        id="over-goals"
                        value={profile.profileJson?.careerGoals || ''}
                        onChange={(e) => updateProfileJsonField(null, 'careerGoals', e.target.value)}
                        className="w-full bg-background border border-border rounded-lg p-2.5 h-24 text-xs placeholder-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                        placeholder="Describe your long-term career aspirations..."
                      />
                    </div>
                  </CardContent>
                </Card>
              </>
            )}
          </TabsContent>

          {/* Tab 3: LaTeX Resume Monaco Editor */}
          <TabsContent value="latex" className="space-y-6 outline-none">
            {profile && (
              <>
                <div className="flex justify-between items-center">
                  <div className="flex items-center gap-2">
                    <h2 className="text-sm font-bold text-foreground">LaTeX Resume Source</h2>
                    {profile.hasEmbedding && (
                      <Badge variant="outline" className="shrink-0 gap-1 text-[10px]">
                        <Activity className="w-3 h-3 text-emerald-400" /> Vector Indexed
                      </Badge>
                    )}
                  </div>
                  <Button
                    onClick={handleSaveProfile}
                    disabled={savingProfile}
                  >
                    <Save className="w-3.5 h-3.5 mr-1.5" />
                    {savedProfile ? 'Saved Resume!' : savingProfile ? 'Saving & Recomputing...' : 'Save Resume'}
                  </Button>
                </div>

                <Card className="flex flex-col h-[580px] border border-border bg-card/40 backdrop-blur-md">
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
              </>
            )}
          </TabsContent>

          {/* Tab 4: Markdown Profile Document */}
          <TabsContent value="markdown" className="space-y-6 outline-none">
            <div className="flex flex-col sm:flex-row justify-between gap-4">
              {/* Upload Button */}
              <div className="flex items-center gap-3">
                <Input
                  type="file"
                  accept=".md,text/markdown"
                  id="markdown-file-upload"
                  className="hidden"
                  onChange={handleFileUpload}
                />
                <Button
                  variant="outline"
                  asChild
                  className="cursor-pointer"
                >
                  <label htmlFor="markdown-file-upload" className="flex items-center gap-1.5 cursor-pointer">
                    <Upload className="w-3.5 h-3.5" /> Upload ProfileData.md
                  </label>
                </Button>
                <span className="text-xs text-muted-foreground">Select a local markdown file to load its contents</span>
              </div>

              {/* Save Button */}
              <Button
                onClick={handleSaveMarkdown}
                disabled={savingMarkdown}
                className="bg-primary hover:bg-primary/90 text-primary-foreground font-semibold flex items-center gap-1.5 cursor-pointer"
              >
                <Save className="w-3.5 h-3.5" />
                {savedMarkdown ? 'Saved & Synced!' : savingMarkdown ? 'Syncing...' : 'Save & Sync ProfileData.md'}
              </Button>
            </div>

            <Card className="flex flex-col h-[650px] border border-border bg-card/40 backdrop-blur-md">
              <CardHeader className="pb-3 border-b flex flex-row items-center justify-between">
                <div>
                  <CardTitle className="text-sm font-semibold">ProfileData.md Editor</CardTitle>
                  <CardDescription>Directly edit your RAG knowledge base. Organized in 10 ## SECTION headers.</CardDescription>
                </div>
              </CardHeader>
              <CardContent className="flex-1 p-0 overflow-hidden relative">
                <Editor
                  height="100%"
                  language="markdown"
                  theme="vs-dark"
                  value={profileMarkdown}
                  onChange={(val) => setProfileMarkdown(val || '')}
                  options={{
                    minimap: { enabled: false },
                    fontSize: 12,
                    lineNumbers: 'on',
                    wordWrap: 'on',
                    scrollbar: { verticalScrollbarSize: 6, horizontalScrollbarSize: 6 }
                  }}
                />
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

      </div>
    </div>
  );
}
