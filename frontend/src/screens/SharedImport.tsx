import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { peopleApi } from '../api/endpoints';
import { Loading, Pane } from '../components/Pane';
import { readSharedFile, type SharedChatFile } from '../native/native';
import { L } from '../theme/Plain';

let pending: SharedChatFile | null = null;
export function setPendingShare(f: SharedChatFile): void {
  pending = f;
}

/** Landing page for chat exports shared into the Android app: pick the person, then import. */
export function SharedImportScreen() {
  const nav = useNavigate();
  const people = useQuery({ queryKey: ['people'], queryFn: peopleApi.list });
  const [file] = useState(pending);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    if (!file) nav('/people', { replace: true });
  }, [file, nav]);
  if (!file) return null;

  const choose = async (pid: number) => {
    try {
      const blob = await readSharedFile(file);
      pending = null;
      nav(`/p/${pid}/sources`, { state: { sharedFile: { blob, name: file.name } } });
    } catch {
      setErr('Could not read the shared file. Try importing it from Sources instead.');
    }
  };

  return (
    <main className="screen">
      <Pane id="shared" tech="IMPORT SHARED CHAT" plain="Import a shared chat">
        <p><L t={`// received ${file.name}. which person is this chat with?`} p={`You shared ${file.name}. Who is this chat with?`} /></p>
        {people.isLoading && <Loading what="people" />}
        <div className="keys">
          {people.data?.map((p) => (
            <button key={p.id} type="button" className="key" onClick={() => void choose(p.id)}>{p.pseudonym}</button>
          ))}
        </div>
        {err && <p className="err" role="alert">{err}</p>}
      </Pane>
    </main>
  );
}
