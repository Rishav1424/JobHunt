'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { settingsApi } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Switch } from '@/components/ui/switch';
import {
  User,
  Briefcase,
  Sliders,
  HelpCircle,
  Award,
  ArrowRight,
  ArrowLeft,
  CheckCircle2,
  Loader2,
  AlertCircle
} from 'lucide-react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { toast } from 'sonner';

const STEPS = [
  { id: 1, name: 'Personal Facts', icon: User },
  { id: 2, name: 'Skills & Depth', icon: Award },
  { id: 3, name: 'Job Preferences', icon: Sliders },
  { id: 4, name: 'Q&A: Background', icon: HelpCircle },
  { id: 5, name: 'Q&A: Scenarios', icon: HelpCircle }
];

const PRE_DEFINED_QA = [
  // Step 4 questions
  { question: "What is your primary tech stack and how many years of experience do you have with it?", category: "background" },
  { question: "Describe a complex backend system you designed and implemented. What were the bottlenecks?", category: "background" },
  { question: "How do you handle scaling databases? Detail your experience with PostgreSQL, indexing, or sharding.", category: "background" },
  { question: "Explain your experience with real-time web technologies like WebSockets, Server-Sent Events, or Socket.IO.", category: "background" },
  { question: "What is your approach to system reliability, CI/CD pipelines, and deploying with Docker/Kubernetes?", category: "background" },
  { question: "Describe a project where you optimized API query performance. What were the latency reductions?", category: "background" },
  { question: "Detail your background with frontend frameworks like React.js, Next.js, and state management.", category: "background" },
  { question: "How do you structure and document RESTful APIs? What tools do you use?", category: "background" },
  { question: "What is your experience with cache layers like Redis? Explain a caching strategy you used.", category: "background" },
  { question: "Detail your educational background and key academic achievements at NIT Durgapur.", category: "background" },

  // Step 5 questions
  { question: "How do you handle disagreements with technical leaders or product managers regarding database schema designs?", category: "scenario" },
  { question: "Tell me about a time you had to debug a critical production bug under intense time pressure. What was the cause?", category: "scenario" },
  { question: "Explain how you manage and structure your daily work tasks. Do you have experience with agile methodologies?", category: "scenario" },
  { question: "What is your target CTC, and what are your expectations regarding remote vs on-site work?", category: "scenario" },
  { question: "Why are you interested in joining a high-growth tier-1 startup versus a large corporate MNC?", category: "scenario" },
  { question: "Describe a situation where you had to learn a completely new framework or tool in a matter of days. How did you do it?", category: "scenario" },
  { question: "How do you ensure code quality and maintainability in a team setting? Detail your code review process.", category: "scenario" },
  { question: "What is your experience with background worker queues like BullMQ, Celery, or RabbitMQ?", category: "scenario" },
  { question: "Explain a situation where you led a feature development from ideation to production. What was the impact?", category: "scenario" },
  { question: "What is your immediate availability, and do you have any notice period restrictions?", category: "scenario" }
];

