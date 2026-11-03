import { TabBar } from './ui/TabBar';
import { matchRoute, useHashRoute } from './ui/router';
import { History } from './ui/screens/History';
import { LogSession } from './ui/screens/LogSession';
import { ProgramEditor } from './ui/screens/ProgramEditor';
import { Settings } from './ui/screens/Settings';
import { Today } from './ui/screens/Today';

export function App() {
  const path = useHashRoute();
  let screen;
  let showTabs = true;
  let m: Record<string, string> | null;
  if ((m = matchRoute(path, '/log/:id'))) {
    screen = <LogSession sessionId={m.id} />;
    showTabs = false;
  } else if (path.startsWith('/program')) {
    screen = <ProgramEditor />;
  } else if ((m = matchRoute(path, '/history/:id'))) {
    screen = <History exerciseId={m.id} />;
  } else if (path.startsWith('/history')) {
    screen = <History />;
  } else if (path.startsWith('/settings')) {
    screen = <Settings />;
  } else {
    screen = <Today />;
  }
  return (
    <>
      {screen}
      {showTabs && <TabBar path={path} />}
    </>
  );
}
