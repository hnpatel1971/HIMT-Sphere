import { type FormEvent, type ReactNode, useCallback, useEffect, useState } from 'react';

// ─── Shared API helpers ───────────────────────────────────────────────────────
const API = '/api';
async function apiFetch<T = unknown>(path: string, method = 'GET', body?: unknown, extraHeaders?: Record<string, string>): Promise<T> {
  const r = await fetch(`${API}${path}`, {
    method,
    headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...extraHeaders },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!r.ok) throw new Error(await r.text());
  return r.json() as Promise<T>;
}
// ── DRM-003: per-request content token helpers ────────────────────────────────
/** Issue a one-time 60 s content token for the given resource from the server. */
async function issueContentToken(resourceId: string): Promise<string> {
  const result = await apiFetch<{ token: string }>(
    `/curriculum/resources/${resourceId}/token`, 'POST',
  );
  return result.token;
}
/**
 * Fetch a DRM-protected endpoint with a fresh one-time token in the Authorization header.
 * Retries once on 403 in the rare case of a token race (two concurrent fetches).
 */
async function fetchWithContentToken(
  url: string,
  resourceId: string,
  opts?: RequestInit,
): Promise<Response> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const token = await issueContentToken(resourceId);
    const r = await fetch(url, {
      ...opts,
      credentials: 'include',
      headers: { ...(opts?.headers as Record<string, string> ?? {}), Authorization: `Bearer ${token}` },
    });
    if (r.ok || r.status !== 403 || attempt === 1) return r;
    // 403 on first attempt → possibly token race; retry with a fresh token
  }
  throw new Error('Protected content fetch failed after retry');
}

function useApi<T>(path: string, deps: unknown[] = []) {
  const [data,    setData]    = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState('');
  const load = useCallback(() => {
    setLoading(true);
    apiFetch<T>(path).then(d => { setData(d); setLoading(false); }).catch(e => { setError(String(e)); setLoading(false); });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, ...deps]);
  useEffect(() => { load(); }, [load]);
  return { data, loading, error, refetch: load };
}
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ClerkProvider, SignIn, SignUp, useUser } from '@clerk/react';
import { publishableKeyFromHost } from '@clerk/react/internal';
import { shadcn } from '@clerk/themes';
import { Link, Route, Router as WouterRouter, Switch, useLocation, useParams } from 'wouter';
import {
  Activity, Archive, ArrowRight, Award, BarChart3, Bell, BookOpen, BookMarked, CalendarDays, Check, ChevronDown,
  ChevronLeft, ChevronRight, CircleAlert, ClipboardCheck, Copy, Download, ExternalLink, Eye, FileSearch, FileText, FileUp, Filter, GraduationCap,
  GripVertical, Layers, LayoutDashboard, LayoutGrid, LifeBuoy, ListChecks, LockKeyhole, Map, Menu, MoreHorizontal, Pencil,
  MinusCircle, Plus, RefreshCw, Route as RouteIcon, Scissors, Search, Settings2, ShieldCheck, SlidersHorizontal,
  Send, Sparkles, Tag, Trash2, TrendingUp, Upload, Users, Video, X
} from 'lucide-react';
import {
  getGetAnalyticsOverviewQueryKey, getGetCourseQueryKey, getGetDashboardQueryKey,
  getGetCurriculumCourseOutlineQueryKey, getListAnnouncementsQueryKey, getListAssignmentsQueryKey,
  getListCertificatesQueryKey, getListCoursesQueryKey, getListProgrammeCoursesQueryKey,
  getListProgrammesQueryKey, getListSessionsQueryKey,
  useAddCourseOutcome, useCreateAssignment, useCreateCourse, useGetAnalyticsOverview,
  useGetCourse, useGetCurriculumCourseOutline, useGetDashboard,
  useListAnnouncements, useListAssignments, useListCertificates, useListCourses,
  useListProgrammeCourses, useListProgrammes, useListSessions
} from '@workspace/api-client-react';
import type {
  Activity as ActivityType, AnalyticsOverview, Assignment, Certificate, Course, CourseDetail,
  CourseOutcome, CourseOutcomeInput, CurriculumCourse, Dashboard, Programme,
  ProgrammeCourse, Session, Subtopic, Topic, User
} from '@workspace/api-client-react';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { useToast } from '@/hooks/use-toast';
import { TooltipProvider } from '@/components/ui/tooltip';
import NotFound from '@/pages/not-found';
import { PieChart, Pie, Cell, ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid } from 'recharts';

const queryClient = new QueryClient();

const navItems = [
  { href: '/', label: 'Overview', icon: LayoutDashboard },
  { href: '/curriculum', label: 'Curriculum', icon: BookMarked },
  { href: '/courses', label: 'Courses', icon: BookOpen },
];
const adminItems = [
  { href: '/users',        label: 'Users & roles', icon: Users },
  { href: '/access-logs',  label: 'Access Logs',   icon: Eye   },
];

function cx(...parts: Array<string | false | undefined>) { return parts.filter(Boolean).join(' '); }
function niceDate(value: string | null | undefined) {
  if (!value) return 'No date';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}
const MONTHS_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
function formatUploadDate(value: string | null | undefined): string {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value ?? '—';
  const day   = d.getDate();
  const mon   = MONTHS_SHORT[d.getMonth()];
  const year  = d.getFullYear();
  const hours = d.getHours();
  const mins  = String(d.getMinutes()).padStart(2, '0');
  const secs  = String(d.getSeconds()).padStart(2, '0');
  const ampm  = hours < 12 ? 'AM' : 'PM';
  const h12   = hours % 12 || 12;
  return `${day}-${mon}-${year} ${h12}:${mins}:${secs} ${ampm}`;
}
function formatSyncDate(value: string | null | undefined): string {
  if (!value) return 'Never';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  const day = d.getDate();
  const month = MONTHS_SHORT[d.getMonth()];
  const year = d.getFullYear();
  const hours = d.getHours();
  const minutes = String(d.getMinutes()).padStart(2, '0');
  const ampm = hours < 12 ? 'AM' : 'PM';
  const hour12 = hours % 12 || 12;
  return `${day} ${month} ${year}, ${hour12}:${minutes} ${ampm}`;
}
function initials(name = 'HIMT') { return name.split(' ').map((part) => part[0]).slice(0, 2).join('').toUpperCase(); }
function statusTone(status = '') {
  const s = status.toLowerCase();
  if (s.includes('complete') || s.includes('active') || s.includes('valid') || s.includes('published') || s.includes('present')) return 'bg-[hsl(var(--primary)/.15)] text-primary';
  if (s.includes('pending') || s.includes('progress') || s.includes('upcoming') || s.includes('review')) return 'bg-amber-100 text-amber-700';
  if (s.includes('overdue') || s.includes('expired') || s.includes('failed')) return 'bg-destructive/10 text-destructive';
  return 'bg-muted text-muted-foreground';
}

function Shell({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const current = location === '/settings'
    ? { href: '/settings', label: 'Settings', icon: Settings2 }
    : ([...navItems, ...adminItems].find((item) =>
        item.href === '/' ? location === item.href : location === item.href || location.startsWith(item.href + '/')
      ) || navItems[0]);
  return (
    <div className="min-h-[100dvh] bg-background text-foreground">
      <aside className={cx('fixed inset-y-0 left-0 z-40 flex w-[254px] flex-col bg-sidebar text-sidebar-foreground transition-transform duration-200 lg:translate-x-0', mobileOpen ? 'translate-x-0' : '-translate-x-full')}>
        <div className="flex h-[72px] items-center gap-3 px-6 border-b border-sidebar-border/50">
          <div className="grid h-8 w-8 place-items-center rounded bg-sidebar-primary text-sidebar-primary-foreground">
            <span className="text-sm font-bold">H</span>
          </div>
          <div>
            <div className="text-[15px] font-bold tracking-tight text-white">HIMT</div>
          </div>
          <button data-testid="button-close-navigation" aria-label="Close navigation" onClick={() => setMobileOpen(false)} className="ml-auto rounded-lg p-1 text-sidebar-foreground/60 hover:bg-sidebar-accent lg:hidden"><X size={18} /></button>
        </div>
        <div className="px-4 py-6 flex-1 overflow-y-auto">
          <nav className="space-y-1" aria-label="Main navigation">
            {navItems.map(({ href, label, icon: Icon }) => <NavItem key={href} href={href} label={label} icon={Icon} active={href === '/' ? location === href : location === href || location.startsWith(href + '/')} onNavigate={() => setMobileOpen(false)} />)}
          </nav>
          <div className="mt-8 mb-3 h-px bg-sidebar-border" />
          <nav className="space-y-1" aria-label="Operations navigation">
            {adminItems.map(({ href, label, icon: Icon }) => <NavItem key={href} href={href} label={label} icon={Icon} active={href === '/' ? location === href : location === href || location.startsWith(href + '/')} onNavigate={() => setMobileOpen(false)} />)}
          </nav>
        </div>
        <div className="mt-auto p-4 border-t border-sidebar-border">
          <Link href="/settings" data-testid="button-settings" className="mb-2 flex w-full items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-white" onClick={() => setMobileOpen(false)}><Settings2 size={18} /> Settings</Link>
          <div className="flex items-center gap-3 rounded-xl px-2 py-2 mt-2">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-sidebar-primary text-xs font-bold text-sidebar-primary-foreground">AM</span>
            <div className="text-left flex-1 min-w-0">
              <span className="block text-sm font-bold text-white truncate">Amina Malik</span>
              <span className="block text-[11px] text-sidebar-foreground/60 truncate">Learner · HLT-2041</span>
            </div>
          </div>
        </div>
      </aside>
      <div className="lg:pl-[254px]">
        <header className="sticky top-0 z-30 flex h-[72px] items-center justify-between border-b border-border bg-card px-5 lg:px-10">
          <div className="flex items-center gap-3">
            <button data-testid="button-open-navigation" aria-label="Open navigation" onClick={() => setMobileOpen(true)} className="rounded-lg p-2 hover:bg-muted lg:hidden"><Menu size={20} /></button>
            <div className="hidden items-center gap-2 text-sm text-muted-foreground sm:flex">
              <span>HIMT</span>
              <ChevronRight size={14} />
              {(() => {
                const subLabel = location.startsWith('/curriculum/courses') ? 'Courses'
                  : location.startsWith('/curriculum/groups') ? 'Groups'
                  : location.startsWith('/curriculum/topics') ? 'Topics'
                  : location.startsWith('/curriculum/contents') ? 'Contents'
                  : location.startsWith('/curriculum/tags') ? 'Tags'
                  : location.startsWith('/curriculum/glossary') ? 'Glossary'
                  : location.startsWith('/curriculum/upload-status') ? 'Upload Status'
                  : location.startsWith('/curriculum/others') ? 'Others'
                  : null;
                return subLabel ? (<><span>{current?.label ?? 'Workspace'}</span><ChevronRight size={14} /><span className="font-semibold text-foreground">{subLabel}</span></>) : (<span className="font-semibold text-foreground">{current?.label ?? 'Workspace'}</span>);
              })()}
            </div>
            <span className="text-lg font-bold sm:hidden">{current?.label ?? 'Workspace'}</span>
          </div>
          <div className="flex items-center gap-2.5">
            <button data-testid="button-help" aria-label="Help centre" className="hidden rounded-full p-2 text-muted-foreground hover:bg-muted hover:text-foreground sm:block"><LifeBuoy size={18} /></button>
            <button data-testid="button-notifications" aria-label="Notifications" className="relative rounded-full p-2 text-muted-foreground hover:bg-muted hover:text-foreground"><Bell size={18} /><span className="absolute right-2 top-2 h-1.5 w-1.5 rounded-full bg-destructive" /></button>
          </div>
        </header>
        <main className="mx-auto max-w-[1500px] px-5 py-7 lg:px-10 lg:py-9">{children}</main>
      </div>
    </div>
  );
}

function NavItem({ href, label, icon: Icon, active, onNavigate }: { href: string; label: string; icon: typeof LayoutDashboard; active: boolean; onNavigate: () => void }) {
  return <Link href={href} onClick={onNavigate} data-testid={`link-nav-${label.toLowerCase().replaceAll(' ', '-')}`} className={cx('group flex items-center gap-3 rounded-full px-4 py-2.5 text-sm font-medium', active ? 'bg-sidebar-primary text-sidebar-primary-foreground font-semibold' : 'text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-white')}><Icon size={18} strokeWidth={active ? 2.5 : 2} /><span>{label}</span></Link>;
}

function PageHeading({ eyebrow, title, description, action }: { eyebrow: string; title: string; description?: string; action?: ReactNode }) {
  return <div className="mb-8 flex flex-col justify-between gap-5 md:flex-row md:items-end"><div><p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-primary">{eyebrow}</p><h1 className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl">{title}</h1>{description && <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">{description}</p>}</div>{action}</div>;
}

function Skeleton({ className = '' }: { className?: string }) { return <div className={cx('animate-pulse rounded-xl bg-muted', className)} />; }
function LoadingPanel() { return <div className="space-y-4"><Skeleton className="h-32 w-full" /><div className="grid gap-4 md:grid-cols-3"><Skeleton className="h-24" /><Skeleton className="h-24" /><Skeleton className="h-24" /></div><Skeleton className="h-72 w-full" /></div>; }
function ErrorPanel({ onRetry, compact = false }: { onRetry: () => void; compact?: boolean }) { return <div className={cx('flex items-center justify-between rounded-xl border border-[hsl(var(--destructive)/.25)] bg-[hsl(var(--destructive)/.06)] p-5', compact ? 'text-sm' : 'min-h-[180px]')}><div className="flex items-center gap-3"><CircleAlert className="text-destructive" size={20} /><div><p className="font-bold">{compact ? 'Could not load this list' : 'Something interrupted the view'}</p><p className="mt-1 text-xs text-muted-foreground">The records are safe. Try refreshing this panel.</p></div></div><button data-testid="button-retry" onClick={onRetry} className="flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-xs font-bold hover:bg-muted"><RefreshCw size={14} /> Retry</button></div>; }
function EmptyPanel({ icon: Icon, title, description, action }: { icon: typeof BookOpen; title: string; description: string; action?: ReactNode }) { return <div className="flex min-h-[220px] flex-col items-center justify-center rounded-xl border border-dashed border-border bg-muted/30 p-8 text-center"><span className="mb-4 grid h-12 w-12 place-items-center rounded-xl bg-background text-primary shadow-sm border border-border"><Icon size={22} /></span><h3 className="text-lg font-bold">{title}</h3><p className="mt-1 max-w-sm text-sm text-muted-foreground">{description}</p>{action}</div>; }
function Pill({ children, tone }: { children: ReactNode; tone?: string }) { return <span className={cx('inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wider', tone ?? statusTone(String(children)))}>{children}</span>; }
function ProgressBar({ value, accent = 'bg-primary' }: { value: number; accent?: string }) { return <div className="h-2 overflow-hidden rounded-full bg-muted"><div className={cx('h-full rounded-full transition-all duration-500', accent)} style={{ width: `${Math.min(100, Math.max(0, value))}%` }} /></div>; }
function Button({ children, onClick, variant = 'primary', testId, type = 'button', disabled = false }: { children: ReactNode; onClick?: () => void; variant?: 'primary' | 'outline' | 'quiet'; testId: string; type?: 'button' | 'submit'; disabled?: boolean }) { return <button type={type} disabled={disabled} data-testid={testId} onClick={onClick} className={cx('inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-bold disabled:cursor-not-allowed disabled:opacity-50', variant === 'primary' && 'bg-primary text-primary-foreground shadow-sm hover:-translate-y-0.5 hover:bg-[hsl(var(--primary)/.9)]', variant === 'outline' && 'border border-border bg-card text-foreground hover:bg-muted shadow-sm', variant === 'quiet' && 'text-muted-foreground hover:bg-muted hover:text-foreground')}>{children}</button>; }

// ─── ResourcePreviewModal ──────────────────────────────────────────────────────
type PreviewResource = { id: string; title: string; type: string; openUrl: string; sourceUrl?: string | null; hasStoredFile?: boolean; mimeType?: string | null };

function getYouTubeId(url: string): string | null {
  const m = url.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/|v\/|shorts\/))([a-zA-Z0-9_-]{11})/);
  return m?.[1] ?? null;
}
function getVimeoId(url: string): string | null {
  const m = url.match(/vimeo\.com\/(?:video\/)?(\d+)/);
  return m?.[1] ?? null;
}

function useWatermarkUrl(): string {
  const { user } = useUser();
  // DRM-008: always include registered email address
  const email = user?.primaryEmailAddress?.emailAddress ?? 'Confidential';
  // DRM-009: optional fields — name, timestamp
  const name  = user?.fullName ?? '';
  const ts    = new Date().toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  const line1 = name ? `${name}  ·  ${email}` : email;
  const line2 = `CONFIDENTIAL  ·  ${ts}`;
  // DRM-011: two staggered rows in a wider tile so the pattern varies across the page
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="420" height="220">
    <g transform="rotate(-30,210,110)">
      <text x="210" y="80" text-anchor="middle" dominant-baseline="middle"
        font-family="system-ui,sans-serif" font-size="12" font-weight="600"
        fill="rgba(255,255,255,0.20)">${line1}</text>
      <text x="210" y="110" text-anchor="middle" dominant-baseline="middle"
        font-family="system-ui,sans-serif" font-size="10" font-weight="500"
        fill="rgba(255,255,255,0.14)">${line2}</text>
    </g>
  </svg>`;
  return `url("data:image/svg+xml;base64,${btoa(svg)}")`;
}

// ── DocumentPageViewer ────────────────────────────────────────────────────────
// Fetches PDF pages rendered server-side (with baked-in watermark) as PNG images.
// The source file is never sent to the browser — only opaque page images are.
function DocumentPageViewer({ resource }: { resource: PreviewResource }) {
  const [pageCount, setPageCount] = useState<number | null>(null);
  const [isPdf,     setIsPdf]     = useState<boolean | null>(null);
  // externalViewer: 'publitas' → show iframe via server-side redirect (URL never in client JS)
  const [externalViewer, setExternalViewer] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [pageImgUrl, setPageImgUrl]   = useState<string | null>(null);
  const [pageLoading, setPageLoading] = useState(true);
  const [pageError,   setPageError]   = useState('');
  // DRM-003: separate one-time token for the Publitas iframe src (issued after page-count response)
  const [publitasToken, setPublitasToken] = useState<string | null>(null);

  const base = resource.openUrl; // e.g. /api/curriculum/resources/:id/admin-view

  // 1. Fetch page count — DRM-003: fresh one-time token per request
  useEffect(() => {
    let cancelled = false;
    fetchWithContentToken(`${base}/page-count`, resource.id)
      .then(r => r.json())
      .then((d: { pageCount: number | null; isPdf: boolean; externalViewer?: string }) => {
        if (cancelled) return;
        setIsPdf(d.isPdf);
        setPageCount(d.pageCount);
        setExternalViewer(d.externalViewer ?? null);
      })
      .catch(() => { if (!cancelled) setIsPdf(false); });
    return () => { cancelled = true; };
  }, [base, resource.id]);

  // 1b. When Publitas is detected, issue a fresh token for the iframe src URL
  useEffect(() => {
    if (externalViewer !== 'publitas') return;
    let cancelled = false;
    issueContentToken(resource.id)
      .then(t => { if (!cancelled) setPublitasToken(t); })
      .catch(() => { if (!cancelled) setPublitasToken(null); });
    return () => { cancelled = true; };
  }, [externalViewer, resource.id]);

  // 2. Fetch each page image (blob URL so no raw endpoint URL in the DOM)
  useEffect(() => {
    if (!isPdf || !pageCount) return;
    let cancelled = false;
    setPageLoading(true);
    setPageError('');
    fetchWithContentToken(`${base}/page/${currentPage}`, resource.id)
      .then(async r => {
        if (!r.ok) throw new Error(`Server returned ${r.status}`);
        const blob = await r.blob();
        if (cancelled) return;
        const url = URL.createObjectURL(blob);
        setPageImgUrl(prev => { if (prev) URL.revokeObjectURL(prev); return url; });
        setPageLoading(false);
      })
      .catch(e => { if (!cancelled) { setPageError(String(e)); setPageLoading(false); } });
    return () => { cancelled = true; };
  }, [base, currentPage, isPdf, pageCount, resource.id]);

  // 3. Revoke final blob URL on unmount
  useEffect(() => () => { setPageImgUrl(prev => { if (prev) URL.revokeObjectURL(prev); return null; }); }, []);

  if (isPdf === null) return (
    <div className="flex h-full flex-col items-center justify-center gap-3 text-gray-400">
      <RefreshCw size={28} className="animate-spin text-primary" />
      <span className="text-sm">Loading document…</span>
    </div>
  );

  if (isPdf === false) {
    // Publitas web publication: embed via the server-side redirect endpoint.
    // The Publitas URL is never exposed in client-side JavaScript — the browser
    // follows a 302 from /open or /admin-view with only enrollment-gated access.
    if (externalViewer === 'publitas') {
      // Wait for the per-iframe one-time token before setting the src (DRM-003)
      if (!publitasToken) return (
        <div className="flex h-full flex-col items-center justify-center gap-3 text-gray-400">
          <RefreshCw size={28} className="animate-spin text-primary" />
          <span className="text-sm">Loading publication…</span>
        </div>
      );
      return (
        <iframe
          src={`${resource.openUrl}?token=${publitasToken}`}
          allowFullScreen
          className="h-full w-full border-0"
          title={resource.title}
          sandbox="allow-scripts allow-same-origin allow-popups allow-forms"
        />
      );
    }
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-gray-400">
        <FileText size={28} className="text-amber-400" />
        <span className="text-sm font-medium text-gray-300">This document format cannot be previewed.</span>
        <span className="text-xs text-gray-500">Contact your administrator to request a PDF version.</span>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col select-none">
      {/* Page image */}
      <div className="relative flex min-h-0 flex-1 items-center justify-center overflow-auto bg-gray-200">
        {pageLoading && (
          <div className="absolute inset-0 flex items-center justify-center bg-gray-200">
            <RefreshCw size={24} className="animate-spin text-primary" />
          </div>
        )}
        {pageError && !pageLoading && (
          <div className="flex flex-col items-center gap-2 text-red-400">
            <CircleAlert size={24} />
            <span className="text-sm">{pageError}</span>
          </div>
        )}
        {pageImgUrl && !pageError && (
          <img
            src={pageImgUrl}
            alt={`Page ${currentPage}`}
            draggable={false}
            onContextMenu={e => e.preventDefault()}
            className="max-h-full max-w-full object-contain shadow-xl"
            style={{ opacity: pageLoading ? 0.4 : 1, transition: 'opacity 0.15s' }}
          />
        )}
      </div>
      {/* Pagination controls — only shown when there are multiple pages */}
      {pageCount !== null && pageCount > 1 && (
        <div className="flex shrink-0 items-center justify-center gap-4 bg-gray-900 px-4 py-2">
          <button
            onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
            disabled={currentPage <= 1}
            className="rounded-lg px-3 py-1.5 text-sm text-gray-300 hover:bg-gray-700 disabled:cursor-not-allowed disabled:opacity-40"
          >‹ Prev</button>
          <span className="text-sm text-gray-400">
            Page <strong className="text-white">{currentPage}</strong> of {pageCount}
          </span>
          <button
            onClick={() => setCurrentPage(p => Math.min(pageCount, p + 1))}
            disabled={currentPage >= pageCount}
            className="rounded-lg px-3 py-1.5 text-sm text-gray-300 hover:bg-gray-700 disabled:cursor-not-allowed disabled:opacity-40"
          >Next ›</button>
        </div>
      )}
    </div>
  );
}

function ResourcePreviewModal({ resource, onClose }: { resource: PreviewResource; onClose: () => void }) {
  const watermarkUrl = useWatermarkUrl();
  // sourceUrl is only populated for Video resources (redacted for Documents server-side
  // to prevent external document URL exposure — see DRM note in lms.ts activityFor/toActivity).
  const src = resource.sourceUrl ?? '';
  const ytId  = src ? getYouTubeId(src) : null;
  const vimId = src ? getVimeoId(src) : null;

  // Recording resources (stored MP4/audio) stream raw bytes like Video resources.
  // All other non-media types (Document, Learning package, etc.) go through the
  // page-image renderer (DocumentPageViewer). Publitas publications, detected via
  // the page-count response, render as iframes within DocumentPageViewer — their
  // URLs are never returned in client JSON, only resolved server-side on request.
  const MEDIA_TYPES = new Set(['Video', 'Recording']);
  const isStoredDoc = !MEDIA_TYPES.has(resource.type ?? '') && !ytId && !vimId;
  // Only fetch blob for media resources (the player needs a raw byte stream).
  const needsBlob = !isStoredDoc && !ytId && !vimId;

  const [blobUrl,    setBlobUrl]    = useState<string | null>(null);
  const [fetchState, setFetchState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [fetchErr,   setFetchErr]   = useState('');

  useEffect(() => {
    if (!needsBlob) { setFetchState('ready'); return; }
    let cancelled = false;
    setFetchState('loading');
    setFetchErr('');
    setBlobUrl(null);
    // DRM-003: fetch with a fresh one-time token in the Authorization header
    fetchWithContentToken(resource.openUrl, resource.id)
      .then(async r => {
        if (!r.ok) throw new Error(`Server returned ${r.status}`);
        const blob = await r.blob();
        if (cancelled) return;
        setBlobUrl(URL.createObjectURL(blob));
        setFetchState('ready');
      })
      .catch(e => {
        if (!cancelled) { setFetchErr(String(e)); setFetchState('error'); }
      });
    return () => {
      cancelled = true;
      setBlobUrl(prev => { if (prev) URL.revokeObjectURL(prev); return null; });
    };
  }, [resource.openUrl, resource.id, needsBlob]);

  // ── DRM: block print / save shortcuts and blank the page on @media print ──
  useEffect(() => {
    const blockShortcuts = (e: KeyboardEvent) => {
      const ctrl = e.ctrlKey || e.metaKey;
      if (ctrl && (e.key === 'p' || e.key === 'P' || e.key === 's' || e.key === 'S')) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    // Capture phase so it intercepts before the browser's native handler
    window.addEventListener('keydown', blockShortcuts, true);

    // If focus escapes into the PDF iframe, pull it back immediately so
    // the keydown listener above stays effective
    const refocusOnBlur = () => { window.focus(); };
    window.addEventListener('blur', refocusOnBlur);

    // Inject @media print rule while the modal is mounted
    const style = document.createElement('style');
    style.setAttribute('data-noprint', '');
    style.textContent = '@media print { body * { visibility: hidden !important; display: none !important; } }';
    document.head.appendChild(style);

    return () => {
      window.removeEventListener('keydown', blockShortcuts, true);
      window.removeEventListener('blur', refocusOnBlur);
      style.remove();
    };
  }, []);

  let viewer: ReactNode;
  if (ytId) {
    viewer = (
      <iframe
        src={`https://www.youtube.com/embed/${ytId}?autoplay=1&rel=0`}
        allow="autoplay; fullscreen; picture-in-picture"
        allowFullScreen
        className="h-full w-full border-0"
      />
    );
  } else if (vimId) {
    viewer = (
      <iframe
        src={`https://player.vimeo.com/video/${vimId}?autoplay=1`}
        allow="autoplay; fullscreen; picture-in-picture"
        allowFullScreen
        className="h-full w-full border-0"
      />
    );
  } else if (isStoredDoc) {
    // Stored document (PDF or other): serve as page images with baked-in watermark.
    // The source file is never sent to the browser.
    viewer = <DocumentPageViewer resource={resource} />;
  } else if (fetchState === 'loading') {
    viewer = (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-gray-400">
        <RefreshCw size={28} className="animate-spin text-primary" />
        <span className="text-sm">Loading {resource.type.toLowerCase()}…</span>
      </div>
    );
  } else if (fetchState === 'error') {
    viewer = (
      <div className="flex h-full flex-col items-center justify-center gap-3">
        <CircleAlert size={28} className="text-red-400" />
        <span className="text-sm text-red-300">{fetchErr || 'Could not load resource'}</span>
      </div>
    );
  } else if (blobUrl && (resource.type === 'Video' || resource.type === 'Recording')) {
    viewer = (
      <video
        controls
        autoPlay
        controlsList="nodownload nofullscreen"
        disablePictureInPicture
        onContextMenu={e => e.preventDefault()}
        className="h-full w-full bg-black"
        src={blobUrl}
      />
    );
  } else if (blobUrl) {
    // Fallback blob viewer for external-URL resources (server redirected to sourceUrl)
    viewer = <iframe src={blobUrl} className="h-full w-full border-0 bg-white" tabIndex={-1} />;
  } else {
    viewer = null;
  }

  return (
    <div className="fixed inset-0 z-[60] flex flex-col bg-black/95" onContextMenu={e => e.preventDefault()} onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      {/* Top bar */}
      <div className="flex shrink-0 items-center justify-between gap-4 bg-gray-900 px-4 py-3">
        <div className="flex min-w-0 items-center gap-2.5">
          {resource.type === 'Video'
            ? <Video size={15} className="shrink-0 text-blue-400" />
            : <FileText size={15} className="shrink-0 text-amber-400" />}
          <span className="truncate text-sm font-semibold text-white">{resource.title}</span>
          <span className="shrink-0 rounded bg-gray-700 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-gray-300">
            {resource.type}
          </span>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-700 hover:text-white transition-colors"
        >
          <X size={18} />
        </button>
      </div>
      {/* Viewer */}
      <div className="relative min-h-0 flex-1">
        {viewer}
        {/* Watermark — pointer-events:none so it never blocks interaction */}
        <div
          aria-hidden="true"
          style={{ backgroundImage: watermarkUrl, backgroundRepeat: 'repeat', pointerEvents: 'none' }}
          className="absolute inset-0 z-10"
        />
      </div>
    </div>
  );
}

function DashboardPage() {
  const [, setLocation] = useLocation();
  const query = useGetDashboard({ query: { queryKey: getGetDashboardQueryKey() } });
  const analyticsQuery = useGetAnalyticsOverview({ query: { queryKey: getGetAnalyticsOverviewQueryKey() } });
  const dashboard = query.data as Dashboard | undefined;
  const analytics = analyticsQuery.data as AnalyticsOverview | undefined;

  if (query.isLoading) return <><PageHeading eyebrow="Monday, 16 September 2024" title="Good morning, Amina." description="Your learning route is clear. Here is what deserves your attention today." /><LoadingPanel /></>;
  if (query.isError || !dashboard) return <><PageHeading eyebrow="Learner overview" title="Good morning, Amina." /><ErrorPanel onRetry={() => query.refetch()} /></>;
  const learner = dashboard.learner;
  const activeCourses = dashboard.courses.filter((course) => course.status.toLowerCase().includes('active') || course.progress > 0).slice(0, 3);
  
  const pieData = [
    { name: 'Completed', value: learner.averageProgress, color: 'hsl(var(--primary))' },
    { name: 'Remaining', value: 100 - learner.averageProgress, color: 'hsl(var(--muted))' }
  ];

  return <div className="space-y-6">
    <PageHeading eyebrow={`Learner ID: ${learner.learnerId}`} title={`Welcome back, ${learner.name.split(' ')[0]}.`} description="Here's how your learning journey is progressing." action={<Button testId="button-browse-courses" onClick={() => setLocation('/courses')} variant="outline"><BookOpen size={16} /> Browse catalogue</Button>} />
    
    <div className="grid gap-4 grid-cols-2 md:grid-cols-3 lg:grid-cols-5">
      <MetricCard label="Overall Progress" value={`${learner.averageProgress}%`} hint="On track" icon={TrendingUp} />
      <MetricCard label="Courses Enrolled" value={dashboard.courses.length} hint="Total courses" icon={BookOpen} />
      <MetricCard label="Assessments" value={dashboard.assignments.length} hint="Pending tasks" icon={ClipboardCheck} />
      <MetricCard label="Concept Mastery" value={`${learner.averageProgress}%`} hint="Avg. progress" icon={Activity} />
      <MetricCard label="Study Streak" value={`${learner.streak} days`} hint="Keep going" icon={Award} />
    </div>

    <div className="grid gap-6 lg:grid-cols-3">
      <div className="lg:col-span-2 space-y-6">
        <section className="rounded-xl border border-border bg-card p-5 sm:p-6 shadow-xs">
          <h2 className="text-lg font-bold">Course overview</h2>
          <div className="mt-6 flex flex-col md:flex-row gap-8 items-center">
            <div className="w-44 h-44 shrink-0 relative">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={pieData} innerRadius={60} outerRadius={80} paddingAngle={0} dataKey="value" stroke="none">
                    {pieData.map((entry, index) => <Cell key={`cell-${index}`} fill={entry.color} />)}
                  </Pie>
                </PieChart>
              </ResponsiveContainer>
              <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                <span className="text-3xl font-bold">{learner.averageProgress}%</span>
              </div>
            </div>
            <div className="flex-1 w-full space-y-5">
              {activeCourses.length ? activeCourses.map(course => (
                <div key={course.id}>
                  <div className="flex justify-between text-sm mb-1.5">
                    <span className="font-semibold">{course.name}</span>
                    <span className="font-semibold text-muted-foreground">{course.progress}%</span>
                  </div>
                  <ProgressBar value={course.progress} />
                </div>
              )) : <p className="text-sm text-muted-foreground">No active courses. Browse the catalogue to begin.</p>}
            </div>
          </div>
        </section>

        <section className="rounded-xl border border-border bg-card p-5 sm:p-6 shadow-xs">
          <SectionTitle title="Upcoming tasks" meta={`${dashboard.assignments.length} total`} link="/assignments" />
          {dashboard.assignments.length ? <div className="mt-5 divide-y divide-border">{dashboard.assignments.slice(0, 4).map((assignment) => <AssignmentRow key={assignment.id} assignment={assignment} />)}</div> : <EmptyPanel icon={ClipboardCheck} title="No open tasks" description="When faculty assign work, it will appear here." />}
        </section>
      </div>

      <div className="space-y-6">
        <section className="rounded-xl border border-[hsl(var(--primary)/.2)] bg-[hsl(var(--primary)/.05)] p-5 sm:p-6 shadow-xs">
          <div className="flex items-center gap-2 text-primary mb-3">
            <Sparkles size={18} />
            <h2 className="text-lg font-bold">Learning Insights</h2>
          </div>
          <p className="text-sm leading-relaxed text-foreground/80">
            Keep attending live sessions — your attendance drives completion. You are on a {learner.streak} day streak, maintaining your momentum this week will put you ahead of your cohort.
          </p>
        </section>

        <section className="rounded-xl border border-border bg-card p-5 sm:p-6 shadow-xs">
          <h2 className="text-lg font-bold mb-6">Progress by assessment</h2>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={analytics?.weeklyActivity || []}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
                <XAxis dataKey="label" axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))', fontWeight: 500 }} dy={10} />
                <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))', fontWeight: 500 }} />
                <Tooltip cursor={{ fill: 'hsl(var(--muted))' }} contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }} />
                <Bar dataKey="value" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} maxBarSize={32} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </section>
      </div>
    </div>
  </div>;
}