export default function OnboardingPage() {
  const router = useRouter();
  const [currentStep, setCurrentStep] = useState(1);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Form states
  const [facts, setFacts] = useState({
    name: 'Rishav Sharma',
    email: 'rishav.sharma@example.com',
    phone: '+91 98765 43210',
    location: 'Durgapur, West Bengal',
    linkedinUrl: 'https://linkedin.com/in/rishav-sharma',
    githubUrl: 'https://github.com/rishav-sharma'
  });

  const [skills, setSkills] = useState({
    strong: ['TypeScript', 'JavaScript', 'Node.js', 'React.js', 'PostgreSQL', 'Express.js'],
    comfortable: ['Python', 'Docker', 'Redis', 'WebSockets', 'REST APIs', 'Spring Boot'],
    familiar: ['C++', 'Kubernetes', 'AWS', 'System Design', 'CI/CD']
  });

  const [preferences, setPreferences] = useState({
    targetRoles: ['Backend Engineer', 'Software Engineer', 'Fullstack Engineer'],
    targetLocations: ['Bangalore', 'Remote', 'Pune', 'Noida'],
    remoteOnly: true,
    minSalaryLpa: 12
  });

  // QA answers mapped by question
  const [qaAnswers, setQaAnswers] = useState<Record<string, string>>({});

  useEffect(() => {
    const fetchExistingData = async () => {
      try {
        const profile = await settingsApi.getProfile();
        if (profile) {
          if (profile.name) setFacts(prev => ({ ...prev, name: profile.name }));
          if (profile.email) setFacts(prev => ({ ...prev, email: profile.email }));
          if (profile.phone) setFacts(prev => ({ ...prev, phone: profile.phone }));
          if (profile.location) setFacts(prev => ({ ...prev, location: profile.location }));
          if (profile.linkedinUrl) setFacts(prev => ({ ...prev, linkedinUrl: profile.linkedinUrl }));
          if (profile.githubUrl) setFacts(prev => ({ ...prev, githubUrl: profile.githubUrl }));

          if (profile.profileJson) {
            const pj = typeof profile.profileJson === 'string' ? JSON.parse(profile.profileJson) : profile.profileJson;
            if (pj.skills) setSkills(pj.skills);
            if (pj.preferences) setPreferences(pj.preferences);
          }
        }
      } catch (err) {
        console.error('Failed to load profile details for onboarding', err);
      } finally {
        setLoading(false);
      }
    };
    fetchExistingData();
  }, []);

  const handleNext = () => {
    if (currentStep < 5) setCurrentStep(currentStep + 1);
  };

  const handlePrev = () => {
    if (currentStep > 1) setCurrentStep(currentStep - 1);
  };

  const handleFinish = async () => {
    setSubmitting(true);
    setError(null);

    const qaPairs = PRE_DEFINED_QA.map(q => ({
      question: q.question,
      answer: qaAnswers[q.question] || 'Not specified'
    }));

    const profileJson = {
      facts,
      skills,
      preferences,
      updatedAt: new Date().toISOString()
    };

    try {
      await settingsApi.submitOnboarding({ profileJson, qaPairs });
      // Also update the top-level UserProfile fields
      await settingsApi.updateProfile({
        name: facts.name,
        email: facts.email,
        phone: facts.phone,
        location: facts.location,
        linkedinUrl: facts.linkedinUrl,
        githubUrl: facts.githubUrl,
        skills: [...skills.strong, ...skills.comfortable]
      });

      toast.success('🎉 Onboarding completed successfully! Profile JSON saved and AnswerBank seeded.');
      router.push('/dashboard');
    } catch (err: any) {
      console.error('Onboarding submission failed', err);
      setError(err.response?.data?.error || 'Failed to submit onboarding data. Try again.');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="flex h-screen w-full items-center justify-center bg-background text-foreground">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <p className="text-sm text-muted-foreground">Loading Onboarding Wizard...</p>
        </div>
      </div>
    );
  }

  const stepProgress = (currentStep / 5) * 100;

  return (
    <div className="min-h-screen bg-background py-8 px-4 sm:px-6 lg:px-8 text-foreground font-sans relative overflow-hidden">

      {/* Background ambient glow */}
      <div className="absolute top-0 right-1/4 h-96 w-96 rounded-full bg-primary/5 blur-[120px]" />
      <div className="absolute bottom-0 left-1/4 h-96 w-96 rounded-full bg-primary/5 blur-[120px]" />

      <div className="max-w-3xl mx-auto space-y-8 relative z-10">

        {/* Header */}
        <div className="text-center space-y-2">
          <h1 className="text-3xl font-extrabold tracking-tight bg-linear-to-r from-foreground via-foreground/90 to-muted-foreground bg-clip-text text-transparent">
            Candidate Onboarding Wizard
          </h1>
          <p className="text-muted-foreground text-sm max-w-lg mx-auto">
            Answer a few quick questions to populate your semantic score weights and seed the auto-applier AnswerBank.
          </p>
        </div>

        {/* Progress Tracker */}
        <div className="space-y-4">
          <div className="flex justify-between items-center text-xs font-bold text-muted-foreground uppercase tracking-widest">
            <span>Step {currentStep} of 5: {STEPS[currentStep - 1].name}</span>
            <span>{Math.round(stepProgress)}% Complete</span>
          </div>
          <Progress value={stepProgress} className="h-1 bg-muted" />

          {/* Stepper Indicators */}
          <div className="flex justify-between items-center gap-2 pt-2">
            {STEPS.map((s) => {
              const StepIcon = s.icon;
              const isActive = s.id === currentStep;
              const isCompleted = s.id < currentStep;

              return (
                <div key={s.id} className="flex flex-col items-center flex-1">
                  <div
                    className={`h-8 w-8 rounded-full border flex items-center justify-center transition-all duration-300 ${isActive
                      ? 'border-primary bg-primary/10 text-primary'
                      : isCompleted
                        ? 'border-emerald-500 bg-emerald-500/10 text-emerald-500'
                        : 'border-border bg-background text-muted-foreground'
                      }`}
                  >
                    <StepIcon className="h-4 w-4" />
                  </div>
                  <span className="hidden sm:block text-[10px] mt-1.5 font-medium text-muted-foreground">
                    {s.name}
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Form Container */}
        <Card className="border border-border bg-card/40 backdrop-blur-md shadow-2xl">
          <CardHeader>
            <CardTitle className="text-xl font-bold text-foreground">{STEPS[currentStep - 1].name}</CardTitle>
            <CardDescription className="text-xs text-muted-foreground">
              {currentStep === 1 && 'Confirm your contact info for programmatic resume injection.'}
              {currentStep === 2 && 'Group your expertise to power segment similarity matching.'}
              {currentStep === 3 && 'Define role types, remote flags, and salary filters.'}
              {currentStep === 4 && 'Describe your technical accomplishments. Computes vector embeddings.'}
              {currentStep === 5 && 'Configure your workplace fit and availability.'}
            </CardDescription>
          </CardHeader>

          <CardContent className="min-h-[350px]">
              <div
                key={currentStep}
                className="space-y-6 animate-in fade-in slide-in-from-right-2 duration-300"
              >
                {/* STEP 1: Personal Facts */}
                {currentStep === 1 && (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <Label htmlFor="name" className="text-xs text-muted-foreground">Full Name</Label>
                      <Input
                        id="name"
                        value={facts.name}
                        onChange={(e) => setFacts({ ...facts, name: e.target.value })}
                        className="bg-background border-border text-foreground text-xs"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="email" className="text-xs text-muted-foreground">Email Address</Label>
                      <Input
                        id="email"
                        type="email"
                        value={facts.email}
                        onChange={(e) => setFacts({ ...facts, email: e.target.value })}
                        className="bg-background border-border text-foreground text-xs"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="phone" className="text-xs text-muted-foreground">Phone Number</Label>
                      <Input
                        id="phone"
                        value={facts.phone}
                        onChange={(e) => setFacts({ ...facts, phone: e.target.value })}
                        className="bg-background border-border text-foreground text-xs"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="location" className="text-xs text-muted-foreground">Location</Label>
                      <Input
                        id="location"
                        value={facts.location}
                        onChange={(e) => setFacts({ ...facts, location: e.target.value })}
                        className="bg-background border-border text-foreground text-xs"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="linkedin" className="text-xs text-muted-foreground">LinkedIn Profile URL</Label>
                      <Input
                        id="linkedin"
                        value={facts.linkedinUrl}
                        onChange={(e) => setFacts({ ...facts, linkedinUrl: e.target.value })}
                        className="bg-background border-border text-foreground text-xs"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="github" className="text-xs text-muted-foreground">GitHub Profile URL</Label>
                      <Input
                        id="github"
                        value={facts.githubUrl}
                        onChange={(e) => setFacts({ ...facts, githubUrl: e.target.value })}
                        className="bg-background border-border text-foreground text-xs"
                      />
                    </div>
                  </div>
                )}

                {/* STEP 2: Skills & Depth */}
                {currentStep === 2 && (
                  <div className="space-y-4">
                    <div className="space-y-2">
                      <Label className="text-xs text-emerald-500 font-bold uppercase tracking-wider">Strong Mastery (Expert / Main Techs)</Label>
                      <Input
                        placeholder="Comma-separated skills (e.g. Node.js, TypeScript, React)"
                        value={skills.strong.join(', ')}
                        onChange={(e) => setSkills({ ...skills, strong: e.target.value.split(',').map(s => s.trim()).filter(Boolean) })}
                        className="bg-background border-border text-foreground text-xs"
                      />
                      <div className="flex flex-wrap gap-1.5 pt-1">
                        {skills.strong.map(s => (
                          <Badge key={s} className="bg-emerald-500/10 text-emerald-500 border border-emerald-500/20">{s}</Badge>
                        ))}
                      </div>
                    </div>

                    <div className="space-y-2">
                      <Label className="text-xs text-primary font-bold uppercase tracking-wider">Comfortable (Good working knowledge)</Label>
                      <Input
                        placeholder="Comma-separated skills"
                        value={skills.comfortable.join(', ')}
                        onChange={(e) => setSkills({ ...skills, comfortable: e.target.value.split(',').map(s => s.trim()).filter(Boolean) })}
                        className="bg-background border-border text-foreground text-xs"
                      />
                      <div className="flex flex-wrap gap-1.5 pt-1">
                        {skills.comfortable.map(s => (
                          <Badge key={s} className="bg-primary/10 text-primary border border-primary/20">{s}</Badge>
                        ))}
                      </div>
                    </div>

                    <div className="space-y-2">
                      <Label className="text-xs text-violet-500 font-bold uppercase tracking-wider">Familiar (Concepts / Basic exposure)</Label>
                      <Input
                        placeholder="Comma-separated skills"
                        value={skills.familiar.join(', ')}
                        onChange={(e) => setSkills({ ...skills, familiar: e.target.value.split(',').map(s => s.trim()).filter(Boolean) })}
                        className="bg-background border-border text-foreground text-xs"
                      />
                      <div className="flex flex-wrap gap-1.5 pt-1">
                        {skills.familiar.map(s => (
                          <Badge key={s} className="bg-violet-500/10 text-violet-500 border border-violet-500/20">{s}</Badge>
                        ))}
                      </div>
                    </div>
                  </div>
                )}

                {/* STEP 3: Job Preferences */}
                {currentStep === 3 && (
                  <div className="space-y-5">
                    <div className="space-y-1.5">
                      <Label htmlFor="targetRoles" className="text-xs text-muted-foreground">Target Roles</Label>
                      <Input
                        id="targetRoles"
                        placeholder="e.g. Backend Engineer, Systems Engineer"
                        value={preferences.targetRoles.join(', ')}
                        onChange={(e) => setPreferences({ ...preferences, targetRoles: e.target.value.split(',').map(r => r.trim()).filter(Boolean) })}
                        className="bg-background border-border text-foreground text-xs"
                      />
                    </div>

                    <div className="space-y-1.5">
                      <Label htmlFor="targetLocations" className="text-xs text-muted-foreground">Target Locations</Label>
                      <Input
                        id="targetLocations"
                        placeholder="e.g. Bangalore, Remote"
                        value={preferences.targetLocations.join(', ')}
                        onChange={(e) => setPreferences({ ...preferences, targetLocations: e.target.value.split(',').map(l => l.trim()).filter(Boolean) })}
                        className="bg-background border-border text-foreground text-xs"
                      />
                    </div>

                    <div className="grid grid-cols-2 gap-6 items-center pt-2">
                      <div className="flex items-center justify-between space-x-2">
                        <Label htmlFor="remoteOnly" className="text-xs text-muted-foreground">Remote Work Only</Label>
                        <Switch
                          id="remoteOnly"
                          checked={preferences.remoteOnly}
                          onCheckedChange={(val: any) => setPreferences({ ...preferences, remoteOnly: val })}
                        />
                      </div>

                      <div className="space-y-1.5">
                        <Label htmlFor="minSalary" className="text-xs text-muted-foreground">Minimum Expected Salary (LPA)</Label>
                        <Input
                          id="minSalary"
                          type="number"
                          value={preferences.minSalaryLpa}
                          onChange={(e) => setPreferences({ ...preferences, minSalaryLpa: parseInt(e.target.value, 10) })}
                          className="bg-background border-border text-foreground text-xs"
                        />
                      </div>
                    </div>
                  </div>
                )}

                {/* STEP 4: Background Q&A */}
                {currentStep === 4 && (
                  <ScrollArea className="max-h-[420px]">
                    <div className="space-y-4 pr-3">
                      {PRE_DEFINED_QA.filter(q => q.category === 'background').map((q, idx) => (
                        <div key={q.question} className="space-y-2">
                          <Label className="text-xs font-semibold text-foreground">
                            {idx + 1}. {q.question}
                          </Label>
                          <textarea
                            placeholder="Type your response... Be as detailed and specific as possible."
                            value={qaAnswers[q.question] || ''}
                            onChange={(e) => setQaAnswers({ ...qaAnswers, [q.question]: e.target.value })}
                            className="w-full bg-background border border-border focus:border-primary focus:ring-1 focus:ring-primary focus:outline-none text-foreground text-xs rounded-lg p-2.5 h-20 placeholder-muted-foreground"
                          />
                        </div>
                      ))}
                    </div>
                  </ScrollArea>
                )}

                {/* STEP 5: Scenario Q&A */}
                {currentStep === 5 && (
                  <ScrollArea className="max-h-[420px]">
                    <div className="space-y-4 pr-3">
                      {PRE_DEFINED_QA.filter(q => q.category === 'scenario').map((q, idx) => (
                        <div key={q.question} className="space-y-2">
                          <Label className="text-xs font-semibold text-foreground">
                            {idx + 1}. {q.question}
                          </Label>
                          <textarea
                            placeholder="Type your response... Be as detailed and specific as possible."
                            value={qaAnswers[q.question] || ''}
                            onChange={(e) => setQaAnswers({ ...qaAnswers, [q.question]: e.target.value })}
                            className="w-full bg-background border border-border focus:border-primary focus:ring-1 focus:ring-primary focus:outline-none text-foreground text-xs rounded-lg p-2.5 h-20 placeholder-muted-foreground"
                          />
                        </div>
                      ))}
                    </div>
                  </ScrollArea>
                )}
              </div>

            {error && (
              <div className="mt-6 flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                <AlertCircle className="h-4 w-4 shrink-0" />
                <span>{error}</span>
              </div>
            )}
          </CardContent>

          <CardFooter className="flex justify-between border-t border-border pt-4">
            <Button
              variant="outline"
              disabled={currentStep === 1 || submitting}
              onClick={handlePrev}
              className="border-border text-muted-foreground hover:bg-accent hover:text-foreground rounded-lg text-xs cursor-pointer h-9 px-4"
            >
              <ArrowLeft className="mr-1.5 h-3.5 w-3.5" />
              Back
            </Button>

            {currentStep < 5 ? (
              <Button
                onClick={handleNext}
                className="bg-primary hover:bg-primary/90 text-primary-foreground rounded-lg text-xs cursor-pointer h-9 px-4 flex items-center gap-1.5"
              >
                Continue
                <ArrowRight className="h-3.5 w-3.5" />
              </Button>
            ) : (
              <Button
                onClick={handleFinish}
                disabled={submitting}
                className="bg-emerald-600 hover:bg-emerald-550 text-white font-medium shadow-md shadow-emerald-600/10 hover:shadow-emerald-600/20 transition-all rounded-lg text-xs cursor-pointer h-9 px-4 flex items-center gap-1.5"
              >
                {submitting ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    Submitting & Seeding...
                  </>
                ) : (
                  <>
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    Complete Onboarding
                  </>
                )}
              </Button>
            )}
          </CardFooter>
        </Card>
      </div>
    </div>
  );
}
