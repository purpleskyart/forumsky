import { useEffect } from 'preact/hooks';

export function App() {
  console.log('[Minimal] App rendering');
  
  useEffect(() => {
    console.log('[Minimal] useEffect ran');
  }, []);

  return (
    <div style={{ padding: '40px', color: 'white', background: '#121212', minHeight: '100vh' }}>
      <h1>Minimal Test</h1>
      <p>If you see this, the app can render!</p>
    </div>
  );
}