function MetricCard({ label, value, hint, icon: Icon }: { label: string; value: ReactNode; hint: string; icon: typeof BookOpen; }) { 
  return (
    <div className="rounded-xl border border-border bg-card p-4 shadow-xs flex items-center justify-between gap-3">
      <div className="min-w-0">
        <p data-testid={`metric-${label.toLowerCase().replaceAll(' ', '-')}`} className="text-2xl font-bold truncate">{value}</p>
        <p className="text-xs font-semibold text-muted-foreground mt-0.5 truncate">{label}</p>
        <p className="text-[10px] font-semibold text-primary mt-1 uppercase tracking-wide truncate">{hint}</p>
      </div>
      <div className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground">
        <Icon size={20} />
      </div>
    </div>
  ); 
}
function SectionTitle({ title, meta, link }: { title: string; meta: string; link?: string }) { return <div className="flex items-center justify-between"><div><h2 className="text-lg font-bold tracking-tight">{title}</h2><p className="mt-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{meta}</p></div>{link && <Link href={link} data-testid={`link-view-${title.toLowerCase().replaceAll(' ', '-')}`} className="text-xs font-bold text-primary hover:underline">View all <ArrowRight size={13} className="ml-1 inline" /></Link>}</div>; }
function AssignmentRow({ assignment }: { assignment: Assignment }) {
  const isHigh = assignment.priority.toLowerCase().includes('high');
  const isMed = assignment.priority.toLowerCase().includes('medium');
  return <div data-testid={`assignment-row-${assignment.id}`} className="flex items-center gap-3 py-3"><span className={cx('h-2 w-2 shrink-0 rounded-full', isHigh ? 'bg-destructive' : isMed ? 'bg-amber-500' : 'bg-primary')} /><div className="min-w-0 flex-1"><p className="truncate text-sm font-bold">{assignment.title}</p><p className="mt-0.5 truncate text-xs text-muted-foreground">{assignment.course} · Due {niceDate(assignment.dueDate)}</p></div><Pill>{assignment.status}</Pill></div>; 
}

function CoursesPage() {
  const [search, setSearch] = useState(''); const [status, setStatus] = useState(''); const [open, setOpen] = useState(false);
  const query = useListCourses({ search: search || undefined, status: status || undefined }, { query: { queryKey: getListCoursesQueryKey({ search: search || undefined, status: status || undefined }) } });
  const courses = (query.data as Course[] | undefined) ?? [];
  return <div><PageHeading eyebrow="Learning catalogue" title="Courses" description="Explore the training route, check progress and keep every competency moving." action={<Button testId="button-create-course" onClick={() => setOpen(true)}><Plus size={16} /> Create course</Button>} />
    <div className="mb-6 flex flex-col gap-3 rounded-xl border border-border bg-card p-3 shadow-xs sm:flex-row"><label className="relative flex flex-1 items-center"><Search size={17} className="absolute left-3 text-muted-foreground" /><input data-testid="input-search-courses" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by course, code or category" className="h-11 w-full rounded-lg bg-muted/60 pl-10 pr-3 text-sm outline-none placeholder:text-muted-foreground focus:ring-2 focus:ring-ring/30" /></label><label className="flex items-center gap-2 rounded-lg bg-muted/60 px-3"><Filter size={15} className="text-muted-foreground" /><select data-testid="select-course-status" value={status} onChange={(e) => setStatus(e.target.value)} className="h-11 bg-transparent text-sm font-semibold outline-none"><option value="">All statuses</option><option value="active">Active</option><option value="upcoming">Upcoming</option><option value="completed">Completed</option></select></label><Button testId="button-course-filters" variant="quiet" onClick={() => { setSearch(''); setStatus(''); }}><SlidersHorizontal size={16} /> Clear</Button></div>
    {query.isLoading ? <LoadingPanel /> : query.isError ? <ErrorPanel onRetry={() => query.refetch()} /> : courses.length === 0 ? <EmptyPanel icon={BookOpen} title="No courses match that search" description="Try a broader term or clear the filters to see the full catalogue." action={<Button testId="button-clear-course-search" variant="outline" onClick={() => { setSearch(''); setStatus(''); }}>Clear search</Button>} /> : <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{courses.map((course, index) => <CourseCard key={course.id} course={course} index={index} />)}</div>}
    {open && <CourseForm onClose={() => setOpen(false)} />}
  </div>;
}
function CourseCard({ course, index }: { course: Course; index: number }) { const shades = ['bg-primary', 'bg-[hsl(168_91%_25%)]', 'bg-[hsl(168_91%_20%)]', 'bg-[hsl(168_91%_35%)]']; return <Link href={`/courses/${course.id}`} data-testid={`card-course-${course.id}`} className="group overflow-hidden rounded-xl border border-border bg-card shadow-xs hover:-translate-y-1 hover:shadow-md transition-all"><div className={cx('relative flex h-32 items-end overflow-hidden p-5 text-primary-foreground', shades[index % shades.length])}><div className="absolute -right-5 -top-8 h-36 w-36 rounded-full border-[18px] border-white/10" /><div className="relative"><span className="text-[10px] font-semibold uppercase tracking-wider opacity-80">{course.code}</span><h3 className="mt-1 max-w-[250px] text-xl font-bold leading-tight">{course.name}</h3></div></div><div className="p-5"><div className="flex items-center justify-between"><Pill>{course.status}</Pill><span className="text-[11px] font-semibold text-muted-foreground">{course.duration}</span></div><div className="mt-6 flex items-end justify-between"><div className="flex-1"><div className="mb-2 flex justify-between text-xs"><span className="font-semibold text-muted-foreground">Your progress</span><span className="font-bold">{course.progress}%</span></div><ProgressBar value={course.progress} /></div><ChevronRight className="ml-4 text-muted-foreground transition group-hover:translate-x-1" size={18} /></div><p className="mt-4 text-[11px] font-medium text-muted-foreground">{course.learners} enrolled · {course.language}</p></div></Link>; }
function CourseForm({ onClose }: { onClose: () => void }) { const create = useCreateCourse(); const [form, setForm] = useState({ name: '', code: '', category: 'Maritime operations', language: 'English', duration: '6 weeks' }); const submit = (e: FormEvent) => { e.preventDefault(); create.mutate({ data: form }, { onSuccess: () => { queryClient.invalidateQueries({ queryKey: getListCoursesQueryKey() }); onClose(); } }); }; return <Modal title="Create a course" onClose={onClose}><form onSubmit={submit} className="space-y-4"><Field label="Course name"><input required data-testid="input-course-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Bridge resource management" className="form-input" /></Field><div className="grid gap-4 sm:grid-cols-2"><Field label="Course code"><input required data-testid="input-course-code" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} placeholder="BRM-204" className="form-input" /></Field><Field label="Duration"><input required data-testid="input-course-duration" value={form.duration} onChange={(e) => setForm({ ...form, duration: e.target.value })} className="form-input" /></Field></div><div className="grid gap-4 sm:grid-cols-2"><Field label="Category"><input data-testid="input-course-category" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} className="form-input" /></Field><Field label="Language"><input data-testid="input-course-language" value={form.language} onChange={(e) => setForm({ ...form, language: e.target.value })} className="form-input" /></Field></div><div className="flex justify-end gap-2 pt-3"><Button testId="button-cancel-course" variant="quiet" onClick={onClose}>Cancel</Button><Button testId="button-submit-course" type="submit" disabled={create.isPending}>{create.isPending ? 'Creating…' : 'Create course'}</Button></div></form></Modal>; }

