'use client';

import React, { useState, useEffect } from 'react';
import Editor from '@monaco-editor/react';
import { settingsApi, applicationsApi, Application } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Save,
  Play,
  RotateCcw,
  History,
  FileCode,
  Download,
  ExternalLink,
  Loader2,
  FileText,
  AlertCircle,
  CheckCircle2
} from 'lucide-react';

export default function ResumePage() {
  const [latex, setLatex] = useState<string>('');
  const [originalLatex, setOriginalLatex] = useState<string>('');
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [history, setHistory] = useState<Application[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [compiling, setCompiling] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [selectedSnapshot, setSelectedSnapshot] = useState<string | null>(null);

  const fetchProfileAndHistory = async () => {
    try {
      const [profileRes, appsRes] = await Promise.all([
        settingsApi.getProfile(),
        applicationsApi.list()
      ]);

      if (profileRes && profileRes.baseResumeLatex) {
        setLatex(profileRes.baseResumeLatex);
        setOriginalLatex(profileRes.baseResumeLatex);
        
        // Compile once on load if we don't have a PDF yet
        try {
          const compileRes = await settingsApi.compileProfile(profileRes.baseResumeLatex);
          if (compileRes && compileRes.pdfUrl) {
            setPdfUrl(compileRes.pdfUrl);
          }
        } catch (e) {
          console.error('Initial LaTeX compile failed', e);
        }
      }

      if (appsRes) {
        // Filter applications that have a tailored resume PDF
        const tailoredApps = appsRes.filter((app: Application) => app.tailoredResumeLatex);
        setHistory(tailoredApps);
      }
    } catch (err) {
      console.error('Failed to fetch resume studio data', err);
      setMessage({ type: 'error', text: 'Failed to load profile or compilation history.' });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchProfileAndHistory();
  }, []);

  const handleSaveBase = async () => {
    setSaving(true);
    setMessage(null);
    try {
      await settingsApi.updateProfile({ baseResumeLatex: latex });
      setOriginalLatex(latex);
      setSelectedSnapshot(null);
      setMessage({ type: 'success', text: 'Base resume LaTeX saved successfully!' });
    } catch (err) {
      console.error('Failed to save LaTeX profile', err);
      setMessage({ type: 'error', text: 'Failed to save base resume LaTeX.' });
    } finally {
      setSaving(false);
    }
  };

  const handleCompile = async () => {
    setCompiling(true);
    setMessage(null);
    try {
      const compileRes = await settingsApi.compileProfile(latex);
      if (compileRes && compileRes.pdfUrl) {
        setPdfUrl(compileRes.pdfUrl);
        setMessage({ type: 'success', text: 'LaTeX compiled successfully!' });
      } else {
        throw new Error('No PDF URL returned');
      }
    } catch (err: any) {
      console.error('Failed to compile LaTeX', err);
      setMessage({ 
        type: 'error', 
        text: err.response?.data?.error || 'LaTeX compilation failed. Check your syntax.' 
      });
    } finally {
      setCompiling(false);
    }
  };

  const handleReset = () => {
    if (confirm('Revert all unsaved edits to your base LaTeX resume?')) {
      setLatex(originalLatex);
      setSelectedSnapshot(null);
    }
  };

  const handleLoadSnapshot = (app: Application) => {
    if (app.tailoredResumeLatex) {
      setLatex(app.tailoredResumeLatex);
      setSelectedSnapshot(app.id);
      
      // Calculate frontend URL for PDF
      if (app.id) {
        // Find corresponding PDF
        const backendBaseUrl = window.location.origin.replace('3000', '4000');
        const customPdfUrl = `${backendBaseUrl}/storage/resumes/Rishav_Sharma_Resume_${app.job.company.replace(/[^a-zA-Z0-9]/g, '_')}.pdf`;
        setPdfUrl(customPdfUrl);
      }
      setMessage({ 
        type: 'success', 
        text: `Loaded tailored resume snapshot for ${app.job.company}` 
      });
    }
  };

  if (loading) {
    return (
      <div className="flex h-[calc(100vh-4rem)] w-full items-center justify-center bg-background text-foreground">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <p className="text-sm text-muted-foreground">Loading Resume Studio...</p>
        </div>
      </div>
    );
  }

  const isDirty = latex !== originalLatex;

  return (
    <div className="flex flex-col lg:flex-row h-[calc(100vh-4rem)] w-full bg-background text-foreground font-sans overflow-hidden">
      
      {/* LEFT PANE: LaTeX Editor & Snapshots */}
      <div className="flex-1 flex flex-col h-full border-r border-border min-w-0">
        
        {/* Toolbar */}
        <div className="h-14 border-b border-border bg-background px-4 flex items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-2">
            <FileCode className="h-5 w-5 text-primary" />
            <span className="font-bold text-foreground">BaseResume.latex</span>
            {selectedSnapshot ? (
              <Badge className="bg-primary/10 text-primary border border-primary/20 text-[10px] rounded-full">
                Tailored Snapshot
              </Badge>
            ) : isDirty ? (
              <Badge className="bg-amber-500/10 text-amber-400 border border-amber-500/20 text-[10px] rounded-full animate-pulse">
                Unsaved Changes
              </Badge>
            ) : (
              <Badge className="bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 text-[10px] rounded-full">
                Synced
              </Badge>
            )}
          </div>

          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handleReset}
              disabled={!isDirty && !selectedSnapshot}
              className="border-border hover:bg-accent text-muted-foreground hover:text-foreground rounded-lg text-xs h-8 cursor-pointer"
            >
              <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
              Revert
            </Button>

            <Button
              variant="outline"
              size="sm"
              onClick={handleSaveBase}
              disabled={saving || !isDirty}
              className="border-border bg-card/45 text-muted-foreground hover:bg-accent hover:text-foreground rounded-lg text-xs h-8 cursor-pointer"
            >
              {saving ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Save className="mr-1.5 h-3.5 w-3.5" />}
              Save Base
            </Button>

            <Button
              size="sm"
              onClick={handleCompile}
              disabled={compiling}
              className="bg-primary text-primary-foreground hover:bg-primary/90 font-medium rounded-lg text-xs h-8 cursor-pointer"
            >
              {compiling ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Play className="mr-1.5 h-3.5 w-3.5" />}
              Compile
            </Button>
          </div>
        </div>

        {/* Message Indicator */}
          {message && (
            <div
              className={`px-4 py-2 border-b flex items-center gap-2 text-xs font-medium animate-in fade-in zoom-in duration-300 ${
                message.type === 'success'
                  ? 'bg-emerald-950/20 border-emerald-900/30 text-emerald-400'
                  : 'bg-red-950/20 border-red-900/30 text-red-400'
              }`}
            >
              {message.type === 'success' ? (
                <CheckCircle2 className="h-4 w-4 shrink-0" />
              ) : (
                <AlertCircle className="h-4 w-4 shrink-0" />
              )}
              <span className="truncate">{message.text}</span>
            </div>
          )}

        {/* Monaco Editor Container */}
        <div className="flex-1 min-h-0 bg-background relative border-b border-border">
          <Editor
            height="100%"
            defaultLanguage="latex"
            theme="vs-dark"
            value={latex}
            onChange={(val) => setLatex(val || '')}
            options={{
              minimap: { enabled: false },
              fontSize: 13,
              fontFamily: 'Consolas, monospace',
              lineNumbers: 'on',
              wordWrap: 'on',
              automaticLayout: true,
              scrollBeyondLastLine: false,
              cursorBlinking: 'smooth',
              cursorSmoothCaretAnimation: 'on',
              padding: { top: 12, bottom: 12 }
            }}
          />
        </div>

        {/* History Snapshots Panel */}
        <div className="h-40 border-t border-border bg-card/40 px-4 py-3 shrink-0 flex flex-col min-w-0">
          <div className="flex items-center gap-1.5 pb-2 text-muted-foreground border-b border-border">
            <History className="h-4 w-4 text-primary" />
            <span className="text-xs font-bold uppercase tracking-wider text-foreground">Compilation History & snapshots</span>
          </div>

          <div className="flex-1 overflow-x-auto flex items-center gap-3 pt-3 scrollbar-thin">
            {history.length === 0 ? (
              <div className="text-xs text-muted-foreground italic py-4">
                No custom snapshots compiled yet. Tailored resumes are cached here automatically.
              </div>
            ) : (
              history.map((app) => (
                <button
                  key={app.id}
                  onClick={() => handleLoadSnapshot(app)}
                  className={`flex flex-col p-2.5 rounded-lg border text-left shrink-0 w-44 hover:border-border/80 hover:bg-muted/40 transition-all duration-200 cursor-pointer ${
                    selectedSnapshot === app.id 
                      ? 'border-primary bg-primary/10' 
                      : 'border-border bg-muted/20'
                  }`}
                >
                  <span className="text-[10px] text-primary font-bold uppercase truncate">{app.job.company}</span>
                  <span className="text-xs text-foreground truncate mt-0.5">{app.job.title}</span>
                  <span className="text-[9px] text-muted-foreground mt-2 truncate">
                    {app.createdAt ? new Date(app.createdAt).toLocaleDateString() : 'Tailored'}
                  </span>
                </button>
              ))
            )}
          </div>
        </div>

      </div>

      {/* RIGHT PANE: Side-by-Side PDF Live Preview */}
      <div className="w-full lg:w-[45%] flex flex-col h-full bg-card/10">
        
        {/* PDF Header */}
        <div className="h-14 border-b border-border bg-card/25 px-4 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2">
            <FileText className="h-5 w-5 text-primary" />
            <span className="font-bold text-foreground">PDF Live Preview</span>
          </div>

          {pdfUrl && (
            <div className="flex gap-2">
              <a
                href={pdfUrl}
                download
                className="inline-flex items-center justify-center h-8 px-3 rounded-lg border border-border text-muted-foreground text-xs hover:bg-accent hover:text-foreground transition-all"
              >
                <Download className="mr-1.5 h-3.5 w-3.5" />
                Download PDF
              </a>
              <a
                href={pdfUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center justify-center h-8 px-3 rounded-lg bg-primary/10 border border-primary/20 text-primary text-xs hover:bg-primary/20 transition-all"
              >
                <ExternalLink className="mr-1.5 h-3.5 w-3.5" />
                Open External
              </a>
            </div>
          )}
        </div>

        {/* PDF Document Frame */}
        <div className="flex-1 bg-background flex items-center justify-center relative overflow-hidden">
          {pdfUrl ? (
            <iframe
              src={`${pdfUrl}#toolbar=0&navpanes=0&scrollbar=1`}
              className="w-full h-full border-none bg-muted"
              title="Tailored Resume Preview"
            />
          ) : (
            <div className="text-center p-6 space-y-3">
              <div className="h-12 w-12 rounded-xl bg-muted flex items-center justify-center mx-auto border border-border">
                <FileText className="h-6 w-6 text-muted-foreground" />
              </div>
              <h3 className="text-sm font-semibold text-foreground">No Compiled PDF</h3>
              <p className="text-xs text-muted-foreground max-w-[280px]">
                Make edits and hit the <strong>Compile</strong> button above to render your resume PDF.
              </p>
            </div>
          )}
        </div>

      </div>

    </div>
  );
}
