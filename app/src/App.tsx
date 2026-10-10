import { useCallback, useEffect, useRef, useState } from 'react';
import { RepoIcon } from './icons';
import type { Snapshot } from './types';
import { samePath } from './links';
import { currentRoute, navigate } from './routes';
import { request } from './Reader';
import { ROOT_CHANGED, setPlanningRoot } from './api';
import { Blankslate, SelectMenu, Spinner } from './ui';
import { navigation, Sidebar } from './Sidebar';
import { WorkList } from './WorkList';
import { FilePage, WorkPage } from './WorkPage';
import { Activity, Files, Knowledge, Statistics } from './Views';

export default function App() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [error, setError] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [route, setRoute] = useState(currentRoute);
  const [repository, setRepository] = useState('all');
  const [workSearch, setWorkSearch] = useState('');
  const [recordSearch, setRecordSearch] = useState('');
  const [location, setLocation] = useState('active');
  const generation = useRef(0);
  const loadedRoot = useRef<string | null>(null);
  const refresh = useCallback(async () => {
    const current = generation.current;
    setRefreshing(true);
    try {
      const next = await request<Snapshot>('/api/snapshot');
      if (current !== generation.current) return;
      if (loadedRoot.current !== null && loadedRoot.current !== next.root) {
        // Another tab switched the folder: drop this folder's filters and selection.
        setRepository('all'); setWorkSearch(''); setRecordSearch(''); setLocation('active');
        navigate({ view: 'work' });
      }
      loadedRoot.current = next.root; setPlanningRoot(next.root);
      setSnapshot(next); setError('');
    } catch (failure) { if (current === generation.current) setError(failure instanceof Error ? failure.message : 'The planning folder could not be read.'); }
    finally { setRefreshing(false); }
  }, []);
  useEffect(() => { void refresh(); const timer = window.setInterval(() => { if (!document.hidden) void refresh(); }, 20000); return () => clearInterval(timer); }, [refresh]);
  useEffect(() => {
    const change = () => {
      const next = currentRoute();
      setRoute(previous => {
        if (next.view !== previous.view || next.work !== previous.work || next.tab !== previous.tab || (!next.work && next.file !== previous.file)) window.scrollTo(0, 0);
        return next;
      });
    };
    window.addEventListener('hashchange', change);
    return () => window.removeEventListener('hashchange', change);
  }, []);
  useEffect(() => {
    const changed = () => void refresh();
    window.addEventListener(ROOT_CHANGED, changed);
    return () => window.removeEventListener(ROOT_CHANGED, changed);
  }, [refresh]);
  const switched = useCallback(() => {
    // A new planning folder: forget the previous folder's records and filters, then load it.
    generation.current++;
    setSnapshot(null); setError(''); setRepository('all'); setWorkSearch(''); setRecordSearch(''); setLocation('active');
    navigate({ view: 'work' });
    void refresh();
  }, [refresh]);

  const same = (a: string, b: string) => samePath(a, b, snapshot?.caseSensitivePaths, snapshot?.normalizationInsensitivePaths);
  const selectedFile = route.file && snapshot ? snapshot.documents.find(file => same(file.path, route.file!)) : undefined;
  const selectedWork = snapshot?.work.find(item => item.id === (selectedFile ? selectedFile.workId : route.work));
  const viewLabel = navigation.find(item => item.id === route.view)?.label ?? 'Work';
  const repositoryMenu = snapshot && snapshot.repositories.length > 1 ? <SelectMenu label="Repository" icon={<RepoIcon size={16} />} value={repository} onChange={setRepository}
    options={[{ value: 'all', label: 'All' }, ...snapshot.repositories.map(item => ({ value: item.id, label: item.id, count: snapshot.work.filter(work => work.repositories.includes(item.id)).length }))]} /> : null;

  let content;
  if (!snapshot) {
    content = error ? <div className="box page-state"><Blankslate title="This planning folder can’t be read">{error} Choose another folder from the sidebar.</Blankslate></div>
      : <div className="page-state"><Spinner size={24} /></div>;
  } else if (selectedWork) {
    content = <WorkPage key={snapshot.root + selectedWork.id} work={selectedWork} snapshot={snapshot} route={route} />;
  } else if (selectedFile) {
    content = <FilePage file={selectedFile} snapshot={snapshot} route={route} viewLabel={viewLabel} />;
  } else if (route.view === 'knowledge') {
    content = <Knowledge snapshot={snapshot} search={recordSearch} setSearch={setRecordSearch} />;
  } else if (route.view === 'records') {
    content = <Files snapshot={snapshot} repository={repository} search={recordSearch} setSearch={setRecordSearch} repositoryMenu={repositoryMenu} />;
  } else if (route.view === 'history') {
    content = <Activity snapshot={snapshot} repository={repository} repositoryMenu={repositoryMenu} />;
  } else if (route.view === 'insights') {
    content = <Statistics snapshot={snapshot} repository={repository} repositoryMenu={repositoryMenu} />;
  } else {
    content = <WorkList snapshot={snapshot} repository={repository} location={location} setLocation={setLocation} search={workSearch} setSearch={setWorkSearch} repositoryMenu={repositoryMenu} />;
  }
  return <div className="app">
    <Sidebar snapshot={snapshot} route={route} refreshing={refreshing} loadedAt={snapshot?.loadedAt ?? null} onRefresh={() => void refresh()} onSwitched={switched}
      onNavigate={view => { setWorkSearch(''); setRecordSearch(''); navigate({ view }); }} />
    <main className="content">
      {snapshot && error && <div className="flash flash-warning">{error}</div>}
      {content}
    </main>
  </div>;
}