function CourseDetailPage() {
  const { courseId = '' } = useParams<{ courseId: string }>();
  const query = useGetCourse(courseId, { query: { queryKey: getGetCourseQueryKey(courseId), enabled: Boolean(courseId) } });
  const course = query.data as CourseDetail | undefined;
  const [expanded, setExpanded] = useState<string | null>(null);
  const { isSignedIn, isLoaded } = useUser();
  const [previewResource, setPreviewResource] = useState<PreviewResource | null>(null);

  // Admin auth — same session-cookie pattern used across the app
  const [isAdmin,    setIsAdmin]    = useState<boolean | null>(null);
  const [showLogin,  setShowLogin]  = useState(false);
  const [loginUser,  setLoginUser]  = useState('');
  const [loginPass,  setLoginPass]  = useState('');
  const [loginBusy,  setLoginBusy]  = useState(false);
  const [loginError, setLoginError] = useState('');

  useEffect(() => {
    apiFetch<{ isAdmin: boolean }>('/auth/status')
      .then(r => setIsAdmin(r.isAdmin))
      .catch(() => setIsAdmin(false));
  }, []);

  // Refetch when Clerk learner signs in (unlocks openUrl for enrolled learner)
  useEffect(() => {
    if (isSignedIn) void apiFetch('/learner/me').then(() => query.refetch()).catch(() => undefined);
  }, [isSignedIn]);

  // Refetch when admin signs in so openUrl is populated immediately
  useEffect(() => {
    if (isAdmin) void query.refetch();
  }, [isAdmin]);

  const handleAdminLogin = async (e: FormEvent) => {
    e.preventDefault();
    setLoginBusy(true);
    setLoginError('');
    try {
      await apiFetch('/auth/login', 'POST', { username: loginUser, password: loginPass });
      setIsAdmin(true);
      setShowLogin(false);
    } catch {
      setLoginError('Incorrect username or password.');
    } finally {
      setLoginBusy(false);
    }
  };

  if (query.isLoading) return <LoadingPanel />;
  if (query.isError || !course) return <ErrorPanel onRetry={() => query.refetch()} />;

  return (
    <div>
      <Link href="/courses" data-testid="link-back-courses" className="mb-7 inline-flex items-center gap-2 text-xs font-bold text-muted-foreground hover:text-foreground">
        <ChevronLeft size={15} /> All courses
      </Link>

      {/* ── Course hero ── */}
      <div className="mb-8 overflow-hidden rounded-xl bg-primary text-primary-foreground shadow-xs">
        <div className="relative p-6 sm:p-10">
          <div className="absolute right-0 top-0 h-full w-2/5 overflow-hidden opacity-20">
            <div className="absolute -right-16 -top-16 h-80 w-80 rounded-full border-[34px] border-white/20" />
            <div className="absolute right-24 top-20 h-40 w-40 rounded-full border-[20px] border-white/20" />
          </div>
          <div className="relative max-w-2xl">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-primary-foreground/80">{course.code} · {course.category}</span>
            <h1 className="mt-3 text-3xl font-bold tracking-tight sm:text-4xl">{course.name}</h1>
            <p className="mt-4 max-w-xl text-sm leading-relaxed text-primary-foreground/90">{course.description}</p>
            <div className="mt-7 flex flex-wrap items-center gap-4">
              <Button testId="button-resume-course" variant="outline" onClick={() => setExpanded(course.topics[0]?.id ?? null)}>
                <Activity size={16} /> Resume course
              </Button>
              <span className="text-[11px] font-semibold uppercase tracking-wider text-primary-foreground/80">{course.progress}% complete · {course.duration}</span>
            </div>
          </div>
        </div>
      </div>

      {/* ── Access banner ── */}
      {isAdmin
        ? <div className="mb-6 flex items-center gap-3 rounded-xl border border-primary/20 bg-primary/5 p-4 text-sm">
            <ShieldCheck size={16} className="shrink-0 text-primary" />
            <span>Admin preview — all resources are accessible.</span>
          </div>
        : isSignedIn
          ? <div className="mb-6 rounded-xl border border-primary/20 bg-primary/5 p-4 text-sm">Your course access is checked before each private learning resource opens.</div>
          : !isLoaded
            ? null
            : <div className="mb-6 flex items-center justify-between gap-4 rounded-xl border border-primary/20 bg-primary/5 p-4 text-sm">
                <span>Sign in to access course materials assigned to you.</span>
                <div className="flex shrink-0 items-center gap-2">
                  <Link href="/sign-in" className="rounded-lg bg-primary px-4 py-2 font-bold text-primary-foreground">Learner sign in</Link>
                  <button data-testid="button-admin-preview" onClick={() => setShowLogin(true)} className="rounded-lg border border-border bg-card px-4 py-2 font-bold text-foreground hover:bg-muted">Admin preview</button>
                </div>
              </div>
      }

      {/* ── Course structure ── */}
      <div className="grid gap-7 xl:grid-cols-[1fr_360px]">
        <section className="rounded-xl border border-border bg-card shadow-xs p-5 sm:p-7">
          <div className="flex items-end justify-between">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wider text-primary">Course route</p>
              <h2 className="mt-1 text-xl font-bold">Structure & activities</h2>
            </div>
            <span className="text-xs font-semibold text-muted-foreground">{course.topics.length} topics</span>
          </div>
          <div className="mt-7 space-y-3">
            {course.topics.map((topic, index) => (
              <TopicBlock key={topic.id} topic={topic} index={index} open={expanded === topic.id} onToggle={() => !topic.locked && setExpanded(expanded === topic.id ? null : topic.id)} onOpenDocument={setPreviewResource} />
            ))}
          </div>
        </section>
        <aside className="space-y-5">
          <section className="rounded-xl border border-border bg-card shadow-xs p-6">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-primary">At a glance</p>
            <div className="mt-5 space-y-5">
              <div>
                <div className="flex justify-between text-sm"><span className="text-muted-foreground">Progress</span><b>{course.progress}%</b></div>
                <div className="mt-2"><ProgressBar value={course.progress} /></div>
              </div>
              <InfoLine label="Language" value={course.language} />
              <InfoLine label="Learners" value={String(course.learners)} />
              <InfoLine label="Status" value={course.status} />
            </div>
          </section>
          <section className="rounded-xl border border-border bg-muted/40 p-6">
            <div className="flex gap-3">
              <GraduationCap size={18} className="shrink-0 text-primary" />
              <div>
                <h3 className="font-bold text-sm">What you will be able to do</h3>
                <ul className="mt-3 space-y-2 text-sm leading-relaxed text-muted-foreground">
                  {course.objectives.map((objective) => (
                    <li key={objective} className="flex gap-2"><Check size={14} className="mt-1 shrink-0 text-primary" />{objective}</li>
                  ))}
                </ul>
              </div>
            </div>
          </section>
        </aside>
      </div>

      {/* ── Document page-image viewer (learner DRM modal) ── */}
      {previewResource && (
        <ResourcePreviewModal resource={previewResource} onClose={() => setPreviewResource(null)} />
      )}

      {/* ── Admin login modal ── */}
      {showLogin && (
        <Modal title="Admin preview" onClose={() => setShowLogin(false)}>
          <form onSubmit={handleAdminLogin} className="space-y-4">
            <p className="text-sm text-muted-foreground">Sign in with your HIMT admin credentials to preview all course resources.</p>
            <Field label="Username">
              <input required autoFocus data-testid="input-course-admin-username" value={loginUser} onChange={e => setLoginUser(e.target.value)} className="form-input" placeholder="admin username" autoComplete="username" />
            </Field>
            <Field label="Password">
              <input required type="password" data-testid="input-course-admin-password" value={loginPass} onChange={e => setLoginPass(e.target.value)} className="form-input" autoComplete="current-password" />
            </Field>
            {loginError && <p className="text-sm text-destructive">{loginError}</p>}
            <div className="flex justify-end gap-2 pt-2">
              <Button testId="button-course-admin-cancel" variant="quiet" onClick={() => setShowLogin(false)}>Cancel</Button>
              <Button testId="button-course-admin-login" type="submit" disabled={loginBusy}>{loginBusy ? 'Signing in…' : 'Sign in'}</Button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
function TopicBlock({ topic, index, open, onToggle, onOpenDocument }: { topic: Topic; index: number; open: boolean; onToggle: () => void; onOpenDocument?: (r: PreviewResource) => void }) {
  const hasContent = topic.activities.length > 0 || topic.subtopics.length > 0;
  return <div className={cx('overflow-hidden rounded-xl border border-border', topic.locked && 'opacity-60')}>
    <button data-testid={`button-topic-${topic.id}`} onClick={onToggle} className="flex w-full items-center gap-4 p-4 text-left hover:bg-muted">
      <span className="text-xs font-semibold text-muted-foreground">{String(index + 1).padStart(2, '0')}</span>
      <div className="min-w-0 flex-1"><div className="flex items-center gap-2"><h3 className="truncate text-sm font-bold">{topic.title}</h3>{topic.locked && <LockKeyhole size={13} className="text-muted-foreground" />}</div><div className="mt-2 flex items-center gap-3"><ProgressBar value={topic.progress} accent="bg-primary" /><span className="text-[11px] font-semibold text-muted-foreground">{topic.progress}%</span></div></div>
      <span className="hidden text-[11px] font-semibold text-muted-foreground sm:block">{topic.duration}</span><ChevronDown size={16} className={cx('text-muted-foreground', open && 'rotate-180')} />
    </button>
    {open && <div className="border-t border-border bg-muted/30 p-2">
      {!hasContent && <p className="px-3 py-4 text-xs text-muted-foreground">No learning resources have been migrated for this topic yet.</p>}
      {topic.activities.map((activity) => <ActivityRow key={activity.id} activity={activity} onOpenDocument={onOpenDocument} />)}
      {topic.subtopics.map((subtopic, subtopicIndex) => <SubtopicBlock key={subtopic.id} subtopic={subtopic} index={subtopicIndex} onOpenDocument={onOpenDocument} />)}
    </div>}
  </div>;
}
function SubtopicBlock({ subtopic, index, onOpenDocument }: { subtopic: Subtopic; index: number; onOpenDocument?: (r: PreviewResource) => void }) {
  const [open, setOpen] = useState(false);
  const count = subtopic.activities.length;
  return <div data-testid={`subtopic-${subtopic.id}`} className="mx-2 my-2 overflow-hidden rounded-lg border border-border bg-card">
    <button
      data-testid={`button-subtopic-${subtopic.id}`}
      onClick={() => setOpen(o => !o)}
      className="flex w-full items-center gap-3 px-3 py-3 text-left hover:bg-muted/60"
    >
      <span className="mt-0.5 shrink-0 text-[10px] font-bold uppercase tracking-wider text-primary">Sub-topic {String(index + 1).padStart(2, '0')}</span>
      <h4 className="min-w-0 flex-1 text-xs font-bold leading-relaxed">{subtopic.title}</h4>
      <span className="shrink-0 text-[10px] font-semibold text-muted-foreground">{count} {count === 1 ? 'item' : 'items'}</span>
      <ChevronDown size={14} className={cx('shrink-0 text-muted-foreground transition-transform', open && 'rotate-180')} />
    </button>
    {open && (count > 0
      ? <div className="border-t border-border p-1">{subtopic.activities.map((activity) => <ActivityRow key={activity.id} activity={activity} onOpenDocument={onOpenDocument} />)}</div>
      : <p className="border-t border-border px-3 py-3 text-xs text-muted-foreground">No learning resources have been migrated for this sub-topic yet.</p>)}
  </div>;
}
function ActivityRow({ activity, onOpenDocument }: { activity: ActivityType; onOpenDocument?: (r: PreviewResource) => void }) {
  const isAvailable = Boolean(activity.openUrl);
  const handleClick = () => {
    if (!activity.openUrl) return;
    // Non-video resources → open in the DRM page-image viewer modal so the source file
    // never reaches the browser. Videos and unrecognised types open in a new tab.
    const isVideo = activity.type === 'Video';
    if (!isVideo && onOpenDocument) {
      const a = activity as ActivityType & { sourceUrl?: string | null; mimeType?: string | null; hasStoredFile?: boolean };
      onOpenDocument({ id: activity.id, title: activity.title, type: activity.type ?? '', openUrl: activity.openUrl, sourceUrl: a.sourceUrl ?? null, mimeType: a.mimeType ?? null, hasStoredFile: a.hasStoredFile ?? true });
    } else {
      window.open(activity.openUrl, '_blank', 'noopener,noreferrer');
    }
  };
  return <button
    data-testid={`button-activity-${activity.id}`}
    onClick={handleClick}
    disabled={!isAvailable}
    className={cx('flex w-full items-center gap-3 rounded-lg p-3 text-left hover:bg-card disabled:cursor-default disabled:hover:bg-transparent', isAvailable && 'cursor-pointer')}
  ><span className={cx('grid h-7 w-7 place-items-center rounded-lg', activity.status.toLowerCase().includes('complete') ? 'bg-[hsl(var(--primary)/.15)] text-primary' : 'bg-card text-primary shadow-sm border border-border')}>{activity.status.toLowerCase().includes('complete') ? <Check size={14} /> : activity.protected ? <LockKeyhole size={13} /> : <PlayIcon />}</span><span className="min-w-0 flex-1 truncate text-xs font-semibold">{activity.title}</span><span className="text-[11px] font-semibold text-muted-foreground">{activity.duration}</span>{isAvailable && <Download size={14} className="text-primary" aria-label="Open learning resource" />}</button>;
}
function PlayIcon() { return <span className="ml-0.5 h-0 w-0 border-y-[4px] border-l-[6px] border-y-transparent border-l-current" />; }
function InfoLine({ label, value }: { label: string; value: string }) { return <div className="flex justify-between border-t border-border pt-3 text-sm"><span className="text-muted-foreground">{label}</span><span className="font-semibold">{value}</span></div>; }

function AssignmentsPage() {
  const [status, setStatus] = useState(''); const [open, setOpen] = useState(false); const query = useListAssignments({ status: status || undefined }, { query: { queryKey: getListAssignmentsQueryKey({ status: status || undefined }) } }); const assignments = (query.data as Assignment[] | undefined) ?? [];
  return <div><PageHeading eyebrow="Work queue" title="Assignments" description="Keep submissions, reviews and due dates visible in one calm queue." action={<Button testId="button-create-assignment" onClick={() => setOpen(true)}><Plus size={16} /> New assignment</Button>} /><div className="mb-6 flex items-center justify-between gap-3"><div className="flex gap-1 rounded-xl bg-muted p-1">{['', 'pending', 'submitted', 'overdue'].map((item) => <button key={item || 'all'} data-testid={`button-assignment-filter-${item || 'all'}`} onClick={() => setStatus(item)} className={cx('rounded-lg px-3 py-2 text-xs font-semibold capitalize', status === item ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground')}>{item || 'All'}</button>)}</div><Button testId="button-assignment-filter-menu" variant="quiet"><Filter size={15} /> <span className="hidden sm:inline">Filter</span></Button></div>{query.isLoading ? <LoadingPanel /> : query.isError ? <ErrorPanel onRetry={() => query.refetch()} /> : assignments.length === 0 ? <EmptyPanel icon={ClipboardCheck} title="The queue is clear" description="No assignments are waiting in this view. A focused day ahead." action={<Button testId="button-empty-create-assignment" onClick={() => setOpen(true)}><Plus size={15} /> Add assignment</Button>} /> : <div className="overflow-x-auto rounded-xl border border-border bg-card shadow-xs"><table className="w-full min-w-[700px] text-left"><thead><tr className="border-b border-border bg-muted/40 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground"><th className="px-4 py-3">Assignment</th><th className="px-4 py-3">Course</th><th className="px-4 py-3">Due</th><th className="px-4 py-3">Assessor</th><th className="px-4 py-3">Status</th><th className="px-4 py-3" /></tr></thead><tbody className="divide-y divide-border">{assignments.map((assignment) => { const isHigh = assignment.priority.toLowerCase().includes('high'); const isMed = assignment.priority.toLowerCase().includes('medium'); return <tr key={assignment.id} data-testid={`row-assignment-${assignment.id}`} className="hover:bg-muted/30"><td className="px-4 py-3"><div className="flex items-center gap-3"><span className={cx('h-2 w-2 rounded-full', isHigh ? 'bg-destructive' : isMed ? 'bg-amber-500' : 'bg-primary')} /><div><p className="text-sm font-bold">{assignment.title}</p><p className="mt-1 text-xs text-muted-foreground">{assignment.submitted ? 'Submitted for review' : 'Learner submission'}</p></div></div></td><td className="px-4 py-3 text-sm text-muted-foreground">{assignment.course}</td><td className="px-4 py-3 text-[11px] font-semibold">{niceDate(assignment.dueDate)}</td><td className="px-4 py-3 text-sm">{assignment.assessor}</td><td className="px-4 py-3"><Pill>{assignment.status}</Pill></td><td className="px-4 py-3 text-right"><button data-testid={`button-assignment-more-${assignment.id}`} aria-label={`More actions for ${assignment.title}`} className="rounded-lg p-2 hover:bg-muted"><MoreHorizontal size={16} /></button></td></tr>; })}</tbody></table></div>}{open && <AssignmentForm onClose={() => setOpen(false)} />}</div>;
}
function AssignmentForm({ onClose }: { onClose: () => void }) { const create = useCreateAssignment(); const [form, setForm] = useState({ title: '', course: '', dueDate: '', assessor: '' }); const submit = (e: FormEvent) => { e.preventDefault(); create.mutate({ data: form }, { onSuccess: () => { queryClient.invalidateQueries({ queryKey: getListAssignmentsQueryKey() }); onClose(); } }); }; return <Modal title="New assignment" onClose={onClose}><form onSubmit={submit} className="space-y-4"><Field label="Assignment title"><input required data-testid="input-assignment-title" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} className="form-input" placeholder="e.g. Navigation watch report" /></Field><Field label="Course"><input required data-testid="input-assignment-course" value={form.course} onChange={(e) => setForm({ ...form, course: e.target.value })} className="form-input" placeholder="Course name or code" /></Field><div className="grid gap-4 sm:grid-cols-2"><Field label="Due date"><input required type="date" data-testid="input-assignment-due-date" value={form.dueDate} onChange={(e) => setForm({ ...form, dueDate: e.target.value })} className="form-input" /></Field><Field label="Assessor"><input required data-testid="input-assignment-assessor" value={form.assessor} onChange={(e) => setForm({ ...form, assessor: e.target.value })} className="form-input" /></Field></div><div className="flex justify-end gap-2 pt-3"><Button testId="button-cancel-assignment" variant="quiet" onClick={onClose}>Cancel</Button><Button testId="button-submit-assignment" type="submit" disabled={create.isPending}>{create.isPending ? 'Saving…' : 'Create assignment'}</Button></div></form></Modal>; }

function SessionsPage() { const query = useListSessions({ query: { queryKey: getListSessionsQueryKey() } }); const sessions = (query.data as Session[] | undefined) ?? []; return <div><PageHeading eyebrow="Live learning" title="Sessions" description="Classrooms, webinars and practical sessions, all in one dependable rhythm." action={<Button testId="button-add-session" variant="outline"><Plus size={16} /> Add session</Button>} />{query.isLoading ? <LoadingPanel /> : query.isError ? <ErrorPanel onRetry={() => query.refetch()} /> : sessions.length === 0 ? <EmptyPanel icon={CalendarDays} title="No sessions scheduled" description="When a faculty member schedules a classroom or webinar, it will appear here." /> : <div className="grid gap-4 lg:grid-cols-2">{sessions.map((session, index) => <SessionCard key={session.id} session={session} index={index} />)}</div>}</div>; }
function SessionCard({ session, index }: { session: Session; index: number }) { return <article data-testid={`card-session-${session.id}`} className="group rounded-xl border border-border bg-card p-5 hover:-translate-y-0.5 shadow-xs hover:shadow-md transition-all sm:p-6"><div className="flex items-start justify-between gap-4"><div className="flex gap-4"><div className={cx('grid h-14 w-14 shrink-0 place-items-center rounded-xl text-primary-foreground', index % 2 ? 'bg-[hsl(168_91%_25%)]' : 'bg-primary')}><CalendarDays size={22} /></div><div><Pill>{session.type}</Pill><h2 className="mt-2 text-lg font-bold">{session.title}</h2><p className="mt-1 text-xs font-medium text-muted-foreground">{session.course}</p></div></div><button data-testid={`button-session-more-${session.id}`} aria-label={`More actions for ${session.title}`} className="rounded-lg p-2 text-muted-foreground hover:bg-muted"><MoreHorizontal size={17} /></button></div><div className="mt-6 grid grid-cols-2 gap-3 border-t border-border pt-4 sm:grid-cols-3"><InfoLine label="When" value={`${session.date} · ${session.time}`} /><InfoLine label="Where" value={session.location} /><InfoLine label="Faculty" value={session.faculty} /></div><div className="mt-5 flex items-center justify-between"><Pill tone={statusTone(session.attendance)}>{session.attendance}</Pill>{session.type.toLowerCase().includes('web') && <Button testId={`button-join-session-${session.id}`} variant="outline"><Video size={15} /> Join webinar</Button>}</div></article>; }

function CertificatesPage() { const query = useListCertificates({ query: { queryKey: getListCertificatesQueryKey() } }); const certificates = (query.data as Certificate[] | undefined) ?? []; return <div><PageHeading eyebrow="Credentials & compliance" title="Certificates" description="A clear record of the credentials you have earned and the renewals ahead." action={<Button testId="button-download-certificate-pack" variant="outline"><Download size={16} /> Download record</Button>} />{query.isLoading ? <LoadingPanel /> : query.isError ? <ErrorPanel onRetry={() => query.refetch()} /> : certificates.length === 0 ? <EmptyPanel icon={Award} title="No certificates yet" description="Completed course credentials will be issued and stored here." action={<Link href="/courses" data-testid="link-empty-certificates-courses" className="mt-4 text-sm font-bold text-primary">View courses <ArrowRight size={14} className="ml-1 inline" /></Link>} /> : <div className="grid gap-4 md:grid-cols-2">{certificates.map((certificate, index) => <CertificateCard key={certificate.id} certificate={certificate} index={index} />)}</div>}</div>; }
function CertificateCard({ certificate, index }: { certificate: Certificate; index: number }) { return <article data-testid={`card-certificate-${certificate.id}`} className="relative overflow-hidden rounded-xl border border-border shadow-xs bg-card p-6"><div className="absolute right-0 top-0 h-32 w-32 translate-x-8 -translate-y-8 rounded-full border-[15px] border-primary/5" /><div className="relative flex items-start justify-between gap-4"><div><span className={cx('grid h-10 w-10 place-items-center rounded-lg', index % 2 ? 'bg-primary/10 text-primary' : 'bg-amber-100 text-amber-700')}><Award size={19} /></span><h2 className="mt-5 text-lg font-bold">{certificate.title}</h2><p className="mt-1 text-sm font-medium text-muted-foreground">{certificate.course}</p></div><Pill>{certificate.status}</Pill></div><div className="mt-7 grid grid-cols-2 gap-4 border-t border-border pt-4"><div><p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Issued</p><p className="mt-1 text-sm font-semibold">{niceDate(certificate.issuedOn)}</p></div><div><p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Expires</p><p className="mt-1 text-sm font-semibold">{certificate.expiresOn ? niceDate(certificate.expiresOn) : 'No expiry'}</p></div></div><div className="mt-5 flex items-center justify-between"><span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{certificate.serial}</span><button data-testid={`button-download-certificate-${certificate.id}`} className="flex items-center gap-1.5 text-xs font-bold text-primary hover:underline"><Download size={14} /> Download</button></div></article>; }

function AnalyticsPage() { const query = useGetAnalyticsOverview({ query: { queryKey: getGetAnalyticsOverviewQueryKey() } }); const data = query.data as AnalyticsOverview | undefined; if (query.isLoading) return <LoadingPanel />; if (query.isError || !data) return <ErrorPanel onRetry={() => query.refetch()} />; const maxWeekly = Math.max(...data.weeklyActivity.map((item) => item.value), 1); return <div><PageHeading eyebrow="Operations intelligence" title="Analytics" description="A measured view of learner momentum, course performance and the work still to review." action={<Button testId="button-export-analytics" variant="outline"><Download size={16} /> Export report</Button>} /><div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4"><MetricCard label="Active learners" value={data.activeLearners} hint="Across all programmes" icon={Users} /><MetricCard label="Completion rate" value={`${data.completionRate}%`} hint="All active courses" icon={TrendingUp} /><MetricCard label="Average progress" value={`${data.averageProgress}%`} hint="Current cohort" icon={Activity} /><MetricCard label="Pending reviews" value={data.pendingReviews} hint="Faculty queue" icon={ClipboardCheck} /></div><div className="mt-7 grid gap-7 xl:grid-cols-[1.25fr_1fr]"><section className="rounded-xl border border-border bg-card shadow-xs p-6"><SectionTitle title="Weekly activity" meta="Last 7 weeks" /><div className="mt-8 flex h-64 items-end gap-2 sm:gap-4">{data.weeklyActivity.map((point) => <div key={point.label} className="group flex flex-1 flex-col items-center gap-2"><div className="relative flex h-52 w-full items-end"><div className="w-full rounded-t-sm bg-primary transition-all duration-500 group-hover:bg-primary/80" style={{ height: `${Math.max(5, point.value / maxWeekly * 100)}%` }} /></div><span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{point.label}</span></div>)}</div></section><section className="rounded-xl border border-border bg-card shadow-xs p-6"><SectionTitle title="Course performance" meta="Completion by route" /><div className="mt-6 space-y-5">{data.coursePerformance.map((point, index) => <div key={point.label}><div className="mb-2 flex justify-between gap-3 text-xs"><span className="truncate font-semibold">{point.label}</span><span className="font-semibold text-muted-foreground">{point.value}%</span></div><ProgressBar value={point.value} accent={index % 2 ? 'bg-[hsl(168_91%_25%)]' : 'bg-primary'} /></div>)}</div></section></div></div>; }

type DirectoryUser = {
  id: string;
  name: string;
  email: string;
  role: string;
  group: string;
  status: string;
  lastActivity: string;
};

type Group = {
  id: string;
  name: string;
};

function parseCSV(text: string): Record<string, string>[] {
  const rawRows: string[][] = [];
  let row: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    const next = text[i + 1];

    if (inQuotes) {
      if (c === '"' && next === '"') {
        current += '"';
        i++;
      } else if (c === '"') {
        inQuotes = false;
      } else {
        current += c;
      }
    } else {
      if (c === '"') {
        inQuotes = true;
      } else if (c === ',') {
        row.push(current);
        current = '';
      } else if (c === '\n' || (c === '\r' && next === '\n')) {
        row.push(current);
        rawRows.push(row);
        row = [];
        current = '';
        if (c === '\r') i++;
      } else if (c !== '\r') {
        current += c;
      }
    }
  }
  if (current || row.length > 0) {
    row.push(current);
    rawRows.push(row);
  }

  if (rawRows.length < 2) return [];
  const headers = rawRows[0].map((h: string) => h.trim().toLowerCase());
  return rawRows.slice(1).map(r => {
    const obj: Record<string, string> = {};
    headers.forEach((h: string, i: number) => { obj[h] = r[i]?.trim() || ''; });
    return obj;
  }).filter(obj => Object.keys(obj).some(k => obj[k]));
}

function UserFormModal({ user, groups, onClose, onSaved }: { user?: DirectoryUser | null; groups: Group[]; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(user?.name || '');
  const [email, setEmail] = useState(user?.email || '');
  const [role, setRole] = useState(user?.role || 'Learner');
  const [group, setGroup] = useState(user?.group || (groups[0]?.name || ''));
  const [status, setStatus] = useState(user?.status || 'Active');
  const [busy, setBusy] = useState(false);
  const [inviting, setInviting] = useState(false);
  const { toast } = useToast();

  const isEdit = !!user;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      if (isEdit) {
        await apiFetch(`/users/${user.id}`, 'PATCH', { name, role, group, status });
        toast({ title: 'User updated' });
      } else {
        const created = await apiFetch<{ invitationSent: boolean; accountExists: boolean }>('/users', 'POST', { name, email, role, group });
        toast({
          title: created.invitationSent ? 'Invitation sent' : created.accountExists ? 'User linked' : 'Invitation already pending',
          description: created.invitationSent
            ? `Clerk sent an account invitation to ${email}.`
            : created.accountExists
              ? `${email} already has a Clerk account and is now active.`
              : `${email} already has a pending Clerk invitation.`,
        });
      }
      onSaved();
    } catch (err: any) {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    } finally {
      setBusy(false);
    }
  }

  async function sendInvitation() {
    if (!user) return;
    setInviting(true);
    try {
      const result = await apiFetch<{ sent: boolean; accountExists: boolean }>(`/users/${user.id}/invite`, 'POST');
      toast({
        title: result.sent ? 'Invitation sent' : 'Account already active',
        description: result.sent
          ? `Clerk sent a fresh invitation to ${user.email}.`
          : `${user.email} already has a Clerk account. Password recovery is available from Sign in.`,
      });
      onSaved();
    } catch (error) {
      toast({ title: 'Invitation failed', description: error instanceof Error ? error.message : String(error), variant: 'destructive' });
    } finally {
      setInviting(false);
    }
  }

  return (
    <Modal title={isEdit ? 'Edit User' : 'Add User'} onClose={onClose}>
      {!isEdit && (
        <div className="mb-5 rounded-lg border border-primary/30 bg-primary/10 p-3 text-sm text-primary font-medium">
          Clerk emails new users a secure invitation. They accept it through the <Link href="/sign-up" className="underline hover:text-primary">Sign up</Link> flow; passwords and recovery stay with Clerk.
        </div>
      )}
      <form onSubmit={submit} className="space-y-4">
        <Field label="Name"><input required className="form-input" value={name} onChange={e => setName(e.target.value)} /></Field>
        <Field label="Email"><input required type="email" className="form-input" disabled={isEdit} value={email} onChange={e => setEmail(e.target.value)} /></Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Role">
            <select className="form-input" value={role} onChange={e => setRole(e.target.value)}>
              <option value="Learner">Learner</option>
              <option value="Faculty">Faculty</option>
              <option value="Admin">Admin</option>
            </select>
          </Field>
          <Field label="Group">
            <select className="form-input" value={group} onChange={e => setGroup(e.target.value)}>
              {groups.map(g => <option key={g.id} value={g.name}>{g.name}</option>)}
              {groups.length === 0 && <option value="">No groups</option>}
            </select>
          </Field>
        </div>
        {isEdit && (
          <Field label="Status">
            <select className="form-input" value={status} onChange={e => setStatus(e.target.value)}>
              <option value="Active">Active</option>
              <option value="Pending">Pending invite</option>
              <option value="Invited">Invited</option>
              <option value="Suspended">Suspended</option>
            </select>
            <p className="mt-1.5 text-[11px] text-muted-foreground">If a user needs to reset access, direct them to the <Link href="/sign-in" className="underline hover:text-foreground">Sign in</Link> flow.</p>
          </Field>
        )}
        {isEdit && (user.status === 'Pending' || user.status === 'Invited') && (
          <div className="flex items-center justify-between gap-4 rounded-xl border border-amber-200 bg-amber-50 p-3">
            <div>
              <p className="text-xs font-bold text-amber-900">{user.status === 'Pending' ? 'Ready to invite' : 'Invitation pending'}</p>
              <p className="mt-0.5 text-[11px] text-amber-800">
                {user.status === 'Pending' ? 'Send this imported user a secure Clerk invitation.' : 'Send a fresh invitation if the original email expired.'}
              </p>
            </div>
            <Button testId="resend-user-invitation" variant="outline" type="button" onClick={sendInvitation} disabled={inviting}>
              {inviting ? 'Sending…' : user.status === 'Pending' ? 'Send invite' : 'Resend invite'}
            </Button>
          </div>
        )}
        <div className="mt-6 flex justify-end gap-2 pt-2">
          <Button variant="quiet" type="button" onClick={onClose} testId="cancel-user">Cancel</Button>
          <Button type="submit" disabled={busy} testId="save-user">{busy ? 'Saving...' : 'Save User'}</Button>
        </div>
      </form>
    </Modal>
  );
}

function EnrollmentsModal({ user, courses, onClose }: { user: DirectoryUser; courses: Course[]; onClose: () => void }) {
  const [enrolled, setEnrolled] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    apiFetch<{courseId:string}[]>(`/users/${user.id}/enrollments`)
      .then(res => setEnrolled(new Set(res.map(r => r.courseId))))
      .catch(err => toast({ title: 'Could not load enrollments', description: err.message, variant: 'destructive' }))
      .finally(() => setLoading(false));
  }, [user.id, toast]);

  const toggle = (id: string) => {
    const next = new Set(enrolled);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setEnrolled(next);
  };

  const save = async () => {
    setBusy(true);
    try {
      await apiFetch(`/users/${user.id}/enrollments`, 'PUT', { courseIds: Array.from(enrolled) });
      toast({ title: 'Enrollments updated' });
      onClose();
    } catch (e: any) {
      toast({ title: 'Failed to update', description: e.message, variant: 'destructive' });
      setBusy(false);
    }
  };

  return (
    <Modal title={`Enrollments: ${user.name}`} onClose={onClose}>
      {loading ? <div className="py-8 text-center text-sm font-medium text-muted-foreground flex items-center justify-center gap-2"><RefreshCw size={16} className="animate-spin" /> Loading enrollments...</div> : (
        <>
          <div className="mb-6 max-h-[50vh] overflow-y-auto rounded-xl border border-border shadow-inner bg-muted/20">
            {courses.length === 0 ? (
              <div className="p-8 text-center text-sm text-muted-foreground">No courses available in curriculum.</div>
            ) : (
              <div className="divide-y divide-border">
                {courses.map(c => (
                  <label key={c.id} className="flex cursor-pointer items-center gap-4 p-4 hover:bg-muted/60 transition-colors">
                    <input type="checkbox" checked={enrolled.has(c.id)} onChange={() => toggle(c.id)} className="h-4 w-4 rounded border-border" />
                    <div>
                      <div className="text-sm font-semibold">{c.name}</div>
                      <div className="text-xs text-muted-foreground mt-0.5">{c.status}</div>
                    </div>
                  </label>
                ))}
              </div>
            )}
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="quiet" onClick={onClose} testId="cancel-enrollments">Cancel</Button>
            <Button onClick={save} disabled={busy} testId="save-enrollments">{busy ? 'Saving...' : 'Save Enrollments'}</Button>
          </div>
        </>
      )}
    </Modal>
  );
}

function ImportModal({ onClose, onImported }: { onClose: () => void; onImported: (result: any) => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const { toast } = useToast();

  const handleImport = async () => {
    if (!file) return;
    setBusy(true);
    try {
      const text = await file.text();
      const rows = parseCSV(text);
      if (rows.length === 0) throw new Error("No valid rows found in CSV");
      if (!Object.prototype.hasOwnProperty.call(rows[0], 'name') || !Object.prototype.hasOwnProperty.call(rows[0], 'email')) {
        throw new Error("CSV must have 'name' and 'email' columns");
      }

      const res = await apiFetch<any>('/users/import', 'POST', { filename: file.name, rows });
      onImported(res);
    } catch (e: any) {
      toast({ title: 'Import failed', description: e.message, variant: 'destructive' });
      setBusy(false);
    }
  };

  return (
    <Modal title="Import CSV" onClose={onClose}>
       <div className="rounded-xl border-2 border-dashed border-border bg-muted/30 p-8 text-center">
         <span className="mx-auto grid h-12 w-12 place-items-center rounded-xl bg-primary/10 text-primary border border-primary/20 shadow-sm"><FileUp size={22} /></span>
         <h3 className="mt-4 text-lg font-bold">Upload CSV roster</h3>
         <p className="mt-1 text-sm text-muted-foreground mb-6">Required headers: name and email. Role, group, and status are optional.</p>
         <input type="file" accept=".csv" onChange={e => setFile(e.target.files?.[0] || null)} className="mx-auto block text-sm text-slate-500 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-primary/10 file:text-primary hover:file:bg-primary/20 file:cursor-pointer file:transition-colors cursor-pointer" />
       </div>
       <div className="mt-6 flex justify-end gap-2 pt-2">
         <Button variant="quiet" onClick={onClose} testId="cancel-import">Cancel</Button>
         <Button onClick={handleImport} disabled={!file || busy} testId="submit-import">{busy ? 'Importing...' : 'Start Import'}</Button>
       </div>
    </Modal>
  );
}

function UsersPage() {
  const { toast } = useToast();

  // Auth & Session
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);
  const [showLogin, setShowLogin] = useState(false);
  const [loginUser, setLoginUser] = useState('');
  const [loginPass, setLoginPass] = useState('');
  const [loginBusy, setLoginBusy] = useState(false);
  const [loginError, setLoginError] = useState('');

  // Data
  const [users, setUsers] = useState<DirectoryUser[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [courses, setCourses] = useState<Course[]>([]);
  const [loading, setLoading] = useState(true);

  // Filters
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  const [groupFilter, setGroupFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');

  // Modals & UI States
  const [createModal, setCreateModal] = useState(false);
  const [editUser, setEditUser] = useState<DirectoryUser | null>(null);
  const [importModal, setImportModal] = useState(false);
  const [enrollUser, setEnrollUser] = useState<DirectoryUser | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [invitingPending, setInvitingPending] = useState(false);
  const [notice, setNotice] = useState('');

  const checkAuth = useCallback(async () => {
    try {
      const res = await apiFetch<{ isAdmin: boolean }>('/auth/status');
      setIsAdmin(res.isAdmin);
      if (!res.isAdmin) {
        setLoading(false);
        setShowLogin(true);
      }
    } catch {
      setIsAdmin(false);
      setLoading(false);
      setShowLogin(true);
    }
  }, []);

  useEffect(() => { checkAuth(); }, [checkAuth]);

  const loadData = useCallback(async () => {
    if (!isAdmin) return;
    setLoading(true);
    try {
      const [u, g, c] = await Promise.all([
        apiFetch<DirectoryUser[]>('/users'),
        apiFetch<Group[]>('/curriculum/groups'),
        apiFetch<Course[]>('/curriculum/list').catch(() => [] as Course[])
      ]);
      setUsers(u);
      setGroups(g);
      setCourses(c);
    } catch (e: any) {
      toast({ title: 'Failed to load data', description: e.message, variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  }, [isAdmin, toast]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  async function handleAdminLogin(e: FormEvent) {
    e.preventDefault();
    setLoginBusy(true); setLoginError('');
    try {
      await apiFetch('/auth/login', 'POST', { username: loginUser, password: loginPass });
      setIsAdmin(true);
      setShowLogin(false);
      setLoginUser('');
      setLoginPass('');
    } catch (err: any) {
      setLoginError(String(err).replace(/^Error:\s*/, ''));
    } finally {
      setLoginBusy(false);
    }
  }

  async function handleSync() {
    setSyncing(true);
    try {
      const res = await apiFetch<any>('/users/sync-tribyte', 'POST');
      setNotice(`TriByte sync: ${res.usersAdded || 0} added as pending, ${res.usersUpdated || 0} updated, ${res.groupsImported || 0} groups.`);
      loadData();
    } catch (e: any) {
      toast({ title: 'Sync failed', description: e.message, variant: 'destructive' });
    } finally {
      setSyncing(false);
    }
  }

  async function handleInvitePending() {
    const pendingCount = users.filter((user) => user.status === 'Pending').length;
    if (!pendingCount || !window.confirm(`Send Clerk invitation emails to ${pendingCount} pending user${pendingCount === 1 ? '' : 's'}?`)) return;
    setInvitingPending(true);
    try {
      const result = await apiFetch<{ sent: number; activated: number; failed: number }>('/users/invite-pending', 'POST');
      setNotice(`Clerk invitations: ${result.sent} sent, ${result.activated} existing accounts activated, ${result.failed} failed.`);
      await loadData();
    } catch (error) {
      toast({ title: 'Invitations failed', description: error instanceof Error ? error.message : String(error), variant: 'destructive' });
    } finally {
      setInvitingPending(false);
    }
  }

  const displayedUsers = users.filter(u => {
    if (search && !`${u.name} ${u.email}`.toLowerCase().includes(search.toLowerCase())) return false;
    if (roleFilter && u.role !== roleFilter) return false;
    if (groupFilter && u.group !== groupFilter) return false;
    if (statusFilter && u.status !== statusFilter) return false;
    return true;
  });

  return (
    <div>
      <PageHeading
        eyebrow="People & access"
        title="Users & roles"
        description="Keep learner, faculty, and operations access aligned. Real-time sync with TriByte and Clerk."
        action={
          <div className="flex flex-wrap items-center justify-end gap-2">
            <Button testId="btn-sync-tribyte" variant="outline" onClick={handleSync} disabled={syncing || !isAdmin}>
              <RefreshCw size={16} className={syncing ? 'animate-spin' : ''} /> {syncing ? 'Syncing...' : 'Sync TriByte'}
            </Button>
            <Button testId="btn-import-users" variant="outline" onClick={() => setImportModal(true)} disabled={!isAdmin}>
              <Upload size={16} /> Import
            </Button>
            <Button
              testId="btn-invite-pending-users"
              variant="outline"
              onClick={handleInvitePending}
              disabled={!isAdmin || invitingPending || !users.some((user) => user.status === 'Pending')}
            >
              <Send size={16} /> {invitingPending ? 'Sending...' : 'Invite pending'}
            </Button>
            <Button testId="btn-create-user" onClick={() => setCreateModal(true)} disabled={!isAdmin}>
              <Plus size={16} /> Add User
            </Button>
          </div>
        }
      />

      {notice && (
        <div data-testid="status-notice" className="mb-5 flex items-center gap-3 rounded-xl border border-primary/30 bg-primary/10 p-4 text-sm font-semibold text-primary">
          <Check size={18} /> {notice}
          <button data-testid="btn-dismiss-notice" onClick={() => setNotice('')} className="ml-auto rounded-md p-1 hover:bg-primary/20"><X size={15} /></button>
        </div>
      )}

      <section aria-label="Role capabilities" className="mb-6 grid gap-3 md:grid-cols-3">
        {[
          { role: 'Admin', icon: ShieldCheck, detail: 'Manage people, groups, TriByte imports, roles, status, and course access.' },
          { role: 'Faculty', icon: GraduationCap, detail: 'Manage learning groups and teach assigned cohorts, without access to people, imports, or enrollment controls.' },
          { role: 'Learner', icon: BookOpen, detail: 'Open only assigned courses. Suspended learners are denied protected content.' },
        ].map(({ role, icon: Icon, detail }) => (
          <article key={role} className="rounded-xl border border-border bg-card p-4 shadow-xs">
            <div className="flex items-center gap-2 text-primary">
              <span className="grid h-8 w-8 place-items-center rounded-lg bg-primary/10"><Icon size={16} /></span>
              <h2 className="text-sm font-bold text-foreground">{role}</h2>
            </div>
            <p className="mt-3 text-xs leading-relaxed text-muted-foreground">{detail}</p>
          </article>
        ))}
      </section>

      {isAdmin === false && !showLogin && (
        <div className="mb-6 flex flex-col items-start justify-between gap-4 rounded-xl border border-border bg-card p-5 shadow-xs sm:flex-row sm:items-center">
          <div>
            <h2 className="font-bold">Admin session required</h2>
            <p className="mt-1 text-sm text-muted-foreground">Directory data and access controls stay hidden until an HIMT administrator signs in.</p>
          </div>
          <Button testId="button-open-users-admin-login" onClick={() => setShowLogin(true)}><LockKeyhole size={15} /> Sign in</Button>
        </div>
      )}

      <div className="mb-6 flex flex-col gap-3 sm:flex-row rounded-xl border border-border shadow-xs bg-card p-3">
        <label className="relative flex flex-1 items-center">
          <Search size={17} className="absolute left-3 text-muted-foreground" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name or email"
            className="h-10 w-full rounded-lg bg-muted/60 pl-10 pr-3 text-sm outline-none placeholder:text-muted-foreground focus:ring-2 focus:ring-ring/30"
          />
        </label>
        <label className="flex items-center gap-2 rounded-lg bg-muted/60 px-3">
          <ShieldCheck size={15} className="text-muted-foreground" />
          <select value={roleFilter} onChange={(e) => setRoleFilter(e.target.value)} className="h-10 bg-transparent text-sm font-semibold outline-none w-full appearance-none">
            <option value="">All Roles</option>
            <option value="Admin">Admin</option>
            <option value="Faculty">Faculty</option>
            <option value="Learner">Learner</option>
          </select>
        </label>
        <label className="flex items-center gap-2 rounded-lg bg-muted/60 px-3">
          <Layers size={15} className="text-muted-foreground" />
          <select value={groupFilter} onChange={(e) => setGroupFilter(e.target.value)} className="h-10 bg-transparent text-sm font-semibold outline-none w-full appearance-none">
            <option value="">All Groups</option>
            {groups.map(g => <option key={g.id} value={g.name}>{g.name}</option>)}
          </select>
        </label>
        <label className="flex items-center gap-2 rounded-lg bg-muted/60 px-3">
          <Activity size={15} className="text-muted-foreground" />
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="h-10 bg-transparent text-sm font-semibold outline-none w-full appearance-none">
            <option value="">All Statuses</option>
            <option value="Active">Active</option>
            <option value="Pending">Pending invite</option>
            <option value="Invited">Invited</option>
            <option value="Suspended">Suspended</option>
          </select>
        </label>
      </div>

      {loading ? <LoadingPanel /> : (
        displayedUsers.length === 0 ? (
          <EmptyPanel
            icon={Users}
            title="No users found"
            description="Adjust your search filters or add a new user to the directory."
            action={
               <Button testId="btn-empty-add" onClick={() => setCreateModal(true)} disabled={!isAdmin}>
                 <Plus size={16} /> Add User
               </Button>
            }
          />
        ) : (
          <div className="overflow-x-auto rounded-xl border border-border shadow-xs bg-card">
            <table className="w-full min-w-[800px] text-left">
              <thead>
                <tr className="border-b border-border bg-muted/40 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  <th className="px-4 py-3">Person</th>
                  <th className="px-4 py-3">Role</th>
                  <th className="px-4 py-3">Group</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Last Activity</th>
                  <th className="px-4 py-3 text-right">Manage</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {displayedUsers.map((user) => (
                  <tr key={user.id} className="hover:bg-muted/30 transition-colors group">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <span className="grid h-10 w-10 place-items-center rounded-full bg-primary/10 text-xs font-bold text-primary shadow-sm border border-primary/20">{initials(user.name)}</span>
                        <div>
                          <p className="text-sm font-bold text-foreground">{user.name}</p>
                          <p className="text-xs text-muted-foreground">{user.email}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3"><span className="text-sm font-medium">{user.role}</span></td>
                    <td className="px-4 py-3">
                      {user.group ? (
                         <span className="inline-flex items-center gap-1.5 rounded-md bg-muted px-2 py-1 text-xs font-medium text-foreground"><Tag size={12} className="text-muted-foreground" /> {user.group}</span>
                      ) : <span className="text-xs text-muted-foreground">—</span>}
                    </td>
                    <td className="px-4 py-3"><Pill>{user.status}</Pill></td>
                    <td className="px-4 py-3 text-[11px] font-semibold text-muted-foreground">{niceDate(user.lastActivity)}</td>
                    <td className="px-4 py-3 text-right">
                      {isAdmin && (
                        <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button data-testid={`btn-edit-${user.id}`} aria-label={`Edit ${user.name}`} onClick={() => setEditUser(user)} className="rounded-lg p-2 hover:bg-muted text-muted-foreground hover:text-foreground transition-colors tooltip-trigger" title="Edit Profile"><Pencil size={16} /></button>
                          <button data-testid={`btn-enroll-${user.id}`} aria-label={`Enrollments for ${user.name}`} onClick={() => setEnrollUser(user)} className="rounded-lg p-2 hover:bg-muted text-muted-foreground hover:text-primary transition-colors tooltip-trigger" title="Manage Enrollments"><BookOpen size={16} /></button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      )}

      {/* Modals */}
      {showLogin && (
        <Modal title="Admin Session Required" onClose={() => setShowLogin(false)}>
          <p className="mb-6 text-sm text-muted-foreground">This workspace requires a verified operations session. Please sign in.</p>
          <form onSubmit={handleAdminLogin} className="space-y-4">
            <Field label="Username">
              <input required data-testid="input-admin-username" value={loginUser} onChange={e => setLoginUser(e.target.value)} className="form-input" placeholder="admin" />
            </Field>
            <Field label="Password">
              <input required type="password" data-testid="input-admin-password" value={loginPass} onChange={e => setLoginPass(e.target.value)} className="form-input" placeholder="••••••••" />
            </Field>
            {loginError && <p className="rounded-lg bg-destructive/10 border border-destructive/20 p-3 text-sm font-semibold text-destructive">{loginError}</p>}
            <div className="flex justify-end gap-2 pt-4">
              <Button testId="btn-submit-admin-login" type="submit" disabled={loginBusy}>{loginBusy ? 'Authenticating...' : 'Sign in to Workspace'}</Button>
            </div>
          </form>
        </Modal>
      )}

      {(createModal || editUser) && (
        <UserFormModal
          user={editUser}
          groups={groups}
          onClose={() => { setCreateModal(false); setEditUser(null); }}
          onSaved={() => { setCreateModal(false); setEditUser(null); loadData(); }}
        />
      )}

      {importModal && (
        <ImportModal
          onClose={() => setImportModal(false)}
          onImported={(res) => {
            setNotice(`Import complete: ${res.added || 0} added as pending, ${res.updated || 0} updated, ${res.warnings || 0} warnings. Review the roster, then invite pending users.`);
            setImportModal(false);
            loadData();
          }}
        />
      )}

      {enrollUser && (
        <EnrollmentsModal
          user={enrollUser}
          courses={courses}
          onClose={() => setEnrollUser(null)}
        />
      )}
    </div>
  );
}


function Field({ label, children }: { label: string; children: ReactNode }) { return <label className="block"><span className="mb-1.5 block text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</span>{children}</label>; }
function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) { return <div role="dialog" aria-modal="true" className="fixed inset-0 z-50 grid place-items-center bg-[hsl(var(--foreground)/.35)] p-4 backdrop-blur-sm"><div className="max-h-[90dvh] w-full max-w-lg overflow-auto rounded-xl border border-border bg-card p-6 shadow-2xl sm:p-7"><div className="mb-6 flex items-center justify-between"><h2 className="text-2xl font-bold">{title}</h2><button data-testid="button-close-modal" aria-label="Close dialog" onClick={onClose} className="rounded-lg p-2 text-muted-foreground hover:bg-muted"><X size={18} /></button></div>{children}</div></div>; }

// ─── Curriculum helpers ───────────────────────────────────────────────────────
const PROGRAMME_OUTCOMES = ['PO1','PO2','PO3','PO4','PO5','PO6','PO7','PO8','PO9','PO10','PO11','PO12'];
const PO_LABELS: Record<string, string> = {
  PO1: 'Engineering Knowledge', PO2: 'Problem Analysis', PO3: 'Design/Development',
  PO4: 'Investigations', PO5: 'Modern Tools', PO6: 'Engineer & Society',
  PO7: 'Environment', PO8: 'Ethics', PO9: 'Individual & Team',
  PO10: 'Communication', PO11: 'Project Management', PO12: 'Life-long Learning',
};
function bloomsTone(level: string) {
  const m: Record<string, string> = {
    remember:   'bg-slate-100 text-slate-700 border-slate-200',
    understand: 'bg-blue-50 text-blue-700 border-blue-200',
    apply:      'bg-emerald-50 text-emerald-700 border-emerald-200',
    analyze:    'bg-amber-50 text-amber-700 border-amber-200',
    evaluate:   'bg-orange-50 text-orange-700 border-orange-200',
    create:     'bg-purple-50 text-purple-700 border-purple-200',
  };
  return m[level.toLowerCase()] ?? 'bg-gray-100 text-gray-600 border-gray-200';
}
function activityIcon(type: string) {
  const t = type.toLowerCase();
  if (t.includes('video')) return <Video size={13} />;
  if (t.includes('quiz') || t.includes('exam') || t.includes('assessment')) return <ClipboardCheck size={13} />;
  if (t.includes('assignment')) return <FileUp size={13} />;
  if (t.includes('activity')) return <Activity size={13} />;
  return <BookOpen size={13} />;
}
function courseTypeTone(type: string) {
  if (type === 'Core') return 'bg-emerald-50 text-emerald-700';
  if (type === 'Lab') return 'bg-orange-50 text-orange-700';
  return 'bg-blue-50 text-blue-700';
}

// ─── CurriculumPage (tile hub) ────────────────────────────────────────────────
const CURRICULUM_TILES = [
  { label: 'Groups',        href: '/curriculum/groups',        icon: Users,       color: '#5b6cf9', bg: '#eef0ff' },
  { label: 'Courses',       href: '/curriculum/courses',       icon: LayoutGrid,  color: '#f59e0b', bg: '#fffbeb' },
  { label: 'Topic',         href: '/curriculum/topics',        icon: ListChecks,  color: '#14b8a6', bg: '#e6faf8' },
  { label: 'Contents',      href: '/curriculum/contents',      icon: Layers,      color: '#e11d48', bg: '#fff0f3' },
  { label: 'Tags',          href: '/curriculum/tags',          icon: Tag,         color: '#4338ca', bg: '#eef0ff' },
  { label: 'Glossary',      href: '/curriculum/glossary',      icon: FileSearch,  color: '#0ea5e9', bg: '#e6f7ff' },
  { label: 'Upload Status', href: '/curriculum/upload-status', icon: Upload,      color: '#ef4444', bg: '#fff0f0' },
  { label: 'Others',        href: '/curriculum/others',        icon: Settings2,   color: '#d97706', bg: '#fffbeb' },
] as const;

function CurriculumPage() {
  return (
    <div className="-mx-5 -my-7 lg:-mx-10 lg:-my-9" style={{ background: '#eef1fb', minHeight: 'calc(100vh - 72px)' }}>
      <div className="p-8 lg:p-12">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-5 max-w-[920px]">
          {CURRICULUM_TILES.map(({ label, href, icon: Icon, color, bg }) => (
            <Link key={label} href={href}>
              <div className="flex flex-col items-center justify-center gap-5 rounded-2xl bg-white border border-gray-100 py-10 px-6 cursor-pointer hover:shadow-lg hover:-translate-y-0.5 transition-all duration-200 text-center group">
                <div className="w-[76px] h-[76px] rounded-full flex items-center justify-center" style={{ background: bg }}>
                  <Icon size={32} style={{ color }} strokeWidth={1.8} />
                </div>
                <span className="text-sm text-gray-500 font-medium group-hover:text-gray-800 transition-colors">{label}</span>
              </div>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── CurriculumCoursesPage (Course list — TriByte style) ──────────────────────
type CourseListItem = { id:string; name:string; group:string; language:string; adaptiveUserName:string; };
const COURSES_LIST_SEED: CourseListItem[] = [
  { id:'cl1', name:'ME-GI Course',                                    group:'All Content',  language:'English', adaptiveUserName:'' },
  { id:'cl2', name:'Vertical Integration Course for Trainers – VICT', group:'All Content',  language:'English', adaptiveUserName:'' },
  { id:'cl3', name:'Basic Safety Training (BST)',                     group:'All Content',  language:'English', adaptiveUserName:'' },
  { id:'cl4', name:'STCW Advanced Fire Fighting',                     group:'All Content',  language:'English', adaptiveUserName:'' },
  { id:'cl5', name:"GMDSS General Operator's Certificate",            group:'All Content',  language:'English', adaptiveUserName:'' },
  { id:'cl6', name:'Bridge Resource Management (BRM)',                group:'All Content',  language:'English', adaptiveUserName:'' },
  { id:'cl7', name:'Engine Room Simulator Training',                  group:'Engineering',  language:'English', adaptiveUserName:'' },
  { id:'cl8', name:'STCW 2017 Maritime Safety',                       group:'All Content',  language:'English', adaptiveUserName:'' },
];
const THUMB_COLORS = ['#1a5c3a','#0d4f7c','#4a2b6b','#7c3a1a','#1a5c5c','#2b4a1a','#4a1a2b','#1a3a5c'];

function CourseImportModal({ onClose, onImport }: { onClose:()=>void; onImport:(rows:CourseListItem[])=>void }) {
  const [step, setStep]   = useState<1|2|3>(1);
  const [parsed, setParsed] = useState<CourseListItem[]>([]);
  const [error, setError] = useState('');

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      try {
        const text = ev.target?.result as string;
        const lines = text.trim().split('\n').filter(l => l.trim());
        const start = lines[0].toLowerCase().includes('course_name') ? 1 : 0;
        const rows: CourseListItem[] = lines.slice(start).map((line, i) => {
          const c = line.split(',').map(x => x.trim().replace(/^"|"$/g,''));
          return { id:`csv-${Date.now()}-${i}`, name:c[0]||'', adaptiveUserName:c[1]||'', group:c[2]||'All Content', language:c[3]||'English' };
        }).filter(r => r.name);
        if (!rows.length) { setError('No valid rows found. Please use the CSV template.'); return; }
        setParsed(rows); setError(''); setStep(2);
      } catch { setError('Could not parse file. Please use the CSV template.'); }
    };
    reader.readAsText(file);
  }

  function downloadTemplate() {
    const csv = 'course_name,adaptive_user_name,group,language\nME-GI Course,,All Content,English\nBasic Safety Training (BST),,All Content,English\n';
    const a = document.createElement('a');
    a.href = 'data:text/csv;charset=utf-8,' + encodeURIComponent(csv);
    a.download = 'courses_import_template.csv'; a.click();
  }

  function confirmImport() { onImport(parsed); setStep(3); setTimeout(onClose, 1500); }

  return (
    <Modal title="Import Courses" onClose={onClose}>
      {step === 1 && (
        <div className="space-y-5">
          <p className="text-sm text-gray-600">Upload a CSV file with your courses. Download the template for the expected column format.</p>
          <button type="button" onClick={downloadTemplate}
            className="flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-2 text-xs font-medium text-gray-600 hover:bg-gray-50 transition-colors">
            <Download size={13} /> Download CSV template
          </button>
          <div className="rounded-lg border-2 border-dashed border-gray-200 p-10 text-center">
            <FileUp size={30} className="mx-auto mb-3 text-gray-300" />
            <p className="mb-4 text-sm text-gray-500">Choose a CSV file to upload</p>
            <label className="cursor-pointer rounded-lg bg-primary px-5 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90 transition-colors">
              Browse file
              <input type="file" accept=".csv,.txt" className="hidden" onChange={handleFile} />
            </label>
          </div>
          {error && <p className="text-sm text-red-500">{error}</p>}
          <p className="text-xs text-gray-400">Columns: course_name, adaptive_user_name, group, language</p>
        </div>
      )}
      {step === 2 && (
        <div className="space-y-4">
          <p className="text-sm text-gray-600"><strong>{parsed.length}</strong> course{parsed.length !== 1 ? 's' : ''} found. Review before importing.</p>
          <div className="max-h-64 overflow-y-auto rounded-lg border border-gray-100">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-gray-50 border-b border-gray-100">
                <tr>
                  <th className="px-3 py-2 text-left text-xs font-bold text-primary">#</th>
                  <th className="px-3 py-2 text-left text-xs font-bold text-primary">Course Name</th>
                  <th className="px-3 py-2 text-left text-xs font-bold text-primary">Group</th>
                  <th className="px-3 py-2 text-left text-xs font-bold text-primary">Language</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {parsed.map((r,i) => (
                  <tr key={r.id} className="hover:bg-gray-50">
                    <td className="px-3 py-2 text-gray-400 text-xs">{i+1}</td>
                    <td className="px-3 py-2 text-gray-700">{r.name}</td>
                    <td className="px-3 py-2 text-gray-500">{r.group}</td>
                    <td className="px-3 py-2 text-gray-500">{r.language}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex justify-end gap-2">
            <button onClick={() => setStep(1)} className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50 transition-colors">← Back</button>
            <button onClick={confirmImport} className="rounded-lg bg-primary px-5 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90 transition-colors">
              Import {parsed.length} course{parsed.length !== 1 ? 's' : ''}
            </button>
          </div>
        </div>
      )}
      {step === 3 && (
        <div className="py-10 text-center space-y-3">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-emerald-100">
            <Check size={24} className="text-emerald-600" />
          </div>
          <p className="font-semibold text-gray-800">Import successful!</p>
          <p className="text-sm text-gray-500">{parsed.length} course{parsed.length !== 1 ? 's' : ''} added.</p>
        </div>
      )}
    </Modal>
  );
}

function CurriculumCoursesPage() {
  type ApiCourse = {
    id: string; name: string; groupName: string; language: string;
    adaptiveUserName: string; status: string; appliedTags: string[];
    tribyteNid: string; tribyteTid: string; thumbUrl: string;
  };
  type StructureImportItem = {
    id: string; courseId: string; courseName: string; status: string;
    importedTopics: number; importedSubtopics: number; error: string | null; attempts: number;
  };
  type StructureImportJob = {
    id: string; status: string; replaceExisting: boolean; totalCourses: number;
    completedCourses: number; importedCourses: number; skippedCourses: number; failedCourses: number;
    currentCourseId: string | null; currentCourseName: string | null; cancelRequested: boolean;
    items: StructureImportItem[];
  };
  type ResourceImportItem = {
    id: string; courseId: string; courseName: string; status: string;
    discoveredResources: number; importedResources: number; failedResources: number;
    unavailableResources: number; error: string | null; attempts: number;
  };
  type ResourceImportJob = {
    id: string; status: string; totalCourses: number; completedCourses: number;
    importedResources: number; failedResources: number; unavailableResources: number; currentCourseId: string | null;
    currentCourseName: string | null; cancelRequested: boolean; items: ResourceImportItem[];
  };
  const TB_BASE = "https://admin.learn.himtelearning.com";
  const { data: rawCourses, loading: coursesLoading, refetch: refetchCourses } = useApi<ApiCourse[]>('/curriculum/list');
  const courses = (rawCourses ?? []).map(c => ({ ...c, group: c.groupName, appliedTags: c.appliedTags ?? [] }));
  const { data: syncStatus, refetch: refetchSyncStatus } = useApi<{ lastSyncedAt: string | null }>('/curriculum/sync-status');
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);
  const { data: allTags } = useApi<{ id: string; name: string }[]>('/curriculum/tags');
  const [, navigate] = useLocation();
  const { toast } = useToast();

  // ── Filter state ──────────────────────────────────────────────────────────
  const [selected,   setSelected]   = useState<Set<string>>(new Set());
  const [search,     setSearch]     = useState('');
  const [adaptive,   setAdaptive]   = useState('');
  const [group,      setGroup]      = useState('');
  const [lang,       setLang]       = useState('English');

  // ── Admin auth state (session cookie established via POST /api/auth/login) ──
  const [isAdmin,       setIsAdmin]       = useState<boolean | null>(null); // null = unknown
  const [showLogin,     setShowLogin]     = useState(false);
  const [loginUser,     setLoginUser]     = useState('');
  const [loginPass,     setLoginPass]     = useState('');
  const [loginBusy,     setLoginBusy]     = useState(false);
  const [loginError,    setLoginError]    = useState('');
  const [pendingSync,   setPendingSync]   = useState(false); // run sync after login succeeds
  const [pendingBulkImport, setPendingBulkImport] = useState(false);
  const [pendingResourceImport, setPendingResourceImport] = useState(false);

  // ── Bulk Course Structure import state ────────────────────────────────────
  const [bulkJob, setBulkJob] = useState<StructureImportJob | null>(null);
  const [showBulkImport, setShowBulkImport] = useState(false);
  const [replaceExistingStructures, setReplaceExistingStructures] = useState(false);
  const [startingBulkImport, setStartingBulkImport] = useState(false);
  const [resourceJob, setResourceJob] = useState<ResourceImportJob | null>(null);
  const [startingResourceImport, setStartingResourceImport] = useState(false);

  // Check session status once on mount
  useEffect(() => {
    apiFetch<{ isAdmin: boolean }>('/auth/status')
      .then(r => setIsAdmin(r.isAdmin))
      .catch(() => setIsAdmin(false));
  }, []);
  useEffect(() => {
    if (syncStatus) setLastSyncedAt(syncStatus.lastSyncedAt);
  }, [syncStatus]);
  useEffect(() => {
    if (isAdmin) {
      void refreshBulkImport();
      void refreshResourceImport();
    }
  }, [isAdmin]);
  useEffect(() => {
    if (!bulkJob || !['queued', 'running'].includes(bulkJob.status)) return;
    const timer = window.setInterval(() => { void refreshBulkImport(); }, 2_000);
    return () => window.clearInterval(timer);
  }, [bulkJob?.id, bulkJob?.status]);
  useEffect(() => {
    if (!resourceJob || !['queued', 'running'].includes(resourceJob.status)) return;
    const timer = window.setInterval(() => { void refreshResourceImport(); }, 2_000);
    return () => window.clearInterval(timer);
  }, [resourceJob?.id, resourceJob?.status]);

  async function handleAdminLogin(e: FormEvent) {
    e.preventDefault();
    setLoginBusy(true); setLoginError('');
    try {
      await apiFetch('/auth/login', 'POST', { username: loginUser, password: loginPass });
      setIsAdmin(true); setShowLogin(false); setLoginUser(''); setLoginPass('');
      if (pendingSync) { setPendingSync(false); void runSync(); }
      if (pendingBulkImport) {
        setPendingBulkImport(false);
        setReplaceExistingStructures(false);
        setShowBulkImport(true);
      }
      if (pendingResourceImport) {
        setPendingResourceImport(false);
        void startResourceImport();
      }
    } catch (err) {
      setLoginError(String(err).replace(/^Error:\s*/, ''));
    } finally { setLoginBusy(false); }
  }

  // ── Sync state ────────────────────────────────────────────────────────────
  const [syncing, setSyncing] = useState(false);
  const [tbImportMenu, setTbImportMenu] = useState(false);

  async function runSync() {
    setSyncing(true);
    try {
      const result = await apiFetch<{ added: number; updated: number; total: number; usedStaticFallback: boolean; lastSyncedAt: string }>(
        '/curriculum/sync-tribyte', 'POST',
      );
      setLastSyncedAt(result.lastSyncedAt);
      const parts: string[] = [];
      if (result.added   > 0) parts.push(`${result.added} new course${result.added   !== 1 ? 's' : ''} added`);
      if (result.updated > 0) parts.push(`${result.updated} updated`);
      if (parts.length === 0) parts.push('Already up to date');
      toast({
        title:       'Sync complete',
        description: parts.join(' · ') + (result.usedStaticFallback ? ' (static data — configure TriByte credentials for live sync)' : ''),
      });
      refetchCourses();
      refetchSyncStatus();
    } catch (err) {
      const msg = String(err);
      // Session expired → prompt for re-login
      if (msg.includes('401') || msg.includes('Unauthorized')) {
        setIsAdmin(false); setShowLogin(true); setPendingSync(true);
      } else {
        toast({ title: 'Sync failed', description: msg, variant: 'destructive' });
      }
    } finally { setSyncing(false); }
  }

  function handleSyncTriByte() {
    if (!isAdmin) { setShowLogin(true); setPendingSync(true); return; }
    void runSync();
  }

  async function refreshBulkImport() {
    try {
      const result = await apiFetch<{ job: StructureImportJob | null }>('/curriculum/structure-imports/latest');
      setBulkJob(result.job);
    } catch {
      // A missing/expired admin session is handled when an admin action is used.
    }
  }

  function openBulkImport() {
    if (!isAdmin) {
      setPendingBulkImport(true);
      setShowLogin(true);
      return;
    }
    setReplaceExistingStructures(false);
    setShowBulkImport(true);
  }

  async function startBulkImport() {
    setStartingBulkImport(true);
    try {
      const result = await apiFetch<{ job: StructureImportJob }>('/curriculum/structure-imports', 'POST', {
        replaceExisting: replaceExistingStructures,
      });
      setBulkJob(result.job);
      setShowBulkImport(false);
      toast({
        title: 'Course Structure import started',
        description: `Processing ${result.job.totalCourses} TriByte courses in the background.`,
      });
    } catch (err) {
      const message = String(err);
      if (message.includes('401') || message.includes('Unauthorized')) {
        setIsAdmin(false); setPendingBulkImport(true); setShowLogin(true);
      } else {
        toast({ title: 'Could not start import', description: message, variant: 'destructive' });
      }
    } finally {
      setStartingBulkImport(false);
    }
  }

  async function cancelBulkImport() {
    if (!bulkJob) return;
    try {
      const result = await apiFetch<{ job: StructureImportJob }>(`/curriculum/structure-imports/${bulkJob.id}/cancel`, 'POST');
      setBulkJob(result.job);
      toast({ title: 'Stopping import', description: 'The current course will finish before the job stops.' });
    } catch (err) {
      toast({ title: 'Could not stop import', description: String(err), variant: 'destructive' });
    }
  }

  async function retryBulkFailures() {
    if (!bulkJob) return;
    try {
      const result = await apiFetch<{ job: StructureImportJob }>(`/curriculum/structure-imports/${bulkJob.id}/retry-failed`, 'POST');
      setBulkJob(result.job);
      toast({
        title: 'Import resumed',
        description: 'Failed and not-yet-started courses will be processed.',
      });
    } catch (err) {
      toast({ title: 'Could not retry failures', description: String(err), variant: 'destructive' });
    }
  }

  async function refreshResourceImport() {
    try {
      const result = await apiFetch<ResourceImportJob | null>('/curriculum/resource-imports/latest');
      setResourceJob(result);
    } catch {
      // Expired admin sessions are handled before any mutation is attempted.
    }
  }

  function openResourceImport() {
    if (!isAdmin) {
      setPendingResourceImport(true);
      setShowLogin(true);
      return;
    }
    void startResourceImport();
  }

  async function startResourceImport() {
    setStartingResourceImport(true);
    try {
      const result = await apiFetch<{ job: ResourceImportJob }>('/curriculum/resource-imports', 'POST');
      setResourceJob(result.job);
      toast({
        title: 'Learning resource import started',
        description: `Checking documents, recordings, and learning resources across ${result.job.totalCourses} courses.`,
      });
    } catch (err) {
      const message = String(err);
      if (message.includes('401') || message.includes('Unauthorized')) {
        setIsAdmin(false); setPendingResourceImport(true); setShowLogin(true);
      } else {
        toast({ title: 'Could not start resource import', description: message, variant: 'destructive' });
      }
    } finally { setStartingResourceImport(false); }
  }

  async function cancelResourceImport() {
    if (!resourceJob) return;
    try {
      const result = await apiFetch<{ job: ResourceImportJob }>(`/curriculum/resource-imports/${resourceJob.id}/cancel`, 'POST');
      setResourceJob(result.job);
      toast({ title: 'Stopping resource import', description: 'The current course will finish before the job stops.' });
    } catch (err) {
      toast({ title: 'Could not stop resource import', description: String(err), variant: 'destructive' });
    }
  }

  async function retryResourceImport() {
    if (!resourceJob) return;
    try {
      const result = await apiFetch<{ job: ResourceImportJob }>(`/curriculum/resource-imports/${resourceJob.id}/retry`, 'POST');
      setResourceJob(result.job);
      toast({ title: 'Resource import resumed', description: 'Failed and unfinished courses will be checked again.' });
    } catch (err) {
      toast({ title: 'Could not retry resource import', description: String(err), variant: 'destructive' });
    }
  }

  // ── Modal/menu state ──────────────────────────────────────────────────────
  const [showCreate,    setShowCreate]    = useState(false);
  const [showImport,    setShowImport]    = useState(false);
  const [newName,       setNewName]       = useState('');
  const [newGroup,      setNewGroup]      = useState('All Content');
  const [newLang,       setNewLang]       = useState('English');
  const [editCourse,    setEditCourse]    = useState<ApiCourse | null>(null);
  const [editForm,      setEditForm]      = useState({ name: '', groupName: 'All Content', language: 'English' });
  const [conceptCourse, setConceptCourse] = useState<ApiCourse | null>(null);
  const [pendingTags,   setPendingTags]   = useState<string[]>([]);
  const [progressMenu,  setProgressMenu]  = useState<string | null>(null);  // course id with open Progress menu
  const [dashMenu,      setDashMenu]      = useState<string | null>(null);  // course id with open DASH menu
  const [othersMenu,    setOthersMenu]    = useState<string | null>(null);  // course id with open Others menu
  const [iframeModal,   setIframeModal]   = useState<{ title: string; url: string } | null>(null);

  // ── Derived ───────────────────────────────────────────────────────────────
  const filtered = courses.filter(c => {
    if (search   && !c.name.toLowerCase().includes(search.toLowerCase()))   return false;
    if (adaptive && !c.adaptiveUserName.toLowerCase().includes(adaptive.toLowerCase())) return false;
    if (group    && !c.group.toLowerCase().includes(group.toLowerCase()))   return false;
    if (lang && lang !== 'All' && c.language !== lang) return false;
    return true;
  });
  const pendingBulkCourseCount = bulkJob?.items.filter(item => ["pending", "running"].includes(item.status)).length ?? 0;
  const retryableBulkCourseCount = pendingBulkCourseCount + (bulkJob?.failedCourses ?? 0);
  const pendingResourceCourseCount = resourceJob?.items.filter(item => ["pending", "running"].includes(item.status)).length ?? 0;
  const retryableResourceCourseCount = pendingResourceCourseCount + (
    resourceJob?.items.filter(item =>
      item.status === "failed" || item.status === "completed_with_unavailable"
    ).length ?? 0
  );

  // ── Handlers ─────────────────────────────────────────────────────────────
  function toggleSelect(id: string) {
    setSelected(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }
  async function handleDeleteSelected() {
    await Promise.all([...selected].map(id => apiFetch(`/curriculum/list/${id}`, 'DELETE')));
    setSelected(new Set()); refetchCourses();
  }
  async function handleCreate(e: FormEvent) {
    e.preventDefault(); if (!newName.trim()) return;
    await apiFetch('/curriculum/list', 'POST', { name: newName.trim(), groupName: newGroup, language: newLang });
    setNewName(''); setShowCreate(false); refetchCourses();
  }
  async function handleImport(parsed: CourseListItem[]) {
    await apiFetch('/curriculum/list/import', 'POST', parsed.map(r => ({ name: r.name, groupName: r.group, language: r.language })));
    refetchCourses();
  }
  function openEdit(c: ApiCourse) { setEditCourse(c); setEditForm({ name: c.name, groupName: c.groupName, language: c.language }); }
  async function handleEditSave(e: FormEvent) {
    e.preventDefault(); if (!editCourse) return;
    await apiFetch(`/curriculum/list/${editCourse.id}`, 'PATCH', editForm);
    setEditCourse(null); refetchCourses();
    toast({ title: 'Course updated', description: editForm.name });
  }
  function openConcepts(c: ApiCourse) { setConceptCourse(c); setPendingTags(c.appliedTags ?? []); }
  async function saveConceptTags() {
    if (!conceptCourse) return;
    await apiFetch(`/curriculum/list/${conceptCourse.id}`, 'PATCH', { appliedTags: pendingTags });
    setConceptCourse(null); refetchCourses();
    toast({ title: 'Concepts saved', description: `${pendingTags.length} tag(s) applied.` });
  }
  function togglePendingTag(id: string) {
    setPendingTags(t => t.includes(id) ? t.filter(x => x !== id) : [...t, id]);
  }
  function openTBFrame(title: string, tbPath: string) {
    setIframeModal({ title, url: `${TB_BASE}${tbPath}` });
    setProgressMenu(null); setDashMenu(null); setOthersMenu(null);
  }
  async function handleDeleteCourse(courseId: string) {
    if (!confirm('Delete this course? This cannot be undone.')) return;
    await apiFetch(`/curriculum/list/${courseId}`, 'DELETE');
    setOthersMenu(null); refetchCourses();
    toast({ title: 'Course deleted' });
  }

  const statusBadge = (s: string) => {
    const tone = s === 'Published' ? 'bg-emerald-100 text-emerald-700' : s === 'Archived' ? 'bg-gray-100 text-gray-500' : 'bg-amber-100 text-amber-700';
    return <span className={cx('ml-2 rounded px-1.5 py-0.5 text-[10px] font-bold uppercase', tone)}>{s}</span>;
  };

  const btn = "flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border border-gray-200 rounded-lg bg-white text-gray-600 hover:bg-gray-50 hover:text-gray-900 transition-colors whitespace-nowrap";
  const inp = "rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700 placeholder-gray-400 outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/40 w-full";

  return (
    <div className="-mx-5 -my-7 lg:-mx-10 lg:-my-9" style={{ background:'#eef1fb', minHeight:'calc(100vh - 72px)' }}
      onClick={() => { setDashMenu(null); setOthersMenu(null); setTbImportMenu(false); }}>
      <div className="p-8 lg:p-10 space-y-5">

        {/* Back link + toolbar */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Link href="/curriculum" className="inline-flex items-center gap-1.5 text-sm font-semibold text-gray-700 hover:text-gray-900 transition-colors">
            <ChevronLeft size={18} /> Curriculum
          </Link>
          <div className="flex flex-wrap items-center gap-2">
            {/* Primary actions */}
            <button onClick={() => setShowCreate(true)} className={btn}><Scissors size={13}/> Create</button>
            <button onClick={handleDeleteSelected} disabled={selected.size === 0}
              className={cx(btn, selected.size === 0 && 'opacity-40 cursor-not-allowed')}>
              <Trash2 size={13}/> Delete
            </button>
            <button onClick={() => setShowImport(true)} className={btn}><FileUp size={13}/> Import</button>
            <button
              data-testid="button-import-learning-resources"
              onClick={openResourceImport}
              disabled={startingResourceImport || resourceJob?.status === 'queued' || resourceJob?.status === 'running'}
              className={cx(
                btn,
                (startingResourceImport || resourceJob?.status === 'queued' || resourceJob?.status === 'running')
                  && 'cursor-not-allowed opacity-50',
              )}
            >
              <Download size={13}/>
              {startingResourceImport ? 'Starting…' : 'Import learning resources'}
            </button>
          </div>
        </div>

        {resourceJob && (
          <div data-testid="resource-import-status" className="rounded-xl border border-primary/15 bg-white p-4 shadow-xs">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-sm font-semibold text-gray-800">Learning resource import</p>
                  <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-primary">
                    {resourceJob.status.replaceAll('_', ' ')}
                  </span>
                </div>
                <p className="mt-1 text-xs text-gray-500">
                  {resourceJob.completedCourses} of {resourceJob.totalCourses} courses checked
                  {' · '}{resourceJob.importedResources} transferred
                  {' · '}{resourceJob.unavailableResources} unavailable
                  {' · '}{resourceJob.failedResources} failed
                </p>
                {resourceJob.currentCourseName && (
                  <p className="mt-1 text-xs font-medium text-gray-600">Checking {resourceJob.currentCourseName}</p>
                )}
              </div>
              <div className="flex items-center gap-2">
                {['queued', 'running'].includes(resourceJob.status) && (
                  <Button testId="button-cancel-resource-import" variant="quiet" onClick={cancelResourceImport}>
                    Stop after current course
                  </Button>
                )}
                {!['queued', 'running'].includes(resourceJob.status) && retryableResourceCourseCount > 0 && (
                  <Button testId="button-retry-resource-import" variant="quiet" onClick={retryResourceImport}>
                    <RefreshCw size={13}/> Retry unavailable or failed
                  </Button>
                )}
              </div>
            </div>
            {resourceJob.items.some(item => item.error) && (
              <div className="mt-3 space-y-1 border-t border-gray-100 pt-3">
                {resourceJob.items.filter(item => item.error).slice(0, 5).map(item => (
                  <p key={item.id} className="text-xs text-gray-500">
                    <span className="font-semibold text-gray-700">{item.courseName}:</span> {item.error}
                  </p>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Filter card */}
        <div className="rounded-xl bg-white border border-gray-100 shadow-xs p-5">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <p className="mb-1.5 text-xs font-semibold text-gray-700">Search</p>
              <div className="relative">
                <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400"/>
                <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search by Name" className={cx(inp,'pl-8')}/>
              </div>
            </div>
            <div>
              <p className="mb-1.5 text-xs font-semibold text-gray-700">Adaptive User Name</p>
              <input value={adaptive} onChange={e => setAdaptive(e.target.value)} placeholder="Type Here" className={inp}/>
            </div>
            <div>
              <p className="mb-1.5 text-xs font-semibold text-gray-700">Group</p>
              <input value={group} onChange={e => setGroup(e.target.value)} placeholder="Type Here" className={inp}/>
            </div>
            <div>
              <p className="mb-1.5 text-xs font-semibold text-gray-700">Language</p>
              <select value={lang} onChange={e => setLang(e.target.value)} className={inp}>
                {['All','English','Hindi','Marathi'].map(l=><option key={l}>{l}</option>)}
              </select>
            </div>
          </div>
        </div>

        {/* Course cards */}
        <div className="space-y-4">
          {coursesLoading && <div className="py-16 text-center text-sm text-gray-400">Loading…</div>}
          {!coursesLoading && filtered.length === 0 && (
            <div className="flex items-center justify-center rounded-xl bg-white border border-gray-100 shadow-xs py-20">
              <p className="text-sm text-gray-400">No courses match your filters.</p>
            </div>
          )}
          {filtered.map((course, idx) => (
            <div key={course.id} className="relative flex items-center gap-5 rounded-xl bg-white border border-gray-100 shadow-xs p-4">
              <input type="checkbox" checked={selected.has(course.id)} onChange={() => toggleSelect(course.id)}
                className="absolute right-4 top-4 h-4 w-4 accent-primary cursor-pointer"/>

              {/* Thumbnail */}
              <div className="shrink-0 h-24 w-32 rounded-lg overflow-hidden bg-gray-100 flex items-center justify-center relative">
                {course.thumbUrl
                  ? <img src={course.thumbUrl} alt={course.name} className="h-full w-full object-cover" onError={e => { (e.target as HTMLImageElement).style.display='none'; }}/>
                  : <><div className="absolute inset-0" style={{ background: THUMB_COLORS[idx % THUMB_COLORS.length] }}/><GraduationCap size={34} className="text-white/80 relative z-10"/></>}
              </div>

              {/* Course name + meta */}
              <div className="flex-1 min-w-0 pr-8">
                <div className="flex items-center gap-1 flex-wrap">
                  <p className="text-base font-semibold text-gray-800 leading-snug">{course.name}</p>
                  {statusBadge(course.status || 'Published')}
                </div>
                <p className="mt-1 text-xs text-gray-400">{course.group} · {course.language}</p>
                {course.appliedTags.length > 0 && (
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    {course.appliedTags.map(tid => {
                      const tag = (allTags ?? []).find(t => t.id === tid);
                      return tag ? <span key={tid} className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary">{tag.name}</span> : null;
                    })}
                  </div>
                )}
              </div>

              {/* 3 × 2 action buttons */}
              <div className="shrink-0 grid grid-cols-3 gap-2" onClick={e => e.stopPropagation()}>
                <button onClick={() => openEdit(course)} className={btn}><Pencil size={12}/> Edit</button>
                {/* Generate Concepts */}
                <a href={`${TB_BASE}/generate/adaptiveconcept?cat_tid=${course.tribyteTid}`} target="_blank" rel="noopener noreferrer" className={btn}>
                  <Sparkles size={12}/> Generate Concepts
                </a>

                {/* Progress dropdown */}
                <div className="relative">
                  <button onClick={e => { e.stopPropagation(); setProgressMenu(progressMenu === course.id ? null : course.id); setDashMenu(null); setOthersMenu(null); }} className={btn}>
                    <TrendingUp size={12}/> Progress
                  </button>
                  {progressMenu === course.id && (
                    <div className="absolute left-0 top-full mt-1 z-50 w-44 rounded-xl bg-white shadow-lg border border-gray-100 py-1 text-sm">
                      {[
                        { label: 'Course Progress',   path: `/reviewer/load/frame?nid=${course.tribyteNid}&filter=cg&path=%2Fapps%2Fdashboard%2Fcoursesummary%3Ftid%3D${course.tribyteTid}&destination=reviewer%2Fcourse%2Flist&title=${encodeURIComponent(course.name)}` },
                        { label: 'Quiz Progress',     path: `/reviewer/load/frame?nid=${course.tribyteNid}&filter=cg&path=%2Fapps%2Fdashboard%2Fgroupassessments%3Fcourse_tid%3D${course.tribyteTid}&destination=reviewer%2Fcourse%2Flist&title=${encodeURIComponent(course.name)}` },
                        { label: 'Activity Progress', path: `/reviewer/load/frame?nid=${course.tribyteNid}&filter=cg&path=%2Fapps%2Fdashboard%2Fgroupassignments%3Fcourse_tid%3D${course.tribyteTid}&destination=reviewer%2Fcourse%2Flist&title=${encodeURIComponent(course.name)}` },
                        { label: 'Classroom Progress',path: `/reviewer/load/frame?nid=${course.tribyteNid}&path=%2Fapps%2Fclassroomattendance%2F%3Fcourse_tid%3D${course.tribyteTid}&destination=reviewer%2Fcourse%2Flist` },
                      ].map(item => (
                        <button key={item.label} onClick={() => openTBFrame(item.label, item.path)}
                          className="flex w-full items-center px-4 py-2 text-left text-gray-700 hover:bg-gray-50 transition-colors">
                          {item.label}
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {/* Course Structure */}
                <button onClick={() => navigate(`/curriculum/courses/${course.id}/structure`)} className={btn}>
                  <Layers size={12}/> Course Structure
                </button>

                {/* DASH Actions dropdown */}
                <div className="relative">
                  <button onClick={e => { e.stopPropagation(); setDashMenu(dashMenu === course.id ? null : course.id); setProgressMenu(null); setOthersMenu(null); }} className={btn}>
                    <Users size={12}/> DASH Actions
                  </button>
                  {dashMenu === course.id && (
                    <div className="absolute right-0 top-full mt-1 z-50 w-56 rounded-xl bg-white shadow-lg border border-gray-100 py-1 text-sm">
                      {['Generate SRT','Generate Index','Generate Video Breaks','AI Auto-Tag Questions','AI Quiz Generator'].map(label => (
                        <button key={label} disabled className="flex w-full items-center px-4 py-2 text-left text-gray-300 cursor-not-allowed text-xs" title="AI feature — coming soon">
                          {label}
                        </button>
                      ))}
                      <div className="my-1 border-t border-gray-100"/>
                      <button onClick={() => openTBFrame('Find Matching Documents', `/reviewer/load/frame?path=https%3A%2F%2Fdash.tribyte.com%2Fdashadmin%2Fmatchingdocuments%2F%3Fclient%3Delearning-himtmarine-com%26categoryid%3D${course.tribyteNid}&destination=reviewer%2Fcourse%2Flist&title=Find+Matching+Documents`)}
                        className="flex w-full items-center px-4 py-2 text-left text-gray-700 hover:bg-gray-50 transition-colors">
                        Find Matching Documents
                      </button>
                      <button onClick={() => openTBFrame('Show All Questions', `/reviewer/load/frame?path=https%3A%2F%2Fdash.tribyte.com%2Fdashadmin%2Fanswers%2F%3Fclient%3Delearning-himtmarine-com%26categoryid%3D${course.tribyteNid}&destination=reviewer%2Fcourse%2Flist&title=Show+All+Questions`)}
                        className="flex w-full items-center px-4 py-2 text-left text-gray-700 hover:bg-gray-50 transition-colors">
                        Show All Questions
                      </button>
                    </div>
                  )}
                </div>

                {/* Others dropdown */}
                <div className="relative">
                  <button onClick={e => { e.stopPropagation(); setOthersMenu(othersMenu === course.id ? null : course.id); setDashMenu(null); setProgressMenu(null); }} className={btn}>
                    <MoreHorizontal size={12}/> Others
                  </button>
                  {othersMenu === course.id && (
                    <div className="absolute right-0 top-full mt-1 z-50 w-44 rounded-xl bg-white shadow-lg border border-gray-100 py-1 text-sm">
                      <a href={`${TB_BASE}/reviewer/createresource?course_nid=${course.tribyteNid}&destination=reviewer%2Fcourse%2Flist`} target="_blank" rel="noopener noreferrer"
                        className="flex w-full items-center px-4 py-2 text-left text-gray-700 hover:bg-gray-50 transition-colors">
                        <Upload size={12} className="mr-2"/> Upload TOC
                      </a>
                      <button onClick={() => handleDeleteCourse(course.id)}
                        className="flex w-full items-center px-4 py-2 text-left text-red-600 hover:bg-red-50 transition-colors">
                        <Trash2 size={12} className="mr-2"/> Delete
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ── Create modal ── */}
      {showCreate && (
        <Modal title="Create Course" onClose={() => setShowCreate(false)}>
          <form onSubmit={handleCreate} className="space-y-4">
            <Field label="Course name">
              <input required autoFocus data-testid="input-course-list-name"
                value={newName} onChange={e => setNewName(e.target.value)}
                placeholder="e.g. STCW Advanced Fire Fighting" className="form-input"/>
            </Field>
            <div className="grid grid-cols-2 gap-4">
              <Field label="Group">
                <input value={newGroup} onChange={e => setNewGroup(e.target.value)} className="form-input" data-testid="input-course-group"/>
              </Field>
              <Field label="Language">
                <select value={newLang} onChange={e => setNewLang(e.target.value)} className="form-input" data-testid="select-course-lang">
                  {['English','Hindi','Marathi'].map(l=><option key={l}>{l}</option>)}
                </select>
              </Field>
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <Button testId="button-cancel-create-course" variant="quiet" onClick={() => setShowCreate(false)}>Cancel</Button>
              <Button testId="button-submit-create-course" type="submit">Create</Button>
            </div>
          </form>
        </Modal>
      )}

      {/* ── Import modal ── */}
      {showImport && <CourseImportModal onClose={() => setShowImport(false)} onImport={handleImport}/>}

      {/* ── Bulk Course Structure import modal ── */}
      {showBulkImport && (
        <Modal title="Import all Course Structures" onClose={() => setShowBulkImport(false)}>
          <div className="space-y-4">
            <div className="rounded-lg border border-primary/15 bg-primary/5 p-3.5 text-sm text-gray-600">
              <p className="font-semibold text-gray-800">Import all {courses.filter(course => course.tribyteTid).length} TriByte courses</p>
              <p className="mt-1 text-xs leading-relaxed">The import runs on the server and continues if you close or refresh this page. Its progress and any failures remain available here.</p>
            </div>
            <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 px-3.5 py-3">
              <input
                data-testid="checkbox-replace-existing-structures"
                type="checkbox"
                checked={replaceExistingStructures}
                onChange={event => setReplaceExistingStructures(event.target.checked)}
                className="mt-0.5 h-4 w-4 accent-primary"
              />
              <span className="text-sm text-amber-900">
                <strong>Replace existing structures</strong>
                <span className="mt-0.5 block text-xs leading-relaxed text-amber-800">
                  Leave this unchecked to import only courses that do not already have topics. Checking it removes existing topics and sub-topics first, including manual edits and faculty assignments.
                </span>
              </span>
            </label>
            <div className="flex justify-end gap-2 pt-1">
              <Button testId="button-cancel-bulk-structure-import" variant="quiet" onClick={() => setShowBulkImport(false)}>Cancel</Button>
              <Button testId="button-start-bulk-structure-import" onClick={startBulkImport} disabled={startingBulkImport}>
                {startingBulkImport ? 'Starting…' : 'Start import'}
              </Button>
            </div>
          </div>
        </Modal>
      )}

      {/* ── Edit modal ── */}
      {editCourse && (
        <Modal title="Edit Course" onClose={() => setEditCourse(null)}>
          <form onSubmit={handleEditSave} className="space-y-4">
            <Field label="Course name">
              <input required autoFocus value={editForm.name}
                onChange={e => setEditForm(f => ({ ...f, name: e.target.value }))}
                placeholder="e.g. STCW Advanced Fire Fighting" className="form-input"/>
            </Field>
            <div className="grid grid-cols-2 gap-4">
              <Field label="Group">
                <input value={editForm.groupName} onChange={e => setEditForm(f => ({ ...f, groupName: e.target.value }))} className="form-input"/>
              </Field>
              <Field label="Language">
                <select value={editForm.language} onChange={e => setEditForm(f => ({ ...f, language: e.target.value }))} className="form-input">
                  {['English','Hindi','Marathi'].map(l => <option key={l}>{l}</option>)}
                </select>
              </Field>
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <Button testId="button-cancel-edit-course" variant="quiet" onClick={() => setEditCourse(null)}>Cancel</Button>
              <Button testId="button-submit-edit-course" type="submit">Save changes</Button>
            </div>
          </form>
        </Modal>
      )}

      {/* ── Generate Concepts modal ── */}
      {conceptCourse && (
        <Modal title={`Concepts — ${conceptCourse.name}`} onClose={() => setConceptCourse(null)}>
          <p className="mb-4 text-sm text-gray-500">Select the tags that represent the learning concepts covered in this course.</p>
          {(allTags ?? []).length === 0 && <p className="text-sm text-gray-400">No tags found. Create tags under Curriculum → Tags first.</p>}
          <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
            {(allTags ?? []).map(tag => (
              <label key={tag.id} className="flex items-center gap-3 rounded-lg border border-gray-100 px-3 py-2.5 cursor-pointer hover:bg-gray-50 transition-colors">
                <input type="checkbox" className="h-4 w-4 accent-primary rounded"
                  checked={pendingTags.includes(tag.id)}
                  onChange={() => togglePendingTag(tag.id)}/>
                <span className="text-sm text-gray-700">{tag.name}</span>
                {pendingTags.includes(tag.id) && <Check size={14} className="ml-auto text-primary"/>}
              </label>
            ))}
          </div>
          <div className="mt-5 flex items-center justify-between">
            <span className="text-xs text-gray-400">{pendingTags.length} concept{pendingTags.length !== 1 ? 's' : ''} selected</span>
            <div className="flex gap-2">
              <Button testId="button-cancel-concepts" variant="quiet" onClick={() => setConceptCourse(null)}>Cancel</Button>
              <Button testId="button-save-concepts" onClick={saveConceptTags}>Save concepts</Button>
            </div>
          </div>
        </Modal>
      )}

      {/* ── Admin login modal (for Sync from TriByte) ── */}
      {showLogin && (
        <Modal title="Admin login" onClose={() => { setShowLogin(false); setPendingSync(false); setPendingBulkImport(false); setLoginError(''); }}>
          <p className="mb-4 text-sm text-gray-500">Enter your LMS admin credentials to continue.</p>
          <form onSubmit={handleAdminLogin} className="space-y-4">
            <Field label="Username">
              <input required autoFocus data-testid="input-admin-username"
                value={loginUser} onChange={e => setLoginUser(e.target.value)}
                placeholder="admin" className="form-input" autoComplete="username"/>
            </Field>
            <Field label="Password">
              <input required type="password" data-testid="input-admin-password"
                value={loginPass} onChange={e => setLoginPass(e.target.value)}
                className="form-input" autoComplete="current-password"/>
            </Field>
            {loginError && <p className="text-sm text-red-600">{loginError}</p>}
            <div className="flex justify-end gap-2 pt-1">
              <Button testId="button-cancel-admin-login" variant="quiet"
                onClick={() => { setShowLogin(false); setPendingSync(false); setPendingBulkImport(false); setLoginError(''); }}>
                Cancel
              </Button>
              <Button testId="button-submit-admin-login" type="submit" disabled={loginBusy}>
                {loginBusy ? 'Signing in…' : 'Sign in'}
              </Button>
            </div>
          </form>
        </Modal>
      )}

      {/* ── TriByte iframe modal ── */}
      {iframeModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="relative flex flex-col bg-white rounded-2xl shadow-2xl w-full max-w-5xl" style={{ height: '85vh' }}>
            <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100">
              <p className="font-semibold text-gray-800">{iframeModal.title}</p>
              <button onClick={() => setIframeModal(null)} className="rounded-lg p-1.5 hover:bg-gray-100 text-gray-500 transition-colors"><X size={18}/></button>
            </div>
            <iframe src={iframeModal.url} className="flex-1 w-full rounded-b-2xl border-0" title={iframeModal.title}/>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── SubTopicsPanel — expandable 3-level view used in TopicWorkspacePage ──────

const RESOURCE_TYPE_ICON: Record<string, string> = {
  Video: '▶',
  Document: '📄',
  Audio: '🎵',
  Quiz: '❓',
};

function SubTopicsPanel({
  subtopics,
  onAdd,
}: {
  subtopics: CourseTopicSubtopic[];
  onAdd: () => void;
}) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const toggle = (id: string) =>
    setExpanded(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  return (
    <div className="rounded-xl border border-gray-100 bg-white p-5 shadow-xs">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-gray-800">Sub-topics</p>
          <p className="mt-1 text-xs text-gray-500">
            Click a sub-topic to see its learning resources (Level 3).
          </p>
        </div>
        <button
          type="button"
          onClick={onAdd}
          className="inline-flex items-center gap-1 rounded-md border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 shadow-xs hover:bg-gray-50"
        >
          <Plus size={13} /> Add New
        </button>
      </div>

      {subtopics.length === 0 ? (
        <div className="rounded-lg border border-dashed border-gray-200 px-4 py-10 text-center text-sm text-gray-400">
          No sub-topics have been added yet.
        </div>
      ) : (
        <div className="space-y-1.5">
          {subtopics.map((subtopic, idx) => {
            const isOpen = expanded.has(subtopic.id);
            const count = subtopic.activities?.length ?? 0;
            return (
              <div key={subtopic.id} className="overflow-hidden rounded-lg border border-gray-100">
                {/* Sub-topic header row */}
                <button
                  type="button"
                  onClick={() => toggle(subtopic.id)}
                  className="flex w-full items-center gap-3 bg-gray-50 px-3 py-2.5 text-left hover:bg-gray-100"
                >
                  <span className="w-6 shrink-0 text-center text-xs font-semibold text-gray-400">
                    {idx + 1}
                  </span>
                  <span className="flex-1 text-sm font-medium text-gray-700">{subtopic.name}</span>
                  <span className="shrink-0 text-[10px] font-semibold text-gray-400">
                    {count} {count === 1 ? 'resource' : 'resources'}
                  </span>
                  <ChevronDown
                    size={13}
                    className={cx('shrink-0 text-gray-400 transition-transform', isOpen && 'rotate-180')}
                  />
                </button>

                {/* Activities (level 3) */}
                {isOpen && (
                  <div className="border-t border-gray-100 bg-white">
                    {count === 0 ? (
                      <p className="px-3 py-3 text-xs text-gray-400 italic">
                        No resources imported for this sub-topic.
                      </p>
                    ) : (
                      subtopic.activities.map((act, aIdx) => {
                        const icon = RESOURCE_TYPE_ICON[act.type] ?? '📎';
                        const statusColor =
                          act.status === 'ready'
                            ? 'text-emerald-600'
                            : act.status === 'unavailable'
                              ? 'text-red-400'
                              : 'text-amber-500';
                        return (
                          <div
                            key={act.id}
                            className="flex items-center gap-3 border-b border-gray-50 px-3 py-2 last:border-0"
                          >
                            <span className="w-5 shrink-0 text-center text-[10px] text-gray-300">
                              {aIdx + 1}
                            </span>
                            <span className="w-4 shrink-0 text-center text-xs">{icon}</span>
                            <span className="flex-1 text-xs text-gray-700">{act.title}</span>
                            <span className={cx('shrink-0 text-[10px] font-semibold capitalize', statusColor)}>
                              {act.status}
                            </span>
                          </div>
                        );
                      })
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── CourseStructurePage — internal topics view for a curriculum course ──────

type CourseTopicActivity = { id: string; title: string; type: string; status: string; order: number; openUrl?: string | null; sourceUrl?: string | null; mimeType?: string | null; hasStoredFile?: boolean };
type CourseTopicSubtopic = { id: string; topicId: string; courseId: string; nid: string; name: string; order: number; activities: CourseTopicActivity[] };
type CourseTopic = {
  id: string; courseId: string; nid: string; tid: string;
  name: string; order: number; thumbUrl: string; faculty: string;
  subtopics: CourseTopicSubtopic[];
};

type TopicWorkspaceTab = 'Attributes' | 'Book' | 'Copy Attributes' | 'Sub Topics' | 'Tests' | 'Tasks' | 'Faculty' | 'Glossary';

const TOPIC_WORKSPACE_TABS: TopicWorkspaceTab[] = [
  'Attributes', 'Book', 'Copy Attributes', 'Sub Topics', 'Tests', 'Tasks', 'Faculty', 'Glossary',
];

function displayTopicName(name: string, position: number) {
  const trimmedName = name.trim();
  return /^\d{1,3}[.)]\s+/.test(trimmedName)
    ? trimmedName
    : `${String(position).padStart(2, '0')}. ${trimmedName}`;
}

function TopicWorkspacePage() {
  const { courseId = '', topicId = '' } = useParams<{ courseId: string; topicId: string }>();
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const [topic, setTopic] = useState<CourseTopic | null>(null);
  const [courseName, setCourseName] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [activeTab, setActiveTab] = useState<TopicWorkspaceTab>('Sub Topics');
  const [selected, setSelected] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [addName, setAddName] = useState('');
  const [editOpen, setEditOpen] = useState(false);
  const [editName, setEditName] = useState('');
  const [editThumb, setEditThumb] = useState('');
  type TopicSubtopicRow = CourseTopic['subtopics'][number];
  const [editSub, setEditSub] = useState<TopicSubtopicRow | null>(null);
  const [editSubName, setEditSubName] = useState('');
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);
  const [showLogin, setShowLogin] = useState(false);
  const [loginUser, setLoginUser] = useState('');
  const [loginPass, setLoginPass] = useState('');
  const [loginBusy, setLoginBusy] = useState(false);
  const [loginError, setLoginError] = useState('');
  const [pendingAction, setPendingAction] = useState<(() => void) | null>(null);

  useEffect(() => {
    apiFetch<{ isAdmin: boolean }>('/auth/status')
      .then(result => setIsAdmin(result.isAdmin))
      .catch(() => setIsAdmin(false));
  }, []);

  async function loadTopic() {
    setLoading(true);
    setError('');
    try {
      const [courseTopics, courses] = await Promise.all([
        apiFetch<CourseTopic[]>(`/curriculum/courses/${courseId}/topics`),
        apiFetch<Array<{ id: string; name: string }>>('/curriculum/list'),
      ]);
      setTopic(courseTopics.find(item => item.id === topicId) ?? null);
      setCourseName(courses.find(course => course.id === courseId)?.name ?? '');
      if (!courseTopics.some(item => item.id === topicId)) setError('Topic not found');
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (courseId && topicId) loadTopic();
  }, [courseId, topicId]);

  function requireAdminThen(action: () => void) {
    if (isAdmin) {
      action();
      return;
    }
    setPendingAction(() => action);
    setShowLogin(true);
  }

  async function handleAdminLogin(event: FormEvent) {
    event.preventDefault();
    setLoginBusy(true);
    setLoginError('');
    try {
      await apiFetch('/auth/login', 'POST', { username: loginUser, password: loginPass });
      setIsAdmin(true);
      setShowLogin(false);
      setLoginUser('');
      setLoginPass('');
      if (pendingAction) {
        const action = pendingAction;
        setPendingAction(null);
        action();
      }
    } catch (err) {
      setLoginError(String(err).replace(/^Error:\s*/, ''));
    } finally {
      setLoginBusy(false);
    }
  }

  function handleAdminError(err: unknown) {
    const message = String(err);
    if (message.includes('401') || message.includes('Unauthorized')) {
      setIsAdmin(false);
      setShowLogin(true);
    } else {
      toast({ title: 'Error', description: message, variant: 'destructive' });
    }
  }

  async function handleAddSubtopic(event: FormEvent) {
    event.preventDefault();
    if (!topic || !addName.trim()) return;
    try {
      await apiFetch(`/curriculum/topics/${topic.id}/subtopics`, 'POST', { name: addName.trim() });
      setAddOpen(false);
      setAddName('');
      await loadTopic();
      toast({ title: 'Sub-topic added' });
    } catch (err) {
      handleAdminError(err);
    }
  }

  async function handleEditTopic(event: FormEvent) {
    event.preventDefault();
    if (!topic || !editName.trim()) return;
    try {
      await apiFetch(`/curriculum/topics/${topic.id}`, 'PATCH', { name: editName.trim(), thumbUrl: editThumb.trim() });
      setEditOpen(false);
      await loadTopic();
      toast({ title: 'Topic updated' });
    } catch (err) {
      handleAdminError(err);
    }
  }

  function openEdit() {
    if (!topic) return;
    requireAdminThen(() => {
      setEditName(topic.name);
      setEditThumb(topic.thumbUrl);
      setEditOpen(true);
    });
  }

  function deleteTopic() {
    if (!topic || !selected) return;
    requireAdminThen(async () => {
      if (!confirm(`Delete topic "${topic.name}"? This cannot be undone.`)) return;
      try {
        await apiFetch(`/curriculum/topics/${topic.id}`, 'DELETE');
        toast({ title: 'Topic deleted' });
        navigate(`/curriculum/courses/${courseId}/structure`);
      } catch (err) {
        handleAdminError(err);
      }
    });
  }

  async function handleEditSubtopic(e: FormEvent) {
    e.preventDefault();
    if (!editSub || !editSubName.trim()) return;
    try {
      await apiFetch(`/curriculum/subtopics/${editSub.id}`, 'PATCH', { name: editSubName.trim() });
      setEditSub(null);
      await loadTopic();
      toast({ title: 'Sub-topic renamed' });
    } catch (err) { handleAdminError(err); }
  }

  async function handleDeleteSubtopic(subId: string, subName: string) {
    if (!confirm(`Delete sub-topic "${subName}"? This cannot be undone.`)) return;
    try {
      await apiFetch(`/curriculum/subtopics/${subId}`, 'DELETE');
      await loadTopic();
      toast({ title: 'Sub-topic deleted' });
    } catch (err) { handleAdminError(err); }
  }

  const toolbarButton = (
    label: string,
    icon: ReactNode,
    onClick?: () => void,
    disabled = false,
  ) => (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cx(
        'inline-flex items-center gap-1.5 rounded-md border border-gray-200 bg-white px-3 py-2 text-xs font-medium text-gray-600 shadow-xs transition-colors',
        disabled ? 'cursor-not-allowed text-gray-300' : 'hover:border-gray-300 hover:bg-gray-50 hover:text-gray-900',
      )}
    >
      {icon}{label}
    </button>
  );

  const renderTabContent = () => {
    if (!topic) return null;
    if (activeTab === 'Attributes') {
      return (
        <div className="relative rounded-xl border border-gray-100 bg-white p-4 shadow-xs sm:p-5">
          <label className="absolute right-4 top-4 flex h-4 w-4 cursor-pointer items-center justify-center">
            <input
              type="checkbox"
              checked={selected}
              onChange={event => setSelected(event.target.checked)}
              className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary/30"
              aria-label={`Select ${topic.name}`}
            />
          </label>
          <div className="flex flex-col gap-5 pr-2 sm:flex-row sm:items-center">
            <div className="flex h-28 w-full shrink-0 items-center justify-center overflow-hidden rounded-lg bg-[#f8f4ef] sm:h-28 sm:w-36">
              {topic.thumbUrl ? (
                <img src={topic.thumbUrl} alt="" className="h-full w-full object-cover" />
              ) : (
                <div className="flex flex-col items-center gap-2 text-primary/70">
                  <BookOpen size={42} strokeWidth={1.15} />
                  <span className="text-[9px] font-semibold uppercase tracking-wider">Topic</span>
                </div>
              )}
            </div>
            <div className="min-w-0 flex-1">
              <p className="max-w-md text-lg font-medium leading-snug text-gray-700">
                {displayTopicName(topic.name, (topic.order ?? 0) + 1)}
              </p>
              {topic.faculty && <p className="mt-2 text-xs text-gray-500">Faculty: {topic.faculty}</p>}
            </div>
            <div className="flex shrink-0 flex-wrap gap-2 sm:pr-7">
              {toolbarButton('Edit', <Pencil size={13} />, openEdit)}
              {toolbarButton('Upload TOC', <Upload size={13} />, () => toast({ title: 'TOC upload', description: 'The selected topic is ready for a TOC upload.' }))}
            </div>
          </div>
        </div>
      );
    }

    if (activeTab === 'Sub Topics') {
      const subtopics = topic.subtopics;
      if (subtopics.length === 0) {
        return (
          <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-gray-200 bg-white px-6 py-16 text-center">
            <Layers size={30} className="mx-auto mb-3 text-gray-300" strokeWidth={1.4}/>
            <p className="text-sm font-semibold text-gray-600">No sub-topics yet</p>
            <p className="mt-1 text-xs text-gray-400">Add a sub-topic to get started.</p>
            {isAdmin && (
              <button
                type="button"
                onClick={() => setAddOpen(true)}
                className="mt-4 inline-flex items-center gap-1.5 rounded-lg border border-primary/20 bg-primary/5 px-3 py-1.5 text-xs font-medium text-primary hover:bg-primary/10 transition-colors"
              >
                <Plus size={12}/> Add Sub-topic
              </button>
            )}
          </div>
        );
      }
      return (
        <div className="rounded-xl border border-gray-100 bg-white shadow-xs overflow-hidden">
          <ul className="divide-y divide-gray-100">
            {subtopics.map((s, si) => {
              const actCount = s.activities?.length ?? 0;
              return (
                <li key={s.id} className="flex items-center group hover:bg-gray-50 transition-colors">
                  <Link
                    href={`/curriculum/courses/${courseId}/topics/${topicId}/subtopics/${s.id}`}
                    className="flex flex-1 items-center gap-4 px-4 py-3"
                  >
                    <span className="w-7 shrink-0 text-center text-xs font-semibold text-gray-400">{si + 1}</span>
                    <span className="flex-1 text-sm font-medium text-gray-800 group-hover:text-primary transition-colors">{s.name}</span>
                    <span className="text-xs text-gray-400 shrink-0">
                      {actCount} {actCount === 1 ? 'resource' : 'resources'}
                    </span>
                    <ChevronRight size={15} className="shrink-0 text-gray-300 group-hover:text-primary transition-colors"/>
                  </Link>
                  {isAdmin && (
                    <div className="flex items-center gap-0.5 pr-4 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        type="button"
                        onClick={() => { setEditSub(s); setEditSubName(s.name); }}
                        className="p-1.5 rounded text-gray-400 hover:text-primary hover:bg-primary/10 transition-colors"
                        title="Rename"
                      ><Pencil size={13}/></button>
                      <button
                        type="button"
                        onClick={() => requireAdminThen(() => handleDeleteSubtopic(s.id, s.name))}
                        className="p-1.5 rounded text-gray-400 hover:text-red-500 hover:bg-red-50 transition-colors"
                        title="Delete"
                      ><Trash2 size={13}/></button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
          {isAdmin && (
            <div className="border-t border-gray-100 px-5 py-3">
              <button
                type="button"
                onClick={() => requireAdminThen(() => setAddOpen(true))}
                className="inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:underline"
              >
                <Plus size={12}/> Add Sub-topic
              </button>
            </div>
          )}
        </div>
      );
    }

    const tabDescriptions: Record<Exclude<TopicWorkspaceTab, 'Attributes' | 'Sub Topics'>, string> = {
      Book: 'Book settings and topic reading material will appear here.',
      'Copy Attributes': 'Copy attributes from another topic when this workflow is enabled.',
      Tests: 'Topic tests and assessments will appear here.',
      Tasks: 'Topic tasks and learner activities will appear here.',
      Faculty: 'Faculty assignment details will appear here.',
      Glossary: 'Topic glossary terms will appear here.',
    };
    return (
      <div className="rounded-xl border border-dashed border-gray-200 bg-white px-6 py-16 text-center shadow-xs">
        <Layers size={30} className="mx-auto mb-3 text-gray-300" strokeWidth={1.4} />
        <p className="text-sm font-semibold text-gray-600">{activeTab}</p>
        <p className="mx-auto mt-1 max-w-md text-xs leading-relaxed text-gray-400">{tabDescriptions[activeTab]}</p>
      </div>
    );
  };

  return (
    <div className="-mx-5 -my-7 min-h-[calc(100vh-72px)] bg-[#eef1fb] lg:-mx-10 lg:-my-9">
      <div className="space-y-4 p-5 sm:p-8 lg:p-10">
        <div className="flex items-center justify-between gap-4">
          <button
            type="button"
            onClick={() => navigate(`/curriculum/courses/${courseId}/structure`)}
            className="inline-flex min-w-0 items-center gap-1.5 text-sm font-semibold text-gray-700 transition-colors hover:text-gray-900"
          >
            <ChevronLeft size={18} className="shrink-0" />
            <span className="truncate">{topic ? displayTopicName(topic.name, (topic.order ?? 0) + 1) : 'Topic'}</span>
          </button>
          <div className="flex shrink-0 flex-wrap justify-end gap-2">
            {toolbarButton('Create', <Sparkles size={13} />, () => requireAdminThen(() => setAddOpen(true)))}
            {toolbarButton('Add New', <Plus size={13} />, () => requireAdminThen(() => setAddOpen(true)))}
            {toolbarButton('Delete', <Trash2 size={13} />, deleteTopic, !selected)}
            {toolbarButton('Remove', <MinusCircle size={13} />, () => setSelected(false), !selected)}
            {toolbarButton('Reorder', <GripVertical size={13} />, () => {
              setActiveTab('Sub Topics');
              toast({ title: 'Reorder mode', description: 'Sub-topics are shown for ordering.' });
            })}
          </div>
        </div>

        {loading && <div className="rounded-xl bg-white py-20 text-center text-sm text-gray-400">Loading topic…</div>}
        {!loading && error && (
          <div className="rounded-xl border border-red-100 bg-red-50 p-5 text-sm text-red-600">
            {error}
            <button type="button" onClick={loadTopic} className="ml-3 underline">Retry</button>
          </div>
        )}
        {!loading && !error && topic && (
          <>
            <div className="overflow-x-auto rounded-xl border border-gray-100 bg-white shadow-xs">
              <div className="flex min-w-max items-center px-2 sm:px-4">
                {TOPIC_WORKSPACE_TABS.map(tab => (
                  <button
                    key={tab}
                    type="button"
                    onClick={() => setActiveTab(tab)}
                    className={cx(
                      'relative px-3 py-4 text-xs font-medium transition-colors sm:px-4',
                      activeTab === tab ? 'text-gray-800' : 'text-gray-500 hover:text-gray-800',
                    )}
                  >
                    {tab}
                    {activeTab === tab && <span className="absolute inset-x-2 bottom-0 h-0.5 rounded-full bg-[#7c63e8]" />}
                  </button>
                ))}
                <button type="button" className="inline-flex items-center gap-1 px-3 py-4 text-xs font-medium text-gray-500 hover:text-gray-800">
                  More <ChevronRight size={13} />
                </button>
              </div>
            </div>

            <div className="rounded-xl border border-gray-100 bg-white/60 p-3 shadow-xs sm:p-4">
              <p className="mb-3 px-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-gray-400">
                {courseName || 'Course'} · {activeTab}
              </p>
              {renderTabContent()}
            </div>
          </>
        )}
      </div>

      {addOpen && topic && (
        <Modal title={`Add New Sub-topic — ${topic.name}`} onClose={() => setAddOpen(false)}>
          <form onSubmit={handleAddSubtopic} className="space-y-4">
            <Field label="Sub-topic name">
              <input
                required
                autoFocus
                value={addName}
                onChange={event => setAddName(event.target.value)}
                placeholder="e.g. Safety Management Systems"
                className="form-input"
              />
            </Field>
            <div className="flex justify-end gap-2 pt-2">
              <Button testId="button-cancel-topic-subtopic" variant="quiet" onClick={() => setAddOpen(false)}>Cancel</Button>
              <Button testId="button-save-topic-subtopic" type="submit">Add Sub-topic</Button>
            </div>
          </form>
        </Modal>
      )}

      {editSub && (
        <Modal title="Rename Sub-topic" onClose={() => setEditSub(null)}>
          <form onSubmit={handleEditSubtopic} className="space-y-4">
            <Field label="Sub-topic name">
              <input required autoFocus value={editSubName} onChange={event => setEditSubName(event.target.value)} className="form-input"/>
            </Field>
            <div className="flex justify-end gap-2 pt-2">
              <Button testId="button-cancel-subtopic-rename" variant="quiet" onClick={() => setEditSub(null)}>Cancel</Button>
              <Button testId="button-save-subtopic-rename" type="submit">Save</Button>
            </div>
          </form>
        </Modal>
      )}

      {editOpen && topic && (
        <Modal title="Edit Topic" onClose={() => setEditOpen(false)}>
          <form onSubmit={handleEditTopic} className="space-y-4">
            <Field label="Topic name">
              <input required autoFocus value={editName} onChange={event => setEditName(event.target.value)} className="form-input" />
            </Field>
            <Field label="Thumbnail URL">
              <input value={editThumb} onChange={event => setEditThumb(event.target.value)} placeholder="https://..." className="form-input" />
            </Field>
            <div className="flex justify-end gap-2 pt-2">
              <Button testId="button-cancel-topic-edit" variant="quiet" onClick={() => setEditOpen(false)}>Cancel</Button>
              <Button testId="button-save-topic-edit" type="submit">Save</Button>
            </div>
          </form>
        </Modal>
      )}

      {showLogin && (
        <Modal title="Admin login" onClose={() => { setShowLogin(false); setPendingAction(null); setLoginError(''); }}>
          <p className="mb-4 text-sm text-gray-500">Enter your LMS admin credentials to manage this topic.</p>
          <form onSubmit={handleAdminLogin} className="space-y-4">
            <Field label="Username">
              <input required autoFocus value={loginUser} onChange={event => setLoginUser(event.target.value)} placeholder="admin" className="form-input" autoComplete="username" />
            </Field>
            <Field label="Password">
              <input required type="password" value={loginPass} onChange={event => setLoginPass(event.target.value)} className="form-input" autoComplete="current-password" />
            </Field>
            {loginError && <p className="text-sm text-red-600">{loginError}</p>}
            <div className="flex justify-end gap-2 pt-1">
              <Button testId="button-cancel-topic-login" variant="quiet" onClick={() => { setShowLogin(false); setPendingAction(null); setLoginError(''); }}>Cancel</Button>
              <Button testId="button-submit-topic-login" type="submit" disabled={loginBusy}>{loginBusy ? 'Signing in…' : 'Sign in'}</Button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}

function CourseStructurePage() {
  const { id = '' } = useParams<{ id: string }>();
  const [, navigate] = useLocation();
  const { toast } = useToast();

  // Course info
  const [course, setCourse] = useState<{ id: string; name: string; tribyteTid: string } | null>(null);
  // Topics
  const [topics, setTopics] = useState<CourseTopic[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // UI state — topics
  const [addOpen, setAddOpen] = useState(false);
  const [addName, setAddName] = useState('');
  const [addThumb, setAddThumb] = useState('');
  const [editTopic, setEditTopic] = useState<CourseTopic | null>(null);
  const [editName, setEditName] = useState('');
  const [editThumb, setEditThumb] = useState('');
  const [facultyTopic, setFacultyTopic] = useState<CourseTopic | null>(null);
  const [facultyVal, setFacultyVal] = useState('');
  const [importing, setImporting] = useState(false);

  // Drag-and-drop state for topic reordering
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Admin auth state (session cookie via POST /api/auth/login)
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);
  const [showLogin, setShowLogin] = useState(false);
  const [loginUser, setLoginUser] = useState('');
  const [loginPass, setLoginPass] = useState('');
  const [loginBusy, setLoginBusy] = useState(false);
  const [loginError, setLoginError] = useState('');
  // Deferred action to run after successful login
  const [pendingAction, setPendingAction] = useState<(() => void) | null>(null);

  useEffect(() => {
    apiFetch<{ isAdmin: boolean }>('/auth/status')
      .then(r => setIsAdmin(r.isAdmin))
      .catch(() => setIsAdmin(false));
  }, []);

  async function handleAdminLogin(e: FormEvent) {
    e.preventDefault();
    setLoginBusy(true); setLoginError('');
    try {
      await apiFetch('/auth/login', 'POST', { username: loginUser, password: loginPass });
      setIsAdmin(true); setShowLogin(false); setLoginUser(''); setLoginPass('');
      if (pendingAction) { const fn = pendingAction; setPendingAction(null); fn(); }
    } catch (err) {
      setLoginError(String(err).replace(/^Error:\s*/, ''));
    } finally { setLoginBusy(false); }
  }

  function requireAdminThen(action: () => void) {
    if (isAdmin) { action(); return; }
    setPendingAction(() => action);
    setShowLogin(true);
  }

  function handle401(err: unknown) {
    const msg = String(err);
    if (msg.includes('401') || msg.includes('Unauthorized')) {
      setIsAdmin(false); setShowLogin(true);
    } else {
      toast({ title: 'Error', description: msg, variant: 'destructive' });
    }
  }

  async function loadTopics() {
    setLoading(true); setError('');
    try {
      const [t, c] = await Promise.all([
        apiFetch<CourseTopic[]>(`/curriculum/courses/${id}/topics`),
        apiFetch<{ id: string; name: string; tribyteTid: string }[]>('/curriculum/list'),
      ]);
      setTopics(t);
      const found = c.find(x => x.id === id) ?? null;
      setCourse(found);
    } catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }

  useEffect(() => { if (id) loadTopics(); }, [id]);

  async function handleAddTopic(e: FormEvent) {
    e.preventDefault();
    if (!addName.trim()) return;
    try {
      await apiFetch(`/curriculum/courses/${id}/topics`, 'POST', { name: addName.trim(), thumbUrl: addThumb.trim() });
      setAddOpen(false); setAddName(''); setAddThumb('');
      loadTopics();
      toast({ title: 'Topic added' });
    } catch (err) { handle401(err); }
  }

  async function handleEditSave(e: FormEvent) {
    e.preventDefault();
    if (!editTopic) return;
    try {
      await apiFetch(`/curriculum/topics/${editTopic.id}`, 'PATCH', { name: editName, thumbUrl: editThumb });
      setEditTopic(null);
      loadTopics();
      toast({ title: 'Topic updated' });
    } catch (err) { handle401(err); }
  }

  async function handleDelete(topicId: string, name: string) {
    if (!confirm(`Delete topic "${name}"? This cannot be undone.`)) return;
    try {
      await apiFetch(`/curriculum/topics/${topicId}`, 'DELETE');
      loadTopics();
      toast({ title: 'Topic deleted' });
    } catch (err) { handle401(err); }
  }

  async function handleSetFaculty(e: FormEvent) {
    e.preventDefault();
    if (!facultyTopic) return;
    try {
      await apiFetch(`/curriculum/topics/${facultyTopic.id}`, 'PATCH', { faculty: facultyVal });
      setFacultyTopic(null);
      loadTopics();
      toast({ title: 'Faculty assigned' });
    } catch (err) { handle401(err); }
  }

  async function handleImport() {
    setImporting(true);
    try {
      const result = await apiFetch<{ imported: number; message?: string }>(`/curriculum/courses/${id}/topics/import`, 'POST');
      loadTopics();
      toast({ title: `Imported ${result.imported} topic${result.imported !== 1 ? 's' : ''}`, description: result.message ?? '' });
    } catch (err) { handle401(err); }
    finally { setImporting(false); }
  }

  function handleDragStart(id: string) {
    setDraggedId(id);
  }

  function handleDragOver(e: React.DragEvent, id: string) {
    e.preventDefault();
    if (id === draggedId) return;
    setDragOverId(id);
    setTopics(prev => {
      const from = prev.findIndex(t => t.id === draggedId);
      const to   = prev.findIndex(t => t.id === id);
      if (from === -1 || to === -1 || from === to) return prev;
      const next = [...prev];
      const [item] = next.splice(from, 1);
      next.splice(to, 0, item);
      return next;
    });
  }

  async function handleDrop() {
    setDraggedId(null);
    setDragOverId(null);
    if (!isAdmin) {
      setPendingAction(() => () => {});
      setShowLogin(true);
      loadTopics(); // restore original order
      return;
    }
    setSaving(true);
    try {
      await Promise.all(
        topics.map((t, idx) => apiFetch(`/curriculum/topics/${t.id}`, 'PATCH', { order: idx }))
      );
      toast({ title: 'Topic order saved' });
    } catch (e) {
      toast({ title: 'Failed to save order', description: String(e), variant: 'destructive' });
      loadTopics(); // restore from server on failure
    } finally {
      setSaving(false);
    }
  }

  function handleDragEnd() {
    setDraggedId(null);
    setDragOverId(null);
  }

  const btn = "flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border border-gray-200 rounded-lg bg-white text-gray-600 hover:bg-gray-50 hover:text-gray-900 transition-colors whitespace-nowrap";
  const inp = "rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700 placeholder-gray-400 outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/40 w-full";

  return (
    <div className="-mx-5 -my-7 lg:-mx-10 lg:-my-9" style={{ background: '#eef1fb', minHeight: 'calc(100vh - 72px)' }}>
      <div className="p-8 lg:p-10 space-y-5">

        {/* Back nav + toolbar */}
        <div className="flex items-center justify-between">
          <button onClick={() => navigate('/curriculum/courses')} className="inline-flex items-center gap-1.5 text-sm font-semibold text-gray-700 hover:text-gray-900 transition-colors">
            <ChevronLeft size={18} /> {course?.name ?? 'Course'}
          </button>
          <div className="flex items-center gap-2">
            <button onClick={() => requireAdminThen(() => setAddOpen(true))} className={btn}><Plus size={13}/> Add Topic</button>
          </div>
        </div>

        {/* Page heading */}
        <div className="rounded-xl bg-white border border-gray-100 shadow-xs p-6">
          <div className="flex items-center gap-3 mb-1">
            <Layers size={20} className="text-primary"/>
            <h1 className="text-xl font-bold text-gray-800">Course Structure</h1>
          </div>
          <p className="text-sm text-gray-500 ml-8">{course?.name ?? ''} · {topics.length} topic{topics.length !== 1 ? 's' : ''}</p>
        </div>

        {/* Content */}
        {loading && <div className="py-16 text-center text-sm text-gray-400">Loading topics…</div>}
        {error && <div className="rounded-xl bg-red-50 border border-red-100 p-5 text-sm text-red-600">{error} <button onClick={loadTopics} className="ml-3 underline">Retry</button></div>}

        {!loading && !error && topics.length === 0 && (
          <div className="flex flex-col items-center justify-center rounded-xl bg-white border border-dashed border-gray-200 py-20 text-center">
            <Layers size={36} className="mb-4 text-gray-300"/>
            <p className="text-base font-semibold text-gray-500">No topics yet</p>
            <p className="mt-1 text-sm text-gray-400 max-w-xs">Add a topic to get started.</p>
            <div className="mt-5 flex gap-2">
              <button onClick={() => requireAdminThen(() => setAddOpen(true))} className={btn}><Plus size={13}/> Add Topic</button>
            </div>
          </div>
        )}

        {!loading && !error && topics.length > 0 && (
          <div className="space-y-3">
            {saving && <p className="text-xs text-gray-400 text-center">Saving order…</p>}
            {topics.map((topic, idx) => {
              const isDragging = draggedId === topic.id;
              const isDragOver = dragOverId === topic.id;
              return (
                <div
                  key={topic.id}
                  draggable={!!isAdmin}
                  onDragStart={() => isAdmin && handleDragStart(topic.id)}
                  onDragOver={e => isAdmin && handleDragOver(e, topic.id)}
                  onDrop={() => isAdmin && handleDrop()}
                  onDragEnd={handleDragEnd}
                  className={cx(
                    'rounded-xl bg-white border shadow-xs overflow-hidden transition-all',
                    isDragging ? 'opacity-40 border-primary/30' : 'border-gray-100',
                    isDragOver && !isDragging ? 'ring-2 ring-primary/40 border-primary/20' : '',
                  )}
                >
                  {/* Topic row */}
                  <div className="flex items-center gap-4 p-4">
                    {/* Drag handle — admin only */}
                    {isAdmin && (
                      <div
                        className="shrink-0 cursor-grab active:cursor-grabbing text-gray-300 hover:text-gray-500 transition-colors"
                        title="Drag to reorder"
                      >
                        <GripVertical size={18}/>
                      </div>
                    )}

                    {/* Thumbnail */}
                    <div className="shrink-0 h-16 w-20 rounded-lg overflow-hidden bg-gray-100 flex items-center justify-center">
                      {topic.thumbUrl
                        ? <img src={topic.thumbUrl} alt={topic.name} className="h-full w-full object-cover" onError={e => { (e.target as HTMLImageElement).style.display='none'; }}/>
                        : <BookOpen size={24} className="text-gray-300"/>}
                    </div>

                    {/* Info */}
                    <div className="flex-1 min-w-0">
                      <Link
                        href={`/curriculum/courses/${id}/topics/${topic.id}`}
                        data-testid={`link-topic-${topic.id}`}
                        className="block text-sm font-semibold leading-snug text-gray-800 transition-colors hover:text-primary hover:underline"
                      >
                        {displayTopicName(topic.name, idx + 1)}
                      </Link>
                      {topic.faculty && <p className="mt-0.5 text-xs text-gray-400">Faculty: <span className="text-gray-600">{topic.faculty}</span></p>}
                    </div>

                    {/* Actions */}
                    <div className="shrink-0 flex items-center gap-2">
                      <button onClick={() => requireAdminThen(() => { setEditTopic(topic); setEditName(topic.name); setEditThumb(topic.thumbUrl); })} className={btn}>
                        <Pencil size={12}/> Edit
                      </button>
                      <button onClick={() => requireAdminThen(() => handleDelete(topic.id, topic.name))} className={cx(btn, 'text-red-500 border-red-100 hover:bg-red-50 hover:text-red-700')}>
                        <Trash2 size={12}/> Delete
                      </button>
                      <button onClick={() => requireAdminThen(() => { setFacultyTopic(topic); setFacultyVal(topic.faculty ?? ''); })} className={btn}>
                        <Users size={12}/> Set Faculty
                      </button>
                    </div>
                  </div>

                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Add Topic modal */}
      {addOpen && (
        <Modal title="Add Topic" onClose={() => setAddOpen(false)}>
          <form onSubmit={handleAddTopic} className="space-y-4">
            <Field label="Topic name">
              <input required autoFocus value={addName} onChange={e => setAddName(e.target.value)} placeholder="e.g. Introduction to Navigation" className={cx(inp, 'form-input')}/>
            </Field>
            <Field label="Thumbnail URL (optional)">
              <input value={addThumb} onChange={e => setAddThumb(e.target.value)} placeholder="https://..." className={cx(inp, 'form-input')}/>
            </Field>
            <div className="flex justify-end gap-2 pt-2">
              <Button testId="btn-cancel-add-topic" variant="quiet" onClick={() => setAddOpen(false)}>Cancel</Button>
              <Button testId="btn-save-add-topic" type="submit">Add Topic</Button>
            </div>
          </form>
        </Modal>
      )}

      {/* Edit Topic modal */}
      {editTopic && (
        <Modal title="Edit Topic" onClose={() => setEditTopic(null)}>
          <form onSubmit={handleEditSave} className="space-y-4">
            <Field label="Topic name">
              <input required autoFocus value={editName} onChange={e => setEditName(e.target.value)} className={cx(inp, 'form-input')}/>
            </Field>
            <Field label="Thumbnail URL">
              <input value={editThumb} onChange={e => setEditThumb(e.target.value)} placeholder="https://..." className={cx(inp, 'form-input')}/>
            </Field>
            <div className="flex justify-end gap-2 pt-2">
              <Button testId="btn-cancel-edit-topic" variant="quiet" onClick={() => setEditTopic(null)}>Cancel</Button>
              <Button testId="btn-save-edit-topic" type="submit">Save</Button>
            </div>
          </form>
        </Modal>
      )}

      {/* Set Faculty modal */}
      {facultyTopic && (
        <Modal title="Set Faculty" onClose={() => setFacultyTopic(null)}>
          <form onSubmit={handleSetFaculty} className="space-y-4">
            <p className="text-sm text-gray-500">Assign faculty for: <span className="font-semibold text-gray-700">{facultyTopic.name}</span></p>
            <Field label="Faculty name">
              <input autoFocus value={facultyVal} onChange={e => setFacultyVal(e.target.value)} placeholder="e.g. Capt. James Smith" className={cx(inp, 'form-input')}/>
            </Field>
            <div className="flex justify-end gap-2 pt-2">
              <Button testId="btn-cancel-faculty" variant="quiet" onClick={() => setFacultyTopic(null)}>Cancel</Button>
              <Button testId="btn-save-faculty" type="submit">Assign</Button>
            </div>
          </form>
        </Modal>
      )}

      {/* Admin login modal */}
      {showLogin && (
        <Modal title="Admin login" onClose={() => { setShowLogin(false); setPendingAction(null); setLoginError(''); }}>
          <p className="mb-4 text-sm text-gray-500">Enter your LMS admin credentials to manage sub-topics.</p>
          <form onSubmit={handleAdminLogin} className="space-y-4">
            <Field label="Username">
              <input required autoFocus value={loginUser} onChange={e => setLoginUser(e.target.value)}
                placeholder="admin" className={cx(inp, 'form-input')} autoComplete="username"/>
            </Field>
            <Field label="Password">
              <input required type="password" value={loginPass} onChange={e => setLoginPass(e.target.value)}
                className={cx(inp, 'form-input')} autoComplete="current-password"/>
            </Field>
            {loginError && <p className="text-sm text-red-600">{loginError}</p>}
            <div className="flex justify-end gap-2 pt-1">
              <Button testId="btn-cancel-admin-login-structure" variant="quiet"
                onClick={() => { setShowLogin(false); setPendingAction(null); setLoginError(''); }}>Cancel</Button>
              <Button testId="btn-submit-admin-login-structure" type="submit" disabled={loginBusy}>
                {loginBusy ? 'Signing in…' : 'Sign in'}
              </Button>
            </div>
          </form>
        </Modal>
      )}

    </div>
  );
}

// ─── SubTopicPage — dedicated page showing resources for one sub-topic ──────────
function SubTopicPage() {
  const { courseId = '', topicId = '', subtopicId = '' } = useParams<{ courseId: string; topicId: string; subtopicId: string }>();
  const [, navigate] = useLocation();
  const { toast } = useToast();

  const [subtopic,   setSubtopic]   = useState<CourseTopicSubtopic | null>(null);
  const [topicName,  setTopicName]  = useState('');
  const [courseName, setCourseName] = useState('');
  const [loading,    setLoading]    = useState(true);
  const [error,      setError]      = useState('');

  // Admin state
  const [isAdmin,    setIsAdmin]    = useState<boolean | null>(null);
  const [showLogin,  setShowLogin]  = useState(false);
  const [loginUser,  setLoginUser]  = useState('');
  const [loginPass,  setLoginPass]  = useState('');
  const [loginBusy,  setLoginBusy]  = useState(false);
  const [loginError, setLoginError] = useState('');
  const [pendingAction, setPendingAction] = useState<(() => void) | null>(null);

  // Rename modal
  const [editOpen, setEditOpen] = useState(false);
  const [editName, setEditName] = useState('');

  // Resource preview
  const [previewResource, setPreviewResource] = useState<PreviewResource | null>(null);

  useEffect(() => {
    apiFetch<{ isAdmin: boolean }>('/auth/status')
      .then(r => setIsAdmin(r.isAdmin))
      .catch(() => setIsAdmin(false));
  }, []);

  async function load() {
    if (!courseId || !topicId || !subtopicId) return;
    setLoading(true);
    setError('');
    try {
      const [topics, courses] = await Promise.all([
        apiFetch<CourseTopic[]>(`/curriculum/courses/${courseId}/topics`),
        apiFetch<Array<{ id: string; name: string }>>('/curriculum/list'),
      ]);
      const topic = topics.find(t => t.id === topicId);
      const sub = topic?.subtopics.find(s => s.id === subtopicId) ?? null;
      setSubtopic(sub);
      setTopicName(topic?.name ?? '');
      setCourseName(courses.find(c => c.id === courseId)?.name ?? '');
      if (!sub) setError('Sub-topic not found');
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, [courseId, topicId, subtopicId]);

  function requireAdminThen(action: () => void) {
    if (isAdmin) { action(); return; }
    setPendingAction(() => action);
    setShowLogin(true);
  }

  async function handleAdminLogin(e: FormEvent) {
    e.preventDefault();
    setLoginBusy(true);
    setLoginError('');
    try {
      await apiFetch('/auth/login', 'POST', { username: loginUser, password: loginPass });
      setIsAdmin(true);
      setShowLogin(false);
      setLoginUser(''); setLoginPass('');
      if (pendingAction) {
        const fn = pendingAction;
        setPendingAction(null);
        fn();
      }
    } catch (err) {
      setLoginError(String(err).replace(/^Error:\s*/, ''));
    } finally {
      setLoginBusy(false);
    }
  }

  function handleAdminError(err: unknown) {
    const msg = String(err);
    if (msg.includes('401') || msg.includes('Unauthorized')) {
      setIsAdmin(false); setShowLogin(true);
    } else {
      toast({ title: 'Error', description: msg, variant: 'destructive' });
    }
  }

  async function handleRename(e: FormEvent) {
    e.preventDefault();
    if (!subtopic || !editName.trim()) return;
    try {
      await apiFetch(`/curriculum/subtopics/${subtopic.id}`, 'PATCH', { name: editName.trim() });
      setEditOpen(false);
      await load();
      toast({ title: 'Sub-topic renamed' });
    } catch (err) { handleAdminError(err); }
  }

  async function handleDelete() {
    if (!subtopic) return;
    if (!confirm(`Delete sub-topic "${subtopic.name}"? This cannot be undone.`)) return;
    try {
      await apiFetch(`/curriculum/subtopics/${subtopic.id}`, 'DELETE');
      toast({ title: 'Sub-topic deleted' });
      navigate(`/curriculum/courses/${courseId}/topics/${topicId}`);
    } catch (err) { handleAdminError(err); }
  }

  const tbBtn = (label: string, icon: ReactNode, onClick: () => void, disabled = false) => (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cx(
        'inline-flex items-center gap-1.5 rounded-md border border-gray-200 bg-white px-3 py-2 text-xs font-medium text-gray-600 shadow-xs transition-colors',
        disabled ? 'cursor-not-allowed text-gray-300' : 'hover:border-gray-300 hover:bg-gray-50 hover:text-gray-900',
      )}
    >{icon}{label}</button>
  );

  const activities = subtopic?.activities ?? [];

  return (
    <div className="-mx-5 -my-7 min-h-[calc(100vh-72px)] bg-[#eef1fb] lg:-mx-10 lg:-my-9">
      <div className="space-y-4 p-5 sm:p-8 lg:p-10">

        {/* Breadcrumb + toolbar row — always visible; actions gate on admin */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <button
            type="button"
            onClick={() => navigate(`/curriculum/courses/${courseId}/topics/${topicId}`)}
            className="inline-flex items-center gap-1.5 text-sm font-semibold text-gray-700 hover:text-gray-900 transition-colors"
          >
            <ChevronLeft size={18} className="shrink-0"/>
            <span className="truncate">{topicName || 'Topic'}</span>
          </button>
          <div className="flex shrink-0 flex-wrap justify-end gap-2">
            {tbBtn('Edit', <Pencil size={13}/>, () => requireAdminThen(() => {
              setEditName(subtopic?.name ?? '');
              setEditOpen(true);
            }))}
            {tbBtn('Delete', <Trash2 size={13}/>, () => requireAdminThen(handleDelete))}
          </div>
        </div>

        {/* Header card */}
        <div className="rounded-xl bg-white border border-gray-100 shadow-xs p-6">
          <div className="flex items-center gap-3 mb-1">
            <Layers size={20} className="text-primary"/>
            <h1 className="text-xl font-bold text-gray-800">{subtopic?.name ?? 'Sub-topic'}</h1>
          </div>
          <p className="text-sm text-gray-500 ml-8">{courseName}{topicName ? ` · ${topicName}` : ''}</p>
        </div>

        {loading && <div className="rounded-xl bg-white border border-gray-100 py-16 text-center text-sm text-gray-400">Loading…</div>}
        {!loading && error && <div className="rounded-xl bg-red-50 border border-red-100 p-5 text-sm text-red-600">{error}</div>}

        {!loading && !error && subtopic && (
          <div className="rounded-xl bg-white border border-gray-100 shadow-xs overflow-hidden">
            <div className="px-5 py-3 border-b border-gray-100 bg-gray-50/60">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-400">
                Resources · {activities.length}
              </p>
            </div>
            {activities.length === 0 ? (
              <div className="py-16 text-center">
                <Layers size={28} className="mx-auto mb-3 text-gray-200"/>
                <p className="text-sm text-gray-400">No resources imported yet for this sub-topic.</p>
              </div>
            ) : (
              <ul className="divide-y divide-gray-100">
                {activities.map((a, idx) => {
                  const icon = a.type === 'Video'
                    ? <Video size={15} className="text-blue-400 shrink-0"/>
                    : a.type === 'Document'
                    ? <FileText size={15} className="text-amber-400 shrink-0"/>
                    : <Layers size={15} className="text-gray-400 shrink-0"/>;
                  const statusCx = a.status === 'ready'
                    ? 'text-emerald-600 bg-emerald-50'
                    : a.status === 'unavailable'
                    ? 'text-red-500 bg-red-50'
                    : 'text-amber-600 bg-amber-50';
                  const canOpen = Boolean(a.openUrl);
                  return (
                    <li key={a.id}>
                      {canOpen ? (
                        <button
                          type="button"
                          onClick={() => setPreviewResource({ id: a.id, title: a.title, type: a.type, openUrl: a.openUrl!, sourceUrl: a.sourceUrl, hasStoredFile: a.hasStoredFile, mimeType: a.mimeType })}
                          className="w-full flex items-center gap-4 px-5 py-3.5 text-left hover:bg-gray-50 cursor-pointer transition-colors group"
                        >
                          <span className="w-6 shrink-0 text-center text-xs font-medium text-gray-400">{idx + 1}</span>
                          {icon}
                          <span className="flex-1 text-sm text-gray-700 group-hover:text-primary transition-colors">{a.title}</span>
                          <span className="text-[10px] font-semibold uppercase text-gray-400 bg-gray-100 px-2 py-0.5 rounded shrink-0">{a.type || '—'}</span>
                          <span className={cx('text-[10px] font-semibold capitalize px-2 py-0.5 rounded shrink-0', statusCx)}>{a.status}</span>
                          <Eye size={13} className="shrink-0 text-gray-300 group-hover:text-primary transition-colors"/>
                        </button>
                      ) : (
                        <div className="flex items-center gap-4 px-5 py-3.5">
                          <span className="w-6 shrink-0 text-center text-xs font-medium text-gray-400">{idx + 1}</span>
                          {icon}
                          <span className="flex-1 text-sm text-gray-700">{a.title}</span>
                          <span className="text-[10px] font-semibold uppercase text-gray-400 bg-gray-100 px-2 py-0.5 rounded shrink-0">{a.type || '—'}</span>
                          <span className={cx('text-[10px] font-semibold capitalize px-2 py-0.5 rounded shrink-0', statusCx)}>{a.status}</span>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        )}
      </div>

      {/* Rename modal */}
      {editOpen && subtopic && (
        <Modal title="Rename Sub-topic" onClose={() => setEditOpen(false)}>
          <form onSubmit={handleRename} className="space-y-4">
            <Field label="Sub-topic name">
              <input required autoFocus value={editName} onChange={e => setEditName(e.target.value)} className="form-input"/>
            </Field>
            <div className="flex justify-end gap-2 pt-2">
              <Button testId="button-cancel-subtopic-rename" variant="quiet" onClick={() => setEditOpen(false)}>Cancel</Button>
              <Button testId="button-save-subtopic-rename" type="submit">Save</Button>
            </div>
          </form>
        </Modal>
      )}

      {/* Admin login modal */}
      {showLogin && (
        <Modal title="Admin login" onClose={() => { setShowLogin(false); setPendingAction(null); setLoginError(''); }}>
          <p className="mb-4 text-sm text-gray-500">Enter your LMS admin credentials to manage this sub-topic.</p>
          <form onSubmit={handleAdminLogin} className="space-y-4">
            <Field label="Username">
              <input required autoFocus value={loginUser} onChange={e => setLoginUser(e.target.value)} placeholder="admin" className="form-input" autoComplete="username"/>
            </Field>
            <Field label="Password">
              <input required type="password" value={loginPass} onChange={e => setLoginPass(e.target.value)} className="form-input" autoComplete="current-password"/>
            </Field>
            {loginError && <p className="text-sm text-red-600">{loginError}</p>}
            <div className="flex justify-end gap-2 pt-1">
              <Button testId="button-cancel-subtopic-login" variant="quiet" onClick={() => { setShowLogin(false); setPendingAction(null); setLoginError(''); }}>Cancel</Button>
              <Button testId="button-submit-subtopic-login" type="submit" disabled={loginBusy}>{loginBusy ? 'Signing in…' : 'Sign in'}</Button>
            </div>
          </form>
        </Modal>
      )}

      {/* Resource preview modal */}
      {previewResource && (
        <ResourcePreviewModal resource={previewResource} onClose={() => setPreviewResource(null)} />
      )}
    </div>
  );
}

// ─── CourseOBEPage (OBE outline builder — kept for Course Structure flow) ───────
function CourseOBEPage() {
  const [selectedProgrammeId, setSelectedProgrammeId] = useState('prog-btme');
  const [selectedCourseId, setSelectedCourseId] = useState<string | null>('cur-brm501');
  const [activeTab, setActiveTab] = useState<'overview' | 'structure' | 'mapping'>('overview');
  const [expandedModules, setExpandedModules] = useState<Set<string>>(new Set(['mod-brm-1']));
  const [addingCO, setAddingCO] = useState(false);

  const programmesQ = useListProgrammes({ query: { queryKey: getListProgrammesQueryKey() } });
  const coursesQ = useListProgrammeCourses(selectedProgrammeId, { query: { queryKey: getListProgrammeCoursesQueryKey(selectedProgrammeId) } });
  const outlineQ = useGetCurriculumCourseOutline(selectedCourseId ?? '', {
    query: { queryKey: getGetCurriculumCourseOutlineQueryKey(selectedCourseId ?? ''), enabled: Boolean(selectedCourseId) },
  });
  const addOutcome = useAddCourseOutcome();

  const programmes = (programmesQ.data as Programme[] | undefined) ?? [];
  const courses    = (coursesQ.data as ProgrammeCourse[] | undefined) ?? [];
  const outline    = outlineQ.data as CurriculumCourse | undefined;

  const bySemester = courses.reduce<Record<number, ProgrammeCourse[]>>((acc, c) => {
    if (!acc[c.semester]) acc[c.semester] = [];
    acc[c.semester].push(c);
    return acc;
  }, {});

  function toggleModule(id: string) {
    setExpandedModules(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  return (
    <div>
      <div className="mb-5 flex items-center gap-2">
        <Link href="/curriculum" className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors">
          <ChevronLeft size={16} /> Curriculum
        </Link>
        <ChevronRight size={14} className="text-muted-foreground/50" />
        <span className="text-sm font-semibold text-foreground">Courses</span>
      </div>
      <PageHeading
        eyebrow="Academic structure"
        title="Courses"
        description="Manage programme structures, course outlines, learning outcomes and outcome-based mapping."
        action={<Button testId="button-add-co" onClick={() => setAddingCO(true)}><Plus size={16} /> Add outcome</Button>}
      />

      <div className="flex gap-6 items-start">
        {/* ── Left sidebar ── */}
        <aside className="w-[272px] shrink-0 rounded-xl border border-border bg-card shadow-xs overflow-hidden">
          <div className="border-b border-border p-4">
            <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Programme</p>
            {programmesQ.isLoading
              ? <Skeleton className="h-9 w-full" />
              : <select
                  data-testid="select-programme"
                  value={selectedProgrammeId}
                  onChange={e => { setSelectedProgrammeId(e.target.value); setSelectedCourseId(null); }}
                  className="h-9 w-full rounded-lg border border-border bg-muted/40 px-2.5 text-sm font-semibold outline-none focus:ring-2 focus:ring-ring/30"
                >
                  {programmes.map(p => <option key={p.id} value={p.id}>{p.code} — {p.name}</option>)}
                </select>
            }
          </div>

          <div className="max-h-[calc(100vh-260px)] overflow-y-auto p-2">
            {coursesQ.isLoading
              ? <div className="space-y-2 p-2"><Skeleton className="h-10 w-full" /><Skeleton className="h-10 w-full" /><Skeleton className="h-10 w-full" /></div>
              : Object.entries(bySemester).map(([sem, semCourses]) => (
                <div key={sem} className="mb-3">
                  <p className="mb-1 px-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Semester {sem}</p>
                  {semCourses.map(course => (
                    <button
                      key={course.id}
                      data-testid={`button-curriculum-course-${course.id}`}
                      onClick={() => { setSelectedCourseId(course.id); setActiveTab('overview'); setExpandedModules(new Set()); }}
                      className={cx(
                        'group mb-0.5 w-full rounded-lg p-2.5 text-left transition',
                        selectedCourseId === course.id
                          ? 'bg-primary/10 text-primary'
                          : 'hover:bg-muted text-foreground'
                      )}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate text-xs font-bold">{course.name}</span>
                        <span className={cx('shrink-0 rounded px-1.5 py-0.5 text-[9px] font-bold uppercase', courseTypeTone(course.type))}>{course.type}</span>
                      </div>
                      <div className="mt-1 flex items-center gap-2">
                        <span className="text-[10px] font-semibold text-muted-foreground">{course.code}</span>
                        <span className="text-[10px] text-muted-foreground">·</span>
                        <span className="text-[10px] font-semibold text-muted-foreground">{course.credits} cr</span>
                        {course.status === 'Draft' && <span className="ml-auto text-[9px] font-bold uppercase text-amber-600">Draft</span>}
                      </div>
                    </button>
                  ))}
                </div>
              ))
            }
          </div>
        </aside>

        {/* ── Main content ── */}
        <div className="min-w-0 flex-1">
          {!selectedCourseId
            ? <EmptyPanel icon={BookMarked} title="Select a course" description="Choose a course from the programme list on the left to view its curriculum outline and outcomes." />
            : outlineQ.isLoading
              ? <LoadingPanel />
              : outlineQ.isError || !outline
                ? <ErrorPanel onRetry={() => outlineQ.refetch()} />
                : (
                  <div className="space-y-5">
                    {/* Course header */}
                    <div className="rounded-xl border border-border bg-card shadow-xs p-5">
                      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                        <div>
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{outline.code}</span>
                            <span className="text-muted-foreground">·</span>
                            <span className={cx('rounded px-2 py-0.5 text-[10px] font-bold uppercase', courseTypeTone(outline.type))}>{outline.type}</span>
                            <span className="rounded bg-slate-100 px-2 py-0.5 text-[10px] font-bold uppercase text-slate-600">Sem {outline.semester}</span>
                            <span className="rounded bg-slate-100 px-2 py-0.5 text-[10px] font-bold uppercase text-slate-600">{outline.credits} Credits</span>
                          </div>
                          <h2 className="mt-2 text-xl font-bold">{outline.name}</h2>
                          <p className="mt-1 text-sm text-muted-foreground">{outline.programmeName}</p>
                        </div>
                        <div className="flex shrink-0 gap-3 text-center">
                          <div className="rounded-lg border border-border px-4 py-2">
                            <p className="text-lg font-bold text-primary">{outline.outcomes.length}</p>
                            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Outcomes</p>
                          </div>
                          <div className="rounded-lg border border-border px-4 py-2">
                            <p className="text-lg font-bold">{outline.modules.length}</p>
                            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Modules</p>
                          </div>
                          <div className="rounded-lg border border-border px-4 py-2">
                            <p className="text-lg font-bold">{outline.modules.reduce((sum, m) => sum + m.topics.reduce((s2, t) => s2 + t.activities.length, 0), 0)}</p>
                            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Activities</p>
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Tab bar */}
                    <div className="flex gap-1 rounded-lg bg-muted p-1 w-fit">
                      {(['overview', 'structure', 'mapping'] as const).map(tab => (
                        <button
                          key={tab}
                          data-testid={`button-curriculum-tab-${tab}`}
                          onClick={() => setActiveTab(tab)}
                          className={cx(
                            'rounded-md px-4 py-2 text-sm font-semibold capitalize transition',
                            activeTab === tab ? 'bg-card text-foreground shadow-xs' : 'text-muted-foreground hover:text-foreground'
                          )}
                        >
                          {tab === 'mapping' ? 'CO-PO Mapping' : tab.charAt(0).toUpperCase() + tab.slice(1)}
                        </button>
                      ))}
                    </div>

                    {/* ── Overview tab ── */}
                    {activeTab === 'overview' && (
                      <div className="space-y-5">
                        <div className="rounded-xl border border-border bg-card shadow-xs p-5">
                          <h3 className="mb-2 text-sm font-bold">Course Description</h3>
                          <p className="text-sm leading-relaxed text-muted-foreground">{outline.description}</p>
                        </div>

                        <div className="rounded-xl border border-border bg-card shadow-xs">
                          <div className="flex items-center justify-between border-b border-border px-4 py-3">
                            <div>
                              <h3 className="font-bold">Course Outcomes</h3>
                              <p className="mt-0.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{outline.outcomes.length} defined</p>
                            </div>
                            <Button testId="button-add-outcome-inline" onClick={() => setAddingCO(true)} variant="outline"><Plus size={14} /> Add CO</Button>
                          </div>
                          <div className="divide-y divide-border">
                            {outline.outcomes.map(co => (
                              <div key={co.id} data-testid={`row-co-${co.id}`} className="flex gap-4 px-4 py-3">
                                <div className="flex h-8 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-xs font-black text-primary">{co.code}</div>
                                <div className="min-w-0 flex-1">
                                  <p className="text-sm leading-relaxed">{co.description}</p>
                                  <div className="mt-2 flex flex-wrap items-center gap-1.5">
                                    <span className={cx('rounded border px-2 py-0.5 text-[10px] font-bold', bloomsTone(co.bloomsLevel))}>{co.bloomsLevel}</span>
                                    {co.poMapping.map(po => (
                                      <span key={po} title={PO_LABELS[po]} className="rounded border border-primary/20 bg-primary/5 px-1.5 py-0.5 text-[10px] font-bold text-primary">{po}</span>
                                    ))}
                                  </div>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>
                    )}

                    {/* ── Structure tab ── */}
                    {activeTab === 'structure' && (
                      <div className="space-y-3">
                        {outline.modules.map(mod => (
                          <div key={mod.id} data-testid={`block-module-${mod.id}`} className="rounded-xl border border-border bg-card shadow-xs overflow-hidden">
                            <button
                              data-testid={`button-toggle-module-${mod.id}`}
                              onClick={() => toggleModule(mod.id)}
                              className="flex w-full items-center gap-4 px-4 py-3 text-left hover:bg-muted/40"
                            >
                              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-black text-primary-foreground">{mod.order}</span>
                              <div className="min-w-0 flex-1">
                                <p className="font-bold">{mod.title}</p>
                                <div className="mt-1 flex flex-wrap gap-1">
                                  {mod.coIds.map(cid => {
                                    const co = outline.outcomes.find(o => o.id === cid);
                                    return co ? <span key={cid} className="rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-bold text-primary">{co.code}</span> : null;
                                  })}
                                </div>
                              </div>
                              <div className="flex items-center gap-3 text-right text-[10px] font-semibold text-muted-foreground">
                                <span>{mod.topics.length} topics</span>
                                <ChevronDown size={16} className={cx('transition-transform text-muted-foreground', expandedModules.has(mod.id) && 'rotate-180')} />
                              </div>
                            </button>

                            {expandedModules.has(mod.id) && (
                              <div className="border-t border-border bg-muted/20">
                                {mod.topics.map((topic, ti) => (
                                  <div key={topic.id} data-testid={`block-topic-${topic.id}`} className={cx(ti > 0 && 'border-t border-border/60')}>
                                    <div className="flex items-center gap-3 px-6 py-3">
                                      <span className="text-[11px] font-bold tabular-nums text-muted-foreground">{String(ti + 1).padStart(2, '0')}</span>
                                      <div className="min-w-0 flex-1">
                                        <p className="text-sm font-semibold">{topic.title}</p>
                                      </div>
                                      <span className="shrink-0 rounded bg-card px-2 py-0.5 text-[10px] font-semibold text-muted-foreground border border-border">{topic.type}</span>
                                      <span className="shrink-0 text-[11px] font-semibold text-muted-foreground">{topic.duration}</span>
                                    </div>
                                    <div className="space-y-0.5 px-6 pb-3">
                                      {topic.activities.map(act => (
                                        <div key={act.id} data-testid={`row-activity-${act.id}`} className="flex items-center gap-3 rounded-lg px-3 py-2 hover:bg-card">
                                          <span className="grid h-6 w-6 shrink-0 place-items-center rounded text-muted-foreground bg-card border border-border">
                                            {activityIcon(act.type)}
                                          </span>
                                          <span className="min-w-0 flex-1 truncate text-xs font-medium">{act.title}</span>
                                          <div className="flex shrink-0 items-center gap-1.5">
                                            {act.coIds.map(cid => {
                                              const co = outline.outcomes.find(o => o.id === cid);
                                              return co ? <span key={cid} className="rounded bg-primary/10 px-1.5 py-0.5 text-[9px] font-bold text-primary">{co.code}</span> : null;
                                            })}
                                            <span className="text-[10px] text-muted-foreground">{act.duration}</span>
                                          </div>
                                        </div>
                                      ))}
                                    </div>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    )}

                    {/* ── CO-PO Mapping tab ── */}
                    {activeTab === 'mapping' && (
                      <div className="rounded-xl border border-border bg-card shadow-xs overflow-hidden">
                        <div className="border-b border-border px-4 py-3">
                          <h3 className="font-bold">CO-PO Mapping Matrix</h3>
                          <p className="mt-0.5 text-xs text-muted-foreground">Course Outcomes mapped to Programme Outcomes (NBA framework). Hover a PO header for its full title.</p>
                        </div>
                        <div className="overflow-x-auto">
                          <table className="w-full text-sm">
                            <thead>
                              <tr className="border-b border-border bg-muted/40">
                                <th className="px-4 py-3 text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground w-72">Course Outcome</th>
                                <th className="px-2 py-3 text-center text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Bloom's</th>
                                {PROGRAMME_OUTCOMES.map(po => (
                                  <th key={po} title={PO_LABELS[po]} className="px-2 py-3 text-center text-[10px] font-semibold uppercase tracking-wider text-muted-foreground cursor-help">{po}</th>
                                ))}
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-border">
                              {outline.outcomes.map(co => (
                                <tr key={co.id} data-testid={`mapping-row-${co.id}`} className="hover:bg-muted/20">
                                  <td className="px-4 py-3">
                                    <div className="flex items-start gap-2">
                                      <span className="mt-0.5 shrink-0 rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-black text-primary">{co.code}</span>
                                      <span className="text-xs leading-relaxed text-muted-foreground line-clamp-2">{co.description}</span>
                                    </div>
                                  </td>
                                  <td className="px-2 py-3 text-center">
                                    <span className={cx('rounded border px-1.5 py-0.5 text-[9px] font-bold', bloomsTone(co.bloomsLevel))}>{co.bloomsLevel.slice(0, 3)}</span>
                                  </td>
                                  {PROGRAMME_OUTCOMES.map(po => (
                                    <td key={po} className="px-2 py-3 text-center">
                                      {co.poMapping.includes(po)
                                        ? <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-primary/15 text-primary">
                                            <span className="h-2.5 w-2.5 rounded-full bg-primary" />
                                          </span>
                                        : <span className="inline-block h-2 w-2 rounded-full bg-border" />
                                      }
                                    </td>
                                  ))}
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                        <div className="border-t border-border px-5 py-3">
                          <div className="flex flex-wrap gap-x-6 gap-y-1 text-[10px] text-muted-foreground">
                            {PROGRAMME_OUTCOMES.slice(0, 6).map(po => (
                              <span key={po}><strong className="text-foreground">{po}</strong>: {PO_LABELS[po]}</span>
                            ))}
                          </div>
                          <div className="mt-1 flex flex-wrap gap-x-6 gap-y-1 text-[10px] text-muted-foreground">
                            {PROGRAMME_OUTCOMES.slice(6).map(po => (
                              <span key={po}><strong className="text-foreground">{po}</strong>: {PO_LABELS[po]}</span>
                            ))}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                )
          }
        </div>
      </div>

      {/* ── Add CO modal ── */}
      {addingCO && selectedCourseId && (
        <AddCOModal
          courseId={selectedCourseId}
          existingCount={outline?.outcomes.length ?? 0}
          onClose={() => setAddingCO(false)}
          onSaved={() => {
            setAddingCO(false);
            outlineQ.refetch();
          }}
          addOutcome={addOutcome}
        />
      )}
    </div>
  );
}

function AddCOModal({ courseId, existingCount, onClose, onSaved, addOutcome }: {
  courseId: string; existingCount: number; onClose: () => void; onSaved: () => void;
  addOutcome: ReturnType<typeof useAddCourseOutcome>;
}) {
  const [form, setForm] = useState<CourseOutcomeInput>({ description: '', bloomsLevel: 'Understand', poMapping: [] });
  const togglePO = (po: string) => setForm(f => ({
    ...f,
    poMapping: f.poMapping.includes(po) ? f.poMapping.filter(p => p !== po) : [...f.poMapping, po],
  }));
  const submit = (e: FormEvent) => {
    e.preventDefault();
    addOutcome.mutate({ courseId, data: form }, { onSuccess: onSaved });
  };
  return (
    <Modal title={`Add Course Outcome — CO${existingCount + 1}`} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <Field label="Outcome description">
          <textarea required data-testid="input-co-description" value={form.description}
            onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
            placeholder="e.g. Apply passage planning methodology using ECDIS for ocean voyages"
            rows={3} className="form-input h-auto py-2.5 resize-none" />
        </Field>
        <Field label="Bloom's taxonomy level">
          <select data-testid="select-co-blooms" value={form.bloomsLevel}
            onChange={e => setForm(f => ({ ...f, bloomsLevel: e.target.value }))}
            className="form-input">
            {['Remember','Understand','Apply','Analyze','Evaluate','Create'].map(l => <option key={l} value={l}>{l}</option>)}
          </select>
        </Field>
        <div>
          <span className="mb-2 block text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Programme outcome mapping</span>
          <div className="flex flex-wrap gap-1.5">
            {PROGRAMME_OUTCOMES.map(po => (
              <button key={po} type="button" data-testid={`toggle-po-${po}`}
                onClick={() => togglePO(po)}
                title={PO_LABELS[po]}
                className={cx('rounded border px-2.5 py-1 text-xs font-bold transition',
                  form.poMapping.includes(po)
                    ? 'border-primary bg-primary/10 text-primary'
                    : 'border-border text-muted-foreground hover:border-primary/40 hover:text-foreground'
                )}>{po}</button>
            ))}
          </div>
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <Button testId="button-cancel-co" variant="quiet" onClick={onClose}>Cancel</Button>
          <Button testId="button-submit-co" type="submit" disabled={addOutcome.isPending}>{addOutcome.isPending ? 'Saving…' : 'Add outcome'}</Button>
        </div>
      </form>
    </Modal>
  );
}

// ─── CurriculumGroupsPage ─────────────────────────────────────────────────────
type GroupNode = { id: string; name: string; learnerCount: number; children?: GroupNode[] };
type GroupRow  = { id: string; name: string; parentId: string | null; learnerCount: number };

function buildGroupTree(rows: GroupRow[]): GroupNode[] {
  const lookup: Record<string, GroupNode> = {};
  rows.forEach(r => { lookup[r.id] = { id: r.id, name: r.name, learnerCount: r.learnerCount ?? 0, children: [] }; });
  const roots: GroupNode[] = [];
  rows.forEach(r => {
    const node = lookup[r.id];
    if (r.parentId && lookup[r.parentId]) {
      lookup[r.parentId].children!.push(node);
    } else {
      roots.push(node);
    }
  });
  return roots;
}

function GroupTreeItem({ node, depth, selected, onSelect, expanded, onToggle }: {
  node: GroupNode; depth: number; selected: string | null;
  onSelect: (id: string) => void; expanded: Set<string>; onToggle: (id: string) => void;
}) {
  const hasChildren = node.children && node.children.length > 0;
  const isExpanded = expanded.has(node.id);
  return (
    <div>
      <div
        onClick={() => onSelect(node.id)}
        className={cx(
          'flex items-center gap-2 px-3 py-1.5 cursor-pointer hover:bg-blue-50 rounded select-none',
          selected === node.id && 'bg-blue-50'
        )}
        style={{ paddingLeft: `${12 + depth * 20}px` }}
      >
        {/* expand toggle */}
        <button
          type="button"
          onClick={e => { e.stopPropagation(); if (hasChildren) onToggle(node.id); }}
          className="w-4 h-4 flex items-center justify-center text-gray-400 shrink-0"
        >
          {hasChildren
            ? <ChevronRight size={12} className={cx('transition-transform', isExpanded && 'rotate-90')} />
            : <span className="w-3" />}
        </button>
        {/* radio */}
        <span className={cx(
          'flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-2 transition-colors',
          selected === node.id ? 'border-primary' : 'border-gray-300'
        )}>
          {selected === node.id && <span className="h-2 w-2 rounded-full bg-primary" />}
        </span>
        <span className="min-w-0 flex-1 truncate text-sm text-gray-700">{node.name}</span>
        <span
          data-testid={`text-group-learner-count-${node.id}`}
          className="mr-3 shrink-0 rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-medium text-gray-500"
        >
          {node.learnerCount} {node.learnerCount === 1 ? 'learner' : 'learners'}
        </span>
      </div>
      {hasChildren && isExpanded && (
        <div>
          {node.children!.map(child => (
            <GroupTreeItem key={child.id} node={child} depth={depth + 1}
              selected={selected} onSelect={onSelect} expanded={expanded} onToggle={onToggle} />
          ))}
        </div>
      )}
    </div>
  );
}

function CurriculumGroupsPage() {
  const [selected, setSelected] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [showCreate, setShowCreate] = useState(false);
  const [newGroupName, setNewGroupName] = useState('');
  const [busy, setBusy] = useState(false);

  const { data: rawGroups, loading, error, refetch } = useApi<GroupRow[]>('/curriculum/groups');
  const groups = buildGroupTree(rawGroups ?? []);

  function toggleExpand(id: string) {
    setExpanded(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    if (!newGroupName.trim() || busy) return;
    setBusy(true);
    try {
      await apiFetch('/curriculum/groups', 'POST', { name: newGroupName.trim() });
      setNewGroupName('');
      setShowCreate(false);
      refetch();
    } finally { setBusy(false); }
  }

  async function handleDelete() {
    if (!selected || busy) return;
    setBusy(true);
    try {
      await apiFetch(`/curriculum/groups/${selected}`, 'DELETE');
      setSelected(null);
      refetch();
    } finally { setBusy(false); }
  }

  const toolbarBtn = (label: string, icon: ReactNode, onClick?: () => void, disabled = false) => (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cx(
        'flex items-center gap-1.5 px-3 py-2 text-xs font-medium border-r border-gray-200 last:border-r-0 transition-colors',
        disabled ? 'text-gray-300 cursor-not-allowed' : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
      )}
    >{icon}{label}</button>
  );

  return (
    <div className="-mx-5 -my-7 lg:-mx-10 lg:-my-9" style={{ background: '#eef1fb', minHeight: 'calc(100vh - 72px)' }}>
      <div className="p-8 lg:p-10 space-y-5">
        {/* Back link */}
        <Link href="/curriculum" className="inline-flex items-center gap-1.5 text-sm font-semibold text-gray-700 hover:text-gray-900 transition-colors">
          <ChevronLeft size={18} /> Curriculum
        </Link>

        {/* Toolbar */}
        <div className="flex justify-end">
          <div className="inline-flex items-center rounded-lg border border-gray-200 bg-white shadow-xs overflow-hidden">
            {toolbarBtn('Create', <Scissors size={13} />, () => setShowCreate(true))}
            {toolbarBtn('Edit', <Pencil size={13} />, undefined, !selected)}
            {toolbarBtn('Delete', <Trash2 size={13} />, handleDelete, !selected || busy)}
            {toolbarBtn('Import', <Download size={13} />)}
            {toolbarBtn('Course Schedule', <CalendarDays size={13} />)}
            {toolbarBtn('Archived', <Archive size={13} />)}
          </div>
        </div>

        {/* Group tree */}
        <div className="rounded-xl bg-white border border-gray-100 shadow-xs py-2">
          {loading && <p className="px-4 py-6 text-center text-sm text-gray-400">Loading groups…</p>}
          {error && <ErrorPanel onRetry={refetch} compact />}
          {!loading && !error && groups.map(node => (
            <GroupTreeItem key={node.id} node={node} depth={0}
              selected={selected} onSelect={setSelected}
              expanded={expanded} onToggle={toggleExpand} />
          ))}
          {!loading && !error && groups.length === 0 && (
            <p className="px-4 py-6 text-center text-sm text-gray-400">No groups yet. Click Create to add one.</p>
          )}
        </div>
      </div>

      {/* Create group modal */}
      {showCreate && (
        <Modal title="Create Group" onClose={() => setShowCreate(false)}>
          <form onSubmit={handleCreate} className="space-y-4">
            <Field label="Group name">
              <input
                required autoFocus data-testid="input-group-name"
                value={newGroupName}
                onChange={e => setNewGroupName(e.target.value)}
                placeholder="e.g. Marine Engineering"
                className="form-input"
              />
            </Field>
            <div className="flex justify-end gap-2 pt-1">
              <Button testId="button-cancel-group" variant="quiet" onClick={() => setShowCreate(false)}>Cancel</Button>
              <Button testId="button-submit-group" type="submit" disabled={busy}>{busy ? 'Creating…' : 'Create'}</Button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}

// ─── CurriculumTopicsPage ─────────────────────────────────────────────────────
type TopicItem = { id: string; name: string; color: string };
const TOPICS_SEED: TopicItem[] = [
  { id: 't1', name: 'BRM Phase 2 — 1 Apr to 15 Apr 2023',    color: 'from-blue-400 to-indigo-500' },
  { id: 't2', name: 'PSCRB 06 Sep 2021',                       color: 'from-teal-400 to-emerald-500' },
  { id: 't3', name: 'COLREG Navigation — Jan 2024',            color: 'from-violet-400 to-purple-600' },
  { id: 't4', name: 'ECDIS Passage Planning — Mar 2024',       color: 'from-amber-400 to-orange-500' },
];

const COURSE_OPTIONS = ['All', 'B.Tech Marine Engineering', 'Diploma Nautical Science', 'B.Sc. Maritime Studies'];
const LANGUAGE_OPTIONS = ['English', 'Hindi', 'Marathi'];

function CurriculumTopicsPage() {
  const [search, setSearch]           = useState('');
  const [userName, setUserName]       = useState('');
  const [course, setCourse]           = useState('All');
  const [group, setGroup]             = useState('');
  const [language, setLanguage]       = useState('English');
  const [checked, setChecked]         = useState<Set<string>>(new Set());
  const [topics, setTopics]           = useState<TopicItem[]>(TOPICS_SEED);

  const filtered = topics.filter(t => t.name.toLowerCase().includes(search.toLowerCase()));

  function toggleCheck(id: string) {
    setChecked(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }

  function handleDelete() {
    if (!checked.size) return;
    setTopics(t => t.filter(x => !checked.has(x.id)));
    setChecked(new Set());
  }

  const tbBtn = (label: string, icon: ReactNode, onClick?: () => void, disabled = false) => (
    <button type="button" onClick={onClick} disabled={disabled}
      className={cx('flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium border border-gray-200 rounded-lg transition-colors bg-white',
        disabled ? 'text-gray-300 cursor-not-allowed' : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900 shadow-xs')}>
      {icon}{label}
    </button>
  );

  const cardBtn = (label: string, icon: ReactNode, onClick?: () => void) => (
    <button type="button" onClick={onClick}
      className="flex items-center justify-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50 hover:text-gray-900 transition-colors shadow-xs">
      {icon}{label}
    </button>
  );

  return (
    <div className="-mx-5 -my-7 lg:-mx-10 lg:-my-9" style={{ background: '#eef1fb', minHeight: 'calc(100vh - 72px)' }}>
      <div className="p-8 lg:p-10 space-y-5">

        {/* Back link */}
        <Link href="/curriculum" className="inline-flex items-center gap-1.5 text-sm font-semibold text-gray-700 hover:text-gray-900 transition-colors">
          <ChevronLeft size={18} /> Show All Topics
        </Link>

        {/* Toolbar */}
        <div className="flex justify-end gap-2">
          {tbBtn('Create',  <Scissors size={13} />)}
          {tbBtn('Delete',  <Trash2   size={13} />, handleDelete, checked.size === 0)}
          {tbBtn('Import',  <Download size={13} />)}
        </div>

        {/* Filter bar */}
        <div className="rounded-xl bg-white border border-gray-100 shadow-xs p-5">
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-4">
            {/* Search */}
            <div>
              <p className="mb-1.5 text-xs font-semibold text-gray-500">Search</p>
              <div className="relative">
                <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                  value={search} onChange={e => setSearch(e.target.value)}
                  placeholder="Search by Name"
                  className="w-full rounded-lg border border-gray-200 bg-white pl-8 pr-3 py-2 text-sm text-gray-700 placeholder-gray-400 outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/40"
                />
              </div>
            </div>
            {/* Adaptive User Name */}
            <div>
              <p className="mb-1.5 text-xs font-semibold text-gray-500">Adaptive User Name</p>
              <input value={userName} onChange={e => setUserName(e.target.value)}
                placeholder="Type Here"
                className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700 placeholder-gray-400 outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/40"
              />
            </div>
            {/* Course */}
            <div>
              <p className="mb-1.5 text-xs font-semibold text-gray-500">Course</p>
              <select value={course} onChange={e => setCourse(e.target.value)}
                className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700 outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/40">
                {COURSE_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
              </select>
            </div>
            {/* Group */}
            <div>
              <p className="mb-1.5 text-xs font-semibold text-gray-500">Group</p>
              <input value={group} onChange={e => setGroup(e.target.value)}
                placeholder="Type Here"
                className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700 placeholder-gray-400 outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/40"
              />
            </div>
            {/* Language */}
            <div>
              <p className="mb-1.5 text-xs font-semibold text-gray-500">Language</p>
              <select value={language} onChange={e => setLanguage(e.target.value)}
                className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700 outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/40">
                {LANGUAGE_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
              </select>
            </div>
          </div>
        </div>

        {/* Topic cards */}
        <div className="space-y-4">
          {filtered.length === 0 && (
            <div className="rounded-xl bg-white border border-gray-100 p-10 text-center text-sm text-gray-400">No topics match your search.</div>
          )}
          {filtered.map(topic => (
            <div key={topic.id} className="relative rounded-xl bg-white border border-gray-100 shadow-xs flex items-stretch overflow-hidden">
              {/* Thumbnail */}
              <div className={cx('w-[160px] shrink-0 bg-gradient-to-br flex items-center justify-center', topic.color)}>
                <GraduationCap size={48} className="text-white/80" strokeWidth={1.2} />
              </div>

              {/* Name */}
              <div className="flex flex-1 items-center px-6">
                <span className="text-base font-semibold text-gray-800">{topic.name}</span>
              </div>

              {/* Actions */}
              <div className="flex flex-col justify-center gap-2 px-4 py-3 shrink-0">
                <div className="flex gap-2">
                  {cardBtn('Edit',   <Pencil  size={12} />)}
                  {cardBtn('Delete', <Trash2  size={12} />)}
                </div>
                <div className="flex gap-2">
                  {cardBtn('Set Faculty', <GraduationCap size={12} />)}
                  {cardBtn('Upload TOC',  <FileUp        size={12} />)}
                </div>
              </div>

              {/* Checkbox */}
              <div className="absolute top-3 right-3">
                <button type="button" onClick={() => toggleCheck(topic.id)}
                  className={cx('h-4 w-4 rounded border-2 flex items-center justify-center transition-colors',
                    checked.has(topic.id) ? 'bg-primary border-primary' : 'border-gray-300 bg-white hover:border-primary/50')}>
                  {checked.has(topic.id) && <Check size={10} className="text-white" strokeWidth={3} />}
                </button>
              </div>
            </div>
          ))}
        </div>

      </div>
    </div>
  );
}

// ─── CurriculumContentsPage ───────────────────────────────────────────────────
type ContentItem = { id: string; name: string; type: string; color: string; icon: typeof Video };
const CONTENTS_SEED: ContentItem[] = [
  { id: 'c1', name: 'Virtual Reality (VR) HIMT',          type: 'VR/AR',      color: 'from-slate-700 to-slate-900',   icon: Video },
  { id: 'c2', name: 'Augmented Reality (AR) HIMT',        type: 'VR/AR',      color: 'from-slate-600 to-slate-800',   icon: Video },
  { id: 'c3', name: 'Bridge Simulator — GMDSS Operations', type: 'Simulation', color: 'from-blue-700 to-blue-900',     icon: Video },
  { id: 'c4', name: 'Fire Fighting Training Video',        type: 'Video',      color: 'from-red-600 to-rose-800',      icon: Video },
  { id: 'c5', name: 'ECDIS Navigation Manual',             type: 'Document',   color: 'from-teal-600 to-teal-800',     icon: FileUp },
];
const RESOURCE_TYPES = ['All', 'Video', 'Document', 'SCORM', 'VR/AR', 'Simulation', 'PDF'];

function CurriculumContentsPage() {
  const [search, setSearch]       = useState('');
  const [resType, setResType]     = useState('All');
  const [course, setCourse]       = useState('All');
  const [group, setGroup]         = useState('');
  const [language, setLanguage]   = useState('English');
  const [checked, setChecked]     = useState<Set<string>>(new Set());
  const [contents, setContents]   = useState<ContentItem[]>(CONTENTS_SEED);

  const filtered = contents.filter(c =>
    c.name.toLowerCase().includes(search.toLowerCase()) &&
    (resType === 'All' || c.type === resType)
  );

  function toggleCheck(id: string) {
    setChecked(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }
  function handleDelete() {
    if (!checked.size) return;
    setContents(c => c.filter(x => !checked.has(x.id)));
    setChecked(new Set());
  }

  const tbBtn = (label: string, icon: ReactNode, onClick?: () => void, disabled = false) => (
    <button type="button" onClick={onClick} disabled={disabled}
      className={cx('flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium border border-gray-200 rounded-lg bg-white shadow-xs transition-colors',
        disabled ? 'text-gray-300 cursor-not-allowed' : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900')}>
      {icon}{label}
    </button>
  );

  const cardBtn = (label: string, icon: ReactNode, onClick?: () => void) => (
    <button type="button" onClick={onClick}
      className="flex items-center justify-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50 hover:text-gray-900 transition-colors shadow-xs">
      {icon}{label}
    </button>
  );

  return (
    <div className="-mx-5 -my-7 lg:-mx-10 lg:-my-9" style={{ background: '#eef1fb', minHeight: 'calc(100vh - 72px)' }}>
      <div className="p-8 lg:p-10 space-y-5">

        {/* Back link */}
        <Link href="/curriculum" className="inline-flex items-center gap-1.5 text-sm font-semibold text-gray-700 hover:text-gray-900 transition-colors">
          <ChevronLeft size={18} /> Show All Contents
        </Link>

        {/* Toolbar */}
        <div className="flex justify-end gap-2">
          {tbBtn('Create', <Scissors size={13} />)}
          {tbBtn('Delete', <Trash2   size={13} />, handleDelete, checked.size === 0)}
          {tbBtn('Import', <Download size={13} />)}
        </div>

        {/* Filter bar */}
        <div className="rounded-xl bg-white border border-gray-100 shadow-xs p-5">
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-4">
            <div>
              <p className="mb-1.5 text-xs font-semibold text-gray-500">Search</p>
              <div className="relative">
                <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
                <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search by Name"
                  className="w-full rounded-lg border border-gray-200 bg-white pl-8 pr-3 py-2 text-sm placeholder-gray-400 outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/40" />
              </div>
            </div>
            <div>
              <p className="mb-1.5 text-xs font-semibold text-gray-500">Resource Type</p>
              <select value={resType} onChange={e => setResType(e.target.value)}
                className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700 outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/40">
                {RESOURCE_TYPES.map(o => <option key={o} value={o}>{o}</option>)}
              </select>
            </div>
            <div>
              <p className="mb-1.5 text-xs font-semibold text-gray-500">Course</p>
              <select value={course} onChange={e => setCourse(e.target.value)}
                className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700 outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/40">
                {COURSE_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
              </select>
            </div>
            <div>
              <p className="mb-1.5 text-xs font-semibold text-gray-500">Group</p>
              <input value={group} onChange={e => setGroup(e.target.value)} placeholder="Type Here"
                className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm placeholder-gray-400 outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/40" />
            </div>
            <div>
              <p className="mb-1.5 text-xs font-semibold text-gray-500">Language</p>
              <select value={language} onChange={e => setLanguage(e.target.value)}
                className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700 outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/40">
                {LANGUAGE_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
              </select>
            </div>
          </div>
        </div>

        {/* Content cards */}
        <div className="space-y-4">
          {filtered.length === 0 && (
            <div className="rounded-xl bg-white border border-gray-100 p-10 text-center text-sm text-gray-400">No contents match your filters.</div>
          )}
          {filtered.map(item => (
            <div key={item.id} className="relative rounded-xl bg-white border border-gray-100 shadow-xs flex items-stretch overflow-hidden">
              {/* Thumbnail */}
              <div className={cx('w-[140px] shrink-0 bg-gradient-to-br flex items-center justify-center', item.color)}>
                <item.icon size={36} className="text-white/70" strokeWidth={1.2} />
              </div>
              {/* Name */}
              <div className="flex flex-1 items-center px-6">
                <div>
                  <span className="text-base font-semibold text-gray-800">{item.name}</span>
                  <span className="ml-3 rounded-md bg-gray-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-gray-500">{item.type}</span>
                </div>
              </div>
              {/* Actions */}
              <div className="flex items-center gap-2 px-5 shrink-0">
                {cardBtn('Preview', <Eye    size={12} />)}
                {cardBtn('Edit',    <Pencil size={12} />)}
                {cardBtn('Delete',  <Trash2 size={12} />)}
              </div>
              {/* Checkbox */}
              <div className="absolute top-3 right-3">
                <button type="button" onClick={() => toggleCheck(item.id)}
                  className={cx('h-4 w-4 rounded border-2 flex items-center justify-center transition-colors',
                    checked.has(item.id) ? 'bg-primary border-primary' : 'border-gray-300 bg-white hover:border-primary/50')}>
                  {checked.has(item.id) && <Check size={10} className="text-white" strokeWidth={3} />}
                </button>
              </div>
            </div>
          ))}
        </div>

      </div>
    </div>
  );
}

// ─── CurriculumTagsPage ───────────────────────────────────────────────────────
function CurriculumTagsPage() {
  type Tag = { id: string; name: string };
  const { data: tags, loading: tagsLoading, refetch: refetchTags } = useApi<Tag[]>('/curriculum/tags');
  const [query, setQuery]         = useState('');
  const [applied, setApplied]     = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [newTag, setNewTag]       = useState('');

  const displayed = (tags ?? []).filter(t => t.name.toLowerCase().includes(applied.toLowerCase()));

  function handleGo()   { setApplied(query); }
  function handleReset(){ setQuery(''); setApplied(''); refetchTags(); }
  async function handleDeleteTag(id: string) {
    await apiFetch(`/curriculum/tags/${id}`, 'DELETE');
    refetchTags();
  }
  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    const trimmed = newTag.trim();
    if (!trimmed) return;
    await apiFetch('/curriculum/tags', 'POST', { name: trimmed });
    setNewTag(''); setShowCreate(false); refetchTags();
  }

  return (
    <div className="-mx-5 -my-7 lg:-mx-10 lg:-my-9" style={{ background: '#eef1fb', minHeight: 'calc(100vh - 72px)' }}>
      <div className="p-8 lg:p-10 space-y-5">

        {/* Back link */}
        <Link href="/curriculum" className="inline-flex items-center gap-1.5 text-sm font-semibold text-gray-700 hover:text-gray-900 transition-colors">
          <ChevronLeft size={18} /> Tags
        </Link>

        {/* Toolbar */}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={() => setShowCreate(true)}
            className="flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium border border-gray-200 rounded-lg bg-white shadow-xs text-gray-600 hover:bg-gray-50 hover:text-gray-900 transition-colors">
            <Scissors size={13} /> Create
          </button>
          <button type="button"
            className="flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium border border-gray-200 rounded-lg bg-white shadow-xs text-gray-600 hover:bg-gray-50 hover:text-gray-900 transition-colors">
            <Download size={13} /> Import
          </button>
        </div>

        {/* Search card */}
        <div className="rounded-xl bg-white border border-gray-100 shadow-xs p-5">
          <div className="flex items-center gap-3">
            <div className="relative flex-1 max-w-xs">
              <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                value={query}
                onChange={e => setQuery(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleGo()}
                placeholder="Search by Tag Name"
                className="w-full rounded-lg border border-gray-200 bg-white pl-8 pr-3 py-2 text-sm placeholder-gray-400 outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/40"
              />
            </div>
            <button type="button" onClick={handleGo}
              className="rounded-lg bg-primary px-5 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90 transition-colors">
              Go
            </button>
            <button type="button" onClick={handleReset}
              className="rounded-lg border border-gray-200 bg-white px-5 py-2 text-sm font-semibold text-gray-600 hover:bg-gray-50 transition-colors">
              Reset
            </button>
          </div>

          {/* Table */}
          <div className="mt-5">
            <div className="grid grid-cols-[1fr_80px] border-b border-primary/20 pb-2 mb-1">
              <span className="text-xs font-bold text-primary uppercase tracking-wide px-1">Tags Name</span>
              <span className="text-xs font-bold text-primary uppercase tracking-wide text-right px-1">Actions</span>
            </div>
            {displayed.length === 0 && (
              <p className="py-8 text-center text-sm text-gray-400">No tags match your search.</p>
            )}
            {displayed.map((tag, i) => (
              <div key={tag.id} className={cx('grid grid-cols-[1fr_80px] items-center py-2.5 px-1', i < displayed.length - 1 && 'border-b border-gray-100')}>
                <span className="text-sm text-gray-700">{tag.name}</span>
                <div className="flex items-center justify-end gap-2">
                  <button type="button" title="Edit" className="text-gray-400 hover:text-primary transition-colors">
                    <Pencil size={15} />
                  </button>
                  <button type="button" title="Delete" onClick={() => handleDeleteTag(tag.id)} className="text-gray-400 hover:text-destructive transition-colors">
                    <Trash2 size={15} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>

      </div>

      {/* Create tag modal */}
      {showCreate && (
        <Modal title="Create Tag" onClose={() => setShowCreate(false)}>
          <form onSubmit={handleCreate} className="space-y-4">
            <Field label="Tag name">
              <input required autoFocus data-testid="input-tag-name"
                value={newTag} onChange={e => setNewTag(e.target.value)}
                placeholder="e.g. STCW Training"
                className="form-input" />
            </Field>
            <div className="flex justify-end gap-2 pt-1">
              <Button testId="button-cancel-tag" variant="quiet" onClick={() => setShowCreate(false)}>Cancel</Button>
              <Button testId="button-submit-tag" type="submit">Create</Button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}

// ─── CurriculumGlossaryPage ───────────────────────────────────────────────────
function CurriculumGlossaryPage() {
  type Term = { id: string; title: string; definition?: string };
  const { data: terms, loading: termsLoading, refetch: refetchTerms } = useApi<Term[]>('/curriculum/glossary');
  const [query, setQuery]         = useState('');
  const [applied, setApplied]     = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm]           = useState({ title: '', definition: '' });

  const displayed = (terms ?? []).filter(t => t.title.toLowerCase().includes(applied.toLowerCase()));

  function handleGo()    { setApplied(query); }
  function handleReset() { setQuery(''); setApplied(''); refetchTerms(); }
  async function handleDelete(id: string) {
    await apiFetch(`/curriculum/glossary/${id}`, 'DELETE');
    refetchTerms();
  }
  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    if (!form.title.trim()) return;
    await apiFetch('/curriculum/glossary', 'POST', { title: form.title.trim(), definition: form.definition.trim() });
    setForm({ title: '', definition: '' }); setShowCreate(false); refetchTerms();
  }

  const filledBtn = (label: string, onClick: () => void) => (
    <button type="button" onClick={onClick}
      className="rounded-lg bg-primary px-5 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90 transition-colors">
      {label}
    </button>
  );

  return (
    <div className="-mx-5 -my-7 lg:-mx-10 lg:-my-9" style={{ background: '#eef1fb', minHeight: 'calc(100vh - 72px)' }}>
      <div className="p-8 lg:p-10 space-y-5">

        {/* Back link */}
        <Link href="/curriculum" className="inline-flex items-center gap-1.5 text-sm font-semibold text-gray-700 hover:text-gray-900 transition-colors">
          <ChevronLeft size={18} /> Term
        </Link>

        {/* Toolbar */}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={() => setShowCreate(true)}
            className="flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium border border-gray-200 rounded-lg bg-white shadow-xs text-gray-600 hover:bg-gray-50 hover:text-gray-900 transition-colors">
            <Scissors size={13} /> Create
          </button>
          <button type="button"
            className="flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium border border-gray-200 rounded-lg bg-white shadow-xs text-gray-600 hover:bg-gray-50 hover:text-gray-900 transition-colors">
            <Download size={13} /> Import
          </button>
        </div>

        {/* Search card */}
        <div className="rounded-xl bg-white border border-gray-100 shadow-xs p-5">
          <div className="flex items-center gap-3">
            <div className="relative flex-1 max-w-xs">
              <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
              <input value={query} onChange={e => setQuery(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleGo()}
                placeholder="Search by Term Title"
                className="w-full rounded-lg border border-gray-200 bg-white pl-8 pr-3 py-2 text-sm placeholder-gray-400 outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/40" />
            </div>
            {filledBtn('Go', handleGo)}
            {filledBtn('Reset', handleReset)}
          </div>

          {/* Table */}
          <div className="mt-5">
            <div className="grid grid-cols-[1fr_80px] border-b border-primary/20 pb-2 mb-1">
              <span className="text-xs font-bold text-primary uppercase tracking-wide px-1">Term Title</span>
              <span className="text-xs font-bold text-primary uppercase tracking-wide text-right px-1">Actions</span>
            </div>
            {displayed.length === 0 && (
              <p className="py-8 text-center text-sm text-gray-400">No terms match your search.</p>
            )}
            {displayed.map((term, i) => (
              <div key={term.id} className={cx('grid grid-cols-[1fr_80px] items-center py-2.5 px-1', i < displayed.length - 1 && 'border-b border-gray-100')}>
                <div>
                  <span className="text-sm text-gray-700">{term.title}</span>
                  {term.definition && <p className="text-xs text-gray-400 mt-0.5 truncate max-w-xl">{term.definition}</p>}
                </div>
                <div className="flex items-center justify-end gap-2">
                  <button type="button" title="Edit" className="text-gray-400 hover:text-primary transition-colors"><Pencil size={15} /></button>
                  <button type="button" title="Delete" onClick={() => handleDelete(term.id)} className="text-gray-400 hover:text-destructive transition-colors"><Trash2 size={15} /></button>
                </div>
              </div>
            ))}
          </div>
        </div>

      </div>

      {/* Create term modal */}
      {showCreate && (
        <Modal title="Create Term" onClose={() => setShowCreate(false)}>
          <form onSubmit={handleCreate} className="space-y-4">
            <Field label="Term title">
              <input required autoFocus data-testid="input-term-title"
                value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
                placeholder="e.g. COLREG" className="form-input" />
            </Field>
            <Field label="Definition">
              <textarea data-testid="input-term-definition" rows={3}
                value={form.definition} onChange={e => setForm(f => ({ ...f, definition: e.target.value }))}
                placeholder="Full definition of the term…" className="form-input h-auto py-2.5 resize-none" />
            </Field>
            <div className="flex justify-end gap-2 pt-1">
              <Button testId="button-cancel-term" variant="quiet" onClick={() => setShowCreate(false)}>Cancel</Button>
              <Button testId="button-submit-term" type="submit">Create</Button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}

// ─── CurriculumUploadStatusPage ───────────────────────────────────────────────
type UploadRecord = {
  id: string; video: string; createdAt?: string; updatedAt?: string;
  uploadStatus: string; transcodeStatus: string; type: string; uploadedBy: string;
};
const UPLOAD_STATUSES    = ['All', 'Completed', 'Processing', 'Failed', 'Pending'] as const;
const TRANSCODE_STATUSES = ['All', 'Completed', 'Processing', 'Failed', 'Pending'] as const;
const UPLOAD_TYPES       = ['All', 'Video', 'Document', 'SCORM', 'VR/AR', 'Simulation'];
const UPLOAD_USERS       = ['All', 'Admin', 'Faculty'];

function uploadStatusTone(s: string) {
  if (s === 'Completed') return 'text-emerald-600';
  if (s === 'Processing') return 'text-amber-600';
  if (s === 'Failed')    return 'text-red-600';
  return 'text-gray-400';
}

function CurriculumUploadStatusPage() {
  const [uploadStatus,     setUploadStatus]     = useState('All');
  const [transcodeStatus,  setTranscodeStatus]  = useState('All');
  const [type,             setType]             = useState('All');
  const [user,             setUser]             = useState('All');
  const [search,           setSearch]           = useState('');
  const [queryString,      setQueryString]      = useState('');

  const { data: rows, loading: rowsLoading, refetch: refetchRows } = useApi<UploadRecord[]>(`/curriculum/upload-status${queryString}`, [queryString]);

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const params = new URLSearchParams();
    if (uploadStatus !== 'All')    params.set('uploadStatus', uploadStatus);
    if (transcodeStatus !== 'All') params.set('transcodeStatus', transcodeStatus);
    if (type !== 'All')            params.set('type', type);
    if (user !== 'All')            params.set('user', user);
    if (search)                    params.set('search', search);
    setQueryString(params.toString() ? `?${params}` : '');
  }

  const selClass = "rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700 outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/40";

  return (
    <div className="-mx-5 -my-7 lg:-mx-10 lg:-my-9" style={{ background: '#eef1fb', minHeight: 'calc(100vh - 72px)' }}>
      <div className="p-8 lg:p-10 space-y-5">

        {/* Back link */}
        <Link href="/curriculum" className="inline-flex items-center gap-1.5 text-sm font-semibold text-gray-700 hover:text-gray-900 transition-colors">
          <ChevronLeft size={18} /> Content Upload/Transcode Status
        </Link>

        {/* Filter card */}
        <form onSubmit={handleSubmit} className="rounded-xl bg-white border border-gray-100 shadow-xs p-5">
          <div className="flex flex-wrap items-end gap-4">
            <div>
              <p className="mb-1.5 text-xs font-semibold text-gray-600">Upload Status</p>
              <select value={uploadStatus} onChange={e => setUploadStatus(e.target.value)} className={selClass}>
                {UPLOAD_STATUSES.map(s => <option key={s}>{s}</option>)}
              </select>
            </div>
            <div>
              <p className="mb-1.5 text-xs font-semibold text-gray-600">Transcode Status</p>
              <select value={transcodeStatus} onChange={e => setTranscodeStatus(e.target.value)} className={selClass}>
                {TRANSCODE_STATUSES.map(s => <option key={s}>{s}</option>)}
              </select>
            </div>
            <div>
              <p className="mb-1.5 text-xs font-semibold text-gray-600">Type</p>
              <select value={type} onChange={e => setType(e.target.value)} className={selClass}>
                {UPLOAD_TYPES.map(s => <option key={s}>{s}</option>)}
              </select>
            </div>
            <div>
              <p className="mb-1.5 text-xs font-semibold text-gray-600">User</p>
              <select value={user} onChange={e => setUser(e.target.value)} className={selClass}>
                {UPLOAD_USERS.map(s => <option key={s}>{s}</option>)}
              </select>
            </div>
            <div className="flex-1 min-w-[160px]">
              <p className="mb-1.5 text-xs font-semibold text-gray-600 invisible">Search</p>
              <div className="relative">
                <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
                <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Type Here"
                  className="w-full rounded-lg border border-gray-200 bg-white pl-8 pr-3 py-2 text-sm placeholder-gray-400 outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/40" />
              </div>
            </div>
            <button type="submit"
              className="rounded-lg bg-primary px-6 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90 transition-colors shrink-0">
              Submit
            </button>
          </div>
        </form>

        {/* Table */}
        <div className="rounded-xl bg-white border border-gray-100 shadow-xs overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-primary/15">
                <th className="px-5 py-3.5 text-left text-xs font-bold text-primary">Video</th>
                <th className="px-4 py-3.5 text-left text-xs font-bold text-primary">Created Date</th>
                <th className="px-4 py-3.5 text-left text-xs font-bold text-primary">Updated Date</th>
                <th className="px-4 py-3.5 text-left text-xs font-bold text-primary">Upload Status</th>
                <th className="px-4 py-3.5 text-left text-xs font-bold text-primary">Transcode Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {rowsLoading && (
                <tr><td colSpan={5} className="px-5 py-10 text-center text-sm text-gray-400">Loading…</td></tr>
              )}
              {!rowsLoading && (rows ?? []).length === 0 && (
                <tr><td colSpan={5} className="px-5 py-10 text-center text-sm text-gray-400">No records match your filters.</td></tr>
              )}
              {(rows ?? []).map(r => (
                <tr key={r.id} className="hover:bg-gray-50">
                  <td className="px-5 py-3 text-gray-700">{r.video}</td>
                  <td className="px-4 py-3 text-gray-500 whitespace-nowrap">{formatUploadDate(r.createdAt)}</td>
                  <td className="px-4 py-3 text-gray-500 whitespace-nowrap">{formatUploadDate(r.updatedAt)}</td>
                  <td className={cx('px-4 py-3 font-medium', uploadStatusTone(r.uploadStatus))}>{r.uploadStatus}</td>
                  <td className={cx('px-4 py-3 font-medium', uploadStatusTone(r.transcodeStatus))}>{r.transcodeStatus}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

      </div>
    </div>
  );
}

// ─── CurriculumOthersPage (FAQ Categories) ────────────────────────────────────
function CurriculumOthersPage() {
  type FaqCategory = { id: string; name: string };
  const { data: categories, loading: catsLoading, refetch: refetchCats } = useApi<FaqCategory[]>('/curriculum/faq-categories');
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName]       = useState('');

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    if (!newName.trim()) return;
    await apiFetch('/curriculum/faq-categories', 'POST', { name: newName.trim() });
    setNewName(''); setShowCreate(false); refetchCats();
  }

  const cats = categories ?? [];

  return (
    <div className="-mx-5 -my-7 lg:-mx-10 lg:-my-9" style={{ background: '#eef1fb', minHeight: 'calc(100vh - 72px)' }}>
      <div className="p-8 lg:p-10">

        {/* Back link + toolbar row */}
        <div className="flex items-center justify-between mb-8">
          <Link href="/curriculum" className="inline-flex items-center gap-1.5 text-sm font-semibold text-gray-700 hover:text-gray-900 transition-colors">
            <ChevronLeft size={18} /> FAQ Categories
          </Link>
          <button type="button" onClick={() => setShowCreate(true)}
            className="flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium border border-gray-200 rounded-lg bg-white shadow-xs text-gray-600 hover:bg-gray-50 hover:text-gray-900 transition-colors">
            <Scissors size={13} /> Create
          </button>
        </div>

        {/* Content */}
        {catsLoading ? (
          <div className="flex items-center justify-center" style={{ minHeight: '40vh' }}>
            <p className="text-sm text-gray-400">Loading…</p>
          </div>
        ) : cats.length === 0 ? (
          <div className="flex items-center justify-center" style={{ minHeight: '40vh' }}>
            <p className="text-sm text-gray-500">No data to display</p>
          </div>
        ) : (
          <div className="rounded-xl bg-white border border-gray-100 shadow-xs overflow-hidden">
            <div className="grid grid-cols-[1fr_80px] border-b border-primary/15 px-5 py-3">
              <span className="text-xs font-bold text-primary uppercase tracking-wide">Category Name</span>
              <span className="text-xs font-bold text-primary uppercase tracking-wide text-right">Actions</span>
            </div>
            {cats.map((cat, i) => (
              <div key={cat.id} className={cx('grid grid-cols-[1fr_80px] items-center px-5 py-3', i < cats.length - 1 && 'border-b border-gray-100')}>
                <span className="text-sm text-gray-700">{cat.name}</span>
                <div className="flex items-center justify-end gap-2">
                  <button type="button" title="Edit"   className="text-gray-400 hover:text-primary transition-colors"><Pencil size={15} /></button>
                  <button type="button" title="Delete" onClick={async () => { await apiFetch(`/curriculum/faq-categories/${cat.id}`, 'DELETE'); refetchCats(); }} className="text-gray-400 hover:text-destructive transition-colors"><Trash2 size={15} /></button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {showCreate && (
        <Modal title="Create FAQ Category" onClose={() => setShowCreate(false)}>
          <form onSubmit={handleCreate} className="space-y-4">
            <Field label="Category name">
              <input required autoFocus data-testid="input-faq-category"
                value={newName} onChange={e => setNewName(e.target.value)}
                placeholder="e.g. Course Enrollment" className="form-input" />
            </Field>
            <div className="flex justify-end gap-2 pt-1">
              <Button testId="button-cancel-faq" variant="quiet" onClick={() => setShowCreate(false)}>Cancel</Button>
              <Button testId="button-submit-faq" type="submit">Create</Button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}

// ─── SettingsPage ─────────────────────────────────────────────────────────────

function SettingsPage() {
  const { toast } = useToast();

  // TriByte credentials
  const [tbStatus, setTbStatus] = useState<{ configured: boolean; source: string | null; username: string | null } | null>(null);
  const [tbLoading, setTbLoading] = useState(true);
  const [tbUsername, setTbUsername] = useState('');
  const [tbPassword, setTbPassword] = useState('');
  const [tbSaving, setTbSaving] = useState(false);
  const [tbTesting, setTbTesting] = useState(false);
  const [tbTestResult, setTbTestResult] = useState<{ ok: boolean; message: string } | null>(null);

  // Admin auth state
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);
  const [showLogin, setShowLogin] = useState(false);
  const [loginUser, setLoginUser] = useState('');
  const [loginPass, setLoginPass] = useState('');
  const [loginBusy, setLoginBusy] = useState(false);
  const [loginError, setLoginError] = useState('');

  useEffect(() => {
    apiFetch<{ isAdmin: boolean }>('/auth/status')
      .then(r => {
        setIsAdmin(r.isAdmin);
        if (r.isAdmin) loadTbStatus();
      })
      .catch(() => setIsAdmin(false));
  }, []);

  async function loadTbStatus() {
    setTbLoading(true);
    try {
      const s = await apiFetch<{ configured: boolean; source: string | null; username: string | null }>('/tribyte/credentials');
      setTbStatus(s);
      if (s.username) setTbUsername(s.username);
    } catch { /* 401 expected if not admin */ }
    finally { setTbLoading(false); }
  }

  async function handleAdminLogin(e: FormEvent) {
    e.preventDefault();
    setLoginBusy(true); setLoginError('');
    try {
      await apiFetch('/auth/login', 'POST', { username: loginUser, password: loginPass });
      setIsAdmin(true); setShowLogin(false); setLoginUser(''); setLoginPass('');
      loadTbStatus();
    } catch (err) {
      setLoginError(String(err).replace(/^Error:\s*/, ''));
    } finally { setLoginBusy(false); }
  }

  async function handleSave(e: FormEvent) {
    e.preventDefault();
    if (!tbUsername.trim() || !tbPassword.trim()) {
      toast({ title: 'Missing fields', description: 'Enter both username and password.', variant: 'destructive' });
      return;
    }
    setTbSaving(true); setTbTestResult(null);
    try {
      await apiFetch('/tribyte/credentials', 'PUT', { username: tbUsername.trim(), password: tbPassword.trim() });
      toast({ title: 'Credentials saved', description: 'TriByte credentials stored. The next import will log in automatically.' });
      setTbPassword('');
      await loadTbStatus();
    } catch (err) {
      toast({ title: 'Save failed', description: String(err).replace(/^Error:\s*/, ''), variant: 'destructive' });
    } finally { setTbSaving(false); }
  }

  async function handleTest() {
    setTbTesting(true); setTbTestResult(null);
    try {
      const body = tbUsername.trim() && tbPassword.trim()
        ? { username: tbUsername.trim(), password: tbPassword.trim() }
        : {};
      const r = await apiFetch<{ ok: boolean; strategy?: string; error?: string }>('/tribyte/credentials/test', 'POST', body);
      if (r.ok) {
        setTbTestResult({ ok: true, message: `Connected successfully (via ${r.strategy ?? 'stored credentials'})` });
      } else {
        setTbTestResult({ ok: false, message: r.error ?? 'Connection test failed' });
      }
    } catch (err) {
      setTbTestResult({ ok: false, message: String(err).replace(/^Error:\s*/, '') });
    } finally { setTbTesting(false); }
  }

  async function handleDelete() {
    if (!confirm('Remove stored TriByte credentials?')) return;
    try {
      await apiFetch('/tribyte/credentials', 'DELETE');
      toast({ title: 'Credentials removed' });
      setTbUsername(''); setTbPassword(''); setTbTestResult(null);
      await loadTbStatus();
    } catch (err) {
      toast({ title: 'Failed to remove', description: String(err).replace(/^Error:\s*/, ''), variant: 'destructive' });
    }
  }

  const isEnvSource = tbStatus?.source === 'env_session' || tbStatus?.source === 'env_userpass';

  return (
    <div className="max-w-2xl space-y-8">
      <div>
        <h1 className="text-2xl font-bold">Settings</h1>
        <p className="mt-1 text-sm text-muted-foreground">System configuration for HIMT LMS administrators.</p>
      </div>

      {/* ── TriByte Connection ── */}
      <section className="rounded-xl border border-border bg-card p-6 space-y-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-base font-semibold">TriByte Connection</h2>
            <p className="mt-0.5 text-sm text-muted-foreground">
              Store your TriByte admin credentials once so the &ldquo;Import from TriByte&rdquo; button on Course
              Structure pages works without manual cookie setup.
            </p>
          </div>
          {tbStatus && (
            <span className={cx('shrink-0 rounded-full px-2.5 py-0.5 text-[11px] font-semibold', tbStatus.configured ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700')}>
              {tbStatus.configured ? 'Connected' : 'Not configured'}
            </span>
          )}
        </div>

        {isAdmin === false && !showLogin && (
          <div className="rounded-lg bg-muted/60 p-4 text-sm text-muted-foreground flex items-center gap-3">
            <LockKeyhole size={16} className="shrink-0" />
            <span>Admin login required to manage credentials.</span>
            <Button testId="button-settings-admin-login" variant="outline" onClick={() => setShowLogin(true)}>Log in</Button>
          </div>
        )}

        {isAdmin === true && (
          <>
            {tbLoading ? (
              <p className="text-sm text-muted-foreground animate-pulse">Loading…</p>
            ) : (
              <>
                {isEnvSource && (
                  <div className="rounded-lg border border-border bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
                    <span className="font-semibold text-foreground">Using environment variable credentials.</span>{' '}
                    {tbStatus?.source === 'env_userpass'
                      ? `Username: ${tbStatus.username}. These are set in Replit Secrets (TRIBYTE_USERNAME / TRIBYTE_PASSWORD) and take precedence over DB-stored credentials.`
                      : 'A TRIBYTE_SESSION cookie is set in Replit Secrets. It takes precedence over DB-stored credentials.'}
                  </div>
                )}

                {!isEnvSource && (
                  <form onSubmit={handleSave} className="space-y-4">
                    <Field label="TriByte username">
                      <input
                        data-testid="input-tribyte-username"
                        value={tbUsername}
                        onChange={e => setTbUsername(e.target.value)}
                        placeholder="admin@himtelearning.com"
                        autoComplete="username"
                        className="form-input"
                      />
                    </Field>
                    <Field label="Password">
                      <input
                        type="password"
                        data-testid="input-tribyte-password"
                        value={tbPassword}
                        onChange={e => setTbPassword(e.target.value)}
                        placeholder="••••••••"
                        autoComplete="current-password"
                        className="form-input"
                      />
                    </Field>

                    {tbTestResult && (
                      <div className={cx('rounded-lg p-3 text-sm font-medium', tbTestResult.ok ? 'bg-emerald-50 text-emerald-700' : 'bg-destructive/10 text-destructive')}>
                        {tbTestResult.ok ? '✓ ' : '✗ '}{tbTestResult.message}
                      </div>
                    )}

                    <div className="flex items-center gap-2 pt-1">
                      <Button testId="button-save-tribyte-creds" type="submit" disabled={tbSaving}>
                        {tbSaving ? 'Saving…' : 'Save credentials'}
                      </Button>
                      <Button testId="button-test-tribyte-creds" variant="outline" type="button" onClick={handleTest} disabled={tbTesting}>
                        {tbTesting ? 'Testing…' : 'Test connection'}
                      </Button>
                      {tbStatus?.configured && (
                        <Button testId="button-remove-tribyte-creds" variant="quiet" type="button" onClick={handleDelete}>Remove</Button>
                      )}
                    </div>
                  </form>
                )}
              </>
            )}
          </>
        )}
      </section>

      {/* Admin login modal */}
      {showLogin && (
        <Modal title="Admin login required" onClose={() => setShowLogin(false)}>
          <p className="mb-4 text-sm text-muted-foreground">Enter your HIMT admin credentials to manage settings.</p>
          <form onSubmit={handleAdminLogin} className="space-y-4">
            <Field label="Username">
              <input required data-testid="input-settings-admin-username" value={loginUser} onChange={e => setLoginUser(e.target.value)} className="form-input" placeholder="admin username" />
            </Field>
            <Field label="Password">
              <input required type="password" data-testid="input-settings-admin-password" value={loginPass} onChange={e => setLoginPass(e.target.value)} className="form-input" placeholder="••••••••" />
            </Field>
            {loginError && <p className="rounded-lg bg-destructive/10 p-3 text-sm font-semibold text-destructive">{loginError}</p>}
            <div className="flex justify-end gap-2 pt-2">
              <Button testId="button-cancel-settings-login" variant="quiet" type="button" onClick={() => setShowLogin(false)}>Cancel</Button>
              <Button testId="button-submit-settings-login" type="submit" disabled={loginBusy}>{loginBusy ? 'Logging in…' : 'Log in'}</Button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}

// ─── Access Logs Page ─────────────────────────────────────────────────────────
type AccessLog = {
  id: string; userId: string | null; resourceId: string; courseId: string;
  action: string; sessionId: string | null; userAgent: string | null;
  ipAddress: string | null; outcomeDetail: string | null; createdAt: string;
  resourceTitle: string | null; resourceType: string | null; courseTitle: string | null;
};
type AccessLogsResponse = { logs: AccessLog[]; total: number; page: number; limit: number };

const ACTION_LABELS: Record<string, { label: string; cls: string }> = {
  view_success: { label: 'Success',  cls: 'bg-emerald-100 text-emerald-700' },
  view_denied:  { label: 'Denied',   cls: 'bg-red-100 text-red-700' },
  view_error:   { label: 'Error',    cls: 'bg-orange-100 text-orange-700' },
  view_attempt: { label: 'Attempt',  cls: 'bg-gray-100 text-gray-600' },
};

function AccessLogsPage() {
  const [userId,   setUserId]   = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo,   setDateTo]   = useState('');
  const [outcome,  setOutcome]  = useState('');
  const [page,     setPage]     = useState(1);
  const [committed, setCommitted] = useState({ userId: '', dateFrom: '', dateTo: '', outcome: '' });

  const [data,    setData]    = useState<AccessLogsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState('');

  const load = useCallback((filters: typeof committed, pg: number) => {
    setLoading(true); setError('');
    const p = new URLSearchParams({ page: String(pg), limit: '50' });
    if (filters.userId)   p.set('userId',   filters.userId);
    if (filters.dateFrom) p.set('dateFrom', filters.dateFrom);
    if (filters.dateTo)   p.set('dateTo',   filters.dateTo);
    if (filters.outcome)  p.set('outcome',  filters.outcome);
    apiFetch<AccessLogsResponse>(`/curriculum/access-logs?${p}`)
      .then(d => { setData(d); setLoading(false); })
      .catch(e => { setError(String(e)); setLoading(false); });
  }, []);

  useEffect(() => { load(committed, page); }, [load, committed, page]);

  function applyFilters() {
    const next = { userId, dateFrom, dateTo, outcome };
    setCommitted(next); setPage(1);
  }
  function clearFilters() {
    setUserId(''); setDateFrom(''); setDateTo(''); setOutcome('');
    setCommitted({ userId: '', dateFrom: '', dateTo: '', outcome: '' }); setPage(1);
  }

  const totalPages = data ? Math.ceil(data.total / 50) : 1;
  const inputCls = 'rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm text-foreground placeholder-muted-foreground outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/40';

  return (
    <div className="space-y-7">
      <PageHeading eyebrow="Admin" title="Content Access Logs"
        description="Every protected document and video request — success, denial, and error — logged for compliance audit (DRM-007)." />

      {/* Filters */}
      <div className="rounded-xl border border-border bg-card p-5 shadow-xs">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-5">
          <div className="xl:col-span-2">
            <label className="mb-1.5 block text-xs font-semibold text-muted-foreground">User ID</label>
            <input value={userId} onChange={e => setUserId(e.target.value)}
              placeholder="Clerk user ID or partial…" className={cx(inputCls, 'w-full')} />
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-semibold text-muted-foreground">From</label>
            <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className={cx(inputCls, 'w-full')} />
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-semibold text-muted-foreground">To</label>
            <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} className={cx(inputCls, 'w-full')} />
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-semibold text-muted-foreground">Outcome</label>
            <select value={outcome} onChange={e => setOutcome(e.target.value)} className={cx(inputCls, 'w-full')}>
              <option value="">All outcomes</option>
              <option value="view_success">Success</option>
              <option value="view_denied">Denied</option>
              <option value="view_error">Error</option>
              <option value="view_attempt">Attempt</option>
            </select>
          </div>
        </div>
        <div className="mt-4 flex gap-2">
          <button onClick={applyFilters} className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2 text-sm font-bold text-primary-foreground shadow-sm hover:opacity-90">
            <Filter size={14} /> Apply
          </button>
          <button onClick={clearFilters} className="inline-flex items-center gap-2 rounded-xl border border-border bg-card px-4 py-2 text-sm font-bold text-foreground hover:bg-muted">
            <X size={14} /> Clear
          </button>
          <button onClick={() => load(committed, page)} className="ml-auto inline-flex items-center gap-2 rounded-xl border border-border bg-card px-3 py-2 text-sm font-bold text-muted-foreground hover:bg-muted">
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Refresh
          </button>
        </div>
      </div>

      {/* Table */}
      <div className="rounded-xl border border-border bg-card shadow-xs overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <span className="text-sm font-semibold text-foreground">
            {data ? `${data.total.toLocaleString()} log entries` : 'Loading…'}
          </span>
          {data && totalPages > 1 && (
            <span className="text-xs text-muted-foreground">Page {page} of {totalPages}</span>
          )}
        </div>

        {error && (
          <div className="px-4 py-3 text-sm text-destructive flex items-center gap-2">
            <CircleAlert size={16} /> {error}
            <button onClick={() => load(committed, page)} className="ml-2 underline">Retry</button>
          </div>
        )}

        {!error && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/30 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  <th className="px-4 py-3 whitespace-nowrap">Timestamp</th>
                  <th className="px-4 py-3">Outcome</th>
                  <th className="px-4 py-3">Resource</th>
                  <th className="px-4 py-3">Course</th>
                  <th className="px-4 py-3">User</th>
                  <th className="px-4 py-3">IP</th>
                  <th className="px-4 py-3">Detail</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {loading && !data?.logs.length && (
                  <tr><td colSpan={7} className="px-4 py-8 text-center text-muted-foreground"><RefreshCw size={18} className="inline animate-spin mr-2" />Loading…</td></tr>
                )}
                {!loading && data?.logs.length === 0 && (
                  <tr><td colSpan={7} className="px-4 py-12 text-center text-muted-foreground">No log entries match the current filters.</td></tr>
                )}
                {data?.logs.map(log => {
                  const act = ACTION_LABELS[log.action] ?? { label: log.action, cls: 'bg-gray-100 text-gray-600' };
                  const ts  = new Date(log.createdAt);
                  const tsStr = `${ts.getDate().toString().padStart(2,'0')}/${(ts.getMonth()+1).toString().padStart(2,'0')}/${ts.getFullYear()} ${ts.getHours().toString().padStart(2,'0')}:${ts.getMinutes().toString().padStart(2,'0')}:${ts.getSeconds().toString().padStart(2,'0')}`;
                  return (
                    <tr key={log.id} className="hover:bg-muted/20 transition-colors">
                      <td className="px-4 py-3 font-mono text-xs text-muted-foreground whitespace-nowrap">{tsStr}</td>
                      <td className="px-4 py-3">
                        <span className={cx('inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wider', act.cls)}>{act.label}</span>
                      </td>
                      <td className="px-4 py-3 max-w-[200px]">
                        <p className="font-medium text-foreground truncate">{log.resourceTitle ?? log.resourceId}</p>
                        {log.resourceType && <p className="text-[11px] text-muted-foreground">{log.resourceType}</p>}
                      </td>
                      <td className="px-4 py-3 max-w-[160px]">
                        <p className="text-foreground truncate">{log.courseTitle ?? log.courseId}</p>
                      </td>
                      <td className="px-4 py-3 font-mono text-xs text-muted-foreground max-w-[180px]">
                        <p className="truncate" title={log.userId ?? 'admin-session'}>{log.userId ?? <span className="italic text-muted-foreground/60">admin</span>}</p>
                      </td>
                      <td className="px-4 py-3 font-mono text-xs text-muted-foreground whitespace-nowrap">{log.ipAddress ?? '—'}</td>
                      <td className="px-4 py-3 text-xs text-muted-foreground max-w-[200px]">
                        <p className="truncate" title={log.outcomeDetail ?? ''}>{log.outcomeDetail ?? '—'}</p>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination */}
        {data && totalPages > 1 && (
          <div className="flex items-center justify-center gap-3 border-t border-border px-5 py-3">
            <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page <= 1}
              className="rounded-lg px-3 py-1.5 text-sm font-medium text-muted-foreground hover:bg-muted disabled:cursor-not-allowed disabled:opacity-40">
              ‹ Prev
            </button>
            <span className="text-sm text-muted-foreground">Page <strong className="text-foreground">{page}</strong> of {totalPages}</span>
            <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page >= totalPages}
              className="rounded-lg px-3 py-1.5 text-sm font-medium text-muted-foreground hover:bg-muted disabled:cursor-not-allowed disabled:opacity-40">
              Next ›
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function LearnerSignInPage() {
  const basePath = import.meta.env.BASE_URL.replace(/\/$/, '');
  return <div className="grid min-h-[100dvh] place-items-center bg-muted/40 px-4"><SignIn routing="path" path={`${basePath}/sign-in`} signUpUrl={`${basePath}/sign-up`} /></div>;
}
function LearnerSignUpPage() {
  const basePath = import.meta.env.BASE_URL.replace(/\/$/, '');
  return <div className="grid min-h-[100dvh] place-items-center bg-muted/40 px-4"><SignUp routing="path" path={`${basePath}/sign-up`} signInUrl={`${basePath}/sign-in`} /></div>;
}
function AppRoutes() { return <Shell><RoutedErrorBoundary><Switch><Route path="/" component={DashboardPage} /><Route path="/settings" component={SettingsPage} /><Route path="/curriculum/groups" component={CurriculumGroupsPage} /><Route path="/curriculum/topics" component={CurriculumTopicsPage} /><Route path="/curriculum/contents" component={CurriculumContentsPage} /><Route path="/curriculum/tags" component={CurriculumTagsPage} /><Route path="/curriculum/glossary" component={CurriculumGlossaryPage} /><Route path="/curriculum/upload-status" component={CurriculumUploadStatusPage} /><Route path="/curriculum/others" component={CurriculumOthersPage} /><Route path="/curriculum/courses/:courseId/topics/:topicId/subtopics/:subtopicId" component={SubTopicPage} /><Route path="/curriculum/courses/:courseId/topics/:topicId" component={TopicWorkspacePage} /><Route path="/curriculum/courses/:id/structure" component={CourseStructurePage} /><Route path="/curriculum/courses/structure" component={CourseOBEPage} /><Route path="/curriculum/courses" component={CurriculumCoursesPage} /><Route path="/curriculum" component={CurriculumPage} /><Route path="/courses" component={CoursesPage} /><Route path="/learning-path" component={CoursesPage} /><Route path="/courses/:courseId" component={CourseDetailPage} /><Route path="/assignments" component={AssignmentsPage} /><Route path="/sessions" component={SessionsPage} /><Route path="/certificates" component={CertificatesPage} /><Route path="/analytics" component={AnalyticsPage} /><Route path="/users" component={UsersPage} /><Route path="/access-logs" component={AccessLogsPage} /><Route component={NotFound} /></Switch></RoutedErrorBoundary></Shell>; }
function AppRouter() { return <Switch><Route path="/sign-in/*?" component={LearnerSignInPage} /><Route path="/sign-up/*?" component={LearnerSignUpPage} /><Route component={AppRoutes} /></Switch>; }
function RoutedErrorBoundary({ children }: { children: ReactNode }) { const [location] = useLocation(); return <ErrorBoundary resetKey={location}>{children}</ErrorBoundary>; }
const basePath = import.meta.env.BASE_URL.replace(/\/$/, '');
const clerkPubKey = publishableKeyFromHost(window.location.hostname, import.meta.env.VITE_CLERK_PUBLISHABLE_KEY);
const clerkProxyUrl = import.meta.env.VITE_CLERK_PROXY_URL;
function stripBase(path: string) { return basePath && path.startsWith(basePath) ? path.slice(basePath.length) || '/' : path; }
function ClerkAppProvider() {
  const [, setLocation] = useLocation();
  return <ClerkProvider
    publishableKey={clerkPubKey}
    proxyUrl={clerkProxyUrl}
    signInUrl={`${basePath}/sign-in`}
    signUpUrl={`${basePath}/sign-up`}
    routerPush={(to) => setLocation(stripBase(to))}
    routerReplace={(to) => setLocation(stripBase(to), { replace: true })}
    appearance={{ theme: shadcn, variables: { colorPrimary: '#0b9d87', colorForeground: '#103743', colorMutedForeground: '#527078', colorBackground: '#ffffff', colorInput: '#f4f8f8', colorInputForeground: '#103743', colorNeutral: '#d5e4e4', fontFamily: 'Inter, ui-sans-serif, system-ui, sans-serif', borderRadius: '0.75rem' }, options: { logoImageUrl: `${window.location.origin}${basePath}/logo.svg`, logoPlacement: 'inside' } }}
  ><AppRouter /></ClerkProvider>;
}
function App() { return <QueryClientProvider client={queryClient}><TooltipProvider><WouterRouter base={basePath}><ClerkAppProvider /></WouterRouter><Toaster /></TooltipProvider></QueryClientProvider>; }
export default App;